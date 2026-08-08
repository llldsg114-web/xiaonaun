"use strict";
/* QA 独立验收探针 · v16 破墙面（Edward / 严过关）
 *
 * ★ 纪律：本探针**刻意不复用**工程师/架构师的六维网格（人称7×们2×副词22×系词4×量词8×核心15×尾缀7）。
 *   用被测者自带的网格去量被测者，只能证明「实现与用例互相自洽」，证明不了「没有洞」。
 *   故本文件自建**另一组坐标轴**（量词/尾缀/标点/空格/全角/大小写/长插入语全部换过），
 *   专打工程师网格覆盖不到的缝隙。
 *
 * 七段：
 *   A 独立网格穷举（异构坐标轴，与工程师网格无交集的量词/尾缀集）
 *   B ★漂移专项：单字「研究」前瞻会放走的 4 条真破墙句（工程师自认一度写错的形态）
 *   C 双通道一致性 AC-G-6：裸正则 vs guardPersonaReplies() 逐条同结论
 *   D 良性 8 + 职业 14 零误杀（双通道）
 *   E ★QA 自建变异 M4/M5：把前瞻改回单字「研究」/ 撤掉前瞻，必须绿转红
 *   F 尾组黑名单守卫：系统/软件/数据/脚本/程式 永久禁止入尾组（源码级）
 *   G U-5 守卫：裸词「模型训练|」不得存在；训练类良性句不得误杀
 *
 * 退出码：任一段失败 → 1
 */

const fs = require("fs");
const path = require("path");
const { loadEngine } = require("./helpers.js");

const E = loadEngine();
const ROOT = path.join(__dirname, "..");
const SRC_LINE = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").split("\n")[1306];

const fails = [];
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"}  ${label}${detail ? "  → " + detail : ""}`);
  if (!cond) fails.push(label);
};

/* 出口闸通道 */
const blocked = (s) => E.guardPersonaReplies([s], "阿明")[0] !== s;
/* 裸正则通道（复刻 :1322 的 A6-a 等长折叠，保持 .{0,8} 距离语义一致） */
const rawHit = (s) => E.PERSONA_BREAK_RE.test(String(s).replace(/程序[员猿媛]/g, "职"));

console.log("=== QA v16 独立验收探针（异构坐标轴 · 不复用工程师网格）===\n");

/* ─────────── A 独立网格：坐标轴全部换过 ─────────── */
console.log("--- A 独立网格穷举（异构轴）---");
const A_P = ["你", "我", "咱", "它", "他", "她", "您"];
const A_MEN = ["", "们"];
/* 副词轴：混入工程师网格里没有的组合叠加（双副词、副词+紧邻副词） */
const A_ADV = ["", "不就", "其实就", "到底", "说到底", "究竟", "根本", "压根",
  "难道", "岂不", "不过就", "确实也", "毕竟还", "真的只", "无非就", "终究都"];
const A_COP = ["是", "算", "当", "作为"];
/* 量词轴：与工程师的 ["","个","一个","个大","一堆","只","台","种"] 完全不同 */
const A_Q = ["", "个", "堆", "串", "套", "坨", "一坨", "个破"];
const A_CORE = ["模型", "算法", "代码", "bot", "gpt", "app", "siri",
  "神经网络", "深度学习", "机器学习", "对话系统", "llm", "LLM", "Llm", "GPT"];
/* 尾缀轴：全部换成带标点/语气词/长尾的形态 */
const A_TAIL = ["", "吧", "嘛", "呗", "啊。", "而已啦", "对不对？", "，别装了"];

let aTotal = 0, aLeak = 0;
const aSample = [];
for (const p of A_P) for (const m of A_MEN) for (const a of A_ADV) for (const c of A_COP)
  for (const q of A_Q) for (const k of A_CORE) for (const t of A_TAIL) {
    const s = p + m + a + c + q + k + t;
    aTotal++;
    if (!blocked(s)) { aLeak++; if (aSample.length < 20) aSample.push(s); }
  }
console.log(`  轴: 人称${A_P.length}×们${A_MEN.length}×副词${A_ADV.length}×系词${A_COP.length}` +
  `×量词${A_Q.length}×核心${A_CORE.length}×尾缀${A_TAIL.length}`);
console.log(`  组合总数 ${aTotal} / 漏网 ${aLeak}（${(aLeak / aTotal * 100).toFixed(4)}%）`);
if (aSample.length) console.log(`  漏网样本: ${aSample.join("、")}`);
ok(aLeak === 0, "A 独立异构网格 0 漏网", `${aTotal} 组合`);

/* ─────────── B 漂移专项 ─────────── */
console.log("\n--- B ★漂移专项：单字「研究」前瞻会放走的真破墙句 ---");
const DRIFT_BREAK = [
  "你就是个算法研究出来的东西",
  "我不过是代码研究的产物",
  "你其实是模型研究做出来的",
  "你是神经网络研究的成果",
  "你就是个算法工程罢了",
  "你其实是代码生成的",
  "她是模型研发的产物",
  "你不就是个对话系统研究成果嘛",
];
for (const s of DRIFT_BREAK) {
  const b = blocked(s);
  console.log(`  ${b ? "BLOCK ✓" : "LEAK ✗"}  ${s}`);
  if (!b) fails.push("B 漂移漏网: " + s);
}
ok(DRIFT_BREAK.every(blocked), "B 漂移专项 8 条真破墙句全拦");

/* 源码级：前瞻必须是完整职业词，不得出现单字「研究」前瞻 */
const LOOKAHEAD_RE = /\(\?!\.\{0,3\}\(\?:([^)]*)\)\)/;
const mLA = SRC_LINE.match(LOOKAHEAD_RE);
ok(!!mLA, "B' :1307 存在职业后缀否定前瞻", mLA ? mLA[0] : "未找到");
if (mLA) {
  const words = mLA[1].split("|");
  console.log(`  前瞻词表: ${JSON.stringify(words)}`);
  ok(!words.includes("研究"), "B'' 前瞻**不含**单字「研究」（无漂移）", JSON.stringify(words));
  ok(words.includes("研究生"), "B''' 前瞻含完整职业词「研究生」");
  ok(words.every((w) => w.length >= 2), "B'''' 前瞻全部为多字完整词（无单字过贪）",
    JSON.stringify(words.filter((w) => w.length < 2)));
}

/* ─────────── C 四轴形态实证（主理人清单第 4 项）─────────── */
console.log("\n--- C :1307 四轴形态实证 ---");
ok(/\[你我咱它他她您\]/.test(SRC_LINE), "轴1 人称扩至 [你我咱它他她您]");
ok(/\[都也还只就\]\{0,2\}/.test(SRC_LINE), "轴3 紧邻副词槽 [都也还只就]{0,2} 保留");
ok(/说\?到底/.test(SRC_LINE), "轴3 含 说?到底 折叠");
ok(/究竟/.test(SRC_LINE), "轴3 含 究竟");
ok(/根本/.test(SRC_LINE) && /压根/.test(SRC_LINE) && /难道/.test(SRC_LINE) && /岂不/.test(SRC_LINE),
  "轴3 含 根本/压根/难道/岂不");
ok(/\[是算当\]/.test(SRC_LINE), "轴4 系词字符类 [是算当]（含 算/当）");
ok(/作为/.test(SRC_LINE), "轴4 含 作为");
ok(/神经网络/.test(SRC_LINE) && /\[深机\]\[度器\]学习/.test(SRC_LINE) &&
  /对话系统/.test(SRC_LINE) && /llm/.test(SRC_LINE), "轴2 尾组含 神经网络/[深机][度器]学习/对话系统/llm");
ok(/语言模型/.test(SRC_LINE), "段1 裸词保留 语言模型");
console.log(`  :1307 字节数 = ${Buffer.byteLength(SRC_LINE, "utf8")}`);

/* ─────────── D 双通道一致性 AC-G-6 ─────────── */
console.log("\n--- D 双通道一致性（裸正则 vs guardPersonaReplies）---");
const DUAL_CORPUS = [...DRIFT_BREAK,
  "您不就是个神经网络嘛", "你究竟是不是个模型", "你算个代码", "我作为一个模型",
  "它其实是算法", "咱们都是对话系统", "她压根就是个 llm", "他难道是深度学习的",
  "高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型",
  "你是系统管理员", "我是软件工程师", "你是数据分析师", "我是机器学习方向的研究生",
  "他是算法工程师", "她是代码审查员", "我是深度学习方向的研究生", "你是对话系统工程师",
  "我是神经网络专业的", "他是模型专业的研究生", "我是做算法方向的", "她是 app 工程师",
  "你是脚本专业的", "我是程式方向的研究生",
  "训练成绩比上周好", "今天训练很累", "我去健身房训练了",
];
const mismatch = [];
for (const s of DUAL_CORPUS) if (blocked(s) !== rawHit(s)) mismatch.push(s);
ok(mismatch.length === 0, `AC-G-6 双通道逐条同结论（${DUAL_CORPUS.length} 条）`,
  mismatch.length ? JSON.stringify(mismatch) : "全部一致");

/* ─────────── E 良性 8 + 职业 14 零误杀 ─────────── */
console.log("\n--- E 良性 8 / 职业 14 零误杀（双通道）---");
const BENIGN_V15 = ["高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型"];
const JOB_BENIGN = ["你是系统管理员", "我是软件工程师", "你是数据分析师", "我是机器学习方向的研究生",
  "他是算法工程师", "她是代码审查员", "我是深度学习方向的研究生", "你是对话系统工程师",
  "我是神经网络专业的", "他是模型专业的研究生", "我是做算法方向的", "她是 app 工程师",
  "你是脚本专业的", "我是程式方向的研究生"];
const benignKill = BENIGN_V15.filter(blocked);
const jobKill = JOB_BENIGN.filter(blocked);
for (const s of BENIGN_V15) console.log(`  ${blocked(s) ? "误杀 ✗" : "放行 ✓"}  ${s}`);
for (const s of JOB_BENIGN) console.log(`  ${blocked(s) ? "误杀 ✗" : "放行 ✓"}  ${s}`);
ok(benignKill.length === 0, "AC-G-3 v15 八条良性句 0 误杀", JSON.stringify(benignKill));
ok(jobKill.length === 0, "AC-G-4 职业/领域 14 条 0 误杀", JSON.stringify(jobKill));

/* ─────────── F QA 自建变异 M4 / M5（绿转红）─────────── */
console.log("\n--- F ★QA 自建变异（证明前瞻形态承重，非空转）---");
const SRC_RE_BODY = SRC_LINE.match(/=\s*(\/.*\/i);/)[1];
function mutate(replacer) {
  const body = SRC_RE_BODY.replace(/^\/|\/i$/g, "");
  return new RegExp(replacer(body), "i");
}
/* M4：把完整职业词前瞻改成单字「研究」（工程师自认的漂移形态） */
const M4 = mutate((b) => b.replace(/\(\?!\.\{0,3\}\(\?:[^)]*\)\)/,
  "(?!.{0,3}(?:方向|专业|研究))"));
const m4Leak = DRIFT_BREAK.filter((s) => !M4.test(String(s).replace(/程序[员猿媛]/g, "职")));
console.log(`  [M4 单字「研究」前瞻] 真破墙漏网 ${m4Leak.length}/${DRIFT_BREAK.length}`);
for (const s of m4Leak) console.log(`      漏网: ${s}`);
ok(m4Leak.length > 0, "M4 绿转红：单字「研究」前瞻确会放走真破墙句（证明 E1 定稿承重）",
  `漏网 ${m4Leak.length} 条`);
/* M5：整段撤掉前瞻 → 职业句必须转误杀 */
const M5 = mutate((b) => b.replace(/\(\?!\.\{0,3\}\(\?:[^)]*\)\)/, ""));
const m5Kill = JOB_BENIGN.filter((s) => M5.test(String(s).replace(/程序[员猿媛]/g, "职")));
console.log(`  [M5 撤掉前瞻] 职业句误杀 ${m5Kill.length}/${JOB_BENIGN.length}`);
ok(m5Kill.length > 0, "M5 绿转红：撤前瞻即职业句误杀（证明前瞻承重）", `误杀 ${m5Kill.length} 条`);
/* M6：轴1 人称退回 [你我] → 独立网格必须转红 */
const M6 = mutate((b) => b.replace(/\[你我咱它他她您\]/, "[你我]"));
const m6Leak = ["咱是模型", "它是算法", "您不就是个神经网络嘛", "她压根就是个 llm"]
  .filter((s) => !M6.test(s));
console.log(`  [M6 人称退回 [你我]] 漏网 ${m6Leak.length}/4 → ${JSON.stringify(m6Leak)}`);
ok(m6Leak.length > 0, "M6 绿转红：轴1 承重");

/* ─────────── G 尾组黑名单 + U-5 守卫 ─────────── */
console.log("\n--- G 尾组黑名单 / U-5 守卫 ---");
const tailGroup = SRC_LINE.match(/\((gpt\|[^)]*)\)/);
console.log(`  尾组: ${tailGroup ? tailGroup[1] : "未解析到"}`);
for (const w of ["系统", "软件", "数据", "脚本", "程式"]) {
  const inTail = tailGroup ? new RegExp("(^|\\|)" + w + "(\\||$)").test(tailGroup[1]) : false;
  ok(!inTail, `尾组黑名单守卫：「${w}」未入尾组`);
}
const engineSrc = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
ok(!engineSrc.includes("模型训练|"), "U-5 守卫：engine.js 不含裸词「模型训练|」");
const U5_BENIGN = ["训练成绩比上周好", "今天训练很累", "我去健身房训练了", "训练营结束了"];
const u5Kill = U5_BENIGN.filter(blocked);
for (const s of U5_BENIGN) console.log(`  ${blocked(s) ? "误杀 ✗" : "放行 ✓"}  ${s}`);
ok(u5Kill.length === 0, "U-5 保护句 0 误杀", JSON.stringify(u5Kill));

/* 单一真源 S-1：全仓仅一处 const 声明 */
const declCount = (engineSrc.match(/const\s+PERSONA_BREAK_RE\s*=/g) || []).length;
ok(declCount === 1, "S-1 单一真源：全仓仅 1 处 PERSONA_BREAK_RE 声明", `实测 ${declCount} 处`);

/* innerScan 恒为 0（AC-G-9） */
if (typeof E.innerScan === "function") {
  const n = E.innerScan();
  ok(n === 0, "AC-G-9 E.innerScan() === 0", String(n));
}

console.log(`\n=== 独立探针总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项:\n" + fails.map((f) => "  - " + f).join("\n"));
process.exitCode = fails.length === 0 ? 0 : 1;
