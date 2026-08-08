"use strict";
/* 差分断言基线 · 单一真源（DESIGN-v15 §7 S-4 / §1.3）
 *
 * 【为什么有这个文件】
 * v14 收口后出现 7 条「自失效红」—— 根因不是行为回归，而是 4 个测试文件各自
 * 硬编码 `HEAD` 当差分基线。HEAD 从 `b86a386`（v14 收口）前移到 `6723a20`
 * （两个 .gitignore commit）之后：
 *   · V-92 反证：想取「v13 旧表」，实际取到 v14 新表 → 漏网 0 < 60 → 红
 *   · C0-b    ：想证「sw 领先 HEAD」，而 HEAD 已含 v19 → 不领先   → 红
 *   · A1-c    ：想证「engine 相对 HEAD 只改白名单行」，HEAD 已含改动 → 红
 * 把基线提升为单一真源后，以后再重置基线**只改本文件一行**。
 *
 * 【口径】
 *   BASE = v14 收口 commit —— 「当前版（v15）差分基准」，回答"本期改了什么"
 *   PREV = v13 收口 commit —— 「旧表反证基准」，回答"上一期修的缺陷当时真的存在吗"
 *
 * 【纪律 S-4】禁止任何测试文件再出现字面量 `"HEAD:ai-girlfriend/..."`。
 * 本文件不计入体积预算（S-9：totalMax 只统计 engine.js + 四模块）。
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/* git 仓库根（本工程位于 <repo>/ai-girlfriend/），git show 的路径必须自根起算 */
const REPO = path.resolve(__dirname, "..", "..");
const PKG = "ai-girlfriend";

/* ★基线前移只改这一行★ */
const BASE = "b86a386";      // v14 收口：G7 有棱角 / G8 有自我 / G9 无破绽 + sw v19
const PREV = BASE + "^";     // v13 收口：eb21332（"旧表"反证基准）

/* 取某个 commit 上某个工程内相对路径的文件全文。
 * maxBuffer 放到 64MB —— engine.js 单文件已 240KB+，默认 1MB 在拼接场景下不够用。 */
function showAt(commit, rel) {
  return execFileSync("git", ["show", `${commit}:${PKG}/${rel}`],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
}

/* 相对某个 commit 的工作区 numstat（"增\t删\t路径"，无差异时为空串）。 */
function numstatAt(commit, rel) {
  return execFileSync("git", ["diff", "--numstat", commit, "--", `${PKG}/${rel}`],
    { cwd: REPO, encoding: "utf8", maxBuffer: 8 << 20 }).trim();
}

module.exports = { REPO, PKG, BASE, PREV, showAt, numstatAt };
