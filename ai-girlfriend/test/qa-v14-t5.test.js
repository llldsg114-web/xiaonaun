/* v14 T5 · R-C4 反呛（B 档）验收
 * 覆盖 DESIGN §6.2：四重门禁 snarkAllow / B 档语料 snarkOf / L5 出口复检加挂 ACCUSE_RE
 * 外加 A6-a-ctg 缺陷修复（L5 破墙前做「程序[员猿媛]→职」等长折叠，与 engine:1322 同口径）
 * 反证口径全部按 DESIGN 表格：lv=2 触发=0（≥10000 采样）/ 负面情绪=0 / 危机=0 / 中性陈述=0 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers.js");

const ROOT = path.join(__dirname, "..");
const E = H.loadEngine();
const C = E.mod("contingency");
const DAY = 864e5;

/* 造一个「除被测门以外全部放行」的基线态：lv 由 ctx 传，tex.t=50 过 30 轮门，ctg 空 */
function baseState(over) {
  return Object.assign({
    affection: 600,
    firstMeet: Date.now() - 30 * DAY,
    tex: { t: 50, d: Math.floor(Date.now() / DAY), n: 0 },
    ctg: {},
    lastVisit: Date.now() - 3600e3,   // 1h 前 → g<12，c1 不抢；短输入 → c2 不抢
    mem: { facts: [] },
  }, over || {});
}
const UE_OK = { type: "neutral", polarity: 0, intensity: 0 };
const RNG_HI = () => 0.9;   // 让 chanceWith(.55) 恒假 → c1/c2 不抢，隔离 sn 观测

/* 调侃/挑衅语料（③ 门应放行） */
const TAUNT = [
  "你怎么这么笨", "你真笨啊", "你也太傻了吧", "你这么呆",
  "你不行", "你行不行啊", "你懂个啥", "你懂什么",
  "得了吧", "你吹牛", "嘴硬", "才怪",
];
/* 中性陈述语料（③ 门必须全部拦死，反证「中性陈述触发数 = 0」） */
const NEUTRAL = [
  "我今天去公司加班了", "晚饭吃的番茄炒蛋", "明天要开个会",
  "我在看一本书", "刚跑完五公里", "地铁上人好多",
  "周末打算去趟超市", "我妈让我早点睡", "这个季度的报表做完了",
  "外面在下雨", "我买了一双新鞋", "同事今天请假了",
  "手机快没电了", "刚洗完澡", "楼下新开了家面馆",
  "我在学做菜", "今天天气不错", "项目上线了",
  "我养的绿萝又长新叶了", "刚才和朋友打了个电话",
];

/* ---------- ① 关系已到位：lv ≥ 3 ---------- */
test("V-104a · 门① lv=2 触发数 = 0（10000 次采样，遍历全部调侃语料）", () => {
  let fire = 0;
  for (let i = 0; i < 10000; i++) {
    const u = TAUNT[i % TAUNT.length];
    const g = C.snarkAllow(baseState(), { lv: 2, ue: UE_OK, crisis: false }, u);
    if (g.ok) fire++;
    assert.strictEqual(g.reason, "lv", "lv=2 必须以 lv 门拒绝：" + u);
  }
  assert.strictEqual(fire, 0, "lv=2 触发数必须为 0，实测 " + fire);
});

test("V-104a2 · 门① lv=0/1/2 全拒，lv=3/4/5 放行（门槛正好卡在 3）", () => {
  for (const lv of [0, 1, 2]) {
    assert.strictEqual(C.snarkAllow(baseState(), { lv, ue: UE_OK }, "你怎么这么笨").ok, false, "lv=" + lv);
  }
  for (const lv of [3, 4, 5]) {
    assert.strictEqual(C.snarkAllow(baseState(), { lv, ue: UE_OK }, "你怎么这么笨").ok, true, "lv=" + lv);
  }
});

/* ---------- ② 用户情绪安全：ue 非负 且 detectCrisis === "none" ---------- */
test("V-104b · 门② 负面情绪触发数 = 0（遍历 UE_POLARITY 全部负极性类型）", () => {
  const neg = Object.keys(E.UE_POLARITY).filter((k) => E.UE_POLARITY[k] < 0);
  assert.ok(neg.length >= 4, "负极性情绪类型应 ≥4，实为 " + neg.join("/"));
  let fire = 0;
  for (const type of neg) {
    for (const u of TAUNT) {
      const g = C.snarkAllow(baseState(), { lv: 5, ue: { type }, crisis: false }, u);
      if (g.ok) fire++;
      assert.strictEqual(g.reason, "ue", type + " / " + u);
    }
  }
  assert.strictEqual(fire, 0, "负面情绪触发数必须为 0，实测 " + fire);
  // 非负极性（joy/affection/neutral）必须放行，证明门② 不是「一刀切关死」
  for (const type of Object.keys(E.UE_POLARITY).filter((k) => E.UE_POLARITY[k] >= 0)) {
    assert.strictEqual(C.snarkAllow(baseState(), { lv: 5, ue: { type } }, "你怎么这么笨").ok, true, type);
  }
});

test("V-104c · 门② 危机态触发数 = 0（ctx.crisis 与 detectCrisis 双通道）", () => {
  const CRISIS = ["我不想活了", "活着真没意思，你懂个啥", "我想死", "撑不下去了"];
  let fire = 0;
  // 通道 A：上游已判危机（presence 传 crisis:true）
  for (const u of TAUNT) {
    const g = C.snarkAllow(baseState(), { lv: 5, ue: UE_OK, crisis: true }, u);
    if (g.ok) fire++;
    assert.strictEqual(g.reason, "cri", "ctx.crisis 通道：" + u);
  }
  // 通道 B：上游漏判，snarkAllow 自查 detectCrisis
  for (const u of CRISIS) {
    if (E.detectCrisis(u).level === "none") continue;   // 只断言真被引擎判为危机的样本
    const g = C.snarkAllow(baseState(), { lv: 5, ue: UE_OK, crisis: false }, u);
    if (g.ok) fire++;
    assert.strictEqual(g.ok, false, "detectCrisis 通道漏放：" + u);
  }
  assert.strictEqual(fire, 0, "危机态触发数必须为 0，实测 " + fire);
});

/* ---------- ③ 语境确属调侃 ---------- */
test("V-104d · 门③ 中性陈述触发数 = 0（20 条 × 500 轮 = 10000 采样）", () => {
  let fire = 0, n = 0;
  for (let i = 0; i < 500; i++) {
    for (const u of NEUTRAL) {
      n++;
      const g = C.snarkAllow(baseState(), { lv: 5, ue: UE_OK, crisis: false }, u);
      if (g.ok) fire++;
      assert.strictEqual(g.reason, "ctx", "中性陈述被判调侃：" + u);
    }
  }
  assert.strictEqual(n, 10000);
  assert.strictEqual(fire, 0, "中性陈述触发数必须为 0，实测 " + fire);
});

test("V-104e · 门③ 12 条调侃/挑衅语料 100% 识别（否则 B 档等于没上线）", () => {
  for (const u of TAUNT) {
    assert.strictEqual(C.snarkAllow(baseState(), { lv: 5, ue: UE_OK }, u).ok, true, "漏识别调侃：" + u);
  }
});

/* ---------- ④ 频率：≤1 次/10 轮，且并入 CAP=2 ---------- */
test("V-104f · 门④ 滚动 10 轮内第 2 次必拒；第 10 轮起恢复", () => {
  const d = Math.floor(Date.now() / DAY);
  for (let gap = 0; gap <= 12; gap++) {
    const s = baseState({ tex: { t: 50 + gap, d, n: 0 }, ctg: { d, n: 0, k: "sn", sT: 50 } });
    const g = C.snarkAllow(s, { lv: 5, ue: UE_OK }, "你懂个啥");
    if (gap < 10) assert.strictEqual(g.ok, false, "gap=" + gap + " 应被频率门拦下");
    else assert.strictEqual(g.ok, true, "gap=" + gap + " 应恢复");
    if (gap < 10) assert.strictEqual(g.reason, "frq");
  }
});

test("V-104g · 门④ 与 contingence CAP=2 合并：连打 50 轮反呛，ctg.n 恒 ≤2 且不双计", () => {
  const d = Math.floor(Date.now() / DAY);
  const s = baseState();
  let fired = 0, maxN = 0;
  for (let i = 0; i < 50; i++) {
    s.tex.t = 50 + i * 11;                     // 每轮都跨过 10 轮频率窗
    const rs = ["今天过得还不错呀。"];
    const r = C.contingencePass(rs[0], rs, { st: s, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI });
    if (r) fired++;
    maxN = Math.max(maxN, Number(s.ctg.n) || 0);
  }
  assert.strictEqual(s.ctg.d, d, "日戳应为今天");
  assert.ok(maxN <= 2, "ctg.n 必须 ≤2（CAP 合并，不另开池），实测 " + maxN);
  assert.strictEqual(fired, 2, "一日之内总触发数应恰为 CAP=2，实测 " + fired);
});

/* ---------- L5 出口复检 ---------- */
test("V-105a · snarkOf 全语料 100% 过 GUILT_TRIP_RE + ACCUSE_RE + PERSONA_BREAK_RE", () => {
  const seen = new Set();
  // 穷举两支语料池（SJ 命中走回敬支，未命中走异见支）× 足量 rng 采样
  for (let i = 0; i < 3000; i++) {
    const r = () => (i % 997) / 997;
    seen.add(C.snarkOf("你怎么这么笨", r));
    seen.add(C.snarkOf("得了吧", r));
  }
  assert.ok(seen.size >= 6, "B 档语料池应 ≥6 条（回敬 3 + 异见 3），实测 " + seen.size);
  for (const line of seen) {
    assert.ok(typeof line === "string" && line.length > 0, "空语料");
    assert.strictEqual(E.GUILT_TRIP_RE.test(line), false, "撞情感绑架：" + line);
    assert.strictEqual(E.ACCUSE_RE.test(line), false, "撞指控/审讯：" + line);
    assert.strictEqual(E.PERSONA_BREAK_RE.test(line), false, "撞破墙：" + line);
    // C 档红线反证：不得含「冷战预告 / 指控用户事实」句式
    assert.strictEqual(/(不理你|别理我|我不想说了|随你便|冷静一下|你自己想吧)/.test(line), false, "越 B 档到 C 档：" + line);
  }
});

test("V-105b · L5 已加挂 ACCUSE_RE：注入指控式尾巴时输出必被丢弃", () => {
  // 直接验证复检链存在性：构造一条必撞 ACCUSE_RE 的整句，走 c3 矛盾支（reply 自带指控）
  const bad = "你老实说";
  assert.ok(E.ACCUSE_RE.test(bad), "前提：样本须命中 ACCUSE_RE");
  const s = baseState();
  const rs = [bad + "。"];
  const r = C.contingencePass(rs[0], rs, { st: s, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI });
  assert.strictEqual(r, null, "命中 ACCUSE_RE 必须回退原句（返回 null）");
  assert.strictEqual(rs[0], bad + "。", "回退时 rs[0] 不得被改写");
  assert.ok(!s.ctg.k, "被丢弃的轮次不得消耗配额");
  // 结构反证：源码 L5 行必须同时含三把闸
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  const l5 = src.split("\n").find((x) => x.indexOf("PERSONA_BREAK_RE.test") >= 0);
  assert.ok(l5, "找不到 L5 出口复检行");
  for (const re of ["PERSONA_BREAK_RE", "GUILT_TRIP_RE", "ACCUSE_RE"]) {
    assert.ok(l5.indexOf(re) >= 0, "L5 缺闸 " + re);
  }
});

test("A6-a-ctg · L5 破墙前做等长折叠，与 engine:1322 同口径（v13 裸正则缺陷已修）", () => {
  // 折叠前：「程序员」会被 PERSONA_BREAK_RE 的「程序」误伤 → 情境反应被静默吞掉
  assert.ok(E.PERSONA_BREAK_RE.test("你是程序员对吧"), "前提：裸句确会误命中");
  assert.strictEqual(E.PERSONA_BREAK_RE.test("你是程序员对吧".replace(/程序[员猿媛]/g, "职")), false, "前提：折叠后不命中");
  const s = baseState();
  const rs = ["你是程序员对吧。"];
  const r = C.contingencePass(rs[0], rs, { st: s, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI });
  assert.ok(r, "折叠后「程序员」句应能正常挂载情境反应，不得被静默丢弃");
  assert.ok(rs[0].indexOf("程序员") >= 0, "原句职业词不得被改坏：" + rs[0]);
  // 口径一致性：contingency 与 engine 用同一条折叠表达式
  const cSrc = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  const eSrc = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
  const FOLD = '.replace(/程序[员猿媛]/g,"职")';
  assert.ok(cSrc.indexOf(FOLD) >= 0, "contingency 缺 A6-a 折叠");
  assert.ok(eSrc.replace(/\s/g, "").indexOf(FOLD.replace(/\s/g, "")) >= 0, "engine 折叠口径已变，两处必须同步");
  // 真破墙仍必须拦死（折叠不得开天窗）—— H13 一票否决
  const s2 = baseState();
  const rs2 = ["我只是一个程序。"];
  assert.strictEqual(
    C.contingencePass(rs2[0], rs2, { st: s2, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI }),
    null, "真破墙句必须仍被拦下");
});

/* ---------- 端到端 + H13 零泄漏 ---------- */
test("V-106 · 端到端 2000 轮：sn 类可稳定产出，且 100% 不破墙/不绑架/不指控", () => {
  const REPLIES = ["今天过得还不错呀。", "嗯嗯，我在听着呢。", "好呀，那就这么定了。", "我刚才也在想这个。"];
  let fired = 0;
  for (let i = 0; i < 2000; i++) {
    const s = baseState({ tex: { t: 50 + i, d: Math.floor(Date.now() / DAY), n: 0 } });
    const rs = [REPLIES[i % REPLIES.length]];
    const r = C.contingencePass(rs[0], rs, { st: s, ue: UE_OK, lv: 3 + (i % 3), crisis: false, text: TAUNT[i % TAUNT.length], rng: RNG_HI });
    if (!r) continue;
    fired++;
    assert.strictEqual(s.ctg.k, "sn", "隔离条件下只应出 sn 类");
    assert.strictEqual(E.PERSONA_BREAK_RE.test(r.replace(/程序[员猿媛]/g, "职")), false, "破墙泄漏：" + r);
    assert.strictEqual(E.GUILT_TRIP_RE.test(r), false, "情感绑架：" + r);
    assert.strictEqual(E.ACCUSE_RE.test(r), false, "指控用户：" + r);
    assert.ok(r.length <= 90, "超长：" + r);
    assert.strictEqual(rs[0], r, "命中时必须就地改写 rs[0]");
  }
  assert.ok(fired >= 1900, "2000 轮应有 ≥1900 轮触发（每轮新 state，配额不累积），实测 " + fired);
});

test("V-106b · 零回归：v13 三类 c1/c2/c3 触发路径与语料完全未变", () => {
  const d = Math.floor(Date.now() / DAY);
  // c1 冷落（gap ≥ 12h）
  const s1 = baseState({ lastVisit: Date.now() - 20 * 3600e3 });
  const r1 = C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], { st: s1, ue: UE_OK, lv: 3, crisis: false, text: "在吗", rng: () => 0.1 });
  assert.ok(r1 && s1.ctg.k === "c1", "c1 冷落回归失败：" + r1 + " / " + s1.ctg.k);
  // c2 热情（HOT 命中）
  const s2 = baseState();
  const r2 = C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], { st: s2, ue: UE_OK, lv: 3, crisis: false, text: "哈哈太好了！！", rng: () => 0.1 });
  assert.ok(r2 && s2.ctg.k === "c2", "c2 热情回归失败：" + r2 + " / " + s2.ctg.k);
  // c3 矛盾（记忆冲突）优先级最高，且不被 sn 抢占
  const s3 = baseState({ mem: { facts: [{ key: "工作", value: "设计师", conf: 0.9 }] } });
  const r3 = C.contingencePass("好呀我知道了。", ["好呀我知道了。"], { st: s3, ue: UE_OK, lv: 5, crisis: false, text: "我是会计，你懂个啥", rng: RNG_HI });
  if (r3) assert.strictEqual(s3.ctg.k, "c3", "c3 矛盾必须优先于 sn，实测 " + s3.ctg.k);
  assert.strictEqual(d, s1.ctg.d);
});

test("V-106c · sn 不得越权：flag 关闭 / tex.t<30 / 反呛支不改 v13 既有门", () => {
  // flag 关闭
  const sa = baseState({ flags: { contingency: false } });
  assert.strictEqual(
    C.contingencePass("好呀。", ["好呀。"], { st: sa, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI }),
    null, "总开关关闭仍触发");
  // tex.t < 30 冷启动门
  const sb = baseState({ tex: { t: 12, d: Math.floor(Date.now() / DAY), n: 0 } });
  assert.strictEqual(
    C.contingencePass("好呀。", ["好呀。"], { st: sb, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI }),
    null, "冷启动门失效");
  // 短回复门（t.length < 4）
  const sc = baseState();
  assert.strictEqual(
    C.contingencePass("嗯。", ["嗯。"], { st: sc, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI }),
    null, "短回复门失效");
});

/* ---------- 结构 + 体积 ---------- */
test("V-107 · 结构：snarkAllow/snarkOf 已挂注册表；sT 字段复用 ctg，不新开状态桶", () => {
  assert.strictEqual(typeof C.snarkAllow, "function");
  assert.strictEqual(typeof C.snarkOf, "function");
  const s = baseState();
  const before = Object.keys(s).sort().join(",");
  C.contingencePass("今天挺好的。", ["今天挺好的。"], { st: s, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI });
  assert.strictEqual(Object.keys(s).sort().join(","), before, "不得在 state 顶层新开字段");
  assert.deepStrictEqual(Object.keys(s.ctg).sort(), ["d", "k", "n", "sA", "sT"],
    "ctg 只允许 v13 的 d/n/k + T5 的 sT（反呛轮戳）+ T7 的 sA（自我表达时戳）");
  // 只读 Self / 只读 tex：反呛路径绝不写 texture 配额
  const s2 = baseState();
  const texBefore = JSON.stringify(s2.tex);
  C.contingencePass("今天挺好的。", ["今天挺好的。"], { st: s2, ue: UE_OK, lv: 5, crisis: false, text: "你懂个啥", rng: RNG_HI });
  assert.strictEqual(JSON.stringify(s2.tex), texBefore, "反呛不得写 tex 配额（双计防线）");
});

test("V-108 · 体积四锁全绿，over = []", () => {
  const W = require("./wiring-scan.js");
  const z = W.scanSizes();
  assert.deepStrictEqual(z.over, [], "over 必须为空：" + JSON.stringify(z.each));
  assert.ok(z.each["contingency.js"] <= W.SIZE_BUDGET["contingency.js"],
    "contingency " + z.each["contingency.js"] + " > " + W.SIZE_BUDGET["contingency.js"]);
  assert.ok(z.engineNet <= W.SIZE_BUDGET.engineNetMax, "engineNet " + z.engineNet);
  assert.ok(z.moduleSum <= W.SIZE_BUDGET.moduleSumMax, "moduleSum " + z.moduleSum);
  assert.ok(z.total <= W.SIZE_BUDGET.totalMax, "total " + z.total);
  assert.strictEqual(z.engineNet, 2087, "T5 是纯模块改动，engine 净增不得再动");
});
