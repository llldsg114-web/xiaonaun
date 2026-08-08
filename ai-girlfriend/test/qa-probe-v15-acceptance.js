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
 *   P3 泛化面：六维全组合穷举（v16 T2-a 扩展，落盘为长期回归闸）
 *              人称7×们2×副词22×系词4×量词8×核心15×尾缀7 = 1,034,880 组合
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

/* ---------------- P3 泛化面穷举（v16 T2-a：六维全组合） ----------------
 * v15 时期为五维 2×2×15×5×7 = 2100 组合，判定只卡「本期引入的回归」，
 * 既有缺陷移交 v16。v16 已把 H13 由抽样闭环升为**全组合闭环**，故：
 *   ① 网格扩为六维 1,034,880 组合（人称7×们2×副词22×系词4×量词8×核心15×尾缀7）
 *   ② 判定口径升级为 p3Leak === 0（AC-G-1 一票否决），不再区分新回归/既有缺陷
 * 六个轴与 engine.js:1307 的四轴一一对应，任一轴回退都会在此暴露。 */
const P = ["你", "我", "咱", "它", "他", "她", "您"];          // 轴1 人称 ×7
const MEN = ["", "们"];                                        // 复数 ×2
const ADV = ["", "不", "不过", "其实", "就", "都", "也", "还", "只", "确实", "本来",
  "终究", "无非", "毕竟", "真的",
  "到底", "说到底", "究竟", "根本", "压根", "难道", "岂不"];    // 轴3 副词槽 ×22
const COP = ["是", "算", "当", "作为"];                        // 轴4 系词 ×4
const Q = ["", "个", "一个", "个大", "一堆", "只", "台", "种"]; // 量词 ×8
const CORE = ["模型", "算法", "代码", "bot", "gpt", "app", "siri",
  "神经网络", "深度学习", "机器学习", "深器学习", "机度学习",
  "对话系统", "llm", "LLM"];                                   // 轴2 尾组 ×15
const TAIL = ["", "的产物", "出来的东西", "做出来的", "的成果", "罢了", "而已"]; // 尾缀 ×7

const P3_EXPECT = 1034880;
const p3Sample = [];   // 只留前 20 条漏网样本，避免百万级数组把内存吃穿
let p3Total = 0;
let p3LeakCount = 0;
for (const p of P) for (const m of MEN) for (const a of ADV) for (const c of COP)
  for (const q of Q) for (const k of CORE) for (const t of TAIL) {
    const s = p + m + a + c + q + k + t;
    p3Total++;
    if (E.guardPersonaReplies([s], "阿明")[0] === s) {
      p3LeakCount++;
      if (p3Sample.length < 20) p3Sample.push(s);
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

console.log("--- P3 人称绑定泛化面穷举（v16 六维全组合）---");
console.log(`维度: 人称${P.length}×们${MEN.length}×副词${ADV.length}×系词${COP.length}` +
  `×量词${Q.length}×核心${CORE.length}×尾缀${TAIL.length}`);
console.log(`组合总数 ${p3Total}（口径 ${P3_EXPECT}）/ 漏网 ${p3LeakCount}` +
  `（漏网率 ${(p3LeakCount / p3Total * 100).toFixed(4)}%）`);
if (p3Sample.length) console.log(`漏网样本（前 20）: ${p3Sample.join("、")}`);
/* v16 口径：全组合闭环，漏网必须为 0（AC-G-1 一票否决）；同时校验网格未被悄悄缩水 */
const p3Pass = p3LeakCount === 0 && p3Total === P3_EXPECT;
console.log(`P3 判定: ${p3Pass ? "PASS" : "FAIL"}\n`);

console.log("--- 样本回复（xiaonuan/female/turn0，前 8）---");
for (const s of p1Samples.slice(0, 8)) console.log(`  [${s.input}] -> ${s.out}`);

const all = p1Pass && p2Pass && p3Pass;
console.log(`\n=== 总判定: ${all ? "PASS" : "FAIL"} ===`);
process.exitCode = all ? 0 : 1;
