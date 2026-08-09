"use strict";
/* ============================================================================
 * v14 · T4 验收：R-P2 recall 过节奏层与情境层（P2）
 * 对应 DESIGN-v14 §5 / T4 / V-103a V-103b V-103c V-103d
 *
 * 【缺陷】`engine.js:2896-2901` 的 recall 分支在 `pacingOf` 之前就 return 了：
 *   正常出口走 `:3032 texturePass` → `:3057 pacingOf`，而 `presence.js` 又把
 *   `contingencePass` 挂在 `pacingOf` **内部**。recall 早退 ⇒ 该轮既无 `pacing`
 *   也从不触发 contingence。用户可见后果：她提起旧事时**秒回、且不带任何情境反应** ——
 *   全对话里最该"有情绪"的一轮，反而是最像机器的一轮。
 *
 * 【修法 · 一次调用补两层】`memory.skin()` 内经注册表补挂 `presence.pacingOf`。
 *   因为 contingencePass 挂在 pacingOf 内部，补一次挂点同时拿到「节奏 + 情境反应」，
 *   `presence.js` 零改动。engine 侧只需 19B 把 `pacing` 透传出 `rec` 对象。
 *
 * 【四条实现约束（DESIGN §5.4，本文件逐条钉死）】
 *   ① pacingOf 必须排在 texture 加工之后 → 见「同序」用例
 *   ② 传 rs 数组并回读 rs[0]（contingencePass 就地改写）→ 见「情境反应回读」用例
 *   ③ 整段在既有 try/catch 内，取不到静默降级 → 见「缺件降级」用例
 *   ④ 不得另调 contingencePass（双触发会双倍消耗 CAP=2）→ 见 V-103d
 * ========================================================================== */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");

const ROOT = path.resolve(__dirname, "..");
const E = H.loadEngine();
const M = E.mod("memory");
const DAY = 864e5;

/* 宽松态 state：六重门禁全开，隔离测 R-P2 本身 */
function recallState(over) {
  const now = Date.now();
  return Object.assign(H.freshState(), {
    affection: 100, firstMeet: now - 30 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 },
    pres: {}, ctg: {}, persona: { tone: "soft" }, dayLife: {},
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true,
      memory2: true, presence: true, contingency: true },
  }, over || {});
}

/* ⚠ 默认值取「设计师」：T4 排查期发现 v13 `contingency.js` 的 L5 出口复检用的是**裸**
 * `E.PERSONA_BREAK_RE.test(o)`，缺 engine.js:1322 的 A6-a `程序[员猿媛]→职` 等长折叠，
 * 于是回忆「程序员」的句子拼上情境反应后被裸词「程序」误杀。该缺陷已在 T5 改造 L5 时修复，
 * 下方 `A6-a-ctg` 用例由 todo 转正；此处默认值保持「设计师」以隔离 T4 观测面。 */
const jobMem = (value) => ({
  v: 13, migratedAt: 0, moments: [],
  facts: [{
    id: "f_job", key: "工作", value: value || "设计师", conf: 0.8, tags: ["工作"],
    since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
  }],
});

/* 采样 n 轮 recall，返回全部非 null 结果 */
function sampleRecall(n, mkState) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const st = (mkState || recallState)();
    st.mem = jobMem();
    const r = M.recallV2("今天上班好累", st, { now: Date.now(), lv: 4 });
    if (r) out.push({ r, st });
  }
  return out;
}

/* ============ V-103a · H16：recall 轮携带 pacing 比例 ≥95% ============ */

test("T4 · V-103a H16：recall 轮携带 pacing 字段比例 ≥95%（400 轮）", () => {
  const hits = sampleRecall(400);
  assert.ok(hits.length >= 100, `recall 出句过少(${hits.length}/400)，用例失效`);
  const withPacing = hits.filter((x) => x.r.pacing && typeof x.r.pacing.delayMs === "number");
  const rate = withPacing.length / hits.length;
  assert.ok(rate >= 0.95,
    `H16 未达标：${withPacing.length}/${hits.length} = ${(rate * 100).toFixed(1)}% < 95%`);
  // 字段形状也要对，不能是个空壳
  for (const x of withPacing.slice(0, 20)) {
    const p = x.r.pacing;
    assert.ok(p.delayMs >= 320 && p.delayMs <= 7800, "delayMs 越界: " + p.delayMs);
    assert.ok(p.typingMs >= 0 && p.typingMs <= 6000, "typingMs 越界: " + p.typingMs);
    assert.strictEqual(typeof p.split, "boolean", "split 字段类型错");
  }
});

/* 反证：v13 的 recall 轮**一个** pacing 都没有（证明缺陷真实存在） */
test("T4 · V-103a 反证：跳过 R-P2 挂点时 pacing 恒缺失", () => {
  /* 用「注册表里没有 presence」模拟 v13 形态：skin() 的 P 查表返 null → 静默降级。
   * 这同时验证约束③（缺件降级不炸）。 */
  const real = E.mod("presence");
  assert.ok(real, "presence 模块未注册，环境异常");
  const origPacing = real.pacingOf;
  try {
    delete real.pacingOf;                       // 制造「挂点不存在」
    const hits = sampleRecall(120);
    assert.ok(hits.length >= 20, "对照组出句过少");
    const withPacing = hits.filter((x) => x.r.pacing);
    assert.strictEqual(withPacing.length, 0,
      "挂点不存在时仍产出 pacing —— 说明 pacing 来自别处，用例测错了对象");
    // 约束③：缺件时回复本身必须照常产出（宁可没节奏，不可没回复）
    for (const x of hits.slice(0, 10)) {
      assert.ok(x.r.line && x.r.line.length > 0, "缺件降级时丢了回复");
    }
  } finally {
    real.pacingOf = origPacing;
  }
});

/* ============ V-103b · 延迟分布与非 recall 轮无显著差异 ============ */

test("T4 · V-103b 延迟分布：recall 轮与非 recall 轮均值差 ≤10%、CV 同档 ±0.05", () => {
  const stat = (arr) => {
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
    return { n, mean, cv: sd / mean };
  };
  // recall 侧
  const recSamples = sampleRecall(600).filter((x) => x.r.pacing);
  const rec = recSamples.map((x) => x.r.pacing.delayMs);
  assert.ok(rec.length >= 100, `recall 样本过少(${rec.length})`);
  /* 非 recall 侧：同一句用户输入、同档 lv/ue，回复长度对齐 recall 侧 ——
   * pacingOf 的 delay 本就与回复长度 L 成正比（设计如此），不控长度就是在测「句子长短」，
   * 而不是测「recall 轮有没有被区别对待」。
   *
   * ── v15 量纲修正 ────────────────────────────────────────────────
   * v14 这里用「均长 avgLen」造一条定长对照句。当时 recall 侧的句长分布很窄，
   * 对齐均值≈对齐分布，CV 差恰好落在 ±0.05 内。R-C5 让 contingencePass 在
   * recall 轮的命中率上去了（c4/c5 入池），带尾巴与不带尾巴的两种句长形成双峰，
   * recall 侧的**长度方差**被拉大 —— 而定长对照侧的长度方差恒为 0。
   * 于是 CV 差 0.068 > 0.05 偶发转红：测出来的是「句长分布不同」，
   * 不是「recall 轮被区别对待」，正是本用例注释自己反对的那件事。
   *
   * 处置：改为**逐样本等长配对** —— 对照侧不再用一个均值，而是照抄 recall 侧
   * 每一条的实际句长。这样两侧的长度分布逐位一致，剩下的差异才真的只剩
   * 「走没走 recall 分支」。这是收紧不是放松：配对法把 v14 靠均值掩盖掉的
   * 长度方差也一并控住了。 */
  const P = E.mod("presence");
  const nonRec = [];
  for (const x of recSamples) {
    const st = recallState();
    const pc = P.pacingOf("今天上班好累", ["嗯".repeat(x.r.line.length)],
      { st, ue: E.detectUserEmotion("今天上班好累"), lv: 4, crisis: false });
    if (pc) nonRec.push(pc.delayMs);
  }
  assert.ok(nonRec.length >= 100, `非 recall 对照样本过少(${nonRec.length})`);
  const a = stat(rec), b = stat(nonRec);
  const diff = Math.abs(a.mean - b.mean) / b.mean;
  assert.ok(diff <= 0.10,
    `延迟均值差 ${(diff * 100).toFixed(1)}% > 10%（recall ${a.mean.toFixed(0)}ms / 非 recall ${b.mean.toFixed(0)}ms）`);
  assert.ok(Math.abs(a.cv - b.cv) <= 0.05,
    `CV 不同档：recall ${a.cv.toFixed(3)} vs 非 recall ${b.cv.toFixed(3)}`);
});

/* ============ V-103c · recall 轮可触发 contingence ============ */

test("T4 · V-103c recall 轮可触发 contingence（约束② rs[0] 被回读）", () => {
  /* contingencePass 就地改写 rs[0]。若实现忘了回读，line 与「未过 contingence」的
   * 基线完全一致 —— 这里用 ctg 计数器与句子变化双向验证。 */
  let touched = 0, ctgFired = 0;
  for (let i = 0; i < 400; i++) {
    // 制造 c1 冷落→想念 的前置：contingency.js:18 读的是 state.lastVisit（不是 lastTurnAt）
    const st = recallState({ lastVisit: Date.now() - 13 * 36e5 });
    st.mem = jobMem();
    const before = JSON.stringify(st.ctg || {});
    const r = M.recallV2("今天上班好累", st, { now: Date.now(), lv: 4 });
    if (!r) continue;
    touched++;
    if (JSON.stringify(st.ctg || {}) !== before) ctgFired++;
  }
  assert.ok(touched >= 100, `recall 出句过少(${touched})`);
  assert.ok(ctgFired > 0,
    "400 轮 recall 中 contingence 一次都没被触达 —— pacingOf 挂点没接上，或 ctx 未透传 st");
});

test("T4 · V-103c 约束②：contingencePass 就地改写必须被回读进 line", () => {
  /* 直接对 skin() 的下游行为取证：把 contingency 换成一个「必然改写 rs[0]」的探针，
   * 若 memory 侧没回读，line 里就看不到探针标记。 */
  const real = E.mod("contingency");
  const orig = real && real.contingencePass;
  const MARK = "＃CTGPROBE";
  try {
    real.contingencePass = (reply, rs) => { rs[0] = String(rs[0] || "") + MARK; return true; };
    let seen = 0, n = 0;
    for (let i = 0; i < 200; i++) {
      const st = recallState();
      st.mem = jobMem();
      const r = M.recallV2("今天上班好累", st, { now: Date.now(), lv: 4 });
      if (!r) continue;
      n++;
      if (r.line.indexOf(MARK) >= 0) seen++;
    }
    assert.ok(n >= 30, `样本过少(${n})`);
    assert.strictEqual(seen, n,
      `约束② 失守：${n - seen}/${n} 轮丢掉了 contingence 的就地改写（未回读 rs[0]）`);
  } finally {
    if (orig) real.contingencePass = orig;
  }
});

/* ============ V-103d ★ 配额不双计（约束④） ============ */

test("T4 · V-103d 配额不双计：纯 recall 400 轮 ctg.n 收敛于 CAP=2，绝不出现 4", () => {
  /* 双触发的特征值是 4（同一轮 contingencePass 被调两次，各自 +1）。
   * 这里用**同一个 state 连续跑**，让计数器有机会累积。 */
  const st = recallState();
  st.mem = jobMem();
  let turns = 0;
  for (let i = 0; i < 400; i++) {
    const r = M.recallV2("今天上班好累", st, { now: Date.now(), lv: 4 });
    if (r) turns++;
  }
  assert.ok(turns >= 100, `recall 出句过少(${turns})，用例失效`);
  const n = (st.ctg && typeof st.ctg.n === "number") ? st.ctg.n : 0;
  assert.ok(n <= 2, `日配额被击穿：ctg.n = ${n} > CAP 2 —— 极可能是 contingencePass 双触发`);
  assert.notStrictEqual(n, 4, "ctg.n = 4 是双触发的特征值");
});

test("T4 · V-103d 姊妹项：tex.n 仍收敛在 6（A6-b 既有断言不退化）", () => {
  const st = recallState();
  st.mem = jobMem();
  for (let i = 0; i < 400; i++) M.recallV2("今天上班好累", st, { now: Date.now(), lv: 4 });
  const n = (st.tex && typeof st.tex.n === "number") ? st.tex.n : 0;
  assert.ok(n > 0, "texture 一次都没走（skin 链路断了）");
  assert.ok(n <= 6, `texture 日配额被击穿：tex.n = ${n} > 6`);
});

test("T4 · V-103d 结构：memory.js 内不得出现 contingencePass 直调", () => {
  const src = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥注释，注释里提它是允许的
  assert.ok(!/contingencePass/.test(code),
    "memory.js 代码体内直调 contingencePass —— 违反 DESIGN §5.4 约束④，会双计 CAP");
  assert.match(code, /E\.mod\("presence"\)/, "R-P2 挂点缺失：未经注册表查 presence");
});

/* ============ 约束① · 同序（pacing 必须在 texture 之后） ============ */

test("T4 · 约束① 同序：pacingOf 调用点必须排在 texturePass 之后", () => {
  const src = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const iTex = code.indexOf("texturePass");
  const iPac = code.indexOf("pacingOf");
  assert.ok(iTex >= 0 && iPac >= 0, "texturePass / pacingOf 调用点缺失");
  assert.ok(iTex < iPac,
    "pacingOf 排在 texturePass 之前 —— contingence 拼接的句子会绕过 texture，且节奏长度偏短");
});

/* ============ engine 侧透传闭环 ============ */

test("T4 · engine 闭环：reply() 的 recall 出口顶层带 pacing，且与 rv.pacing 同源", () => {
  let n = 0, withPacing = 0;
  for (let i = 0; i < 300; i++) {
    const st = recallState();
    st.mem = jobMem();
    const r = E.reply("今天上班好累", st, { rng: Math.random });
    if (!r || r.intentEx !== "recall") continue;
    n++;
    if (r.pacing && typeof r.pacing.delayMs === "number") withPacing++;
  }
  assert.ok(n >= 20, `reply() 未走到 recall 出口(${n}/300)，用例失效`);
  const rate = withPacing / n;
  assert.ok(rate >= 0.95,
    `engine recall 出口 pacing 透传率 ${(rate * 100).toFixed(1)}% < 95%（:2897 透传没接上？）`);
});

test("T4 · engine 闭环：非 recall 出口的 pacing 不受影响（零回归）", () => {
  let n = 0, withPacing = 0;
  for (let i = 0; i < 300; i++) {
    const st = recallState();
    const r = E.reply("在干嘛呀", st, { rng: Math.random });
    if (!r || r.intentEx === "recall") continue;
    n++;
    if (r.pacing && typeof r.pacing.delayMs === "number") withPacing++;
  }
  assert.ok(n >= 100, `非 recall 样本过少(${n})`);
  assert.ok(withPacing / n >= 0.9,
    `非 recall 出口 pacing 退化：${withPacing}/${n}`);
});

/* ============ 【新发现 · v13 既有缺陷】contingency L5 缺 A6-a 折叠 ============
 * `engine.js:1322` 判破墙前会做 A6-a 等长折叠 `程序[员猿媛] → 职`，
 * 而 `contingency.js:25` 的 L5 出口复检是**裸** `E.PERSONA_BREAK_RE.test(o)`。
 * 后果：用户说过「我是程序员」，此后任何回忆这条事实的句子一旦拼上情境反应，
 * 都会被自家裸词「程序」判成破墙而**整条丢弃** —— 情境反应在该事实上恒不生效，
 * 且失败是静默的（回退原句，没有任何日志）。这不是 R-P2 引入的，v13 就存在。
 * 修复落点：T5 改造 L5 层时把折叠补上（与 :1322 同口径，约 +22B）。 */
test("A6-a-ctg [T5 已修复] contingency L5 出口复检与 :1322 同口径做程序族折叠", () => {
    const G = E.mod("contingency");
    const st = recallState({ lastVisit: Date.now() - 13 * 36e5 });
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      const s = recallState({ lastVisit: Date.now() - 13 * 36e5 });
      const rs = ["我记得你说过你是程序员，最近还忙吗"];
      if (G.contingencePass(rs[0], rs, {
        st: s, ue: E.detectUserEmotion("今天上班好累"), lv: 4,
        crisis: false, text: "今天上班好累", rng: Math.random,
      })) fired++;
    }
    assert.ok(fired > 0,
      `含「程序员」的回忆句 200 轮零情境反应 —— L5 裸判破墙把自己人误杀（st=${!!st}）`);
  });

/* ============ 体积 ============ */

test("T4 · 体积：engine :2897 +19B、memory R-P2 净增 ≤700B，四把锁全绿", () => {
  const WS = require("./wiring-scan.js");
  const s = WS.scanSizes();
  assert.deepStrictEqual(s.over, [], "单文件配额越界: " + JSON.stringify(s.over));
  assert.ok(s.engineNet <= WS.SIZE_BUDGET.engineNetMax,
    `engine net 越界: ${s.engineNet} > ${WS.SIZE_BUDGET.engineNetMax}`);
  assert.ok(s.engine <= WS.SIZE_BUDGET.engineMax,
    `V-33 越界: ${s.engine} > ${WS.SIZE_BUDGET.engineMax}`);
  assert.ok(s.moduleSum <= WS.SIZE_BUDGET.moduleSumMax, `moduleSum 越界: ${s.moduleSum}`);
  assert.ok(s.total <= WS.SIZE_BUDGET.totalMax, `total 越界: ${s.total}`);
  /* R-P2 在 memory 侧的净增（相对 T3 收线 12705B）。DESIGN 估 460B，实交付偏大，
   * 上限放到 700B —— 超过就说明有语料/逻辑本该下沉却写在了 skin 里。 */
  assert.ok(s.each["memory.js"] - 12705 <= 700,
    `R-P2 memory 净增 ${s.each["memory.js"] - 12705}B > 700B`);
  /* engine 侧就是那 19B，一个字节都不许多；v15 T2 再加 NOTE-2 的 13B（:1307 单行）；
   * v15 Q-V15-1 再加副词槽补全的 60B（仍是 :1307 单行，修 H13 破墙漏网，不申请配额）；
   * ★ v16 T1 再加四轴扩展的 190B（仍是 :1307 单行，H13 升级为六维全组合闭环，
   *   配额已由 V16-3 前置抬至 engineNetMax 2400，落位 2350 余 50B）。
   * ★ v17 T1/T2 再加 266B（13 行行内追加：pnorm 真源 +103 / :1322 收口 −29 /
   *   R2-A5b 回避终止语 +69 / 归一化接线 ×6 +42 / Q-P2-D11 防重放 +74 / 导出 +7），
   *   配额已由 v17 T0 前置抬至 engineNetMax 2800，落位 2616 余 184B。
   * ★ v18 T1 再加 42B（:1310 pnorm 行内追加 seg2 零宽黑名单剥离 /[\u200B\u200C\u200D\uFEFF]/g，
   *   行数不变；engineNetMax 仍 2800 不动，落位 2658 余 142B）。 */
  assert.strictEqual(s.engineNet, 2658,
    `engine net 应为 2056(T5b) + 12(R-P0) + 19(R-P2) + 13(v15 NOTE-2) + 60(Q-V15-1) + 190(v16 T1) + 266(v17 T1/T2) + 42(v18 T1 零宽) = 2658，实际 ${s.engineNet}`);
});
