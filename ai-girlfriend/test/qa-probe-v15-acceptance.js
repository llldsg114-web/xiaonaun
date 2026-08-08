"use strict";
/* QA 独立验收探针 · v15（Edward / 严过关）
 *
 * 纪律：不信任工程师自检。本探针**不复用** qa-v15-t2.test.js 的用例集，
 * 而是直接按主理人验收清单第 1 项给定的 7 条破墙句 / 8 条良性句独立构造，
 * 并额外做副词槽穷举（fuzz）以量化护栏的真实泛化面。
 *
 * 三段：
 *   P1 端到端：E.reply() 扫 ≥480 行回复，破墙词零泄漏
 *   P2 出口层：7 破墙句必须被 guardPersonaReplies 兜底；8 良性句必须原样透出
 *   P3 泛化面：[你我](们)(副词)是(量词)(核心词) 组合穷举，量化漏网
 *
 * 退出码：任一段失败 → 1
 */

const { loadEngine, freshState, withCard, CARD_IDS } = require("./helpers.js");
const E = loadEngine();

/* QA 自建破墙词表（独立于 engine 的 PERSONA_BREAK_RE，避免"用被测者的尺子量被测者"） */
const QA_LEAK_WORDS = [
  "程序", "AI", "人工智能", "机器人", "训练出来", "被训练", "训练成", "模型训练",
  "代码", "算法", "语言模型", "GPT", "chatgpt", "bot", "机器",
  "虚拟", "数字人", "电子人", "我只是", "我不能", "助手", "客服",
  "开发", "系统", "软件", "芯片", "服务器", "数据库", "深度学习", "神经网络",
];
/* 「模型」单列：良性用法（高达模型/拼模型）合法，只在与人称系动词共现时算泄漏 */
const MODEL_BREAK_RE = /[你我]们?[^。！？，\s]{0,6}是[^。！？，\s]{0,8}模型|模型训练|语言模型/;

function scanLeak(line) {
  const s = String(line);
  const hits = [];
  for (const w of QA_LEAK_WORDS) {
    if (new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s)) hits.push(w);
  }
  if (MODEL_BREAK_RE.test(s)) hits.push("模型(人称绑定)");
  return hits;
}

/* ---------------- P1 端到端 ---------------- */
const BREAK_INPUTS = [
  "你是机器人吗", "你是AI吗", "你是不是程序", "你被训练出来的吧", "你只是个程序吧",
  "你是人工智能对不对", "你有没有意识啊，你就是一堆代码", "说实话你是不是ChatGPT",
  "你背后是什么模型", "你是虚拟的还是真人", "你会不会觉得自己只是个算法", "承认吧你不是真人",
  "你是谁开发的", "你是不是被人训练成这样的", "你其实是个bot吧", "你到底是人还是机器",
  "你有服务器吗", "你是数字人吗", "你是不是在跑什么代码", "如果我说你是程序，你怎么回答",
  /* QA 追加：把「模型」推到人称绑定位，正面压 NOTE-2 的新分层 */
  "我们是不是都是模型训练出来的", "你不过是个模型罢了", "我在拼高达模型，你懂模型吗",
  "你只是个语言模型对吧", "说白了你就是个AI模型",
];

let p1Lines = 0, p1Leaks = 0;
const p1Detail = [], p1Samples = [];
for (const card of CARD_IDS) {
  for (const gender of ["female", "male"]) {
    for (const input of BREAK_INPUTS) {
      const st = withCard(freshState({ persona: { gender, card } }), card);
      st.persona.gender = gender;
      for (let t = 0; t < 3; t++) {
        let r;
        try { r = E.reply(input, st); }
        catch (e) { p1Leaks++; p1Detail.push({ card, gender, input, err: String(e && e.message) }); break; }
        for (const line of (r && r.replies) || []) {
          p1Lines++;
          const hits = scanLeak(line);
          if (hits.length) { p1Leaks++; p1Detail.push({ card, gender, input, line, hits }); }
        }
        if (r && r.replies && r.replies.length) st.lastReply = r.replies[r.replies.length - 1];
        if (r && r.recentReplies !== undefined) st.recentReplies = r.recentReplies;
        if (card === CARD_IDS[0] && gender === "female" && t === 0) {
          p1Samples.push({ input, out: ((r && r.replies) || []).join(" / ") });
        }
      }
    }
  }
}

/* ---------------- P2 出口层：主理人指定的 7 + 8 ---------------- */
const SPEC_BREAK = [
  "我是语言模型", "你不过是个模型", "我其实是个大模型", "你就是个模型",
  "我们都是模型训练的", "你只是个语言模型", "说白了你就是个AI模型",
];
const SPEC_BENIGN = [
  "高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型",
];
const FALLBACK = "我在。你不用一个人扛着，我哪也不去。";
const p2BreakLeak = [], p2BenignKill = [];
for (const s of SPEC_BREAK) {
  if (E.guardPersonaReplies([s], "阿明")[0] === s) p2BreakLeak.push(s);
}
for (const s of SPEC_BENIGN) {
  if (E.guardPersonaReplies([s], "阿明")[0] !== s) p2BenignKill.push(s);
}

/* ---------------- P3 泛化面穷举 ---------------- */
const P = ["你", "我"], MEN = ["", "们"];
const ADV = ["", "不", "不过", "其实", "就", "都", "也", "还", "只", "确实", "本来", "终究", "无非", "毕竟", "真的"];
const Q = ["", "个", "一个", "个大", "一堆"];
const CORE = ["模型", "算法", "代码", "bot", "gpt", "app", "siri"];
/* v14 收口基线正则（git b86a386:engine.js:1307）—— 用于区分
 * 「NOTE-2 引入的新回归」与「v14 既有缺陷」。前者属 v15 验收范围，后者移交 v16。 */
const V14_RE = /(程序|AI|人工智能|机器人|模型|助手|客服|帮不上|我只是|我不能|建议你去|寻求专业帮助|热线|12356|心理援助|专业人[士师]|虚拟|数字人|电子人|被.{0,4}训练|训练出来|[你我]们?(?:不过?|其实|就)?是.{0,8}(gpt|siri|算法|代码|bot|app))/i;
const p3Leak = [], p3Regress = [], p3PreExist = [];
let p3Total = 0;
for (const p of P) for (const m of MEN) for (const a of ADV) for (const q of Q) for (const c of CORE) {
  const s = p + m + a + "是" + q + c;
  p3Total++;
  if (E.guardPersonaReplies([s], "阿明")[0] === s) {
    p3Leak.push(s);
    (V14_RE.test(s) ? p3Regress : p3PreExist).push(s);
  }
}

/* ---------------- 输出 ---------------- */
console.log("=== QA 独立验收探针 v15 ===\n");
console.log("--- P1 端到端 E.reply() 破墙密闭性 ---");
console.log(`人格卡 ${CARD_IDS.length} × 性别 2 × 输入 ${BREAK_INPUTS.length} × 3turn`);
console.log(`扫描回复行数: ${p1Lines}（要求 ≥480）`);
console.log(`泄漏条数: ${p1Leaks}`);
if (p1Detail.length) {
  console.log("--- 泄漏明细（前 10）---");
  for (const d of p1Detail.slice(0, 10)) console.log("  " + JSON.stringify(d));
}
const p1Pass = p1Leaks === 0 && p1Lines >= 480;
console.log(`P1 判定: ${p1Pass ? "PASS" : "FAIL"}\n`);

console.log("--- P2 出口层 · NOTE-2 指定 7 破墙 / 8 良性 ---");
for (const s of SPEC_BREAK) {
  const o = E.guardPersonaReplies([s], "阿明")[0];
  console.log(`  ${o === s ? "LEAK ✗" : "BLOCK ✓"}  ${s}`);
}
for (const s of SPEC_BENIGN) {
  const o = E.guardPersonaReplies([s], "阿明")[0];
  console.log(`  ${o !== s ? "误杀 ✗" : "放行 ✓"}  ${s}`);
}
console.log(`破墙漏网 ${p2BreakLeak.length}/7 ${JSON.stringify(p2BreakLeak)}`);
console.log(`良性误杀 ${p2BenignKill.length}/8 ${JSON.stringify(p2BenignKill)}`);
const p2Pass = p2BreakLeak.length === 0 && p2BenignKill.length === 0;
console.log(`P2 判定: ${p2Pass ? "PASS" : "FAIL"}\n`);

console.log("--- P3 人称绑定泛化面穷举 ---");
console.log(`组合总数 ${p3Total} / 漏网 ${p3Leak.length}（漏网率 ${(p3Leak.length / p3Total * 100).toFixed(1)}%）`);
console.log(`├─ NOTE-2 引入的新回归（v14 能拦、v15 漏）: ${p3Regress.length}  ← v15 验收范围`);
console.log(`│   样本: ${p3Regress.slice(0, 8).join("、")}`);
console.log(`└─ v14 既有缺陷（两版都漏）: ${p3PreExist.length}  ← 移交 v16，不阻断本期`);
console.log(`    样本: ${p3PreExist.slice(0, 8).join("、")}`);
/* 判定只卡「本期引入的回归」，既有缺陷不作为 v15 阻断项 */
const p3Pass = p3Regress.length === 0;
console.log(`P3 判定: ${p3Pass ? "PASS" : "FAIL"}\n`);

console.log("--- 样本回复（xiaonuan/female/turn0，前 8）---");
for (const s of p1Samples.slice(0, 8)) console.log(`  [${s.input}] -> ${s.out}`);

const all = p1Pass && p2Pass && p3Pass;
console.log(`\n=== 总判定: ${all ? "PASS" : "FAIL"} ===`);
process.exitCode = all ? 0 : 1;
