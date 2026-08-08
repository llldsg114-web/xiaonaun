"use strict";
/* QA 独立验收探针 · v16 体积四锁（Edward / 严过关）
 *
 * 纪律：不采信工程师报告，也不裸跑 wiring-scan.js（它是模块，无输出恒 exit 0，不可作证据）。
 * 本探针**直接 require 并驱动 scanSizes()**，逐条复算 PRD-v16 §5.2 / DESIGN-v16 §0.1 的
 * 四锁恒等式 ①②③④ + v16 新增 ⑤（A1-a 硬编码 V33 必须 === engineMax）。
 *
 * 退出码：任一断言失败 → 1
 */

const fs = require("fs");
const path = require("path");
const { scanSizes, SIZE_BUDGET } = require("./wiring-scan.js");

const ROOT = path.join(__dirname, "..");
const s = scanSizes();
const B = SIZE_BUDGET;
const fails = [];
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"}  ${label}${detail ? "  → " + detail : ""}`);
  if (!cond) fails.push(label);
};

console.log("=== QA v16 体积四锁独立探针（直驱 scanSizes()）===\n");

console.log("--- 实测快照 ---");
console.log(`  engine.js      ${s.engine}  / 上限 ${B.engineMax}   余 ${B.engineMax - s.engine}`);
console.log(`  engineNet      ${s.engineNet}    / 上限 ${B.engineNetMax}     余 ${B.engineNetMax - s.engineNet}`);
console.log(`  moduleSum      ${s.moduleSum}   / 上限 ${B.moduleSumMax}   余 ${B.moduleSumMax - s.moduleSum}`);
console.log(`  total          ${s.total}  / 上限 ${B.totalMax}  余 ${B.totalMax - s.total}`);
for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
  console.log(`  ${f.padEnd(15)}${String(s.each[f]).padEnd(7)}/ 配额 ${String(B[f]).padEnd(7)}余 ${B[f] - s.each[f]}`);
}
console.log(`  over = ${JSON.stringify(s.over)}\n`);

console.log("--- 主理人清单第 2 项：四锁硬断言 ---");
ok(Array.isArray(s.over) && s.over.length === 0, "AC-B-1 over === []", JSON.stringify(s.over));
ok(s.engine <= 248137, "engine.js ≤ 248137", `${s.engine} ≤ 248137`);
ok(s.each["contingency.js"] <= 4973, "contingency.js ≤ 4973", `${s.each["contingency.js"]} ≤ 4973`);
ok(s.engineNet <= 2400, "engineNet ≤ 2400", `${s.engineNet} ≤ 2400`);
ok(s.moduleSum <= 28343, "moduleSum ≤ 28343", `${s.moduleSum} ≤ 28343`);

console.log("\n--- 恒等式 ①~⑤（DESIGN-v16 §0.1 / §7.3）---");
ok(B.engineMax === B.engineBase + B.engineNetMax,
  "① engineMax = engineBase + engineNetMax",
  `${B.engineMax} = ${B.engineBase} + ${B.engineNetMax}`);
ok(B.engineMax === 248137 && B.engineBase === 245737 && B.engineNetMax === 2400,
  "①' 新值落位 248137 = 245737 + 2400",
  `${B.engineMax} / ${B.engineBase} / ${B.engineNetMax}`);
const quotaSum = B["memory.js"] + B["presence.js"] + B["texture.js"] + B["contingency.js"];
ok(quotaSum === B.moduleSumMax, "② Σ(4 模块配额) === moduleSumMax",
  `${B["memory.js"]}+${B["presence.js"]}+${B["texture.js"]}+${B["contingency.js"]} = ${quotaSum} vs ${B.moduleSumMax}`);
ok(quotaSum === 28343, "②' moduleSumMax 落位 28343", String(quotaSum));
const three = B.engineBase + B.engineNetMax + B.moduleSumMax;
ok(three <= B.totalMax, "③ engineBase+engineNetMax+moduleSumMax ≤ totalMax",
  `${three} ≤ ${B.totalMax}（松弛 ${B.totalMax - three}）`);
ok(B.totalMax === 276480, "③' totalMax 未被抬顶（守住 270KB）", String(B.totalMax));
let q4 = true;
for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
  if (!(B[f] > s.each[f])) q4 = false;
}
ok(q4, "④ 各配额 > 各实测（配额不倒挂）",
  `memory ${B["memory.js"]}>${s.each["memory.js"]} / presence ${B["presence.js"]}>${s.each["presence.js"]}` +
  ` / texture ${B["texture.js"]}>${s.each["texture.js"]} / contingency ${B["contingency.js"]}>${s.each["contingency.js"]}`);
ok(B["memory.js"] === 14154, "④' memory.js 配额让渡至 14154", String(B["memory.js"]));

/* ⑤ A1-a 硬编码 V33 必须 === engineMax（DESIGN-v16 §5.0 连带破锁项） */
const a1src = fs.readFileSync(path.join(ROOT, "test", "qa-v13-t2t4-fix.test.js"), "utf8");
const mV33 = a1src.match(/const\s+V33\s*=\s*(\d+)/);
ok(!!mV33, "⑤ A1-a 中找得到 V33 字面量", mV33 ? mV33[0] : "未找到");
if (mV33) {
  ok(Number(mV33[1]) === B.engineMax, "⑤' V33 === engineMax（248137）",
    `V33=${mV33[1]} vs engineMax=${B.engineMax}`);
  ok(Number(mV33[1]) !== 247955, "⑤'' V33 已脱离旧值 247955", `V33=${mV33[1]}`);
}

console.log("\n--- AC-B-5 / AC-B-7 ---");
ok(B.engineNetMax - s.engineNet >= 0, "engineNet 未超配额",
  `余 ${B.engineNetMax - s.engineNet}B`);
const wsSrc = fs.readFileSync(path.join(ROOT, "test", "wiring-scan.js"), "utf8");
ok(/v16\s*T0\s*预算重谈轮/.test(wsSrc) && /2200→2400/.test(wsSrc) && /28525→28343/.test(wsSrc),
  "AC-B-7 wiring-scan.js 审批链含 v16 推导式注释段");

console.log(`\n=== 体积四锁总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项: " + JSON.stringify(fails, null, 2));
process.exitCode = fails.length === 0 ? 0 : 1;
