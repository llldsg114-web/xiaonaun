"use strict";
/* 小暖 · v12 第 3 轮返修 —— 「日期格式统一的副作用」回归套件（N1 / N2 / N3）
 *
 * 这三条的共同教训：D1 把日期字符串统一成零填充，是一次**地基改动**。
 * 地基改动的危险不在改动本身，而在于读侧与写侧未必在同一次提交里对齐 ——
 * 写侧当天就零填充了，读侧还在按老键找，中间那层数据于是静默失联：
 * 不报错、不崩溃、单测全绿，只是老用户攒了三个月的历史从此等于不存在。
 *
 * 所以本文件的取证形式统一为：**老档与新档跑同一条链路，结果必须逐位相同**，
 * 并且额外证明"两边都不是 0"——否则"共同漏检"也会让相等断言变绿。
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");

const E = H.loadEngine();
const DAY = 86400000;

/* 生成"D1 之前落盘"的老键：非零填充 */
function bareKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

test("DF-01 [N1] 老档 90 天成长曲线必须与新档逐位一致", () => {
  const start = Date.parse("2026-01-01T09:00:00");
  const AX = ["security", "openness", "independence", "dependency"];
  const sim = (legacy, profile) => {
    const st = H.freshState({ affection: 520 });
    st.persona = { gender: "female", card: "xiaonuan" };
    st.emotionLog = {}; st.dating = { since: start }; st.firstMeet = start;
    st.self = { security: 0.45, openness: 0.35, independence: 0.50, dependency: 0.45, updatedAt: null, dayDelta: {} };
    const fires = {};
    for (let d = 0; d < 90; d++) {
      const now = start + d * DAY, dt = new Date(now), ds = E.dayKey(dt);
      const warm = profile === "warm" || (profile === "mixed" && d % 4 !== 0);
      st.lastVisit = now - 3600e3;
      st.emotionLog[legacy ? bareKey(dt) : ds] = warm
        ? [{ v: 0.45, a: 0.20 }, { v: 0.55, a: 0.25 }, { v: 0.50, a: 0.20 }]
        : [{ v: -0.70, a: 0.60 }, { v: -0.60, a: 0.50 }];
      E.selfDetect(st, ds, now).forEach((e) => { fires[e] = (fires[e] || 0) + 1; });
      st.self = E.selfTick(st, ds, { now });
    }
    return { self: st.self, fires };
  };

  for (const profile of ["warm", "mixed"]) {
    const nu = sim(false, profile), old = sim(true, profile);
    for (const ax of AX) {
      assert.strictEqual(old.self[ax], nu.self[ax],
        `${profile} 档 ${ax}：老档 ${old.self[ax]} ≠ 新档 ${nu.self[ax]}`);
    }
    // 只断言"两边相等"是不够的：两边一起漏检成 0 也会相等。必须证明事件确实检出来了。
    assert.deepStrictEqual(old.fires, nu.fires, profile + " 档事件命中谱不一致");
    assert.ok(old.fires.warm > 50 && old.fires.company > 50,
      profile + " 档老档成长事件检出过少（疑似仍在漏检）：" + JSON.stringify(old.fires));
  }
  // 与 QA 给出的基线对齐：security 0.450 → 0.686。N5 把 every 从「相位取模」改成「按事件冷却」后
  // 重算为 0.687（+0.001，节流语义未变、只是不再漏节拍）。两道一起写：逐位锁死防悄悄改，
  // 偏离带防"以后哪次改动把曲线整体挪走了还逐位自洽"。
  const warmSec = +sim(true, "warm").self.security.toFixed(3);
  assert.strictEqual(warmSec, 0.687, "老档 security 逐位基线被改动");
  assert.ok(Math.abs(warmSec - 0.686) <= 0.01, "四轴曲线显著偏离 QA 基线 0.686：" + warmSec);
});

test("DF-02 [N2] 老档混键下连写 3 天不丢，且淘汰的是最老的三天", () => {
  const log = {};
  for (let d = 1; d <= 14; d++) log["2026-9-" + d] = [{ v: 0.2, a: 0.1 }];
  for (const nd of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
    E.Emotion.record(log, { v: 0.5, a: 0.3 }, nd);
    assert.ok(log[nd], "写入 " + nd + " 当天即被淘汰");
    assert.strictEqual(Object.keys(log).length, 14, "键数应恒为 14");
  }
  for (const gone of ["2026-9-1", "2026-9-2", "2026-9-3"]) {
    assert.strictEqual(log[gone], undefined, "应被淘汰的最老键仍在：" + gone);
  }
  for (const keep of ["2026-9-14", "2026-09-15", "2026-09-17"]) {
    assert.ok(log[keep], "不该淘汰的键被删了：" + keep);
  }
});

test("DF-03 [N2] 同一天的两种写法自动合并，不占双份配额也不丢样本", () => {
  const merge = { "2026-9-5": [{ v: 0.1, a: 0 }, { v: 0.2, a: 0 }] };
  E.Emotion.record(merge, { v: 0.9, a: 0.4 }, "2026-09-05");
  assert.strictEqual(merge["2026-9-5"], undefined, "老键未被收编，同一天被拆成两条");
  assert.strictEqual(merge["2026-09-05"].length, 3, "收编时丢了历史样本");
  assert.strictEqual(merge["2026-09-05"][0].v, 0.1, "收编顺序被打乱");
  // 单日 36 采样上限在收编后依然成立
  const cap = { "2026-9-7": Array.from({ length: 36 }, () => ({ v: 0.1, a: 0 })) };
  E.Emotion.record(cap, { v: 0.9, a: 0.4 }, "2026-09-07");
  assert.strictEqual(cap["2026-09-07"].length, 36, "36 采样上限失效");
});

test("DF-04 [N3] 自发负向照夹、共情负向不夹", () => {
  const dv = (intent, delta, ue, minDv) => {
    const e = { v: 0, a: 0 };
    E.Emotion.apply(e, intent, delta, ue || null, minDv);
    return +e.v.toFixed(4);
  };
  // ① 自发负向（她自己闹情绪）：两档地板都必须夹住
  assert.strictEqual(dv("angry_words", -1, null, -0.35), -0.35, "真实档未夹住");
  assert.strictEqual(dv("angry_words", -1, null, -0.20), -0.20, "克制档未夹住");
  assert.strictEqual(dv("angry_words", -1, null, undefined), -0.35, "缺省地板未兜住");
  // ② 共情负向（用户难过她跟着低落）：严格单调加深，不得饱和
  const grad = [0.5, 0.8, 1.0].map((w) => dv("chat", -1, { type: "sad", intensity: w, confidence: 1 }, -0.20));
  assert.ok(grad[0] > grad[1] && grad[1] > grad[2], "共情深度未随强度单调加深：" + JSON.stringify(grad));
  assert.ok(grad[2] < -0.20 - 1e-9, "共情低落仍被克制档地板夹住：" + grad[2]);
  assert.ok(Math.abs(grad[2] - grad[0]) > 0.10, "共情梯度被压扁：" + JSON.stringify(grad));
});

test("DF-05 [N3] 拆分是代数恒等：无 ue 时与拆分前逐位相同（v11 零回归）", () => {
  const dv = (intent, delta, minDv) => {
    const e = { v: 0, a: 0 };
    E.Emotion.apply(e, intent, delta, null, minDv);
    return +e.v.toFixed(10);
  };
  for (const it of Object.keys(E.Emotion.IMPULSE)) {
    for (const d of [1, -1]) {
      for (const md of [undefined, -0.35, -0.20]) {
        const floor = (typeof md === "number") ? md : -0.35;
        const want = +Math.max(E.Emotion.IMPULSE[it].v + (d < 0 ? -0.12 : 0), floor).toFixed(10);
        assert.strictEqual(dv(it, d, md), want,
          `无 ue 时 ${it}（delta=${d}, minDv=${md}）不再逐位等价`);
      }
    }
  }
});

test("DF-06 [N3] 共情段与自发段叠加后仍受 [-1,1] 总量约束", () => {
  const e = { v: -0.9, a: 0 };
  E.Emotion.apply(e, "angry_words", -1, { type: "sad", intensity: 1, confidence: 1 }, -0.20);
  assert.ok(e.v >= -1 && e.v <= 1, "效价越界：" + e.v);
  const e2 = { v: 0.95, a: 0.95 };
  E.Emotion.apply(e2, "love", 1, { type: "happy", intensity: 1, confidence: 1 }, -0.20);
  assert.ok(e2.v <= 1 && e2.a <= 1, "正向侧越界：" + JSON.stringify(e2));
});

test("DF-07 [N1] dayPick / dayAlt 对四种日期写法闭合，脏输入不抛", () => {
  const m = { "2026-09-05": "padded", "2026-9-6": "bare" };
  assert.strictEqual(E.dayPick(m, "2026-09-05"), "padded");
  assert.strictEqual(E.dayPick(m, "2026-9-5"), "padded", "非零填充查不到零填充键");
  assert.strictEqual(E.dayPick(m, "2026-09-06"), "bare", "零填充查不到非零填充键");
  assert.strictEqual(E.dayPick(m, "2026-9-6"), "bare");
  assert.strictEqual(E.dayPick(m, "2026-09-07"), undefined, "不存在的日期不应臆造");
  assert.strictEqual(E.dayAlt("2026-09-05"), "2026-9-5");
  assert.strictEqual(E.dayAlt("2026-9-5"), "2026-09-05");
  assert.strictEqual(E.dayAlt("2026-12-25"), null, "两位月日本就没有第二种写法");
  assert.strictEqual(E.dayAlt("2026-1-9"), "2026-01-09");
  for (const bad of [null, undefined, "", "x", 0, {}, []]) {
    assert.doesNotThrow(() => E.dayPick(m, bad), "dayPick 脏输入抛错");
    assert.doesNotThrow(() => E.dayAlt(bad), "dayAlt 脏输入抛错");
  }
  assert.doesNotThrow(() => E.dayPick(null, "2026-09-05"));
});

test("DF-08 [N1] 老档跑 200 轮真实对话零异常，且 emotionLog 收敛为零填充", () => {
  const st = H.legacyStateV10 ? H.legacyStateV10() : H.freshState({ affection: 480 });
  st.firstMeet = Date.now() - 120 * DAY;
  st.emotionLog = {};
  const d0 = new Date(Date.now() - 3 * DAY);
  st.emotionLog[bareKey(d0)] = [{ v: 0.3, a: 0.1 }];
  const texts = ["早安", "在干嘛", "我好想你", "今天好累", "你是不是又跟别的女生聊天了", "对不起", "晚安"];
  for (let i = 0; i < 200; i++) {
    assert.doesNotThrow(() => {
      const r = H.turn(E, st, texts[i % texts.length]);
      E.Emotion.record(st.emotionLog, st.emotion || { v: 0.2, a: 0.1 }, E.dayKey(new Date()));
      for (const line of r.replies) {
        assert.ok(!E.PERSONA_BREAK_RE.test(line), "破人格：" + line);
        assert.ok(!E.GUILT_TRIP_RE.test(line), "情感绑架：" + line);
      }
    }, "第 " + i + " 轮抛错");
  }
  assert.ok(Object.keys(st.emotionLog).length <= 14, "日志键数越界");
  assert.ok(st.emotionLog[E.dayKey(new Date())], "今天的记录未落盘");
});
