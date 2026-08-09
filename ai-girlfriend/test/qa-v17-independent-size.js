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

// DESIGN-v21 §1.1 唯一自洽解（写死在探针里，防止「读预算表自证预算表」的循环论证）
// v21 路径③：engine 让渡 D=100 予 contingency ⇒ engineNetMax −100、engineMax −100、
//   moduleSumMax +100、contingency +100；memory/presence/texture 与 totalMax 逐位不动。
//   ★ 本 TRUTH 表是 PRD-v21 完全漏列的第 4 处 V33 针位，且已接入 npm run test:probe
//     （package.json 第 3 位）—— 漏改它 = 落地首日 9 条红（DESIGN-v21 §1.2 勘误 A）。
const TRUTH = {
  engineBase: 245737, engineNetMax: 2700, engineMax: 248437,
  "memory.js": 13365, "presence.js": 3598, "texture.js": 4398, "contingency.js": 6682,
  moduleSumMax: 28043, totalMax: 276480,
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

/* --- E. contingency 天花板与真实缓冲（v19 三锁归一，DESIGN-v19 §3.3-③）---
 * 本探针的立身契约是「刻意写死真值以规避循环论证」（上方 TRUTH 表）。故 v19 归一时
 * **不把 E 段改成读 B**（那会退化成"读预算表自证预算表"），而是改读 TRUTH ——
 * 唯一真值仍写死在探针内，但全文件只准出现一次，v17 遗留的第二个数字就此清零。
 * TRUTH 与 B 的逐字段对拍已由 A 段覆盖，此处不重复。 */
console.log("\n--- E. contingency 天花板与真实缓冲（v19 三锁归一）---");
const CEILING = TRUTH["contingency.js"];
const V16_ANCHOR = 4518;                 // v15 R-C5 落位，历史事实（非配额），冻结
const NET_MAX = CEILING - V16_ANCHOR;    // 派生量：无独立可写位置，随配额自动跟随
chk("contingency.js ≤ 配额（v19 单一真源）", s.each["contingency.js"] <= CEILING,
  `实测 ${s.each["contingency.js"]} ≤ ${CEILING}，真实缓冲 ${CEILING - s.each["contingency.js"]}B`);
chk("R-S2 净增 ≤ NET_MAX（派生上限）", s.each["contingency.js"] - V16_ANCHOR <= NET_MAX,
  `净增 ${s.each["contingency.js"] - V16_ANCHOR} ≤ ${NET_MAX}（= ${CEILING} − ${V16_ANCHOR}）`);
chk("⑧ V16_ANCHOR + NET_MAX ≡ SIZE_BUDGET[contingency]",
  V16_ANCHOR + NET_MAX === B["contingency.js"],
  `${V16_ANCHOR} + ${NET_MAX} = ${V16_ANCHOR + NET_MAX} vs 配额 ${B["contingency.js"]}`);

console.log("\n=== 汇总 ===");
console.log(JSON.stringify({
  engine: s.engine, engineNet: s.engineNet, moduleSum: s.moduleSum, total: s.total,
  each: s.each, over: s.over,
}, null, 2));
console.log(fails.length === 0 ? "\n总判定: PASS（体积四锁全绿）" : `\n总判定: FAIL（${fails.length} 项）：${fails.join(" | ")}`);
process.exit(fails.length === 0 ? 0 : 1);
