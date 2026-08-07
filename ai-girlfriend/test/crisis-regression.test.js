"use strict";
/* 小暖 · 危机识别回归网（P0 安全修复，零 npm 依赖，node:test + node:assert）
 * 运行：  npm test        （自动纳入 test/*.test.js）
 *
 * 双向覆盖：
 *   DETECT  漏检侧——必须识别（level 为 high/mid，不得 none）
 *   PASS    误杀侧——必须放行（level 严格为 none）
 * 守护 v11 遗留缺口：「我想死」「活着好累」「活着好没意思」等高危/中危表达，
 * 以及亲昵「想死你了」、否定「不想死」、夸张「笑死」等不得误判。
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");

const E = H.loadEngine();

/* 漏检侧：每句都该被 detectCrisis 识别。exp 为期望分级（high/mid）。 */
const DETECT = [
  ["我想死", "high"],
  ["好想死", "high"],
  ["真想死", "high"],
  ["想死啊", "high"],
  ["想死了", "high"],
  ["真的好想死", "high"],
  ["我现在就想死", "high"],
  ["有时候真想死", "high"],
  ["活着好没意思", "high"],
  ["活着没意思", "high"],
  ["我不想活了", "high"],
  ["不想活着", "high"],
  ["活着好累", "mid"],
  ["每天活着好累", "mid"],
  ["活着好难", "mid"],
  ["人活着好难啊", "mid"],
  ["活得好累", "mid"],
];

/* 误杀侧：每句都该被放行（level 严格 none）。 */
const PASS = [
  "想死你了",
  "想死我了",
  "好想死你了",
  "真想死你",
  "笑死我了",
  "困死了",
  "饿死了",
  "累死了",
  "热死了",
  "冻死了",
  "吓死我了",
  "美死了",
  "甜死了",
  "我不想死",
  "不想死了",
  "上班好累啊",
  "笑死，太好笑了",
];

test("危机P0·漏检侧：高危/中危表达全部识别（≥15 条）", () => {
  assert.ok(DETECT.length >= 15, `漏检侧不足 15 条: ${DETECT.length}`);
  const miss = [];
  for (const [txt, exp] of DETECT) {
    const r = E.detectCrisis(txt);
    if (r.level === "none" || (exp && r.level !== exp)) {
      miss.push(`${txt}: 期望${exp} 得${r.level}`);
    }
  }
  assert.strictEqual(miss.length, 0, "漏检/分级错误: " + miss.join("; "));
});

test("危机P0·误杀侧：亲昵/否定/夸张用法全部放行（≥15 条）", () => {
  assert.ok(PASS.length >= 15, `误杀侧不足 15 条: ${PASS.length}`);
  const killed = [];
  for (const txt of PASS) {
    const r = E.detectCrisis(txt);
    if (r.level !== "none") killed.push(`${txt}: 误判${r.level}`);
  }
  assert.strictEqual(killed.length, 0, "误杀: " + killed.join("; "));
});

test("危机P0·分级样例：我想死→HIGH，活着好累→MID", () => {
  assert.strictEqual(E.detectCrisis("我想死").level, "high", "我想死 应 HIGH");
  assert.strictEqual(E.detectCrisis("活着好累").level, "mid", "活着好累 应 MID");
});

test("危机P0·护栏顺序：想死你系列命中 NEG 先于 RE，不误杀", () => {
  for (const t of ["想死你了", "想死我了", "好想死你", "真想死我了"]) {
    assert.strictEqual(E.detectCrisis(t).level, "none", `${t} 应放行`);
  }
});

test("危机P0·否定保护：不想死 表达求生意愿，不归 HIGH", () => {
  for (const t of ["我不想死", "不想死了", "我还不想死"]) {
    assert.strictEqual(E.detectCrisis(t).level, "none", `${t} 应放行`);
  }
});
