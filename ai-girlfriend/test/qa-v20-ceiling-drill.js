#!/usr/bin/env node
"use strict";
/* QA v20 · ">安全上限" 门禁转红演练（DESIGN-v20 §4.2 · PRD Q2）
 *
 * ── 这个脚本证明什么 ────────────────────────────────────────────────
 *   门禁全绿只能证明「此刻没人越界」，**不能**证明「越界时门禁真的会响」。
 *   v19 的教训正是如此：D 段硬编码 4 文件，扫描恒 0 命中、恒绿，
 *   而那个绿是**盲区造成的假绿**。本脚本补的就是这一课 ——
 *   它是**门禁的门禁**：若哪天有人把锁④的 `>` 改成 `>=`，本脚本立刻红。
 *
 * ── 为什么做成可复跑脚本，而不是一次性手工演练 ──────────────────────
 *   手工演练证明的是「**此刻**门禁能转红」；脚本证明的是「**任何时刻**都能」。
 *   手工还有两个硬伤：需要真的写坏 contingency.js（存在忘记回退的风险），
 *   且取证是一张可伪造的截图；脚本的取证是**子进程退出码**，不可伪造。
 *
 * ── ★ 929 而不是 930：一个字节的缺口 ───────────────────────────────
 *   门禁锁④用严格 `>`（配额必须严格宽于基线，拒绝零余量），
 *   业务锁用 `≤`（用满配额不算违规）。两者语义本就不同，比较符不一致是
 *   语义差异的正确外显，**不是缺陷**。后果是二者对"天花板"的答案相差恰好 1：
 *     Δ=929 → 门禁绿；Δ=930 → 门禁红，而**业务侧全绿、毫无察觉**。
 *   段 2 就是把这个缺口钉死成可复跑断言。
 *
 * ── 阈值纪律 ────────────────────────────────────────────────────────
 *   本脚本**不写任何** 929 / 930 / 6581 / 6582 字面量，全部由 SIZE_BUDGET 派生 ——
 *   否则它自己就成了第 5 个平行数字，且会被门禁 D 段的全目录扫描当场抓到。
 *   唯一的字面量是 V19_ANCHOR，来源见其定义处注释。
 *
 * ── CI 接线 ─────────────────────────────────────────────────────────
 *   **手动按需跑**：`npm run test:ceiling-drill`。
 *   ✗ 绝不进 `npm test` / `test:probe` / `test:probe:fast`。
 *     段 4 会真实地把 contingency.js 顶到超限再回滚，虽自带 finally + 信号兜底，
 *     但常驻 CI 不该承担"演练期文件被改写"的窗口期风险。
 *
 * 退出码：任一断言失败 → 1；全绿 → 0。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const W = require("./wiring-scan.js");

const ROOT = path.join(__dirname, "..");
const CTG = path.join(ROOT, "contingency.js");
const GATE = path.join(__dirname, "qa-v19-quota-gate.js");

const fails = [];
const chk = (name, cond, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? "  → " + detail : ""}`);
  if (!cond) fails.push(name);
};

console.log("=== QA v20 · 天花板转红演练（门禁的门禁）===\n");

/* ══════════════ 段 1 · 派生安全线（零阈值字面量）══════════════ */
console.log("--- 1. 派生安全线（全部现算，不写字面量）---");
const QUOTA = W.SIZE_BUDGET["contingency.js"];
/** v19 收口锚点：语料增补前 contingency.js 的实测字节，历史事实，冻结。
 *  来源：DESIGN-v19 §1.1 / PRD-v19 §0 T0 基线；v20 前 T0_BYTES 亦为此值。
 *  ⚠ 它不在门禁 BANNED 三数之列，故写作字面量不违规；若 v21 将其纳入 BANNED，
 *    此处须改为从门禁历史注释读取。 */
const V19_ANCHOR = 5652;
/** 门禁锁④是严格 `>`，故实测字节最大只能到「配额 − 1」。 */
const SAFE_MAX_ACTUAL = QUOTA - 1;
/** 自 v19 锚点起算的安全增量上限（本轮全系统最紧的一条约束）。 */
const SAFE_MAX_DELTA = SAFE_MAX_ACTUAL - V19_ANCHOR;

/** 从门禁源码正则抽取 T0 基线。
 *  刻意**不 require** —— 门禁是可执行脚本，require 会让它整段跑一遍并 process.exit()。
 *  先剥注释，避免抽到注释里的历史数字。 */
function readGateT0() {
  const bare = W.stripComments(fs.readFileSync(GATE, "utf8"));
  const blk = bare.match(/const\s+T0_BYTES\s*=\s*\{([\s\S]*?)\}/);
  if (!blk) return NaN;
  const m = blk[1].match(/["']contingency\.js["']\s*:\s*(\d+)/);
  return m ? Number(m[1]) : NaN;
}
const T0 = readGateT0();

console.log(`  配额（SIZE_BUDGET 真源）        = ${QUOTA}`);
console.log(`  锁④允许的最大实测字节 = 配额−1  = ${SAFE_MAX_ACTUAL}`);
console.log(`  v19 收口锚点                    = ${V19_ANCHOR}`);
console.log(`  ★ 安全 Δ 上限 = ${SAFE_MAX_ACTUAL} − ${V19_ANCHOR} = ${SAFE_MAX_DELTA}  （不是 ${SAFE_MAX_DELTA + 1}！）`);
console.log(`  门禁当前 T0 基线（正则抽取）     = ${T0}`);
chk("T0 基线可从门禁源码抽出且为正整数", Number.isInteger(T0) && T0 > 0, `T0 = ${T0}`);
chk("T0 基线仍在配额之内（锁④前置）", T0 < QUOTA, `${T0} < ${QUOTA}`);

/* ══════════════ 段 2 · 边界三判（纯函数，不碰磁盘）══════════════
 * 反空转要求：929→true 与 930→false 必须**成对**出现，缺一即无效 ——
 * 只写"绿"的那一半，等于把 true 写死。 */
console.log("\n--- 2. 边界三判（锁④ vs 业务锁，同一实测字节两种答案）---");
/** 复刻门禁 C 段锁④：`B[f] > T0_BYTES[f]`，严格 >。 */
const lock4 = (actual) => QUOTA > actual;
/** 复刻业务锁 AC-RS2-8：`b <= CEILING`。 */
const bizLock = (actual) => actual <= QUOTA;

const AT_MAX = SAFE_MAX_ACTUAL;          // Δ = SAFE_MAX_DELTA     （安全上限）
const OVER = SAFE_MAX_ACTUAL + 1;        // Δ = SAFE_MAX_DELTA + 1 （越界 1 字节）
chk(`Δ=${SAFE_MAX_DELTA}（实测 ${AT_MAX}）→ 锁④ 应绿`, lock4(AT_MAX) === true,
  `${QUOTA} > ${AT_MAX} = ${lock4(AT_MAX)}`);
chk(`Δ=${SAFE_MAX_DELTA + 1}（实测 ${OVER}）→ 锁④ 应红  ★核心取证`, lock4(OVER) === false,
  `${QUOTA} > ${OVER} = ${lock4(OVER)}`);
chk(`Δ=${SAFE_MAX_DELTA + 1}（实测 ${OVER}）→ 业务锁仍绿  ★一字节缺口实证`, bizLock(OVER) === true,
  `${OVER} <= ${QUOTA} = ${bizLock(OVER)}  ← 业务侧对越界毫无察觉`);
chk("两把锁在越界点给出相反答案（缺口确实存在）", lock4(OVER) !== bizLock(OVER),
  `锁④=${lock4(OVER)} / 业务锁=${bizLock(OVER)}`);

/* ══════════════ 段 3 · 临时目录 padding（永不触碰真实文件）══════════════ */
console.log("\n--- 3. 临时目录构造超限副本（Q2：不落盘到仓库）---");
const bytesBefore = fs.statSync(CTG).size;
/** 造一段恰好 n 字节的合法 JS 注释 padding（证明"超限"而非"写坏"）。
 *  包裹开销 = "\n" + "/*" + "*∕" + "\n" = 6 字节，故填充字符数 = n − 6。 */
function padOf(n) {
  const WRAP = 6;
  return Buffer.from("\n/*" + "x".repeat(Math.max(0, n - WRAP)) + "*/\n", "utf8");
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v20drill-"));
try {
  const copy = path.join(tmp, "contingency.js");
  const src = fs.readFileSync(CTG);
  fs.writeFileSync(copy, Buffer.concat([src, padOf(OVER - src.length)]));
  const got = fs.statSync(copy).size;
  chk("padding 真实生效：副本字节 === 越界目标", got === OVER, `实测 ${got} / 目标 ${OVER}`);
  chk("以副本复算锁④ → 判定为 FAIL", lock4(got) === false, `${QUOTA} > ${got} = ${lock4(got)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
chk("临时目录已清理", !fs.existsSync(tmp), tmp);

/* ══════════════ 段 4 · 端到端真实转红取证（问门禁本体要退出码）══════════════
 * 段 2/3 是"复刻判定式"，段 4 才是"真的去问门禁"。
 * 差别很关键：前者证明我对锁④的理解没错，后者证明**门禁本体**确实会红。
 *
 * ★ 起草期实跑揪出的一个要害（写给 v21）：**锁④的第二个操作数是 T0_BYTES（基线常量），
 *   不是实测字节**。所以「把 contingency.js 撑大」并不会让锁④红 —— 拦住它的是 B 段
 *   diff=0 硬闸。锁④真正的红，发生在**基线也被同步到越界值**的那一刻，
 *   即"有人合规地走完基线同步流程，却把 Δ 排到了 930"。两条红路径语义不同，必须分开取证：
 *     4a 未同步基线的越界（最常见）→ B 段 diff 硬闸接住；
 *     4b 同步了基线的越界（最危险，业务侧全绿）→ C 段锁④接住。★这才是 929 边界的真身
 *
 * 安全兜底三重：① try/finally 恢复；② 原文缓存在内存 Buffer；
 * ③ 注册 exit/SIGINT/SIGTERM/uncaughtException 钩子，异常中断也恢复。 */
const ORIGINAL = fs.readFileSync(CTG);
const GATE_ORIGINAL = fs.readFileSync(GATE);
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  try { fs.writeFileSync(CTG, ORIGINAL); } catch (e) { /* 尽力恢复 */ }
  try { fs.writeFileSync(GATE, GATE_ORIGINAL); } catch (e) { /* 尽力恢复 */ }
};
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { restore(); process.exit(130); });
}
process.on("uncaughtException", (e) => { restore(); console.error(e); process.exit(1); });

const runGate = () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const lineOf = (out, re) => (out.split("\n").find((l) => re.test(l)) || "<未捕获>").trim();

/* ── 4a · 未同步基线的越界 → B 段 diff 硬闸 ── */
console.log("\n--- 4a. 真实顶到越界点（基线未同步）→ B 段 diff 硬闸应接住 ---");
let a = { code: 0, out: "" };
try {
  fs.writeFileSync(CTG, Buffer.concat([ORIGINAL, padOf(OVER - ORIGINAL.length)]));
  const nowBytes = fs.statSync(CTG).size;
  chk("已把真实 contingency.js 顶到越界点", nowBytes === OVER, `实测 ${nowBytes} / 目标 ${OVER}`);
  a = runGate();
} finally {
  fs.writeFileSync(CTG, ORIGINAL);
}
chk("4a 门禁退出码非 0（真的转红了）", a.code !== 0, `exit = ${a.code}`);
chk("4a 门禁输出含总判定 FAIL", /配额门禁总判定:\s*FAIL/.test(a.out),
  (a.out.match(/=== 配额门禁总判定: \w+ ===/) || ["<未捕获>"])[0]);
chk("4a B 段 diff 硬闸明确报红", /FAIL[^\n]*contingency\.js 字节 === 基线/.test(a.out),
  lineOf(a.out, /contingency\.js 字节 === 基线/));

/* ── 4b · 基线同步到越界值 → C 段锁④（★929 边界的真身）── */
console.log("\n--- 4b. 基线被同步到越界值 → C 段锁④应接住（业务侧此时全绿）---");
let b = { code: 0, out: "" };
try {
  const patched = GATE_ORIGINAL.toString("utf8").replace(
    /(const\s+T0_BYTES\s*=\s*\{[\s\S]*?["']contingency\.js["']\s*:\s*)(\d+)/,
    (m, head) => head + OVER);
  chk("门禁 T0_BYTES 已就地改写为越界值（演练用）",
    new RegExp(`["']contingency\\.js["']\\s*:\\s*${OVER}`).test(patched), `T0 → ${OVER}`);
  fs.writeFileSync(GATE, patched);
  b = runGate();
} finally {
  fs.writeFileSync(GATE, GATE_ORIGINAL);
}
chk("4b 门禁退出码非 0（真的转红了）", b.code !== 0, `exit = ${b.code}`);
chk("4b C 段锁④ 明确报红  ★核心取证", /FAIL[^\n]*配额 > 基线/.test(b.out),
  lineOf(b.out, /配额 > 基线/));
chk("4b 业务锁在同一时刻仍绿（业务侧毫无察觉）", bizLock(OVER) === true,
  `业务锁 ${OVER} <= ${QUOTA} = true，而门禁锁④ = false`);

/* ── 段 4 收尾：Q2 承诺的兑现取证 ── */
console.log("\n--- 4c. 自清理取证（Q2：仓库不得留下任何痕迹）---");
const bytesAfter = fs.statSync(CTG).size;
chk("★ 演练前后真实 contingency.js 字节逐位不变", bytesAfter === bytesBefore,
  `${bytesBefore} → ${bytesAfter}`);
chk("★ 演练前后真实 contingency.js 内容逐字节一致", fs.readFileSync(CTG).equals(ORIGINAL),
  "byte-identical");
chk("★ 演练前后门禁文件内容逐字节一致", fs.readFileSync(GATE).equals(GATE_ORIGINAL),
  "byte-identical");
chk("★ 复跑门禁确认已回到全绿", runGate().code === 0, "exit = 0");

console.log(`\n=== 天花板演练总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项: " + JSON.stringify(fails, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
