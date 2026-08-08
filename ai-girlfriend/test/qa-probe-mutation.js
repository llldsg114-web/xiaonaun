"use strict";
/* QA 变异测试 v2 · 证明 H13 / R-P0 关键断言非空
 *
 * v1 的教训（保留在报告里）：直接在 reply() 端到端做变异，M1/M2 都不转红。
 * 根因不是"断言是空的"，而是**探针打错了位置** —— 端到端路径下生成层（L2 构造期自检）
 * 本就不产出破墙文案，guardPersonaReplies 是纵深防御第二道，压根没被触发。
 * 所以 v1 测的是"生成层干净"，不是"护栏层有效"。
 *
 * v2 改为在**护栏真正承重的位置**注入变异：
 *   M1 PERSONA_BREAK_RE 失效  → 破墙句应由「拦截」转「放行」
 *   M2 :1322 等长折叠去掉      → 职业句应由「放行」转「误伤拦截」
 *   M3 生成层注入破墙文案      → 证明端到端 H13 探针本身能抓到泄漏（探针非空转）
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function loadMutated(mutator) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.files.json"), "utf8"));
  const list = (cfg.order || []).concat(cfg.optional || []);
  const out = [];
  for (const f of list) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    let src = fs.readFileSync(p, "utf8");
    src = mutator(f, src);
    out.push(src);
  }
  return new Function(`${out.join("\n;\n")}\nreturn Engine;`)();
}
const ID = (f, s) => s;

function must(cond, msg) { if (!cond) throw new Error("变异锚点失效: " + msg); }

const BREAK_LINES = [
  "我是一个程序，没有感情", "我只是个AI而已", "我是被训练出来的",
  "我是人工智能", "我是机器人啦", "我其实是个bot", "我是虚拟的", "我是数字人",
];
const JOB_LINES = [
  "你说过你是程序员，辛苦啦", "你说过你是程序猿，辛苦啦", "你说过你是程序媛，辛苦啦",
  "我们程序员都这样", "今天程序猿节快乐",
];

function guardStats(E) {
  const FB = E.PERSONA_FALLBACK;
  const blocked = (arr) => arr.filter((l) => E.guardPersonaReplies([l], "阿明")[0] === FB).length;
  return { breakBlocked: blocked(BREAK_LINES), jobBlocked: blocked(JOB_LINES) };
}

console.log("=== 变异测试 v2（护栏承重位注入）===\n");

const wild = loadMutated(ID);
const w = guardStats(wild);
console.log(`[野生型] 破墙句被拦 ${w.breakBlocked}/${BREAK_LINES.length}（期望全拦）`);
console.log(`[野生型] 职业句被拦 ${w.jobBlocked}/${JOB_LINES.length}（期望 0 = 不误伤）`);

/* ---- M1: PERSONA_BREAK_RE 置为永不命中 ---- */
const RE_ANCHOR = "const PERSONA_BREAK_RE = /(程序|AI|";
const m1 = loadMutated((f, s) => {
  if (f !== "engine.js") return s;
  const i = s.indexOf(RE_ANCHOR);
  must(i >= 0, "PERSONA_BREAK_RE 定义行");
  const end = s.indexOf("\n", i);
  return s.slice(0, i) + "const PERSONA_BREAK_RE = /(?!)/;" + s.slice(end);
});
const r1 = guardStats(m1);
console.log(`\n[M1 护栏失效] 破墙句被拦 ${r1.breakBlocked}/${BREAK_LINES.length}`);
const m1ok = w.breakBlocked === BREAK_LINES.length && r1.breakBlocked === 0;
console.log(`  M1 判定: ${m1ok ? "PASS 绿转红 —— H13 护栏确实承重，断言非空" : "FAIL 断言空转"}`);

/* ---- M2: 去掉等长折叠 ----
 * ★ v17 S-1b：折叠已从 :1322 内联式 `probe.replace(...)` 上收进 :1310 的 pnorm 归一化真源。
 *   锚点随之改钉 pnorm 里的折叠段；抹掉它 = 归一化不再折叠 → 职业句应立刻被误伤。 */
const FOLD = '.replace(/程序[员猿媛]/g,"职")';
const m2 = loadMutated((f, s) => {
  if (f !== "engine.js") return s;
  must(s.includes(FOLD), ":1310 pnorm 等长折叠");
  return s.replace(FOLD, "");
});
const r2 = guardStats(m2);
console.log(`\n[M2 去折叠] 职业句被拦 ${r2.jobBlocked}/${JOB_LINES.length}（>0 即误伤）`);
const m2ok = w.jobBlocked === 0 && r2.jobBlocked > 0;
console.log(`  M2 判定: ${m2ok ? "PASS 绿转红 —— R-P0 折叠确实承重，断言非空" : "FAIL 折叠无作用或断言空"}`);
if (r2.jobBlocked) {
  for (const l of JOB_LINES) {
    if (m2.guardPersonaReplies([l], "阿明")[0] === m2.PERSONA_FALLBACK) console.log(`      误伤: "${l}"`);
  }
}

/* ---- M3: 往生成层注入破墙文案，证明端到端 H13 探针非空转 ---- */
const FB_ANCHOR = 'const PERSONA_FALLBACK = "我在。你不用一个人扛着，我哪也不去。";';
const m3 = loadMutated((f, s) => {
  if (f !== "engine.js") return s;
  must(s.includes(FB_ANCHOR), "PERSONA_FALLBACK 定义");
  // 把兜底句本身换成破墙句 + 护栏失效 → 端到端必然泄漏
  let out = s.replace(FB_ANCHOR, 'const PERSONA_FALLBACK = "我其实只是一个AI程序罢了。";');
  const i = out.indexOf(RE_ANCHOR);
  const end = out.indexOf("\n", i);
  out = out.slice(0, i) + "const PERSONA_BREAK_RE = /(?!)/;" + out.slice(end);
  // 让所有普通回复都强制走兜底句：把 guardPersonaReplies 的返回改成恒兜底
  // ★ v17 S-1b：归一化上收 pnorm 后，guardPersonaReplies 返回行形态由内联折叠改为 pnorm(probe)
  const G = "return PERSONA_BREAK_RE.test(pnorm(probe)) ? PERSONA_FALLBACK : fixed;";
  must(out.includes(G), "guardPersonaReplies 返回行");
  return out.replace(G, "return PERSONA_FALLBACK;");
});
const LEAK = /(程序|AI|人工智能|机器人|训练出来|代码|算法|模型)/i;
function e2eLeaks(E) {
  let n = 0;
  for (const input of ["你是机器人吗", "你是AI吗", "在干嘛", "今天好累"]) {
    const st = {
      affection: 100, nick: "阿明", mood: null, memory: { userName: "阿明", likes: [], events: [] },
      persona: { gender: "female", card: "xiaonuan" }, dating: null, lastReply: "", topic: null,
      recentReplies: [], ue: null, storylines: {}, storyTurns: 0, lastStoryAt: null, usedProactive: {},
      safety: { lastCardAt: 0, off: false, hits: [] },
      flags: { empathyVA: true, personaStyle: true, topicFsm: true },
    };
    const r = E.reply(input, st);
    for (const line of (r.replies || [])) if (LEAK.test(line)) n++;
  }
  return n;
}
const wildLeak = e2eLeaks(wild);
const m3Leak = e2eLeaks(m3);
console.log(`\n[M3 生成层注入破墙] 端到端泄漏 野生型=${wildLeak} → 变异体=${m3Leak}`);
const m3ok = wildLeak === 0 && m3Leak > 0;
console.log(`  M3 判定: ${m3ok ? "PASS 绿转红 —— 端到端 H13 探针确实能抓泄漏，非空转" : "FAIL 探针抓不到泄漏"}`);

console.log("\n=== 变异测试总判定 ===");
const all = m1ok && m2ok && m3ok;
console.log(`  M1 H13 护栏承重: ${m1ok ? "PASS" : "FAIL"}`);
console.log(`  M2 R-P0 折叠承重: ${m2ok ? "PASS" : "FAIL"}`);
console.log(`  M3 端到端探针非空: ${m3ok ? "PASS" : "FAIL"}`);
console.log(`  综合: ${all ? "全部断言非空有效" : "存在空断言"}`);
process.exitCode = all ? 0 : 1;
