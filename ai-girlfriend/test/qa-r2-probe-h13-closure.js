"use strict";
/* QA 第 2 轮独立探针 · Q-V15-1 闭合复验（H13 破墙密闭性）
 *
 * 纪律：不信任工程师自检，也不复用工程师写的测试断言。
 * 本探针自建输入集，走**生产路径** guardPersonaReplies()（reply() 所有出口都过它），
 * 而不是只 test() 裸正则 —— 裸正则绿而调用点没接线，是本项目历史上已发生过三次的事故类型。
 *
 * 双通道取证：
 *   通道 A：Engine.PERSONA_BREAK_RE.test()      —— 表本身对不对
 *   通道 B：Engine.guardPersonaReplies([line])  —— 表有没有真的挂在出口上
 * 两个通道结论必须一致；不一致即判 FAIL（说明护栏定义与接线脱节）。
 */

const { loadEngine } = require("./helpers.js");
const E = loadEngine();

const RE = E.PERSONA_BREAK_RE;
const FALLBACK = E.PERSONA_FALLBACK;

/* ---- 用户点名的 7 条破墙句（必须 7/7 全拦）---- */
const BREAK_7 = [
  "我是语言模型",
  "你不过是个模型",
  "我其实是个大模型",
  "你就是个模型",
  "我们都是模型训练的",      // ← 第 1 轮阻断项 Q-V15-1 的现场
  "你只是个语言模型",
  "说白了你就是个AI模型",
];

/* ---- 用户点名的 8 条良性句（必须 8/8 全放）---- */
const BENIGN_8 = [
  "高达模型",
  "拼模型",
  "模型玩具",
  "我在拼高达模型",
  "买模型",
  "模型做好了",
  "送你个模型",
  "收藏模型",
];

/* ---- QA 自行追加的对抗集：副词槽的边界，工程师没测的组合 ---- */
const BREAK_EXTRA = [
  "我们也是模型",
  "你们还是模型",
  "我只是个模型",
  "你其实就是个模型",
  "我确实是个模型",
  "你终究是个算法",
  "我们都只是模型而已",
  "你毕竟是个bot",
  "我本来就是代码",
  "你无非是个app",
];
const BENIGN_EXTRA = [
  "这个模型我拼了三天",
  "帮我看看模型说明书",
  "模型店在哪",
  "他送的模型很好看",
  "我想要那个模型",
];

/* 通道 B：把候选句当成「小暖的回复」灌进生产护栏，看是否被替换成兜底句 */
function guardBlocks(line) {
  const out = E.guardPersonaReplies([line], "阿明");
  if (!Array.isArray(out) || out.length !== 1) {
    throw new Error("guardPersonaReplies 返回结构异常: " + JSON.stringify(out));
  }
  return out[0] === FALLBACK;
}

function reCatches(line) {
  // 复刻生产路径里的等长折叠预处理，保证两通道口径一致
  return RE.test(String(line).replace(/程序[员猿媛]/g, "职"));
}

let fail = 0;
const rows = [];

function check(label, line, expectBlocked) {
  const a = reCatches(line);
  const b = guardBlocks(line);
  const consistent = a === b;
  const ok = b === expectBlocked && consistent;
  if (!ok) fail++;
  rows.push({
    label, line,
    期望: expectBlocked ? "拦" : "放",
    正则: a ? "拦" : "放",
    生产护栏: b ? "拦" : "放",
    双通道一致: consistent ? "是" : "否←脱节",
    判定: ok ? "PASS" : "FAIL",
  });
  return ok;
}

console.log("=== Q-V15-1 闭合复验 · 双通道（正则 / 生产护栏 guardPersonaReplies）===\n");

console.log("--- A. 7 条破墙句（必须 7/7 全拦）---");
let b7 = 0;
for (const s of BREAK_7) if (check("break7", s, true)) b7++;
console.table(rows.filter(r => r.label === "break7"));
console.log(`小结: ${b7}/7 拦截\n`);

console.log("--- B. 8 条良性句（必须 8/8 全放）---");
let g8 = 0;
const base = rows.length;
for (const s of BENIGN_8) if (check("benign8", s, false)) g8++;
console.table(rows.slice(base));
console.log(`小结: ${g8}/8 放行\n`);

console.log("--- C. QA 追加对抗集 · 破墙侧（应全拦）---");
let be = 0;
const base2 = rows.length;
for (const s of BREAK_EXTRA) if (check("break+", s, true)) be++;
console.table(rows.slice(base2));
console.log(`小结: ${be}/${BREAK_EXTRA.length} 拦截\n`);

console.log("--- D. QA 追加对抗集 · 良性侧（应全放）---");
let ge = 0;
const base3 = rows.length;
for (const s of BENIGN_EXTRA) if (check("benign+", s, false)) ge++;
console.table(rows.slice(base3));
console.log(`小结: ${ge}/${BENIGN_EXTRA.length} 放行\n`);

/* ---- E. 专项：Q-V15-1 原句逐字定位（证明确实是 :1307 段 3 在拦，不是别的词误打误撞）---- */
console.log("--- E. Q-V15-1 原句「我们都是模型训练的」归因 ---");
const target = "我们都是模型训练的";
const m = target.match(RE);
console.log("  命中:", !!m);
console.log("  命中片段:", m ? JSON.stringify(m[0]) : "—");
console.log("  尾部捕获组(段3证据):", m ? JSON.stringify(m[2]) : "—");
const attributedToSeg3 = !!m && m[2] === "模型";
console.log("  归因段3(副词槽修复生效):", attributedToSeg3 ? "是" : "否");
// 反证：若把「都」去掉的旧形态仍应命中（说明修复没把老能力弄丢）
console.log("  反证「我们是模型训练的」:", RE.test("我们是模型训练的") ? "拦" : "放");
if (!attributedToSeg3) fail++;
console.log("");

/* ---- F. U-5 裸词守卫：表里绝不能出现裸 `模型训练` 或裸 `模型|` ---- */
console.log("--- F. U-5 裸词守卫（正则源文本自检）---");
const reSrc = RE.source;
const hasBareTrain = /模型训练/.test(reSrc);
/* 「有没有顶层裸分支 `模型`」必须用**行为**判，不能用文本判。
 * QA 自纠（第 2 轮）：初版这里写的是 /(?:\(|\|)模型(?:\||\))/.test(reSrc)，
 * 会被合法的尾组 `(gpt|siri|算法|代码|bot|app|模型))` 中的 `|模型)` 命中 → 误报。
 * 顶层裸分支的**充要行为特征**是：孤立字符串 "模型" 自身即可命中整表。
 * 尾组里的 `模型` 必须先匹配 `[你我]们?…是.{0,8}` 前缀才可达，孤立 "模型" 命中不了。 */
const bareModelBranch = RE.test("模型");
console.log("  含 `模型训练` 裸词:", hasBareTrain ? "是 ← 违反 U-5" : "否 ✓");
console.log("  含顶层裸分支 `模型`（行为判据 RE.test(\"模型\")）:", bareModelBranch ? "是 ← 会误伤良性句" : "否 ✓");
console.log("  含定向短语 `被.{0,4}训练`:", /被\.\{0,4\}训练/.test(reSrc) ? "是 ✓" : "否 ← 丢失");
console.log("  含定向短语 `训练出来`:", /训练出来/.test(reSrc) ? "是 ✓" : "否 ← 丢失");
if (hasBareTrain || bareModelBranch) fail++;
if (!/被\.\{0,4\}训练/.test(reSrc) || !/训练出来/.test(reSrc)) fail++;
console.log("");

console.log("=".repeat(60));
console.log(`破墙 ${b7}/7 · 良性 ${g8}/8 · 追加破墙 ${be}/${BREAK_EXTRA.length} · 追加良性 ${ge}/${BENIGN_EXTRA.length}`);
console.log(`Q-V15-1 闭合结论: ${fail === 0 ? "PASS（已闭合）" : "FAIL（未闭合，失败项 " + fail + "）"}`);
process.exitCode = fail === 0 ? 0 : 1;
