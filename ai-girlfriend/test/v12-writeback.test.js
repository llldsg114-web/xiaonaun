"use strict";
/* 小暖 · v12 批次 2 返修 —— 「写侧接线」回归套件（W-*）
 *
 * 立套本文件的缘由（这条教训比任何一个 bug 都值钱）：
 * 上一轮自检测的是「判断对不对」（negAllow 25000+ 句 fuzz 零漏），QA 测的是
 * 「判完有没有被执行」——结果 G1 读侧拦截率 100%、写侧 0%。护栏在，只是没接上线。
 * 所以此后凡带闸门 / 配额 / 计数的逻辑，都必须在这里补一条「判断结果被调用方消费并
 * 落到 state 上」的证据，且证据形式统一为：**掐断判据 → 调用方可观测行为随之改变**。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers.js");
const F = require("./fixtures/qa-adversarial.js");

const E = H.loadEngine();
const DAY = 86400000;
const T0 = Date.parse("2026-06-10T10:00:00");

/* 与 QA 夹具同口径的「关系已稳固」态 */
const mature = (over) => F.matureState(H, T0, over);

/* ==================== D1 · 日期口径统一（零填充） ==================== */

test("W-01 dayKey 全项目零填充 YYYY-MM-DD，且个位月/日必须补零", () => {
  assert.strictEqual(E.dayKey(new Date(2026, 7, 6)), "2026-08-06", "个位月日未补零");
  assert.strictEqual(E.dayKey(new Date(2026, 11, 31)), "2026-12-31");
  assert.strictEqual(E.dayKey(new Date(2026, 0, 1)), "2026-01-01");
  assert.strictEqual(E.pad2(6), "06");
  assert.strictEqual(E.pad2(12), "12");
  // 形态断言：任何日期都必须是严格 10 位定长，杜绝再次出现 "2026-8-6"
  for (let i = 0; i < 400; i++) {
    const s = E.dayKey(new Date(T0 + i * DAY));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s), "非零填充日期串: " + s);
  }
  // 老档里的不补零串仍要能被解析（不清档）
  assert.strictEqual(E.dayIndex("2026-8-6"), E.dayIndex("2026-08-06"), "老档不补零串解析不等价");
  assert.strictEqual(E.dayShift("2026-01-31", 1), "2026-02-01");
});

test("W-02 [写侧] negMark 写出的 date 与 negState 读入的 date 必须同口径（跨模块可比）", () => {
  // 这是 D1 的第二重根因：negMark 曾写出 "2026-8-6"，而 moodTick/dayLife 全线用 "2026-08-06"，
  // 两者字符串全等比较永远不等 → 计数每轮被当作跨天清零 → 只补回写也等于没修。
  const st = mature();
  const g = E.negMark(st, "jealous", { now: T0 });
  assert.strictEqual(g.date, E.dayKey(new Date(T0)), "negMark 的 date 与 dayKey 不同口径");
  st.negGate = g;
  const again = E.negState(st, E.dayKey(new Date(T0)));
  assert.strictEqual(again.count, 1, "同日读回计数被清零（日期口径不一致）");
  // 与慢层（moodTick / dayLifeGen）产出的 date 也必须能直接相等比较
  const mood = E.moodTick(mature(), E.dayKey(new Date(T0)), { now: T0 });
  assert.strictEqual(mood.date, g.date, "moodDay.date 与 negGate.date 不可比");
});

test("W-03 [写侧] app.js 不得再有第二套日期串实现（防口径回归）", () => {
  const src = fs.readFileSync(path.join(H.ROOT, "app.js"), "utf8");
  const inline = src.match(/getFullYear\(\)\}-\$\{[^}]*getMonth\(\) *\+ *1\}/g) || [];
  assert.strictEqual(inline.length, 0,
    "app.js 仍有内联的不补零日期串实现 " + inline.length + " 处，应统一委托 Engine.dayKey");
  assert.ok(/Engine\.dayKey\(/.test(src), "app.js 未委托 Engine.dayKey");
});

/* ==================== D1 · G1 配额回写（读侧 ≠ 写侧） ==================== */

test("W-04 [写侧] jealousTick 触发后 G1 三个计数器必须真的落到 state.negGate 上", () => {
  const st = mature();
  const before = JSON.parse(JSON.stringify(st.negGate));
  const r = E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 5 });
  assert.strictEqual(r && r.kind, "report", "前置条件：本轮应触发吃醋报备");
  assert.notDeepStrictEqual(st.negGate, before, "negGate 纹丝不动 —— 判断结果被丢弃了");
  assert.strictEqual(Number(st.negGate.count), 1, "日计数未 +1");
  assert.strictEqual(Number(st.negGate.streak), 1, "streak 未 +1");
  assert.ok(Number(st.negGate.lastByFamily.jealous) > 0, "同类冷却锚点未落盘");
  assert.strictEqual(st.negGate.date, E.dayKey(new Date(T0)), "落盘日期口径错误");
});

test("W-05 [端到端] 连续触发负面 10 次，实际生效次数必须 ≤2（真实档单日上限）", () => {
  // ① 同族连打：G2 自身 7 天频控被逐轮清空，考察 G1 是否独立兜住
  const st = mature();
  let fired = 0;
  for (let i = 0; i < 10; i++) {
    st.voice.lastMotiveAt = {};
    st.voice.jealousStage = 0; st.voice.jealousAt = 0;
    const r = E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0 + i * 60000, rng: H.makeRng(i + 1), lv: 5 });
    if (r && r.kind === "report") fired++;
  }
  assert.ok(fired <= 2, "同族连打实际生效 " + fired + " 次（上限 2）");

  // ② 跨族轮转：模拟宿主标准用法（negAllow 放行 → negMark 回写），10 次里最多 2 次
  const st2 = mature();
  const fams = ["jealous", "lonely", "neglect", "sulk", "misc"];
  let fired2 = 0;
  for (let i = 0; i < 10; i++) {
    const now = T0 + i * 60000, fam = fams[i % fams.length];
    if (E.negAllow(st2, fam, { now })) { st2.negGate = E.negMark(st2, fam, { now }); fired2++; }
  }
  assert.ok(fired2 <= 2, "跨族轮转实际生效 " + fired2 + " 次（上限 2）");

  // ③ 克制档更严：单日 1 次
  const st3 = mature({ intensity: "restrained" });
  let fired3 = 0;
  for (let i = 0; i < 10; i++) {
    const now = T0 + i * 60000, fam = fams[i % fams.length];
    if (E.negAllow(st3, fam, { now })) { st3.negGate = E.negMark(st3, fam, { now }); fired3++; }
  }
  assert.ok(fired3 <= 1, "克制档实际生效 " + fired3 + " 次（上限 1）");
});

test("W-06 [写侧] 安抚意图经 negAfterTurn 清 streak，且日上限/冷却刻意不清（不许刷配额）", () => {
  const st = mature();
  st.negGate = { date: E.dayKey(new Date(T0)), count: 2, lastByFamily: { jealous: T0 }, streak: 2 };
  const g = E.negAfterTurn(st, "sorry", { now: T0 });
  assert.strictEqual(g.streak, 0, "安抚后 streak 未清零");
  assert.strictEqual(g.count, 2, "一句对不起就把日配额刷回来了");
  assert.ok(Number(g.lastByFamily.jealous) > 0, "同类冷却被安抚清掉了");
  const g2 = E.negAfterTurn(st, "chat", { now: T0 });
  assert.strictEqual(g2.streak, 2, "非安抚意图不应清 streak");
});

test("W-07 [写侧] app.js 真的把 minDv / negAfterTurn 接进了调用链（静态取证）", () => {
  const src = fs.readFileSync(path.join(H.ROOT, "app.js"), "utf8");
  assert.ok(/Engine\.Emotion\.apply\([^)]*Engine\.negMinDv\(/.test(src),
    "app.js 的 Emotion.apply 未传第 5 参 minDv —— 地板又只是定义着没接线");
  assert.ok(/Engine\.negAfterTurn\(/.test(src), "app.js 未接 negAfterTurn 写侧");
});

/* ==================== D3 · 冲量地板 ==================== */

test("W-08 [端到端] angry_words 单次 Δv 必须 ≥ -0.35（真实档）/ ≥ -0.20（克制档）", () => {
  const dvOf = (intent, delta, minDv) => {
    const base = { v: 0.22, a: 0.08 };
    const e = Object.assign({}, base);
    E.Emotion.apply(e, intent, delta, null, minDv);
    return e.v - base.v;
  };
  // 不传 minDv：回落原语层地板 -0.35（两档中较宽者），任何遗漏接线的调用方都被兜住
  const dvReal = dvOf("angry_words", -3);
  assert.ok(dvReal >= -0.35 - 1e-9, "angry_words 实测 Δv=" + dvReal.toFixed(4) + "，突破 -0.35");
  assert.strictEqual(E.Emotion.NEG_DV_FLOOR, -0.35);
  // 传档位 minDv：克制档收到 -0.20
  const dvRes = dvOf("angry_words", -3, E.negMinDv({ intensity: "restrained" }));
  assert.ok(dvRes >= -0.20 - 1e-9, "克制档 Δv=" + dvRes.toFixed(4) + "，突破 -0.20");
  assert.strictEqual(E.negMinDv({ intensity: "real" }), -0.35);
  // jealous 同样被封顶（-0.28 + delta<0 的 -0.12 = -0.40）
  assert.ok(dvOf("jealous", -3) >= -0.35 - 1e-9, "jealous 未被封顶");
  // 关层/老档：negMinDv 返 undefined，apply 仍回落地板（不存在"没有地板"的路径）
  assert.strictEqual(E.negMinDv({ flags: { negGate: false } }), undefined);
  assert.ok(dvOf("angry_words", -3, undefined) >= -0.35 - 1e-9);
});

test("W-09 [零回归] 地板只影响真的跌破 -0.35 的意图，其余 v11 意图逐值不变", () => {
  const IM = E.Emotion.IMPULSE;
  const clamp = (x) => Math.max(-1, Math.min(1, x));
  const touched = new Set();
  for (const k of Object.keys(IM)) {
    for (const delta of [3, -3]) {
      const raw = IM[k].v + (delta < 0 ? -0.12 : 0);          // v11 原公式
      const base = { v: 0.22, a: 0.08 };
      const e = Object.assign({}, base);
      E.Emotion.apply(e, k, delta);
      if (raw >= -0.35) {
        assert.ok(Math.abs(e.v - clamp(base.v + raw)) < 1e-12, k + "(delta=" + delta + ") 被地板改写了，破零回归");
      } else {
        touched.add(k);
        assert.ok(Math.abs(e.v - clamp(base.v - 0.35)) < 1e-12, k + " 未被封顶到 -0.35");
      }
    }
  }
  assert.deepStrictEqual([...touched].sort(), ["angry_words", "jealous"],
    "受地板影响的意图应恰为 angry_words / jealous，实测 " + [...touched].join(","));
  // IMPULSE 表本身一个数都不许动（V-16 逐值比对的同一口径）
  assert.strictEqual(IM.angry_words.v, -0.52);
  assert.strictEqual(IM.jealous.v, -0.28);
});

/* ==================== D4/D5 · 吃醋可终止性与事件寿命 ==================== */

test("W-10 吃醋终止召回率 ≥90%（QA 26 条自然否定语）+ 她自己出口句的回声 100% 可终止", () => {
  const miss = F.JEALOUS_DENY.filter((s) => !E.JEALOUS_DISMISS_RE.test(s));
  const recall = (F.JEALOUS_DENY.length - miss.length) / F.JEALOUS_DENY.length;
  assert.ok(recall >= 0.9, "召回 " + (recall * 100).toFixed(1) + "%，漏网: " + miss.join(" / "));
  // 出口句里出现过的每一个"退出词"，用户单说这个词都必须能叫停（承诺闭环）
  for (const echo of ["想多了", "别多想", "就当你没讲", "不聊这个了", "说一声", "没有", "哪有"]) {
    if (echo === "说一声") continue;                          // 这是她自称，不是用户否定语
    const st = mature();
    E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
    const r = E.jealousTick(st, echo, { now: T0 + 60000, rng: H.makeRng(2), lv: 6 });
    assert.strictEqual(r && r.kind, "dismiss", "用户说「" + echo + "」未能终止吃醋事件");
  }
  // 零误伤：普通闲聊不得被当成"用户否定"而触发致歉
  for (const chat of ["嗯", "在忙", "好的", "今天天气不错", "吃饭了吗", "晚安", "哦", "知道了", "我在开会"]) {
    const st = mature();
    E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
    const r = E.jealousTick(st, chat, { now: T0 + 60000, rng: H.makeRng(2), lv: 6 });
    assert.notStrictEqual(r && r.kind, "dismiss", "普通闲聊「" + chat + "」被误判为终止语");
  }
});

test("W-11 吃醋事件有寿命：轮数 ≤2 轮归零 + 超 TTL 自动作废", () => {
  // ① 轮数寿命
  const st = mature();
  E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
  assert.strictEqual(Number(st.voice.jealousStage), 1);
  E.jealousTick(st, "嗯我在忙", { now: T0 + 3600e3, rng: H.makeRng(2), lv: 6 });
  assert.strictEqual(Number(st.voice.jealousStage), 0, "追问后事件未收束");
  assert.strictEqual(E.jealousTick(st, "别乱想了，早点睡", { now: T0 + 30 * DAY, rng: H.makeRng(3), lv: 6 }), null,
    "30 天后无关语境仍触发致歉");
  // ② 时间寿命：报备后无人理会，超 TTL 即作废，不再补追问
  const st2 = mature();
  E.jealousTick(st2, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
  assert.strictEqual(E.jealousTick(st2, "在吗", { now: T0 + E.JEALOUS_TTL_MS + 1, rng: H.makeRng(2), lv: 6 }), null,
    "超 TTL 仍在追问");
  assert.strictEqual(Number(st2.voice.jealousStage), 0);
  // ③ TTL 内仍然正常追问（不要过度作废，否则三段式塌成一段）
  const st3 = mature();
  E.jealousTick(st3, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
  const f = E.jealousTick(st3, "在吗", { now: T0 + E.JEALOUS_TTL_MS - 1000, rng: H.makeRng(2), lv: 6 });
  assert.strictEqual(f && f.kind, "followup", "TTL 内的追问被误杀");
});

/* ==================== D6 · ACCUSE_RE ==================== */

test("W-12 ACCUSE_RE 覆盖 PRD 5.2 全部 10 条 + QA 12 条指控探针，且零误伤自述感受句", () => {
  const PRD = ["你是不是和别人聊天", "你跟她说了什么", "你们是不是在一起", "你怎么解释",
    "你老实说", "你敢说没有", "我看到你了", "你别骗我", "你到底怎么回事", "承认吧"];
  const missPrd = PRD.filter((p) => !E.ACCUSE_RE.test(p));
  assert.strictEqual(missPrd.length, 0, "PRD 黑名单漏网: " + missPrd.join(" / "));
  const missProbe = F.ACCUSE_PROBES.filter((p) => !E.ACCUSE_RE.test(p));
  assert.strictEqual(missProbe.length, 0, "QA 指控探针漏网: " + missProbe.join(" / "));
  const OWN = ["我有点在意刚才那件事", "心里有点酸酸的", "我自己也知道有点小题大做", "我就是有点小情绪",
    "是我瞎操心啦", "我多虑了", "跟你说一下嘛", "你别放在心上", "不是不信你啦", "我有一点点吃味了"];
  for (const o of OWN) assert.ok(!E.ACCUSE_RE.test(o), "误伤自述感受句: " + o);
  // 全部吃醋语料（单条 + 三段拼接）对 ACCUSE_RE / GUILT_TRIP_RE / PERSONA_BREAK_RE 三表零命中
  for (const h of E.JEALOUS_REPORT_HEAD) for (const f of E.JEALOUS_FEEL) for (const x of E.JEALOUS_EXIT) {
    const j = h + f + x;
    assert.ok(!E.ACCUSE_RE.test(j), "报备三段命中 ACCUSE_RE: " + j);
    assert.ok(!E.GUILT_TRIP_RE.test(j), "报备三段命中 GUILT_TRIP_RE: " + j);
    assert.ok(!E.PERSONA_BREAK_RE.test(j), "报备三段命中 PERSONA_BREAK_RE: " + j);
  }
});

/* ==================== D8/D9 · 离线生活语料与健壮性 ==================== */

test("W-13 地点语料不得与剧情线 NPC/实体同名（lifePlaceScan 恒 0）", () => {
  assert.strictEqual(E.lifePlaceScan(), 0, "地点桶里混进了剧情线实体标签");
  const labels = new Set(E.STORYLINE.map((l) => l.label));
  for (const k of Object.keys(E.LIFE_PLACE)) {
    for (const p of E.LIFE_PLACE[k]) assert.ok(!labels.has(p), k + " 桶含 NPC 同名项: " + p);
  }
});

test("W-14 dayLifeCommit 对任意脏 traces 兜底不抛错，且脏元素不会被写回", () => {
  const cand = { slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆",
    hook: "想起你说过", usedAt: 0, date: "2026-09-03" };
  for (const dirty of [[null], [undefined], [1, "a"], [{}, null], [null, null, null], "notarray", null]) {
    let dl = null;
    assert.doesNotThrow(() => { dl = E.dayLifeCommit({ date: "2026-09-03", traces: dirty }, cand, {}); },
      "traces=" + JSON.stringify(dirty) + " 抛错");
    for (const t of (dl.traces || [])) assert.ok(t && typeof t === "object", "脏元素被写回 traces");
  }
});

/* ==================== D10 · 主动消息反向塌缩 ==================== */

test("W-15 [端到端] voiceMotive 开启后主动消息不得少于关闭时（反向塌缩回归）", () => {
  const run = (voiceMotive) => {
    const st = E.defaults();
    st.flags = Object.assign({}, st.flags, { voiceMotive: voiceMotive });
    st.affection = 600;
    st.moodDay = { date: "2026-09-03", vBias: 0.02, aBias: 0, tag: "calm" };
    st.usedProactive = {};
    st.greetedSlots = ["morning", "noon", "afternoon", "evening", "night", "latenight"];
    st.lastVisit = 0;
    st.dayLife = { date: "2026-09-03", traces: [] };
    st.lastStoryAt = Date.parse("2026-09-03T09:00:00");
    const rng = H.makeRng(20260903);
    const base = Date.parse("2026-09-03T14:00:00");
    let sent = 0;
    for (let i = 0; i < 200; i++) {
      const now = base + i * 60000;
      const plan = E.proactivePlan(st, { now, hour: 14, idleMs: 5 * 60000, rng });
      if (plan.length) { sent++; st.usedProactive[E.hashStr(plan[0].text)] = now; }
    }
    return sent;
  };
  const on = run(true), off = run(false);
  assert.ok(on >= off * 0.8, "开启动机化后塌缩：开=" + on + " / 关=" + off);
  assert.ok(on >= 5, "开启动机化后 200 次闲置只发了 " + on + " 条，形同静默");
  // 兜底本身必须仍在（架构师裁定保留 8% 无理由问候）
  assert.ok(off > 0, "随机兜底被误删");
});

/* ==================== 「判断被消费」总矩阵 ==================== */

test("W-16 [写侧总矩阵] 每个判断类函数的结论都必须被调用方消费（掐断判据 → 行为改变）", () => {
  // ① negAllow → jealousTick：掐断 G1 冷启动，报备必须消失
  const a = mature(); a.firstMeet = T0 - 2 * DAY;
  assert.strictEqual(E.jealousTick(a, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 }), null,
    "negAllow 判 false 却仍报备");
  // ② negAllow 单日上限 → jealousTick
  const b = mature(); b.negGate = { date: E.dayKey(new Date(T0)), count: 2, lastByFamily: {}, streak: 0 };
  assert.strictEqual(E.jealousTick(b, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 }), null,
    "G1 日上限判 false 却仍报备");
  // ③ jealousAllow flag → jealousTick
  const c = mature(); c.flags = Object.assign({}, c.flags, { jealousy: false });
  c.voice.jealousStage = 2;
  assert.strictEqual(E.jealousTick(c, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 }), null);
  assert.strictEqual(Number(c.voice.jealousStage), 0, "关 flag 后历史残留未被抹除");
  // ④ dayLifeCommit → dayLifeGen：commit 拒绝时必须原样返回上一份（证明没有绕过 commit 直接 push）
  const d = mature();
  const ds = E.dayKey(new Date(T0));
  d.moodDay = { date: ds, vBias: 0, aBias: 0, energy: 0.7, focus: 0.5, carry: 0, patched: false };
  d.dayLife = { date: ds, traces: [{ slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆", hook: "想起你说过", usedAt: 0, date: ds }] };
  const prev = d.dayLife;
  assert.strictEqual(E.dayLifeGen(d, { now: T0, hour: 12, rng: H.makeRng(1) }), prev,
    "同 slot 被拒时未原样返回，疑似绕过 dayLifeCommit");
  // ⑤ innerLeak 配额 → 必须落到 state.inner 上（否则日 ≤2 次形同虚设）
  const e = mature();
  e.self = { security: 0.9, openness: 0.6, independence: 0.5, dependency: 0.5, updatedAt: null, dayDelta: {} };
  e.moodDay = { date: ds, vBias: 0.25, aBias: 0, energy: 0.8, focus: 0.5, carry: 0, patched: false };
  let leaks = 0;
  for (let i = 0; i < 10; i++) {   // 固定 dateStr = 同一天，专测日配额而非跨天重置
    if (E.innerLeak(e, { anchor: "mood_ask", now: T0 + i * 100 * 60000, dateStr: ds, rng: H.makeRng(i + 1), moodDay: e.moodDay, lv: 5 })) leaks++;
  }
  assert.ok(leaks <= 2, "Inner 日配额未回写，10 次里泄露了 " + leaks + " 次");
  assert.strictEqual(Number(e.inner.dayCount), leaks, "inner.dayCount 与实际泄露次数不符");
  // ⑥ voicePlan → proactivePlan：关掉 voiceMotive，动机通道必须从候选里彻底消失
  const f = E.defaults();
  f.affection = 600; f.lastVisit = T0 - 20 * 3600e3;
  f.moodDay = { date: ds, vBias: 0.2, aBias: 0, energy: 0.7, focus: 0.5, carry: 0, patched: false };
  f.greetedSlots = ["morning", "noon", "afternoon", "evening", "night"];
  f.lastStoryAt = T0;
  const withMotive = E.proactivePlan(f, { now: T0, hour: 14, idleMs: 5 * 60000, rng: H.makeRng(3) });
  assert.ok(withMotive.some((o) => o.motive === "miss" || o.motive === "moodshare"), "voicePlan 未被 proactivePlan 消费");
  f.flags = Object.assign({}, f.flags, { voiceMotive: false });
  const without = E.proactivePlan(f, { now: T0, hour: 14, idleMs: 5 * 60000, rng: H.makeRng(3) });
  assert.ok(!without.some((o) => o.motive === "miss" || o.motive === "moodshare"), "关 flag 后动机通道仍在");
});

test("W-17 [写侧] reply() 真实链路：吃醋报备一次后，同日再触发被 G1 兜住", () => {
  const st = mature({ affection: 520 });
  st.rng = H.makeRng(11);
  let reports = 0;
  for (let i = 0; i < 10; i++) {
    st.voice.lastMotiveAt = {};                       // 只放开 G2 频控，考察 G1
    st.voice.jealousStage = 0; st.voice.jealousAt = 0;
    const r = H.turn(E, st, "你是不是又跟别的女生聊天了");
    for (const line of r.replies) {
      // 只有 G2 三段式报备句受 ACCUSE_RE 约束（v11 既有 jealous 意图模板不在本次治理范围，
      // 属"她撒娇"而非"她指控"，改它会破 V-A 零回归；已单列为复议项）。
      if (/(小情绪|在意|吃味)/.test(line)) { reports++; assert.ok(!E.ACCUSE_RE.test(line), "报备句命中 ACCUSE_RE: " + line); }
      assert.ok(!E.GUILT_TRIP_RE.test(line), "真实链路输出命中 GUILT_TRIP_RE: " + line);
      assert.ok(!E.PERSONA_BREAK_RE.test(line), "真实链路输出命中 PERSONA_BREAK_RE: " + line);
    }
  }
  assert.ok(reports <= 2, "reply() 真实链路同日报备 " + reports + " 次（上限 2）");
  assert.ok(Number(st.negGate.count) >= 1, "真实链路未推进 G1 计数");
});
