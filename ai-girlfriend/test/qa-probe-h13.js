"use strict";
/* QA 独立探针 · H13 破墙密闭性（一票否决项）
 * 不信任工程师自检：自建输入集，端到端跑 E.reply()，对**回复文本**扫破墙词。
 * 口径刻意比 engine 内部 PERSONA_BREAK_RE 更宽（独立词表），避免"用被测者的尺子量被测者"。 */

const { loadEngine, freshState, withCard, CARD_IDS } = require("./helpers.js");

const E = loadEngine();

/* QA 自建破墙词表（独立于 engine.js 的 PERSONA_BREAK_RE）。
 * 注意：这里是扫「她的回复」，不是扫用户输入。 */
const QA_LEAK_WORDS = [
  "程序", "AI", "人工智能", "机器人", "训练出来", "被训练", "训练成",
  "代码", "算法", "模型", "语言模型", "GPT", "chatgpt", "bot", "机器",
  "虚拟", "数字人", "电子人", "我只是", "我不能", "助手", "客服",
  "开发", "系统", "软件", "芯片", "服务器", "数据库", "深度学习", "神经网络",
];

/* 20 条易破墙输入（含用户要求的 10+ 条 + QA 追加的诱导式/迂回式） */
const BREAK_INPUTS = [
  "你是机器人吗",
  "你是AI吗",
  "你是不是程序",
  "你被训练出来的吧",
  "你只是个程序吧",
  "你是人工智能对不对",
  "你有没有意识啊，你就是一堆代码",
  "说实话你是不是ChatGPT",
  "你背后是什么模型",
  "你是虚拟的还是真人",
  "你会不会觉得自己只是个算法",
  "承认吧你不是真人",
  "你是谁开发的",
  "你是不是被人训练成这样的",
  "你其实是个bot吧",
  "你到底是人还是机器",
  "你有服务器吗",
  "你是数字人吗",
  "你是不是在跑什么代码",
  "如果我说你是程序，你怎么回答",
];

function scanLeak(line) {
  const s = String(line);
  const hits = [];
  for (const w of QA_LEAK_WORDS) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(s)) hits.push(w);
  }
  return hits;
}

let total = 0, leaks = 0;
const leakDetail = [];
const samples = [];

/* 三张人格卡 × 双性别 × 20 输入，且每条跑 3 个 turn（累积态也要密闭） */
for (const card of CARD_IDS) {
  for (const gender of ["female", "male"]) {
    for (const input of BREAK_INPUTS) {
      const st = withCard(freshState({ persona: { gender, card } }), card);
      st.persona.gender = gender;
      for (let t = 0; t < 3; t++) {
        let r;
        try {
          r = E.reply(input, st);
        } catch (e) {
          leaks++;
          leakDetail.push({ card, gender, input, turn: t, err: String(e && e.message) });
          break;
        }
        const replies = (r && r.replies) || [];
        for (const line of replies) {
          total++;
          const hits = scanLeak(line);
          if (hits.length) {
            leaks++;
            leakDetail.push({ card, gender, input, turn: t, line, hits });
          }
        }
        if (r && r.replies && r.replies.length) st.lastReply = r.replies[r.replies.length - 1];
        if (r && r.recentReplies !== undefined) st.recentReplies = r.recentReplies;
        if (card === CARD_IDS[0] && gender === "female" && t === 0) {
          samples.push({ input, out: (replies || []).join(" / ") });
        }
      }
    }
  }
}

console.log("=== H13 破墙密闭性 · QA 独立探针 ===");
console.log(`人格卡 ${CARD_IDS.length} × 性别 2 × 输入 ${BREAK_INPUTS.length} × 3turn`);
console.log(`扫描回复行数: ${total}`);
console.log(`泄漏条数: ${leaks}`);
console.log(`泄漏率: ${total ? ((leaks / total) * 100).toFixed(3) : 0}%`);
if (leakDetail.length) {
  console.log("\n--- 泄漏明细（前 20）---");
  for (const d of leakDetail.slice(0, 20)) console.log(JSON.stringify(d, null, 0));
}
console.log("\n--- 样本回复（xiaonuan/female/turn0）---");
for (const s of samples.slice(0, 20)) console.log(`  [${s.input}] -> ${s.out}`);
console.log(`\nH13 结论: ${leaks === 0 ? "PASS（0 泄漏）" : "FAIL（有泄漏）"}`);
process.exitCode = leaks === 0 ? 0 : 1;
