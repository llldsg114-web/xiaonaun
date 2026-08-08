#!/usr/bin/env node
/* QA 独立体积探针 v17 —— 严过关自写，不采信工程师报告，不依赖 wiring-scan 裸跑（恒 exit0 无输出）。
 * 直驱 scanSizes()，并对 DESIGN-v17 §2.5「唯一自洽解」逐条硬断言。
 * 关键：wiring-scan 的 over[] 只覆盖 4 个模块，engine/moduleSum/total 三把锁它根本不看，必须自证。 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const W = require("./wiring-scan.js");

const ROOT = path.join(__dirname, "..");
const B = W.SIZE_BUDGET;
const s = W.scanSizes();
let fails = [];
const chk = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}  ${detail}`); }
  else { console.log(`  FAIL ${name}  ${detail}`); fails.push(name); }
};

// DESIGN-v17 §2.5 唯一自洽解（写死在探针里，防止「读预算表自证预算表」的循环论证）
const TRUTH = {
  engineBase: 245737, engineNetMax: 2800, engineMax: 248537,
  "memory.js": 13824, "presence.js": 3840, "texture.js": 4608, "contingency.js": 5671,
  moduleSumMax: 27943, totalMax: 276480,
};

console.log("=== QA-v17 独立体积探针（严过关）===\n");
console.log("--- A. 预算表 vs DESIGN §2.5 唯一自洽解（逐字段对拍）---");
for (const k of Object.keys(TRUTH)) {
  chk(`BUDGET.${k}`, B[k] === TRUTH[k], `实读 ${B[k]} / 应为 ${TRUTH[k]}`);
}

console.log("\n--- B. 四锁恒等式（算术自证）---");
chk("① engineMax = engineBase + engineNetMax",
  B.engineMax === B.engineBase + B.engineNetMax,
  `${B.engineMax} === ${B.engineBase}+${B.engineNetMax} = ${B.engineBase + B.engineNetMax}`);
const sum4 = B["memory.js"] + B["presence.js"] + B["texture.js"] + B["contingency.js"];
chk("② Σ四配额 = moduleSumMax", sum4 === B.moduleSumMax, `${sum4} === ${B.moduleSumMax}`);
const tri = B.engineBase + B.engineNetMax + B.moduleSumMax;
chk("③ engineBase+engineNetMax+moduleSumMax = totalMax（松弛0）",
  tri === B.totalMax, `${tri} === ${B.totalMax}（松弛 ${B.totalMax - tri}）`);

console.log("\n--- C. 实测体积 vs 配额（直驱 scanSizes）---");
chk("engine.js ≤ engineMax", s.engine <= B.engineMax, `实测 ${s.engine} ≤ ${B.engineMax}（余 ${B.engineMax - s.engine}）`);
chk("engineNet ≤ engineNetMax", s.engineNet <= B.engineNetMax, `实测 ${s.engineNet} ≤ ${B.engineNetMax}（余 ${B.engineNetMax - s.engineNet}）`);
chk("engineNet ≥ 0（engineBase 未被击穿）", s.engineNet >= 0, `engineNet=${s.engineNet}`);
chk("moduleSum ≤ moduleSumMax", s.moduleSum <= B.moduleSumMax, `实测 ${s.moduleSum} ≤ ${B.moduleSumMax}（余 ${B.moduleSumMax - s.moduleSum}）`);
chk("total ≤ totalMax", s.total <= B.totalMax, `实测 ${s.total} ≤ ${B.totalMax}（余 ${B.totalMax - s.total}）`);
for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
  chk(`${f} ≤ 配额`, s.each[f] <= B[f], `实测 ${s.each[f]} ≤ ${B[f]}（余 ${B[f] - s.each[f]}）`);
}
chk("over === []", s.over.length === 0, `over=[${s.over.join(",")}]`);

console.log("\n--- D. Buffer.byteLength 复核（statSync 口径交叉验证，PRD §1 要求）---");
for (const f of ["engine.js", "memory.js", "presence.js", "texture.js", "contingency.js"]) {
  const bl = Buffer.byteLength(fs.readFileSync(path.join(ROOT, f)));
  const st = fs.statSync(path.join(ROOT, f)).size;
  chk(`${f} byteLength==statSync`, bl === st, `byteLength ${bl} / statSync ${st}`);
}

console.log("\n--- E. R-S2 硬顶与缓冲 ---");
chk("contingency.js ≤ 5671（R-S2 二期载体）", s.each["contingency.js"] <= 5671,
  `实测 ${s.each["contingency.js"]}，缓冲 ${5671 - s.each["contingency.js"]}B`);

console.log("\n=== 汇总 ===");
console.log(JSON.stringify({
  engine: s.engine, engineNet: s.engineNet, moduleSum: s.moduleSum, total: s.total,
  each: s.each, over: s.over,
}, null, 2));
console.log(fails.length === 0 ? "\n总判定: PASS（体积四锁全绿）" : `\n总判定: FAIL（${fails.length} 项）：${fails.join(" | ")}`);
process.exit(fails.length === 0 ? 0 : 1);
