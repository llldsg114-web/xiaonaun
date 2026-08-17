"use strict";
/**
 * qa-voice-acceptance.test.js · 心屿 候选 B 语音底座 · 独立黑盒验收
 * ====================================================================
 * 运行：node --test test/qa-voice-acceptance.test.js
 * 依赖：零 npm 依赖，仅 node:test + node:assert + node:fs（读源做静态零上报校验）。
 * 不信任工程师自评，独立覆盖：零上报、ASR 同意门、TTS 行为、降级、
 * 偏好与 LTM 边界(Q4)、同意状态机。shim 写法与 voice.test.js 对齐。
 *
 * 铁律：只新增本测试文件；不修改实现/冻结线；不硬编码 HEAD:ai-girlfriend/...；
 * 不引入 npm 依赖。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// ===== Node 最小浏览器 shim（参考 voice.test.js / xinyu-mcp-selftest.mjs）=====
let mem;
let lastUtterance = null;
let speakCalls = 0;
let cancelCalls = 0;
let srConstructCount = 0;   // SpeechRecognition 构造次数（验证绝不采集）
let activeRecognition = null;
let fetchCount = 0;
let xhrCount = 0;
let sendBeaconCount = 0;

function installShim() {
  // localStorage（与既有 shim 一致）
  mem = new Map();
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

  // SpeechSynthesisUtterance 桩（记录 text/lang/rate/pitch）
  lastUtterance = null;
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text; this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
      lastUtterance = this;
    }
  };

  // speechSynthesis 桩（记录 speak/cancel；并模拟 onstart）
  speakCalls = 0; cancelCalls = 0;
  globalThis.window.speechSynthesis = {
    speak(u) { speakCalls++; this._last = u; if (typeof u.onstart === "function") u.onstart(); },
    cancel() { cancelCalls++; },
    getVoices() { return []; },
  };

  // SpeechRecognition 桩（统计构造次数，验证绝不采集）
  srConstructCount = 0; activeRecognition = null;
  globalThis.window.SpeechRecognition = class SpeechRecognition {
    constructor() {
      srConstructCount++;
      this.lang = ""; this.continuous = false; this.interimResults = false;
      this.onresult = null; this.onerror = null; this.onend = null;
      activeRecognition = this;
    }
    start() {}
    stop() { if (this.onend) this.onend(); }
    abort() { if (this.onend) this.onend(); }
  };
  // 兼容 webkitSpeechRecognition 别名（isSupported 用 G.SpeechRecognition || G.webkitSpeechRecognition）
  globalThis.window.webkitSpeechRecognition = globalThis.window.SpeechRecognition;

  // 网络外发句柄桩（零上报探针用）：计数所有外发通道
  fetchCount = 0; xhrCount = 0; sendBeaconCount = 0;
  globalThis.fetch = function () { fetchCount++; return Promise.resolve({ ok: true, json: async () => ({}) }); };
  globalThis.XMLHttpRequest = class XMLHttpRequest {
    constructor() { xhrCount++; }
    open() {} send() {}
  };
  // navigator.sendBeacon（Node 下可能只读，包 try/catch 防御）
  try {
    if (!globalThis.navigator) globalThis.navigator = {};
    globalThis.navigator.sendBeacon = function () { sendBeaconCount++; return true; };
  } catch (e) { /* 不可补则忽略；voice.js 本就不调用 */ }

  // 清除可能残留的 LTM 桩
  delete globalThis.LTM;
}

// 加载语音门面（IIFE 副作用挂 window.Voice）。每次 reset 重新加载，
// 保证模块内部状态（pref/开关/同意）随 localStorage 清空而重置。
let Voice;
function loadVoice() {
  delete require.cache[require.resolve("../voice.js")];
  require("../voice.js");
  Voice = globalThis.window.Voice;
}

function reset() {
  installShim();
  loadVoice();
  assert.ok(Voice, "window.Voice 应已挂载");
}

reset();

// 读取源文件（静态零上报校验；不硬编码 HEAD 路径，用 __dirname 相对定位）
const VOICE_SRC = fs.readFileSync(path.join(__dirname, "..", "voice.js"), "utf8");

// ===== 0. 接口完整性（独立确认门面齐全）=====
test("0 门面接口完整：Voice 暴露全部约定方法/常量", () => {
  reset();
  for (const m of [
    "speak", "cancelSpeak", "startListen", "stopListen", "onState", "getState",
    "STATE", "isSupported", "getPref", "setPref", "getConsent", "setConsent",
    "isEnabled", "setEnabled", "requestAsrConsent", "writeVoicePrefToLTM", "__zeroReportProbe",
  ]) {
    assert.ok(typeof Voice[m] !== "undefined", `Voice.${m} 应存在`);
  }
  assert.strictEqual(typeof Voice.STATE.IDLE, "string");
  assert.strictEqual(typeof Voice.STATE.CONSENT_REQUIRED, "string");
});

// ===== 1. 零上报（核心）=====
test("1-静态 源文件无 fetch/XMLHttpRequest/WebSocket/sendBeacon 字面", () => {
  const banned = /fetch|XMLHttpRequest|WebSocket|sendBeacon/i;
  assert.strictEqual(banned.test(VOICE_SRC), false, "voice.js 不应包含任何网络外发字面量");
});

test("1-运行时 零上报：speak 与 startListen(同意后) 期间外发调用数=0，且探针=0", () => {
  reset();
  assert.strictEqual(fetchCount, 0);
  assert.strictEqual(xhrCount, 0);
  assert.strictEqual(sendBeaconCount, 0);

  // TTS 路径（默认 tts 开）
  const okSpeak = Voice.speak("本地朗读，不应产生任何网络外发");
  assert.strictEqual(okSpeak, true);

  // ASR 路径（先同意再启用）
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  const cbReceived = [];
  const okListen = Voice.startListen((t) => cbReceived.push(t), { onInterim: () => {} });
  assert.strictEqual(okListen, true);

  // 断言所有外发通道计数恒为 0
  assert.strictEqual(fetchCount, 0, "fetch 外发必须为 0");
  assert.strictEqual(xhrCount, 0, "XMLHttpRequest 外发必须为 0");
  assert.strictEqual(sendBeaconCount, 0, "sendBeacon 外发必须为 0");

  // 零上报探针自证
  assert.strictEqual(Voice.__zeroReportProbe().outbound, 0, "__zeroReportProbe().outbound 应为 0");
  assert.strictEqual(typeof Voice.__zeroReportProbe().note, "string");

  Voice.stopListen();
});

// ===== 2. ASR 同意门 =====
test("2-未同意(已开启后撤销) startListen 返回 false 且绝不构造识别器（绝不采集）", () => {
  reset();
  // 精确隔离「同意门」：先同意并开启，再撤销同意（asr 标志仍在），此时拒绝应因 no_consent
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  Voice.setConsent(false);
  assert.strictEqual(Voice.getConsent(), false);
  assert.strictEqual(Voice.isEnabled("asr"), true, "asr 标志仍开启，用于隔离同意门");

  srConstructCount = 0;
  const received = [];
  const ok = Voice.startListen((t) => received.push(t));
  assert.strictEqual(ok, false, "未同意应返回 false");
  assert.strictEqual(srConstructCount, 0, "未同意绝不应构造 SpeechRecognition（绝不采集）");
  assert.strictEqual(received.length, 0, "未同意不应回调任何文本");
  assert.strictEqual(Voice.getState(), "consent_required");
});

test("2-未开启(默认关) startListen 同样不构造识别器", () => {
  reset();
  Voice.setConsent(false); // 默认 asr 关、无同意
  srConstructCount = 0;
  const ok = Voice.startListen(() => {});
  assert.strictEqual(ok, false);
  assert.strictEqual(srConstructCount, 0, "未开启也应绝不构造识别器");
});

test("2-同意后 startListen 构造识别器并发 final 文本给 cb", () => {
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
      { 0: { transcript: "我" }, isFinal: false },
      { 0: { transcript: "想听小暖讲个故事" }, isFinal: true },
    ],
  });
  assert.deepStrictEqual(interimSeen, ["我"]);
  assert.deepStrictEqual(received, ["想听小暖讲个故事"]);

  Voice.stopListen();
  assert.strictEqual(Voice.getState(), "idle");
});

// ===== 3. TTS 行为 =====
test("3-speak 触发 SpeechSynthesisUtterance 且 lang=zh-CN", () => {
  reset();
  const ok = Voice.speak("小暖在听你说的每一句话");
  assert.strictEqual(ok, true);
  assert.strictEqual(speakCalls, 1);
  assert.ok(lastUtterance, "应构造 SpeechSynthesisUtterance");
  assert.strictEqual(lastUtterance.text, "小暖在听你说的每一句话");
  assert.strictEqual(lastUtterance.lang, "zh-CN");
});

test("3-speak 应用偏好 rate/pitch", () => {
  reset();
  Voice.setPref({ rate: 1.5, pitch: 0.8 });
  const ok = Voice.speak("应用音色参数");
  assert.strictEqual(ok, true);
  assert.strictEqual(lastUtterance.rate, 1.5, "应使用偏好 rate");
  assert.strictEqual(lastUtterance.pitch, 0.8, "应使用偏好 pitch");
});

test("3-cancelSpeak 调用 speechSynthesis.cancel", () => {
  reset();
  Voice.speak("朗读中");
  assert.strictEqual(speakCalls, 1);
  cancelCalls = 0; // 隔离 speak 内部打断式 cancel，仅验证 cancelSpeak 触发
  Voice.cancelSpeak();
  assert.strictEqual(cancelCalls, 1, "cancelSpeak 应调用 speechSynthesis.cancel");
});

test("3-静音(tts 关) 时 speak 不朗读且返回 false", () => {
  reset();
  Voice.setEnabled("tts", false);
  const ok = Voice.speak("不应朗读");
  assert.strictEqual(ok, false);
  assert.strictEqual(speakCalls, 0);
});

// ===== 4. 降级 =====
test("4-无语音 API 时 isSupported 返回 {tts:false,asr:false}", () => {
  reset();
  const sSS = globalThis.window.speechSynthesis;
  const sSR = globalThis.window.SpeechRecognition;
  const sUtt = globalThis.SpeechSynthesisUtterance;
  delete globalThis.window.speechSynthesis;
  delete globalThis.window.SpeechRecognition;
  delete globalThis.window.webkitSpeechRecognition;
  delete globalThis.SpeechSynthesisUtterance;

  const sup = Voice.isSupported();
  assert.deepStrictEqual(sup, { tts: false, asr: false }, "无 API 应双 false");

  // 恢复，避免影响后续用例
  globalThis.window.speechSynthesis = sSS;
  globalThis.window.SpeechRecognition = sSR;
  globalThis.window.webkitSpeechRecognition = sSR;
  globalThis.SpeechSynthesisUtterance = sUtt;
});

test("4-降级 speak 在 TTS 不可用时安全返回 false（不抛）", () => {
  reset();
  delete globalThis.window.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
  let threw = false; let ret;
  try { ret = Voice.speak("降级文本"); } catch (e) { threw = true; }
  assert.strictEqual(threw, false, "speak 降级不应冒泡");
  assert.strictEqual(ret, false, "speak 降级应返回 false");
});

test("4-降级 startListen 在 ASR 不可用时安全返回 false（不抛、不采集）", () => {
  reset();
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  delete globalThis.window.SpeechRecognition;
  delete globalThis.window.webkitSpeechRecognition;
  srConstructCount = 0;
  let threw = false; let ret;
  try { ret = Voice.startListen(() => {}); } catch (e) { threw = true; }
  assert.strictEqual(threw, false, "startListen 降级不应冒泡");
  assert.strictEqual(ret, false, "startListen 降级应返回 false");
  assert.strictEqual(srConstructCount, 0, "降级时绝不应构造识别器");
});

// ===== 5. 偏好与 LTM 边界（Q4）=====
test("5-Q4 setPref 只写 localStorage，绝不静默写 LTM；仅 writeVoicePrefToLTM 显式写", () => {
  reset();
  // 安装 LTM 桩，记录每次调用参数
  let ltmCalls = 0;
  let ltmLastArg = null;
  globalThis.LTM = {
    update(id, content) { ltmCalls++; ltmLastArg = { id, content }; },
  };

  // 多次 setPref（不调用 writeVoicePrefToLTM）
  Voice.setPref({ rate: 1.2, pitch: 0.9, volume: 0.7, voiceURI: "v-xiaonuan" });
  Voice.setPref({ rate: 1.4 });
  Voice.setPref({ lang: "zh-CN" });

  // 核心断言：setPref 期间 LTM 零调用（绝不静默写 LTM）
  assert.strictEqual(ltmCalls, 0, "setPref 绝不应写 LTM");

  // 仅写 localStorage 偏好键，且合并为最新值
  const raw = globalThis.localStorage.getItem("xinyu_voice_pref");
  assert.ok(raw, "setPref 应写 localStorage[xinyu_voice_pref]");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.rate, 1.4, "localStorage 应反映最新合并偏好");
  assert.strictEqual(parsed.voiceURI, "v-xiaonuan");

  // 显式调用 writeVoicePrefToLTM 才写 LTM，且仅一次
  const ok = Voice.writeVoicePrefToLTM();
  assert.strictEqual(ok, true, "writeVoicePrefToLTM 应成功");
  assert.strictEqual(ltmCalls, 1, "仅显式调用时 LTM 才被写一次");
  assert.strictEqual(ltmLastArg.id, "preference");
  assert.strictEqual(ltmLastArg.content.voice.rate, 1.4);
  assert.strictEqual(ltmLastArg.content.voice.lang, "zh-CN");

  // 显式调用之后，再次 setPref 仍不应写 LTM（证明无隐式旁路）
  Voice.setPref({ pitch: 0.5 });
  assert.strictEqual(ltmCalls, 1, "显式调用后再次 setPref 仍不应写 LTM");
});

// ===== 6. 同意状态机（隐私门控不被绕开）=====
test("6-setEnabled('asr',true) 未同意时返回 false 且不置位开关", () => {
  reset();
  assert.strictEqual(Voice.getConsent(), false);
  const ok = Voice.setEnabled("asr", true);
  assert.strictEqual(ok, false, "未同意启用 ASR 应返回 false");
  // 隐私门控：开关绝不应被置位
  assert.strictEqual(Voice.isEnabled("asr"), false, "asr 开关绝不应被置位");
  assert.strictEqual(globalThis.localStorage.getItem("xinyu_voice_asr_enabled"), null,
    "localStorage 不应写入 asr_enabled=true");
  assert.strictEqual(Voice.getState(), "consent_required", "未同意应进入 consent_required 状态");
});

test("6-未同意但 ASR 已开启时启动识别 → consent_required 且不采集", () => {
  reset();
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  Voice.setConsent(false); // 撤销同意，asr 标志仍在，隔离同意门
  srConstructCount = 0;
  const ok = Voice.startListen(() => {});
  assert.strictEqual(ok, false);
  assert.strictEqual(Voice.getState(), "consent_required");
  assert.strictEqual(srConstructCount, 0, "绝不应构造识别器（不采集）");
});

test("6-requestAsrConsent 未同意时返回 Promise<true> 并记录同意（门控随后可满足）", async () => {
  reset();
  assert.strictEqual(Voice.getConsent(), false);
  const res = await Voice.requestAsrConsent();
  assert.strictEqual(res, true, "应已授予同意并 resolve(true)");
  assert.strictEqual(Voice.getConsent(), true, "同意状态应被记录");
  // 门控随后可被满足：已同意后启用 asr 成功
  const ok = Voice.setEnabled("asr", true);
  assert.strictEqual(ok, true, "已同意后启用 asr 应成功");
  assert.strictEqual(Voice.isEnabled("asr"), true);
});
