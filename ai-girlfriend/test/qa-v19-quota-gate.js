#!/usr/bin/env node
"use strict";
/* QA v19 · 四模块 diff=0 配额门禁（DESIGN-v19 §4）
 *
 * ── 这个门禁抓的是什么（与既有四锁的本质区别）──────────────────────
 * 既有体积四锁只在**撞到天花板**时才响：texture 实测 4366 / 配额 4398，
 * 你可以静悄悄地往里塞 31 个字节而四锁全绿。本门禁在**第 1 个字节**就响。
 *   四锁抓的是「超配额」；本门禁抓的是「**未经重谈的 diff**」。两者互补，不重叠。
 *
 * ── 为什么是独立探针，而不是塞进 wiring-scan.js（§4.1 决策）───────
 *   ① 循环论证：wiring-scan.js 是 SIZE_BUDGET 的宿主，"真源自证真源"不成立；
 *      基线写死在本文件内，与真源分离，才构成第二个证人。
 *   ② 可执行性：wiring-scan.js 是纯 module，裸跑恒 exit 0 且无输出，不可作证据。
 *   ③ 爆炸半径（最关键）：wiring-scan.js 被 12+ 测试 require，若把"字节 ≠ 基线"
 *      做成加载期 throw，任何人合法改一个字节就会让 `npm test` **整体崩溃**，
 *      而不是"门禁红一条"。那不是门禁，那是自毁开关。
 *      门禁必须精确地**只红自己**，才能引导人去走重谈流程，而不是去找绕过手段。
 *
 * ── 为什么用字节数而不是内容哈希（Q4 裁定）─────────────────────────
 * 哈希会让**等长重构**（改个变量名、调换两行等长语句）误红，而等长重构不消耗配额、
 * 本就不该惊动配额治理。本门禁的语义是「你有没有动用预算」，度量单位就该是字节。
 * 口径与 wiring-scan.scanSizes() 完全一致：fs.statSync(path).size。
 *
 * ── T0_BYTES 基线更新协议（§4.4 · 写给 v20+，必须遵守）─────────────
 *   T0_BYTES 是**受控常量，与配额同级**。改它必须与配额重谈同 PR，三件套齐全：
 *     ① SIZE_BUDGET 对应项（若配额需变）
 *     ② 本文件 T0_BYTES 对应项
 *     ③ DESIGN-vNN 记录重谈依据 + 主理人批准
 *   任一缺失 = 违规。**禁止「先改基线让 CI 变绿，再补流程」**——
 *   门禁的价值 100% 取决于「改基线比重谈配额更麻烦」。
 *
 * ── CI 接线（Q3 裁定）──────────────────────────────────────────────
 *   只进 `npm run test:probe`（全量，末位），**不进** `test:probe:fast`。
 *   fast 是 pre-commit 子集，而配额门禁在正常开发中途必然频繁转红
 *   （改模块 → 门禁红 → 但工程师正要去重谈配额）。放进 pre-commit 等于
 *   训练团队养成 `--no-verify` 的肌肉记忆，H13 那种真正致命的闸会被一起绕过。
 *   门禁该卡在 PR/CI 层（无法用本地 flag 绕过），而不是阻断本地提交节奏。
 *
 * ── v20 变更说明（R-2 / Q4 / T03 基线迁移）──────────────────────────
 *   ① D 段扫描范围：4 文件硬编码 → **全目录 test/*.js（36 个，不递归 fixtures/）**。
 *      硬编码的 4 文件是**盲区造成的假绿**：想写平行字面量，新开一个文件即可绕过。
 *      不按 `.test.js` 后缀过滤 —— 4 个裸探针不受 node --test 约束、写起来更随意，
 *      而它们恰恰是体积治理的取证出口，按后缀过滤等于把执法者排除在执法范围外。
 *   ② 豁免协议：`EXEMPT` **出厂为空**（修完 R-1/Q4 后全目录 0 命中，无需为变绿预置豁免）。
 *      每项 `{ f, why }`，why 必填、文件必须真实存在，否则判红（僵尸豁免 = 治理腐化）。
 *   ③ Q4 自指消解：D 段标题不再复述禁用数字，改由 `BANNED.map(b => b.n).join("/")` 派生。
 *      范围扩到全目录后门禁会扫到自己，原硬编码标题（含 chk( → 命中 ASSERTIVE）
 *      会让门禁自我误红 3 次。本质是 D 段对自己做了一次单一真源治理。
 *   ④ T03：`T0_BYTES["contingency.js"]` 5652 → 6270（R-S2 语料落地，三件套见 A 段注释）。
 *      ★ 这次迁移是**有意分成独立任务**的：T01 落地语料后门禁必然转红，
 *        工程师必须显式地、带着四锁复算取证来做基线同步 ——
 *        门禁的价值 100% 取决于「改基线比重谈配额更麻烦」。
 *   ⑤ 929B 边界：锁④用严格 `>`，业务锁用 `≤`，两者对天花板的答案相差 1 个字节。
 *      安全 Δ 上限是 929 不是 930，详见 wiring-scan.js v20 注释块 / qa-v20-ceiling-drill.js。
 *
 * 退出码：任一段失败 → 1；全绿 → 0。
 */

const fs = require("fs");
const path = require("path");
const W = require("./wiring-scan.js");

const ROOT = path.join(__dirname, "..");
const B = W.SIZE_BUDGET;
const MODULES = ["memory.js", "presence.js", "texture.js", "contingency.js"];

/* ══════════════ A · 基线常量（写死，规避循环论证）══════════════
 * 来源：v19 起草期 + 实现期两次实测取证，与 DESIGN-v19 §1.1 / PRD-v19 §0 T0 基线逐位一致。
 * 口径：fs.statSync(f).size（Q4：字节数，不用哈希）。 */
const T0_BYTES = {
  "memory.js": 13333,
  "presence.js": 3566,
  "texture.js": 4366,
  /* ★ v20 T03 基线迁移 5652 → 6270（Δ+618 · R-S2 语料四型各 +3 条，首次真实消费配额）。
   * 三件套（DESIGN-v19 §4.4）已履行：
   *   ① SIZE_BUDGET 调整 → **经审视，判定无需变更**：Δ 落在既有配额 6582 之内，
   *      九值逐位冻结。此项已履行并结案为空，**不是跳步**（两者的区别必须可见）。
   *   ② 本项同步到落地实测值 6270（fs.statSync 实测，非纸面算术）。
   *   ③ DESIGN-v20 §0/§5.8 记录重谈依据 + 主理人 Qi 批准链。
   * 历史值 5652 自此仅作审计轨迹，**不得**再当作 contingency 的现行基线。
   * ⚠ 上方三项一个字符都未动（memory/presence/texture 本轮字节零改动）。 */
  "contingency.js": 6270,
};

/** v15 R-C5 落位 —— 历史事实（非配额），冻结不再变；净增上限由它与配额派生。 */
const V16_ANCHOR = 4518;
/** 派生量：无独立可写位置，随配额自动跟随（DESIGN-v19 §3.2 锁⑧）。 */
const NET_MAX = B["contingency.js"] - V16_ANCHOR;

const fails = [];
const chk = (name, cond, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? "  → " + detail : ""}`);
  if (!cond) fails.push(name);
};

console.log("=== QA v19 配额门禁（四模块 diff=0）===\n");

/* ══════════════ B · diff=0 硬闸【核心】══════════════ */
console.log("--- B. diff=0 硬闸（实测字节 must === T0 基线）---");
const drift = [];
for (const f of MODULES) {
  const cur = fs.statSync(path.join(ROOT, f)).size;
  const want = T0_BYTES[f];
  const d = cur - want;
  if (d !== 0) drift.push({ f, cur, want, d });
  chk(`${f} 字节 === 基线`, d === 0,
    `实测 ${cur} / 基线 ${want} / Δ${d >= 0 ? "+" : ""}${d}`);
}
if (drift.length) {
  console.log("\n  ⚠ 检测到**未经重谈的源码 diff**。注意：这不等于超配额 ——");
  for (const x of drift) {
    const slack = B[x.f] - x.cur;
    console.log(`     · ${x.f}  Δ${x.d >= 0 ? "+" : ""}${x.d}B，当前仍${slack >= 0 ? "" : "已"}${slack >= 0 ? `余 ${slack}B 配额（四锁可能仍全绿）` : `超配额 ${-slack}B`}`);
  }
  console.log("\n  ▶ 请走配额重谈流程（DESIGN-v19 §4.4，三件套缺一即违规）：");
  console.log("     ① SIZE_BUDGET 对应项调整（若配额需变；Σ 四项须恒 = 27943）");
  console.log("     ② 本文件 T0_BYTES 对应项同步到新实测值");
  console.log("     ③ DESIGN-vNN 记录重谈依据 + 主理人批准链");
  console.log("     重谈路径不得跳步：contingency 余量回让 → engine 让渡(≤142B, 须 V33 三针同步) → 抬 totalMax");
  console.log("     ✗ 禁止「先改 T0_BYTES 让 CI 变绿，再补流程」。\n");
}

/* ══════════════ C · 四锁不破坏自证（门禁不得成为新的破锁源）══════════════ */
console.log("\n--- C. 四锁 ①②③④ + ⑧ 自证 ---");
chk("① engineMax = engineBase + engineNetMax",
  B.engineMax === B.engineBase + B.engineNetMax,
  `${B.engineMax} === ${B.engineBase} + ${B.engineNetMax}`);
const sum4 = MODULES.reduce((a, f) => a + B[f], 0);
chk("② Σ(4 模块配额) === moduleSumMax", sum4 === B.moduleSumMax && sum4 === 27943,
  `${sum4} === ${B.moduleSumMax}`);
const tri = B.engineBase + B.engineNetMax + B.moduleSumMax;
chk("③ engineBase+engineNetMax+moduleSumMax === totalMax（slack=0）",
  tri === B.totalMax, `${tri} === ${B.totalMax}（松弛 ${B.totalMax - tri}）`);
let q4 = true;
const q4d = [];
for (const f of MODULES) {
  if (!(B[f] > T0_BYTES[f])) q4 = false;
  q4d.push(`${B[f]}>${T0_BYTES[f]}`);
}
chk("④ 逐模块配额 > 基线（配额不倒挂）", q4, q4d.join(" / "));
chk("⑧ V16_ANCHOR + NET_MAX ≡ SIZE_BUDGET[contingency.js]",
  V16_ANCHOR + NET_MAX === B["contingency.js"],
  `${V16_ANCHOR} + ${NET_MAX} = ${V16_ANCHOR + NET_MAX} === ${B["contingency.js"]}`);

/* ══════════════ D · 单一真源回归扫描【元防御 · L3】══════════════
 * 防的是「v20 有人又写回第 4 个平行数字」。只扫**断言性行**（含 assert / ok( / chk( / <=），
 * 说明性注释里出现这些数字是允许的 —— §3.4 的 v19 说明块本身就要提到它们，
 * 不排除注释就会自我误红（DESIGN-v19 §4.3-D / R-2 / U-3）。
 * 注释剥离复用 wiring-scan.stripComments（等量换行替换，行号与原文件对齐）。 */
console.log("\n--- D. 单一真源回归扫描（全目录 · 不得再出现平行字面量）---");
/* v20 R-2：扫描集从 4 文件硬编码 → 全目录。
 * 硬编码 4 文件是**盲区造成的假绿**：新建的测试/探针天然不在扫描集内，
 * 想写平行字面量只需新开一个文件。范围取全部 test/*.js（不按 .test.js 后缀过滤）——
 * 4 个裸探针恰恰是最容易写平行字面量的地方（不受 node --test 约束，且它们本身就是
 * 体积治理的取证出口），按后缀过滤等于把执法者排除在执法范围外。
 * fixtures/ 子目录不递归：那是被测数据，不含断言。 */
const SCAN_DIR = path.join(ROOT, "test");
const SCAN_GLOB = /\.js$/;
/* 显式豁免清单 —— **出厂为空**。
 * 存在的意义是给未来的合法例外留一个带 why 的登记口，不是给本轮擦屁股。
 * 协议（违反即判红，见下方腐化预警）：
 *   ① 每项形状 { f, why }，why 必填且非空 —— 无 why 的豁免 = 未经论证的盲区；
 *   ② f 必须真实存在于 test/ —— 文件删了而豁免留着 = 僵尸豁免，属治理腐化。 */
const EXEMPT = [];
const ALL_FILES = fs.readdirSync(SCAN_DIR).filter((f) => SCAN_GLOB.test(f)).sort();
const SCAN_FILES = ALL_FILES.filter((f) => !EXEMPT.some((e) => e.f === f));
const BANNED = [
  { n: "5671", re: /(?<![\d])5671(?![\d])/, why: "v17 残差锁，应改读 SIZE_BUDGET[\"contingency.js\"]" },
  { n: "1180", re: /(?<![\d])1180(?![\d])/, why: "v17 净增锁，应改为派生 B[\"contingency.js\"] − 4518" },
  { n: "2064", re: /(?<![\d])2064(?![\d])/, why: "NET_MAX 的算出值，写成字面量等于把背离推迟到下一次" },
];
const ASSERTIVE = /assert|\bok\(|\bchk\(|<=/;
const parallels = [];
for (const f of SCAN_FILES) {
  const src = fs.readFileSync(path.join(ROOT, "test", f), "utf8");
  const lines = W.stripComments(src).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ASSERTIVE.test(ln)) continue;
    for (const b of BANNED) {
      if (b.re.test(ln)) parallels.push(`${f}:${i + 1}  [${b.n}] ${b.why}\n        ${ln.trim()}`);
    }
  }
}
/* ★ v20 Q4 自指消解：标题**禁止复述** BANNED 的字面量，一律由 BANNED 派生。
 * 起因：R-2 把扫描集扩到全目录后，门禁自身进入扫描集，而本行原先硬写着那三个数字
 * 且含 chk( → 命中 ASSERTIVE → 门禁自我误红 3 次。
 * 意义超出"消红"：它把禁用字面量清单从两处（BANNED 定义 + 标题文案）收敛为一处。
 * 门禁在对别人执法之前，先对自己执了一次法。 */
const BANNED_LABEL = BANNED.map((b) => b.n).join("/");
chk(`全目录断言性行中，平行字面量 ${BANNED_LABEL} 计数 = 0`,
  parallels.length === 0,
  parallels.length ? "\n      " + parallels.join("\n      ") : `扫描 ${SCAN_FILES.length} 文件，0 违规`);
// 反空转取证：扫描必须真的读到了内容，否则 D 段是在扫空文件
const withAssert = SCAN_FILES.filter((f) => W.stripComments(fs.readFileSync(path.join(SCAN_DIR, f), "utf8"))
  .split("\n").some((l) => ASSERTIVE.test(l)));
chk("D 段非空转：全目录被扫文件数 >= 30 且多数文件含断言行",
  SCAN_FILES.length >= 30 && withAssert.length >= 20,
  `已扫描 ${SCAN_FILES.length} 个文件（其中 ${withAssert.length} 个含断言行）`);
/* ★ v20 T05 元测试：把 Q4 的修复钉死 —— 门禁自身必须 0 命中。
 * 防的是"v21 有人把标题改回硬编码"：那会让门禁在扫自己时误红，
 * 而误红的第一反应往往是把自己加进 EXEMPT —— 执法者豁免自己，治理就此塌掉。 */
const SELF = path.basename(__filename);
const selfHits = parallels.filter((p) => p.indexOf(SELF + ":") === 0);
chk("元测试 · 门禁自指：扫描自身命中 = 0（标题必须由 BANNED 派生）",
  SCAN_FILES.indexOf(SELF) >= 0 && selfHits.length === 0,
  `${SELF} 在扫描集内 = ${SCAN_FILES.indexOf(SELF) >= 0}，自身命中 ${selfHits.length}`);
/* ★ v20 豁免清单腐化预警 */
const rot = [];
for (const e of EXEMPT) {
  if (!e || !e.f) { rot.push("豁免项缺 f 字段"); continue; }
  if (!e.why || !String(e.why).trim()) rot.push(`${e.f} 缺 why（未经论证的盲区）`);
  if (!fs.existsSync(path.join(SCAN_DIR, e.f))) rot.push(`${e.f} 已不存在（僵尸豁免）`);
}
chk("豁免清单无腐化：每项 why 非空且文件真实存在", rot.length === 0,
  EXEMPT.length === 0 ? "EXEMPT 出厂为空（0 项）" : rot.length ? "\n      " + rot.join("\n      ") : `${EXEMPT.length} 项全部合规`);

/* ══════════════ E · 真实缓冲打印（P1-2：注释宣称 vs CI 实测并排可核对）══════════════ */
console.log("\n--- E. 真实缓冲（与 wiring-scan.js SIZE_BUDGET 行尾注释并排核对）---");
for (const f of MODULES) {
  const cur = fs.statSync(path.join(ROOT, f)).size;
  console.log(`  ${f.padEnd(16)}${String(cur).padStart(6)} / 配额 ${String(B[f]).padStart(6)}   余 ${String(B[f] - cur).padStart(4)}`);
}
console.log(`  ${"（派生）NET_MAX".padEnd(14)}${String(NET_MAX).padStart(6)} = 配额 ${B["contingency.js"]} − 锚点 ${V16_ANCHOR}`);

console.log(`\n=== 配额门禁总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项: " + JSON.stringify(fails, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
