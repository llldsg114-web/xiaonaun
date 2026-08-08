"use strict";
/* QA 第 2 轮独立探针 · R-C5 c4/c5 可出场 + CAP=2 独立性（U-4）
 * 自建夹具，不复用 qa-v15-t1.test.js 的断言，只借用其 state 形状（形状是契约，不是断言）。 */

const H = require("./helpers.js");
const E = H.loadEngine();
const C = E.mod("contingency");

const HOUR = 36e5, DAY = 864e5;
const BASE = "今天过得还行吧。";

function st(over) {
  return Object.assign({
    affection: 500, tex: { t: 50, d: -1, n: 0 }, ctg: {}, flags: {},
    mem: { v: 13, facts: [], moments: [], migratedAt: 0 },
    persona: { tone: "soft" }, lastVisit: Date.now() - 2 * HOUR,
  }, over || {});
}
function ctx(s, over) {
  return Object.assign({ st: s, ue: { type: "neutral" }, lv: 3, crisis: false, text: "嗯", rng: Math.random }, over || {});
}
function mem(key, value) {
  return { v: 13, migratedAt: 0, moments: [], facts: [{ id: "f_" + key, key, value, conf: 0.8, tags: [key], since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null }] };
}

let fail = 0;
const say = (ok, msg) => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };

/* ---------- 1. :48 选择器结构：必须是随机 PW(filter)，不是 find ---------- */
console.log("=== 1. 选择器结构（源码钉）===");
const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "contingency.js"), "utf8");
const selLine = src.split("\n").findIndex(l => /chanceWith\(\.55/.test(l)) + 1;
const sel = src.split("\n")[selLine - 1];
console.log(`  选择器所在行: :${selLine}`);
console.log(`  ${sel.trim()}`);
say(/p\s*=\s*PW\(/.test(sel), "选择器走 PW(...) 随机取样");
say(/cd\.filter\(/.test(sel), "候选池经 filter 降权（q.k 排除）后再取样");
say(!/=\s*cd\.find\(|=\s*G\.find\(/.test(sel), "未退化为 find（find 会锁死首个候选，类型多样性归零）");
console.log("");

/* ---------- 2. c4 / c5 可出场（行为证据）---------- */
console.log("=== 2. c4 / c5 可出场 ===");
function sample(stOver, ctxOver, n) {
  const byK = {}; let hit = 0;
  for (let i = 0; i < n; i++) {
    const s = st(stOver); s.ctg = {};
    const rs = [BASE];
    const o = C.contingencePass(BASE, rs, ctx(s, ctxOver));
    if (o) { hit++; const k = s.ctg && s.ctg.k; byK[k] = (byK[k] || 0) + 1; }
  }
  return { byK, hit, n };
}
const r4 = sample({}, { text: "今天去了趟新开的那家书店" }, 400);
console.log("  c4 场景 byK =", JSON.stringify(r4.byK), `命中 ${r4.hit}/400`);
say((r4.byK.c4 || 0) > 0, `c4 好奇追问可出场（${r4.byK.c4 || 0} 次）`);

const r5 = sample({ mem: mem("喜好", "火锅") }, { text: "嗯" }, 400);
console.log("  c5 场景 byK =", JSON.stringify(r5.byK), `命中 ${r5.hit}/400`);
say((r5.byK.c5 || 0) > 0, `c5 共同回忆可出场（${r5.byK.c5 || 0} 次）`);

/* 多类同池时两者都能被抽中 → 证明不是"只有孤立场景才出得来" */
const rMix = sample({ lastVisit: Date.now() - 20 * HOUR, mem: mem("喜好", "火锅") },
  { text: "哈哈今天去了趟新开的那家书店" }, 600);
console.log("  混合池 byK =", JSON.stringify(rMix.byK), `命中 ${rMix.hit}/600`);
say((rMix.byK.c4 || 0) > 0 && (rMix.byK.c5 || 0) > 0, "c1/c2/c4/c5 同池竞争时 c4 与 c5 仍都能抽中");
say(Object.keys(rMix.byK).length >= 3, `混合池类型数 ${Object.keys(rMix.byK).length} ≥ 3（选择器确非 find）`);
console.log("");

/* ---------- 3. AC-C5-1 计数器独立于 CAP=2（U-4）---------- */
console.log("=== 3. AC-C5-1 计数器 vs CAP=2 日频闸 独立性（U-4）===");
/* 3a. CAP=2 本身没被放宽：同一 state 连打，第 3 次起必须闭闸 */
const s1 = st({}); s1.ctg = {};
let hits = 0;
for (let i = 0; i < 60; i++) {
  const rs = [BASE];
  if (C.contingencePass(BASE, rs, ctx(s1, { text: "今天去了趟新开的那家书店" }))) hits++;
}
console.log(`  同一 state 连打 60 轮，实际命中 ${hits} 次；ctg=${JSON.stringify(s1.ctg)}`);
say(hits <= 2, `CAP=2 未被 R-C5 放宽（同日同 state 命中 ${hits} ≤ 2）`);

/* 3b. 每轮 fresh state（U-4 口径）时，计数器不受 CAP 限制 → 类型多样性可达标 */
const rFresh = sample({}, { text: "今天去了趟新开的那家书店" }, 50);
console.log(`  每轮 fresh state 50 轮，命中 ${rFresh.hit} 次（远超 CAP=2）`);
say(rFresh.hit > 2, "AC-C5-1 的采样计数器独立于 CAP=2（fresh state 重置日频闸后命中数不封顶）");

/* 3c. 跨日重置：把 ctg.d 拨到昨天，闸门应重新打开 */
const s2 = st({}); s2.ctg = { d: Math.floor(Date.now() / DAY) - 1, n: 99, k: "c4", sT: -99, sA: 0 };
let reopened = 0;
for (let i = 0; i < 40; i++) {
  const s3 = st({}); s3.ctg = { d: Math.floor(Date.now() / DAY) - 1, n: 99, k: "c4", sT: -99, sA: 0 };
  const rs = [BASE];
  if (C.contingencePass(BASE, rs, ctx(s3, { text: "今天去了趟新开的那家书店" }))) reopened++;
}
console.log(`  昨日计数 n=99 的 state，今日 40 轮命中 ${reopened} 次`);
say(reopened > 0, "跨日闸门正确重置（n 按 d 判定，不会把昨天的计数带到今天）");
console.log("");

console.log("=".repeat(56));
console.log(`R-C5 结论: ${fail === 0 ? "PASS" : "FAIL（失败 " + fail + " 项）"}`);
process.exitCode = fail === 0 ? 0 : 1;
