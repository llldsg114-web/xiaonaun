"use strict";
/* ============================================================================
 * v14 · T3 验收：R-P1 会计后缀（P2 · 全 v14 唯一负成本项）
 * 对应 DESIGN-v14 §4.4 / T3 / V-102
 *
 * 【缺陷】`memory.js:26` R23 职业抽取规则的后缀白名单
 *   `(?:师|员|生|工|家|猿|媛|士)` 里没有「计」——「我是会计」抽不出，
 *   于是既不入库也不召回：用户说了一次职业，她永远想不起来。
 *
 * 【修法】后缀组补「计」并顺手折叠为**字符类**：
 *   `(?:师|员|生|工|家|猿|媛|士)`（35B） → `[师员生工家猿媛士计]`（29B）
 *   语义完全等价（单字符择一），新增一个成员反而**净减 6 字节**。
 *   PM 估 +3B，实测 −6B —— 折叠省下的 9B 覆盖了新增成员的 3B。
 *
 * 【为什么补「计」是安全的】R23 抬头写着「宁可漏抽不可错抽（H11 第一道闸）」，
 *   放宽后缀等于把闸门开大一格，必须证明三重护栏还兜得住「我是计划做这个的」：
 *     ① `#{1,6}` 长度上限 —— 捕获组最多 6 个词字符；
 *     ② `BADV` 前缀黑名单 —— 值以 说/不是/真/想/要/… 开头即丢弃；
 *     ③ `ASK` 提问闸 —— 整句是问句就整条规则不跑。
 *   本文件用 24 条干扰句逐条反证，抽取数必须为 0。
 *
 * 【注释归档】T1 已把 `memory.js:29`（HEAD 行号）的行尾注释迁出到
 *   DESIGN-v14 §13.1 表格。按 §13.1 尾注，T3 后归档文本更新为：
 *     「遗留-1 补 猿|媛|士；v14 R-P1 补「计」并折叠为字符类（净 −6B）；
 *       下限 2→1 让 医生/护士 双字职业也抽得出」
 *   —— 归档文本不占源码字节，故 −6B 结论不受影响。
 * ========================================================================== */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const E = H.loadEngine();
const M = E.mod("memory");

const now = () => Date.now();

/* 抽取一次并返回「工作」类事实（没抽到返回 null） */
function jobFact(text) {
  const r = M.extractFacts(text, {}, { now: now() });
  if (!r || !r.facts || !r.facts.length) return null;
  return r.facts.find((f) => f.key === "工作") || null;
}

/* ============ V-102 ① · 「我是会计」入库 ============ */

test("T3 · V-102 「我是会计」可入库：抽出 工作=会计，conf .8，带 工作 tag", () => {
  const f = jobFact("我是会计");
  assert.ok(f, "「我是会计」未被抽取 —— R-P1 未生效");
  assert.strictEqual(f.key, "工作");
  assert.strictEqual(f.value, "会计");
  assert.strictEqual(f.conf, 0.8, "基线 conf 应与其他职业一致");
  assert.ok(f.tags.includes("工作"), "缺 工作 tag，决策⑤ 检索桥接不上");
});

test("T3 · V-102 「我是会计」的量词/口语变体也入库", () => {
  const VARIANTS = ["我是会计", "我是个会计", "我是名会计", "我是 会计", "我是注册会计师"];
  for (const s of VARIANTS) {
    const f = jobFact(s);
    assert.ok(f, `变体未抽取：「${s}」`);
    assert.ok(/会计/.test(f.value), `变体抽取值不含「会计」：「${s}」→ ${f.value}`);
  }
});

/* ============ V-102 ② · 端到端召回（入库不等于想得起来） ============ */

test("T3 · V-102 端到端：会计入库后「今天上班好累」能召回", () => {
  const mem = M.applyPatch({}, M.extractFacts("我是会计", {}, { now: now() }));
  assert.ok(mem.facts && mem.facts.length === 1, "入库失败");
  const hits = M.retrieveFacts("今天上班好累", { mem }, 3);
  assert.strictEqual(hits.length, 1, "会计事实召回失败（tag 桥或字符余弦未接上）");
  assert.ok(hits[0].score >= 0.45, "召回分过低: " + hits[0].score);
});

/* 反证：这条链路在 v13 是断的（证明用例测的是真缺陷，不是恒真）
 * ★【v15 T0 基线重置 · U-1】原实现从字面量 `HEAD` 取"v13 旧规则"。v14 收口后 HEAD 已含
 * 带「计」的新后缀组 ⇒「基线后缀组不应含『计』」恒假 ⇒ 自失效转红（7 条红之一）。
 * 改走 `baseline.PREV`（= b86a386^ = v13 收口），语义回到原意。S-4：不再出现字面量 HEAD。 */
test("T3 · V-102 反证：同一条链路在 v13 规则下抽取为 0", () => {
  const BL = require("./baseline.js");
  const src = BL.showAt(BL.PREV, "memory.js");
  const line = (src.match(/我是\(\?:个\|名\)\?\\\\s\*\(#\{1,6\}[^)]*\)\)?/) || [])[0];
  assert.ok(line, "无法从 v13 收口基线提取 R23 职业规则");
  assert.ok(!/计/.test(line), "v13 基线的 R23 后缀组不应含「计」，样本失真");
  // 用 v13 基线的后缀组现场重建旧正则，验证「我是会计」抽不出
  const W = "[\\u4e00-\\u9fa5A-Za-z0-9_]";
  const oldRe = new RegExp("我是(?:个|名)?\\s*(#{1,6}(?:师|员|生|工|家|猿|媛|士))".replace(/#/g, W));
  assert.strictEqual("我是会计".match(oldRe), null, "旧规则本就能抽「会计」，缺陷不存在");
});

/* ============ V-102 ③ · 干扰句抽取 = 0（H11 第一道闸不许被撞开） ============ */

test("T3 · V-102 干扰反证：24 条含「计」的非职业句，工作类抽取数 = 0", () => {
  const NOISE = [
    "我是计划做这个的", "我是计划今晚早点睡", "我是计划性很强的人",
    "我是计较了点", "我是计算过的", "我是计算机专业毕业的没错但现在不干了",
    "我是计不清楚了", "我是计时开始的", "我是计划去看你",
    "我是计划外的", "我是计划赶不上变化", "我是计划书写完了才睡",
    "我是计划着周末去", "我是计划中的一部分", "我是计划改了",
    "我是计划泡汤了", "我是计划通", "我是计划再等等",
    /* 提问式（ASK 闸）：考她不是告诉她 */
    "我是会计吗？", "我是会计吗", "你猜我是会计还是老师？",
    /* 前缀黑名单（BADV 闸） */
    "我是想当会计来着", "我是要去考会计证", "我是说会计那件事",
  ];
  const leaked = [];
  for (const s of NOISE) {
    const f = jobFact(s);
    if (f) leaked.push(`${s} → ${f.value}`);
  }
  assert.strictEqual(leaked.length, 0,
    `H11 第一道闸被撞开，错抽 ${leaked.length}/${NOISE.length} 条：${leaked.join(" | ")}`);
});

/* ============ V-102 ④ · 既有职业族零回归 ============ */

test("T3 · V-102 零回归：原八后缀族逐一仍可抽取，值逐位不变", () => {
  const CASES = [
    ["我是老师", "老师"], ["我是程序员", "程序员"], ["我是学生", "学生"],
    /* 「工」是**后缀**不是词：电工/钳工 抽得出，「工人」的后缀是「人」故抽不出 ——
     * 这是 R23 白名单的既有语义（v13 同样行为），不属 T3 范围，样本按后缀取。 */
    ["我是电工", "电工"], ["我是作家", "作家"], ["我是程序猿", "程序猿"],
    ["我是程序媛", "程序媛"], ["我是护士", "护士"], ["我是医生", "医生"],
    ["我是设计师", "设计师"], ["我是公务员", "公务员"], ["我是研究生", "研究生"],
  ];
  for (const [text, want] of CASES) {
    const f = jobFact(text);
    assert.ok(f, `零回归失守，抽不出：「${text}」`);
    assert.strictEqual(f.value, want, `抽取值漂移：「${text}」→ ${f.value}`);
  }
});

test("T3 · V-102 零回归：八职业族召回率不退化（每族 300 次采样 > 100）", () => {
  const jobMem = (value) => ({
    v: 13, migratedAt: 0, moments: [],
    facts: [{
      id: "f_job", key: "工作", value, conf: 0.8, tags: ["工作"],
      since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
    }],
  });
  for (const v of ["老师", "程序员", "工程师", "设计师", "医生", "护士", "公务员", "会计"]) {
    let hit = 0;
    for (let i = 0; i < 300; i++) {
      const r = M.recallV2("今天上班好累", { mem: jobMem(v) }, { now: now() });
      if (r && r.line && r.line.includes(v)) hit++;
    }
    assert.ok(hit > 100, `${v} 召回 ${hit}/300，低于基线水位`);
  }
});

/* ============ 结构 + 体积 ============ */

test("T3 · 结构：R23 后缀组必须是字符类形态（不得回退为择一组）", () => {
  const src = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  assert.match(src, /我是\(\?:个\|名\)\?\\\\s\*\(#\{1,6\}\[师员生工家猿媛士计\]\)/,
    "R23 后缀组不是 `[师员生工家猿媛士计]` 字符类形态");
  assert.ok(!/\(\?:师\|员\|生\|工\|家\|猿\|媛\|士/.test(src),
    "旧的择一组残留，字节没省下来");
  // R23 铁律锚点注释必须还在（DESIGN §13.1 列为「禁删」）
  assert.match(src, /R23 宁可漏抽不可错抽（H11 第一道闸）/,
    "R23 铁律锚点注释被删 —— 护栏依据丢失");
});

/* ★【v15 T0 基线重置 · U-1】同上：基线由字面量 `HEAD` 改走 `baseline.PREV`。
 * memory.js 在 v15 是**零改动文件**（DESIGN-v15 §2.4），故"当前 vs v13 收口"仍恰为 −6B，
 * 断言值一个字都不用改 —— 这正是"基线腐坏而非行为回归"的直接证据。 */
/* ★【v16 T0 上限翻转】memory.js 配额 14336 → 14154（V16-3 让渡 182B 给 engineNet）。
 * 断言体本就走 `WS.SIZE_BUDGET["memory.js"]` 单一真源，无硬编码 —— 仅标题数字同步。
 * ★★【v17 T0/T2 · 主理人 Qi 批准（DESIGN-v17 §2.5 唯一解 + §6-T2 归一化收口）】★★
 *   ① 配额 14154 → 13824（让渡 330B 给 engineNet 与 contingency，仍走单一真源自动跟随）；
 *   ② 「零改动文件」翻转为 **「白名单内改动 + 净减 38B」**：v17 获批 6 行
 *      :98/:112 注释同步、:99 删 JOBX 常量、:100 taint 走 E.pnorm、:107 weave 走 E.pnorm、
 *      :120 JOBX 删除后就地内联掩码正则。
 *   ⚠ 这不是放松：原判据只断"有没有 diff"，新判据同时断 **行数不变 + 改动行 ⊆ 白名单 +
 *      净字节恰好 −38**（strictEqual 硬钉），三条同时成立才绿，严格度只增不减。 */
test("T3 · 体积：memory.js 相对 T1 收线净减 6B，v17 归一化再净减 38B，且仍在 13824B 配额内", () => {
  const BL = require("./baseline.js");
  const cur = fs.statSync(path.join(ROOT, "memory.js")).size;
  const WS = require("./wiring-scan.js");
  assert.ok(cur <= WS.SIZE_BUDGET["memory.js"],
    `memory.js 越配额：${cur} > ${WS.SIZE_BUDGET["memory.js"]}`);
  // 单项净减：只比 R23 那一行的字节差，避免被同文件其他改动干扰
  const head = BL.showAt(BL.PREV, "memory.js");
  const pick = (s) => (s.match(/.*我是\(\?:个\|名\)\?.*/) || [""])[0]
    .replace(/\/\/.*$/, "").trimEnd();
  assert.ok(pick(head), "v13 收口基线未取到 R23 行，样本失真");
  const delta = Buffer.byteLength(pick(fs.readFileSync(path.join(ROOT, "memory.js"), "utf8")))
    - Buffer.byteLength(pick(head));
  assert.strictEqual(delta, -6, `R-P1 应净减 6B（不含注释），实际 ${delta}B`);
  /* v17 T2 归一化收口铁律（替代 v15 的「零改动」口径）：行数不变 + 改动行 ⊆ 白名单 + 净 −38B */
  const WHITELIST = [98, 99, 100, 107, 112, 120];
  const src = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  const base = BL.showAt(BL.V14, "memory.js");
  const cl = src.split("\n"), bl = base.split("\n");
  assert.strictEqual(cl.length, bl.length, "memory.js 行数必须不变（纯定点替换）");
  const moved = [];
  for (let i = 0; i < cl.length; i++) if (cl[i] !== bl[i]) moved.push(i + 1);
  assert.deepStrictEqual(moved.filter((l) => WHITELIST.indexOf(l) < 0), [],
    "memory.js 改动超出 v17 §6-T2 白名单，越界行: " + JSON.stringify(moved));
  assert.strictEqual(cur - Buffer.byteLength(base), -38,
    `v17 归一化收口应净减 38B（删 JOBX 常量 −29 / taint 走 pnorm −20 / weave +9 / 注释与内联掩码 +2），实际 ${cur - Buffer.byteLength(base)}B`);
  // 真源唯一性：JOBX 常量必须已删除，taint 与 weave 都必须消费 E.pnorm
  assert.strictEqual(/const JOBX\s*=/.test(src), false, "JOBX 常量残留 —— 第 3 套折叠字面量未删除（S-1b）");
  assert.match(src, /const taint = \(v\) => E\.PERSONA_BREAK_RE\.test\(E\.pnorm\(v\)\);/, "taint 未走 E.pnorm");
  assert.match(src, /SELF\.test\(s\) && E\.PERSONA_BREAK_RE\.test\(E\.pnorm\(s\)\)/, "weave 未走 E.pnorm");
});
