"use strict";
/* 小暖 · v2 ③ 本地引擎消费 mindCtx（MindProfile 塑形偏置）回归测试
 *
 * 运行：  node --test test/engine-mindprofile.test.js
 *   或随整体：npm test（node --test test/*.test.js）
 *
 * 纯增量，零新依赖。覆盖 v2-design §4 / §8 / §10.4 / §11：
 *   1) normalizeProfile：12 维信封 → MindProfile（形状/派生/缺失补齐/无效安全）
 *   2) dominant=possess & possessive>0.5 → reply 后缀更黏人（与基线可区分）
 *   3) dominant=anger & negative>0.5 → NEG 给台阶更早触发（更短 streak）
 *   4) mp=null / 中性画像 → 回复与基线逐字节一致（回归护栏 §11）
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");

const E = H.loadEngine();

/* node 下补齐浏览器全局（mcp-client 的 TokenStore 在方法内静默降级，这里仅保险） */
globalThis.localStorage = globalThis.localStorage || {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

/* 动态加载 ESM 的 mcp-client（含 normalizeProfile），规避 CJS/ESM 混用限制 */
async function getMcpClient() {
  const mod = await import("../mcp-client.js");
  return mod.McpClient;
}

/* 稳定聊天输入 + 确定性 rng 种子，让 reply 落到「普通聊天 + 后缀区」 */
const CHAT_INPUT = "在干嘛呀";

/* 让 12 维信封「占有主导且占有欲偏高」的样例 */
function possessEnvelope() {
  return {
    state_vector: {
      possess: 0.95, monitor: 0.55, crave: 0.45, share: 0.10,
      libido: 0.10, curiosity: 0.20, boredom: 0.10, social: 0.20,
      duty: 0.20, reflection: 0.10, grieve: 0.05, anger: 0.02,
    },
  };
}

/* 让 12 维信封「愤怒/委屈主导且负向偏高」的样例 */
function angerEnvelope() {
  return {
    state_vector: {
      anger: 0.90, grieve: 0.70, possess: 0.10, monitor: 0.10, crave: 0.10,
      share: 0.10, libido: 0.10, curiosity: 0.10, boredom: 0.10, social: 0.10,
      duty: 0.10, reflection: 0.10,
    },
  };
}

/* 全部维度齐平的「中性」信封：任何偏置阈值都不应被触发 */
function neutralEnvelope() {
  const v = {};
  for (const k of ["possess", "monitor", "crave", "share", "libido", "curiosity",
    "boredom", "social", "duty", "reflection", "grieve", "anger"]) v[k] = 0.20;
  return { state_vector: v };
}

test("③ normalizeProfile：12 维信封 → MindProfile 形状正确（§8）", async () => {
  const McpClient = await getMcpClient();
  const mp = new McpClient().normalizeProfile(possessEnvelope());
  assert.ok(mp, "信封有效应产出 MindProfile");
  assert.strictEqual(mp.dominant, "possess");
  assert.ok(mp.dominantValue > 0.9, "dominantValue 应 ≈ 最高维值");
  assert.strictEqual(mp.top.length, 3, "top 应为最强 3 维");
  assert.strictEqual(mp.top[0].key, "possess");
  assert.strictEqual(mp.top[0].label, "想她占有");
  // 派生信号（与 §8 公式一致）
  assert.ok(Math.abs(mp.possessive - (0.95 + 0.55 + 0.45) / 3) < 1e-9, "possessive 公式");
  assert.ok(mp.possessive > 0.5, "本例 possessive 应 > 0.5");
  assert.ok(Math.abs(mp.negative - (0.02 + 0.05) / 2) < 1e-9, "negative 公式");
  assert.ok(mp.negative < 0.5, "本例 negative 应 < 0.5");
  assert.ok(Math.abs(mp.arousal - (0.10 + 0.45 + 0.20) / 3) < 1e-9, "arousal 公式");
  assert.ok(mp.coherence >= 0 && mp.coherence <= 1, "coherence ∈ [0,1]");
  // 缺失维度补齐到 BASELINE(0.20)
  const mp2 = new McpClient().normalizeProfile({ state_vector: { possess: 1 } });
  assert.strictEqual(mp2.libido, 0.20, "缺失维度补齐到 0.20");
  assert.strictEqual(mp2.dominant, "possess");
  // 信封无效 → null（不抛错）
  assert.strictEqual(new McpClient().normalizeProfile(null), null);
  assert.strictEqual(new McpClient().normalizeProfile({}), null);
});

test("③ dominant=possess & possessive>0.5 → reply 更黏人（与基线可区分）", async () => {
  const McpClient = await getMcpClient();
  const mp = new McpClient().normalizeProfile(possessEnvelope());
  assert.strictEqual(mp.dominant, "possess");
  assert.ok(mp.possessive > 0.5);

  const sBase = H.freshState(); sBase.rng = H.makeRng(123);
  const sMp = H.freshState(); sMp.rng = H.makeRng(123); sMp.mindProfile = mp;

  const rBase = E.reply(CHAT_INPUT, sBase);
  const rMp = E.reply(CHAT_INPUT, sMp);

  const clingySuffixes = E.MOODS[3].suffix;
  const endsWithClingy = (r) => r.replies.some((rep) => clingySuffixes.some((s) => String(rep).endsWith(s)));

  assert.ok(endsWithClingy(rMp), "mp 回复应带黏人后缀: " + JSON.stringify(rMp.replies));
  assert.ok(!endsWithClingy(rBase), "基线回复不应带黏人后缀: " + JSON.stringify(rBase.replies));
  assert.notDeepStrictEqual(rBase.replies, rMp.replies, "mp 与基线回复应可区分");
});

test("③ dominant=anger & negative>0.5 → NEG 给台阶更早触发（更短 streak）", async () => {
  const McpClient = await getMcpClient();
  const mp = new McpClient().normalizeProfile(angerEnvelope());
  assert.strictEqual(mp.dominant, "anger");
  assert.ok(mp.negative > 0.5);

  const now = Date.now();
  const today = E.dayKey(new Date(now));
  const mk = (streak, withMp) => {
    const s = H.freshState({
      affection: 100,
      firstMeet: now - 30 * 86400000,   // 关系已建立，过冷启动
      intensity: "real",                // G1 real 档：dayMax=2 / streakMax=2
    });
    s.rng = H.makeRng(1);
    s.negGate = { date: today, count: 0, streak, lastByFamily: {} };
    if (withMp) s.mindProfile = mp;
    return s;
  };

  // streak=1：基线（mp=null）G1 仍放行（streak 1 < streakMax 2）；
  // mp 负向偏高把 streakMax 收紧到 1 → 拦截 → 给台阶（更早）
  const sBase = mk(1, false);
  const sMp = mk(1, true);
  const allowBase = E.negAllow(sBase, "anger", { now, lv: 6 });
  const allowMp = E.negAllow(sMp, "anger", { now, lv: 6, mindProfile: mp });
  assert.strictEqual(allowBase, true, "基线在 streak=1 应仍放行（未到上限）");
  assert.strictEqual(allowMp, false, "mp 负向偏高应在更短 streak 拦截并给台阶");

  // 集成：reply 在 streak=1 时，mp 输出 NEG_REPAIR（给台阶），基线不输出
  const rBase = E.reply("你给我滚", sBase);
  const rMp = E.reply("你给我滚", sMp);
  const hasRepair = (r) => r.replies.some((rep) => E.NEG_REPAIR.includes(rep));
  assert.ok(hasRepair(rMp), "mp 应在 streak=1 输出修复态（给台阶）: " + JSON.stringify(rMp.replies));
  assert.ok(!hasRepair(rBase), "基线在 streak=1 不应给台阶: " + JSON.stringify(rBase.replies));
});

test("③ mp=null / 中性画像 → 回复与基线逐字节一致（回归护栏 §11）", async () => {
  const McpClient = await getMcpClient();
  const mpNeutral = new McpClient().normalizeProfile(neutralEnvelope());
  assert.ok(mpNeutral.possessive <= 0.5 && mpNeutral.negative <= 0.5, "中性画像不应触发任何偏置");

  const inputs = ["在干嘛呀", "我好累啊", "今天天气不错", "你最喜欢什么颜色", "哈哈哈哈", "晚安"];
  for (const txt of inputs) {
    const sNull = H.freshState(); sNull.rng = H.makeRng(99);
    const sNeutral = H.freshState(); sNeutral.rng = H.makeRng(99); sNeutral.mindProfile = mpNeutral;
    const rNull = E.reply(txt, sNull);
    const rNeutral = E.reply(txt, sNeutral);
    assert.deepStrictEqual(rNull.replies, rNeutral.replies, "输入「" + txt + "」中性画像应逐字节一致");
    assert.strictEqual(rNull.delta, rNeutral.delta, "delta 应一致");
    assert.strictEqual(rNull.intent, rNeutral.intent, "intent 应一致");
    assert.strictEqual(rNull.intentEx, rNeutral.intentEx, "intentEx 应一致");
  }
});
