"use strict";
/* QA 独立探针 · repair 路由启用取证（DESIGN-v22 §3.2 / P0-3 · AC-3.2 / AC-3.6 + H15）
 * 三段取证：
 *   ① 五型可达性：stable/expand/challenge/boundary/repair 均可被 C.sfType 命中，且互不遮蔽
 *   ② AC-3.6 无冲突不误触：security∈[0.45,0.5) × 正负极性 × lv∈{4,5,6} × 当日无冲突(negGate.count=0)
 *      ⇒ repair 命中必为 0（平静对话绝不冒道歉；A-2 否决级宣告已规避）
 *   ③ H15 占比复核：sf 仍以单一 key 落盘（源码无 sf1..sf4）；repair 触发窗口窄，单类占比受控（≤50%）
 * 退出码：全绿 0，任一失守 1（供 test:probe 的 `|| exit 1` 串联判定）。 */

const { loadEngine } = require("./helpers.js");
const fs = require("node:fs");
const path = require("node:path");
const E = loadEngine();
const C = E.mod("contingency");
const ROOT = path.join(__dirname, "..");

const DAY = 864e5;
function base(over) {
  const o = over || {};
  const self = Object.assign({ security: 0.55, openness: 0.5, independence: 0.5 }, o.self || {});
  return Object.assign({
    affection: 900,
    firstMeet: Date.now() - 60 * DAY,
    tex: { t: 50, d: Math.floor(Date.now() / DAY), n: 0, hAt: -1 },
    ctg: {},
    lastVisit: Date.now() - 3600e3,
    mem: { facts: [] },
  }, o, { self });
}
const CTX = (over) => Object.assign(
  { lv: 5, ue: { type: "neutral", polarity: 0, intensity: 0 }, crisis: false },
  over || {});
const QUIET = "今天挺好的";
const LONG = "今天下班路上看到晚霞，颜色特别好看，就想跟你说一声";

/* ---------- ① 五型可达 + 互不遮蔽 ---------- */
const cases = [
  ["boundary",  base({ self: { security: 0.47 } }), CTX({ ue: { type: "sad" } }), QUIET],
  ["repair",    base({ self: { security: 0.47 }, negGate: { date: "x", count: 1, lastByFamily: {}, streak: 0 } }), CTX({}), QUIET],
  ["stable",    base({ self: { security: 0.47 }, negGate: { date: "x", count: 0, lastByFamily: {}, streak: 0 } }), CTX({}), QUIET],
  ["challenge", base({ self: { security: 0.6, independence: 0.55 } }), CTX({}), QUIET],
  ["expand",    base({ self: { security: 0.6, independence: 0.3, openness: 0.5 } }), CTX({}), LONG],
  ["stable",    base({ self: { security: 0.6, independence: 0.3, openness: 0.3 } }), CTX({ lv: 4 }), QUIET],
];
let reachOk = true;
const reachDetail = [];
for (const [want, st, cx, u] of cases) {
  const got = C.sfType(st, cx, u);
  if (got !== want) { reachOk = false; reachDetail.push(`${want} → ${got}`); }
}

/* ---------- ② AC-3.6 反例扫描：平静对话 × 当日无冲突 ⇒ repair 命中=0 ---------- */
let repairHits = 0, scanTotal = 0;
const UES = ["neutral", "joy", "sad", "tired", "angry", "affection"];
for (const sec of [0.45, 0.47, 0.48, 0.49, 0.499]) {
  for (const ind of [0.3, 0.5, 0.7, 0.9]) {
    for (const opn of [0.3, 0.5, 0.7, 0.9]) {
      for (const lv of [4, 5, 6]) {
        for (const ue of UES) {
          const st = base({ self: { security: sec, openness: opn, independence: ind }, negGate: { date: "x", count: 0, lastByFamily: {}, streak: 0 } });
          scanTotal++;
          if (C.sfType(st, CTX({ lv, ue: { type: ue } }), QUIET) === "repair") repairHits++;
        }
      }
    }
  }
}

/* ---------- ③ H15 占比复核：单 key "sf" + repair 单类占比受控 ---------- */
const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
const singleKey = !/["']sf[1-4]["']/.test(src) && src.indexOf('cd.push(["sf"') >= 0;

// repair 触发窗口窄（仅 security<.5 ∧ 极性>=0 ∧ 当日冲突），随机矩阵下占比应远低于 50%
let sfTotal = 0, repairShare = 0;
for (let i = 0; i < 2000; i++) {
  const st = base({
    self: { security: 0.45 + (i % 11) * 0.03, independence: 0.3 + (i % 7) * 0.08, openness: 0.3 + (i % 5) * 0.12 },
    negGate: { date: "x", count: (i % 3 === 0) ? 1 : 0, lastByFamily: {}, streak: 0 },
  });
  const t = C.sfType(st, CTX({ lv: 3 + (i % 4), ue: { type: UES[i % UES.length] } }), (i % 2) ? LONG : QUIET);
  if (t === "repair") { repairShare++; sfTotal++; }
  else if (t === "boundary" || t === "challenge" || t === "expand" || t === "stable") sfTotal++;
}
const repairRatio = sfTotal ? repairShare / sfTotal : 0;
const ratioOk = repairRatio <= 0.5;

const ALL_OK = reachOk && repairHits === 0 && singleKey && ratioOk;

console.log("=== repair 路由启用 · QA 独立探针（v22）===");
console.log(`五型可达性:   ${reachOk ? "OK" : "FAIL " + JSON.stringify(reachDetail)}`);
console.log(`AC-3.6 平静对话冒道歉: ${repairHits}/${scanTotal}  ${repairHits === 0 ? "OK" : "FAIL"}`);
console.log(`H15 单 key "sf": ${singleKey ? "OK" : "FAIL"}`);
console.log(`H15 repair 单类占比: ${(repairRatio * 100).toFixed(1)}% (≤50%)  ${ratioOk ? "OK" : "FAIL"}`);
console.log(`\nrepair 路由结论: ${ALL_OK ? "PASS" : "FAIL"}`);

process.exitCode = ALL_OK ? 0 : 1;
