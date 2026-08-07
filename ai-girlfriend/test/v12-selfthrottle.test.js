"use strict";
/* 小暖 · v12 第 4 轮返修 —— SELF_EVENTS 节流锁死（N5）回归套件
 *
 * 这是「检出了没被消费」的第六例，也是最隐蔽的一例：前五例都能靠"某个函数没人调"看出来，
 * 这一例的函数**被调了**，判据也**算对了**，只是消费条件 `dayIndex % every === 0`
 * 恰好把稀疏事件筛成了空集 —— 检出 23 次、生效 0 次，全绿。
 *
 * 因此本文件的取证形式是「检出 / 生效」两个计数分开断言：
 *   ① 只断言"事件能检出"会绿在旧实现上（旧实现检出正常，是消费端把它吃了）；
 *   ② 只断言"四轴有变化"也会绿在旧实现上（三个正向事件近乎天天检出，侥幸没被相位筛掉，
 *      曲线照样在长——负向事件常年不生效被完全掩盖，Self 层退化成单向进度条）。
 * 所以必须逐事件比对 lastFired 是否真的被推进，并且穷举相位。
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");

const E = H.loadEngine();
const DAY = 86400000;
const AX = ["security", "openness", "independence", "dependency"];
const EV_EVERY = {};
E.SELF_EVENTS.forEach((ev) => { EV_EVERY[ev.key] = ev.every; });

/* 当日情绪采样谱：pos = 正向三采样；neg = 争吵（末采样仍为负）；fix = 争吵后和解（末采样转正） */
const SAMPLE = {
  pos: [{ v: 0.45, a: 0.20 }, { v: 0.55, a: 0.25 }, { v: 0.50, a: 0.20 }],
  neg: [{ v: -0.70, a: 0.60 }, { v: -0.60, a: 0.50 }],
  fix: [{ v: -0.70, a: 0.60 }, { v: 0.50, a: 0.30 }],
};

/* 六种相处剧本：给定第 d 天，返回当天采样谱 */
const PROFILE = {
  warm:   (d) => "pos",                                  // 天天好好说话
  mixed:  (d) => (d % 4 === 0 ? "neg" : "pos"),          // 四天一吵（quarrel 检出约 23 次）
  stormy: (d) => (d % 3 === 0 ? "neg" : "pos"),          // 三天一吵
  makeup: (d) => (d % 5 === 0 ? "fix" : "pos"),          // 吵完当天就和好
  weekly: (d) => (d % 7 === 0 ? "neg" : "pos"),          // 一周一吵（检出仅 13 次，最容易被相位筛空）
  quiet:  (d) => (d % 9 === 0 ? "pos" : null),           // 长期冷落，制造 neglect
};

/* 跑 N 天，逐日统计每个事件的「检出次数」与「真正生效次数」。
 * 生效判据不看四轴（会被封顶/回归/收益递减污染），只看 lastFired[key] 有没有被推进 —— 
 * 那是消费端唯一的、不可伪造的落笔。 */
function sim(profile, opts) {
  const o = opts || {};
  const days = o.days || 90, phase = o.phase || 0;
  const start = Date.parse("2026-01-01T09:00:00") + phase * DAY;
  const st = H.freshState({ affection: 520 });
  st.persona = { gender: "female", card: o.card || "xiaonuan" };
  st.emotionLog = {}; st.dating = { since: start }; st.firstMeet = start;
  st.self = { security: 0.45, openness: 0.35, independence: 0.50, dependency: 0.45, updatedAt: null, dayDelta: {} };

  const detect = {}, effect = {}, firedDays = {}, dayDeltas = [];
  for (let d = 0; d < days; d++) {
    const now = start + d * DAY, dt = new Date(now), ds = E.dayKey(dt);
    const kind = PROFILE[profile](d);
    if (kind) st.emotionLog[ds] = SAMPLE[kind].map((p) => ({ v: p.v, a: p.a }));
    st.lastVisit = kind ? now - 3600e3 : st.lastVisit;

    const before = Object.assign({}, (st.self && st.self.lastFired) || {});
    E.selfDetect(st, ds, now).forEach((k) => { detect[k] = (detect[k] || 0) + 1; });
    st.self = E.selfTick(st, ds, { now });
    const after = (st.self && st.self.lastFired) || {};
    for (const k of Object.keys(after)) {
      if (after[k] !== before[k]) {
        effect[k] = (effect[k] || 0) + 1;
        (firedDays[k] = firedDays[k] || []).push(E.dayIndex(ds));
      }
    }
    dayDeltas.push(Object.assign({}, st.self.dayDelta));
  }
  return { self: st.self, detect, effect, firedDays, dayDeltas };
}

test("ST-01 [N5] quarrel 90 天：检出必须按 every 节流后真正生效，既不是 0 次也不是全量", () => {
  const r = sim("mixed");
  const det = r.detect.quarrel || 0, eff = r.effect.quarrel || 0;

  assert.ok(det >= 20, "quarrel 检出次数异常偏低，剧本或判据变了：" + det);
  // ① 不许锁死（旧实现在本相位下 eff === 0，本行是这条缺陷的正面取证）
  assert.ok(eff > 0, `quarrel 检出 ${det} 次却一次没生效——节流又把事件吃干净了`);
  // ② 也不许全量放行：every 的初衷是防单日刷屏，必须仍然被节流掉一部分
  assert.ok(eff < det, `quarrel 生效 ${eff}/${det}，节流形同虚设`);
  // ③ 生效次数落在 every 决定的理论区间内：90 天最多 ceil(90/10)=9 次，
  //    而检出跨度 ~89 天下至少应拿到 89/10 向下取整的 8 次左右
  const ub = Math.ceil(90 / EV_EVERY.quarrel);
  assert.ok(eff >= 6 && eff <= ub, `quarrel 生效 ${eff} 次不在 [6, ${ub}] 内`);
  // ④ 冷却语义逐次校验：任意相邻两次生效间隔 ≥ every
  const ds = r.firedDays.quarrel;
  for (let i = 1; i < ds.length; i++) {
    assert.ok(ds[i] - ds[i - 1] >= EV_EVERY.quarrel,
      `quarrel 两次生效仅隔 ${ds[i] - ds[i - 1]} 天，突破了 every=${EV_EVERY.quarrel}`);
  }
});

test("ST-02 [N5] 生效次数必须与安装日期无关：穷举 10 个相位，零锁死且极差 ≤1", () => {
  for (const profile of ["mixed", "stormy", "weekly"]) {
    const counts = [];
    for (let phase = 0; phase < 10; phase++) counts.push(sim(profile, { phase }).effect.quarrel || 0);
    const min = Math.min.apply(null, counts), max = Math.max.apply(null, counts);
    // 旧实现 mixed 档在 phase=0 拿 0 次、phase=1 拿 5 次：同样的相处，成长取决于哪天装的 App
    assert.ok(min > 0, `${profile} 档存在 quarrel 恒不生效的相位：${JSON.stringify(counts)}`);
    assert.ok(max - min <= 1, `${profile} 档 quarrel 生效次数随相位漂移：${JSON.stringify(counts)}`);
  }
});

test("ST-03 [N5] SELF_EVENTS 全表排查：任何事件只要检出够 every，就必须至少生效一次", () => {
  const seen = {};
  for (const profile of Object.keys(PROFILE)) {
    for (let phase = 0; phase < 10; phase++) {
      const r = sim(profile, { phase });
      for (const ev of E.SELF_EVENTS) {
        const det = r.detect[ev.key] || 0, eff = r.effect[ev.key] || 0;
        if (det > 0) seen[ev.key] = true;
        // 检出次数够撑起一个冷却周期，却一次都没落笔 —— 就是 quarrel 那类锁死
        if (det >= ev.every) {
          assert.ok(eff > 0,
            `[${profile} phase=${phase}] ${ev.key} 检出 ${det} 次生效 0 次（every=${ev.every}），同类锁死`);
        }
        assert.ok(eff <= Math.ceil(90 / ev.every),
          `[${profile} phase=${phase}] ${ev.key} 生效 ${eff} 次超出 every=${ev.every} 的理论上限`);
        assert.ok(eff <= det, `[${profile} phase=${phase}] ${ev.key} 生效次数 ${eff} 多于检出 ${det}`);
      }
    }
  }
  // 反向自证：本用例的剧本集必须真的把 6 类事件都跑到过，否则上面的循环是在断言空集
  for (const ev of E.SELF_EVENTS) assert.ok(seen[ev.key], "剧本集从未检出事件 " + ev.key + "，本用例形同虚设");
});

test("ST-04 [N5] 四轴 90 天曲线不跑偏：正向档贴基线，吵架档必须真的把安全感压下来", () => {
  const warm = sim("warm").self, mixed = sim("mixed").self, stormy = sim("stormy").self;
  const fx = (v) => +v.toFixed(3);

  // ① 正常相处基线：QA 给的是 security 0.450 → 0.686，节流改配额后为 0.687
  assert.strictEqual(fx(warm.security), 0.687, "warm 档 security 逐位基线被改动");
  assert.ok(Math.abs(fx(warm.security) - 0.686) <= 0.01, "warm 档显著偏离 QA 基线：" + fx(warm.security));
  assert.deepStrictEqual(
    AX.map((a) => fx(warm[a])), [0.687, 0.582, 0.265, 0.727], "warm 档四轴 90 天曲线漂移");

  // ② 吵架必须有代价：旧实现里 quarrel 恒不生效，stormy 与 warm 的 security 完全一样 —— 
  //    "吵不吵都一样"正是把 Self 层做成单向进度条的那个 bug 的外显。
  assert.ok(mixed.security < warm.security - 0.01,
    `mixed 档 security ${fx(mixed.security)} 未低于 warm ${fx(warm.security)}，吵架没被消费`);
  assert.ok(stormy.security < warm.security - 0.01,
    `stormy 档 security ${fx(stormy.security)} 未低于 warm ${fx(warm.security)}`);

  // ③ 但也不能被吵崩：软带宽 + 每日封顶必须把负向漂移兜在锚点附近
  for (const s of [mixed, stormy]) {
    for (let i = 0; i < AX.length; i++) {
      const b = E.SELF_BOUNDS.xiaonuan[i];
      assert.ok(s[AX[i]] >= b[0] && s[AX[i]] <= b[1], `${AX[i]} 越界：${s[AX[i]]}`);
      assert.ok(s[AX[i]] >= E.SELF_ANCHOR.xiaonuan[i] - E.SELF_SOFT - 1e-9,
        `${AX[i]} 跌破软带宽下沿：${s[AX[i]]}`);
    }
  }
});

test("ST-05 [N5] 负向漂移不失控：单日单轴封顶 0.06 与 SOFT=0.15 收益递减仍成立", () => {
  for (const profile of Object.keys(PROFILE)) {
    const r = sim(profile);
    r.dayDeltas.forEach((dd, d) => {
      for (const ax of AX) {
        const v = Number(dd[ax]) || 0;
        assert.ok(Math.abs(v) <= E.SELF_DAY_CAP + 1e-9,
          `${profile} 第 ${d} 天 ${ax} 单日漂移 ${v} 突破封顶 ${E.SELF_DAY_CAP}`);
      }
    });
  }
  // 收益递减：同一 raw 下，越接近软边界步长越小，且到边界即为 0（不是靠 clamp 硬砍）
  const anchor = 0.55, raw = -0.03;
  let prev = Infinity;
  for (let k = 0; k <= 15; k++) {
    const cur = anchor - (E.SELF_SOFT * k) / 15;
    const step = Math.abs(E.selfDrift(cur, anchor, raw));
    assert.ok(step <= prev + 1e-12, `收益递减被破坏：cur=${cur} step=${step} > 前一档 ${prev}`);
    prev = step;
  }
  assert.strictEqual(E.selfDrift(anchor - E.SELF_SOFT, anchor, raw), -0, "抵达软边界时负向步长应归零");
});

test("ST-06 [N5] 冷却字段自身的鲁棒性：老档缺字段即首检出即生效，时间倒流不给泵送口子", () => {
  // 老档没有 lastFired：不能因此把事件判成"冷却中"而永久静默
  const legacy = H.freshState({ affection: 520 });
  legacy.persona = { gender: "female", card: "xiaonuan" };
  legacy.self = { security: 0.45, openness: 0.35, independence: 0.50, dependency: 0.45, updatedAt: null };
  legacy.emotionLog = {}; legacy.dating = { since: Date.parse("2026-03-01T09:00:00") };
  const base = Date.parse("2026-03-10T09:00:00");
  for (let d = -3; d < 0; d++) legacy.emotionLog[E.dayKey(new Date(base + d * DAY))] = SAMPLE.pos.slice();
  legacy.lastVisit = base - 3600e3;
  const ds0 = E.dayKey(new Date(base));
  const s1 = E.selfTick(legacy, ds0, { now: base });
  assert.ok(Number.isFinite(s1.lastFired.warm), "老档缺 lastFired 时首次检出未落笔");
  assert.ok(s1.security > 0.45, "老档首日事件未生效");

  // 时间倒流：把系统时间调回 5 天前，冷却未满 → 不得再计一次，也不得改写水位
  legacy.self = s1;
  const back = base - 5 * DAY;
  for (let d = -3; d < 0; d++) legacy.emotionLog[E.dayKey(new Date(back + d * DAY))] = SAMPLE.pos.slice();
  const s2 = E.selfTick(legacy, E.dayKey(new Date(back)), { now: back });
  assert.strictEqual(s2.lastFired.warm, s1.lastFired.warm, "时间倒流改写了 lastFired 水位");
  // 事件通道必须零落笔：dayDelta 全 0。（本轮只封事件通道；7 天回归是向锚点收敛、
  // 数学上不可能把某轴推过锚点，属另案 Q-P2-D11 的 updatedAt 防重放，仍挂 todo 未混入本条。）
  for (const ax of AX) assert.strictEqual(Number(s2.dayDelta[ax]) || 0, 0, `时间倒流经事件通道泵送了 ${ax}`);
  const toward = Math.abs(s2.security - E.SELF_ANCHOR.xiaonuan[0]) <= Math.abs(s1.security - E.SELF_ANCHOR.xiaonuan[0]) + 1e-9;
  assert.ok(toward, "时间倒流把 security 推离了锚点（超出回归项能解释的范围）");
});
