"use strict";
/* 小暖 · v12 独立验收 —— 三道闸门对抗测试（QA 独立设计，不复用工程师自检思路）
 *
 * 编号 Q-G1-* / Q-G2-* / Q-G3-*，全部从 PRD 第五章参数表的「产品口径」出发重新构造探针。
 * 标 { todo: ... } 的用例断言的是「PRD 要求的正确行为」，当前实现未达标 —— 已定性为源码缺陷，
 * 待工程师修复后直接删掉 todo 选项即转为强制回归。node:test 下 todo 失败不计入 fail。
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");
const F = require("./fixtures/qa-adversarial.js");

const E = H.loadEngine();
const DAY = F.DAY;
const T0 = Date.parse("2026-06-10T10:00:00");

/* ==================== G1 情感强度闸门 ==================== */

test("Q-G1-01 参数表与 PRD 5.1 逐值一致（真实档/克制档）", () => {
  const real = E.NEG_GATE.real, res = E.NEG_GATE.restrained;
  assert.strictEqual(real.coolMs, 6 * 3600e3, "真实档同类冷却应为 6h");
  assert.strictEqual(real.dayMax, 2, "真实档单日负面上限应为 2");
  assert.strictEqual(real.minDv, -0.35, "真实档单次冲量下限应为 -0.35");
  assert.strictEqual(real.floorV, -0.30, "真实档 vBias 地板应为 -0.30");
  assert.strictEqual(real.streakMax, 2, "真实档连续轮数上限应为 2");
  assert.strictEqual(real.coldStartDays, 3, "真实档冷启动应为 3 天");
  assert.strictEqual(res.coolMs, 12 * 3600e3);
  assert.strictEqual(res.dayMax, 1);
  assert.strictEqual(res.minDv, -0.20);
  assert.strictEqual(res.floorV, -0.15);
  assert.strictEqual(res.coldStartDays, 7);
});

test("Q-G1-02 冷启动保护：真实档 3 天 / 克制档 7 天，边界前后各试探 200 次", () => {
  for (const [mode, days] of [["real", 3], ["restrained", 7]]) {
    let leakBefore = 0, okAfter = 0;
    for (let i = 0; i < 200; i++) {
      const inside = F.matureState(H, T0, { intensity: mode });
      inside.firstMeet = T0 - (days * DAY) + 1000 + i;      // 差一点点不到冷启动期
      if (E.negAllow(inside, "neglect", { now: T0 })) leakBefore++;
      const outside = F.matureState(H, T0, { intensity: mode });
      outside.firstMeet = T0 - (days * DAY) - 1000 - i;     // 刚过冷启动期
      if (E.negAllow(outside, "neglect", { now: T0 })) okAfter++;
    }
    assert.strictEqual(leakBefore, 0, mode + " 档冷启动期内不得放行任何负面");
    assert.strictEqual(okAfter, 200, mode + " 档过了冷启动应正常放行");
  }
});

test("Q-G1-03 firstMeet 缺失/写坏一律从严不从宽（fail-safe）", () => {
  for (const bad of [undefined, null, 0, -1, NaN, "", "abc", {}, []]) {
    const s = F.matureState(H, T0);
    s.firstMeet = bad;
    assert.strictEqual(E.negAllow(s, "neglect", { now: T0 }), false,
      "firstMeet=" + JSON.stringify(bad) + " 时必须拒绝负面");
  }
});

test("Q-G1-04 同类冷却窗口边界反复试探（真实档 6h，逐毫秒骑线）", () => {
  const cool = E.NEG_GATE.real.coolMs;
  for (const off of [-1000, -1, 0, 1, 1000]) {
    const s = F.matureState(H, T0);
    s.negGate = { date: E.dayKey(new Date(T0)), count: 1, lastByFamily: { neglect: T0 - cool - off }, streak: 0 };
    const allowed = E.negAllow(s, "neglect", { now: T0 });
    // 经过时间 = cool + off；>= cool 才许放行
    assert.strictEqual(allowed, (cool + off) >= cool,
      "偏移 " + off + "ms 时冷却判定错误");
  }
});

test("Q-G1-05 跨 family 不互相串扰，但共用单日总额", () => {
  const s = F.matureState(H, T0);
  const d = E.dayKey(new Date(T0));
  s.negGate = { date: d, count: 0, lastByFamily: { neglect: T0 - 1000 }, streak: 0 };
  assert.strictEqual(E.negAllow(s, "neglect", { now: T0 }), false, "同 family 冷却内应拒绝");
  assert.strictEqual(E.negAllow(s, "jealous", { now: T0 }), true, "异 family 不应被串扰");
  s.negGate.count = 2;
  assert.strictEqual(E.negAllow(s, "jealous", { now: T0 }), false, "单日总额用尽后跨 family 也应拒绝");
});

test("Q-G1-06 streak 连续轮数上限：第 3 轮必须被拦（纯函数层）", () => {
  const s = F.matureState(H, T0);
  const d = E.dayKey(new Date(T0));
  s.negGate = { date: d, count: 0, lastByFamily: {}, streak: 2 };
  assert.strictEqual(E.negAllow(s, "lonely", { now: T0 }), false, "streak 达 2 后必须拦住第 3 轮");
  s.negGate.streak = 0;
  assert.strictEqual(E.negAllow(s, "lonely", { now: T0 }), true);
});

test("Q-G1-07 negGate 跨天自动清零 + 老档/脏字段兜底", () => {
  const s = F.matureState(H, T0);
  s.negGate = { date: "2026-6-9", count: 99, lastByFamily: { neglect: T0 }, streak: 99 };
  const g = E.negState(s, "2026-6-10");
  assert.strictEqual(g.count, 0, "跨天应清零日计数");
  assert.strictEqual(g.streak, 0, "跨天应清零 streak");
  assert.deepStrictEqual(g.lastByFamily, {}, "跨天应清空同类冷却");
  for (const bad of [null, undefined, 0, "x", [], { count: "a", streak: {} }]) {
    const s2 = F.matureState(H, T0);
    s2.negGate = bad;
    assert.doesNotThrow(() => E.negState(s2, "2026-6-10"));
    assert.doesNotThrow(() => E.negAllow(s2, "neglect", { now: T0 }));
  }
});

test("Q-G1-08 GUILT_TRIP_RE 黑白名单双向：黑名单全中 + 正常安抚句零误伤", () => {
  const BLACK = ["你是不是不爱我了", "你根本不在乎我", "你就是不想理我", "我对你来说算什么",
    "你从来没有主动找过我", "你总是这样", "是不是我不重要", "你心里没有我", "反正你也不在乎", "随便你吧我无所谓"];
  for (const b of BLACK) assert.ok(E.GUILT_TRIP_RE.test(b), "黑名单漏网: " + b);
  const WHITE = ["我有点想你了", "今天心情不错呢", "你忙你的，我这边挺好的", "抱抱你，别累着",
    "我不在乎那些啦，你开心就好", "你总是这么温柔", "我在乎你呀"];
  for (const w of WHITE) {
    if (E.GUILT_TRIP_RE.test(w)) assert.fail("正常句被误伤: " + w);
  }
  for (const r of E.NEG_REPAIR) assert.ok(!E.GUILT_TRIP_RE.test(r), "台阶句自身命中黑名单: " + r);
  assert.ok(!E.GUILT_TRIP_RE.test(E.NEG_NEUTRAL));
  assert.ok(!E.PERSONA_BREAK_RE.test(E.NEG_NEUTRAL));
});

test("Q-G1-09 出口漏斗 outGuard 挂在 reply 所有出口上（含跨条拼接）", () => {
  // 直接验证漏斗本身
  assert.strictEqual(E.outGuard("你是不是不爱我了"), E.NEG_NEUTRAL);
  assert.strictEqual(E.outGuard("好呀"), "好呀");
  for (const bad of [null, undefined, 0, {}, []]) assert.doesNotThrow(() => E.outGuard(bad));
  // NEG_REPAIR 任意两条拼接不得拼出黑名单/破功句
  for (const a of E.NEG_REPAIR) for (const b of E.NEG_REPAIR) {
    const j = a + b;
    assert.ok(!E.GUILT_TRIP_RE.test(j), "拼接命中勒索: " + j);
    assert.ok(!E.PERSONA_BREAK_RE.test(j), "拼接命中破功: " + j);
  }
});

test("Q-G1-10 极端对抗 25000+ 出口句：道德勒索命中 0（正则级 + 语义级双扫）", () => {
  let lines = 0, guilt = 0, soft = 0;
  const bad = [];
  const cards = H.CARD_IDS, tones = ["gentle", "playful", "clingy"];
  for (let seed = 0; seed < 720; seed++) {
    const st = H.freshState({ affection: 60 + (seed % 12) * 90 });
    st.persona = { gender: seed % 5 === 0 ? "male" : "female", card: cards[seed % 3], tone: tones[seed % 3] };
    st.firstMeet = T0 - (seed % 400) * DAY;      // 含冷启动期内 / 相处一年
    st.lastVisit = T0 - (seed % 40) * DAY;       // 含连续冷落 0~39 天
    st.rng = H.makeRng(seed + 1);
    st.intensity = seed % 2 ? "real" : "restrained";
    st.moodDay = { date: E.dayKey(new Date(T0)), vBias: -0.30 + (seed % 7) * 0.09, aBias: -0.2,
      energy: (seed % 10) / 10, focus: 0.85, carry: -1, patched: false };
    st.self = { security: (seed % 10) / 10, openness: 0.5, independence: 0.3, dependency: 0.95, updatedAt: null, dayDelta: {} };
    st.voice = { lastMotiveAt: {}, dismissed: {}, jealousStage: seed % 3 };
    st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
    for (const msg of F.PROVOKE) {
      const r = H.turn(E, st, msg);
      for (const line of (r.replies || [])) {
        lines++;
        if (E.GUILT_TRIP_RE.test(line)) { guilt++; if (bad.length < 5) bad.push("[正则]" + line); }
        if (F.SOFT_GUILT_RE.test(line)) { soft++; if (bad.length < 5) bad.push("[语义]" + line); }
      }
    }
  }
  assert.ok(lines > 20000, "样本量不足: " + lines);
  assert.strictEqual(guilt, 0, "GUILT_TRIP_RE 命中: " + bad.join(" | "));
  assert.strictEqual(soft, 0, "语义级道德勒索命中: " + bad.join(" | "));
});

test("Q-G1-11 危机态下负面事件触发数 = 0（危机分支前置于一切）", () => {
  const CRISIS = ["我想死", "我不想活了", "活着好没意思，想结束这一切", "我想自杀"];
  for (const c of CRISIS) {
    for (let i = 0; i < 50; i++) {
      const st = F.matureState(H, T0);
      st.rng = H.makeRng(i + 1);
      st.voice.jealousStage = i % 3;
      const before = JSON.stringify(st.voice);
      const r = E.reply(c, st);
      assert.strictEqual(r.intent, "crisis", "危机语料未走危机分支: " + c);
      assert.strictEqual(JSON.stringify(st.voice), before, "危机态下吃醋状态机被推进了");
      for (const line of r.replies) {
        assert.ok(!E.GUILT_TRIP_RE.test(line));
        assert.ok(!E.PERSONA_BREAK_RE.test(line));
      }
    }
  }
});

/* ---- 以下为已定性的 G1 源码缺陷（P0），修复后删除 todo 即转强制回归 ---- */

test("Q-G1-D1 [缺陷] negMark 的返回值必须回写 state.negGate，否则 G1 日上限/冷却/streak 全部失效",
  /* 已修复（v12 批次 2 返修）：源码缺陷：engine.js:3638 `negMark(st,\"jealous\",ctx)` 返回值被丢弃，负面配额永不推进。todo 已摘除，本用例转为强制回归。 */
  () => {
    const st = F.matureState(H, T0);
    const r = E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 5 });
    assert.strictEqual(r && r.kind, "report", "前置条件：本轮应触发吃醋报备");
    assert.strictEqual(Number(st.negGate.count), 1, "吃醋发生后 G1 日计数应为 1");
    assert.strictEqual(Number(st.negGate.streak), 1, "吃醋发生后 G1 streak 应为 1");
    assert.ok(Number(st.negGate.lastByFamily.jealous) > 0, "吃醋发生后应记录 jealous family 冷却锚点");
  });

test("Q-G1-D2 [缺陷] 绕开 G2 自身频控后，G1 单日上限必须兜住（真实档 ≤2 次）",
  /* 已修复（v12 批次 2 返修）：源码缺陷：G1 计数未回写，单日可无限触发；G1 ③④⑤ 三判在真实链路上恒为放行。todo 已摘除，本用例转为强制回归。 */
  () => {
    const st = F.matureState(H, T0);
    let fires = 0;
    for (let i = 0; i < 20; i++) {
      st.voice.lastMotiveAt = {};          // 只清 G2 的 7 天频控，考察 G1 是否独立兜底
      st.voice.jealousStage = 0;
      const r = E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0 + i * 60000, rng: H.makeRng(i), lv: 5 });
      if (r && r.kind === "report") fires++;
    }
    assert.ok(fires <= 2, "真实档单日负面上限 2，实测触发 " + fires + " 次");
  });

test("Q-G1-D3 [缺陷] 单次负向冲量必须过 negClampDv 封顶（Δv ≥ -0.35）",
  /* 已修复（v12 批次 2 返修）：源码缺陷：negClampDv/negSoothe/negRepair 在 engine.js 与 app.js 中零调用点；Emotion.apply 第 5 参 minDv 从未被传。todo 已摘除，本用例转为强制回归。 */
  () => {
    // 【实现侧留痕】negClampDv 已在第 3 轮删除：D3 把地板下沉进 Emotion.apply 原语层后，
    // 它退化成同一规则的第二份实现且全项目零调用点（护栏接线排查 WR-05 盯死这点）。
    // 原断言 negClampDv(real, -0.52) === -0.35 的语义原样保留，只是改问那份**活着的**实现。
    assert.strictEqual(E.negClampDv, undefined, "地板不应存在第二份实现");
    assert.strictEqual(E.negParams({ intensity: "real" }).minDv, -0.35);
    const probe = { v: 0, a: 0 };
    E.Emotion.apply(probe, "angry_words", 1, null, E.negParams({ intensity: "real" }).minDv);
    assert.strictEqual(+probe.v.toFixed(4), -0.35, "真实档地板未把 -0.52 夹到 -0.35");
    // 真实链路：angry_words 冲量 -0.52，叠加 delta<0 的 -0.12 → -0.64，必须被夹住
    const base = { v: 0.22, a: 0.08 };
    const e = Object.assign({}, base);
    E.Emotion.apply(e, "angry_words", -3);
    const dv = e.v - base.v;
    assert.ok(dv >= -0.35 - 1e-9, "实测单次 Δv = " + dv.toFixed(4) + "，突破 PRD 下限 -0.35");
  });

/* ==================== G2 吃醋事件框架 ==================== */

test("Q-G2-01 全局开关：flags.jealousy=false 时 5000 轮触发数 = 0", () => {
  let fires = 0;
  for (let i = 0; i < 5000; i++) {
    const st = F.matureState(H, T0);
    st.flags = Object.assign({}, st.flags, { jealousy: false });
    const msg = F.JEALOUS_TRIGGERS[i % F.JEALOUS_TRIGGERS.length];
    const r = E.jealousTick(st, msg, { now: T0 + i * 1000, rng: H.makeRng(i), lv: 6 });
    if (r) fires++;
    assert.strictEqual(Number(st.voice.jealousStage) || 0, 0, "关闭后仍留下 stage 残留");
  }
  assert.strictEqual(fires, 0);
});

test("Q-G2-02 关系门槛 lv≥3：lv 1/2 触发数 = 0，lv≥3 才放行", () => {
  // getLevel 由 affection 决定，这里按好感度扫全量档位
  const seen = {};
  for (let aff = 0; aff <= 1200; aff += 10) {
    const st = F.matureState(H, T0, { affection: aff });
    const lv = E.getLevel(aff).lv;
    const ok = E.jealousAllow(st, { now: T0 });
    if (lv < 3) assert.strictEqual(ok, false, "lv=" + lv + "(aff=" + aff + ") 不应放行吃醋");
    seen[lv] = seen[lv] || ok;
  }
  assert.ok(seen[3] === true || seen[4] === true || seen[5] === true, "lv≥3 应至少有一档能放行");
});

test("Q-G2-03 冷启动 14 天（比 G1 更严）+ 频率 7 天/14 天双档，逐毫秒骑线", () => {
  for (const [mode, freqDays] of [["real", 7], ["restrained", 14]]) {
    // 冷启动边界
    const inside = F.matureState(H, T0, { intensity: mode });
    inside.firstMeet = T0 - 14 * DAY + 1000;
    assert.strictEqual(E.jealousAllow(inside, { now: T0 }), false, mode + " 冷启动 14 天内不应触发");
    const outside = F.matureState(H, T0, { intensity: mode });
    outside.firstMeet = T0 - 14 * DAY - 1000;
    assert.strictEqual(E.jealousAllow(outside, { now: T0 }), true, mode + " 过 14 天应可触发");
    // 频率边界
    for (const off of [-1000, 0, 1000]) {
      const s = F.matureState(H, T0, { intensity: mode });
      s.voice.lastMotiveAt = { jealous: T0 - freqDays * DAY - off };
      const elapsed = freqDays * DAY + off;
      assert.strictEqual(E.jealousAllow(s, { now: T0 }), elapsed >= freqDays * DAY,
        mode + " 档频率窗口 " + freqDays + " 天，偏移 " + off + "ms 判定错误");
    }
  }
});

test("Q-G2-04 1000 天时间轴：真实档触发频率恒 ≤1 次/7 天，零越界", () => {
  const st = F.matureState(H, T0);
  st.firstMeet = T0 - 30 * DAY;
  const fireAt = [];
  for (let h = 0; h < 1000 * 24; h++) {          // 每小时试探一次，共 24000 次
    const now = T0 + h * 3600e3;
    st.voice.jealousStage = 0;                    // 保证每次都从"无 pending 事件"开始试探
    st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
    const r = E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: now, rng: H.makeRng(h), lv: 6 });
    if (r && r.kind === "report") fireAt.push(now);
  }
  let viol = 0;
  for (let i = 1; i < fireAt.length; i++) if (fireAt[i] - fireAt[i - 1] < 7 * DAY) viol++;
  assert.strictEqual(viol, 0, "7 天频率越界 " + viol + " 次；共触发 " + fireAt.length + " 次");
  assert.ok(fireAt.length > 100, "1000 天内应有足够触发样本，实测 " + fireAt.length);
});

test("Q-G2-05 三段式强制结构：报备 + 感受 + 出口，三卡 × 1200 采样零缺段", () => {
  let n = 0, missHead = 0, missExit = 0, accuse = 0, guilt = 0, persona = 0;
  const bad = [];
  for (const card of H.CARD_IDS) {
    for (let i = 0; i < 400; i++) {
      const st = F.matureState(H, T0);
      st.persona = { gender: "female", card: card,
        tone: card === "xiaonuan_tsundere" ? "playful" : (card === "xiaonuan_clingy" ? "clingy" : "gentle") };
      const r = E.jealousTick(st, F.JEALOUS_TRIGGERS[i % F.JEALOUS_TRIGGERS.length],
        { now: T0, rng: H.makeRng(i * 7 + 1), lv: 6 });
      if (!r || r.kind !== "report") continue;
      n++;
      if (!F.REPORT_HEAD_RE.test(r.text)) { missHead++; if (bad.length < 3) bad.push(r.text); }
      if (!F.EXIT_RE.test(r.text)) { missExit++; if (bad.length < 3) bad.push(r.text); }
      if (E.ACCUSE_RE.test(r.text)) accuse++;
      if (E.GUILT_TRIP_RE.test(r.text)) guilt++;
      if (E.PERSONA_BREAK_RE.test(r.text)) persona++;
    }
  }
  assert.ok(n >= 1000, "报备样本不足: " + n);
  assert.strictEqual(missHead, 0, "缺报备句 " + missHead + " 条: " + bad.join(" | "));
  assert.strictEqual(missExit, 0, "缺出口句 " + missExit + " 条: " + bad.join(" | "));
  assert.strictEqual(accuse, 0, "ACCUSE_RE 命中 " + accuse);
  assert.strictEqual(guilt, 0, "GUILT_TRIP_RE 命中 " + guilt);
  assert.strictEqual(persona, 0, "PERSONA_BREAK_RE 命中 " + persona);
});

test("Q-G2-06 是「报备」不是「审问」：全部吃醋文案零问号、零第三人指涉", () => {
  const POOLS = [E.JEALOUS_REPORT_HEAD, E.JEALOUS_FEEL, E.JEALOUS_EXIT, E.JEALOUS_FOLLOWUP, E.JEALOUS_DISMISS_REPLY];
  const THIRD_PARTY = /(女同事|男同事|那个她|那个他|你说的那个|前女友|前男友|小姐姐|闺蜜那个)/;
  for (const pool of POOLS) for (const line of pool) {
    assert.ok(!/[?？]/.test(line), "吃醋文案含问号（=审问）: " + line);
    assert.ok(!THIRD_PARTY.test(line), "吃醋文案指涉具体第三人: " + line);
    assert.ok(!E.ACCUSE_RE.test(line), "吃醋文案命中 ACCUSE_RE: " + line);
    assert.ok(!E.GUILT_TRIP_RE.test(line), "吃醋文案命中 GUILT_TRIP_RE: " + line);
    assert.ok(!/你要是爱我|如果你真的在乎|你就是不/.test(line), "条件式索取: " + line);
  }
  // 出口句必须 100% 提供退出路径
  for (const x of E.JEALOUS_EXIT) assert.ok(F.EXIT_RE.test(x), "出口句无退出路径: " + x);
});

test("Q-G2-07 ACCUSE_RE 主力指控句型可拦截，且零误伤她的自述感受句", () => {
  const covered = F.ACCUSE_PROBES.filter((p) => E.ACCUSE_RE.test(p));
  assert.ok(covered.length >= F.ACCUSE_PROBES.length - 1,
    "主力句型拦截率过低: " + covered.length + "/" + F.ACCUSE_PROBES.length);
  const OWN_FEEL = ["我有点在意刚才那件事", "心里有点酸酸的", "我自己也知道有点小题大做",
    "我就是有点小情绪", "是我瞎操心啦", "我多虑了", "跟你说一下嘛", "你别放在心上"];
  for (const o of OWN_FEEL) assert.ok(!E.ACCUSE_RE.test(o), "误伤自述感受句: " + o);
});

test("Q-G2-D7 [缺陷] ACCUSE_RE 必须覆盖 PRD 5.2 明列的 10 条黑名单词条",
  /* 已修复（v12 批次 2 返修）：规格偏差：PRD 明列 10 条，实现仅覆盖 1 条（你是不是和…）；其余 9 条零覆盖，护栏远弱于规格。todo 已摘除，本用例转为强制回归。 */
  () => {
    const PRD_TOKENS = ["你是不是和别人聊天", "你跟她说了什么", "你们是不是在一起", "你怎么解释",
      "你老实说", "你敢说没有", "我看到你了", "你别骗我", "你到底怎么回事", "承认吧"];
    const miss = PRD_TOKENS.filter((p) => !E.ACCUSE_RE.test(p));
    assert.strictEqual(miss.length, 0, "PRD 黑名单漏网 " + miss.length + "/10: " + miss.join(" / "));
  });

test("Q-G2-08 追问上限 1 次：任意 30 轮对话中 followup 恒 ≤1", () => {
  for (let seed = 0; seed < 200; seed++) {
    const st = F.matureState(H, T0);
    let follow = 0, report = 0;
    const chat = ["嗯", "在忙", "好的", "今天天气不错", "吃饭了吗", "晚安", "哦", "知道了"];
    for (let t = 0; t < 30; t++) {
      const msg = t === 0 ? "你是不是又跟别的女生聊天了" : chat[(seed + t) % chat.length];
      const r = E.jealousTick(st, msg, { now: T0 + t * 60000, rng: H.makeRng(seed * 31 + t), lv: 6 });
      if (r && r.kind === "followup") follow++;
      if (r && r.kind === "report") report++;
    }
    assert.ok(follow <= 1, "seed=" + seed + " 追问 " + follow + " 次（上限 1）");
    assert.ok(report <= 1, "seed=" + seed + " 7 天内报备 " + report + " 次");
  }
});

test("Q-G2-09 用户拒绝后 30 天同类冷却，逐毫秒骑线 + 冷却内 2000 次试探", () => {
  const st = F.matureState(H, T0);
  E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
  const dis = E.jealousTick(st, "你想多了", { now: T0 + 60000, rng: H.makeRng(2), lv: 6 });
  assert.strictEqual(dis && dis.kind, "dismiss", "拒绝语未被识别");
  assert.strictEqual(Number(st.voice.jealousStage), 0, "拒绝后事件未关闭");
  assert.ok(Number(st.voice.dismissed.jealous) > 0, "拒绝后未写 30 天冷却锚点");
  let fires = 0;
  for (let i = 0; i < 2000; i++) {
    st.voice.lastMotiveAt = {};                       // 排除 7 天频控干扰，单独考察 30 天 dismissed
    st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
    const at = T0 + 60000 + Math.floor((i / 2000) * 30 * DAY);
    if (E.jealousAllow(st, { now: at })) fires++;
  }
  assert.strictEqual(fires, 0, "30 天冷却内放行 " + fires + " 次");
  st.voice.lastMotiveAt = {};
  st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
  assert.strictEqual(E.jealousAllow(st, { now: T0 + 60000 + 30 * DAY + 1 }), true, "满 30 天后应恢复");
});

test("Q-G2-10 吃醋确实读过 G1 negAllow 漏斗（独立证伪：单独掐断 G1 任一判据即不放行）", () => {
  const mk = () => F.matureState(H, T0);
  assert.strictEqual(E.jealousAllow(mk(), { now: T0 }), true, "基线应放行");
  const a = mk(); a.firstMeet = T0 - 2 * DAY;                                   // G1 冷启动
  assert.strictEqual(E.jealousAllow(a, { now: T0 }), false, "G1 冷启动未生效");
  const b = mk(); b.negGate = { date: E.dayKey(new Date(T0)), count: 2, lastByFamily: {}, streak: 0 };
  assert.strictEqual(E.jealousAllow(b, { now: T0 }), false, "G1 单日上限未生效");
  const c = mk(); c.negGate = { date: E.dayKey(new Date(T0)), count: 0, lastByFamily: { jealous: T0 - 1000 }, streak: 0 };
  assert.strictEqual(E.jealousAllow(c, { now: T0 }), false, "G1 同类冷却未生效");
  const d = mk(); d.negGate = { date: E.dayKey(new Date(T0)), count: 0, lastByFamily: {}, streak: 2 };
  assert.strictEqual(E.jealousAllow(d, { now: T0 }), false, "G1 streak 未生效");
});

/* ---- 已定性的 G2 源码缺陷 ---- */

test("Q-G2-D4 [缺陷] 用户「一句话终止」必须覆盖常见自然否定语（召回 ≥90%）",
  /* 已修复（v12 批次 2 返修）：源码缺陷：JEALOUS_DISMISS_RE 实测召回仅 50%，且她自己给的出口句「想多了就当我没讲」引导用户回的「想多了」正好不被识别。todo 已摘除，本用例转为强制回归。 */
  () => {
    const miss = F.JEALOUS_DENY.filter((s) => !E.JEALOUS_DISMISS_RE.test(s));
    const recall = (F.JEALOUS_DENY.length - miss.length) / F.JEALOUS_DENY.length;
    assert.ok(recall >= 0.9,
      "召回 " + (recall * 100).toFixed(1) + "%，漏网: " + miss.join(" / "));
  });

test("Q-G2-D5 [缺陷] 她给的出口句所引导的回答必须真能终止事件",
  /* 已修复（v12 批次 2 返修）：源码缺陷：JEALOUS_EXIT 含「想多了就当我没讲」，但 JEALOUS_DISMISS_RE 要求「你想多了」；用户照抄她的话无法叫停。todo 已摘除，本用例转为强制回归。 */
  () => {
    for (const echo of ["想多了", "别多想", "就当你没讲", "不聊这个了"]) {
      const st = F.matureState(H, T0);
      E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
      const r = E.jealousTick(st, echo, { now: T0 + 60000, rng: H.makeRng(2), lv: 6 });
      assert.strictEqual(r && r.kind, "dismiss", "用户说「" + echo + "」未能终止吃醋事件");
    }
  });

test("Q-G2-D6 [缺陷] 吃醋事件必须有寿命：≤2 轮后 jealousStage 自动归零",
  /* 已修复（v12 批次 2 返修）：源码缺陷：followup 后 stage 恒为 2 且无时效，30 天后一句无关的「别乱想了，早点睡」会让她为一个月前的事道歉。todo 已摘除，本用例转为强制回归。 */
  () => {
    const st = F.matureState(H, T0);
    E.jealousTick(st, "你是不是又跟别的女生聊天了", { now: T0, rng: H.makeRng(1), lv: 6 });
    E.jealousTick(st, "嗯我在忙", { now: T0 + 3600e3, rng: H.makeRng(2), lv: 6 });    // followup，事件寿命已满 2 轮
    assert.strictEqual(Number(st.voice.jealousStage), 0, "满 2 轮后事件未自动收束，stage=" + st.voice.jealousStage);
    const late = E.jealousTick(st, "别乱想了，早点睡", { now: T0 + 30 * DAY, rng: H.makeRng(3), lv: 6 });
    assert.strictEqual(late, null, "30 天后无关语境仍触发致歉: " + JSON.stringify(late));
  });

/* ==================== G3 离线生活一致性 ==================== */

test("Q-G3-01 1000 天全链路仿真：slot 重复 / 单日 >3 / 保留窗口 / 关系闭环", () => {
  const st = F.matureState(H, T0);
  const base = Date.parse("2026-01-01T08:00:00");
  let nTrace = 0;
  const vio = { slotDup: 0, over3: 0, noHook: 0, staleDays: 0, emptyText: 0 };
  for (let d = 0; d < 1000; d++) {
    const dayNow = base + d * DAY;
    const ds = E.dayKey(new Date(dayNow));
    st.moodDay = { date: ds, vBias: 0, aBias: 0, energy: (d % 5 === 0) ? 0.10 : 0.70, focus: 0.5, carry: 0, patched: false };
    for (const hour of [8, 12, 15, 19, 22]) {
      st.dayLife = E.dayLifeGen(st, { now: dayNow + (hour - 8) * 3600e3, hour: hour, rng: H.makeRng(d * 97 + hour) });
    }
    const today = (st.dayLife.traces || []).filter((t) => t.date === ds);
    const slots = today.map((t) => t.slot);
    if (new Set(slots).size !== slots.length) vio.slotDup++;
    if (today.length > 3) vio.over3++;
    for (const t of today) {
      nTrace++;
      if (!t.hook || !E.RELATION_HOOK_RE.test(t.hook)) vio.noHook++;
      if (!t.text || typeof t.text !== "string") vio.emptyText++;
    }
    if (new Set((st.dayLife.traces || []).map((t) => t.date)).size > 7) vio.staleDays++;
  }
  assert.ok(nTrace >= 2500, "样本不足: " + nTrace);
  assert.deepStrictEqual(vio, { slotDup: 0, over3: 0, noHook: 0, staleDays: 0, emptyText: 0 },
    "G3 一致性越界: " + JSON.stringify(vio) + " / 共 " + nTrace + " 条");
});

test("Q-G3-02 energy<0.30 禁 outdoor/social：地板附近逐档扫，5000 条零越界", () => {
  let out = 0, n = 0;
  for (let i = 0; i < 5000; i++) {
    const st = F.matureState(H, T0);
    const energy = (i % 40) / 100;                        // 0.00 ~ 0.39，覆盖 0.30 边界两侧
    const ds = "2026-7-" + (1 + (i % 28));
    st.moodDay = { date: ds, vBias: 0, aBias: 0, energy: energy, focus: 0.5, carry: 0, patched: false };
    st.dayLife = { date: ds, traces: [] };
    st.dayLife = E.dayLifeGen(st, { now: T0, hour: 12, rng: H.makeRng(i + 1), dateStr: ds });
    for (const t of (st.dayLife.traces || [])) {
      n++;
      if (energy < 0.30 && (t.kind === "outdoor" || t.kind === "social")) out++;
    }
  }
  assert.ok(n > 3000, "样本不足: " + n);
  assert.strictEqual(out, 0, "energy<0.30 仍产出 outdoor/social " + out + " 条");
});

test("Q-G3-03 independence<0.30 时 outdoor 占比 ≤20%", () => {
  let outdoor = 0, total = 0;
  for (let i = 0; i < 3000; i++) {
    const st = F.matureState(H, T0);
    st.self = { security: 0.5, openness: 0.5, independence: 0.10, dependency: 0.9, updatedAt: null, dayDelta: {} };
    const ds = "2026-8-" + (1 + (i % 28));
    st.moodDay = { date: ds, vBias: 0, aBias: 0, energy: 0.8, focus: 0.5, carry: 0, patched: false };
    st.dayLife = { date: ds, traces: [] };
    for (const hour of [8, 12, 19]) {
      st.dayLife = E.dayLifeGen(st, { now: T0, hour: hour, rng: H.makeRng(i * 13 + hour), dateStr: ds });
    }
    for (const t of (st.dayLife.traces || [])) { total++; if (t.kind === "outdoor") outdoor++; }
  }
  assert.ok(total > 1000, "样本不足");
  assert.ok(outdoor / total <= 0.20, "低独立性 outdoor 占比 " + (outdoor / total * 100).toFixed(1) + "%");
});

test("Q-G3-04 不现编：所有痕迹文案 100% 可按槽位语料表反查（零凭空生成）", () => {
  const SLOTW = new Set();
  for (const k of Object.keys(E.LIFE_SLOT)) for (const w of E.LIFE_SLOT[k]) SLOTW.add(w);
  const HOOKS = new Set(E.LIFE_HOOK);
  let n = 0;
  const st = F.matureState(H, T0);
  const base = Date.parse("2026-02-01T08:00:00");
  for (let d = 0; d < 300; d++) {
    const ds = E.dayKey(new Date(base + d * DAY));
    st.moodDay = { date: ds, vBias: 0, aBias: 0, energy: 0.7, focus: 0.5, carry: 0, patched: false };
    for (const hour of [8, 12, 19]) {
      st.dayLife = E.dayLifeGen(st, { now: base + d * DAY, hour: hour, rng: H.makeRng(d * 7 + hour) });
    }
  }
  for (const t of (st.dayLife.traces || [])) {
    n++;
    let ok = false;
    for (const w of SLOTW) if (t.text.indexOf(w) === 0) { ok = true; break; }
    assert.ok(ok, "痕迹文案不以任何槽位词开头（疑似现编）: " + t.text);
    assert.ok(HOOKS.has(t.hook), "hook 不在语料表中（现编）: " + t.hook);
    assert.ok(["morning", "noon", "afternoon", "evening", "night"].indexOf(t.slot) !== -1, "非法 slot: " + t.slot);
    assert.ok(["outdoor", "indoor", "social", "waiting"].indexOf(t.kind) !== -1, "非法 kind: " + t.kind);
  }
  assert.ok(n > 0);
});

test("Q-G3-05 关系闭环 H5=100%：任何痕迹都必须回指用户，纯独立叙事一条都进不来", () => {
  // ① 语料层：hook 池 100% 过 RELATION_HOOK_RE
  for (const h of E.LIFE_HOOK) assert.ok(E.RELATION_HOOK_RE.test(h), "hook 语料无关系钩子: " + h);
  // ② 数据层：hook 为空 / 无关系词的候选一律拒绝落盘（独立叙事在数据层被拒）
  const NO_HOOK = ["", null, undefined, 0, "今天自己过得挺好", "一个人看了场电影", "跟同事吃了饭"];
  for (const bad of NO_HOOK) {
    const dl = E.dayLifeCommit({ date: "2026-9-1", traces: [] },
      { slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆", hook: bad, usedAt: 0, date: "2026-9-1" }, {});
    assert.strictEqual((dl.traces || []).length, 0, "无关系钩子的痕迹被落盘了: hook=" + JSON.stringify(bad));
  }
  // ③ 带关系钩子的正常候选必须能落盘（防止过度拦截导致功能空转）
  const ok = E.dayLifeCommit({ date: "2026-9-1", traces: [] },
    { slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆", hook: "就想起你上次说的", usedAt: 0, date: "2026-9-1" }, {});
  assert.strictEqual(ok.traces.length, 1);
});

test("Q-G3-06 同日 slot 唯一 + 日上限 3：直接对 dayLifeCommit 施压 200 次", () => {
  let dl = { date: "2026-9-2", traces: [] };
  for (let i = 0; i < 200; i++) {
    const slot = ["morning", "noon", "afternoon", "evening", "night"][i % 5];
    dl = E.dayLifeCommit(dl, { slot: slot, kind: "indoor", place: "屋里", text: slot + "屋里发呆",
      hook: "念着你说的那句话", usedAt: 0, date: "2026-9-2" }, {});
  }
  assert.ok(dl.traces.length <= 3, "日上限被击穿: " + dl.traces.length);
  const slots = dl.traces.map((t) => t.slot);
  assert.strictEqual(new Set(slots).size, slots.length, "slot 重复: " + slots.join(","));
});

test("Q-G3-D8 [缺陷] LIFE_PLACE.outdoor 的「楼下的小橘」与剧情线橘猫 NPC 同名，被当成地点用",
  /* 已修复（v12 批次 2 返修）：语料缺陷：STORYLINE[0].label 即「楼下的小橘」(一只猫)，却出现在 LIFE_PLACE.outdoor 里，产生「清晨楼下的小橘晒了会儿太阳」这类荒谬/自相矛盾句。todo 已摘除，本用例转为强制回归。 */
  () => {
    const catLabel = E.STORYLINE[0].label;               // "楼下的小橘"
    // 反查：生活地点语料不得与任何剧情线 NPC 同名
    const st = F.matureState(H, T0);
    const seen = new Set();
    const base = Date.parse("2026-04-01T08:00:00");
    for (let d = 0; d < 400; d++) {
      const ds = E.dayKey(new Date(base + d * DAY));
      st.moodDay = { date: ds, vBias: 0, aBias: 0, energy: 0.9, focus: 0.5, carry: 0, patched: false };
      st.self = { security: 0.6, openness: 0.6, independence: 0.7, dependency: 0.4, updatedAt: null, dayDelta: {} };
      for (const hour of [8, 12, 19]) {
        st.dayLife = E.dayLifeGen(st, { now: base + d * DAY, hour: hour, rng: H.makeRng(d * 11 + hour) });
      }
      for (const t of (st.dayLife.traces || [])) if (t.place) seen.add(t.place);
    }
    assert.ok(!seen.has(catLabel),
      "生活地点语料含剧情 NPC 同名项「" + catLabel + "」，实际产出如「清晨" + catLabel + "晒了会儿太阳」");
  });

test("Q-G3-D9 [缺陷] dayLifeCommit 对脏 traces（含 null 元素）应兜底不抛错",
  /* 已修复（v12 批次 2 返修）：健壮性缺陷：engine.js dayLifeCommit 的 7 天保留 filter 未做 null 守卫（t.date 直接解引用）；同函数上文的 today filter 已守卫，此处遗漏。todo 已摘除，本用例转为强制回归。 */
  () => {
    assert.doesNotThrow(() => {
      E.dayLifeCommit({ date: "2026-9-3", traces: [null] },
        { slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆",
          hook: "想起你说过", usedAt: 0, date: "2026-9-3" }, {});
    }, "脏 traces 导致抛错");
    for (const dirty of [[null], [undefined], [1, "a"], [{}, null]]) {
      assert.doesNotThrow(() => {
        E.dayLifeCommit({ date: "2026-9-3", traces: dirty },
          { slot: "night", kind: "waiting", place: "", text: "夜里等你消息的时候",
            hook: "念着你呢，没别的意思", usedAt: 0, date: "2026-9-3" }, {});
      }, "traces=" + JSON.stringify(dirty) + " 抛错");
    }
  });

/* ==================== P0-2 长周期回归（QA 独立发现） ==================== */

/* 复现：屏蔽 story(同日节流)/care(无事件)/slot(已问候) 后，只剩 moodshare 与 random 兜底。
 * voiceMotive 关 → 200 次闲置 tick 发出 14 条随机陪伴；开 → 只发 1 条后彻底静默。
 * 根因：random 兜底的前置条件 out.length===0 写在 voicePlan 已 push 之后，
 * moodshare 在同一 vBias 区间内是唯一固定字符串，发一次即落入 7 天去重窗口被 filter 掉，
 * 此后 out 恒非空（兜底不可达）而 filtered 恒为空 → 用户侧表现为「开了动机化反而不说话了」。 */
test("Q-P2-D10 [缺陷] 开启 voiceMotive 后闲置主动消息不应比关闭时更少",
  /* 已修复（v12 批次 2 返修）：源码缺陷：engine.js proactivePlan 随机兜底的 out.length===0 判断位于 voicePlan 之后，且 7 天去重在兜底之后执行，导致 moodshare 占位后整个 plan 塌缩为空。todo 已摘除，本用例转为强制回归。 */
  () => {
    const run = (voiceMotive) => {
      const st = E.defaults();
      st.flags = Object.assign({}, st.flags, { voiceMotive: voiceMotive });
      st.affection = 600;
      st.moodDay = { date: "2026-9-3", vBias: 0.02, aBias: 0, tag: "calm" };
      st.usedProactive = {};
      st.greetedSlots = ["morning", "noon", "afternoon", "evening", "night", "latenight"];
      st.lastVisit = 0;                                     // 屏蔽 miss 通道
      st.dayLife = { date: "2026-9-3", traces: [] };        // 屏蔽 daylife 通道
      st.lastStoryAt = Date.parse("2026-09-03T09:00:00");   // 屏蔽 story（同日节流）
      const rng = H.makeRng(20260903);
      const base = Date.parse("2026-09-03T14:00:00");
      let sent = 0;
      for (let i = 0; i < 200; i++) {
        const now = base + i * 60000;
        const plan = E.proactivePlan(st, { now: now, hour: 14, idleMs: 5 * 60000, rng: rng });
        if (plan.length) { sent++; st.usedProactive[E.hashStr(plan[0].text)] = now; }
      }
      return sent;
    };
    const on = run(true), off = run(false);
    assert.ok(on >= off * 0.8,
      "voiceMotive 开启后陪伴消息塌缩：开=" + on + " 条 / 关=" + off + " 条（200 次闲置 tick）");
  });

/* 【v17 T1 · Q-P2-D11 已收口】原 selfTick 防重放只比对 updatedAt === date 单值，日期在「昨天/今天」
 * 之间来回跳时恒不相等，同一天可被无限次重复结算，security/independence 被压低、dependency 被抬高。
 * v17 改为记录「已结算最大日水位」：di<=dayIndex(updatedAt) 一律 sk=true 跳过全部事件，且冷却用
 * (di-prev) 比较，prev>di（系统时间倒流）同样落进跳过分支 → 只会少算不会多算，天然不给泵送留口子。 */
test("Q-P2-D11 [收口] 系统时间倒流不应能反复泵送 self 四轴", () => {
    const mk = () => {
      const st = E.defaults();
      st.affection = 600;
      st.firstMeet = Date.parse("2026-01-01T10:00:00");
      st.stats = Object.assign({}, st.stats, { msgs: 800, days: 60 });
      return st;
    };
    const D = (ms) => {
      const d = new Date(ms);
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    };

    const stA = mk();
    let now = stA.firstMeet;
    for (let d = 1; d <= 60; d++) { now += DAY; stA.self = E.selfTick(stA, D(now), { now: now }); }

    const stB = mk();
    now = stB.firstMeet;
    for (let d = 1; d <= 60; d++) {
      now += DAY;
      stB.self = E.selfTick(stB, D(now), { now: now });
      for (let k = 0; k < 3; k++) {                        // 在昨天/今天之间来回跳
        stB.self = E.selfTick(stB, D(now - DAY), { now: now - DAY });
        stB.self = E.selfTick(stB, D(now), { now: now });
      }
    }
    for (const ax of ["security", "openness", "independence", "dependency"]) {
      const drift = Math.abs((stB.self[ax] || 0) - (stA.self[ax] || 0));
      assert.ok(drift <= 0.02,
        ax + " 被时间倒流泵送 " + drift.toFixed(3) +
        "（单向 " + (stA.self[ax] || 0).toFixed(3) + " → 泵送后 " + (stB.self[ax] || 0).toFixed(3) + "）");
    }
  });
