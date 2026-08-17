"use strict";
/**
 * voice.test.js · 心屿 候选 B 语音底座 单元测试（前端黑盒）
 * ============================================================
 * 运行：node --test test/voice.test.js
 * 依赖：零 npm 依赖，仅 node:test + node:assert。
 *
 * Node 下无 SpeechSynthesis / SpeechRecognition，本文件自建最小
 * shim（参考 xinyu-mcp-selftest.mjs 的 localStorage / crypto 写法），
 * 覆盖：能力探测降级、偏好往返、TTS 触发与打断、ASR 同意门禁与
 * final 回传、零上报断言、异常降级。
 */

const test = require("node:test");
const assert = require("node:assert");

// ===== Node 最小浏览器 shim =====

// localStorage（与 xinyu-mcp-selftest 写法一致）
const mem = new Map();
globalThis.localStorage = {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; },
  setItem(k, v) { mem.set(k, String(v)); },
  removeItem(k) { mem.delete(k); },
  clear() { mem.clear(); },
  get length() { return mem.size; },
  key(i) { return [...mem.keys()][i] ?? null; },
};

// window 指向 globalThis（语音门面经 window 暴露）
globalThis.window = globalThis;

// SpeechSynthesisUtterance 构造器（记录 text/lang/voice 参数）
let lastUtterance = null;
globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    lastUtterance = this;
  }
};

// speechSynthesis（记录 speak / cancel 调用；并触发 onstart 模拟真实朗读开始）
let speakCalls = 0;
let cancelCalls = 0;
globalThis.window.speechSynthesis = {
  speak(u) { speakCalls++; this._last = u; if (typeof u.onstart === "function") u.onstart(); },
  cancel() { cancelCalls++; },
  getVoices() { return []; },
};

// SpeechRecognition（可手动触发 onresult 发 final / onend）
let activeRecognition = null;
globalThis.window.SpeechRecognition = class SpeechRecognition {
  constructor() {
    this.lang = "";
    this.continuous = false;
    this.interimResults = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    activeRecognition = this;
  }
  start() { /* 不自动触发，由测试手动 emit */ }
  stop() { if (this.onend) this.onend(); }
  abort() { if (this.onend) this.onend(); }
};

// 加载语音门面（IIFE 副作用挂 window.Voice）。每次 reset 重新加载，
// 保证模块内部状态（pref / 开关 / 同意）随 localStorage 清空而重置。
let Voice;
function loadVoice() {
  delete require.cache[require.resolve("../voice.js")];
  require("../voice.js");
  Voice = globalThis.window.Voice;
}
loadVoice();
assert.ok(Voice, "window.Voice 应已挂载");

// 每个用例前重置计数器与同意/开关状态
function reset() {
  speakCalls = 0;
  cancelCalls = 0;
  lastUtterance = null;
  activeRecognition = null;
  mem.clear();
  loadVoice();
}

// ===== ① 能力探测降级 =====
test("① isSupported 无 API 时返回 {tts:false, asr:false}", () => {
  reset();
  const sSynth = globalThis.window.speechSynthesis;
  const sSR = globalThis.window.SpeechRecognition;
  const sUtt = globalThis.SpeechSynthesisUtterance;
  delete globalThis.window.speechSynthesis;
  delete globalThis.window.SpeechRecognition;
  delete globalThis.SpeechSynthesisUtterance;

  const sup = Voice.isSupported();
  assert.deepStrictEqual(sup, { tts: false, asr: false });

  // 恢复，避免影响后续用例
  globalThis.window.speechSynthesis = sSynth;
  globalThis.window.SpeechRecognition = sSR;
  globalThis.SpeechSynthesisUtterance = sUtt;
});

test("① isSupported 有 shim 时返回 {tts:true, asr:true}", () => {
  reset();
  const sup = Voice.isSupported();
  assert.deepStrictEqual(sup, { tts: true, asr: true });
});

// ===== ② 偏好与同意 往返（localStorage 持久）=====
test("② setPref / getPref 往返且持久化", () => {
  reset();
  const p = Voice.setPref({ rate: 1.5, pitch: 0.8, volume: 0.6, voiceURI: "xiaonuan-voice" });
  assert.strictEqual(p.rate, 1.5);
  assert.strictEqual(p.pitch, 0.8);
  assert.strictEqual(p.volume, 0.6);
  assert.strictEqual(p.voiceURI, "xiaonuan-voice");
  assert.strictEqual(p.lang, "zh-CN");

  // 重新读取（应来自同一内存副本；再开一个门面验证持久化）
  const raw = globalThis.localStorage.getItem("xinyu_voice_pref");
  assert.ok(raw, "localStorage 应写入 xinyu_voice_pref");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.rate, 1.5);
  assert.strictEqual(parsed.voiceURI, "xiaonuan-voice");

  // getPref 返回当前偏好
  assert.strictEqual(Voice.getPref().rate, 1.5);
});

test("② 默认值正确（未设置时）", () => {
  reset();
  const p = Voice.getPref();
  assert.strictEqual(p.rate, 1.0);
  assert.strictEqual(p.pitch, 1.0);
  assert.strictEqual(p.volume, 1.0);
  assert.strictEqual(p.lang, "zh-CN");
  // 开关默认值：TTS 开 / ASR 关
  assert.strictEqual(Voice.isEnabled("tts"), true);
  assert.strictEqual(Voice.isEnabled("asr"), false);
});

test("② getConsent / setConsent 往返", () => {
  reset();
  assert.strictEqual(Voice.getConsent(), false);
  Voice.setConsent(true);
  assert.strictEqual(Voice.getConsent(), true);
  assert.strictEqual(globalThis.localStorage.getItem("xinyu_voice_asr_consent"), "granted");
  Voice.setConsent(false);
  assert.strictEqual(Voice.getConsent(), false);
});

// ===== ③ TTS 触发 utterance + cancel 打断 =====
test("③ speak 使用 zh-CN 且触发 utterance", () => {
  reset();
  const ok = Voice.speak("小暖在听你说的每一句话");
  assert.strictEqual(ok, true);
  assert.strictEqual(speakCalls, 1);
  assert.ok(lastUtterance, "应构造 SpeechSynthesisUtterance");
  assert.strictEqual(lastUtterance.text, "小暖在听你说的每一句话");
  assert.strictEqual(lastUtterance.lang, "zh-CN");
});

test("③ cancelSpeak 调用 speechSynthesis.cancel", () => {
  reset();
  Voice.speak("朗读中");
  assert.strictEqual(speakCalls, 1);
  cancelCalls = 0; // 隔离：speak 内部已打断式 cancel 一次，此处仅验证 cancelSpeak 触发
  Voice.cancelSpeak();
  assert.strictEqual(cancelCalls, 1);
});

test("③ TTS 关闭（静音）时不朗读", () => {
  reset();
  Voice.setEnabled("tts", false);
  const ok = Voice.speak("不应朗读");
  assert.strictEqual(ok, false);
  assert.strictEqual(speakCalls, 0);
});

// ===== ④ ASR 同意门禁 + final 回传 =====
test("④ startListen 未同意时直接拒绝（不采集）", () => {
  reset();
  // 确保 ASR 启用但无同意
  Voice.setEnabled("asr", true);
  Voice.setConsent(false);
  activeRecognition = null; // 清零，验证未构造识别器
  const received = [];
  const ok = Voice.startListen((t) => received.push(t));
  assert.strictEqual(ok, false, "未同意应返回 false");
  assert.strictEqual(activeRecognition, null, "不应构造识别器（绝不采集）");
  assert.strictEqual(received.length, 0);
});

test("④ startListen 同意后 emit final 文本给 cb", () => {
  reset();
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  const received = [];
  const interimSeen = [];
  const ok = Voice.startListen(
    (t) => received.push(t),
    { onInterim: (t) => interimSeen.push(t) }
  );
  assert.strictEqual(ok, true, "同意后应成功启动");
  assert.ok(activeRecognition, "应已构造识别器");
  assert.strictEqual(activeRecognition.lang, "zh-CN");
  assert.strictEqual(activeRecognition.continuous, false);
  assert.strictEqual(activeRecognition.interimResults, true);

  // 模拟 onresult：先 interim 后 final
  activeRecognition.onresult({
    resultIndex: 0,
    results: [
      { 0: { transcript: "我想" }, isFinal: false },
      { 0: { transcript: "听小暖唱歌" }, isFinal: true },
    ],
  });
  assert.deepStrictEqual(interimSeen, ["我想"]);
  assert.deepStrictEqual(received, ["听小暖唱歌"]);

  // 停止
  Voice.stopListen();
  assert.strictEqual(Voice.getState(), "idle");
});

// ===== ⑤ 零上报：speak / startListen 期间 fetch 调用 = 0 =====
test("⑤ 零上报：speak / startListen 期间无任何外发", () => {
  reset();
  let fetchCount = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = function () { fetchCount++; return Promise.resolve({ ok: true }); };

  try {
    // TTS 路径
    Voice.speak("这是本地朗读，不应外发");
    // ASR 路径（需先同意再启用）
    Voice.setConsent(true);
    Voice.setEnabled("asr", true);
    Voice.startListen(() => {});
    assert.strictEqual(fetchCount, 0, "speak/startListen 期间 fetch 调用数必须为 0");
    // 零上报探针自证
    assert.strictEqual(Voice.__zeroReportProbe().outbound, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ===== ⑥ 异常降级：speak 抛错不向上冒泡 =====
test("⑥ speak 构造异常时不冒泡、返回 false", () => {
  reset();
  const orig = globalThis.SpeechSynthesisUtterance;
  // 让构造器抛错，模拟环境异常
  globalThis.SpeechSynthesisUtterance = function () { throw new Error("boom"); };
  let threw = false;
  let ret = true;
  try {
    ret = Voice.speak("异常文本");
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, "异常不应向上冒泡");
  assert.strictEqual(ret, false, "异常应降级返回 false");
  // 恢复
  globalThis.SpeechSynthesisUtterance = orig;
});

test("⑥ startListen 构造异常时不冒泡、返回 false", () => {
  reset();
  const orig = globalThis.window.SpeechRecognition;
  globalThis.window.SpeechRecognition = function () { throw new Error("no-asr"); };
  Voice.setEnabled("asr", true);
  Voice.setConsent(true);
  let threw = false;
  let ret = true;
  try {
    ret = Voice.startListen(() => {});
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false);
  assert.strictEqual(ret, false);
  globalThis.window.SpeechRecognition = orig;
});

// ===== ⑦ 显式写入 LTM（available 时）=====
test("⑦ writeVoicePrefToLTM 仅在 LTM 可用时写入", () => {
  reset();
  Voice.setPref({ rate: 1.2, pitch: 0.9, volume: 0.7, voiceURI: "v1" });
  // 无 LTM 时应安全返回 false
  assert.strictEqual(Voice.writeVoicePrefToLTM(), false);

  // 提供 LTM 门面（记录调用）
  let ltmCalled = null;
  globalThis.window.LTM = {
    update(id, content) { ltmCalled = { id: id, content: content }; },
  };
  const ok = Voice.writeVoicePrefToLTM();
  assert.strictEqual(ok, true);
  assert.strictEqual(ltmCalled.id, "preference");
  assert.strictEqual(ltmCalled.content.voice.rate, 1.2);
  assert.strictEqual(ltmCalled.content.voice.lang, "zh-CN");

  // LTM 抛错应静默降级（返回 false，不冒泡）
  globalThis.window.LTM = { update() { throw new Error("ltm down"); } };
  let threw = false;
  let ret = true;
  try { ret = Voice.writeVoicePrefToLTM(); } catch (e) { threw = true; }
  assert.strictEqual(threw, false);
  assert.strictEqual(ret, false);
  delete globalThis.window.LTM;
});

// ===== ⑧ 状态订阅 =====
test("⑧ onState 订阅可收到 speaking / idle", () => {
  reset();
  const seen = [];
  const off = Voice.onState((s) => seen.push(s.type));
  Voice.speak("状态广播");
  Voice.cancelSpeak();
  off(); // 取消订阅
  assert.ok(seen.includes("speaking"), "应收到 speaking");
  assert.ok(seen.includes("idle"), "应收到 idle");
});
