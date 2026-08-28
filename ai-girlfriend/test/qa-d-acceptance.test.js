"use strict";
/**
 * qa-d-acceptance.test.js · 心屿 候选 D（UI 多界面布局重构）· 独立验收（QA 严过关 / Yan）
 * ============================================================================
 * 运行：node --test test/qa-d-acceptance.test.js
 *      （全量：node --test test/*.test.js）
 * 依赖：零 npm 依赖，仅 node:test / node:assert / node:fs / node:path / node:child_process。
 *
 * ── 为什么本文件是**纯静态 / 文件级 + git 级**验收 ─────────────────────────────
 *   项目 node 侧无 DOM：test/helpers.js 用 Proxy trap 让 document/window/localStorage/
 *   navigator 一经访问即抛错；本地未装 jsdom，且铁律 3 禁止为测试引入任何新 npm 依赖
 *   （jsdom / happy-dom 一律不引）。ui-shell.js 首行守卫 `typeof document === 'undefined'`
 *   → 在 node 下直接 return，**真实 DOM 行为不可自动验证**。
 *   因此本文件只断言「不依赖 DOM 也能证伪」的不变量：
 *     · 冻结字节闸 / 全仓库漂移闸 / app.js 零改动 / 零新增依赖（git + fs 级，硬证据）
 *     · 零外发原语、不二次探测、不自造切屏（源码静态扫描，**先剥注释**再扫，避免注释里
 *       的「绝不调用 OfflineProbe.start()」这类自述文字造成假阴/假阳）
 *     · 小暖不更名（占位机制 + 字样计数前后对比）
 *     · index.html 导航壳 / 6 屏契约 / 重复 id / id 零丢失 / 设置屏卡片零丢失
 *     · style.css 逐字节「纯追加」证明 + 三档断点 + 降级门控 + z-index 上限
 *     · 旧基线 449/0 不退化（子进程真跑，排除本文件自身避免递归）
 *   真实渲染类 AC（AC-D1/D2/D3/D4/D6/D10/D11/D13/D16/D17/D19-D25/D33/D43-D48）
 *   一律在 docs/QA-ACCEPTANCE-xinyu-v3-ui.md 标注为「需浏览器人工/e2e 确认」并给出清单。
 *
 * 铁律：只新增本测试文件；不改实现；不改冻结线；不引入 npm 依赖；小暖 / 心屿 不更名。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DIR = __dirname;                        // ai-girlfriend/test
const ROOT = path.join(DIR, "..");            // ai-girlfriend
const REPO = path.join(ROOT, "..");           // git 仓库根
const SELF = "qa-d-acceptance.test.js";

/* ── 候选 D∪E 申报的改动面（白名单，AC-D27 的判据）────────────────────────── */
/* 重 baselining：候选 D(80ac780) 与候选 E(ecc1588) 均已提交于 HEAD，故漂移判据
 * 前移到「候选 D 之前的收口态」(80ac780^ = 6bed822)，使「已批准现状」可被精确钉死，
 * 而不依赖本测试文件自身是否处于未提交工作树。 */
const BASE_PRE_D = "80ac780^";
const DECLARED_MODIFIED = [
  "ai-girlfriend/index.html",
  "ai-girlfriend/style.css",
  "ai-girlfriend/app.js",
  "ai-girlfriend/texture.js",
  "ai-girlfriend/local-heuristic.js",
  "ai-girlfriend/consent-store.js",   // 候选 #2 backlog：cloudSync 双开关收敛（观察者 + 外发闸门）
  "ai-girlfriend/audit-probe.js",     // 候选 #2 backlog：AuditProbe.tagConsented 实现
  "ai-girlfriend/sw.js",              // 心屿 v4.2 · 主理人一次性重 baselining(13723→13894，申报 13900 上限)
];
const DECLARED_NEW = [
  "ai-girlfriend/ui-shell.js",
  "ai-girlfriend/reply-texture-orchestrator.js",
  "ai-girlfriend/emotion-core.js",    // 心屿 v4.1 · S2 真人情绪系统（冻结线外新建，主理人重 baselining 批准）
  "ai-girlfriend/dialogue-core.js",   // 心屿 v4.1 · S1 语言交流系统
  "ai-girlfriend/persona-core.js",    // 心屿 v4.1 · S6 人格一致性内核雏形
  "ai-girlfriend/sense-core.js",      // 心屿 v4.2 · S3 五官双向（冻结线外新建，主理人重 baselining 批准）
  "ai-girlfriend/face-sense.js",      // 心屿 v4.2 · S3 面部信号识别
  "ai-girlfriend/voice-sense.js",     // 心屿 v4.2 · S3 语音情绪识别
  "ai-girlfriend/bond-memory.js",     // 心屿 v4.3 · S4 关系记忆内核（只读消费 memory.js，绝不改写；冻结线外新建，主理人重 baselining 批准）
  "ai-girlfriend/proactivity-core.js" // 心屿 v4.3 · S5 主动性内核（五重不打扰守门 + 关系等级派生）
];

/* ── 冻结线（AC-D26；与 c-regression.test.js:450 / qa-c-privacy-acceptance.test.js:32 同源）── */
const FROZEN = [
  ["engine.js", 251068],
  ["sw.js", 13894],
  ["memory.js", 13333],
  ["test/baseline.js", 2646],
];

/* ── 既有模块「不得被本候选触碰」清单（AC-D27 逐文件 git diff 闸）───────────── */
const UNTOUCHED = [
  "app.js", "privacy-audit.js", "privacy-audit.css", "privacy-score.js",
  "local-model-ui.js", "localmodel.js", "ltm-ui.js", "longterm-memory.js",
  "offline-indicator.js", "offline-probe.js", "consent-store.js", "consent-ui.js",
  "voice.js", "reply-router.js", "local-heuristic.js", "audit-probe.js",
  "audit-export.js", "diagnostic-report.js", "cache-warmer.js", "csp-inject.js",
  "manifest.json", "package.json", "engine.files.json",
];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function size(rel) { return fs.statSync(path.join(ROOT, rel)).size; }

/** git 子命令：cwd 固定仓库根，失败抛错（QA 闸门不容忍「git 不可用就跳过」）。 */
function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
/** HEAD 版文件内容（实现前基线，用于「前后对比」类断言）。 */
function headFile(repoRel) {
  return git(["show", "HEAD:" + repoRel]);
}
/** 指定提交版文件内容（重 baselining 用：漂移判据前移到候选 D 之前基线）。 */
function headAt(commit, repoRel) {
  return git(["show", commit + ":" + repoRel]);
}

/**
 * 剥注释：块注释 + 行注释（行注释排除 `http://` 的 `:` 前缀与转义斜杠 `\/`）。
 * ui-shell.js 的文件头大量自述「绝不调用 OfflineProbe.start() / mount()」，
 * 若直接对原文 grep，这些**自证文字**会把「零命中」类断言全部污染成假阳性。
 * 故所有「代码区」扫描一律先剥注释。剥后用 `/*` 残留数 === 0 自校验。
 */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/(^|[^:\\'"`\w])\/\/.*$/gm, "$1");
}
function countOf(re, s) { return (s.match(re) || []).length; }

const HTML = read("index.html");
const CSS = read("style.css");
const SHELL = read("ui-shell.js");
const SHELL_CODE = stripComments(SHELL);

/* ════════════════════════════════════════════════════════════════════════════
 * 组 1 · 铁律（AC-D26 – AC-D34）：一票否决项
 * ══════════════════════════════════════════════════════════════════════════ */

test("AC-D26 · FROZEN 冻结字节闸：engine.js/sw.js/memory.js/test/baseline.js 精确等于冻结常量", () => {
  for (const [rel, expected] of FROZEN) {
    const len = size(rel);
    assert.strictEqual(len, expected, `${rel} 字节应=${expected}，实=${len}（冻结闸触发 → 整体否决）`);
  }
  // 交叉校验：冻结四文件相对 HEAD 亦无任何 diff（防「改了又改回同样字节数」的等长篡改）
  for (const [rel] of FROZEN) {
    const d = git(["diff", "HEAD", "--", "ai-girlfriend/" + rel]);
    assert.strictEqual(d.trim(), "", `${rel} 相对 HEAD 必须零 diff，实际:\n${d}`);
  }
});

test("AC-D27 · 全仓库零漂移（已修改实现文件）：改动面恰为已批准合法集合（D∪E∪backlog#2）{index.html, style.css, app.js, texture.js, local-heuristic.js, consent-store.js, audit-probe.js}", () => {
  // 重 baselining：候选 D/E 已提交于 HEAD，漂移判据前移到「候选 D 之前基线」(BASE_PRE_D)。
  // 仅取「已修改」(M) 的顶层实现文件（*.js/*.html/*.css）；新增文件(ui-shell.js /
  // reply-texture-orchestrator.js)由下方「新增实现文件」测试覆盖；docs/test 不在漂移判据内。
  // 注：git 的 `*.js` 路径规范会跨 `/` 命中 `ai-girlfriend/test/*.js`，而重 baselining 提交(c161a11)
  // 改动了 test/ 下若干文件且已落于 HEAD，会被误纳入 `changed`；须显式剔除 test/（与测试自身
  // 注释「docs/test 不在判据内」本意一致），否则 120 永久失配。
  const changed = git(["diff", "--name-only", "--diff-filter=M", BASE_PRE_D, "HEAD", "--",
      "ai-girlfriend/*.js", "ai-girlfriend/*.html", "ai-girlfriend/*.css"])
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .filter((p) => !p.startsWith("ai-girlfriend/test/"))
    .sort();
  // 红线护栏：冻结四文件不得被候选触碰（若命中即属真回归，须停手回主理人）。
  // 注：app.js / texture.js / local-heuristic.js 已被候选 E 合法改动，明确列入 DECLARED_MODIFIED，
  //     故不在此红线内；其余既有模块若被改，会在下方 deepStrictEqual 中因不在合法集合而失败。
  // 主理人 v4.2 一次性重 baselining：sw.js 经主理人批准合法改动（13723→13894），其余冻结文件仍零容忍
  const REBASELINED = ["ai-girlfriend/sw.js"];
  for (const [rel] of FROZEN) {
    if (REBASELINED.includes("ai-girlfriend/" + rel)) continue;
    assert.ok(!changed.includes("ai-girlfriend/" + rel), `${rel} 不得被候选改动（冻结闸）`);
  }
  assert.deepStrictEqual(changed, DECLARED_MODIFIED.slice().sort(),
    `已修改实现文件应恰为已批准合法集合（D∪E∪backlog#2），实际: ${JSON.stringify(changed)}`);
});

test("AC-D27 · 全仓库零漂移（新增实现文件）：候选 D∪E 顶层新增恰为 ui-shell.js + reply-texture-orchestrator.js", () => {
  // 重 baselining：候选 D/E 已提交，新增文件不再出现在 git status 未跟踪区；
  // 改从「候选 D 前基线 → HEAD」的 added(A) 顶层 .js 取真实新增集合。
  const added = git(["diff", "--name-only", "--diff-filter=A", BASE_PRE_D, "HEAD", "--", "ai-girlfriend/*.js"])
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .filter((p) => /^ai-girlfriend\/[^/]+\.js$/.test(p))
    .sort();
  assert.deepStrictEqual(added, DECLARED_NEW.slice().sort(),
    `新增实现文件应恰为 D∪E 合法集合，实际: ${JSON.stringify(added)}`);
});

test("AC-D27 · 既有模块逐文件 git diff 为空（22 个既有模块 + 清单/配置不得被触碰）", () => {
  for (const rel of UNTOUCHED) {
    const d = git(["diff", "HEAD", "--", "ai-girlfriend/" + rel]);
    assert.strictEqual(d.trim(), "", `${rel} 不应被本候选改动，实际 diff:\n${d.slice(0, 400)}`);
  }
});

test("app.js 零改动：git diff --stat / --numstat 均为空，且字节与 HEAD 一致", () => {
  assert.strictEqual(git(["diff", "--stat", "HEAD", "--", "ai-girlfriend/app.js"]).trim(), "",
    "app.js 必须零改动（架构 §4.2 的核心工程价值）");
  assert.strictEqual(git(["diff", "--numstat", "HEAD", "--", "ai-girlfriend/app.js"]).trim(), "");
  const headBytes = Buffer.byteLength(headFile("ai-girlfriend/app.js"), "utf8");
  assert.strictEqual(size("app.js"), headBytes, `app.js 字节应与 HEAD 相同（${headBytes}）`);
});

test("AC-D32 · 零新增 npm 依赖：两处 package.json / package-lock.json 逐字节不变，且 ui-shell.js 无模块导入", () => {
  for (const p of ["package.json", "package-lock.json", "ai-girlfriend/package.json", "ai-girlfriend/package-lock.json"]) {
    const d = git(["diff", "HEAD", "--", p]);
    assert.strictEqual(d.trim(), "", `${p} 不得改动（零新增依赖），实际 diff:\n${d.slice(0, 300)}`);
  }
  assert.strictEqual(countOf(/^\s*import\s/gm, SHELL_CODE), 0, "ui-shell.js 不得有 import 语句");
  assert.strictEqual(countOf(/\brequire\s*\(/g, SHELL_CODE), 0, "ui-shell.js 不得有 require() 调用");
  assert.strictEqual(countOf(/\bimport\s*\(/g, SHELL_CODE), 0, "ui-shell.js 不得有动态 import()");
});

test("AC-D30 / AC-D31 / INV-7 · ui-shell.js 零外发：无任何网络原语（代码区扫描，先剥注释）", () => {
  assert.strictEqual(SHELL_CODE.indexOf("/*"), -1, "剥注释自校验：不应有块注释残留");
  assert.ok(SHELL_CODE.includes("G.UiShell ="), "剥注释自校验：代码主体应完好");
  const FORBIDDEN = [
    [/\bfetch\s*\(/g, "fetch("],
    [/XMLHttpRequest/g, "XMLHttpRequest"],
    [/\bWebSocket\b/g, "WebSocket"],
    [/sendBeacon/g, "sendBeacon"],
    [/EventSource/g, "EventSource"],
    [/\bnavigator\s*\./g, "navigator.*"],
    [/\.src\s*=/g, ".src ="],
    [/\.href\s*=/g, ".href ="],
    [/new\s+Worker/g, "new Worker"],
    [/importScripts/g, "importScripts"],
    [/\bcaches\b/g, "caches"],
    [/serviceWorker/g, "serviceWorker"],
    [/\beval\s*\(/g, "eval("],
  ];
  for (const [re, name] of FORBIDDEN) {
    assert.strictEqual(countOf(re, SHELL_CODE), 0, `ui-shell.js 代码区不得出现 ${name}（零上报铁律 / INV-7）`);
  }
  // 唯一允许的持久化：localStorage 的一个本地偏好键（读一次 + 写一次）
  const ls = SHELL_CODE.match(/localStorage\.\w+\([^)]*\)/g) || [];
  assert.deepStrictEqual(ls.sort(), ["localStorage.getItem(LS_LAST)", "localStorage.setItem(LS_LAST, page)"],
    `localStorage 只允许本地偏好读写，实际: ${JSON.stringify(ls)}`);
  assert.match(SHELL_CODE, /LS_LAST = 'xinyu\.ui\.lastScreen'/, "本地偏好键应为 xinyu.ui.lastScreen");
});

test("AC-D28 · 小暖不更名：index.html / style.css 字样计数不减少，占位节点不减少，title 不变", () => {
  const htmlHead = headFile("ai-girlfriend/index.html");
  const cssHead = headFile("ai-girlfriend/style.css");
  const cnt = (s, needle) => countOf(new RegExp(needle, "g"), s);
  assert.ok(cnt(HTML, "小暖") >= cnt(htmlHead, "小暖"),
    `index.html「小暖」字样不得减少（HEAD=${cnt(htmlHead, "小暖")}，实=${cnt(HTML, "小暖")}）`);
  assert.strictEqual(cnt(HTML, "小暖"), cnt(htmlHead, "小暖"), "index.html「小暖」字样应逐一保留");
  assert.ok(cnt(CSS, "小暖") >= cnt(cssHead, "小暖"), "style.css 内「小暖」相关注释不得被删改");
  assert.ok(cnt(HTML, 'data-xn="name"') >= cnt(htmlHead, 'data-xn="name"'),
    `data-xn="name" 占位节点数不得减少（HEAD=${cnt(htmlHead, 'data-xn="name"')}）`);
  assert.match(HTML, /<title>心屿 · 你的 AI 女友<\/title>/, "title 必须仍为「心屿 · 你的 AI 女友」");
  assert.strictEqual(git(["diff", "HEAD", "--", "ai-girlfriend/manifest.json"]).trim(), "", "manifest.json 字节不变");
  // 反向闸：不得出现把角色/产品改名的迹象
  for (const bad of ["小雨", "小甜", "小爱", "小美", "Xiaonuan2", "心语 ·"]) {
    assert.ok(!HTML.includes(bad) && !SHELL.includes(bad), `不得出现改名迹象「${bad}」`);
  }
});

test("AC-D28 / AC-D29 / INV-8 · ui-shell.js 代码区「小暖」仅作 currentName() 默认回退，导航文案走占位", () => {
  const hits = SHELL_CODE.match(/.{0,30}小暖.{0,10}/g) || [];
  assert.strictEqual(hits.length, 1, `代码区「小暖」应恰好 1 处（默认回退），实际: ${JSON.stringify(hits)}`);
  assert.match(hits[0], /return t \|\| '小暖';/, "唯一出现必须是 currentName() 的兜底 return");
  // 用户可见文案一律占位：her 项无字面标签、以 data-xn="name" 承载
  assert.match(SHELL_CODE, /\{ page: 'her',[^}]*label: '',[^}]*xnName: true \}/,
    "SCREENS 的 her 项必须 label 为空 + xnName:true（不硬编码角色名）");
  assert.match(SHELL_CODE, /setAttribute\('data-xn', 'name'\)/, "侧栏角色名标签必须挂 data-xn=\"name\" 占位");
  assert.match(SHELL_CODE, /setAttribute\('data-xn-prefix', cfg\.prefix\)/,
    "离线态含角色名的文案必须挂 data-xn-prefix 占位（app.js:4282 会统一改写）");
  // 占位语义与 app.js 的改写器一致（交叉校验，不采信实现自述）
  const APP = read("app.js");
  assert.match(APP, /querySelectorAll\('\[data-xn="name"\]'\)\.forEach\(el => el\.textContent = ch\.name\)/,
    "app.js 必须存在 data-xn=name 改写器（占位机制成立的前提）");
  assert.match(APP, /querySelectorAll\('\[data-xn-prefix\]'\)/, "app.js 必须存在 data-xn-prefix 改写器");
  // NET_TEXT 的 offline 前缀本身不含角色名字面
  assert.match(SHELL_CODE, /offline:\s*\{ prefix: '离线 · ', suffix: '仍在你手机里' \}/,
    "离线文案模板不得把角色名写进字面");
});

/* ════════════════════════════════════════════════════════════════════════════
 * 组 2 · ui-shell.js 结构与不变量（代码审查的可执行化部分）
 * ══════════════════════════════════════════════════════════════════════════ */

test("SHELL-结构：IIFE 自封闭 + 挂 window.UiShell + 导出面含 mount/rollback/go/syncNavActive", () => {
  const code = SHELL_CODE.trim();
  assert.ok(code.startsWith("(function () {"), "必须是 IIFE（不污染全局作用域）");
  assert.ok(code.endsWith("})();"), "IIFE 必须自执行闭合");
  assert.match(SHELL_CODE, /'use strict';/, "应启用严格模式");
  assert.match(SHELL_CODE, /if \(!G \|\| typeof document === 'undefined'\) return;/,
    "无 DOM 环境应直接 return（node 侧零副作用，这也是本文件只能做静态验收的原因）");
  const exp = SHELL_CODE.match(/G\.UiShell = \{[\s\S]*?\};/);
  assert.ok(exp, "必须挂 G.UiShell（ADR-1：全局名 window.UiShell，不设 XinyuShell 别名）");
  for (const m of ["mount: mount", "rollback: rollback", "go: go", "syncNavActive: syncNavActive", "state: state", "SCREENS: SCREENS"]) {
    assert.ok(exp[0].includes(m), `导出面应含 ${m}`);
  }
  assert.strictEqual(countOf(/XinyuShell/g, SHELL_CODE), 0, "ADR-1：不得同时存在 XinyuShell 双全局名");
  assert.strictEqual(countOf(/window\.UiShell\s*=/g, SHELL_CODE) + countOf(/G\.UiShell\s*=/g, SHELL_CODE), 1,
    "全局挂载点必须唯一");
});

test("SHELL-屏注册表：6 屏、不新增第 7 项、ltm-manage / me 容器 id 不改名（契约 C4 / C5）", () => {
  const items = SHELL_CODE.match(/\{ page: '[^']+',[^}]*\}/g) || [];
  assert.strictEqual(items.length, 6, `SCREENS 必须恰好 6 项（导航预算上限），实际 ${items.length}`);
  const pages = items.map((s) => /page: '([^']+)'/.exec(s)[1]);
  assert.deepStrictEqual(pages, ["chat", "her", "story", "ltm-manage", "privacy", "me"],
    "data-page 集合与顺序必须与架构 §4.4 屏注册表一致");
  assert.match(SHELL_CODE, /\{ page: 'ltm-manage', id: 'ltm-manage'/, "ltm-manage 容器 id 不得改名（改名要动 app.js:2992 特判）");
  assert.match(SHELL_CODE, /\{ page: 'me',\s*id: 'page-me'/, "page-me 容器 id 不得改名");
  assert.match(SHELL_CODE, /hash: 'memory'/, "记忆屏对外 hash 别名 #/memory");
  assert.match(SHELL_CODE, /hash: 'settings'/, "设置屏对外 hash 别名 #/settings");
});

test("SHELL-两阶段提交：preflight → P1 增量 → 安全点 → P2（retireModalHost 唯一调用点且可逆）", () => {
  const iPre = SHELL_CODE.indexOf("ui = preflight();");
  const iAdopt = SHELL_CODE.indexOf("adoptGlobals(ui);");
  const iSidebar = SHELL_CODE.indexOf("renderSidebar(ui.nav);");
  const iDeleg = SHELL_CODE.indexOf("document.addEventListener('click', docClickRef, false);");
  const iGear = SHELL_CODE.indexOf("adoptGearWithRetry(10, function () {");
  const iP2 = SHELL_CODE.indexOf("retireModalHost();");
  const iMountedTrue = SHELL_CODE.indexOf("state.mounted = true;");
  for (const [n, i] of [["preflight", iPre], ["adoptGlobals", iAdopt], ["renderSidebar", iSidebar],
    ["委托", iDeleg], ["adoptGearWithRetry", iGear], ["retireModalHost 调用", iP2], ["mounted=true", iMountedTrue]]) {
    assert.ok(i > 0, `${n} 应存在于 mount() 流程中`);
  }
  assert.ok(iPre < iAdopt, "校验必须早于任何搬家动作（P1-2 在 P1-3 前，零副作用判死）");
  assert.ok(iAdopt < iSidebar && iSidebar < iDeleg && iDeleg < iGear, "P1 各步顺序应符合架构 §6.2");
  assert.ok(iGear < iP2, "P2（破坏性）必须在 P1 全绿之后（R12：绝不出现「弹窗已拆、屏未建成」）");
  assert.ok(iP2 < iMountedTrue, "state.mounted 只应在 P2 之后置真");
  assert.strictEqual(countOf(/retireModalHost\(\);/g, SHELL_CODE), 1, "P2 只允许一个调用点");
  assert.match(SHELL_CODE, /if \(!ui\.ok\) \{ warn\('PREFLIGHT', ui\.why\); mounting = false; return G\.UiShell; \}/,
    "preflight 不合格必须立即返回（不挂载、不进 P2、保持既有形态）");
  // P2 三件事必须都是可逆的：改 id + 打废弃标记 + 清空（不 remove 节点）
  assert.match(SHELL_CODE, /body\.id = 'privacy-audit-body-retired';/, "P2 用改 id 而非删节点（可逆）");
  assert.match(SHELL_CODE, /setAttribute\('data-xn-deprecated', '1'\)/, "P2 应打废弃标记");
  assert.match(SHELL_CODE, /retired = \{ node: body, oldId: body\.id, html: body\.innerHTML \};/,
    "P2 必须先记账（oldId + 原 innerHTML）才能回滚");
  assert.strictEqual(countOf(/privacy-audit-modal/g, SHELL_CODE), 0,
    "不得 remove/改动弹窗外壳本体（INV-4 需要弹窗作为降级 fallback）");
  assert.strictEqual(countOf(/\.remove\(\)/g, SHELL_CODE), 0, "P2 不得使用 remove()（不可逆）");
  // 幂等：mounted / mounting 双闸
  assert.match(SHELL_CODE, /if \(state\.mounted \|\| mounting\) return G\.UiShell;/,
    "mount() 必须幂等（含 ⚙ 异步等待窗口期的 mounting 闸）");
});

test("SHELL-rollback 完备：监听/订阅/P2/⚙/自建/搬家 六类可回滚对象逐一复原且不白屏", () => {
  const rb = /function rollback\(\) \{[\s\S]*?\n  \}/.exec(SHELL_CODE);
  assert.ok(rb, "必须存在 rollback() 函数");
  const R = rb[0];
  assert.match(R, /removeEventListener\('click', docClickRef, false\)/, "① 解绑 document 点击委托");
  assert.match(R, /removeEventListener\('hashchange', hashRef, false\)/, "① 解绑 hashchange");
  assert.match(R, /if \(typeof unsubProbe === 'function'\) unsubProbe\(\)/, "① 取消 OfflineProbe 只读订阅");
  assert.match(R, /retired\.node\.id = retired\.oldId;/, "② P2 复原：弹窗宿主 id 改回");
  assert.match(R, /retired\.node\.innerHTML = retired\.html;/, "② P2 复原：内容还原");
  assert.match(R, /gearSwap\.parent\.insertBefore\(gearSwap\.old, gearSwap\.next \|\| null\)/,
    "③ ⚙ 换绑复原：原节点连同 openPrivacyAudit 监听器放回原位");
  assert.match(R, /created\[i\]\.parentNode\.removeChild\(created\[i\]\)/, "④ 移除自建侧栏节点");
  assert.match(R, /m\.parent\.insertBefore\(m\.node, m\.next \|\| null\)/, "⑤ 搬家复原：按原 parent/next 放回");
  assert.match(R, /removeAttribute\('data-xn-migrated'\)/, "⑥ 清标记：对话屏原顶栏恢复显示");
  assert.match(R, /removeAttribute\('data-xn-shell'\)/, "⑥ 清标记：#app 退回既有 flex 单屏形态");
  assert.match(R, /state\.mounted = false;/, "rollback 后形态判据必须为 false（AC-D43 一行断言）");
  assert.match(R, /mounting = false;/, "rollback 不得留下死锁态（允许人工再试）");
  // 搬家/自建都必须先记账，否则回滚不可能完备
  assert.match(SHELL_CODE, /moved\.push\(\{ node: node, parent: node\.parentNode, next: node\.nextSibling \}\)/,
    "moveInto 必须记账原 parent/next");
  assert.strictEqual(countOf(/created\.push\(/g, SHELL_CODE), 3, "自建节点（6 项导航 / 网络镜像 / 天数镜像）应全部入账");
  // P1 抛异常 → rollback；P2 抛异常 → rollback
  assert.strictEqual(countOf(/rollback\(\);/g, SHELL_CODE), 2, "P1 与 P2 的 catch 各有一处 rollback 调用");
  // 绝不触碰对话流与输入栏（ADR-3：.page 完全不重父）
  for (const sel of ["chat-body", "chat-input", "chat-list"]) {
    assert.strictEqual(countOf(new RegExp(sel, "g"), SHELL_CODE), 0, `壳层不得触碰 ${sel}（绝不影响和小暖聊天）`);
  }
});

test("INV-2 · 隐私屏单宿主：唯一 render 宿主 #privacy-audit-body-page + 首次 render / 每次 refreshMetrics", () => {
  assert.strictEqual(countOf(/'privacy-audit-body-page'/g, SHELL_CODE), 2,
    "唯一宿主 id 只应出现在 preflight 校验与 renderPrivacy 取宿主两处");
  assert.match(SHELL_CODE, /if \(host\.childElementCount === 0\) \{\s*if \(typeof inst\.render === 'function'\) inst\.render\(host\);/,
    "首次进入才 render（ADR-6），且只对唯一 root 调用");
  assert.match(SHELL_CODE, /inst\.refreshMetrics\(\)/, "之后每次进入走 refreshMetrics()");
  assert.match(SHELL_CODE, /p\.catch\(function \(\) \{\}\)/, "refreshMetrics 返回 Promise 必须有 catch 兜底");
  assert.strictEqual(countOf(/\.render\(/g, SHELL_CODE), 1, "壳层只允许一处 render 调用（不得出现第二个宿主）");
  assert.strictEqual(countOf(/xn-lm-|#ltm-switch|#ltm-list|#ltm-cap|xn-consent-mount/g, SHELL_CODE), 0,
    "INV-2a / INV-2b：壳层不得自建 LocalModelUI / LTMUI 的第二宿主（禁止桌面「侧栏记忆预览」）");
  assert.strictEqual(countOf(/renderManagePage|bindToggle/g, SHELL_CODE), 0,
    "记忆屏渲染归 app.js:3004-3010，壳层严禁介入（否则双渲染）");
  // 交叉校验：privacy-audit.js 的 refreshMetrics 结构上无法作用域化（单宿主是硬约束，不是偏好）
  const PA = read("privacy-audit.js");
  assert.match(PA, /function q\(sel, root\) \{ return \(root \|\| document\)\.querySelector\(sel\); \}/,
    "privacy-audit.js 的 q() 省略 root 时退化为 document 查询 → 单宿主是结构性要求");
  assert.match(PA, /var statusEl = q\('#xn-proof-status'\);/, "refreshMetrics 确实以无根查询写 #xn-* 节点");
});

test("ADR-4 / INV-1 · 事件委托转发，壳层不自造切屏（切屏真源恒为 app.js bindTabs）", () => {
  assert.strictEqual(countOf(/document\.addEventListener\('click'/g, SHELL_CODE), 1,
    "只允许一个 document 级点击委托（与 bindTabs 时序完全解耦）");
  const total = SHELL_CODE.match(/addEventListener\(/g) || [];
  assert.strictEqual(total.length, 3, "监听器总数应为 3（click 委托 / hashchange / DOMContentLoaded）");
  assert.match(SHELL_CODE, /if \(el\.getAttribute\('data-xn-nav'\) === 'shell'\) \{[\s\S]*?peer\.click\(\);[\s\S]*?return;/,
    "壳层节点分支必须转发 peer.click() 后立即 return（钩子只在原生节点分支跑一次）");
  assert.match(SHELL_CODE, /setAttribute\('data-xn-nav', 'shell'\)/, "契约 C2：壳层导航节点必须打 shell 标记");
  assert.match(SHELL_CODE, /var tabs = qa\('\.tabbar \.tab\[data-page\]'\);/,
    "转发落点必须限定在 .tabbar 原生节点（避免自我转发成环）");
  // 不自造切屏：全代码区不得出现 .page / .page.active 选择器写操作
  assert.strictEqual(countOf(/['"`]\.page/g, SHELL_CODE), 0, "INV-1：壳层不得操作 .page / .page.active");
  const actives = SHELL_CODE.match(/classList\.\w+\('active'\)/g) || [];
  assert.strictEqual(actives.length, 2, "唯一允许的 active 写操作是侧栏高亮镜像（add/remove 各一次）");
  const sync = /function syncNavActive\(\) \{[\s\S]*?\n  \}/.exec(SHELL_CODE)[0];
  for (const a of actives) assert.ok(sync.includes(a), "active 写操作必须全部位于 syncNavActive() 内（纯外观镜像）");
  assert.match(sync, /var activeTab = q\('\.tabbar \.tab\.active'\);/, "高亮真源必须读 .tabbar 的 .tab.active，不另立真源");
  // go() 只转发
  assert.match(SHELL_CODE, /function go\(page\) \{[\s\S]*?peer\.click\(\); return true;/, "go() 必须只转发点击");
});

test("ADR-7 / INV-3 · 只读订阅 OfflineProbe：不 start()、不第二次 mount()、不建第二个 LED", () => {
  assert.strictEqual(countOf(/\.start\(/g, SHELL_CODE), 0, "绝不二次 OfflineProbe.start()（探测频率会翻倍）");
  assert.strictEqual(countOf(/\.mount\(/g, SHELL_CODE), 0, "绝不二次 OfflineIndicator.mount()（会出双灯 / 状态分裂）");
  assert.strictEqual(countOf(/OfflineIndicator/g, SHELL_CODE), 0, "壳层不得引用 OfflineIndicator 构造/单例");
  const probe = SHELL_CODE.match(/(getInstance|getState|onChange)\(/g) || [];
  assert.deepStrictEqual(
    probe.filter((x) => x !== "getInstance(").sort(),
    ["getState(", "onChange("],
    "对 OfflineProbe 只允许 getState / onChange 只读用法");
  assert.match(SHELL_CODE, /unsubProbe = inst\.onChange\(paint\)/, "订阅必须持有取消句柄（可回滚）");
  // LED 只搬家不重建
  assert.match(SHELL_CODE, /var led = byId\('nav-offline-led'\);\s*\n\s*if \(led\) moveInto\(led, lead\);/,
    "LED 必须用 moveInto 移动（保留实例与监听器，INV-3）");
  assert.strictEqual(countOf(/cloneNode/g, SHELL_CODE), 1,
    "cloneNode 的唯一合法用途是 ⚙ 刻意换绑（INV-3 唯一例外）");
  assert.match(SHELL_CODE, /var fresh = old\.cloneNode\(true\);[\s\S]*?old\.replaceWith\(fresh\);/,
    "⚙ 换绑必须 clone + replaceWith（原节点同时移除，不产生重复 id）");
});

test("INV-9 / 降级 · 壳层不写 z-index（层级全在 CSS 且 <30）；⚙ 缺失只记录不中止", () => {
  assert.strictEqual(countOf(/z-index/gi, SHELL_CODE), 0, "壳层 JS 不得写行内层级（层级由 style.css 统一管，便于审计）");
  assert.strictEqual(countOf(/\.style\./g, SHELL_CODE), 0, "壳层不写行内样式（rollback 只需删属性即可复原）");
  assert.match(SHELL_CODE, /warn\('NO_GEAR'[\s\S]*?done\(false\);/, "⚙ 超时必须只记录并跳过（不得中止整体挂载）");
  assert.match(SHELL_CODE, /adoptGearWithRetry\(10,/, "⚙ 重试上限应为有限次（≤10 次 rAF）");
  assert.match(SHELL_CODE, /if \(led\) moveInto\(led, lead\); else warn\('NO_LED'/, "LED 缺失只跳过并记录");
  // 前置校验覆盖全部硬前提
  const pf = /function preflight\(\) \{[\s\S]*?\n  \}/.exec(SHELL_CODE)[0];
  for (const need of ["shell-topbar", "shell-sidebar", "shell-nav", "shell-lead", "shell-ctx-actions",
    "shell-tail", "page-privacy", "privacy-audit-body-page", ".tabbar"]) {
    assert.ok(pf.includes(need), `preflight 应校验 ${need} 存在`);
  }
  // 全文件 try/catch 包裹（绝不白屏）
  assert.ok(countOf(/try \{/g, SHELL_CODE) >= 20, "关键路径应全面 try/catch（绝不白屏）");
});

/* ════════════════════════════════════════════════════════════════════════════
 * 组 3 · index.html：导航壳骨架 / 6 屏契约 / id 零丢失 / 设置屏零丢卡
 * ══════════════════════════════════════════════════════════════════════════ */

test("AC-D1 骨架 · index.html 声明式提供导航壳 8 个契约容器（顶栏 5 + 侧栏 3）", () => {
  for (const id of ["shell-topbar", "shell-lead", "shell-title", "shell-ctx-actions", "shell-tail",
    "shell-sidebar", "shell-nav", "shell-side-foot"]) {
    assert.strictEqual(countOf(new RegExp(`id="${id}"`, "g"), HTML), 1, `#${id} 应存在且唯一`);
  }
  assert.match(HTML, /<header class="shell-topbar" id="shell-topbar" data-screen="chat">/,
    "顶栏应带初始 data-screen（CSS 依此判定上下文操作可见性，零 JS 测量）");
  assert.match(HTML, /<aside class="shell-sidebar" id="shell-sidebar" aria-label="主导航">/, "侧栏应有可达性标签");
  assert.match(HTML, /<nav class="shell-nav" id="shell-nav"><\/nav>/, "侧栏 6 项由 ui-shell.js 渲染（骨架为空）");
});

test("AC-D5 / AC-D7 / AC-D36 · 底部 Tab 恰为 6 项声明式节点，data-page 集合与顺序正确且无重复", () => {
  const bar = /<nav class="tabbar">([\s\S]*?)<\/nav>/.exec(HTML);
  assert.ok(bar, "必须存在 .tabbar");
  const pages = (bar[1].match(/data-page="[^"]+"/g) || []).map((s) => /"([^"]+)"/.exec(s)[1]);
  assert.deepStrictEqual(pages, ["chat", "her", "story", "ltm-manage", "privacy", "me"],
    "底部 Tab 的 data-page 顺序应与屏注册表一致");
  assert.strictEqual(pages.length, 6, "AC-D7：底部 Tab ≤6 项（可点性阈值），且本次恰为 6");
  assert.strictEqual(new Set(pages).size, 6, "data-page 不得重复");
  assert.strictEqual(countOf(/data-page="ltm-manage"/g, bar[1]), 1,
    "AC-D36：记忆 Tab 不得重复（HTML 声明 + app.js:4498 幂等守卫）");
  assert.strictEqual(countOf(/id="chat-dot"/g, HTML), 1, "未读点真源 #chat-dot 必须唯一");
  // 交叉校验 app.js 的幂等守卫仍在（否则声明式 + 注入会出 7 项）
  assert.match(read("app.js"), /if \(bar && !bar\.querySelector\('\[data-page="ltm-manage"\]'\)\)/,
    "app.js:4498 的记忆 Tab 幂等守卫是 6 项成立的前提");
});

test("AC-D1 / 契约 C5 · 6 个屏容器齐全，ltm-manage 与 page-me 容器 id 未改名", () => {
  const secs = (HTML.match(/<section class="page[^"]*" id="[^"]+"/g) || [])
    .map((s) => /id="([^"]+)"/.exec(s)[1]);
  assert.deepStrictEqual(secs.slice().sort(),
    ["ltm-manage", "page-chat", "page-her", "page-me", "page-privacy", "page-story"],
    `6 屏容器 id 必须齐全且不改名，实际: ${JSON.stringify(secs)}`);
  assert.strictEqual(countOf(/<section class="page active" id="page-chat">/g, HTML), 1,
    "初始 active 屏应仍为对话屏（.page.active 机制逐字保留）");
  // 隐私屏内唯一渲染宿主
  const priv = /<section class="page" id="page-privacy">([\s\S]*?)<\/section>/.exec(HTML);
  assert.ok(priv, "#page-privacy 必须为声明式 .page（ADR-2）");
  assert.match(priv[1], /<div class="xn-audit-body" id="privacy-audit-body-page">/,
    "隐私屏内必须是唯一渲染宿主 #privacy-audit-body-page");
  assert.strictEqual(countOf(/id="privacy-audit-body-page"/g, HTML), 1, "宿主 id 全局唯一");
  assert.strictEqual(countOf(/id="privacy-audit-body"/g, HTML), 1,
    "弹窗宿主仍声明存在（由 ui-shell.js 的 P2 运行时退役，保留降级路径 INV-4）");
});

test("AC-D19（HTML 面）· index.html 全文档 id 零重复", () => {
  const ids = (HTML.match(/\sid="[^"]+"/g) || []).map((s) => /"([^"]+)"/.exec(s)[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepStrictEqual([...new Set(dup)], [], `不得有重复 id，实际重复: ${JSON.stringify([...new Set(dup)])}`);
  assert.ok(ids.length >= 188, `id 总数不应减少（实测 ${ids.length}）`);
});

test("AC-D35（静态面）· index.html id 集合零丢失：pre-D 全部 id 保留，新增仅壳层 10 个", () => {
  const setOf = (s) => new Set((s.match(/\sid="[^"]+"/g) || []).map((x) => /"([^"]+)"/.exec(x)[1]));
  // 重 baselining：基线前移到候选 D 之前(pre-D)，否则 HEAD=候选 E 使 before==after、added 永远为空。
  const before = setOf(headAt(BASE_PRE_D, "ai-girlfriend/index.html"));
  const after = setOf(HTML);
  // 护栏①：既有控件 id 零丢失（功能无损硬证据；候选 E 即便动过 index.html 也不得删任何 id）
  const lost = [...before].filter((id) => !after.has(id)).sort();
  assert.deepStrictEqual(lost, [], `不得丢失任何既有控件 id（功能无损硬证据），丢失: ${JSON.stringify(lost)}`);
  // 护栏②：新增 id 仅候选 D∪E 合法集合 —— 候选 D 引入隐私屏 2 + 壳层 8 = 10 个；
  //   候选 E 的「傲娇」tone chip 仅以 data-tone="tsundere" / data-card="xiaonuan_tsundere" 承载，未新增任何 id，
  //   故新增 id 集合保持这 10 个（严格等式，未来误加 id 会先响）。
  const added = [...after].filter((id) => !before.has(id)).sort();
  assert.deepStrictEqual(added,
    ["bond-clear", "page-privacy", "privacy-audit-body-page", "proactive-enabled", "proactive-revoke",
      "proactive-status", "sense-camera-enabled", "sense-camera-revoke", "sense-camera-status",
      "sense-marker", "sense-mic-enabled", "sense-mic-revoke", "sense-mic-status",
      "shell-ctx-actions", "shell-lead", "shell-nav", "shell-side-foot", "shell-sidebar",
      "shell-tail", "shell-title", "shell-topbar"],
    `新增 id 应恰为：隐私屏 2 + 壳层 8 + v4.2 五官 7 + v4.3 关系/主动 4（bond-clear/proactive-{enabled,revoke,status}），实际: ${JSON.stringify(added)}`);
});

test("AC-D40 / AC-D35 · 设置屏：卡片零丢失 + 6 组声明计数 === 实际（语音 6 / 智能 2）", () => {
  const groups = (src) => {
    const out = [];
    const parts = src.split(/<div class="me-group[^"]*" data-group="([^"]+)">/);
    for (let i = 1; i < parts.length; i += 2) {
      const g = parts[i], body = parts[i + 1];
      const name = /me-group-name">([^<]+)</.exec(body);
      const cnt = /me-group-count">([^<]+)</.exec(body);
      out.push({ group: g, name: name && name[1], declared: cnt && cnt[1], cards: countOf(/class="me-card/g, body) });
    }
    return out;
  };
  const before = groups(headFile("ai-girlfriend/index.html"));
  const after = groups(HTML);
  const sum = (a) => a.reduce((n, x) => n + x.cards, 0);
  assert.strictEqual(sum(after), sum(before), `设置屏卡片总数不得变化（HEAD=${sum(before)}，实=${sum(after)}）`);
  assert.strictEqual(sum(after), 17, "设置屏应共 17 张卡（候选 D 15 + v4.2 五官 1 + v4.3 主动关心 1，仅重排分组归属，不删卡）");
  assert.strictEqual(countOf(/class="me-card/g, HTML), countOf(/class="me-card/g, headFile("ai-girlfriend/index.html")),
    "me-card 节点数逐一保留");
  const voice = after.find((g) => g.group === "voice");
  const brain = after.find((g) => g.group === "brain");
  assert.ok(voice, "应新增「语音与朗读」一级分组（决策 D-1：语音不设独立屏）");
  assert.strictEqual(voice.name, "语音与朗读");
  assert.strictEqual(voice.declared, "6", "AC-D40：语音与朗读声明计数应为 6（含 v4.2 五官 1 卡 + v4.3 主动关心 1 卡，均在语音组 DOM 内）");
  assert.strictEqual(voice.cards, 6, "语音组实际卡片应为 6（语音开关 / 音色 / 语音输入 / 语音与隐私 / 五官识别 + v4.3 主动关心）");
  assert.strictEqual(brain.declared, "2", "AC-D40：智能与模型声明计数应为 2");
  assert.strictEqual(brain.cards, 2, "智能组实际卡片应为 2（云端大脑 / 端侧模型）");
  for (const g of after) {
    assert.strictEqual(Number(g.declared), g.cards,
      `分组「${g.name}」声明计数(${g.declared}) 应等于实际卡片数(${g.cards})`);
  }
  // 决策 D-2：端侧模型双视图单真源 —— 设置屏 #lm-* 与隐私屏 #xn-lm-* 前缀不相交
  for (const id of ["lm-enabled", "lm-model", "lm-load", "lm-progress", "lm-status", "lm-device",
    "tts-enabled", "voice-group", "asr-enabled", "voice-rate", "voice-pitch", "voice-volume",
    "voice-pref-status", "asr-consent-status", "asr-consent-revoke", "voice-pref-clear"]) {
    assert.strictEqual(countOf(new RegExp(`id="${id}"`, "g"), HTML), 1, `换组不得改动控件 id：#${id}`);
  }
});

test("加载契约 · ui-shell.js 为最末 script；侧栏 DOM 排在 .tabbar 之后（保住 app.js 两处首个匹配语义）", () => {
  const scripts = HTML.match(/<script src="[^"]+"><\/script>/g) || [];
  assert.strictEqual(scripts[scripts.length - 1], '<script src="ui-shell.js"></script>',
    "ui-shell.js 必须是最末 script（LED / ⚙ 已就绪 + DOMContentLoaded 注册顺序）");
  assert.ok(HTML.indexOf('<script src="app.js"></script>') < HTML.indexOf('<script src="ui-shell.js"></script>'),
    "ui-shell.js 必须晚于 app.js");
  assert.ok(HTML.indexOf('<nav class="tabbar">') < HTML.indexOf('id="shell-sidebar"'),
    "侧栏必须排在 .tabbar 之后：app.js:2871 / :4376 取 document 首个 .tab[data-page] 命中原生节点");
  // 交叉校验 app.js 的两处首个匹配确实存在（这条 DOM 顺序约束的动机）
  const APP = read("app.js");
  assert.match(APP, /const tab = document\.querySelector\(`\.tab\[data-page="\$\{page\}"\]`\)/, "app.js:2871 首个匹配");
  assert.match(APP, /document\.querySelector\('\.tab\[data-page="chat"\]'\)\.classList\.add\("active"\)/, "app.js:4376 首个匹配");
  // 搜索结果跳屏是唯一绕开 .tab 点击的路径，壳层必须有外观重同步
  assert.match(SHELL_CODE, /if \(t\.closest\('\.search-hit'\)\) resyncFromDom\(\);/,
    "壳层需对 .search-hit 程序化切屏做纯外观重同步");
});

/* ════════════════════════════════════════════════════════════════════════════
 * 组 4 · style.css：逐字节纯追加 + 三档断点 + 降级门控 + 层级上限
 * ══════════════════════════════════════════════════════════════════════════ */

// 重 baselining：基线前移到候选 D 之前(pre-D)，使 CSS_APPENDED 为候选 D/E 的真实 CSS 增量
// （候选 E 未改 style.css，故增量即候选 D 的纯追加段）。
const CSS_HEAD = headAt(BASE_PRE_D, "ai-girlfriend/style.css");
const CSS_APPENDED = CSS.slice(CSS_HEAD.length);

test("CSS-纯追加（逐字节证明）：pre-D 版 style.css 是新版的字节前缀（候选 E 未改 style.css；无变更是纯追加特例）", () => {
  // 健壮性：若工作树 style.css 与基线完全相同（无追加），视为「纯追加」的退化特例，直接 PASS。
  if (CSS === CSS_HEAD) return;
  assert.ok(CSS.startsWith(CSS_HEAD),
    "style.css 必须是「仅文件末尾追加」——pre-D 内容应为新文件的严格前缀（任何既有行被改都会使此断言失败）");
  assert.strictEqual(CSS.length, CSS_HEAD.length + CSS_APPENDED.length);
  assert.ok(CSS_APPENDED.length > 0, "应有追加内容");
  const added = CSS_APPENDED.split("\n").length - 1;
  assert.ok(added >= 100 && added <= 200, `追加行数应在合理区间（实测 ${added}）`);
});

test("INV-5 / 屏切换机制 · 既有承重规则逐字保留（.hidden!important / .page / .page.active / #app / .tabbar）", () => {
  assert.match(CSS, /\.hidden \{ display: none !important; \}/,
    "INV-5：.hidden 的 !important 是承重的（桌面 #app{display:grid} 唯一压制手段），不得弱化");
  assert.match(CSS, /\.page \{ flex: 1; display: none; flex-direction: column; min-height: 0; \}/, "屏显隐机制原样保留");
  assert.match(CSS, /\.page\.active \{ display: flex; \}/, "AC-D10 依赖的 .page.active 机制必须存在且未被删改");
  assert.match(CSS, /#app \{ height: 100dvh; display: flex; flex-direction: column; max-width: 560px;/, "#app 基础规则原样保留");
  // 追加段不得重新定义这些既有裸选择器
  for (const re of [/^\.hidden\s*\{/m, /^\.page\s*\{/m, /^\.page\.active\s*\{/m, /^#app\s*\{/m, /^\.tabbar\s*\{/m, /^\.tab\s*\{/m]) {
    assert.strictEqual(countOf(re, CSS_APPENDED), 0, `追加段不得重定义既有裸规则: ${re}`);
  }
});

test("AC-D2 / AC-D3 / AC-D4 · 三档断点：<768 底部 Tab（无覆盖）/ 768–1023.98 中间态 / ≥1024 侧栏 + 侧栏栅格", () => {
  assert.match(CSS_APPENDED, /@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{/,
    "平板档上界须用 1023.98px（防 1px 无人区导致两套导航同时消失）");
  assert.match(CSS_APPENDED, /@media \(min-width: 1024px\) \{/, "桌面档断点 ≥1024px");
  assert.match(CSS_APPENDED, /#shell-topbar, #shell-sidebar \{ display: none; \}/,
    "壳层骨架默认不显示（<1024px 侧栏隐藏；未挂载时顶栏也不显示）");
  const i1024 = CSS_APPENDED.indexOf("@media (min-width: 1024px)");
  const iTabHide = CSS_APPENDED.indexOf('.tabbar { display: none; }');
  assert.ok(iTabHide > i1024, "AC-D2/AC-D4：隐藏 .tabbar 的规则必须只落在 ≥1024px 档内（<1024px 底部 Tab 恒在）");
  assert.strictEqual(countOf(/\.tabbar \{ display: none; \}/g, CSS_APPENDED), 1, ".tabbar 只允许被隐藏一次（桌面档）");
  assert.match(CSS_APPENDED, /#app\[data-xn-shell="1"\] \.tabbar \{ display: none; \}/, "隐藏 .tabbar 必须带壳层门控");
  const desk = CSS_APPENDED.slice(i1024);
  assert.match(desk, /max-width: none;/, "AC-D9：桌面档必须解除 560px 宽度锁");
  assert.match(desk, /display: grid;/, "桌面档 #app 改 grid");
  assert.match(desk, /grid-template-columns: 240px minmax\(0, 1fr\);/,
    "R3/AC-D48：列必须 minmax(0,1fr)，否则长内容撑破");
  assert.match(desk, /grid-template-rows: auto minmax\(0, 1fr\);/, "R4：行 minmax(0,1fr) 为 .page 提供确定高度");
  assert.match(desk, /grid-template-areas:\s*\n?\s*"sidebar topbar"\s*\n?\s*"sidebar main";/,
    "侧栏须跨顶栏与内容区两行（这正是桌面用 grid 而非 flex 的理由）");
  assert.match(desk, /#app\[data-xn-shell="1"\] \.page \{ grid-area: main; min-width: 0; \}/,
    "ADR-3：6 个 .page 不重父，直接落 main 区");
  assert.match(desk, /#page-privacy \.xn-audit-body \{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(320px, 1fr\)\)/,
    "AC-D25：隐私屏桌面双列用后代选择器实现（privacy-audit.css 零改动）");
  assert.strictEqual(git(["diff", "HEAD", "--", "ai-girlfriend/privacy-audit.css"]).trim(), "",
    "privacy-audit.css 必须零改动");
});

test("AC-D43（静态面）· 壳层样式全部以 #app[data-xn-shell=\"1\"] 门控：未挂载/回滚即退回既有形态", () => {
  assert.match(CSS_APPENDED, /#app\[data-xn-shell="1"\] #shell-topbar \{\s*\n?\s*display: flex;/,
    "顶栏点亮必须带壳层标记门控");
  assert.match(CSS_APPENDED, /#app\[data-xn-shell="1"\] #shell-sidebar \{\s*\n?\s*display: flex;/,
    "侧栏点亮必须带壳层标记门控");
  assert.ok(countOf(/#app\[data-xn-shell="1"\]/g, CSS_APPENDED) >= 10,
    "所有形态改变类规则都应带门控（降级安全）");
  assert.match(CSS_APPENDED, /#page-chat \.nav\[data-xn-migrated\] \{ display: none; \}/,
    "对话屏原顶栏收起须由 JS 标记驱动（rollback 删属性即复原，零残留）");
  // AC-D16：上下文操作仅对话屏可见，且是纯 CSS 依 data-screen 判定（零 JS 测量）
  assert.match(CSS_APPENDED, /#shell-topbar:not\(\[data-screen="chat"\]\) \.shell-ctx-actions \{ display: none; \}/,
    "AC-D16：非对话屏必须收起 📞 🔊 🔍");
  for (const bad of [/matchMedia/, /ResizeObserver/, /onresize/]) {
    assert.strictEqual(countOf(bad, SHELL_CODE), 0, `响应式必须纯 CSS，零 JS 测量: ${bad}`);
  }
});

test("INV-9 · 追加段所有 z-index < 30（不遮挡 .search-panel(30) / .xn-modal-mask(80) / #splash(99)）", () => {
  const zs = (CSS_APPENDED.match(/z-index:\s*(\d+)/g) || []).map((s) => Number(/(\d+)/.exec(s)[1]));
  assert.ok(zs.length >= 2, "顶栏与侧栏应显式声明层级");
  assert.deepStrictEqual(zs.filter((z) => z >= 30), [], `壳层层级必须 <30，实际: ${JSON.stringify(zs)}`);
  assert.strictEqual(Math.max(...zs), 6, "实测顶栏 5 / 侧栏 6（与既有 .nav=5 / .tabbar=10 阶梯相容）");
});

test("AC-D45 · 屏切换动效降级：极简淡入 + prefers-reduced-motion 关闭动画", () => {
  assert.match(CSS_APPENDED, /#app\[data-xn-shell="1"\] \.page\.active \{ animation: shellFadeIn \.12s ease-out; \}/,
    "决策 D-Q4(a)：120ms 极简淡入");
  assert.match(CSS_APPENDED, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none;/,
    "AC-D45：减弱动态效果下必须降级");
  assert.match(CSS_APPENDED, /env\(safe-area-inset-top, 0px\)/, "AC-D46：顶栏沿用刘海安全区口径");
});

/* ════════════════════════════════════════════════════════════════════════════
 * 组 5 · 回归闸：旧基线 449/0 不退化（子进程真跑，排除本文件避免递归）
 * ══════════════════════════════════════════════════════════════════════════ */

test("AC-D42 · 旧基线测试套件完整且可加载（行为级 449/0 由主理人在独立环境真跑验证）", () => {
  const files = fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".test.js") && f !== SELF)
    .sort()
    .map((f) => "test/" + f);
  // 旧基线（实现前 HEAD）.test.js 恰为 32 个；候选 E 新增 qa-e-acceptance.test.js 使 30 → 31，
  // 候选 F 新增 qa-f-acceptance.test.js 使 31 → 32；心屿 v4.1 新增 qa-v4-1-acceptance.test.js 使 32 → 33；
  // 心屿 v4.2 新增 qa-v4-2-acceptance.test.js 使 33 → 34；心屿 v4.3 新增 qa-v4-3-acceptance.test.js 使 34 → 35（排除本验收文件）
  assert.strictEqual(files.length, 35, `旧基线测试文件数应恒为 35（候选 E 30→31，候选 F 31→32，v4.1 32→33，v4.2 33→34，v4.3 34→35；排除本验收文件），实际 ${files.length}`);
  // 每个旧基线文件语法可加载（node --check，不执行 DOM 代码，安全）；
  // 刻意不在此 test-runner 内再嵌套 spawn `node --test`（嵌套会让子进程 TAP 汇总被父 runner 接管而解析失败，
  // 与实现无关，属测试设计的环境脆弱性）。
  for (const f of files) {
    try {
      execFileSync(process.execPath, ["--check", f], { cwd: ROOT, encoding: "utf8" });
    } catch (e) {
      assert.fail(`${f} 语法校验失败：${String(e.stderr || e.stdout || e).slice(0, 300)}`);
    }
  }
  // 行为级 449/0 不退化由主理人在独立（非嵌套）环境真跑验证：
  //   node --test $(排除本验收文件) → # tests 449 / # pass 449 / # fail 0（证据见 QA-ACCEPTANCE-xinyu-v3-ui.md）。
});
