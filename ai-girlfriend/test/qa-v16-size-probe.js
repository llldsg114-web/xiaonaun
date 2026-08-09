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
ok(s.engine <= 248437, "engine.js ≤ 248437", `${s.engine} ≤ 248437`);
/* v19 拆雷：本文件是**孤儿探针**（不被任何 npm script 引用，DESIGN-v19 §1.3 勘误①），
 * 但残差锁字面量留在这里就是休眠地雷 —— 谁把它接进 CI 谁就踩响。故一并改读单一真源。 */
ok(s.each["contingency.js"] <= B["contingency.js"], "contingency.js ≤ 配额（v19 单一真源）",
  `${s.each["contingency.js"]} ≤ ${B["contingency.js"]}（余 ${B["contingency.js"] - s.each["contingency.js"]}）`);
ok(s.engineNet <= 2700, "engineNet ≤ 2700", `${s.engineNet} ≤ 2700`);
ok(s.moduleSum <= 28043, "moduleSum ≤ 28043", `${s.moduleSum} ≤ 28043`);

console.log("\n--- 恒等式 ①~⑤（DESIGN-v16 §0.1 / §7.3）---");
ok(B.engineMax === B.engineBase + B.engineNetMax,
  "① engineMax = engineBase + engineNetMax",
  `${B.engineMax} = ${B.engineBase} + ${B.engineNetMax}`);
ok(B.engineMax === 248437 && B.engineBase === 245737 && B.engineNetMax === 2700,
  "①' 新值落位 248437 = 245737 + 2700（v21 路径③ engine 让渡 D=−100）",
  `${B.engineMax} / ${B.engineBase} / ${B.engineNetMax}`);
const quotaSum = B["memory.js"] + B["presence.js"] + B["texture.js"] + B["contingency.js"];
ok(quotaSum === B.moduleSumMax, "② Σ(4 模块配额) === moduleSumMax",
  `${B["memory.js"]}+${B["presence.js"]}+${B["texture.js"]}+${B["contingency.js"]} = ${quotaSum} vs ${B.moduleSumMax}`);
ok(quotaSum === 28043, "②' moduleSumMax 落位 28043（v21 +100，锁② 两边同移）", String(quotaSum));
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
ok(B["memory.js"] === 13365 && B["presence.js"] === 3598 && B["texture.js"] === 4398 && B["contingency.js"] === 6682,
  "④' v21 四模块配额落位 13365 / 3598 / 4398 / 6682（路径③ 仅 contingency +100，Σ 右移至 28043）",
  `${B["memory.js"]} / ${B["presence.js"]} / ${B["texture.js"]} / ${B["contingency.js"]}`);

/* ⑤ A1-a 硬编码 V33 必须 === engineMax（DESIGN-v16 §5.0 连带破锁项） */
const a1src = fs.readFileSync(path.join(ROOT, "test", "qa-v13-t2t4-fix.test.js"), "utf8");
const mV33 = a1src.match(/const\s+V33\s*=\s*(\d+)/);
ok(!!mV33, "⑤ A1-a 中找得到 V33 字面量", mV33 ? mV33[0] : "未找到");
if (mV33) {
  ok(Number(mV33[1]) === B.engineMax, "⑤' V33 === engineMax（248437）",
    `V33=${mV33[1]} vs engineMax=${B.engineMax}`);
  /* v21：248537 自本轮起也进入「旧值」名单 —— 路径③ 让渡后它就是漏改针位的特征值。 */
  ok(Number(mV33[1]) !== 247955 && Number(mV33[1]) !== 248137 && Number(mV33[1]) !== 248537,
    "⑤'' V33 已脱离旧值 247955 / 248137 / 248537", `V33=${mV33[1]}`);
}

console.log("\n--- AC-B-5 / AC-B-7 ---");
ok(B.engineNetMax - s.engineNet >= 0, "engineNet 未超配额",
  `余 ${B.engineNetMax - s.engineNet}B`);
const wsSrc = fs.readFileSync(path.join(ROOT, "test", "wiring-scan.js"), "utf8");
ok(/v16\s*T0\s*预算重谈轮/.test(wsSrc) && /2200→2400/.test(wsSrc) && /28525→28343/.test(wsSrc),
  "AC-B-7 wiring-scan.js 审批链含 v16 推导式注释段");
ok(/v17\s*T0\s*预算\s*gating\s*轮/.test(wsSrc) && /2400→2800/.test(wsSrc) && /28343→27943/.test(wsSrc),
  "AC-B-7' wiring-scan.js 审批链含 v17 推导式注释段（Δ=+400 让渡链）");

console.log(`\n=== 体积四锁总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项: " + JSON.stringify(fails, null, 2));
process.exitCode = fails.length === 0 ? 0 : 1;
