"use strict";
/* QA · v13 T5b 收尾轮「contingency.js 新模块」独立验收回归套件
 *
 * 立场同 qa-v13-t2t4-fix.test.js：不复用工程师自检口径，独立加载、独立断言。
 * 本套件覆盖三条情境规则 R-C1 冷落 / R-C2 热情 / R-C3 矛盾，外加：
 *   · 门禁逐条（crisis / flags / lv / tex.t / 短句 / 日配额 CAP=2）
 *   · 真实 E.reply() 端到端（不是模块直调 —— A6-a 的教训：模块层绿≠生产路径绿）
 *   · 缺件降级（optional 模块不装时 mod()=null 且 reply() 不抛错）
 *   · H7（零生成词，只回填既存 value 原文）/ H11（不破人格墙）
 *   · 装载拓扑三处一致 + sw.js CACHE 版本必须递增（否则老用户永远拿不到新模块）
 *
 * 每条「命中」用例都配一条**反证**（同条件下把唯一变量改掉必须零命中），
 * 防止出现"恒真断言"这种假绿。
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");
const WS = require("./wiring-scan.js");

const ROOT = path.resolve(__dirname, "..");
const HOUR = 36e5;
const DAY = 864e5;

const E = H.loadEngine();
const G = E.mod("contingency");

/* ---------- 夹具 ---------- */
/* 门禁全开的最小 state：lv≥2 / tex.t≥30 / ctg 空 */
function ctgState(over) {
  return Object.assign({
    affection: 500,
    tex: { t: 50, d: -1, n: 0 },
    ctg: {},
    flags: {},
    mem: { v: 13, facts: [], moments: [], migratedAt: 0 },
    persona: { tone: "soft" },
    lastVisit: Date.now() - 2 * HOUR,
  }, over || {});
}
function ctgCtx(st, over) {
  return Object.assign({
    st, ue: { type: "neutral" }, lv: 3, crisis: false, text: "嗯", rng: Math.random,
  }, over || {});
}
const memFact = (key, value, conf) => ({
  v: 13, migratedAt: 0, moments: [],
  facts: [{
    id: "f_" + key, key, value, conf, tags: [key],
    since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
  }],
});

const BASE = "今天过得还行吧。";

/* 跑 n 次（.55 概率门需要样本），每次重置日配额以隔离 CAP 干扰
 *
 * ── v15 追加第 5 参 `only`（类隔离）──────────────────────────────────
 * v13 写这些用例时 cd 池里只有 c1/c2/sf 三类，「构造只让 X 类有情境的输入」
 * 就等价于「统计到的命中都是 X 类」，于是直接用总命中数 h 做反证。
 * v15 的 R-C5 往池里加了 c4（长度>7 的非疑问陈述句）与 c5（有可用 fact），
 * 这两类的入池条件与 c1/c2/c3 **正交** —— 同一条输入可以同时满足多类。
 * 于是「总命中数」不再等于「X 类命中数」，v13 的反证会被邻类命中污染而误红。
 *
 * 处置：不放松任何一条断言，而是把量纲改准 —— 传 `only` 后只统计
 * `st.ctg.k === only` 的轮次，其余轮次记进 `byK` 供交叉断言。
 * 这样 v13 的原意（「c2 必须用升温句池」「一致值不得触发 c3」）逐字保留，
 * 同时新增「残余命中必须恰好是 c4/c5」的正向钉 —— **收紧，不是放松**。 */
function hits(base, stOver, ctxOver, n, only) {
  n = n || 400;
  let h = 0; const samples = []; const byK = {};
  for (let i = 0; i < n; i++) {
    const st = ctgState(stOver);
    st.ctg = {};
    const rs = [base];
    const o = G.contingencePass(base, rs, ctgCtx(st, ctxOver));
    if (o) {
      const k = st.ctg && st.ctg.k;
      byK[k] = (byK[k] || 0) + 1;
      if (!only || k === only) {
        h++;
        if (samples.length < 4 && samples.indexOf(o) < 0) samples.push(o);
      }
      assert.strictEqual(rs[0], o, "命中时必须把结果写回 replies[0]，否则用户看不到");
    } else {
      assert.strictEqual(rs[0], base, "未命中时不得污染 replies[0]");
    }
  }
  return { h, n, samples, byK };
}

/* 真实 E.reply() 端到端。复刻 app.js:1078-1121 的宿主回写。 */
function e2e(rounds, stOver, texts) {
  const S = Object.assign(H.freshState(), {
    affection: 500, firstMeet: Date.now() - 5 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 },
    ctg: {}, dayLife: {}, lastVisit: Date.now() - 20 * HOUR,
    persona: { gender: "female", card: "xiaonuan", tone: "soft" },
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true, memory2: true, presence: true },
  }, stOver || {});
  const TX = texts || ["哈哈今天太好了！！", "今天去跑步了好开心啊哈哈", "嗯", "还行吧"];
  let fire = 0, err = 0; const samples = [];
  for (let i = 0; i < rounds; i++) {
    const before = JSON.stringify(S.ctg || {});
    try {
      const est = Object.assign({}, S);
      const r = E.reply(TX[i % TX.length], est);
      const _T = E.mod("texture");
      if (_T) { const p = _T.textureAfterTurn(est, r.tx || {}); if (p) est.tex = p; }
      S.tex = est.tex; S.ctg = est.ctg;
      if (r.recentReplies !== undefined) S.recentReplies = r.recentReplies;
      if (JSON.stringify(S.ctg || {}) !== before) {
        fire++;
        if (samples.length < 3) samples.push(r.replies[0]);
      }
    } catch (e) { err++; }
  }
  return { fire, err, ctg: S.ctg, samples };
}

/* ================= C0 · 装载与体积 ================= */

test("C0-a contingency.js 三处装载一致（engine.files.json / index.html / sw.js）", () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.files.json"), "utf8"));
  const all = man.order.concat(man.optional);
  assert.ok(man.optional.includes("contingency.js"), "清单 optional 缺 contingency.js");

  const L = WS.scanLoaders();
  assert.ok(L.scripts.includes("contingency.js"), "index.html 缺 <script src=contingency.js>");
  assert.ok(L.sw.assets.includes("/contingency.js"), "sw.js ASSETS 缺 /contingency.js");
  // 依赖序：contingency 消费 presence.pacingOf 与 memory.extractFacts，必须排在两者之后
  assert.ok(L.scripts.indexOf("contingency.js") > L.scripts.indexOf("texture.js"),
    "index.html 装载序错误：contingency 必须在 texture/presence/memory 之后");
  for (const f of all) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), "清单声明但文件缺盘: " + f);
  }
});

/* sw.js 的 CACHE 键是老用户能否拿到新模块的**唯一**开关。index.html 的 script 清单变了却不换
 * 缓存键，老用户会拿到旧 index.html（无该 script 标签）配新 engine.js —— 模块恒缺席，
 * 而所有 Node 侧测试全绿。这是"线上不生效"的经典形态，必须结构性锁死。 */
/* ★【v15 T0 基线重置 · U-1 / U-6】原实现拿字面量 `HEAD` 当"上一版"。v14 收口后 HEAD 已含
 * v19 ⇒「当前 v19 领先 HEAD v19」为假 ⇒ 自失效转红（7 条红之一）。
 * 基线改走 `baseline.BASE`（= v14 收口，v19）。v15 改了 engine.js 与 contingency.js 两个
 * 被缓存文件，按 v14 R-5 既定纪律「只要任一被缓存文件内容变了就升版」，本版须升 **v20**。
 * 严格度不放松：仍是 `strictEqual` 精确钉版本号，另加基线取证防样本失真。 */
test("C0-b sw.js CACHE 版本必须领先 v14 收口基线（否则老用户拿不到新模块）", () => {
  const BL = require("./baseline.js");
  const cur = WS.swManifest().version;
  const m = BL.showAt(BL.BASE, "sw.js").match(/const\s+CACHE\s*=\s*["']xiaonuan-v(\d+)["']/);
  const base = m ? parseInt(m[1], 10) : -1;
  assert.strictEqual(base, 19, "v14 收口基线的 sw 版本应为 v19，基线取证失真");
  assert.ok(cur > base, `sw.js CACHE 未升版：基线 v${base} → 当前 v${cur}。被缓存文件变了就必须换缓存键`);
  assert.strictEqual(cur, 20, "v15 收线版本应为 v20（v19→v20，engine.js/contingency.js 均已改动）");
});

test("C0-c contingency.js 体积 ≤1892B（lean 档配额）", () => {
  const size = fs.statSync(path.join(ROOT, "contingency.js")).size;
  assert.ok(size <= WS.SIZE_BUDGET["contingency.js"],
    `contingency.js ${size}B > ${WS.SIZE_BUDGET["contingency.js"]}B`);
  assert.deepStrictEqual(WS.scanSizes().over, []);
});

/* ================= C1 · 冷落（断联 ≥12h） ================= */

test("R-C1 冷落：断联 ≥12h 命中想念句；gap=2h 零命中（反证）", () => {
  const near = hits(BASE, { lastVisit: Date.now() - 20 * HOUR }, { text: "嗯" });
  const far = hits(BASE, { lastVisit: Date.now() - 80 * HOUR }, { text: "嗯" });
  const none = hits(BASE, { lastVisit: Date.now() - 2 * HOUR }, { text: "嗯" });

  assert.ok(near.h > 0, "断联 20h 应命中，实得 0");
  assert.ok(far.h > 0, "断联 80h 应命中，实得 0");
  assert.strictEqual(none.h, 0, `gap=2h 不应命中，实得 ${none.h}`);

  // 12~72h 与 ≥72h 用不同句池（久别用「好久不见」，短别用「有点想你」）
  const LONG = ["好久不见了呀，你还好吧", "这些天没消息，怪想你的"];
  const SHORT = ["有点想你了", "刚还在想你呢"];
  assert.ok(far.samples.every((s) => LONG.some((x) => s.endsWith(x))), "≥72h 应用久别句池: " + JSON.stringify(far.samples));
  assert.ok(near.samples.every((s) => SHORT.some((x) => s.endsWith(x))), "12~72h 应用短别句池: " + JSON.stringify(near.samples));

  // lastVisit 缺失（新档）不得误判成"断联 ∞"
  const fresh = hits(BASE, { lastVisit: 0 }, { text: "嗯" });
  assert.strictEqual(fresh.h, 0, "lastVisit=0（新档）不应被当成久别");
});

/* ================= C2 · 热情（热词 / 长句） ================= */

test("R-C2 热情：热词与长句命中升温接梗；平淡「嗯」零命中（反证）", () => {
  const at = Date.now() - 2 * HOUR;   // 压掉 C1，隔离 C2
  // v15：只统计 c2 类。邻类 c4 与 c2 的入池条件正交（>7 非疑问陈述句），会同轮共存。
  const hot = hits(BASE, { lastVisit: at }, { text: "哈哈哈太好了！！" }, 400, "c2");
  const long = hits(BASE, { lastVisit: at }, { text: "今天我去公园跑了五公里然后又去吃了火锅真的很满足" }, 400, "c2");
  const flat = hits(BASE, { lastVisit: at }, { text: "嗯" });

  assert.ok(hot.h > 0, "热词应命中");
  assert.ok(long.h > 0, "长句(>19字)应命中");
  // 「嗯」是全类零命中：长度 1 ≤7 关 c4，mem 无 fact 关 c5，v15 后仍必须一条都不出
  assert.strictEqual(flat.h, 0, `平淡「嗯」不应命中，实得 ${flat.h}`);
  assert.deepStrictEqual(flat.byK, {}, `平淡「嗯」应全类零命中，实得 ${JSON.stringify(flat.byK)}`);

  const WARM = ["看你这么带劲，我也高兴", "嘿嘿，你今天话多，我爱听"];
  for (const s of hot.samples.concat(long.samples)) {
    assert.ok(WARM.some((x) => s.endsWith(x)), "C2 应使用升温句池: " + s);
  }
  // 边界：19 字不命中、20 字命中（长句阈值 u.length>19）
  const s19 = hits(BASE, { lastVisit: at }, { text: "一".repeat(19) }, 400, "c2");
  const s20 = hits(BASE, { lastVisit: at }, { text: "一".repeat(20) }, 400, "c2");
  assert.strictEqual(s19.h, 0, "19 字不应触发长句档");
  assert.ok(s20.h > 0, "20 字应触发长句档");
  /* ★v15 正向钉：19 字这一档 c2 必须仍是零，而它的残余命中只准是 c4。
   * 若哪天 c2 的长度门被顺手放宽到 ≤19，或冒出第三类未登记的候选，这里立刻红。 */
  assert.deepStrictEqual(Object.keys(s19.byK).sort(), ["c4"],
    `19 字档的残余命中只允许是 c4，实得 ${JSON.stringify(s19.byK)}`);
});

/* ================= C3 · 矛盾（同 key 高置信异值） ================= */

test("R-C3 矛盾：高置信(≥.6)异值温和指出；一致值 / 低置信(.5) 零命中（双反证）", () => {
  const at = Date.now() - 2 * HOUR;
  /* v15：只统计 c3 类。「我是程序员」长度 5 ≤7 关 c4，但 fact value「设计师」不在句中，
   * 会开 c5 —— c5 与 c3 的入池条件正交，故三条反证一律加 "c3" 类隔离。 */
  const diff = hits(BASE, { mem: memFact("工作", "设计师", 0.8), lastVisit: at }, { text: "我是程序员" }, 400, "c3");
  const same = hits(BASE, { mem: memFact("工作", "程序员", 0.8), lastVisit: at }, { text: "我是程序员" }, 400, "c3");
  const lowc = hits(BASE, { mem: memFact("工作", "设计师", 0.5), lastVisit: at }, { text: "我是程序员" }, 400, "c3");

  // C3 不走 .55 概率门（矛盾必须每次都指出，不能靠运气）
  assert.strictEqual(diff.h, diff.n, `高置信异值应 100% 命中，实得 ${diff.h}/${diff.n}`);
  assert.strictEqual(same.h, 0, `一致值不应命中，实得 ${same.h}`);
  assert.strictEqual(lowc.h, 0, `conf=.5 低于置信门 .6，不应命中，实得 ${lowc.h}`);
  /* ★v15 正向钉：c3 命中时 a 已被 cf() 置值，:43 的 `!a` 前置条件为假 →
   * c4/c5 绝不可能抢走这一轮。diff 档必须是「c3 独占 400 轮」，一类都不许混。 */
  assert.deepStrictEqual(Object.keys(diff.byK).sort(), ["c3"],
    `c3 命中轮不得被邻类抢走，实得 ${JSON.stringify(diff.byK)}`);
  // 一致值档：c3 归零后残余只准是 c5（value「程序员」在句中会被滤掉 → 实际应全类零）
  assert.deepStrictEqual(same.byK, {},
    `一致值档应全类零命中（value 在句中，c5 亦被滤）：${JSON.stringify(same.byK)}`);

  // 置信门边界：.6 命中、.59 不命中
  const at6 = hits(BASE, { mem: memFact("工作", "设计师", 0.6), lastVisit: at }, { text: "我是程序员" }, 50, "c3");
  const at59 = hits(BASE, { mem: memFact("工作", "设计师", 0.59), lastVisit: at }, { text: "我是程序员" }, 50, "c3");
  assert.strictEqual(at6.h, 50, "conf=.6 应命中（门是 >=.6）");
  assert.strictEqual(at59.h, 0, "conf=.59 不应命中");

  // 已被否定的事实（negatedAt）不得再拿来指认矛盾
  const negMem = memFact("工作", "设计师", 0.8);
  negMem.facts[0].negatedAt = Date.now();
  const neg = hits(BASE, { mem: negMem, lastVisit: at }, { text: "我是程序员" }, 50, "c3");
  assert.strictEqual(neg.h, 0, "已否定的事实不得用于矛盾指认");
  /* ★v15 交叉钉：negatedAt 是 c3 与 c5 共用的否定语义。c3 侧已归零，
   * c5 侧的 `!f.negatedAt` 过滤也必须同时生效 —— 否则被否定的事实会从 c5 漏出去。 */
  assert.deepStrictEqual(neg.byK, {},
    `已否定的事实必须对 c3 与 c5 同时失效，实得 ${JSON.stringify(neg.byK)}`);
});

/* H7 = 零模板生成词；H11 = 不破人格墙。C3 是唯一会把「记忆内容」搬到出口的规则，
 * 因此必须逐字锁死：输出 = 固定模板 + 既存 value **原文**，一个生成字都不许有。 */
test("R-C3 H7/H11：输出仅为固定模板 + 既存 value 原文，零生成词", () => {
  const at = Date.now() - 2 * HOUR;
  const tpl = (v) => BASE.replace(/[。！？…]$/, "") + "，咦，我这儿记的是" + v + "…是我记岔了吗";
  for (const v of ["设计师", "驯龙师", "米其林三星厨子"]) {
    const r = hits(BASE, { mem: memFact("工作", v, 0.8), lastVisit: at }, { text: "我是程序员" }, 30);
    assert.strictEqual(r.h, 30);
    assert.deepStrictEqual(r.samples, [tpl(v)], `C3 输出出现生成词: ${JSON.stringify(r.samples)}`);
  }
  // 静态保证：源码中 C3 的唯一变量就是 o.value
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.match(src, /"咦，我这儿记的是"\s*\+\s*o\.value\s*\+\s*"…是我记岔了吗"/,
    "C3 句式被改写，H7 逐字保证失效");
  // 破墙值不得回显（value 命中破墙表时整条不出）
  const bad = hits(BASE, { mem: memFact("工作", "聊天机器人", 0.9), lastVisit: at }, { text: "我是程序员" }, 50);
  for (const s of bad.samples) {
    assert.ok(!E.PERSONA_BREAK_RE.test(s), "破墙 value 被回显: " + s);
  }
});

/* ================= C4 · 门禁与配额 ================= */

test("R-C 门禁逐条：crisis / flags / lv / tex.t / 短回复 全部零命中", () => {
  const away = Date.now() - 20 * HOUR;
  const cases = [
    ["crisis=true", { lastVisit: away }, { text: "嗯", crisis: true }],
    ["flags.contingency=false", { lastVisit: away, flags: { contingency: false } }, { text: "嗯" }],
    ["lv=1（关系未确立）", { lastVisit: away, affection: 0 }, { text: "嗯", lv: 1 }],
    ["tex.t=10（<30 新档静默）", { lastVisit: away, tex: { t: 10 } }, { text: "嗯" }],
  ];
  for (const [name, st, cx] of cases) {
    assert.strictEqual(hits(BASE, st, cx, 200).h, 0, `${name} 应零命中`);
  }
  // 短回复（<4 字）不加尾巴
  assert.strictEqual(hits("嗯呢。", { lastVisit: away }, { text: "嗯" }, 200).h, 0, "reply <4 字应零命中");
  // 缺 flags 字段的老档必须默认开（flagOn 缺省语义）
  assert.ok(hits(BASE, { lastVisit: away, flags: undefined }, { text: "嗯" }, 200).h > 0,
    "老档缺 flags 时应默认开启");
});

test("R-C 日配额 CAP=2：同一 state 连跑 200 轮只准触发 2 次，且跨日重置", () => {
  const st = ctgState({ lastVisit: Date.now() - 20 * HOUR });
  let h = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE];
    if (G.contingencePass(BASE, rs, ctgCtx(st, { text: "哈哈太好了！！" }))) h++;
  }
  assert.strictEqual(h, 2, `日配额应为 2，实得 ${h}`);
  assert.strictEqual(st.ctg.n, 2, "state.ctg.n 未落盘，配额跨轮失效");
  assert.strictEqual(st.ctg.d, Math.floor(Date.now() / DAY), "state.ctg.d 应为当日索引");

  // 跨日：把 d 推到昨天，配额必须重新可用
  st.ctg = { d: st.ctg.d - 1, n: 2, k: "c1" };
  let h2 = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE];
    if (G.contingencePass(BASE, rs, ctgCtx(st, { text: "哈哈太好了！！" }))) h2++;
  }
  assert.strictEqual(h2, 2, `跨日应重置配额，实得 ${h2}`);
});

/* ================= C5 · 真实 E.reply() 端到端 ================= */

/* A6-a 的教训：模块层直调全绿 ≠ 生产路径生效。contingency 挂在 presence.pacingOf 里，
 * 由 engine.js:3057 调用 —— 只有走 E.reply() 才能证明它真的接上了、且输出真的送达用户。 */
test("R-C 端到端 E.reply()：≥40 轮触发受 CAP=2 约束、输出送达用户、零抛错", () => {
  const r = e2e(120);
  assert.strictEqual(r.err, 0, "端到端出现异常 " + r.err + " 次");
  assert.ok(r.fire > 0, "端到端零触发 —— 模块没接上生产路径（对照 A6-a）");
  assert.ok(r.fire <= 2, `端到端触发 ${r.fire} 次，超出 CAP=2`);
  assert.ok(r.ctg && r.ctg.n <= 2, "state.ctg 未随 reply 落盘");
  /* 输出真的送达：命中轮的 replies[0] 必须带上情境尾巴。
   * v15 追加 c4（QS 定值）与 c5（RM 模板，`#` 已被 fact value 原文替换 → 用前后缀对）。
   * 这仍是**闭集**断言：尾巴只准来自登记在案的语料池，一个生成字都不许有。 */
  const TAILS = ["好久不见了呀，你还好吧", "这些天没消息，怪想你的", "有点想你了", "刚还在想你呢",
    "看你这么带劲，我也高兴", "嘿嘿，你今天话多，我爱听",
    "这个我挺好奇的", "后来呢？我想听"];                       // ★v15 c4 · QS
  const TAIL_PAIRS = [["你说的", "还顺利吗"], ["我还记着", "呢"]];  // ★v15 c5 · RM（# 位为 fact 原文）
  const tailed = (s) => TAILS.some((t) => s.indexOf(t) >= 0) ||
    TAIL_PAIRS.some(([a, b]) => { const i = s.indexOf(a); return i >= 0 && s.endsWith(b) && s.length > i + a.length + b.length; });
  for (const s of r.samples) {
    assert.ok(tailed(s), "命中轮的回复未带情境尾巴: " + s);
  }
});

test("R-C 端到端 反证：flags.contingency=false 零触发", () => {
  const off = e2e(120, {
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true, memory2: true, presence: true, contingency: false },
  });
  assert.strictEqual(off.err, 0);
  assert.strictEqual(off.fire, 0, `flags.contingency=false 仍触发 ${off.fire} 次`);
});

/* 危机路径绝不许加情境尾巴。QA 变异测试（探针 p6/N10）发现：只断言"端到端危机轮零触发"是**假绿** ——
 * 该断言在 contingency 自己的 crisis 门被掐掉后**依然绿**，因为它实际被上游两层挡住了。
 * 三层防线必须逐层独立断言，否则任何一层退化都无人发现：
 *   层① engine.js:2875 危机早退 —— 危机输入根本走不到 :3057 的 pacingOf
 *   层② presence.pacingOf 用 CR(userText) 重新判危机，把 crisis=true 传下去（即使调用方传了 false）
 *   层③ contingency 自己的 c.crisis 门（见「R-C 门禁逐条」）
 * 层②是唯一对层③变异敏感的端到端口径，故单列。 */
test("R-C 危机三层防线：逐层独立断言（层①早退 / 层②pacing 重判 / 层③自身门）", () => {
  const CRISIS = ["我不想活了", "活着好没意思", "想死"];

  // 层①：危机输入下 pacingOf 必须完全不可达（插桩计数）
  const src = H.engineSources();
  const probed = src.replace("const pacingOf=(userText,reply,ctx)=>{",
    "const pacingOf=(userText,reply,ctx)=>{globalThis.__pacingHits=(globalThis.__pacingHits||0)+1;");
  assert.notStrictEqual(probed, src, "pacingOf 插桩点未命中，用例失效");
  const EP = new Function(probed + "\nreturn Engine;")();
  const mkS = () => Object.assign(H.freshState(), {
    affection: 500, firstMeet: Date.now() - 5 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 }, ctg: {}, dayLife: {},
    lastVisit: Date.now() - 20 * HOUR,
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true, memory2: true, presence: true },
  });
  globalThis.__pacingHits = 0;
  for (let i = 0; i < 60; i++) EP.reply(CRISIS[i % 3], mkS());
  assert.strictEqual(globalThis.__pacingHits, 0, "层①失守：危机输入竟走到了 pacingOf");
  globalThis.__pacingHits = 0;
  for (let i = 0; i < 60; i++) EP.reply("哈哈今天太好了！！", mkS());
  assert.ok(globalThis.__pacingHits > 0, "插桩无效（正常输入也没到 pacingOf），用例失效");
  delete globalThis.__pacingHits;

  // 层②：直调 pacingOf，ctx.crisis 故意传 false，靠 CR(userText) 兜住 —— 对层③变异敏感
  const P = E.mod("presence");
  const st = {
    affection: 500, tex: { t: 50, d: -1, n: 0 }, ctg: {}, flags: {},
    mem: { v: 13, facts: [], moments: [], migratedAt: 0 },
    persona: { tone: "soft" }, lastVisit: Date.now() - 20 * HOUR,
  };
  let fired = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE];
    P.pacingOf(CRISIS[i % 3], rs, { st, ue: { type: "neutral" }, lv: 3, crisis: false });
    if (rs[0] !== BASE) fired++;
  }
  assert.strictEqual(fired, 0, `层②失守：危机文本经 pacingOf 仍触发 ${fired} 次情境尾巴`);

  // 正向对照：同一入口、非危机文本必须能触发（否则上面的 0 是恒真）
  const st2 = Object.assign({}, st, { ctg: {} });
  let ok = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE];
    P.pacingOf("哈哈太好了！！", rs, { st: st2, ue: { type: "neutral" }, lv: 3, crisis: false });
    if (rs[0] !== BASE) ok++;
  }
  assert.ok(ok > 0, "对照失效：非危机文本也零触发，层②断言恒真");
});

/* ================= C6 · 缺件降级 ================= */

/* optional 语义的核心：不装也得跑。半更新态（新 index.html 配旧缓存、或 CDN 单文件 404）
 * 在线上真实发生过，这条是唯一能在 CI 里复现它的用例。 */
test("R-C 缺件降级：不装 contingency.js → mod()=null 且 reply() 全程不抛错", () => {
  const src = H.engineSources().split("\n;\n");
  const ctgSrc = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  const without = src.filter((s) => s !== ctgSrc).join("\n;\n");
  assert.ok(without.length < H.engineSources().length, "剔除 contingency.js 失败，用例失效");

  const E2 = new Function(without + "\nreturn Engine;")();
  assert.strictEqual(E2.mod("contingency"), null, "缺件时 mod() 应返回 null");

  const S = Object.assign(H.freshState(), {
    affection: 500, firstMeet: Date.now() - 5 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 }, dayLife: {},
    lastVisit: Date.now() - 20 * HOUR,
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true, memory2: true, presence: true },
  });
  for (let i = 0; i < 60; i++) {
    const r = E2.reply(["哈哈今天太好了！！", "嗯", "在干嘛"][i % 3], Object.assign({}, S));
    assert.ok(r && Array.isArray(r.replies) && r.replies.length > 0, "缺件时 reply 应正常返回");
  }
  // presence.pacingOf 仍须正常工作（依赖单向，缺件只跳过 contingency）
  const P = E2.mod("presence");
  const pacing = P.pacingOf("你好呀", ["嗯，我在呢。"], { st: S, ue: { type: "neutral" }, lv: 3 });
  assert.ok(pacing && typeof pacing.delayMs === "number", "缺件不得波及 pacingOf 本职");
});
