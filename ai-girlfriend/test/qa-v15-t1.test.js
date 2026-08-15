"use strict";
/* 小暖 · v15 T3-a 回归：R-C5 情境层次扩充（c4 好奇追问 / c5 共同回忆）
 *
 * 对应 DESIGN-v15 §5.T1 / §9.2，覆盖 AC-C5-1 ~ AC-C5-6 与架构师追加的 X-1 ~ X-4。
 *
 * ── 观测口径说明（重要）────────────────────────────────────────────
 * 验收表里写的是「`cd` 含 `["c4", …]`」，但 `cd` 是 `contingencePass` 的函数内局部量，
 * 模块没有、也不应该为了测试把它导出（S-6：不许为测试加字段）。
 * 本文件改用**契约面上的等价观测**：
 *   · 「入池」= 多轮采样中 `state.ctg.k` 出现过该类。
 *     :43 的选择器是 `PW(cd.filter(...))` 均匀随机，只要某类真在池里，
 *     N=400 轮内不出现的概率 < (1−1/|cd|)^(0.55N) ≈ 0，故可作充分证据。
 *   · 「不入池」= N 轮采样中该类出现 0 次（同上，反向亦成立）。
 * 这样既不动源码契约，又把断言钉在用户可见的行为上。
 *
 * ── 与 CAP=2 的关系（主理人裁定 U-4）──────────────────────────────
 * AC-C5-1「50 轮命中类型数 ≥5」与日频闸 CAP=2 表面冲突：同一 state 连打 50 轮最多命中 2 次。
 * U-4 裁定按**每轮重置日频闸**执行（每轮 fresh state），即该指标度量的是
 * 「候选池的类型多样性」而非「单日出场次数」，CAP=2 本身不因此放宽 —— X-4 单独钉死。
 */

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const H = require("./helpers.js");
const WS = require("./wiring-scan.js");
const BL = require("./baseline.js");

const ROOT = path.resolve(__dirname, "..");
const HOUR = 36e5;
const DAY = 864e5;

const E = H.loadEngine();
const C = E.mod("contingency");

/* v15 新增语料池（与 contingency.js:7 逐字对齐；抄错了就测了个寂寞，故下方另有源码比对钉） */
const QS = ["这个我挺好奇的", "后来呢？我想听"];
const RM_PAIRS = [["你说的", "还顺利吗"], ["我还记着", "呢"]];

const BASE_REPLY = "今天过得还行吧。";

/* ---------- 夹具 ----------
 * 门禁全开的最小 state，且**刻意压掉 c1/c2/c3/sn/sf 五类**，
 * 好让 c4/c5 能被单独观测：
 *   c1 off ← lastVisit = now−2h（g=2 < 12）
 *   c2 off ← 由各用例的 text 保证（无热词、长度 ≤19）
 *   c3 off ← mem 无同 key 异值高置信事实
 *   sn off ← text 无 SNK 挑衅词
 *   sf off ← lv=3 < 4（门①直接关闭）
 */
function stateOf(over) {
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

function ctxOf(st, over) {
  return Object.assign({
    st, ue: { type: "neutral" }, lv: 3, crisis: false, text: "嗯", rng: Math.random,
  }, over || {});
}

/* 单条事实的 mem 容器 */
function memOf(key, value, extra) {
  return {
    v: 13, migratedAt: 0, moments: [],
    facts: [Object.assign({
      id: "f_" + key, key, value, conf: 0.8, tags: [key],
      since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
    }, extra || {})],
  };
}

/* 采样 n 轮（每轮 fresh state + 重置日频闸），返回 {byK, texts, hit} */
function sample(stOver, ctxOver, n) {
  n = n || 400;
  const byK = {}; const texts = {}; let hit = 0;
  for (let i = 0; i < n; i++) {
    const st = stateOf(stOver);
    st.ctg = {};
    const rs = [BASE_REPLY];
    const o = C.contingencePass(BASE_REPLY, rs, ctxOf(st, ctxOver));
    if (o) {
      hit++;
      const k = st.ctg && st.ctg.k;
      byK[k] = (byK[k] || 0) + 1;
      (texts[k] = texts[k] || []).push(o);
      assert.strictEqual(rs[0], o, "命中必须就地写回 replies[0]，否则用户看不到");
    } else {
      assert.strictEqual(rs[0], BASE_REPLY, "未命中不得污染 replies[0]");
    }
  }
  return { byK, texts, hit, n };
}

const cnt = (r, k) => r.byK[k] || 0;

/* ============ AC-C5-3 · c4 好奇追问 ============ */

test("AC-C5-3a · c4 命中：长度>7 的非疑问陈述句入池，文案取自 QS 闭集", () => {
  const r = sample({}, { text: "今天去了趟新开的那家书店" });
  assert.ok(cnt(r, "c4") > 0, `c4 未入池，实得 ${JSON.stringify(r.byK)}`);
  /* 该输入把其余五类全压掉了 → c4 必须是唯一命中类。
   * 这条比「c4 > 0」更强：它同时证明了 c4 的入池条件没有连带打开别的类。 */
  assert.deepStrictEqual(Object.keys(r.byK).sort(), ["c4"],
    `c4 场景不得混入其他类：${JSON.stringify(r.byK)}`);
  // H7 零生成词：尾巴必须逐字来自 QS 闭集
  for (const s of r.texts.c4) {
    assert.ok(QS.some((q) => s.endsWith(q)), `c4 文案越出 QS 闭集：${s}`);
    assert.strictEqual(s, BASE_REPLY.replace(/[。！？…]$/, "") + "，" + s.slice(s.length - QS.find((q) => s.endsWith(q)).length),
      `c4 拼接格式被改写：${s}`);
  }
  // 概率门 .55 仍在（不是 100% 命中，也不是零）
  assert.ok(r.hit > r.n * 0.3 && r.hit < r.n * 0.8, `.55 概率门失效，实得 ${r.hit}/${r.n}`);
});

test("AC-C5-3b · c4 反证：疑问句不入池 / 长度≤7 不入池（两条独立断言）", () => {
  // ① 疑问句 —— 设计原文口径
  assert.strictEqual(cnt(sample({}, { text: "好吗？" }), "c4"), 0, "「好吗？」不得入 c4");
  /* ①b 长度门与疑问门的**隔离**验证：同一句加不加问号，结果必须翻转。
   * 只测「好吗？」的话，长度 3 已经先把门关了，问号那道门等于没测。 */
  const q = "今天去了趟新开的那家书店吗？";
  const d = "今天去了趟新开的那家书店吗";
  assert.strictEqual(cnt(sample({}, { text: q }), "c4"), 0, `疑问句仍入 c4：${q}`);
  assert.ok(cnt(sample({}, { text: d }), "c4") > 0, `去掉问号后 c4 应恢复：${d}`);
  // 半角问号同样生效（正则是 [？?]）
  assert.strictEqual(cnt(sample({}, { text: "今天去了趟新开的那家书店吗?" }), "c4"), 0, "半角问号未被识别");

  // ② 长度 ≤7 不入池；边界：7 关、8 开
  assert.strictEqual(cnt(sample({}, { text: "嗯" }), "c4"), 0, "「嗯」不得入 c4");
  assert.strictEqual(cnt(sample({}, { text: "一".repeat(7) }), "c4"), 0, "7 字应关（门是 >7）");
  assert.ok(cnt(sample({}, { text: "一".repeat(8) }), "c4") > 0, "8 字应开（门是 >7）");
});

/* ============ AC-C5-4 · c5 共同回忆 ============ */

test("AC-C5-4a · c5 命中：可用 fact 入池，# 占位符被 value 原文替换", () => {
  // text 用「嗯」压掉 c4，隔离出 c5
  const r = sample({ mem: memOf("喜好", "火锅") }, { text: "嗯" });
  assert.ok(cnt(r, "c5") > 0, `c5 未入池，实得 ${JSON.stringify(r.byK)}`);
  assert.deepStrictEqual(Object.keys(r.byK).sort(), ["c5"],
    `c5 场景不得混入其他类：${JSON.stringify(r.byK)}`);
  for (const s of r.texts.c5) {
    assert.ok(s.indexOf("火锅") >= 0, `c5 未回填 fact 原文：${s}`);
    assert.strictEqual(s.indexOf("#"), -1, `# 占位符未被替换，模板漏出到用户面前：${s}`);
    // H7 零生成词：必须是 RM 模板 + value 原文，不许有第三种字
    const ok = RM_PAIRS.some(([a, b]) => s.indexOf(a + "火锅" + b) >= 0);
    assert.ok(ok, `c5 文案越出 RM 闭集：${s}`);
  }
});

test("AC-C5-4b · c5 反证：无 fact / value 已在本轮句中 / 已被否定 —— 三条独立断言", () => {
  // ① facts 为空
  assert.strictEqual(cnt(sample({}, { text: "嗯" }), "c5"), 0, "facts 为空时不得入 c5");
  // ② 本轮 u 已提到该 value（u.indexOf(f.value) < 0 过滤）
  assert.strictEqual(cnt(sample({ mem: memOf("喜好", "火锅") }, { text: "火锅" }), "c5"), 0,
    "本轮已提「火锅」，不该再回忆一遍");
  // ③ negatedAt 非空
  assert.strictEqual(cnt(sample({ mem: memOf("喜好", "火锅", { negatedAt: Date.now() }) }, { text: "嗯" }), "c5"), 0,
    "已被否定的事实不得进 c5");
  // ④ value 为空串的脏事实不得入池（f.value 真值过滤）
  assert.strictEqual(cnt(sample({ mem: memOf("喜好", "") }, { text: "嗯" }), "c5"), 0,
    "空 value 事实不得进 c5（会拼出半截句子）");
});

test("AC-C5-4c · c5 的 # 替换必须回填 value 原文：含 $ 的值不得被 replace 当成替换模式", () => {
  /* String.prototype.replace 的第二参若是**字符串**，`$&` / $\` / `$'` / `$1` 会被当作
   * 替换模式解释。c5 是 v15 唯一把"用户可控数据"拼进出口模板的新路径，
   * 而 `memory.js:196 editFact(m,i,v)` 对 value 是裸 `String(v)`、零净化 ——
   * 用户在记忆管理里把爱好改成含 `$&` 的字符串，c5 就会吐出
   * 「我还记着a我还记着b呢」这种自我复读的怪句，直接破 H7「零生成词·value 原文回填」。
   *
   * 实现侧用替换函数 `()=>value` 关掉模式解释（+4B）。这里逐条钉死。
   * 注：`extractFacts` 走的是中文字类捕获，正常聊天进不来 `$`；
   *     但 editFact 是导出 API，不能靠"调用方不会这么传"来保证。 */
  const DOLLAR = ["$&火锅", "a$`b", "$1$2", "$'x", "$$"];
  for (const v of DOLLAR) {
    const r = sample({ mem: memOf("喜好", v) }, { text: "嗯" }, 300);
    assert.ok(cnt(r, "c5") > 0, `含 $ 的 value 未能出句：${v}`);
    for (const s of r.texts.c5) {
      assert.ok(s.indexOf(v) >= 0,
        `value 未原文回填（$ 被当成替换模式解释）：value=${JSON.stringify(v)} → ${JSON.stringify(s)}`);
      assert.strictEqual(s.indexOf("#"), -1, `# 占位符残留：${s}`);
      // 反向：不得出现模板自身被复读进结果（$& / $` 解释后的典型症状）
      const tpl = RM_PAIRS.find(([a]) => s.indexOf(a) >= 0);
      assert.ok(tpl, `文案越出 RM 闭集：${s}`);
      assert.strictEqual(s.split(tpl[0]).length - 1, 1, `模板前缀出现 ${s.split(tpl[0]).length - 1} 次（应为 1）：${s}`);
    }
  }
  // 静态钉：替换函数形态不得被"顺手简化"回字符串形态
  const src = require("node:fs").readFileSync(path.join(ROOT, "contingency.js"), "utf8").replace(/\s/g, "");
  assert.ok(/\.replace\("#",\(\)=>/.test(src),
    "c5 的 # 替换退回了字符串形态 —— 含 $ 的 value 会被当成替换模式");
});

/* ============ AC-C5-5 · 危机让位（双形态，必须独立断言）============ */

test("AC-C5-5 · 危机让位：ctx.crisis 恒 null；detectCrisis 通道下 c4/c5 不入池", () => {
  // ① ctx.crisis = true → 整个 contingencePass 早退（v13 既有门，回归钉）
  const hard = sample({ mem: memOf("喜好", "火锅") }, { text: "今天去了趟新开的那家书店", crisis: true }, 200);
  assert.strictEqual(hard.hit, 0, `ctx.crisis 通道未早退，实得 ${hard.hit} 次命中`);

  /* ② crisis 标志未设，但文本本身是危机 —— 这是 R-C5 真正的价值点：
   * 早退门只看 c.crisis，若 CRI() 闸没写对，c4/c5 会在用户说「不想活了」时
   * 追问「后来呢？我想听」，属重大体验事故。 */
  const soft = "我真的撑不下去了不想活了";
  assert.notStrictEqual(E.detectCrisis(soft).level, "none", "夹具失效：该句应被 detectCrisis 判为危机");
  const r = sample({ mem: memOf("喜好", "火锅") }, { text: soft, crisis: false }, 400);
  assert.strictEqual(cnt(r, "c4"), 0, `危机文本下 c4 仍出场：${JSON.stringify(r.texts.c4)}`);
  assert.strictEqual(cnt(r, "c5"), 0, `危机文本下 c5 仍出场：${JSON.stringify(r.texts.c5)}`);

  // 反证夹具有效性：同样的 state，换成中性长句时 c4/c5 是能出来的（证明不是别的门挡住的）
  const ctrl = sample({ mem: memOf("喜好", "火锅") }, { text: "今天去了趟新开的那家书店", crisis: false }, 400);
  assert.ok(cnt(ctrl, "c4") + cnt(ctrl, "c5") > 0, "对照组零命中 —— 夹具本身有问题，上面的反证不成立");
});

/* ============ AC-C5-1 / AC-C5-2 · 类型多样性与单类占比 ============
 * R-C5 的产品目标就这一条：她的"接话方式"不能只有一种。
 * 口径按主理人 U-4：每轮 fresh state（重置日频闸），度量候选池的类型多样性。
 * 七类的触发情境两两不同，故用一张场景轮盘驱动 50 轮。 */

/* 场景轮盘：每格 = [stateOver, ctxOver]，覆盖 c1/c2/c3/sn/sf/c4/c5 七类的触发条件 */
function scenarios() {
  const now = Date.now();
  const conflict = memOf("工作", "设计师");          // 与「我是程序员」冲突 → c3
  const recall = memOf("喜好", "火锅");              // 可回忆事实 → c5
  return [
    // c1 久别重逢：g ≥ 12h
    [{ lastVisit: now - 20 * HOUR }, { text: "嗯" }],
    // c2 热情：热词
    [{}, { text: "哈哈哈太好了！！" }],
    // c3 矛盾：同 key 异值高置信
    [{ mem: conflict }, { text: "我是程序员" }],
    // sn 反呛：lv≥3、非危机、调侃语气
    [{}, { text: "你懂个啥" }],
    // sf 自我表达：lv≥4 且 security≥.45，且当轮无 c1/c2 情境
    [{ self: { security: 0.7, warmth: 0.6, agency: 0.5, coherence: 0.6, updatedAt: 0 } },
      { text: "嗯", lv: 5 }],
    // c4 好奇追问：长度 >7 的非疑问陈述句
    [{}, { text: "今天去了趟新开的那家书店" }],
    // c5 共同回忆：有可用 fact 且本轮未提及
    [{ mem: recall }, { text: "嗯" }],
  ];
}

test("AC-C5-1 / AC-C5-2 · 50 轮命中类型数 ≥5 且单类占比 ≤50%（U-4：每轮重置日频闸）", () => {
  const sc = scenarios();
  const seen = [];
  const byK = {};
  /* 每格重复采样直到该场景产出一次命中（.55 概率门），最多 200 次尝试。
   * 这样 50 个观测点都是"有效命中"，不会被概率门稀释成假阴性。 */
  for (let i = 0; i < 50; i++) {
    const [stOver, ctxOver] = sc[i % sc.length];
    let k = null;
    for (let t = 0; t < 200 && !k; t++) {
      const st = stateOf(stOver);
      st.ctg = {};                                   // ★U-4：每轮重置日频闸
      const rs = [BASE_REPLY];
      if (C.contingencePass(BASE_REPLY, rs, ctxOf(st, ctxOver))) k = st.ctg.k;
    }
    assert.ok(k, `场景 #${i % sc.length} 200 次尝试仍零命中，夹具失效`);
    seen.push(k);
    byK[k] = (byK[k] || 0) + 1;
  }
  const kinds = new Set(seen);
  assert.ok(kinds.size >= 5,
    `AC-C5-1 命中类型数 ${kinds.size} < 5，实得 ${JSON.stringify(byK)}`);
  const max = Math.max(...Object.values(byK));
  assert.ok(max / 50 <= 0.5,
    `AC-C5-2 单类占比 ${(max / 50 * 100).toFixed(1)}% > 50%，实得 ${JSON.stringify(byK)}`);
  // v15 的两个新类必须真的出现在这 50 轮里，否则"扩充"名不副实
  assert.ok(kinds.has("c4"), `50 轮里 c4 一次都没出现：${JSON.stringify(byK)}`);
  assert.ok(kinds.has("c5"), `50 轮里 c5 一次都没出现：${JSON.stringify(byK)}`);
});

/* ============ X-1 · 选择器随机化生效（AC-C5-1 达标的唯一结构前提）============ */

test("X-1 · 选择器已随机化：4 候选 + q.k 降权，200 次采样产出类型数 ≥3", () => {
  /* 构造 c1/c2/c4/c5 四类同时入池：
   *   c1 ← lastVisit = now−20h（g ≥ 12）
   *   c2 ← 热词「哈哈」
   *   c4 ← 长度 >7 且不以问号结尾
   *   c5 ← mem 有「火锅」且本轮未提
   * 再把 q.k 钉成 "c1" → 降权后池 = {c2, c4, c5}。 */
  const day = Math.floor(Date.now() / DAY);
  const text = "哈哈今天去了趟新开的那家书店";
  const kinds = {};
  for (let i = 0; i < 200; i++) {
    const st = stateOf({ lastVisit: Date.now() - 20 * HOUR, mem: memOf("喜好", "火锅") });
    st.ctg = { d: day, n: 0, k: "c1", sT: -99, sA: 0 };   // ★ 已命中过 c1 → 本轮降权
    const rs = [BASE_REPLY];
    if (C.contingencePass(BASE_REPLY, rs, ctxOf(st, { text }))) kinds[st.ctg.k] = (kinds[st.ctg.k] || 0) + 1;
  }
  const n = Object.keys(kinds).length;
  /* 若工程师漏改 `find → PW(filter)`，选择器恒取过滤后的第一个元素 = c2，
   * 这里立刻退化成 1 类。这是本文件最重要的一条结构钉。 */
  assert.ok(n >= 3,
    `选择器未随机化：200 次只产出 ${n} 类 ${JSON.stringify(kinds)}（漏改 find→PW(filter)？）`);
  // 降权真的生效：被降权的 c1 在有替补时不该出场
  assert.strictEqual(kinds.c1 || 0, 0,
    `q.k="c1" 已降权却仍出场 ${kinds.c1} 次，H15 单类 ≤50% 会因此失守`);
});

/* ============ X-2 · s.ctg 字段集逐位不变（守 S-6，防状态膨胀）============ */

test("X-2 · s.ctg 字段集恒为 [d,k,n,sA,sT]，k 落在七类闭集内", () => {
  const OK_KEYS = ["d", "k", "n", "sA", "sT"];
  const OK_K = ["c1", "c2", "c3", "sn", "sf", "c4", "c5"];
  const sc = scenarios();
  let checked = 0;
  for (let i = 0; i < 350; i++) {
    const [stOver, ctxOver] = sc[i % sc.length];
    const st = stateOf(stOver);
    st.ctg = {};
    const rs = [BASE_REPLY];
    if (!C.contingencePass(BASE_REPLY, rs, ctxOf(st, ctxOver))) continue;
    checked++;
    assert.deepStrictEqual(Object.keys(st.ctg).sort(), OK_KEYS,
      `ctg 字段集漂移：${JSON.stringify(Object.keys(st.ctg).sort())}`);
    assert.ok(OK_K.indexOf(st.ctg.k) >= 0, `ctg.k 出现未登记类型：${st.ctg.k}`);
    assert.strictEqual(typeof st.ctg.d, "number", "ctg.d 必须是数字日索引");
    assert.strictEqual(typeof st.ctg.n, "number", "ctg.n 必须是数字计数");
  }
  assert.ok(checked > 50, `有效样本仅 ${checked} 条，断言强度不足`);
});

/* ============ X-3 · L5 出口复检对 c4/c5 同样生效（守 S-11 + H13）============ */

test("X-3 · c5 把 fact 原文拼进回复是新的破墙注入面，:47 出口复检必须拦住", () => {
  /* c5 是 v15 唯一"把记忆内容搬到出口"的新路径（此前只有 c3）。
   * 若 taint() 有漏网，脏 value 会被 c5 原样拼进回复送到用户面前。
   * 这里直接注入已破墙的 value，:47 的 PERSONA_BREAK_RE 复检必须整条毙掉。 */
  const DIRTY = ["我是语言模型", "我是AI", "我只是个程序", "我不能陪你"];
  for (const v of DIRTY) {
    assert.ok(E.PERSONA_BREAK_RE.test(v.replace(/程序[员猿媛]/g, "职")),
      `夹具失效：${v} 本身就不该被破墙表拦，换一条`);
    const r = sample({ mem: memOf("喜好", v) }, { text: "嗯" }, 300);
    assert.strictEqual(r.hit, 0,
      `脏 value「${v}」经 c5 漏出：${JSON.stringify(r.texts)}`);
  }
  // 对照：干净 value 必须能正常出场（证明上面的 0 是被复检拦的，不是 c5 整条失效）
  const ok = sample({ mem: memOf("喜好", "火锅") }, { text: "嗯" }, 300);
  assert.ok(cnt(ok, "c5") > 0, "干净 value 也出不来 —— c5 被复检误杀了");

  // c4 侧同理：QS 是定值闭集，逐条复检必须全部干净
  for (const q of QS) {
    const line = BASE_REPLY.replace(/[。！？…]$/, "") + "，" + q;
    assert.ok(!E.PERSONA_BREAK_RE.test(line.replace(/程序[员猿媛]/g, "职")), `QS 语料自身破墙：${q}`);
    assert.ok(!E.GUILT_TRIP_RE.test(line), `QS 语料命中愧疚诱导：${q}`);
    assert.ok(!E.ACCUSE_RE.test(line), `QS 语料命中指责：${q}`);
  }
});

/* ============ X-4 · CAP=2 未被削弱 ============ */

test("X-4 · 日配额 CAP=2 未因新增类型放宽：同 state 连打 200 轮恒 2 次，且跨日重置", () => {
  const st = stateOf({ lastVisit: Date.now() - 20 * HOUR, mem: memOf("喜好", "火锅") });
  const text = "哈哈今天去了趟新开的那家书店";   // c1/c2/c4/c5 四类同时可选
  let h = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE_REPLY];
    if (C.contingencePass(BASE_REPLY, rs, ctxOf(st, { text }))) h++;
  }
  assert.strictEqual(h, 2, `四类候选同时在池时日配额仍应为 2，实得 ${h}`);
  assert.strictEqual(st.ctg.n, 2, "ctg.n 未落盘，配额跨轮失效");
  assert.strictEqual(st.ctg.d, Math.floor(Date.now() / DAY), "ctg.d 应为当日索引");

  // 跨日重置仍生效（新类型不得绕过日索引比较）
  st.ctg = { d: st.ctg.d - 1, n: 2, k: "c4", sT: -99, sA: 0 };
  let h2 = 0;
  for (let i = 0; i < 200; i++) {
    const rs = [BASE_REPLY];
    if (C.contingencePass(BASE_REPLY, rs, ctxOf(st, { text }))) h2++;
  }
  assert.strictEqual(h2, 2, `跨日应重置配额，实得 ${h2}`);
});

/* ============ AC-C5-6 · 体积 ============ */

/* ★★【快照翻转 · v17 T0/T2/T3 · 主理人 Qi 批准（DESIGN-v17 §2.5 唯一解 / §3.3 / §3.4）】★★
 *   v15 的 U-3 口径「≤470B 且 ≤4973B」是 R-C5 那一期的增量锁，v17 R-S2 二期获批
 *   **独立的净增硬顶**与新配额，两条锁并存、都断，不许只过一条。
 *   四把配额锁 v17 全部翻数（唯一解，不许自创；逐项数值见 wiring-scan.js v17 审批块）：
 *     memory / presence / texture / contingency 四项同轮重切
 *     moduleSumMax 28343→27943 / engineNetMax 2400→2800 / totalMax 276480 不动
 *   严格度逐位不放松：仍是 strictEqual + 恒等式 ②（四项之和 === moduleSumMax）+ over=[]。
 *   memory/presence/texture 的「v15 零改动」口径翻转为「v17 归一化白名单内改动」，
 *   并改钉**净字节精确值**（−38 / +9 / +9），比原来只断"有没有 diff"更严。
 *
 * ★★【v19 · contingency 三锁归一 · 主理人 Qi 批准（PRD-v19 Q1 推荐案 / DESIGN-v19 §3）】★★
 *   本轮 SIZE_BUDGET 一个字节不改（零预算版本，四锁 ①②③④ 逐位不变，V33 三针不翻转）。
 *   改的是「谁有资格写这个上限」——本文件原有的两个平行字面量（残差锁 / 净增锁）全部删除，
 *   一律改由 WS.SIZE_BUDGET["contingency.js"] 这个唯一真源派生：
 *     CEILING := B["contingency.js"]               （残差锁 ≡ 配额，不再是第二个数字）
 *     NET_MAX := B["contingency.js"] − V16_ANCHOR  （净增锁派生，代码里不写它的算出值）
 *   ⑧ 新增恒等式：V16_ANCHOR + NET_MAX ≡ B["contingency.js"]
 *     ⇒ 残差锁与净增锁恒重合，「改了配额忘了净增锁」在数学上不可能发生。
 *   v17 时代那两个字面量作为历史审批记录保留在 wiring-scan.js 的 v17 块内（:286 一带），
 *   v19 起**不再生效**，仅供审计追溯，禁止据此写新断言。 */
test("AC-C5-6 · contingency.js R-C5 增量 ≤470B、R-S2 净增/总量双锁均从 SIZE_BUDGET 派生；体积四锁自洽", () => {
  const cur = require("node:fs").statSync(path.join(ROOT, "contingency.js")).size;
  const base = Buffer.byteLength(BL.showAt(BL.BASE, "contingency.js"));
  assert.strictEqual(base, 4086, `v14 收口态 contingency.js 应为 4086B，实得 ${base}`);
  // v15 R-C5 那一期的落位（4518）已成为 v17 的起算点，两期增量分开钉
  const V16 = 4518;
  assert.ok(V16 - base <= 470, `R-C5 增量 ${V16 - base}B > 470B（U-3 追认口径）`);

  /* v19 单一真源：上限只有 SIZE_BUDGET 一个可写位置，其余全部现算派生（DESIGN-v19 §3.2） */
  const B = WS.SIZE_BUDGET;
  const CEILING = B["contingency.js"];
  const NET_MAX = CEILING - V16;
  assert.ok(cur - V16 <= NET_MAX,
    `R-S2 二期净增 ${cur - V16}B > ${NET_MAX}B 净增上限（= SIZE_BUDGET["contingency.js"] ${CEILING} − 锚点 ${V16}，DESIGN-v19 §3.2）`);
  assert.ok(cur <= CEILING,
    `contingency.js ${cur}B > ${CEILING}B 配额上限（SIZE_BUDGET 单一真源，DESIGN-v19 §3；须先砍语料条数，不许自创第二个上限数字）`);
  // 锁⑧：净增锁与残差锁结构性重合 —— 派生写法一旦被改回字面量，这条即刻转红
  assert.strictEqual(V16 + NET_MAX, CEILING,
    `锁⑧失配：V16_ANCHOR(${V16}) + NET_MAX(${NET_MAX}) 应恒等于 SIZE_BUDGET["contingency.js"](${CEILING})`);

  const s = WS.scanSizes();
  assert.deepStrictEqual(s.over, [], `单文件配额越界：${JSON.stringify(s.each)}`);
  assert.strictEqual(B["memory.js"], 13352, "v22 批准值：回让 13B 予 engine（实测 13333 + 19B 缓冲；源码零改动）");
  assert.strictEqual(B["presence.js"], 3585, "v22 批准值：回让 13B 予 engine（实测 3566 + 19B 缓冲；源码零改动）");
  assert.strictEqual(B["texture.js"], 4384, "v22 批准值：回让 14B 予 engine（实测 4366 + 18B 缓冲；源码零改动）");
  assert.strictEqual(B["contingency.js"], 6682, "v21 批准值 6582→6682（路径③ 受援方 +100B，源自 engine 让渡 D=100；推导见 wiring-scan.js v21 审批块）· v22 配额逐位不动");
  /* ⚠ 断言消息不复述上一轮旧字面量 —— T-v33 归零判据要求活代码零残留（DESIGN-v22 §5）；
   *   但**现行**派生值须点名，否则「改全没改全」在本文件里无从机械核对。 */
  assert.strictEqual(B.moduleSumMax, 28003, "T05(D5) 重标定：moduleSumMax 28003 = totalMax(281119) − engineMax(253116)（模块零改动，Σ 逐位不变）");
  assert.strictEqual(B.totalMax, 281119, "T05(D5) 重标定：v14 276480 + 4639（D5 已批准，天花板 = moduleSumMax + engineMax = 28003 + 253116 = 281119，间隙恒 0）");
  assert.strictEqual(B.engineNetMax, 7379, "T05(D5) 重标定：v22 2740 + 4639（D5 engine.js 净增 5331 落位，余 2048B 闸门余量）");
  assert.strictEqual(B.engineMax, B.engineBase + B.engineNetMax, "锁①：engineMax 必须是派生值");
  // 恒等式②：四项配额之和 = moduleSumMax（严格相等，不是 ≤）
  assert.strictEqual(B["memory.js"] + B["presence.js"] + B["texture.js"] + B["contingency.js"],
    B.moduleSumMax, "四项模块配额之和应恰等于 moduleSumMax");
  // 恒等式③：三锁打满不得击穿天花板，且松弛恰为 0
  assert.strictEqual(B.engineBase + B.engineNetMax + B.moduleSumMax, B.totalMax,
    "锁③：三锁打满必须恰好等于 totalMax（未分配余量一个字节都不许存在）");

  /* memory/presence/texture 在 v17 是「归一化白名单内改动」，净字节精确钉死 */
  const EXPECT = { "memory.js": -38, "presence.js": 9, "texture.js": 9 };
  for (const f of Object.keys(EXPECT)) {
    const d = s.each[f] - Buffer.byteLength(BL.showAt(BL.BASE, f));
    assert.strictEqual(d, EXPECT[f], `${f} 相对 BASE 净增应为 ${EXPECT[f]}B，实测 ${d}B`);
  }
});
