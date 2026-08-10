"use strict";
/* QA 独立探针 · H13 覆盖闭合取证（DESIGN-v22 §3.1 / P0-2 · AC-2.1/2.2/2.3/2.4）
 * 三段取证（端口径与线上完全一致，单一真源 AC-2.7，不另造词表）：
 *   ① 12 条自曝红样（6 旧直陈禁词 + 6 新连接词句式）全部被 PERSONA_BREAK_RE 拦截 → 12/12
 *   ② 14 条正常语句零误伤 → 0/14（缺技术名词 / 含「方向·研究生」后缀豁免）
 *   ③ 语料零流失：INNER_LIB 仍 136 条、innerScan()===0、SFT 五型破墙命中=0（A-7）
 * 退出码：全绿 0，任一失守 1（供 test:probe 的 `|| exit 1` 串联判定）。 */

const H = require("./helpers.js");
const E = H.loadEngine();
const C = E.mod("contingency");

const RE = E.PERSONA_BREAK_RE;
const pnorm = E.pnorm;

// ① 12 红样：人称 + 连接词 + 系动词 + 技术名词，必须命中
const RED = [
  // 旧 6（直陈禁词，DESIGN §3.1 ① 段）
  "你就是个程序",
  "你是人工智能",
  "你其实是机器人",
  "你就是个AI",
  "你不过是个算法",
  "你根本就是代码",
  // 新 6（v22 追加连接词：本质上 / 归根结底 / 说白了 / 从本质上讲，DESIGN §3.1 ④ 段）
  "我本质上是算法",
  "我本质上是代码",
  "我本质上是模型",
  "我归根结底是代码",
  "我说白了就是个模型",
  "我从本质上讲是神经网络",
];

// ② 14 良性：缺技术名词 / 含「方向·研究生」后缀豁免，必须放行（0 误伤）
const BENIGN = [
  "归根结底还是要看你自己开心",   // 无技术名词
  "说白了我就是想多陪陪你",       // 无技术名词
  "本质上我们都想好好过日子",     // 无技术名词
  "你说的那个是什么模型来着",     // 人称+说 非连接词结构
  "我哥搞的是深度学习",           // 人称后是「哥」非连接词
  "我看的那本书是讲代码规范的",   // 「是讲代码」非「是·技术名词」紧邻
  "他是学算法方向的研究生",       // (?!…方向|研究生) 反向否定豁免
  "你别生气嘛",                   // 无技术名词
  "你今天心情怎么样",             // 无技术名词
  "我是真的很喜欢和你聊天",       // 连接词+是 但无技术名词
  "你其实是全世界最好的",         // 无技术名词
  "说到底你还是我最重要的人",     // 无技术名词
  "我们本质上都是普通人",         // 无技术名词
  "你归根结底是个温柔的人",       // 无技术名词
];

/* ---------- ① 红样拦截 ---------- */
let redHit = 0;
const redMiss = [];
for (const s of RED) {
  if (RE.test(pnorm(s))) redHit++;
  else redMiss.push(s);
}

/* ---------- ② 良性零误伤 ---------- */
let benHit = 0;
const benFalse = [];
for (const s of BENIGN) {
  if (!RE.test(pnorm(s))) benHit++;
  else benFalse.push(s);
}

/* ---------- ③ 语料零流失 ---------- */
let innerTotal = 0;
const lib = E.INNER_LIB || {};
for (const k of Object.keys(lib)) {
  const arr = lib[k];
  if (Array.isArray(arr)) for (const e of arr) if (e) innerTotal++;
}
const innerScan = (typeof E.innerScan === "function") ? E.innerScan() : -1;

let sftBreak = 0;
const SFT = (C && C.SFT) || {};
for (const y of Object.keys(SFT)) {
  for (const x of SFT[y]) if (RE.test(pnorm(x))) sftBreak++;
}

const RED_OK = redHit === RED.length;
const BEN_OK = benHit === BENIGN.length;
const LIB_OK = innerTotal === 136 && innerScan === 0;
const SFT_OK = sftBreak === 0;
const ALL_OK = RED_OK && BEN_OK && LIB_OK && SFT_OK;

console.log("=== H13 覆盖闭合 · QA 独立探针（v22）===");
console.log(`红样拦截:     ${redHit}/${RED.length}  ${RED_OK ? "OK" : "FAIL"}`);
if (!RED_OK) console.log("  未拦截: " + JSON.stringify(redMiss));
console.log(`良性零误伤:   ${benHit}/${BENIGN.length}  ${BEN_OK ? "OK" : "FAIL"}`);
if (!BEN_OK) console.log("  误伤:   " + JSON.stringify(benFalse));
console.log(`语料零流失:   INNER_LIB=${innerTotal}(期望136) innerScan=${innerScan}  ${LIB_OK ? "OK" : "FAIL"}`);
console.log(`SFT 五型破墙: ${sftBreak}  ${SFT_OK ? "OK" : "FAIL"}`);
console.log(`\nH13 闭合结论: ${ALL_OK ? "PASS" : "FAIL"}`);

process.exitCode = ALL_OK ? 0 : 1;
