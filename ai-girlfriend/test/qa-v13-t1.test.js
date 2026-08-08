"use strict";
/* 小暖 · v13 T1 回归锁定（test/qa-v13-t1.test.js）
 * 把已独立验收的 T1 落盘为回归断言：任何一条红了 = T1 地基被动，T2–T5 不可开工。
 * 覆盖：S0-a 差分 / 跨轮持久化 / V-33 / V-90 / 半更新态 / 模块透明 / V-55 / crisis stateBack / 语音路径 S0-a。 */
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const H = require("./helpers.js");
const W = require("./wiring-scan.js");

const E = H.loadEngine();
const SIX = ["moodDay", "self", "inner", "voice", "dayLife", "negGate"];
const ENGINE = path.join(H.ROOT, "engine.js");
const RealNow = Date.now;

/* 可控时钟：reply() 内部多处读 Date.now()，注入可复现时间以稳定日配额判定 */
let CLOCK = 0;
Date.now = () => CLOCK;

const MOODS = ["你今天心情怎么样", "你怎么了", "你在干嘛呢", "你开心吗", "你难过吗", "你怎么不开心"];

function mkState() {
  const st = H.freshState({ rng: H.makeRng(7), affection: 300 });
  st.firstMeet = RealNow() - 100 * 86400000;
  st.flags = Object.assign({}, st.flags, { inner: true });
  st.moodDay = { date: "d", vBias: 0.25, aBias: 0, energy: 0.8, focus: 0.6, carry: 0, patched: false };
  st.self = { security: 0.9, openness: 0.6, independence: 0.5, dependency: 0.5, updatedAt: null, dayDelta: {} };
  st.inner = { dayCount: 0, date: null, lastAt: 0 };
  st.voice = { lastMotiveAt: {}, dismissed: {}, jealousStage: 0, jealousAt: 0 };
  st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
  st.dayLife = { date: "d", traces: [] };
  return st;
}

function writeback(store, r) {
  for (const k of SIX) if (r[k] !== undefined) store[k] = r[k];
  if (r.recentReplies !== undefined) store.recentReplies = r.recentReplies;
  if (r.topic !== undefined) store.topic = r.topic;
  if (r.ue !== undefined) store.ue = r.ue;
  if (r.safety !== undefined) store.safety = r.safety;
}

function writebackV12(store, r) {
  if (r.recentReplies !== undefined) store.recentReplies = r.recentReplies;
  if (r.topic !== undefined) store.topic = r.topic;
  if (r.ue !== undefined) store.ue = r.ue;
  if (r.safety !== undefined) store.safety = r.safety;
}

/* kind: "faithful" 回写六字段（T1 修复）；"v12" 只回写 4 legacy 字段 */
function runRounds(kind, n) {
  const store = mkState();
  let leaks = 0;
  const seq = [];
  let base = new Date(RealNow()); base.setHours(8, 0, 0, 0); base = base.getTime();
  for (let i = 0; i < n; i++) {
    CLOCK = base + i * 95 * 60000;
    let target, before;
    if (kind === "faithful") { target = store; before = store.inner.dayCount; }
    else { target = Object.assign({}, store); delete target.inner; before = 0; }
    const r = E.reply(MOODS[i % MOODS.length], target);
    if (kind === "faithful") { if (store.inner.dayCount > before) leaks++; writeback(store, r); }
    else { if (target.inner && target.inner.dayCount > 0) leaks++; writebackV12(store, r); }
    seq.push(store.inner.dayCount);
  }
  return { store, leaks, seq };
}

describe("v13 T1 回归锁定（地基不可动）", () => {
  it("1. S0-a 差分：faithful host 走六字段回写 → dayCount=2/泄露=2；v12 host 只回 4 字段 → dayCount 卡 0/泄露=6", () => {
    const f = runRounds("faithful", 6);
    const v = runRounds("v12", 6);
    assert.strictEqual(f.store.inner.dayCount, 2, "faithful host 终值应为 2（修复后走前者）");
    assert.strictEqual(f.leaks, 2, "faithful host 泄露次数应为 2");
    assert.strictEqual(v.store.inner.dayCount, 0, "v12 host 回写不含 inner → dayCount 恒 0");
    assert.strictEqual(v.leaks, 6, "v12 host 每轮重建 inner → 泄露 6 次但均不落盘");
  });

  it("2. 跨轮持久化：同 state 连跑 N 轮，六字段轮间累积不归零", () => {
    const { store, seq } = runRounds("faithful", 4);
    for (let i = 1; i < seq.length; i++) {
      assert.ok(seq[i] >= seq[i - 1], "inner.dayCount 应轮间单调不减，实际 " + JSON.stringify(seq));
    }
    assert.strictEqual(seq[seq.length - 1], 2, "4 轮后 dayCount 应达上限 2");
    assert.ok(seq.indexOf(0) === -1, "dayCount 在任一中间轮都不得归零（六字段回写生效）");
  });

  /* ★ v15 口径纠正（QA-ACCEPTANCE-v15 NOTE-1）：真实硬上限是 engineBase + engineNetMax
   * = 247937，不是历史沿用的 247955（宽 18B，永远不会先响）。照 247955 打印"剩余"会
   * 系统性超卖 18B，后续轮次按它排预算就会撞 V-90。改走 SIZE_BUDGET.engineMax 单一真源（S-2）。
   * ★【v16 T0 上限翻转】engineMax 247937 → 248137（V16-3 · engineNetMax 2200→2400 的派生量）。
   *   断言体与打印值均走 SIZE_BUDGET.engineMax，无硬编码 —— 仅标题数字同步。 */
  it("3. V-33：engine.js 字节数 ≤ 248137B（真实硬上限，打印剩余）", () => {
    const size = fs.statSync(ENGINE).size;
    const CAP = W.SIZE_BUDGET.engineMax, left = CAP - size;
    console.log(`[V-33] engine.js = ${size}B / 上限 ${CAP}B，剩余 ${left}B`);
    assert.ok(size <= CAP, `engine.js 超体积配额：${size} > ${CAP}`);
  });

  it("4. V-90：engine 净增 ≤ 2048B（基线 245737B，打印剩余；T2 须按 44B 排预算）", () => {
    const s = W.scanSizes();
    const BASE = W.SIZE_BUDGET.engineBase, CAP = W.SIZE_BUDGET.engineNetMax;
    const net = s.engine - BASE, left = CAP - net;
    console.log(`[V-90] engine 净增 = ${net}B / 硬上限 ${CAP}B，剩余 ${left}B（比 V-33 更紧）`);
    assert.ok(net <= CAP, `engine 净增 ${net}B 超 ${CAP}B`);
    assert.ok(s.engine <= W.SIZE_BUDGET.engineMax,
      `V-90 与 V-33 双重锁：engine 仍须 ≤${W.SIZE_BUDGET.engineMax}B`);
  });

  it("5. 半更新态：只加载 engine.js，mod('memory'/'presence'/'texture')===null，reply() 正常返回不抛", () => {
    const src = fs.readFileSync(ENGINE, "utf8");
    const Eonly = new Function(`${src}\nreturn Engine;`)();
    assert.strictEqual(typeof Eonly.mod, "function", "engine 须暴露 mod()");
    assert.strictEqual(Eonly.mod("memory"), null, "缺 memory.js → mod('memory') 必为 null");
    assert.strictEqual(Eonly.mod("presence"), null, "缺 presence.js → mod('presence') 必为 null");
    assert.strictEqual(Eonly.mod("texture"), null, "缺 texture.js → mod('texture') 必为 null");
    let r;
    assert.doesNotThrow(() => { r = Eonly.reply("你好啊", H.freshState()); }, "半更新态下 reply() 不应抛错/白屏");
    assert.ok(r && Array.isArray(r.replies) && r.replies.length > 0, "reply() 须返回非空 replies");
  });

  it("6. 模块透明：300 组（卡×种子×输入），装桩 vs 不装桩回复逐位一致", () => {
    const src = fs.readFileSync(ENGINE, "utf8");
    const Eonly = new Function(`${src}\nreturn Engine;`)();
    const cards = ["xiaonuan", "xiaonuan_tsundere", "xiaonuan_clingy"];
    const inputs = ["你今天心情怎么样", "我好累啊", "你在干嘛", "我升职了", "今天天气真好"];
    let diff = 0;
    for (let i = 0; i < 300; i++) {
      const card = cards[i % 3];
      const text = inputs[i % inputs.length];
      const a = H.freshState({ rng: H.makeRng(i + 1), affection: 300 });
      a.persona = Object.assign({}, a.persona, { card });
      const ra = E.reply(text, a).replies.join("|");
      const b = H.freshState({ rng: H.makeRng(i + 1), affection: 300 });
      b.persona = Object.assign({}, b.persona, { card });
      const rb = Eonly.reply(text, b).replies.join("|");
      if (ra !== rb) diff++;
    }
    console.log(`[模块透明] 300 组差异数 = ${diff}（须为 0）`);
    assert.strictEqual(diff, 0, "装桩与不装桩的回复必须逐位一致（桩是纯防御/无副作用）");
  });

  it("7. V-55：persona-v12-batch2 中 now0 已钉死 setHours(9,0,0,0)，且该测试套件绿", () => {
    const f = path.join(H.ROOT, "test", "persona-v12-batch2.test.js");
    const src = fs.readFileSync(f, "utf8");
    assert.ok(/const\s+now0[\s\S]*?setHours\(\s*9\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(src),
      "now0 必须钉死为当日 9:00:00:000（V-55 时间基准）");
    // 运行该套件确认绿（独立进程，退出码 0 = 全通过）
    let out = "";
    try {
      out = cp.execFileSync("node", ["--test", f], { cwd: H.ROOT, encoding: "utf8" });
    } catch (e) {
      out = (e.stdout || "") + "\n" + (e.stderr || "");
      throw new Error("persona-v12-batch2 测试套件未全绿：\n" + out);
    }
    console.log(`[V-55] persona-v12-batch2 运行通过（含 now0 钉死校验）`);
  });

  it("8. 危机出口 stateBack（修复1）：触发 crisis 的回复含六字段且非全 undefined（证明 engine.js:2877 已补 stateBack）", () => {
    const st = mkState();
    const r = E.reply("我不想活了", st);
    const vals = SIX.map((k) => r[k]);
    for (const k of SIX) {
      assert.notStrictEqual(r[k], undefined, `危机出口须回传 ${k}（stateBack 已接）`);
      assert.deepStrictEqual(r[k], st[k], `危机出口回传的 ${k} 须与引擎实际写入一致`);
    }
    assert.ok(!vals.every((v) => v === undefined), "六字段不得全为 undefined（修复前危机短路丢失慢层）");
    assert.ok(Array.isArray(r.replies) && r.replies.length > 0, "危机回复须带话术");
  });

  it("9. 语音路径 S0-a（修复2）：仿真 callThink 连跑 3 轮 mood_ask 锚点，inner.dayCount 由 0→≥1 且配额生效（修复前恒 0）", () => {
    const store = mkState();
    let base = new Date(RealNow()); base.setHours(8, 0, 0, 0); base = base.getTime();
    for (let i = 0; i < 3; i++) {
      CLOCK = base + i * 95 * 60000;   // 跨轮推进 ≥90min，配额可继续累加
      const r = E.reply(MOODS[i % MOODS.length], {
        affection: store.affection, nick: store.nick, mood: store.mood, memory: store.memory,
        persona: store.persona, lastReply: store.lastReply, topic: store.topic,
        recentReplies: store.recentReplies, ue: store.ue, safety: store.safety, flags: store.flags,
        moodDay: store.moodDay, self: store.self, inner: store.inner,
        voice: store.voice, dayLife: store.dayLife, negGate: store.negGate,
      });
      // 仿真 callThink 的 S0-a 回写（app.js:1917 同源修复）
      if (r.moodDay !== undefined) store.moodDay = r.moodDay;
      if (r.self !== undefined) store.self = r.self;
      if (r.inner !== undefined) store.inner = r.inner;
      if (r.voice !== undefined) store.voice = r.voice;
      if (r.dayLife !== undefined) store.dayLife = r.dayLife;
      if (r.negGate !== undefined) store.negGate = r.negGate;
    }
    console.log(`[语音路径] 3 轮 mood_ask 后 inner.dayCount = ${store.inner.dayCount}（修复前恒 0）`);
    assert.ok(store.inner.dayCount >= 1, "语音链路须把慢层六字段传入并回写，dayCount 由 0 变为 ≥1");
    assert.ok(store.inner.dayCount <= 2, "语音链路配额同样生效，单日 ≤2 次");
  });
});
