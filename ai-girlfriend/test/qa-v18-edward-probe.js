"use strict";
/* QA 独立验收探针 · v18 · 作者：严过关（QA）
 * 目的：不采信工程师交付声明与其自写测试，独立实证「零宽加固」的绿转红。
 * 手法：从 git 47c35c6 检出**真实 v17 引擎**（/tmp/v17ref），与当前 v18 引擎并排跑，
 *       同一批「零宽切开破墙词本体」样例在 v17 下必须漏（红），v18 下必须拦（绿）。
 * 这比工程师测试里手写的 pnormV17 对照组更强：对照组是真实历史二进制，不是复述。 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const V17 = "/tmp/v17ref";

function loadFrom(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "engine.files.json"), "utf8"));
  let list = (cfg.order || ["engine.js"]).concat(cfg.optional || []);
  const out = [];
  for (const f of list) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) out.push(fs.readFileSync(p, "utf8"));
  }
  return new Function(`${out.join("\n;\n")}\nreturn Engine;`)();
}

const E18 = loadFrom(ROOT);
const E17 = loadFrom(V17);

let FAIL = 0;
const ok = (cond, name, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!cond) FAIL++;
};

/* 出口闸：被护栏拦下（替换为兜底句）→ true */
const blockedBy = (E) => (s) => E.guardPersonaReplies([s], "阿明")[0] !== s;
const b17 = blockedBy(E17), b18 = blockedBy(E18);

console.log("=== 环境自证 ===");
ok(E17.pnorm("A\u200BI") === "A\u200BI", "v17 引擎确为三段 pnorm（零宽保留）",
  JSON.stringify(E17.pnorm("A\u200BI")));
ok(E18.pnorm("A\u200BI") === "AI", "v18 引擎确为四段 pnorm（零宽剥离）",
  JSON.stringify(E18.pnorm("A\u200BI")));

/* ── 0. 前置事实：JS `\s` 对四个零宽字符的覆盖（决定谁能绿转红）──
 * `\s` 匹配 U+FEFF（ECMA-262 WhiteSpace 历史特例），但**不**匹配 U+200B/200C/200D。
 * ⇒ v17 三段 pnorm 的 `.replace(/\s+/g,"")` 已吃掉 U+FEFF，故 U+FEFF 样例在 v17 下
 *   本就被拦，**不可能也不应当**绿转红。真正的绕过通道只有 200B/200C/200D 三个。
 * 这是 QA 第 1 轮自身探针的勘误点（原把 FEFF 也列入绿转红预期，属测试代码 bug 已自修）。 */
console.log("\n=== 0. 前置事实：\\s 对零宽字符的覆盖 ===");
ok(!/\s/.test("\u200B") && !/\s/.test("\u200C") && !/\s/.test("\u200D"),
  "U+200B/200C/200D 不被 \\s 覆盖 ⇒ 这三个是 v17 的真实绕过通道");
ok(/\s/.test("\uFEFF"),
  "U+FEFF 被 \\s 覆盖 ⇒ v17 已能处理，黑名单中属冗余显式项（防御纵深，非新增能力）");

/* ── 1. SPLIT 组：零宽真正切开破墙词本体（仅 200B/200C/200D 可绿转红）── */
console.log("\n=== 1. SPLIT 绿转红（零宽切开破墙词本体）===");
const SPLIT = [
  ["我是A\u200BI", "U+200B 切开 AI"],
  ["你是个机\u200C器人", "U+200C 切开 机器人"],
  ["我是个程\u200D序", "U+200D 切开 程序"],
  ["我是语言模\u200B型", "U+200B 切开 语言模型/模型"],
  ["机器\u200B人", "U+200B 切开 机器人（主理人指定）"],
  ["程\u200D序", "U+200D 切开 程序（主理人指定）"],
  ["你是聊天机\u200B器人吧", "U+200B 切开 机器人（长句）"],
  ["我是人工智\u200C能", "U+200C 切开 人工智能"],
];
let redOnV17 = 0, greenOnV18 = 0;
for (const [s, desc] of SPLIT) {
  const leak17 = !b17(s), kill18 = b18(s);
  if (leak17) redOnV17++;
  if (kill18) greenOnV18++;
  ok(leak17 && kill18, `${desc}`,
    `v17=${leak17 ? "漏(红)" : "拦"} → v18=${kill18 ? "拦(绿)" : "漏"}  ${JSON.stringify(s)}`);
}
console.log(`  SPLIT 小结：v17 漏网 ${redOnV17}/${SPLIT.length}，v18 拦截 ${greenOnV18}/${SPLIT.length}`);
ok(redOnV17 === SPLIT.length && greenOnV18 === SPLIT.length,
  "★ SPLIT 组绿转红坐实（v17 条条漏 → v18 条条拦）");

/* U+FEFF 切词组：v17 本就拦（\s 覆盖），v18 仍拦 —— 断言「不回归」而非「绿转红」 */
console.log("\n=== 1b. U+FEFF 切词组（v17 本就拦，断言不回归）===");
for (const s of ["我是人工智\uFEFF能", "机器\uFEFF人", "我是A\uFEFFI"]) {
  ok(b17(s) && b18(s), `v17/v18 均拦  ${JSON.stringify(s)}`);
}

/* ── 2. 复核工程师自曝的 DESIGN §3.2.4 A 段样例勘误 ── */
console.log("\n=== 2. DESIGN §3.2.4 A 段原样例勘误复核 ===");
const A_SEG = [
  "我是A\u200BI",
  "你是个\u200C机器人",
  "我\u200D只是个程序",
  "\uFEFF我是语言模型",
];
let a17leak = 0;
for (const s of A_SEG) {
  const leak17 = !b17(s);
  if (leak17) a17leak++;
  console.log(`    ${JSON.stringify(s)}  v17=${leak17 ? "漏" : "本就拦"}  v18=${b18(s) ? "拦" : "漏"}`);
}
ok(a17leak === 1, "工程师自曝属实：A 段 4 条中仅 1 条在 v17 真漏（其余 3 条本就被拦，非绕过证据）",
  `v17 真漏 ${a17leak}/4`);
ok(A_SEG.every((s) => b18(s)), "A 段 4 条在 v18 下全部被拦");

/* ── 3. 零宽 × 全插入位 × 破墙词：穷举泄漏扫描 ── */
console.log("\n=== 3. 零宽 × 全插入位穷举（破墙侧必须 0 漏网）===");
const ZW = ["\u200B", "\u200C", "\u200D", "\uFEFF"];
const BREAK = ["我是AI", "你是个机器人", "我只是个程序", "我是语言模型",
  "我是人工智能", "我是聊天机器人", "我是个bot", "我是虚拟的"];
let bLeak = [], bTotal = 0;
for (const base of BREAK) {
  for (const z of ZW) {
    for (let i = 0; i <= base.length; i++) {
      const v = base.slice(0, i) + z + base.slice(i);
      bTotal++;
      if (!b18(v)) bLeak.push(v);
    }
  }
}
ok(bLeak.length === 0, `破墙句零宽全插入位 0 漏网`,
  `${bTotal} 组合，漏 ${bLeak.length}${bLeak.length ? " → " + JSON.stringify(bLeak.slice(0, 5)) : ""}`);

/* ── 4. 良性/职业 × 零宽全插入位：0 误杀 ── */
console.log("\n=== 4. 良性 + 职业 × 零宽全插入位（必须 0 误杀）===");
const BENIGN = ["高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型"];
const JOB = ["你是系统管理员", "我是软件工程师", "你是数据分析师", "我是机器学习方向的研究生",
  "他是算法工程师", "她是代码审查员", "我是深度学习方向的研究生", "你是对话系统工程师",
  "我是神经网络专业的", "他是模型专业的研究生", "我是做算法方向的", "她是 app 工程师",
  "你是脚本专业的", "我是程式方向的研究生"];
const U5 = ["训练成绩比上周好", "今天训练很累", "我去健身房训练了", "训练营结束了"];

const bareKill = [...BENIGN, ...JOB, ...U5].filter(b18);
ok(bareKill.length === 0, "裸形态基线 0 误杀（八良性 + 14 职业 + 4×U-5）",
  `${BENIGN.length}+${JOB.length}+${U5.length} 句，误杀 ${bareKill.length}`);

let kills = [], kTotal = 0;
for (const s of [...BENIGN, ...JOB, ...U5]) {
  for (const z of ZW) {
    for (let i = 0; i <= s.length; i++) {
      const v = s.slice(0, i) + z + s.slice(i);
      kTotal++;
      if (b18(v)) kills.push(v);
    }
  }
}
ok(kills.length === 0, "零宽 × 全插入位 0 误杀",
  `${kTotal} 组合，误杀 ${kills.length}${kills.length ? " → " + JSON.stringify(kills.slice(0, 5)) : ""}`);

/* ── 5. emoji ZWJ 不受损（N-1 端到端） ── */
console.log("\n=== 5. emoji ZWJ 输出侧不受损（N-1）===");
for (const e of ["👨\u200D👩\u200D👧", "👩\u200D💻", "🏳\uFE0F\u200D🌈"]) {
  const line = `今天做了饭 ${e}`;
  const out = E18.guardPersonaReplies([line], "阿明")[0];
  ok(out === line && out.includes("\u200D"), `ZWJ 逐字节保留 ${e}`);
}
ok(E18.pnorm("👨\u200D👩") === "👨👩", "判定副本内 ZWJ 确被剥离（反向取证，非碰巧）");

/* ── 6. 幂等 ── */
console.log("\n=== 6. pnorm 幂等 ===");
const IDEM = ["我是A\u200BI", "你是个\u200C机器人", "\uFEFF我是语言模型", "我是程序员",
  "高达模型", "你 是 A I", "ＡＩ", "👨\u200D👩\u200D👧", ""];
ok(IDEM.every((s) => E18.pnorm(E18.pnorm(s)) === E18.pnorm(s)), "pnorm(pnorm(x)) === pnorm(x)",
  `${IDEM.length} 例`);

console.log(`\n=== 汇总：FAIL ${FAIL} ===`);
console.log(FAIL === 0 ? "总判定: PASS" : "总判定: FAIL");
process.exit(FAIL === 0 ? 0 : 1);
