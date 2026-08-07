"use strict";
/* 护栏接线扫描器（v12 · 第 3 轮引入）
 *
 * 起因：三轮验收里连续出现三次同一类缺陷 ——
 *   D1  negMark() 返回值被丢弃 → 计数器永远回不到 state，读侧 100% 拦截、写侧 0%；
 *   D3  negClampDv() 零调用点  → 冲量地板写好了但没人调，angry_words 照样冲到 -0.64；
 *   N4  ACCUSE_RE 零调用点     → 出口黑名单只挂了 GUILT_TRIP_RE，文档承诺的那一半不存在。
 *
 * 三次的共同根因不是粗心，而是**自检的口径错了**：所有单测都在验证"函数自己算得对不对"，
 * 没有任何一条在验证"这个函数有没有被人调用"。一个定义正确却无人调用的护栏，
 * 单测永远绿，线上永远不生效 —— 这是自检的结构性盲区，只能用结构性断言补。
 *
 * 本模块只做一件事：把 engine.js 当**文本**扫一遍，对每个符号回答
 *   "除了定义处、注释、导出清单之外，它还在别处出现过吗？"
 * 出现过 = 已接线；没有 = 悬空。刻意不做 AST 解析：AST 会把导出清单里的
 * `{ negMark }` 也算成引用，正好漏掉我们要抓的那一类；纯文本反而更严。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENGINE_PATH = path.join(ROOT, "engine.js");
/* 消费方（宿主）。engine.js 是**库**，"有没有接线"必须连宿主一起看：
 * negMinDv / negAfterTurn / dayLifeGen 在 engine 内部零调用点是正常的 —— 它们本就由 app.js 调。
 * 只扫 engine 自己会把这三个误报成悬空，只扫宿主又抓不到 ACCUSE_RE 那种引擎内部该自用的。
 * 刻意**不含 test/**：测试调用不算接线，否则 D3「写了单测但没人调」那次就又漏了。 */
const HOST_FILES = ["app.js", "openclaw.js", "server.js", "localmodel.js",
  "schedule.js", "notify.js", "caption.js", path.join("bridge", "xiaonuan-bridge.js")];

/* ---------- 1. 剥注释 ----------
 * 块注释直接删。行注释要小心：正则字面量 /(a|b)/ 里没有 //，但字符串里可能有（如 URL）。
 * 折中判据：`//` 之前的引号必须成对出现（不在字符串里），且前一个字符不是 `:`（协议头）。
 * 对自家源码足够可靠，且判错方向是"少删注释"= 多算引用 = 漏报，不会误报冤枉人。 */
function stripComments(src) {
  // 用等量换行替换块注释，保持行号与原文件一致 —— 报告里的"调用点在第几行"必须能直接跳过去。
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length));
  return noBlock.split("\n").map((line) => {
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] !== "/" || line[i + 1] !== "/") continue;
      if (i > 0 && line[i - 1] === ":") continue;          // http:// 之类
      const head = line.slice(0, i);
      const q = (ch) => (head.split(ch).length - 1) % 2 === 0;
      if (q('"') && q("'") && q("`")) return head;          // 引号都成对 → 确实是注释
    }
    return line;
  }).join("\n");
}

/* ---------- 2. 摘出导出清单 ----------
 * 顶层 IIFE 末尾的 `return { ... };`。清单里的裸名字是"对外 API 声明"，不是运行时调用，
 * 必须从引用计数里排除 —— 否则每个符号都至少有 1 次引用，扫描器等于没写。 */
function splitExports(src) {
  // 必须取**最后一个**顶层 return {...}：函数体内的 `return { n, mean }` 之类比比皆是，
  // 匹配到任意一个都会让真正的导出清单留在 body 里，清单里的裸名字随即被当成调用点 ——
  // 那正是本扫描器要抓的伪装，扫描器自己踩进去就等于全绿造假（WR-03 反测这一点）。
  // 闭合行的缩进必须与 return 行相同，避免吞掉半个文件。
  const re = /\n([ \t]*)return \{[\s\S]*?\n\1\};/g;
  let m = null, last = null;
  while ((m = re.exec(src)) !== null) last = m;
  if (!last) last = src.match(/\n[ \t]*return \{[^\n]*\};/);   // 单行清单（测试夹具）
  if (!last) return { body: src, exports: "" };
  const cut = last[0].replace(/[^\n]/g, "");                    // 用等量换行占位，保住行号
  return { body: src.slice(0, last.index) + cut + src.slice(last.index + last[0].length), exports: last[0] };
}

/* ---------- 3. 收集顶层定义 ---------- */
function collectDefs(body) {
  const defs = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    let m = line.match(/^\s*const ([A-Za-z_$][\w$]*) = (\/(?![/*])|new RegExp)/);
    if (m) { defs.push({ name: m[1], kind: "regex", line: i + 1 }); return; }
    m = line.match(/^\s*function ([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { defs.push({ name: m[1], kind: "function", line: i + 1 }); return; }
    m = line.match(/^\s*const ([A-Za-z_$][\w$]*) = (?:\([^)]*\)|[A-Za-z_$][\w$]*) =>/);
    if (m) defs.push({ name: m[1], kind: "function", line: i + 1 });
  });
  // 同名重复定义（不同作用域）只留第一处，避免一个符号被算成两个悬空
  const seen = new Set();
  return defs.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
}

/* ---------- 4. 统计运行时引用点 ----------
 * 逐行扫，跳过定义行本身。用词边界匹配，避免 negMark 命中 negMarkFoo。 */
function callSites(body, def) {
  const re = new RegExp("(?<![\\w$])" + def.name.replace(/\$/g, "\\$") + "(?![\\w$])");
  const out = [];
  body.split("\n").forEach((line, i) => {
    if (i + 1 === def.line) return;                  // 定义行不算引用
    if (re.test(line)) out.push(i + 1);
  });
  return out;
}

/* ---------- 5. 护栏符号判定 ----------
 * 哪些符号"必须有运行时调用点"？口径取**保守但覆盖已发生的三次事故**：
 *   ① 所有 *_RE 正则表：正则的存在意义就是被 test()，定义了不调用一定是漏接线；
 *   ② 闸门/护栏函数：G1 neg* / G2 jealous* / G3 dayLife* / Inner inner* / 出口 *Guard。
 * 纯数据表（LIB / POOL / 文案池）与工具函数不在内，它们被"引用"而非"调用"，另有覆盖。 */
const GUARD_FN_RE = /^(neg|jealous|inner|dayLife|life)[A-Z]|Guard$|^guard/;
function isGuard(def) {
  if (def.kind === "regex") return /_RE$/.test(def.name);
  return GUARD_FN_RE.test(def.name);
}

/* ---------- 6. 白名单 ----------
 * 只允许两类豁免，且每条都要写清理由：
 *   · 构造期/测试期自检工具：本就只在测试里调用（innerScan / lifePlaceScan）；
 *   · 纯对外 API：宿主调用而非引擎内部调用，引擎内零调用点属正常。
 * 白名单必须显式列举，不许写通配 —— 否则下一个漏接线的护栏又会被悄悄放行。 */
const ALLOW = {
  innerScan: "构造期自检工具：全量扫 INNER_LIB 是否越界，由测试与构建期调用，运行时本就不该跑",
  lifePlaceScan: "同上，D8 引入的 LIFE_PLACE 自检工具",
};

/* 宿主侧引用：只要在任一宿主文件里出现（非注释），就算已接线 */
function hostSites(name) {
  const re = new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])");
  const out = [];
  for (const rel of HOST_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    stripComments(fs.readFileSync(p, "utf8")).split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(rel + ":" + (i + 1));
    });
  }
  return out;
}

function scan(src) {
  const clean = stripComments(src || fs.readFileSync(ENGINE_PATH, "utf8"));
  const { body } = splitExports(clean);
  const defs = collectDefs(body);
  const rows = defs.map((d) => {
    const inner = callSites(body, d);
    const host = inner.length ? [] : hostSites(d.name);   // 引擎内有调用就不必再翻宿主
    return {
      name: d.name, kind: d.kind, def: d.line,
      sites: inner, host,
      wired: inner.length > 0 || host.length > 0,
      where: inner.length ? "engine" : (host.length ? "host" : "—"),
      guard: isGuard(d),
    };
  });
  const dangling = rows.filter((r) => r.guard && !r.wired && !ALLOW[r.name]);
  return { rows, dangling, guards: rows.filter((r) => r.guard) };
}

module.exports = { scan, stripComments, splitExports, collectDefs, callSites, isGuard, ALLOW, ENGINE_PATH };
