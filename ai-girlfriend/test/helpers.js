"use strict";
/* 小暖 · 测试辅助层
 * 职责：把 engine.js（浏览器 IIFE，末尾 `const Engine = (...)()`）加载进 Node，
 * 并提供确定性 rng、state 工厂、统计工具。零 npm 依赖。 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENGINE_PATH = path.join(ROOT, "engine.js");

/* ---------- S0-c：装载清单唯一真相源 ----------
 * engine.files.json 的 order 决定 Node 侧拼接顺序，index.html / sw.js 与它对齐（WR-13 交叉校验）。
 * 缺 json → 退回单文件 engine.js；order 里缺文件 → 跳过该文件（半更新态不白屏）。
 * optional 内的文件存在才拼，不存在不报错。 */
function engineSources(root = ROOT) {
  let list = ["engine.js"];
  try {
    const raw = fs.readFileSync(path.join(root, "engine.files.json"), "utf8");
    const cfg = JSON.parse(raw);
    if (Array.isArray(cfg.order) && cfg.order.length) list = cfg.order.slice();
    if (Array.isArray(cfg.optional)) list = list.concat(cfg.optional);
  } catch (e) { /* 无清单即单文件模式，等价 v12 */ }
  const out = [];
  for (const f of list) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) out.push(fs.readFileSync(p, "utf8"));
  }
  if (!out.length) throw new Error("engineSources: 未找到任何引擎文件");
  return out.join("\n;\n");
}

/* ---------- 引擎加载 ----------
 * engine.js 是 `const Engine = (() => {...})()` 结构，模块内没有 export，
 * vm.runInContext 拿不到 const 绑定（const 不挂 globalThis）。
 * bridge/xiaonuan-bridge.js:99 与 openclaw.js:40 都用 `new Function(src + "\nreturn Engine;")()`，
 * 测试层与生产层保持完全一致的加载方式。 */
function loadEngine() {
  const src = engineSources(ROOT);
  const E = new Function(`${src}\nreturn Engine;`)();
  if (!E || typeof E.reply !== "function") throw new Error("engine.js 未导出 Engine.reply");
  return E;
}

/* 在一个「显式毒化浏览器全局」的沙箱里加载引擎：
 * 若引擎真的读了 document/window/localStorage/navigator，立即抛错。
 * 这是 V-30 / 工程约束 1 的运行时证据（静态 grep 只能证明文本，不能证明行为）。 */
function loadEngineTrapped() {
  const src = engineSources(ROOT);
  const trap = (name) => new Proxy({}, {
    get() { throw new Error(`引擎触碰了浏览器全局: ${name}`); },
    has() { throw new Error(`引擎触碰了浏览器全局: ${name}`); },
  });
  // 以形参注入同名符号，覆盖任何全局查找路径
  const factory = new Function(
    "document", "window", "localStorage", "navigator", "self", "location",
    `${src}\nreturn Engine;`,
  );
  return factory(trap("document"), trap("window"), trap("localStorage"), trap("navigator"), trap("self"), trap("location"));
}

/* ---------- 确定性 rng（mulberry32）---------- */
function makeRng(seed = 42) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- state 工厂 ---------- */
const CARD_IDS = ["xiaonuan", "xiaonuan_tsundere", "xiaonuan_clingy"];

/* v11 完整 state */
function freshState(over = {}) {
  return Object.assign({
    affection: 100,
    nick: "阿明",
    mood: null,
    memory: { userName: "阿明", likes: [], events: [] },
    persona: { gender: "female", card: "xiaonuan" },
    dating: null,
    lastReply: "",
    topic: null,
    recentReplies: [],
    ue: null,
    storylines: {},
    storyTurns: 0,
    lastStoryAt: null,
    usedProactive: {},
    safety: { lastCardAt: 0, off: false, hits: [] },
    flags: { empathyVA: true, personaStyle: true, topicFsm: true },
  }, over);
}

/* v10 老存档：**刻意不含**任何 v11 新字段（topic/ue/recentReplies/storylines/safety/flags…）
 * 用于 V-25 / V-27 老存档兼容验证。字段集严格照搬 v10 defaultState 的对话相关部分。 */
function legacyStateV10(over = {}) {
  return Object.assign({
    affection: 100,
    nick: "阿明",
    mood: null,
    memory: { userName: "阿明", likes: [], events: [], lastTopic: "" },
    persona: { gender: "female", card: "xiaonuan" },
    dating: null,
    lastReply: "",
  }, over);
}

function withCard(state, cardId) {
  return Object.assign({}, state, {
    persona: Object.assign({}, state.persona, { card: cardId }),
  });
}

/* ---------- 统计工具 ---------- */
function pct(n, total) { return total === 0 ? 0 : (n / total) * 100; }
function fmtPct(n, total) { return `${pct(n, total).toFixed(1)}% (${n}/${total})`; }

/* 两个字符串数组的重合率：交集大小 / 较小集合大小 */
function overlapRate(a, b) {
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const denom = Math.min(sa.size, sb.size) || 1;
  return inter / denom;
}

/* 一次完整对话回合：调用 reply 并把返回的新字段回写 state（模拟 app.js 的回写逻辑） */
function turn(E, state, text) {
  const r = E.reply(text, state);
  if (r.recentReplies !== undefined) state.recentReplies = r.recentReplies;
  if (r.topic !== undefined) state.topic = r.topic;
  if (r.ue !== undefined) state.ue = r.ue;
  if (r.replies && r.replies.length) state.lastReply = r.replies[r.replies.length - 1];
  return r;
}

module.exports = {
  ROOT, ENGINE_PATH, CARD_IDS,
  engineSources,
  loadEngine, loadEngineTrapped, makeRng,
  freshState, legacyStateV10, withCard,
  pct, fmtPct, overlapRate, turn,
};
