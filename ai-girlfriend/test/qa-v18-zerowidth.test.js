"use strict";
/* 小暖 · v18 T4 专项：pnorm 零宽字符加固回归（DESIGN-v18 §3.2.4 七段 A–G）
 *
 * ── 这次改的到底是什么 ──────────────────────────────────────────
 * v17 的 `pnorm`（engine.js:1310，S-1b 单一真源）是三段：
 *     String(s).normalize("NFKC").replace(/\s+/g,"").replace(/程序[员猿媛]/g,"职")
 * 缺陷（QA-v17 §7-D 实证）：`normalize("NFKC")` **不清除**零宽字符（Cf 类格式字符，
 * NFKC 明确保留），而 JS 正则 `\s` 亦**不匹配** U+200B/200C/200D
 * （只匹配 U+FEFF —— 这是 `\s` 的一个历史特例）。
 * ⇒ `我是A\u200BI` 不被 PERSONA_BREAK_RE 拦截，而 `我是AI` 被拦截 —— 一条绕过通道。
 *
 * v18 在 seg1 与 `\s+` **之间**插入 seg2 零宽黑名单剥离（+42B，行内追加，行数不变）：
 *     .replace(/[\u200B\u200C\u200D\uFEFF]/g,"")
 *
 * ── 为什么段序必须是「NFKC → 零宽 → \s+ → 折叠」（DESIGN-v18 §1.3 裁定①）──
 * 在当前四字符集下前置/后置**等价**，取前置的理由是**单调性**：零宽是不可见分隔符，
 * 语义上与空白同类且更应先于空白消除。一旦 v19 把黑名单扩到 U+2060(WJ)/U+180E 一类
 * 「可被 `\s` 部分覆盖」的字符，后置写法会产生序敏感的漏网。
 *
 * ── 为什么采四字符枚举而非区间式（DESIGN-v18 §3.2.2 裁定③）──
 * `[\u200B-\u200D\uFEFF]`（37B）与枚举（42B）覆盖**完全相同**的码点，但区间存在
 * **范围蔓延风险**：改成 `\u200B-\u200F` 只需改一个字符，却会连带吞掉
 * U+200E LRM / U+200F RLM（双向文本标记，对 RTL 文本有真实语义影响）。
 * 枚举式让「加一个码点」必须显式写出 6 个字符 —— 5B 买一道防误扩的结构性护栏。
 *
 * ── 不变量 N-1（本文件 G 段的形态钉守护对象）─────────────────────
 * `pnorm()` 的返回值**只作为 PERSONA_BREAK_RE.test() 的实参**，从不被赋值、拼接、
 * 或回写到任何输出文本。12 个消费点（engine 7 + 模块 5）12/12 满足。
 * ⇒ 剥离 ZWJ(U+200D) 对 emoji 渲染**零影响**：用户可见文本永远是未经 pnorm 的原串。
 * N-1 是**当前代码形态**成立的性质，不是语言层保证 —— 若未来有人写
 * `const clean = E.pnorm(x); return clean;`，`👨‍👩‍👧` 就会被打断成 `👨👩👧`。
 * 故 G 段把 N-1 从「靠自觉」升级为「靠断言」。**该钉不得删除。**
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadEngine, ROOT } = require("./helpers.js");

const E = loadEngine();
const RE = E.PERSONA_BREAK_RE;
const pnorm = E.pnorm;

/** 四字符零宽黑名单（与 engine.js:1310 seg2 同集合，此处独立写死以规避循环论证） */
const ZW = ["\u200B", "\u200C", "\u200D", "\uFEFF"];
const ZW_RE = /[\u200B\u200C\u200D\uFEFF]/g;

/** 出口闸判定：被护栏拦下（替换为兜底句）返回 true */
function blocked(s) {
  return E.guardPersonaReplies([s], "阿明")[0] !== s;
}

/** v17 的三段 pnorm（历史形态，用于 A 段「绿转红可证」的对照组） */
const pnormV17 = (s) => String(s).normalize("NFKC")
  .replace(/\s+/g, "").replace(/程序[员猿媛]/g, "职");

/* ══════════════ A · 绕过消灭（v17 下为 false，v18 下必须 true）══════════════ */

test("AC-ZW-A · 零宽绕过样例全部被归一化消灭，且可证 v17 形态确实漏网", () => {
  /* DESIGN-v18 §3.2.4 A 段原列样例：v18 下必须全部被拦。
   * ⚠ 实测勘误：这四条里只有第一条的零宽**落在破墙词内部**，其余三条零宽落在词与词之间
   *   （`你是个|\u200C|机器人` 的「机器人」仍连续、`我\u200D只是个程序` 的「程序」仍连续、
   *    `\uFEFF` 更是本就被 `\s` 覆盖）⇒ 它们在 v17 下**也被拦**，不构成绕过证据。
   *   故「绿转红」取证另用下方 SPLIT 组（零宽真正切开破墙词）。 */
  const CASES = [
    "我是A\u200BI",
    "你是个\u200C机器人",
    "我\u200D只是个程序",
    "\uFEFF我是语言模型",
  ];
  for (const s of CASES) {
    assert.strictEqual(RE.test(pnorm(s)), true,
      `v18 零宽剥离失效，绕过未被消灭：${JSON.stringify(s)} → pnorm=${JSON.stringify(pnorm(s))}`);
  }

  /* ★ 断言非空性取证（D3 纪律 · 绿转红可证）：零宽**切开破墙词本体**的样例，
   *   在 v17 三段形态下必须**条条漏网**，在 v18 四段形态下必须**条条被拦**。
   *   若 v17 组也全绿，说明本用例根本没打到零宽这条通道，A 段是空转的。 */
  const SPLIT = [
    "我是A\u200BI",        // U+200B 切开 AI
    "你是个机\u200C器人",   // U+200C 切开 机器人
    "我是个程\u200D序",     // U+200D 切开 程序
    "我是语言模\u200B型",   // U+200B 切开 语言模型 / 模型
  ];
  for (const s of SPLIT) {
    assert.strictEqual(RE.test(pnormV17(s)), false,
      `A 段断言空转：v17 三段形态本应漏网，实际却拦住了 ${JSON.stringify(s)}`);
    assert.strictEqual(RE.test(pnorm(s)), true,
      `v18 未消灭切词型绕过：${JSON.stringify(s)} → pnorm=${JSON.stringify(pnorm(s))}`);
  }
});

/* ══════════════ B · 幂等 ══════════════ */

test("AC-ZW-B · pnorm 幂等：pnorm(pnorm(x)) === pnorm(x)", () => {
  const CASES = [
    "我是A\u200BI", "你是个\u200C机器人", "我\u200D只是个程序", "\uFEFF我是语言模型",
    "我是程序员", "高达模型", "你 是 A I", "ＡＩ", "👨\u200D👩\u200D👧", "",
  ];
  for (const s of CASES) {
    assert.strictEqual(pnorm(pnorm(s)), pnorm(s),
      `pnorm 非幂等：${JSON.stringify(s)}`);
  }
});

/* ══════════════ C · 与裸形态同判 ══════════════ */

test("AC-ZW-C · 零宽变体与其去零宽原句的 pnorm 结果逐字节相同", () => {
  const BASES = ["我是AI", "你是个机器人", "我只是个程序", "我是语言模型", "我是程序员"];
  for (const base of BASES) {
    for (const z of ZW) {
      // 在每个可插入位逐位注入零宽字符
      for (let i = 0; i <= base.length; i++) {
        const variant = base.slice(0, i) + z + base.slice(i);
        assert.strictEqual(pnorm(variant), pnorm(base),
          `零宽变体与裸形态判定不一致：${JSON.stringify(variant)} → ${JSON.stringify(pnorm(variant))}` +
          ` ≠ ${JSON.stringify(pnorm(base))}`);
      }
    }
  }
});

/* ══════════════ D · emoji 不受损（N-1 端到端取证）══════════════ */

test("AC-ZW-D · 含 ZWJ 的 emoji 经输出路径后逐字节不变（N-1 端到端）", () => {
  const EMOJI = [
    "👨\u200D👩\u200D👧",              // 家庭（双 ZWJ）
    "👩\u200D💻",                      // 女程序员（ZWJ）
    "🏳\uFE0F\u200D🌈",                // 彩虹旗（ZWJ + VS16）
  ];
  for (const e of EMOJI) {
    const line = `今天做了饭 ${e}`;
    const out = E.guardPersonaReplies([line], "阿明")[0];
    assert.strictEqual(out, line,
      `输出路径破坏了 emoji ZWJ 序列（N-1 被违反）：${JSON.stringify(line)} → ${JSON.stringify(out)}`);
    // ZWJ 必须在**输出**里逐字节保留（只在判定副本里被剥离）
    assert.ok(out.includes("\u200D"),
      `ZWJ 被回写剥离，emoji 渲染将受损：${JSON.stringify(out)}`);
  }
  /* 反向取证：判定副本里 ZWJ 确实被剥离了（否则 D 段只是"碰巧没坏"） */
  assert.strictEqual(pnorm("👨\u200D👩"), "👨👩",
    "判定副本内 ZWJ 未被剥离 —— seg2 未生效，D 段取证失真");
});

/* ══════════════ E · 良性不误杀（八良性 + 14 职业句，各插 1 个 ZWSP）══════════════ */

const BENIGN_V15 = ["高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型"];
const JOB_BENIGN = ["你是系统管理员", "我是软件工程师", "你是数据分析师", "我是机器学习方向的研究生",
  "他是算法工程师", "她是代码审查员", "我是深度学习方向的研究生", "你是对话系统工程师",
  "我是神经网络专业的", "他是模型专业的研究生", "我是做算法方向的", "她是 app 工程师",
  "你是脚本专业的", "我是程式方向的研究生"];
const U5_PROTECTED = ["训练成绩比上周好", "今天训练很累", "我去健身房训练了", "训练营结束了"];

test("AC-ZW-E · 八良性 + 14 职业句 + U-5 保护句插入 ZWSP 后仍 0 误杀", () => {
  const ALL = [...BENIGN_V15, ...JOB_BENIGN, ...U5_PROTECTED];
  // 先证裸形态本就 0 误杀（基线非空）
  const bareKill = ALL.filter(blocked);
  assert.deepStrictEqual(bareKill, [], `裸形态即误杀，基线已坏：${JSON.stringify(bareKill)}`);
  // 再证插入零宽后仍 0 误杀（剥离只让原本被切开的字符相邻，理论误杀上界为 0）
  const kills = [];
  for (const s of ALL) {
    for (const z of ZW) {
      for (let i = 0; i <= s.length; i++) {
        const variant = s.slice(0, i) + z + s.slice(i);
        if (blocked(variant)) kills.push(variant);
      }
    }
  }
  assert.deepStrictEqual(kills, [],
    `零宽剥离引入了误杀（理论上界应为 0）：${JSON.stringify(kills.slice(0, 10))}`);
});

/* ══════════════ F · 语料洁净（生成侧不含任何零宽字符）══════════════ */

test("AC-ZW-F · 全仓语料静态扫描：engine + 4 模块不含任何真实零宽码点", () => {
  const FILES = ["engine.js", "memory.js", "presence.js", "texture.js", "contingency.js"];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const hit = src.match(ZW_RE);
    assert.strictEqual(hit ? hit.length : 0, 0,
      `${f} 语料中含 ${hit && hit.length} 个真实零宽码点 —— 生成侧必须洁净` +
      `（注：engine.js:1310 的 \\u200B 等是 ASCII 转义序列，不是真实码点，不应命中）`);
  }
  /* 生成侧自检：构造期语料自扫描恒 0（v15 起的既有不变量，此处连带复核） */
  assert.strictEqual(E.innerScan(), 0, "innerScan() ≠ 0 —— 语料库自身含破墙词");
});

/* ══════════════ G · 单一真源 + N-1 形态钉 ══════════════ */

test("AC-ZW-G1 · S-1b 单一真源：pnorm 定义处数 = 1，模块侧自造副本 = 0", () => {
  const eng = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
  const defs = eng.match(/const\s+pnorm\s*=/g) || [];
  assert.strictEqual(defs.length, 1,
    `engine.js 中 pnorm 定义处数应恒为 1（S-1b），实得 ${defs.length}`);
  // 定义必须落在 :1310（绝对行号，行数不变铁律的连带取证）
  const line1310 = eng.split("\n")[1309];
  assert.match(line1310, /const pnorm = s =>/, ":1310 不再是 pnorm 定义行 —— 行数发生了变化");
  // 四段齐备且段序正确：NFKC → 零宽 → \s+ → 折叠
  assert.match(line1310,
    /normalize\("NFKC"\)[\s\S]*\\u200B\\u200C\\u200D\\uFEFF[\s\S]*\\s\+[\s\S]*程序\[员猿媛\]/,
    ":1310 pnorm 四段序错误（须为 NFKC → 零宽 → \\s+ → 折叠，DESIGN-v18 §1.3）");
  // 模块侧不得自造归一化副本
  for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.strictEqual((src.match(/const\s+pnorm\s*=/g) || []).length, 0,
      `${f} 自造了 pnorm 副本，违反 S-1b 单一真源`);
    assert.strictEqual((src.match(/normalize\("NFKC"\)/g) || []).length, 0,
      `${f} 自造了 NFKC 归一化，必须改走 E.pnorm`);
  }
});

test("AC-ZW-G2 · N-1 形态钉：所有 pnorm 调用点都直接嵌在 .test( 实参位", () => {
  const FILES = ["engine.js", "memory.js", "presence.js", "texture.js", "contingency.js"];
  /* 允许形态（仅此两种，均为 .test() 实参位）：
   *     PERSONA_BREAK_RE.test(pnorm(x))
   *     E.PERSONA_BREAK_RE.test(E.pnorm(x))
   * 违规形态举例（出现即红）：
   *     const clean = pnorm(x)      ← 赋值，返回值可能被回写输出，emoji 会被打断
   *     return pnorm(x)             ← 直接回写
   *     "前缀" + pnorm(x)           ← 拼接 */
  let total = 0;
  const violations = [];
  /* 先剥注释再扫描：contingency.js:63 的行注释里含「E.pnorm(」字样，
   * 不剥会把说明文字误判成消费点（实测假阳性，已取证）。 */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // 块注释（可跨行）
    .split("\n").map((l) => l.replace(/\/\/.*$/, ""));   // 行尾注释
  for (const f of FILES) {
    const lines = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      // 跳过 pnorm 的定义行与导出行（它们不是消费点）
      if (/const\s+pnorm\s*=/.test(ln)) continue;
      // 统计本行的调用次数（导出清单里的裸 `pnorm,` 不算调用）
      const calls = (ln.match(/(?:E\.)?pnorm\(/g) || []).length;
      if (!calls) continue;
      total += calls;
      // 本行每一次调用都必须处在 .test( 实参位
      const okCount = (ln.match(/PERSONA_BREAK_RE\.test\(\s*(?:E\.)?pnorm\(/g) || []).length;
      if (okCount !== calls) {
        violations.push(`${f}:${i + 1}  ${ln.trim()}`);
      }
    }
  }
  assert.deepStrictEqual(violations, [],
    "N-1 被违反：pnorm 返回值出现在非 .test() 实参位（赋值/拼接/回写），" +
    "emoji ZWJ 序列将被破坏。违规点：\n" + violations.join("\n"));
  /* 断言非空性：消费点总数必须恰为 12（engine 7 + 模块 5，DESIGN-v18 §3.2.3 逐点核验）。
   * 少于 12 说明扫描退化（比如路径错了扫到空文件），多于 12 说明新增了未经核验的消费点。 */
  assert.strictEqual(total, 12,
    `pnorm 消费点总数应恒为 12（engine 7 + 模块 5），实得 ${total} —— ` +
    "新增消费点须先按 N-1 逐点核验并更新本断言");
});
