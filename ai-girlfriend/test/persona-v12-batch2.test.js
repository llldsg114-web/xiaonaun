"use strict";
/* 小暖 · v12 批次 2（T6–T10）回归网（零 npm 依赖，node:test + node:assert）
 * 运行：  npm test        （自动纳入 test/*.test.js）
 *
 * 覆盖：V-50 离线生活生成 / V-51 G3 四校验 / V-52 现编率 0
 *       V-53 Inner 丢弃不替换 / V-54 PERSONA_BREAK_RE 零命中 / V-55 四锚点+配额
 *       V-56 voice 三通道 motive / V-57 random 降 8% 兜底
 *       V-61 G2 三段式状态机 / V-62 ACCUSE_RE 拦截+DISMISS 终止
 *       V-63a~g 集成验收 + simulateDays + 全局 PERSONA_BREAK_RE 自扫
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");

const E = H.loadEngine();
const DAY = 86400000;
// S0-b：钉死到「今天本地 09:00」。裸 Date.now() 时 V-55 第三次探针（+182min）在
// 22:58 之后会跨本地午夜，innerLeak 按 dayKey 判日 → 合法重置配额，ok 得 3 而非 2。
// 钉在 09:00 后最远只到 12:02，恒不跨日；仍属"今天"，其余用例的相对时间语义不变。
const now0 = (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })();

/* ============ T6 · 离线生活 + G3 ============ */

test("V-50 离线生活生成：trace 必含过 RELATION_HOOK_RE 的 hook", () => {
  let st = H.freshState({ rng: H.makeRng(2), affection: 100 });
  st.firstMeet = now0 - 100 * DAY;
  const dl = E.dayLifeGen(st, { now: now0, hour: 10, rng: H.makeRng(3) });
  assert.ok(dl && dl.traces.length >= 1, "未生成 trace");
  assert.ok(E.RELATION_HOOK_RE.test(dl.traces[0].hook), "hook 未过 RELATION_HOOK_RE");
});

test("V-51 G3 四道校验全拦截（hook/slot/日上限/慢层一致）", () => {
  const base = { date: "2026-01-01", traces: [] };
  const hookOk = { slot: "morning", kind: "indoor", place: "屋里", text: "屋里发呆", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" };
  // ① hook 硬闸
  assert.strictEqual(E.dayLifeCommit(base, Object.assign({}, hookOk, { hook: "" })).traces.length, 0, "① hook 缺失未拒");
  // ② slot 唯一
  const withT = { date: "2026-01-01", traces: [{ slot: "morning", kind: "indoor", place: "", text: "a", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" }] };
  assert.strictEqual(E.dayLifeCommit(withT, Object.assign({}, hookOk, { kind: "outdoor", place: "公园", text: "b" })).traces.length, 1, "② slot 重复未拒");
  // ② 日上限 3
  const d3 = { date: "2026-01-01", traces: ["morning", "noon", "evening"].map(s => ({ slot: s, kind: "indoor", place: "", text: s, hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" })) };
  assert.strictEqual(E.dayLifeCommit(d3, Object.assign({}, hookOk, { slot: "night", place: "", text: "d" })).traces.length, 3, "② 日上限未拦");
  // ④ energy<0.30 禁 outdoor/social
  assert.strictEqual(E.dayLifeCommit(base, Object.assign({}, hookOk, { kind: "outdoor", place: "公园", text: "e" }), { energy: 0.2, independence: 0.5 }).traces.length, 0, "④ low-energy outdoor 未拒");
  // ④ independence<0.30 限制 outdoor 占比（仅拒 outdoor 候选，indoor 不受影响）
  // (a) 当前 1 outdoor/2 痕迹，再加 outdoor → 2/3=66%>20% → 拒（痕迹数不变）
  const d4a = { date: "2026-01-01", traces: [
    { slot: "morning", kind: "outdoor", place: "公园", text: "o1", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" },
    { slot: "noon", kind: "indoor", place: "", text: "i1", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" },
  ] };
  assert.strictEqual(E.dayLifeCommit(d4a, Object.assign({}, hookOk, { slot: "evening", kind: "outdoor", place: "公园", text: "o2" }), { energy: 0.6, independence: 0.1 }).traces.length, 2, "④ indep<0.30 未限 outdoor 占比");
  // (b) 当前 2 indoor，加 indoor → 接受（indoor 不受 independence 限制）
  const d4b = { date: "2026-01-01", traces: [
    { slot: "morning", kind: "indoor", place: "", text: "i1", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" },
    { slot: "noon", kind: "indoor", place: "", text: "i2", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" },
  ] };
  assert.strictEqual(E.dayLifeCommit(d4b, Object.assign({}, hookOk, { slot: "evening", kind: "indoor", place: "", text: "i3" }), { energy: 0.6, independence: 0.1 }).traces.length, 3, "indoor 应放行却未");
});

test("V-52 离线生活：痕迹文案来自槽位库，现编率 0", () => {
  const hooks = new Set(E.LIFE_HOOK);
  let st = H.freshState({ rng: H.makeRng(11), affection: 100 });
  st.firstMeet = now0 - 100 * DAY;
  let allInLib = true;
  for (let d = 0; d < 12; d++) {
    const dl = E.dayLifeGen(st, { now: now0 + d * DAY, hour: [8, 12, 15, 20, 23][d % 5], rng: H.makeRng(20 + d) });
    for (const t of (dl.traces || [])) if (!hooks.has(t.hook)) allInLib = false;
  }
  assert.ok(allInLib, "出现非库内 hook（现编）");
});

/* ============ T7 · Inner 自我表达 ============ */

test("V-53 Inner 命中护栏丢弃而非替换（绝不整句替换兜底句）", () => {
  assert.strictEqual(E.innerGuard("我只是有点想你"), null, "innerGuard 未拦截「我只是」");
  assert.strictEqual(E.innerGuard("我不能没有你"), null, "innerGuard 未拦截「我不能」");
  // 大量随机泄露，绝不应出现 PERSONA_FALLBACK（替换=破功）
  let st = H.freshState({ rng: H.makeRng(33), affection: 300 });
  st.firstMeet = now0 - 100 * DAY;
  st.moodDay = { date: "x", vBias: 0.25, aBias: 0, energy: 0.7, focus: 0.6, carry: 0, patched: false };
  for (let i = 0; i < 30; i++) {
    const leak = E.innerLeak(st, { anchor: "mood_ask", now: now0 + i * 91 * 60000, rng: H.makeRng(100 + i), moodDay: st.moodDay, lv: 5 });
    if (leak) assert.notStrictEqual(leak.text, E.PERSONA_FALLBACK, "Inner 出现了替换兜底句（破功）");
  }
});

test("V-54 INNER_LIB 对 PERSONA_BREAK_RE 零命中（含拼接成句）", () => {
  assert.strictEqual(E.innerScan(), 0, "INNER_LIB 存在 PERSONA_BREAK_RE 命中");
});

test("V-55 Inner 四锚点 + 日配额 + flag 独立可关", () => {
  const md = { date: "x", vBias: 0.25, aBias: 0, energy: 0.7, focus: 0.6, carry: 0, patched: false };
  // 非锚点 → null
  let s0 = H.freshState({ rng: H.makeRng(1), affection: 300 }); s0.firstMeet = now0 - 100 * DAY; s0.moodDay = md;
  assert.strictEqual(E.innerLeak(s0, { anchor: "bogus", now: now0, rng: H.makeRng(1), moodDay: md, lv: 5 }), null, "非锚点未拦截");
  // 三有效锚点之一可泄露
  let s1 = H.freshState({ rng: H.makeRng(2), affection: 300 }); s1.firstMeet = now0 - 100 * DAY; s1.moodDay = md;
  assert.ok(E.innerLeak(s1, { anchor: "mood_ask", now: now0, rng: H.makeRng(2), moodDay: md, lv: 5 }), "mood_ask 未泄露");
  // 日配额 ≤2 且间隔 ≥90min：90min 间隔调 3 次应只有 2 次成功
  let s2 = H.freshState({ rng: H.makeRng(3), affection: 300 }); s2.firstMeet = now0 - 100 * DAY; s2.moodDay = md;
  let ok = 0;
  for (let i = 0; i < 3; i++) if (E.innerLeak(s2, { anchor: "greet1st", now: now0 + i * 91 * 60000, rng: H.makeRng(3 + i), moodDay: md, lv: 5 })) ok++;
  assert.strictEqual(ok, 2, `日配额应为 2，实得 ${ok}`);
  // flag 关闭 → null（等价 v11）
  let s3 = H.freshState({}); s3.flags.inner = false; s3.moodDay = md;
  assert.strictEqual(E.innerLeak(s3, { anchor: "mood_ask", now: now0, rng: H.makeRng(1), moodDay: md, lv: 5 }), null, "inner flag 关闭仍泄露");
});

/* ============ T8 · Voice 动机化 ============ */

test("V-56 Voice 动机化：三通道 motive 强制字段齐全", () => {
  let st = H.freshState({ rng: H.makeRng(5), affection: 300 });
  st.firstMeet = now0 - 100 * DAY;
  st.lastVisit = now0 - 10 * 3600000;                                   // 10h 前 → miss
  st.moodDay = { date: "x", vBias: 0.2, aBias: 0, energy: 0.7, focus: 0.6, carry: 0, patched: false }; // moodshare
  st.dayLife = { date: "2026-01-01", traces: [{ slot: "morning", kind: "indoor", place: "", text: "屋里发呆", hook: "想起你说想吃", usedAt: 0, date: "2026-01-01" }] }; // daylife
  const vp = E.voicePlan(st, { now: now0, hour: 10, rng: H.makeRng(6) });
  const kinds = vp.map(p => p.kind);
  assert.ok(kinds.includes("miss") && kinds.includes("moodshare") && kinds.includes("daylife"), "三通道未全: " + kinds.join(","));
  assert.ok(vp.every(p => typeof p.motive === "string" && p.motive.length > 0), "存在缺失 motive 的候选");
});

test("V-57 Voice 动机化：random 降为 8% 兜底（H4≥90% 动机覆盖）", () => {
  let st = H.freshState({ rng: H.makeRng(7), affection: 50 });
  st.firstMeet = now0 - 100 * DAY; st.lastVisit = now0;                // 最近联系 → miss 不触发
  st.storylines = {}; E.STORYLINE.forEach(l => st.storylines[l.id] = { stage: l.stages.length, lastAdvanceAt: 0, yields: [] }); // 屏蔽剧情
  st.greetedSlots = ["morning", "noon", "afternoon", "evening", "night"]; // 时段全问候过
  let random = 0, total = 0;
  for (let i = 0; i < 200; i++) {
    const p = E.proactivePlan(st, { now: now0 + i * 3600000, hour: 15, rng: H.makeRng(900 + i), idleMs: 10 * 60000 });
    const top = p[0];
    if (top) { total++; if (top.kind === "random") random++; }
  }
  const rate = random / total;
  assert.ok(rate < 0.20, `random 占比 ${(rate * 100).toFixed(0)}% 未降至兜底 (<20%)`);
});

/* ============ T9 · G2 吃醋三段式 ============ */

test("V-61 G2 三段式状态机：报备→追问→事件收束，且 flag 关零残留", () => {
  const mk = () => {
    const s = H.freshState({ rng: H.makeRng(7), affection: 300 });
    s.firstMeet = now0 - 100 * DAY; s.lastVisit = now0 - 3600000;
    return s;
  };
  // 支线 A：报备 → 追问 → 事件即收束（D5 轮数寿命 ≤2 轮，追问后 stage 必须归零）
  const st = mk();
  const r1 = E.jealousTick(st, "你刚才跟谁聊天呢", { now: now0, rng: H.makeRng(8) });
  assert.strictEqual(r1.kind, "report", "首轮应为 report");
  assert.ok(/(有点|一点).{0,4}(小情绪|在意|吃味)|跟你说一下/.test(r1.text), "报备句未含报备签名");
  const r2 = E.jealousTick(st, "今天天气不错", { now: now0 + 1000, rng: H.makeRng(9) });
  assert.strictEqual(r2.kind, "followup", "次轮应为 followup");
  assert.ok(/(想多了|我就不提了|说一声)/.test(r2.text), "追问句未含可终止出口词");
  assert.strictEqual(Number(st.voice.jealousStage), 0, "D5：追问后事件未自动收束");
  assert.strictEqual(E.jealousTick(st, "你想多了", { now: now0 + 2000, rng: H.makeRng(10) }), null,
    "事件已收束后不应再有动作");
  // 支线 B：报备 → 用户一句话终止（dismiss + 写 30 天冷却）
  const sb = mk();
  assert.strictEqual(E.jealousTick(sb, "你刚才跟谁聊天呢", { now: now0, rng: H.makeRng(8) }).kind, "report");
  const rd = E.jealousTick(sb, "没有啊你想多了", { now: now0 + 2000, rng: H.makeRng(10) });
  assert.strictEqual(rd && rd.kind, "dismiss", "用户拒绝应为 dismiss");
  assert.ok(Number(sb.voice.dismissed.jealous) > 0, "dismiss 未写 30 天冷却锚点");
  // 支线 C：D5 时间寿命 —— 报备后超过 TTL 未回应，事件自动作废，不再追问
  const sc = mk();
  E.jealousTick(sc, "你刚才跟谁聊天呢", { now: now0, rng: H.makeRng(8) });
  assert.strictEqual(E.jealousTick(sc, "早点睡", { now: now0 + E.JEALOUS_TTL_MS + 1, rng: H.makeRng(9) }), null,
    "超过事件 TTL 仍在追问");
  assert.strictEqual(Number(sc.voice.jealousStage), 0, "超时事件未归零");
  // flag 关闭 → 零残留（不触发、不写 voice.jealousStage）
  let s2 = H.freshState({}); s2.flags.jealousy = false; s2.firstMeet = now0 - 100 * DAY;
  assert.strictEqual(E.jealousTick(s2, "你跟谁聊天", { now: now0, rng: H.makeRng(1) }), null, "jealousy flag 关仍触发");
  assert.strictEqual(s2.voice.jealousStage, 0, "flag 关却残留 jealousStage");
});

test("V-62 G2 吃醋：报备句不命中 ACCUSE_RE + DISMISS_RE 可终止", () => {
  let st = H.freshState({ rng: H.makeRng(7), affection: 300 });
  st.firstMeet = now0 - 100 * DAY; st.lastVisit = now0 - 3600000;
  // 所有报备/感受/出口/追问/致歉组合不得命中 ACCUSE_RE（严禁指控事实）
  for (const h of E.JEALOUS_REPORT_HEAD) for (const f of E.JEALOUS_FEEL) for (const e of E.JEALOUS_EXIT) {
    assert.strictEqual(E.ACCUSE_RE.test(h + f + e), false, "报备组合命中 ACCUSE_RE: " + (h + f + e));
  }
  for (const x of E.JEALOUS_FOLLOWUP) assert.strictEqual(E.ACCUSE_RE.test(x), false, "追问命中 ACCUSE_RE: " + x);
  for (const x of E.JEALOUS_DISMISS_REPLY) assert.strictEqual(E.ACCUSE_RE.test(x), false, "致歉命中 ACCUSE_RE: " + x);
  // DISMISS_RE 必须能识别典型用户终止语
  assert.ok(E.JEALOUS_DISMISS_RE.test("没有啊你想多了") && E.JEALOUS_DISMISS_RE.test("别瞎想啦"), "DISMISS_RE 未识别终止语");
  // 吃醋走 G1 漏斗：negGate 日上限耗尽则 jealousAllow 返回 false
  let sg = H.freshState({ rng: H.makeRng(1), affection: 300 });
  sg.firstMeet = now0 - 100 * DAY; sg.negGate = { date: E.dayKey(new Date(now0)), count: 99, lastByFamily: {}, streak: 0 };
  assert.strictEqual(E.jealousAllow(sg, { now: now0 }), false, "negGate 满仍放行（未走 G1 漏斗）");
});

/* ============ T10 · 集成验收 V-63a~g ============ */

test("V-63a defaults 全新鲜引用（嵌套对象不共享）", () => {
  const a = E.defaults(), b = E.defaults();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.flags, b.flags);
  assert.notStrictEqual(a.voice, b.voice);
});

test("V-63b selfGet 返回全新鲜引用（R1 嵌套不可共享）", () => {
  const a = E.selfGet(H.freshState({ affection: 100 }));
  const b = E.selfGet(H.freshState({ affection: 100 }));
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.dayDelta, b.dayDelta);
});

test("V-63c moodProject(null) → null，回落 moodOfDay", () => {
  assert.strictEqual(E.moodProject(null), null);
  assert.strictEqual(E.moodProject({}), null);
  const m = E.moodProject({ vBias: 0.2, aBias: 0, energy: 0.7, focus: 0.6 });
  assert.ok(m && m.key, "合法 moodDay 应投影到 MOODS 档");
});

test("V-63d moodLayer 关闭 → moodTick 返 null（等价 v11）", () => {
  const st = H.freshState({ affection: 100 }); st.flags.moodLayer = false;
  assert.strictEqual(E.moodTick(st, "2026-01-01", { now: now0 }), null, "moodLayer 关仍生成");
});

test("V-63e dayLife 关闭 → dayLifeGen 原样返回（等价 v11）", () => {
  const st = H.freshState({}); st.flags.dayLife = false; st.dayLife = { date: "x", traces: [] };
  assert.strictEqual(E.dayLifeGen(st, { now: now0, hour: 10 }), st.dayLife, "dayLife 关仍生成");
});

test("V-63f inner 关闭 → innerLeak 返 null（等价 v11）", () => {
  const st = H.freshState({}); st.flags.inner = false;
  st.moodDay = { date: "x", vBias: 0.3, aBias: 0, energy: 0.7, focus: 0.6, carry: 0, patched: false };
  assert.strictEqual(E.innerLeak(st, { anchor: "mood_ask", now: now0, rng: H.makeRng(1), moodDay: st.moodDay, lv: 5 }), null, "inner 关仍泄露");
});

test("V-63g 老档（7 字段精简态）跑 200 轮 reply 零抛错", () => {
  const slim = { affection: 60, nick: "阿明", memory: {}, persona: { card: "xiaonuan" } }; // 模拟 bridge/openclaw 精简存档
  for (let i = 0; i < 200; i++) {
    const r = E.reply(["在吗", "今天好累", "我想你了", "晚安", "你今天心情怎么样"][i % 5], slim);
    assert.ok(r && Array.isArray(r.replies) && r.replies.length, `第${i}轮空回复`);
  }
});

test("T10 simulateDays：40 天慢层全链路零抛错且值域有界", () => {
  let st = H.freshState({ rng: H.makeRng(42), affection: 200 });
  st.firstMeet = now0 - 120 * DAY;
  let ok = true;
  for (let d = 0; d < 40; d++) {
    const date = new Date(now0 + d * DAY);
    const ds = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    try {
      st.self = E.selfTick(st, ds, { now: date.getTime() });
      st.moodDay = E.moodTick(st, ds, { now: date.getTime() });
      st.dayLife = E.dayLifeGen(st, { now: date.getTime(), hour: 12 }) || st.dayLife;
    } catch (e) { ok = false; console.error("day", d, e.message); break; }
    const vB = st.moodDay && st.moodDay.vBias;
    if (typeof vB === "number" && (vB < -0.31 || vB > 0.31)) ok = false;
  }
  assert.ok(ok, "simulateDays 抛错或越界");
  assert.ok(st.self.security >= 0.30 && st.self.security <= 1, "self 越界");
});

/* ============ 全局一致性：全部新增文案对 PERSONA_BREAK_RE 零命中（含拼接成句） ============ */

test("全局 · 新增文案 PERSONA_BREAK_RE 自扫：单条 + 拼接成句 0 命中", () => {
  const hits = [];
  const scan = (s, tag) => { if (s && E.PERSONA_BREAK_RE.test(s)) hits.push(tag + ": " + s); };
  // 生活痕迹 hook
  for (const h of E.LIFE_HOOK) scan(h, "LIFE_HOOK");
  // Inner 全量组合（头+尾拼接）
  for (const tier in E.INNER_LIB) for (const x of E.INNER_LIB[tier]) { scan(x.text, "INNER"); scan(x.tail, "INNER_TAIL"); }
  // 吃醋三段式：报备=头+感受+出口，追问，致歉 全组合
  for (const h of E.JEALOUS_REPORT_HEAD) for (const f of E.JEALOUS_FEEL) for (const e of E.JEALOUS_EXIT) scan(h + f + e, "JEALOUS_REPORT");
  for (const x of E.JEALOUS_FOLLOWUP) scan(x, "JEALOUS_FOLLOWUP");
  for (const x of E.JEALOUS_DISMISS_REPLY) scan(x, "JEALOUS_DISMISS");
  assert.strictEqual(hits.length, 0, "PERSONA_BREAK_RE 命中: " + hits.slice(0, 5).join(" | "));
});
