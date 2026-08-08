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

/* ================= v13 · 装载拓扑与体积（S0-g） =================
 * 沿用本文件的同一套哲学：不验证"模块算得对不对"，验证"模块会不会被装进来"。
 * 一个写得完美但 index.html 没写 <script>、或 sw.js 没进 ASSETS 的模块，
 * 在 Node 测试里全绿（helpers 走 engine.files.json 拼接），在浏览器里恒缺席。
 * 两条装载路径必须交叉校验，任何一条漏了都是"线上不生效"。 */

const MANIFEST_PATH = path.join(ROOT, "engine.files.json");

/* 体积配额（DESIGN §11 锁定）。engine.js 只放薄接线，语料/算法必须待在模块里；
 * 配额写死在这里而不是从文件读，是为了让"改配额"这件事必须走代码评审。
 * 审批记录：
 *   · v13 T2+T4 配额修正轮：memory 8192→12288 / texture 4096→4608 / moduleSum 16384→20480，
 *     由主理人 Qi 批准（2026-06-18）。
 *   · v13 T5a 集成修复轮：memory 12288→14336 / texture 4608→5120 / moduleSum 20480→24576，
 *     由主理人 Qi 预批（走本文件代码评审落地）。理由：T5a 五项集成修复全部落在既有模块内
 *     （待决②横向走查表挂载 / 遗留-1 职业族 tag 派生 / 遗留-2 破墙脱敏 / 遗留-4 R30 基频），
 *     engine.js 绝对零 diff，新增字节只能进模块。
 *   · v13 T5b 收尾轮：engineNetMax 2048→2060 / moduleSumMax 24576→24643 / 新增 contingency.js 1892，
 *     由主理人 Qi 预批（走本文件代码评审落地）。两项各有精确来源，不是"拍脑袋加一点"：
 *       - engineNetMax +12：A6-a 解冻 engine.js:1322（职业族折叠后再判破墙表）所需，实占 +≤56B 中的
 *         增量部分；V-33 ≤247955B 同时锁死，两把锁谁先响都算越界。
 *       - moduleSumMax = 272384 − 247741 = 24643：把"系统天花板 − 当前 engine 体积"完整让给模块侧，
 *         使 T5b 的 contingency.js 有满额 contingency 空间；天花板 totalMax 本身**一个字节都没动**。
 *     memory/presence/texture 三项配额本轮**不动** —— A6-b 的 tex.n 回写必须靠 memory.js 内部等量
 *     trim 自筹字节，不许用"顺手抬配额"绕过。 */
const SIZE_BUDGET = {
  engineBase: 245737,      // v12 收线时的 engine.js 字节数（T1 基线）
  engineNetMax: 2060,      // 改配额必须走代码评审 · 主理人 Qi 于 v13 T5b 批准 2048→2060（A6-a 解冻 :1322）
  "memory.js": 14336,      // 改配额必须走代码评审 · 主理人 Qi 于 v13 T5a 集成修复轮批准 12288→14336
  "presence.js": 4096,
  "texture.js": 5120,      // 改配额必须走代码评审 · 主理人 Qi 于 v13 T5a 集成修复轮批准 4608→5120
  "contingency.js": 1892,  // 改配额必须走代码评审 · 主理人 Qi 于 v13 T5b 批准新建（lean 档，只做 R-C1~C3）
  moduleSumMax: 24643,     // 改配额必须走代码评审 · 主理人 Qi 于 v13 T5b 批准 24576→24643 · 四模块合计
  totalMax: 272384,        // engine + 四模块 合计天花板（系统级天花板不变，T5b 新模块吃这里的余量）
};

/* 读装载清单。缺文件 → 返回 null，调用方据此判定"退化为单文件模式"。 */
function loadManifest() {
  try {
    const cfg = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return {
      order: Array.isArray(cfg.order) ? cfg.order : [],
      optional: Array.isArray(cfg.optional) ? cfg.optional : [],
    };
  } catch (e) { return null; }
}

/* 从 index.html 抠出 <script src="xxx.js"> 的顺序（只取同目录相对路径，忽略 CDN/绝对 URL）。 */
function htmlScripts() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const s = m[1].trim();
    if (/^(https?:)?\/\//.test(s) || s.startsWith("/")) continue;
    out.push(s.replace(/^\.\//, ""));
  }
  return out;
}

/* 从 sw.js 抠出 CACHE 版本号与 ASSETS 清单（纯文本，不执行 SW 代码）。 */
function swManifest() {
  const src = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const mv = src.match(/const\s+CACHE\s*=\s*["']xiaonuan-v(\d+)["']/);
  const ma = src.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/);
  const assets = [];
  if (ma) {
    const re = /["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(ma[1]))) assets.push(m[1]);
  }
  return { version: mv ? parseInt(mv[1], 10) : -1, assets };
}

/* WR-13 的取证主体：把「清单 / HTML / sw」三方对齐结果算成一张表。 */
function scanLoaders() {
  const man = loadManifest();
  const scripts = htmlScripts();
  const sw = swManifest();
  const order = man ? man.order : [];
  const modules = order.filter((f) => f !== "engine.js");
  return {
    manifest: man,
    scripts,
    sw,
    modules,
    // 清单里声明的每个文件都得真的存在（否则浏览器 404、Node 静默跳过 → 半更新态）
    missingFiles: order.filter((f) => !fs.existsSync(path.join(ROOT, f))),
    // HTML 里必须按清单顺序出现（子序列比对：允许 localmodel/app 等夹在后面）
    htmlOrder: scripts.filter((s) => order.includes(s)),
    // sw ASSETS 必须逐个覆盖（带 "/" 前缀）
    missingAssets: order.filter((f) => !sw.assets.includes("/" + f)),
  };
}

/* V-90 的取证主体：逐文件字节数 + 三层配额判定。 */
function scanSizes() {
  const sizeOf = (f) => {
    const p = path.join(ROOT, f);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  };
  /* Tier2 的 contingency.js 是 optional：不存在时 sizeOf 返 0，既不进 over 也不撑 moduleSum，
   * 于是"未交付"与"交付且达标"两种状态都判绿 —— 与 engine.files.json 的 optional 语义一致。 */
  const mods = ["memory.js", "presence.js", "texture.js", "contingency.js"];
  const each = {};
  for (const f of mods) each[f] = sizeOf(f);
  const engine = sizeOf("engine.js");
  const moduleSum = mods.reduce((a, f) => a + each[f], 0);
  return {
    each,
    engine,
    engineNet: engine - SIZE_BUDGET.engineBase,
    moduleSum,
    total: engine + moduleSum,
    over: mods.filter((f) => each[f] > SIZE_BUDGET[f]),
  };
}

module.exports = {
  scan, stripComments, splitExports, collectDefs, callSites, isGuard, ALLOW, ENGINE_PATH,
  MANIFEST_PATH, SIZE_BUDGET, loadManifest, htmlScripts, swManifest, scanLoaders, scanSizes,
};
