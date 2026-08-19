# 心屿 Xinyu v3 · 候选 D：UI 多界面布局重构 —— 架构设计说明

- **产品**：心屿（Xinyu）· 隐私优先端侧 AI 伴侣
- **AI 女友**：小暖（Xiaonuan）—— **全文不改名、不替换、不意译**
- **候选**：D（UI 多界面布局重构）
- **架构师**：高见远（Gao）
- **上游 PRD**：`ai-girlfriend/docs/DESIGN-xinyu-v3-ui.md`（产品经理 许清楚 / Xu）
- **配套图**：`class-diagram-xinyu-v3-ui.mermaid`（组件/类图）、`sequence-diagram-xinyu-v3-ui.mermaid`（时序图）
- **本文档定位**：把 PRD 的产品意图转成**可实现、可验收、可回滚**的工程契约。凡本文与 PRD 冲突处，均在 §10 列明并给出裁决理由。

---

## 0. 一句话架构

> 新增**单文件共存叠加层** `ui-shell.js`（挂 `window.UiShell`），它**只做四件事**：搭壳（顶栏/侧栏）、搬家（把已挂载的全局态 DOM 节点迁进壳层）、转发（把壳层导航点击转发给 `app.js` 既有 `bindTabs()` 处理器）、挂钩（为新增的隐私屏补进入钩子）。
> 屏切换真源、渲染真源、数据真源、隐私边界**全部不动**；`app.js` 零改动；冻结线四文件**物理上不在改动清单内**。

---

## 1. 代码库验证结论（PRD 假设核实）

本章是架构设计的**事实地基**。全部结论来自实际读码，标注真实行号。

### 1.1 PRD 假设逐条核实

| # | PRD 假设 | 核实结论 | 证据 |
| --- | --- | --- | --- |
| V1 | 冻结线四文件字节数 | ✅ **精确相等** | `wc -c`：`engine.js`=251068、`sw.js`=13723、`memory.js`=13333、`test/baseline.js`=2646 |
| V2 | `bindTabs()` 是屏切换真源 | ✅ 成立 | `app.js:2986` 定义；`app.js:2987` `document.querySelectorAll(".tab")` |
| V3 | `.page{display:none}` / `.page.active{display:flex}` | ✅ 行号精确 | `style.css:63`（含 `flex:1; flex-direction:column; min-height:0`）、`style.css:64` |
| V4 | `#app{max-width:560px}` | ✅ 且**全仓库唯一命中** | `style.css:62`（含 `height:100dvh; display:flex; flex-direction:column`） |
| V5 | 响应式几乎为零 | ✅ 全文件仅 **2 条** `@media` | `style.css:357`（`min-width:600px`，只加左右边框）、`style.css:1019`（`prefers-reduced-motion`） |
| V6 | `privacy-audit.js` 的 `q()` 助手 | ✅ 行号精确 | `privacy-audit.js:23` `function q(sel, root) { return (root \|\| document).querySelector(sel); }` |
| V7 | **R1 单一渲染目标约束真实** | ✅ **成立，且比 PRD 描述更强**（见 §1.2） | `privacy-audit.js:194/201/211-213/263-264` |
| V8 | ⚙ 入口运行时注入、绑 `openPrivacyAudit` | ✅ | `app.js:4682` 注入守卫、`:4685` 设 id、`:4691` `addEventListener("click", openPrivacyAudit)` |
| V9 | 记忆 Tab 运行时注入且有幂等守卫 | ✅ | `app.js:4497-4503`，守卫 `if (bar && !bar.querySelector('[data-page="ltm-manage"]'))` |
| V10 | `OfflineIndicator` DOM 迁移安全 | ✅ 成立（见 §1.3） | `offline-indicator.js:46-63`、`app.js:4527-4541` |
| V11 | `app.js` 是最后加载的脚本 | ✅ | `index.html:714` 是最后一个 `<script>`；`app.js:4719` `DOMContentLoaded → init` |
| V12 | `refreshNavStatus()` 靠 id 工作，迁移后仍命中 | ✅ | `app.js:685` `const el = $("#nav-status")`（无根查询） |
| V13 | `ltm-manage` 有路由特判 | ✅ | `app.js:2992-2995` 三元分支 |
| V14 | `#ltm-toast` 挂 `document.body` | ✅ | `ltm-ui.js:31-32`；z-index **9999**（`style.css:638`）→ 壳层不会遮挡 |
| V15 | `ConsentUI` 可安全重渲染 | ✅ **零无根查询**，`container.innerHTML=''` 后 `createElement` + 闭包绑定 | `consent-ui.js:54-58`，`grep document.getElementById\|document.querySelector` **零命中** |
| V16 | `Voice` 有独立 UI 挂载点 | ⚠️ 否 —— `Voice` 是**纯函数模块**（`window.Voice`），自身不挂 DOM | `voice.js:260-264` 导出面；`#voice-bar` 由 `app.js:2288` 驱动 |
| V17 | `DiagnosticReport` 渲染宿主 | ✅ `shareLocal()` 宿主 = `container \|\| document.body`；`PrivacyAudit` 调用时不传 container → 挂 body，不受壳层影响 | `diagnostic-report.js:145`、`privacy-audit.js:181-183` |

### 1.2 关键确认：R1「单一渲染目标」是**结构性**硬约束（比 PRD 更强）

PRD §8 R1 判断正确，但低估了严重性。实际情况是：

```
privacy-audit.js:189  PrivacyAudit.prototype.refreshMetrics = function () {   ← 不接收任何 container 参数
privacy-audit.js:201    var statusEl = q('#xn-proof-status');                 ← 省略 root → document.querySelector
privacy-audit.js:211    setText('#xn-c-blocked', proof.blocked);
privacy-audit.js:263  function setText(sel, val) { var el = q(sel); ... }     ← 同样省略 root
```

并且 `render(container)`（`privacy-audit.js:89`）**不把 container 存进实例**（无 `this._root` / `this._container` 字段）。

> **因此 `refreshMetrics()` 在结构上不可能被作用域化。** 它对全文档 `#xn-*` id 唯一性的依赖不是"实现疏忽"，而是**当前 API 契约的一部分**。

**架构裁决**：R1 从 PRD 的"硬约束"升级为**架构不变量 INV-2**（§5），并**泛化到全部同类组件**——因为核实发现这不是隐私模块独有的模式：

| 组件 | 无根 id 查询 | 结论 |
| --- | --- | --- |
| `PrivacyAudit` | `#xn-proof-status` `#xn-c-*` `#xn-store-*` `#xn-channel-val` `#xn-score-*` `#xn-consent-summary`（`:201-251`） | **单宿主** |
| `LTMUI` | `ltm-switch`（`:99,231,305`）、`ltm-list`（`:105,133,155`）、`ltm-filters`（`:107`）、`ltm-cap-fill/-text`（`:147,148,218`）、`.ltm-danger`（`:106`）、`.ltm-capacity`（`:108`）、`.ltm-header`（`:109`）、`ltm-off-tip`（`:110`） | **单宿主**（PRD 未提及） |
| `LocalModelUI` | `xn-lm-status`（`:74`）、`xn-lm-unload`（`:81`）、`xn-lm-progress`（`:88,150`）、`xn-lm-weights`（`:160`） | **单宿主**（PRD 未提及） |
| `ConsentUI` | 无 | 多宿主安全（但随宿主 `PrivacyAudit` 继承单宿主） |

这条泛化带来两个 PRD 未写明的架构禁令（§5 INV-2a / INV-2b）。

**顺带确认决策 D-2（本地模型双视图）是安全的**：设置屏那张卡用 `#lm-*` 前缀（`#lm-enabled` / `#lm-model` / `#lm-load` / `#lm-progress` / `#lm-status` / `#lm-device`），隐私屏 `LocalModelUI` 用 `#xn-lm-*` 前缀 —— **两套 id 集合完全不相交**，不触发 INV-2。双视图单真源成立。

### 1.3 关键确认：LED 的 DOM 迁移为何安全

```
offline-indicator.js:46  mount = function (anchor) {
                    :49    var el = anchor.querySelector('.xn-offline-led');   ← 幂等守卫
                    :51-53  el = document.createElement('span'); anchor.appendChild(el);
                    :55    this._el = el;                                      ← 持有子元素引用，不持有 anchor
```

- LED 实体是 `#nav-offline-led` 的**子** `<span class="xn-offline-led">`；`setState()`（`:70-76`）/`animate()`（`:84-86`）只操作 `this._el`。
- `prepend()` / `appendChild()` **移动**节点（而非克隆）→ `this._el` 引用、`app.js:4534` 的 `onChange` 闭包全部继续有效。
- `app.js:4530` 的 `document.querySelector("#nav-offline-led") || document.querySelector("#page-chat .nav")` 在壳层挂载**之前**已执行完毕，迁移不影响它。
- ✅ PRD §3.5「DOM 迁移而非重建」+「严禁二次 `mount()`」的策略成立。

### 1.4 三处 PRD 偏差（须修订，见 §10）

| ID | 偏差 | 事实 | 影响 |
| --- | --- | --- | --- |
| **DEV-1** | PRD §6.7 / 任务书提到 `bindTabs()` 的 **`screens` 白名单** | ❌ **不存在**。`grep -n "showScreen\|screens\b\|SCREENS" app.js` **零命中**。`app.js` 无 `showScreen()` 函数、无屏白名单。路由是**开放映射**：`$("#page-" + tab.dataset.page)`，外加 `ltm-manage` 一处特判（`app.js:2992-2995`） | ✅ **利好**：`data-page="privacy"` 会自动解析到 `#page-privacy`，**无需注册、无需改 `app.js`**。`app.js` 零改动从"理想目标"变为"确定结论" |
| **DEV-2** | PRD §4.5 / AC-D18 称隐私面板有 **8 个 `.xn-audit-section` 分区** | ⚠️ 实际 `.xn-audit-section` = **7**（`grep -c` 实测）。第 8 个逻辑分区「操作」是**裸** `.xn-audit-actions`（`privacy-audit.js:154`），不在 `.xn-audit-section` 内；另有一个 `.xn-audit-actions` 嵌在分区⑦诊断报告内 | ❗ **AC-D18 按 `.xn-audit-section >= 8` 判定会误判失败**。须改判据（§10 修订 2）。8 个**逻辑**分区确实齐全，功能无缺 |
| **DEV-3** | 任务书要求挂 `window.UiShell`；PRD §6.2 写 `window.XinyuShell` | 命名冲突 | 由 ADR-1 裁决为 `window.UiShell` |

### 1.5 四项 PRD 未覆盖的新增约束（本架构补齐）

| ID | 发现 | 为何重要 |
| --- | --- | --- |
| **NEW-1** | **grid 自动放置隐患**：`#app` 有 11 个直接子节点（5 个 `.page` + `#call-overlay` + `#games-overlay` + `#ltm-corner` + `#asr-consent-modal` + `#privacy-audit-modal` + `.tabbar`，`index.html:45-676`）。一旦 `#app` 变 `display:grid`，**任何未脱离文档流的直接子节点都会被自动放置成隐式 grid 项** | 若不处理，`.page.active{display:flex}` 会逃出内容区、并撑出隐式行。**直接决定了 ADR-3 的方案选型** |
| **NEW-2** | 幸存性核查：`#call-overlay`（`style.css:480-481` fixed/z95）、`#games-overlay`（`:537-538` fixed/z96）、`#ltm-corner`（`:1198` fixed/z50）、`.modal-mask`（`:1262-1263` fixed/z60）、`.xn-modal-mask`（**`privacy-audit.css:11` fixed/z80**）**全部 `position:fixed`** → 脱离流，grid 安全 | 5 个浮层无需任何处理。唯一静态子节点是 `.tabbar`（`style.css:324-327`，静态定位），靠 ≥1024px `display:none` 消解 |
| **NEW-3** | `.hidden { display: none !important; }`（`style.css:41`）—— 这个 `!important` 是**承重的** | `#app` 是 id 选择器（特异性 1,0,0），若 `.hidden` 无 `!important`，`@media(min-width:1024px){#app{display:grid}}` 会击穿启动隐藏，导致桌面端**闪现未初始化的 app / 跳过启动页**。现状安全，但**任何人不得移除该 `!important`**，须写入不变量 INV-5 |
| **NEW-4** | **`bindTabs()` 早于 `bindPrivacyAudit()`**：`app.js:4505` 调 `bindTabs()`，`app.js:4512` 才调 `bindPrivacyAudit()` | ⚙ 按钮**诞生于 `bindTabs()` 之后**。因此 PRD §3.6 的 clone 换绑 + `data-page` **必然**不会被 `bindTabs()` 绑定 —— PRD R6 的"时序竞态"不是"可能发生"，而是**确定发生**。→ 事件委托（ADR-4）从"推荐"升级为**强制** |

### 1.6 既有 z-index 阶梯（实测，用于壳层层级定位）

| 层级 | 元素 | 位置 |
| --- | --- | --- |
| 5 | `.nav` 聊天顶栏 | `style.css:72` |
| 10 | `.tabbar` | `style.css:326` |
| 30 | `.search-panel` | `style.css:698` |
| 40 | `.day-detail` | `style.css:716` |
| 50 | `#ltm-corner` | `style.css:1198` |
| 60 | `.modal-mask`（ASR 同意） | `style.css:1263` |
| **80** | `.xn-modal-mask`（隐私弹窗） | **`privacy-audit.css:11`**（PRD R10 误记为 99999） |
| 90 | `.levelup-toast` | `style.css:349` |
| 95 / 96 | `#call-overlay` / `#games-overlay` | `style.css:481` / `:538` |
| 99 | `#splash` | `style.css:45` |
| 9999 | `#ltm-toast` | `style.css:638` |
| 99999 | `.gender-picker` | `style.css:651` |

> **壳层层级裁决**：`#shell-topbar` z=**5**（继承它所替代的 `.nav` 的层级）、`#shell-sidebar` z=**6**。**上限硬约束：壳层任何元素 z-index 必须 < 30**，否则会遮挡 `.search-panel`（z=30）及其之上的全部浮层。

---

## 2. 架构总览

### 2.1 分层视图

```
┌──────────────────────────────────────────────────────────────────────────┐
│ L4 呈现壳层（本候选新增，唯一新增层）                                       │
│   ui-shell.js  →  window.UiShell                                          │
│   ShellTopbar · ShellSidebar · ScreenRegistry · HashRouter · EnterHooks   │
│   职责：搭壳 / 搬家 / 转发 / 挂钩。不持有业务数据，不发起网络请求。            │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ 只依赖：data-page 契约 + .page.active 机制 + DOM id
┌───────────────▼──────────────────────────────────────────────────────────┐
│ L3 视图/控制层（既有，零改动）                                              │
│   app.js: bindTabs() 屏切换真源 · refreshNavStatus() · initMeGroups()      │
│           initMeSearch() · openPrivacyAudit()(退役但保留)                   │
│   PrivacyAudit · ConsentUI · LocalModelUI · LTMUI · OfflineIndicator       │
│   DiagnosticReport · PrivacyScore                                          │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│ L2 能力/服务层（既有，零改动）                                              │
│   Voice · LTM · ConsentStore · AuditProbe · OfflineProbe · CacheWarmer     │
│   ReplyRouter(cloud→local→heuristic) · AuditExporter · CspInjector         │
└───────────────┬──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│ L1 冻结线（禁止改动 · CI 字节闸）                                           │
│   engine.js(251068) · sw.js(13723) · memory.js(13333)                      │
│   test/baseline.js(2646)                                                   │
│   —— 纯函数库 / SW 缓存 / 引擎注册模块 / 测试基线，均无 DOM 与路由代码         │
└──────────────────────────────────────────────────────────────────────────┘
```

**依赖方向严格单向向下，且 L4 → L1 无任何直接边。** 这是"物理上不碰冻结线"的结构性保证（§3.3）。

### 2.2 `UiShell` 与既有模块的协作关系

| 既有模块 | 协作方式 | `UiShell` 是否调用其 API | 边界约定 |
| --- | --- | --- | --- |
| **`app.js` `bindTabs()`** | **转发**：壳层导航点击 → 找到对应 `.tabbar` 节点 → `.click()` | 否（复用 DOM 事件） | 壳层**绝不**复制 `bindTabs()` 的切屏逻辑。屏切换只有一个真源 |
| **`PrivacyAudit`** | **进入钩子**：隐私屏首次进入 → `render(#privacy-audit-body-page)`；每次进入 → `refreshMetrics()` | ✅ `render()` / `refreshMetrics()` | 必须传入**唯一** root（INV-2）；壳层不解析、不改写其 innerHTML |
| **`ConsentUI`** | **间接**：由 `PrivacyAudit.render()` 内部挂载到 `#xn-consent-mount`（`privacy-audit.js:158-161`） | ❌ 从不直接调用 | 壳层不得另开第二个 ConsentUI 宿主（否则 cloudSync 二次确认出现双入口） |
| **`LocalModelUI`** | **间接**：由 `PrivacyAudit.render()` 挂载到 `#xn-localmodel-mount`（`privacy-audit.js:163-169`） | ❌ | 隐私屏是 `#xn-lm-*` 的唯一宿主（INV-2a） |
| **`LTMUI`** | **不接触**：记忆屏的渲染仍由 `app.js:3004-3010` 在 `bindTabs()` 内完成 | ❌ | 壳层**不得**为记忆屏补渲染钩子（会造成 `renderManagePage` 双调用）；也不得建第二个记忆宿主（INV-2b） |
| **`OfflineIndicator`** | **DOM 迁移**：`topbar.prepend(#nav-offline-led)`，节点移动 | ❌ **严禁**调用 `mount()` | 单例已由 `app.js:4532` 挂载完毕；壳层只搬容器，不碰实例（§1.3） |
| **`OfflineProbe`** | **只读订阅**（仅桌面侧栏文字态镜像需要）：`getInstance().onChange(cb)` | ✅ 仅 `onChange` / `getState` | **绝不** `start()`（会叠加第二个 30s 探测周期）。只读订阅不新增网络请求，不违反铁律 2 |
| **`Voice`** | **不接触** | ❌ | `Voice` 无自有 DOM（V16）。壳层只搬 `#btn-tts` / `#btn-call` 两个**按钮节点**，其监听器由 `app.js` 持有，节点移动即保留 |
| **`DiagnosticReport`** | **不接触** | ❌ | QR 宿主为 `document.body`（V17），与壳层无交集 |
| **`ConsentStore` / `AuditProbe`** | **不接触** | ❌ | 壳层不读写任何同意态与审计态 —— 这是隐私边界零改动的保证 |

> **协作原则一句话**：`UiShell` 只与**两类东西**交互 —— 它自己创建的 DOM，以及 `PrivacyAudit` 这一个需要新宿主的组件。其余模块一律"只搬节点、不碰实例、不调 API"。

### 2.3 `UiShell` 内部结构（单文件，IIFE，零依赖）

```
window.UiShell = {
  version: 'd1',
  state: { current, prev, screens, mounted },   // 只读镜像，非真源
  mount(),            // 幂等；返回 Boolean（是否进入壳层形态）
  go(routeOrPage),    // 语义化跳转 → 内部转发 tab.click()
  syncNavActive(page) // 双栏高亮镜像 + aria-current
}
```

内部（不导出）：`SCREENS` 屏注册表、`buildTopbar()`、`buildSidebar()`、`adoptGlobals()`、`retireModal()`、`bindDelegate()`、`initHashRouter()`、`enterHooks`、`rollback()`。

---

## 3. 冻结线不变量声明

### 3.1 绝不碰的四个文件（CI 级字节闸）

| 冻结文件 | 字节数（必须精确相等） | 已实测 | 本候选是否出现在改动清单 |
| --- | --- | --- | --- |
| `ai-girlfriend/engine.js` | **251068** | ✅ 251068 | **否** |
| `ai-girlfriend/sw.js` | **13723** | ✅ 13723 | **否** |
| `ai-girlfriend/memory.js` | **13333** | ✅ 13333 | **否** |
| `ai-girlfriend/test/baseline.js` | **2646** | ✅ 2646 | **否** |

附带纪律：`manifest.json`（592B）按既有约定视为冻结指纹（`DESIGN-xinyu-v3-privacy.md:93`），本候选**不改 manifest**（不新增 icon、不改 `name`/`short_name`，从而不触碰「小暖」相关指纹）。

字节闸可直接复用 `test/qa-c-privacy-acceptance.test.js:32-37` 的 `FROZEN` 常量表 + `:321-326` 精确断言 + `:328` 全仓库零漂移闸。

### 3.2 声明

> **候选 D 的架构方案在结构上不需要、不允许、也不产生对上述四文件的任何修改。** 任一字节不等即整体否决（AC-D26），无豁免通道。

### 3.3 为何本方案**物理上**不碰冻结线（结构性论证，非承诺性论证）

这一节回答的是"为什么不是靠纪律，而是靠结构"。

| 冻结文件 | 它是什么 | 与本候选的交集 | 结论 |
| --- | --- | --- | --- |
| `engine.js` | **纯函数库**（`Engine.reply` / `moodOfDay` / `moodProject` / `dayLifeGen` / `getLevel` 等），由 `app.js` 单向调用 | 不含任何 DOM / CSS / 视图 / 路由代码。本候选**不新增**任何 `Engine.*` 调用，**不改变** `app.js` 调用它的时机与参数 | **零交集** |
| `sw.js` | 只管缓存（cache key=19）的 Service Worker | 新增的 `ui-shell.js` 由 `index.html` 直接 `<script>` 引入，走 `sw.js` **既有同源 fetch 策略**，无需登记预缓存清单。若未来离线首屏需要它，走候选 C 已验证的独立命名空间 `xinyu-edge-v1` + `CacheWarmer`（`app.js:4543`），**绕开 key=19**（对齐 PRD D-Q7 裁决 (a)） | **零交集** |
| `memory.js` | v13 引擎注册模块（`Engine.use`），无 UI | 本候选不注册、不注销任何引擎模块 | **零交集** |
| `test/baseline.js` | 差分断言基线的单一真源，仅在**重置基线**时改动 | 本候选不重置基线；新增验收测试落在**新文件** `test/qa-d-ui-acceptance.test.js` | **零交集** |

**结构性保证的三条来源**：

1. **依赖方向**（§2.1）：`ui-shell.js` 的依赖闭包 = `{document, window, location, localStorage, window.PrivacyAudit, window.OfflineProbe}`。四个冻结文件**不在闭包内**，且 L4 → L1 无边。
2. **改动清单封闭性**（§4.1）：本候选改动清单只有 5 个文件，四个冻结文件不在其中，且清单本身由 AC-D27 全仓库零漂移闸把关 —— 即使误改也**必然**在 CI 被拦截。
3. **不需要改**（DEV-1 的收益）：`app.js` 路由是开放映射而非白名单，新屏无需注册；`app.js:4498` 的记忆 Tab 幂等守卫使 HTML 声明后注入自动空转。因此**连 `app.js` 都不需要改**，更不可能上溯到冻结线。

### 3.4 其余两条铁律的架构保证

| 铁律 | 架构级保证 |
| --- | --- |
| **小暖不更名** | 壳层新增的涉及角色名的导航项（如「小暖」项）**必须**复用既有 `data-xn="name"` 占位机制（先例：`index.html:52,672`），由 `applyCharIdentity()` 注入，**禁止硬编码角色名字面量**。这同时保证性别切换（小暖 / 阿言）后导航文案同步（AC-D29）。侧栏项文案若为角色名，走 `<span data-xn="name">小暖</span>`。 |
| **隐私零上报** | `ui-shell.js` 的**代码级禁令**：不得出现 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `EventSource` / `new Image().src` / 动态 `<script src>` / `<link href>` 任一形式。壳层唯一持久化是 `localStorage['xinyu.ui.lastScreen']`（新命名空间，不与 `xinyu.consent` / `xinyu.ltm.*` / `xinyu.voice.*` 冲突）。壳层对 `OfflineProbe` **只读订阅不启动**，不产生新探测流量。AC-D30/D31 双重把关。 |
| **前端零新增 npm 依赖** | `ui-shell.js` 为原生 IIFE，无 `import` / `require`；CSS 只用原生 `@media` / `grid` / `flex`。`package.json`（868B）/ `package-lock.json`（232B）**逐字节不变**（AC-D32）。 |

---

## 4. 实现边界

### 4.1 文件级改动契约（CI 白名单）

| 文件 | 类型 | 允许的改动 | 明令禁止 |
| --- | --- | --- | --- |
| `ai-girlfriend/ui-shell.js` | **新增** | 全部（挂 `window.UiShell`，IIFE，零依赖） | 任何网络调用；任何 `import`/`require` |
| `ai-girlfriend/index.html` | 改动（**仅追加 / 仅重排**） | ① 追加 `#page-privacy` 屏骨架（与其它 `.page` 同级）；② `.tabbar` 补 `ltm-manage` / `privacy` 两项**声明式** `.tab`；③ 在**第 714 行之后**追加 `<script src="ui-shell.js"></script>`；④ 设置屏语音 4 卡换组 + `.me-group-count` 计数修正 | 删除任何既有节点；修改任何既有控件 `id`；改 `<title>`；减少 `data-xn` 占位节点数 |
| `ai-girlfriend/style.css` | 改动（**仅文件末尾追加**） | 壳层 grid / 侧栏 / 顶栏 / 三档 `@media` / 隐私屏桌面双列 | 修改 `:62`（`#app`）、`:63-64`（`.page` / `.page.active`）、`:41`（`.hidden`）、`:324-327`（`.tabbar`）等任一既有规则；移除 `.hidden` 的 `!important`（INV-5） |
| `ai-girlfriend/app.js` | **零改动（确定结论，非理想目标）** | —— | 见 §4.2 |
| `ai-girlfriend/test/qa-d-ui-acceptance.test.js` | **新增（建议）** | D 组验收 + 复用 `FROZEN` 字节闸 | 改动任何实现文件 |
| `docs/DESIGN-xinyu-v3-ui-arch.md` + 2 个 `.mermaid` | **新增** | 本次交付 | —— |
| **`engine.js` / `sw.js` / `memory.js` / `test/baseline.js`** | **零改动（冻结线）** | —— | **全部** |
| `privacy-audit.js` / `privacy-audit.css` / `ltm-ui.js` / `consent-ui.js` / `local-model-ui.js` / `offline-indicator.js` / `voice.js` | **零改动** | —— | 本候选不改任何既有 JS 模块。桌面双列排布由 `style.css` 追加实现，不动 `privacy-audit.css` |

### 4.2 `app.js` 零改动的论证（DEV-1 的直接收益）

PRD §6.7 把 `app.js` 定为"**理想**为零改动"。核实后可以**上调为确定结论**：

| 原本担心需要改的地方 | 核实结果 | 是否需改 |
| --- | --- | --- |
| 新屏 `privacy` 要注册进 `screens` 白名单 | **白名单不存在**（DEV-1）。`app.js:2994` 是 `$("#page-" + tab.dataset.page)` 开放映射 → `data-page="privacy"` 自动解析到 `#page-privacy` | ❌ 不需要 |
| 记忆 Tab 声明式化后会出现双 Tab | `app.js:4498` 已有幂等守卫，HTML 先声明 → 注入空转 | ❌ 不需要 |
| ⚙ 换绑需要 `removeEventListener` | `cloneNode(true)` 不复制监听器 → 旧绑定自然失效 | ❌ 不需要 |
| 侧栏节点晚于 `bindTabs()` 创建，需要重新调用 `bindTabs()` | 事件委托 + 转发（ADR-4）与 `bindTabs()` 时序**完全解耦** | ❌ 不需要 |
| LED / `#nav-status` 迁移后选择器失效 | `app.js:4530`、`app.js:686` 均为无根 id 查询，迁移后仍命中 | ❌ 不需要 |
| 隐私屏进入钩子要写进 `bindTabs()` | 壳层用自己的 document 级委托监听器实现，与 `bindTabs()` 并行 | ❌ 不需要 |

> **结论：`app.js` 字节数应当与重构前完全一致。** 建议把 `app.js` 也纳入 AC-D27 的零漂移断言（比 PRD 的"可选追加"更严）。若实现期确实出现必须改 `app.js` 的情形，视为**架构假设被推翻**，须回到本文档重新裁决，不得就地打补丁。

### 4.3 `data-page` 契约（复用，不扩展）

契约定义（既有，`app.js:2986-3017`）：

```
任何带 class="tab" 且带 data-page="<P>" 的元素，被点击时：
  1. 清除全部 .tab 的 .active 与全部 .page 的 .active
  2. 自身加 .active
  3. 解析目标容器：P === 'ltm-manage' ? #ltm-manage : #page-<P>
  4. 目标容器加 .active
  5. 执行 P 相关既有副作用（chat-dot / scrollBottom / refreshStoryUI /
     refreshRecentUI / LTMUI.renderManagePage+bindToggle / ltmDistill）
```

壳层的**契约遵从义务**：

| 规则 | 内容 |
| --- | --- |
| C1 | 壳层创建的导航元素**必须**带 `class="tab"` + `data-page="<P>"`，且 `<P>` 取自 §4.4 屏注册表，不得自造 |
| C2 | 壳层创建的导航元素**必须**额外带 `data-xn-nav="shell"` 标记，用于委托handler 区分"壳层节点（需转发）"与"tabbar 原生节点（已被 `bindTabs` 绑定）" |
| C3 | 壳层**不得**为任何 `data-page` 复制切屏逻辑（清 active / 加 active / 解析容器），只能转发 |
| C4 | 壳层**不得**新增第 7 个 `data-page` 值（导航预算上限 6，AC-D7） |
| C5 | `ltm-manage` 的 `data-page` 值与容器 id `#ltm-manage` **一律不改名**（改名需动 `app.js:2992-2995` 特判 → 违反 §4.2）。对外用 hash 别名 `#/memory` 消化命名不一致 |

### 4.4 屏注册表（`SCREENS`，壳层内唯一的屏真源定义）

| # | 屏 | `data-page` | 容器 id | hash 路由 | 顶栏上下文操作 | 壳层进入钩子 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 💬 对话 | `chat` | `#page-chat`（既有） | `#/chat`（默认） | 😊 📞 🔊 🔍 | 仅设 `data-screen` |
| 2 | 👧 小暖 | `her` | `#page-her`（既有） | `#/her` | 无 | 仅标题 |
| 3 | 📖 故事 | `story` | `#page-story`（既有） | `#/story` | 无 | 仅标题 |
| 4 | 🧠 记忆 | `ltm-manage` | `#ltm-manage`（既有） | `#/memory`（别名） | 无 | **无**（渲染归 `app.js:3004-3010`） |
| 5 | 🔒 隐私 | `privacy` | `#page-privacy`（**新增**） | `#/privacy` | 无 | **首次 `render` + 每次 `refreshMetrics`** |
| 6 | ⚙️ 设置 | `me` | `#page-me`（既有） | `#/settings`（别名） | 🔍 设置搜索 | 仅标题 |

- 别名映射（`memory` ↔ `ltm-manage`、`settings` ↔ `me`）是**刻意设计**：对外 URL 语义清晰，对内保留历史 id 不改名（C5）。
- `state.current` **不是真源**，真源是 DOM 上的 `.page.active` / `.tab.active`。`state.current` 只是镜像缓存，用于标题 / `data-screen` / hash 同步 —— 避免"双真源不一致"缺陷。

### 4.5 CSS 边界

**允许**（`style.css` 末尾追加）：

```css
/* ===== 候选 D · 统一导航壳（仅追加，不修改任何既有规则） ===== */
#shell-sidebar { display: none; }                 /* 默认不存在 */
#shell-topbar  { z-index: 5; }                    /* 继承 .nav 层级，硬上限 <30 */

@media (min-width: 768px) and (max-width: 1023.98px) {
  #app { max-width: 720px; }
}

@media (min-width: 1024px) {
  #app {
    max-width: none;                              /* 解除 560px 锁（R2 / AC-D9） */
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);  /* minmax(0,·) 必须：防撑破（R3 / AC-D48） */
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: "sidebar topbar"
                         "sidebar main";
  }
  #shell-sidebar { display: flex; grid-area: sidebar; z-index: 6; }
  #shell-topbar  { grid-area: topbar; }
  .page          { grid-area: main; }             /* ADR-3：屏直接落 main 区，不重父 */
  .tabbar        { display: none; }
  .me-body, .her-body, .story-body, .ltm-body,
  .xn-audit-body { max-width: 860px; margin-inline: auto; }
  /* 隐私屏桌面双列（privacy-audit.css 零改动） */
  #page-privacy .xn-audit-body {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }
}
```

**禁止**：

| 禁令 | 理由 |
| --- | --- |
| 不得修改 `style.css:63-64` 的 `.page` / `.page.active` | 屏切换机制是既有真源，`bindTabs()` 依赖它。壳层只改**排布**，不改**显隐机制** |
| 不得修改 `style.css:62` 的 `#app` 基础规则 | 只能在 `@media(min-width:1024px)` 内覆盖 `max-width` 与 `display` |
| 不得移除 `style.css:41` 的 `.hidden{...!important}` | INV-5：它是 `#app` id 特异性下唯一能压住 `display:grid` 的机制（NEW-3） |
| 不得给壳层任何元素设 z-index ≥ 30 | 会遮挡 `.search-panel`(30) 及以上全部浮层（R10 修正版，§1.6） |
| 不得修改 `privacy-audit.css` | 桌面双列用后代选择器 `#page-privacy .xn-audit-body` 在 `style.css` 内实现 |
| 不得用 JS 读取视口宽度做布局分支 | 响应式必须纯 CSS，零 JS 测量（§7） |

---

## 5. 架构不变量（INV）

这些是**任何实现、任何后续候选都不得违反**的约束。每条都有对应的可执行验收。

| ID | 不变量 | 依据 | 违反后果 | 验收 |
| --- | --- | --- | --- | --- |
| **INV-1** | **屏切换单真源**：`.page.active` 的增删只能由 `app.js:2986-3017` 的 `bindTabs()` 处理器执行。壳层只能转发点击 | §4.3 C3 | 双屏叠加 / 空屏 / 副作用（蒸馏钩子）丢失 | AC-D1 / AC-D10 |
| **INV-2** | **单宿主渲染**：`PrivacyAudit` 全文档只允许一个渲染宿主，`#xn-*` id 必须全局唯一 | §1.2（`refreshMetrics` 结构上无法作用域化） | **静默失败**：指标永远停在「…」/「—」，无任何报错 | AC-D19 / AC-D20 |
| **INV-2a** | **`LocalModelUI` 单宿主**：`#xn-lm-status` / `#xn-lm-progress` / `#xn-lm-weights` / `#xn-lm-unload` 全局唯一（隐私屏是唯一宿主） | §1.2（`local-model-ui.js:74,81,88,150,160`） | 端侧模型进度/权重显示写错节点 | 新增断言（§10 修订 3） |
| **INV-2b** | **`LTMUI` 单宿主**：`#ltm-switch` / `#ltm-list` / `#ltm-filters` / `#ltm-cap-fill` / `#ltm-cap-text` / `#ltm-off-tip` / `.ltm-danger` / `.ltm-capacity` / `.ltm-header` 全局唯一（记忆屏 `#ltm-manage-body` 是唯一宿主） | §1.2（`ltm-ui.js:99-110,133,147-148,155,218,231,305`） | 记忆总开关/容量条/列表写错节点；桌面端**禁止**做"侧栏记忆预览"之类第二宿主 | 新增断言（§10 修订 3） |
| **INV-3** | **实例不重建**：`OfflineIndicator` / `ConsentUI` / `LocalModelUI` / `LTMUI` 的单例与已绑监听器不得因布局重构而重建。全局态 DOM 只允许**移动**（`prepend`/`appendChild`），不允许 `cloneNode` 后丢弃原节点（唯一例外：`#btn-privacy-audit` 的刻意换绑） | §1.3 | 双 LED / 状态分裂 / 开关失灵 | AC-D12 / AC-D13 |
| **INV-4** | **形态互斥**：隐私屏与隐私弹窗**永不并存**。壳层挂载成功 → 屏形态、弹窗 body 退役；壳层挂载失败 → 弹窗形态、不建屏 | PRD §4.5 / R12 | 重复 id（违反 INV-2）或"弹窗已拆、屏未建成"双失态 | AC-D15 / AC-D43 |
| **INV-5** | **`.hidden` 的 `!important` 承重**：`style.css:41` `.hidden{display:none !important}` 不得弱化 | NEW-3 | 桌面端 `#app{display:grid}`（id 特异性）击穿启动隐藏 → 闪现未初始化界面 / 跳过启动页 | 新增断言（§10 修订 3） |
| **INV-6** | **grid 流出禁令**：`#app` 变 grid 后，其全部直接子节点必须**或脱离流（fixed）、或被显式指派 grid-area、或 `display:none`**，不得存在隐式自动放置项 | NEW-1 / NEW-2 | 屏逃出内容区、撑出隐式行、布局错位 | AC-D3 / AC-D10 |
| **INV-7** | **零上报**：`ui-shell.js` 内不得出现任何外发原语（`fetch`/`XHR`/`WebSocket`/`sendBeacon`/`EventSource`/动态 `src`/`href`）；不得 `OfflineProbe.start()` | §3.4 | 违反铁律 2 | AC-D30 / AC-D31 |
| **INV-8** | **角色名占位**：壳层新增的涉及角色名的文案必须走 `data-xn="name"` 占位，禁止硬编码 | §3.4 | 性别切换（小暖 / 阿言）后导航文案不同步；触碰「小暖不更名」铁律边界 | AC-D28 / AC-D29 |
| **INV-9** | **层级上限**：壳层任何元素 z-index < 30 | §1.6 | 遮挡 `.search-panel` / `.day-detail` / `#ltm-corner` / 各模态 | AC-D35 |

---

## 6. 模块挂载时序与降级

### 6.1 加载顺序契约

```
index.html
  …
  :710  <script src="offline-indicator.js"></script>
  :711  <script src="privacy-score.js"></script>
  :712  <script src="diagnostic-report.js"></script>
  :713  <script src="local-model-ui.js"></script>
  :714  <script src="app.js"></script>            ← 当前最后一个
  :715  <script src="ui-shell.js"></script>       ← 新增，必须在此位置（最末）
```

**为什么必须最末**（三个硬理由）：

1. 壳层要迁移的 `#nav-offline-led` 已由 `app.js:4532` 挂载 LED 实例 —— 早于它则搬到的是空容器，且会诱使实现者去调 `mount()`（违反 INV-3）。
2. 壳层要 clone 换绑的 `#btn-privacy-audit` 由 `app.js:4682-4691` **运行时创建** —— 早于它则节点不存在。
3. `app.js:4719` 用 `document.addEventListener("DOMContentLoaded", init)` 注册；`ui-shell.js` 在其**后**注册同类监听器，按注册顺序在 `init()` **之后**执行。这是壳层"后到"的机制保证。

### 6.2 挂载时序（两阶段提交）

时序图见 `sequence-diagram-xinyu-v3-ui.mermaid` 图 1。

```
DOMContentLoaded
 ├─ [既有，零改动] app.js init()
 │     :4497-4503  注入记忆 Tab（HTML 已声明 → 幂等守卫命中 → 空转）
 │     :4505       bindTabs()          ← 绑定全部 6 个声明式 .tab
 │     :4512       bindPrivacyAudit()  ← 创建 ⚙（晚于 bindTabs，NEW-4）
 │     :4527-4541  OfflineIndicator.getInstance().mount(#nav-offline-led)
 │     :4592       #app 解除 .hidden
 │
 └─ [新增] UiShell.mount()
    ┌── 阶段 P1：纯增量，全可逆 ─────────────────────────────────────┐
    │ P1-1 建 #shell-topbar（插为 #app 首子）、#shell-sidebar         │
    │ P1-2 校验 #page-privacy 存在（index.html 声明式），否则中止      │
    │ P1-3 迁移全局态节点（移动，不重建 — INV-3）：                    │
    │        topbar.prepend(#nav-offline-led)                        │
    │        topbar ← #nav-avatar #nav-name #nav-status #nav-mood     │
    │        topbar.ctx ← #btn-call #btn-tts #btn-search              │
    │ P1-4 ⚙ clone 换绑：fresh = old.cloneNode(true)（不复制监听器）  │
    │        → old.replaceWith(fresh) → topbar.append(fresh)          │
    │        → fresh.className='tab'; fresh.dataset.page='privacy';   │
    │          fresh.dataset.xnNav='shell'                            │
    │ P1-5 侧栏渲染 6 项（data-xn="name" 占位 — INV-8）+ #chat-dot     │
    │        镜像 + LED 文字态镜像（只读订阅 OfflineProbe.onChange）    │
    │ P1-6 document 级点击委托（ADR-4）+ syncNavActive                │
    │ P1-7 hash 路由初始化（hash 优先 > lastScreen > chat）            │
    │ P1-8 注册隐私屏进入钩子                                          │
    └────────────────────────────────────────────────────────────────┘
                      ▼ 全部成功（安全点）
    ┌── 阶段 P2：破坏性，仅在 P1 全绿后执行 ──────────────────────────┐
    │ P2-1 退役弹窗渲染宿主（满足 INV-2 / INV-4）：                    │
    │        #privacy-audit-body → id 改为                            │
    │        'privacy-audit-body-retired'                             │
    │        + data-xn-deprecated="1" + innerHTML=''                  │
    │ P2-2 state.mounted = true；#app 打标 data-xn-shell="1"          │
    └────────────────────────────────────────────────────────────────┘
```

**为什么 P2 用「改 id」而不是「删节点」**（架构裁决）：

- **可逆**：回滚只需把 id 改回，节点、层级、样式全在原位；删除则需重建 DOM 结构。
- **对退役路径安全**：`openPrivacyAudit()`（`app.js:4707-4716`）会 `document.getElementById("privacy-audit-body")` → 改名后返回 `null` → `PrivacyAudit.render(null)` 在 `privacy-audit.js:90` 的 `if (!container) return;` **安全空转**，不抛错、不产生重复 id。
- **该路径实际不可达**：`grep` 确认 `openPrivacyAudit` 的唯一绑定点是 `app.js:4691`，而该按钮已在 P1-4 被 clone 替换 → 旧监听器随旧节点一同丢弃。P2 只是**纵深防御**。

### 6.3 各屏懒渲染策略

| 屏 | 渲染时机 | 渲染方 | 壳层是否介入 |
| --- | --- | --- | --- |
| 对话 | 启动期一次（`renderAllMessages()`，`app.js:4555` 附近） | `app.js` | ❌ |
| 小暖 | 每次进入（`refreshRecentUI()`，`app.js:3001`） | `app.js`（`bindTabs` 内） | ❌ |
| 故事 | 每次进入（`refreshStoryUI()`，`app.js:3000`） | `app.js`（`bindTabs` 内） | ❌ |
| 记忆 | 每次进入（`LTMUI.renderManagePage()` + `bindToggle()`，`app.js:3004-3010`） | `app.js`（`bindTabs` 内） | ❌ **严禁介入**（重复渲染风险 + INV-2b） |
| **隐私** | **首次**进入 → `render(#privacy-audit-body-page)`；**每次**进入 → `refreshMetrics()` | **`UiShell` 进入钩子** | ✅ 唯一介入点 |
| 设置 | 启动期一次（`initMeGroups()` / `initMeSearch()`，`app.js:4558`） | `app.js` | ❌ |

**隐私屏"首次 render + 每次 refresh"的裁决依据**：

- 既有弹窗语义是**每次打开都 `render`**（`app.js:4711-4713`），这是已验证路径。核实 `ConsentUI.render()` 会先 `container.innerHTML=''`（`consent-ui.js:58`）→ 重渲染**不会**堆叠开关（AC-D21 的"恒为 4 个开关"因此成立）。故"每次 render"在功能上也是安全的。
- 但**首次 render + 每次 refresh 更优**，理由是：① 避免 `LocalModelUI` 的下载进度 UI（`#xn-lm-progress`）在渲染中途被 innerHTML 清空；② 避免用户已展开/滚动的状态被重置；③ `refreshMetrics()` 本身就是 `render()` 末尾（`privacy-audit.js:187`）调用的同一函数，语义等价。
- **实现要求**：钩子内必须先判 `#privacy-audit-body-page.childElementCount === 0` 决定是否 render，且 `refreshMetrics()` 返回 Promise，需 `.catch()` 兜底（它内部已有 `.catch` 写「—」，`privacy-audit.js:254-259`）。

### 6.4 进入钩子的副作用边界（关键）

**钩子执行顺序保证**：`bindTabs()` 的处理器是**直接绑定**在 `.tab` 节点上（`app.js:2988`），壳层的委托监听器挂在 `document` 上（冒泡阶段）。DOM 事件传播保证 **目标节点的监听器先于祖先的监听器执行** → 壳层钩子运行时 `.page.active` **已经**切换完毕，可安全渲染。

| 副作用 | 归属 | 壳层禁令 |
| --- | --- | --- |
| 清/加 `.page.active` `.tab.active` | `bindTabs()` | 不得复制（INV-1） |
| `#chat-dot` 隐藏 + `scrollBottom()` | `bindTabs()` | 不得复制 |
| `refreshStoryUI()` / `refreshRecentUI()` | `bindTabs()` | 不得复制 |
| `LTMUI.renderManagePage()` + `bindToggle()` | `bindTabs()` | **不得复制**（会双渲染） |
| `ltmDistill()` 蒸馏钩子 | `bindTabs()` | 不得复制、不得绕过。壳层转发 `.click()` 即自动触发（AC-D41 因此成立） |
| `PrivacyAudit.render` / `refreshMetrics` | **`UiShell`** | 壳层唯一的副作用职责 |
| 顶栏 `data-screen` / 屏标题 / 侧栏高亮镜像 / hash 同步 | **`UiShell`** | 纯 UI 层，无业务副作用 |

> **一句话**：壳层的进入钩子**只允许做两件事** —— 渲染隐私屏、更新壳层自身外观。其余一律转发给 `bindTabs()`。

### 6.5 降级策略（P3 / R12）

| 失败场景 | 检测点 | 降级行为 | 结果 |
| --- | --- | --- | --- |
| `#page-privacy` 不存在（index.html 未更新） | P1-2 | 立即中止，不进入 P2 | 保持 4+1 Tab + 弹窗形态 |
| `#btn-privacy-audit` 尚未创建（`init()` 未跑完） | P1-4 | **有限次 `requestAnimationFrame` 重试（≤10 次）**；超时则**跳过该步并记录**，其余步骤继续 | ⚙ 仍是弹窗入口；但 6 屏导航可用。**不得**因此中止整体挂载 |
| `#nav-offline-led` 不存在 | P1-3 | 跳过该步（`app.js:4530` 已有 `|| #page-chat .nav` 兜底，不会抛错） | LED 留在原处，其余正常 |
| P1 任一步抛异常 | 外层 `try/catch` | **`rollback()`**：移除壳层创建的节点、把已迁移的节点 `appendChild` 回原宿主、解绑委托、清 hash 监听；`state.mounted = false` | 退回现状形态，绝不白屏、绝不影响和小暖聊天 |
| P2 抛异常 | `try/catch` | 把 `#privacy-audit-body-retired` id 改回 `privacy-audit-body` | 恢复弹窗可用（INV-4 不破） |

**降级的四条硬要求**：

1. **绝不出现"弹窗已拆、屏未建成"**（R12）：结构上由两阶段提交保证 —— P2 是**唯一**破坏性步骤，且只在 P1 全绿后执行。
2. **绝不白屏**：`ui-shell.js` 全部逻辑包 `try/catch`；壳层节点创建失败不影响 `.page` 的既有显隐（`.page.active` 机制完全不依赖壳层）。
3. **绝不影响对话**：对话屏的消息流 `#chat-body`、输入栏 `.chat-input-bar` 从不被壳层触碰（ADR-3 使 `.page` 完全不重父）。
4. **降级可观测**：`window.UiShell.state.mounted` 为 `false` 且 `#app` 无 `data-xn-shell="1"` → QA 可一行断言判定形态（AC-D43）。

---

## 7. 响应式策略：纯 CSS，零 JS 测量

### 7.1 断点表

| 断点 | 形态 | 导航 | 内容区 | `#app` display |
| --- | --- | --- | --- | --- |
| **< 768px** | 手机 | `.tabbar` 可见（6 项）；`#shell-sidebar` `display:none` | 单列 100% | `flex`（**沿用既有 `style.css:62`，零覆盖**） |
| **768 – 1023.98px** | 平板 / 折叠屏 | `.tabbar` 保留；侧栏仍隐藏 | 单列，`max-width:720px` 居中 | `flex` |
| **≥ 1024px** | 桌面 | `#shell-sidebar` 可见（240px）；`.tabbar` `display:none` | 侧栏 240px + `minmax(0,1fr)`，解除 560px 锁 | `grid` |

### 7.2 零 JS 测量的架构意义（不只是"省代码"）

| 收益 | 说明 |
| --- | --- |
| **无布局抖动** | 不存在"JS 读宽度 → 改 class → 重排"的两帧闪烁；断点切换由浏览器在同一帧内完成 |
| **无 resize 监听** | 不需要 `matchMedia` / `ResizeObserver` / `window.onresize`，因此**不存在监听器泄漏**、不与既有滚动逻辑（`scrollBottom()`）竞争 |
| **降级天然安全** | 壳层 JS 挂载失败时，CSS 仍生效但侧栏为空、`.tabbar` 仍存在（<1024px）→ 形态退化而非崩坏 |
| **可静态验收** | AC-D2/D3/D4 可用 `getComputedStyle(...).display` 直接断言，无需等待 JS 稳定态 |
| **零上报友好** | 不采集任何设备/视口指标，与铁律 2 一致 |

### 7.3 三个必须写死的 CSS 细节（皆有踩坑史）

| # | 细节 | 为什么必须 |
| --- | --- | --- |
| 1 | 平板上界用 **`1023.98px`** 而非 `1023px` | 页面缩放 / 非整数 DPR 下，`max-width:1023px` 与 `min-width:1024px` 之间会出现 **1px 无人区**，两套导航同时消失（AC-D4 正是为此设立） |
| 2 | 桌面用 **`grid`** 而非 `flex` | 侧栏需**跨越顶栏与内容区两行**（`grid-area: sidebar` 占两行）。`flex` 做不到，除非新增包裹层 —— 而新增包裹层就必须重父 `.page`（违反 ADR-3） |
| 3 | **`minmax(0, 1fr)`**（列与行都要） | grid 项默认 `min-width/min-height: auto`，会被子内容（聊天长消息、`#cloud-export` textarea、超长存档码）撑破 → 横向滚动条（R3 / AC-D48）。行方向的 `minmax(0,1fr)` 同时为 `.page{min-height:0}` + `#chat-body{flex:1;min-height:0}` 提供**确定高度**，消解 R4 高度塌陷 |

### 7.4 与既有响应式/可达性规则的关系

| 既有规则 | 处置 |
| --- | --- |
| `@media (min-width: 600px)`（`style.css:357-359`，只加左右边框） | **不动**。它与新增的 768/1024 断点正交（只影响边框），叠加无冲突 |
| `@media (prefers-reduced-motion: reduce)`（`style.css:1019`） | 屏切换过渡动效（PRD D-Q4 裁决：120ms 极简淡入）**必须**在该块内降级（AC-D45）。壳层不得在此块外定义无条件动画 |
| `env(safe-area-inset-top/bottom)`（`style.css:69`、`:326`） | 壳层顶栏必须沿用 `padding-top: calc(env(safe-area-inset-top,0px) + …)`；`.tabbar` 既有 `padding-bottom: env(safe-area-inset-bottom,0px)` 保持（AC-D46） |
| `height: 100dvh`（`style.css:62`） | **不动**。桌面 grid 下 `100dvh` 正是我们要的全高外框；移动端键盘弹起由 `dvh` 天然处理（AC-D47） |

---

## 8. 架构决策记录（ADR）

### ADR-1 · 全局名：`window.UiShell`（裁决 DEV-3）

- **背景**：架构任务书要求 `window.UiShell`；PRD §6.2 写 `window.XinyuShell`。
- **裁决**：**`window.UiShell`** 为唯一全局名。
- **理由**：① 与文件名 `ui-shell.js` 一致（仓库既有惯例：`ltm-ui.js`→`window.LTMUI`、`consent-ui.js`→`window.ConsentUI`、`local-model-ui.js`→`window.LocalModelUI`，全部是"文件名直译"）；② 现无任何代码引用 `XinyuShell`，改名成本为零；③ **不设别名** —— 双全局名会让"壳层是否挂载"的判定出现两个真源，与本架构处处强调的单真源原则矛盾。
- **影响**：PRD §6.2 的 `XinyuShell` 视为已废弃命名（§10 修订 1）。

### ADR-2 · 隐私屏骨架由 `index.html` **声明式**提供，不由 JS 创建

- **裁决**：`#page-privacy` + `#privacy-audit-body-page` 写在 `index.html`（与其它 5 个 `.page` 同级）。
- **理由**：① 与既有 5 屏形态一致，认知统一；② `.page` 默认 `display:none`，壳层挂载失败时该屏"存在但不可达"，**零副作用**；③ 让 P1-2 可以做一次**廉价前置校验**（屏不存在即中止），把失败点提前到破坏性操作之前；④ JS 建屏会让 `rollback()` 多一类需要清理的对象。
- **代价**：`index.html` 必须改（本已在改动清单内，PRD 附录 A）。

### ADR-3 · **`.page` 不重父**：用 `grid-area: main` 取代 `#shell-main` 容器（偏离 PRD §3.1）

- **背景**：PRD §3.1 设计了 `#shell-main` 容器"承载既有 `.page`"，隐含**把 5 个 `.page` 移入该容器**。核实 NEW-1 后重新评估。
- **裁决**：**不新建 `#shell-main`，不移动任何 `.page`。** 5 个既有 `.page` + 1 个新 `.page` 保持为 `#app` 直接子节点；在 `@media(min-width:1024px)` 内用 `.page { grid-area: main; }` 让它们全部落进同名 grid 区。
- **理由**：

  | 维度 | 移入 `#shell-main`（PRD 原案） | `grid-area: main`（本裁决） |
  | --- | --- | --- |
  | DOM 变更量 | 重父 5 个大体量 section（`#page-me` 一屏 353 行） | **0** |
  | 移动端布局风险 | `#shell-main` 必须补 `display:flex;flex-direction:column;flex:1;min-height:0` 才能让 `#chat-body` 正确滚动 —— 这个 shim 正是 R4 的成因 | 移动端 `#app` 仍是 flex，`.page` 仍是其直接 flex 子项，**与重构前逐像素一致**，R4 不成立 |
  | 回滚成本 | 需恢复 6 个节点的父子关系与**原始顺序** | **纯 CSS 生效/失效**，JS 侧无可回滚对象 |
  | 副作用风险 | 重父会触发 `#chat-body` 的重排，可能丢失滚动位置；对已绑监听器虽安全但无谓扰动 | 零扰动 |
  | 多屏落同一 `grid-area` 是否冲突 | —— | 不冲突：同一时刻只有一个 `.page` 是 `display:flex`，其余 `display:none` 不参与 grid 放置 |

- **副产物（INV-6 的完整解法）**：`#app` 的 11 个直接子节点全部被覆盖 —— 6 个 `.page` → `grid-area:main`；`#call-overlay`/`#games-overlay`/`#ltm-corner`/`#asr-consent-modal`/`#privacy-audit-modal` 全部 `position:fixed`（NEW-2 实测）→ 脱离流；`.tabbar` → `display:none`；`#shell-topbar`/`#shell-sidebar` → 显式 `grid-area`。**零隐式自动放置项。**
- **对 PRD 的兼容**：PRD 的心智模型（"顶栏 / 侧栏 / 内容区"三区 grid）**完全保留**，只是"内容区"从一个 DOM 容器变成一个**命名 grid 区**。§3.1 的 ASCII 结构图仍然成立，`#shell-main` 一行读作 `grid-area: main`。

### ADR-4 · 导航接线用 **document 级事件委托 + 转发**，不重新绑定

- **背景**：NEW-4 证明 `bindTabs()`（`app.js:4505`）**必然**早于壳层创建的侧栏节点与 clone 后的 ⚙ → 这些节点没有 `bindTabs` 的直接监听器。
- **裁决**：壳层在 `document` 上挂**一个** `click` 委托监听器（冒泡阶段），逻辑如下：

  ```
  onDocumentClick(ev):
    el = ev.target.closest('.tab[data-page]')
    if (!el) return
    if (el.dataset.xnNav === 'shell'):          # 壳层自建节点（侧栏项 / ⚙）
        peer = document.querySelector('.tabbar .tab[data-page="'+el.dataset.page+'"]')
        if (peer) peer.click()                  # 转发给持有 bindTabs 监听器的原生节点
        return                                  # 立即返回，不在此路径跑钩子
    # 走到这里 = 原生 .tabbar 节点（含被转发的合成点击）
    runShellHooks(el.dataset.page)              # 唯一的钩子执行点
  ```

- **为什么这样设计**：

  | 问题 | 本方案的解 |
  | --- | --- |
  | 侧栏/⚙ 点击不切屏 | 转发给 `.tabbar` 原生节点的 `.click()` → 复用 `bindTabs()`，INV-1 不破 |
  | 钩子被执行两次（侧栏冒泡 + 转发的合成点击冒泡） | 壳层节点分支**立即 `return`**，钩子只在原生节点分支执行一次 |
  | 无限转发循环 | 原生 `.tabbar` 节点无 `data-xn-nav="shell"`，不会被再次转发 |
  | 与 `bindTabs()` 时序竞态（R6 / NEW-4） | 委托挂在 `document`，与节点创建时机**完全解耦**；哪怕壳层比 `app.js` 先跑也不出错 |
  | 蒸馏钩子 / 故事刷新 / 记忆渲染丢失 | 全部由被转发的 `.click()` 触发，**自动继续生效**（AC-D41） |
  | 需要改 `app.js` 重新调 `bindTabs()` | 不需要（§4.2） |

- **代价**：一次 `.click()` 转发会产生一个额外的合成事件（可忽略）；委托挂在 `document` 需 `closest()` 判定（原生 API，零依赖）。

### ADR-5 · ⚙ 换绑用 `cloneNode` 断连，而非事件拦截

- **裁决**：`fresh = old.cloneNode(true); old.replaceWith(fresh);` 然后给 `fresh` 打上 `class="tab" data-page="privacy" data-xn-nav="shell"`。
- **理由**：`app.js:4691` 绑定的 `openPrivacyAudit` 是模块内部闭包，壳层**拿不到函数引用**，无法 `removeEventListener`。可选方案对比：

  | 方案 | 评价 |
  | --- | --- |
  | `cloneNode` + `replaceWith` | ✅ **彻底断连**（`cloneNode` 定义上不复制监听器）；旧监听器随旧节点被 GC；无残留可触发路径 |
  | capture 阶段 `stopImmediatePropagation` | ❌ 需要壳层监听器先注册（做得到），但"弹窗代码仍可被触发"的隐患长期存在；且任何未来的 capture 监听器都可能打破它 |
  | 直接 `modal.remove()` | ❌ 破坏降级路径（INV-4 需要弹窗作为 fallback），且不可回滚 |

- **配套**：`cloneNode(true)` 会连带复制 `id="btn-privacy-audit"` —— 因为原节点被 `replaceWith` 同时移除，**不产生重复 id**（AC-D14 断言 `length===1` 仍成立）。

### ADR-6 · 隐私屏"首次 render + 每次 refreshMetrics"

见 §6.3 的完整论证。要点：既有"每次 render"也安全（`ConsentUI` 先清空，不堆叠），但首次 render 可避免 `#xn-lm-progress` 下载进度被清空与滚动位置重置。**两者都必须只对唯一 root 调用**（INV-2）。

### ADR-7 · 壳层对 `OfflineProbe` **只读订阅，绝不 `start()`**

- **背景**：桌面侧栏底部需要一份 LED 的**文字态**镜像（"● 在线" / "网络不佳" / "离线 · 小暖仍在你手机里"），因为桌面用户距屏幕更远、纯色点可读性不足。
- **裁决**：镜像只调 `OfflineProbe.getInstance().onChange(cb)` + `getState()`；**禁止** `start()`。
- **理由**：`app.js:4536` 已 `start(30000)`。二次 `start()` 会叠加第二个探测周期 → 探测频率翻倍 → 虽仍是同源探测（不违反零上报字面），但**改变了既有网络行为**，触碰铁律 2 的精神，且会让 AC-D28（探测周期不变）失败。
- **同理**：镜像**不是**第二个 `OfflineIndicator` 实例（严禁 `mount()`，INV-3）—— 它只是一段订阅同一数据源的文本节点。`#nav-offline-led` 全局仍恒为 1（AC-D12）。

---

## 9. 风险台账（架构侧增补 PRD §8.1）

PRD 已列 R1–R14。本章只记录**架构核实后需要修订评级**或**PRD 未列**的风险。

| ID | 风险 | PRD 评级 | 架构修订 | 缓解归属 |
| --- | --- | --- | --- | --- |
| R1 | 隐私面板重复 id | 高/中 | **高/高**（结构性，见 §1.2）—— 不是"可能忘记"，而是"只要建了第二个宿主就必然发生" | INV-2 + 两阶段提交 P2 |
| R5 | LED DOM 迁移破坏实例 | 中/低 | **中/极低** —— `this._el` 持有子元素引用而非 anchor（§1.3），且 `mount()` 内有幂等守卫 | INV-3 |
| R6 | ⚙ clone 后未被 `bindTabs` 绑定 | 中/中 | **中/必然**（NEW-4：`bindTabs` 在 4505，`bindPrivacyAudit` 在 4512） | ADR-4（委托强制） |
| R4 | grid 内 `.page` 高度塌陷 | 中/中 | **中/低** —— ADR-3 使移动端零改动、桌面端由行 `minmax(0,1fr)` 提供确定高度 | ADR-3 + §7.3-3 |
| R10 | 浮层 z-index 冲突 | 中/中 | 维持 —— 但 PRD 把 `.xn-modal-mask` 误记为 99999，实为 **80**（`privacy-audit.css:11`）。完整阶梯见 §1.6 | INV-9（壳层 <30） |
| R13 | 误触冻结线 | 致命/低 | **致命/极低** —— §3.3 三重结构性保证 + AC-D26/D27 双闸 | INV 全体 |
| **NEW-1** | `#app` 变 grid 后隐式自动放置 | 未列 | **中/高**（若按 PRD 原案不重父又不指派 grid-area，则 `.page.active` 必然逃出内容区） | ADR-3 + INV-6 |
| **NEW-3** | `.hidden` 特异性被 `#app{display:grid}` 击穿 | 未列 | **中/低**（现状因 `!important` 而安全，但该 `!important` 未被任何文档保护） | INV-5 |
| **NEW-5** | `LTMUI` / `LocalModelUI` 的单宿主约束被后续"桌面双栏预览"类需求破坏 | 未列 | **中/中**（桌面宽屏会自然诱发"侧边预览记忆"的产品想法） | INV-2a / INV-2b 显式禁令 |
| **NEW-6** | 壳层二次 `OfflineProbe.start()` 使探测频率翻倍 | 未列 | **低/中** | ADR-7 |
| **NEW-7** | `UiShell` / `XinyuShell` 双全局名导致挂载态双真源 | 未列 | **低/中** | ADR-1（不设别名） |

---

## 10. 对 PRD 的修订建议

架构核实后需要产品/QA 侧确认的 4 项。**均不改变 PRD 的产品意图，只修正事实与判据。**

| # | 修订项 | 现状 | 建议 |
| --- | --- | --- | --- |
| **1** | 全局名 | PRD §6.2 `window.XinyuShell` | 改为 **`window.UiShell`**（ADR-1）。PRD §6.7、附录 A 的相应描述同步 |
| **2** | **AC-D18 判据（必须修）** | 「进入隐私屏计数 `.xn-audit-section` ≥ 8」 | 实测 `.xn-audit-section` = **7**，第 8 个逻辑分区「操作」是裸 `.xn-audit-actions`（`privacy-audit.js:154`）。**按原判据会误判失败**。建议改为：`.xn-audit-section` **=== 7** 且 `#privacy-audit-body-page > .xn-audit-actions` **=== 1**（合计 8 逻辑分区），并保留"8 个分区标题文案全部出现"的文案断言 |
| **3** | AC-D19 断言范围扩容 | 只覆盖 13 个 `#xn-*` id | 建议增加：① `#xn-lm-status` / `#xn-lm-progress` / `#xn-lm-weights` / `#xn-lm-unload`（INV-2a）；② `#ltm-switch` / `#ltm-list` / `#ltm-filters` / `#ltm-cap-fill` / `#ltm-cap-text` / `#ltm-off-tip`（INV-2b）；③ `getComputedStyle` 断言 `.hidden` 仍含 `!important` 语义 —— 即 `#app.hidden` 在 1440px 下 `display === 'none'`（INV-5）。共 23 项 id 唯一性断言 |
| **4** | `app.js` 改动边界收紧 | PRD §6.7「理想为零改动，可选追加」 | 改为**零改动（硬约束）**，并把 `app.js` 纳入 AC-D27 零漂移白名单之外（即 `app.js` 字节必须不变）。依据 §4.2 的逐条论证 —— 六个原本担心的改动点全部不成立 |

### 10.1 PRD 结论中被本次核实**加强**的部分

| PRD 结论 | 核实后 |
| --- | --- |
| §2.2「本候选天然不需要碰冻结线」 | ✅ 成立，且可给出更强的**结构性**论证（§3.3 三重保证） |
| §8 R1「单一渲染目标是硬约束不是建议」 | ✅ 成立，且是**结构性不可作用域化**（§1.2），应升级为架构不变量并泛化到 `LTMUI` / `LocalModelUI` |
| §3.5「DOM 迁移而非重建」 | ✅ 成立，`this._el` 持子元素引用（`offline-indicator.js:55`）是其机制基础 |
| §4.6 决策 D-2「本地模型双视图单真源」 | ✅ 成立，且更安全：两处 id 前缀 `#lm-*` vs `#xn-lm-*` **完全不相交**，不触发 INV-2 |
| §6.4「单向驱动：hash → `.tab.click()`，复用既有处理器」 | ✅ 这是本方案最关键取舍，架构完全采纳（ADR-4 是其一般化） |
| §8.2 Q1「不做 cloudSync 语义桥接，只做 UI 层一致性治理」 | ✅ 架构支持：`UiShell` 对 `ConsentStore` **零接触**（§2.2），双向深链与告警条是纯 UI 层，不改隐私语义 |
| §8.2 Q2「`tagConsented` 不实现」 | ✅ 无 UI 影响：`#xn-c-consented` 取自 `proveZeroReporting().consented`（`privacy-audit.js:198`），不依赖 `tagConsented` |
| §8.3 D-Q7「`ui-shell.js` 不纳入 sw 预缓存」 | ✅ 必须如此，纳入即改 `sw.js` = 违反冻结线 |

---

## 11. 交付边界

### 11.1 本次交付（仅文档，零源码改动）

| 文件 | 说明 |
| --- | --- |
| `ai-girlfriend/docs/DESIGN-xinyu-v3-ui-arch.md` | 本文档 |
| `ai-girlfriend/docs/class-diagram-xinyu-v3-ui.mermaid` | 组件/类图：`UiShell` + 6 屏 + 既有模块协作 |
| `ai-girlfriend/docs/sequence-diagram-xinyu-v3-ui.mermaid` | 时序图：① 挂载与两阶段提交 ② 屏切换/双栏镜像 ③ hash 深链 ④ 隐私屏进入钩子与单宿主 ⑤ 降级回滚 |

> **本次未改动任何 `.js` / `.html` / `.css` 源码。** 冻结线四文件字节数经 `wc -c` 实测与闸值精确相等（§3.1）。

### 11.2 明确不在架构范围（沿用 PRD §8.4）

- 任何新增业务功能；`cloudSync` 语义桥接（→ 候选 E）；`AuditProbe.tagConsented` 实现（→ 候选 C 后续批次）
- 主题/暗色扩展；国际化
- **任何冻结线文件的改动（永久排除）**
- 桌面侧栏折叠（PRD D-Q2 裁决 (a) 本期不做）；记忆/隐私屏二级 Tab（D-Q3 裁决 (a)）；设置屏二级下钻（D-Q6 裁决 (a)）

### 11.3 交给实现的检查清单（Definition of Ready）

- [ ] `ui-shell.js` 内 `grep -E "fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import |require\("` **零命中**（INV-7）
- [ ] `ui-shell.js` 内 `grep "OfflineIndicator"` 仅出现在注释中，无 `mount(` 调用（INV-3）
- [ ] `ui-shell.js` 内 `grep "start("` 无 `OfflineProbe...start` 调用（ADR-7）
- [ ] `ui-shell.js` 内无 `classList.add("active")` 作用于 `.page`（INV-1）
- [ ] `ui-shell.js` 内 `PrivacyAudit.render` 调用点**恰好 1 处**，且参数为 `#privacy-audit-body-page`（INV-2）
- [ ] 壳层新增 CSS 中无 `z-index` ≥ 30（INV-9）
- [ ] 侧栏角色名项使用 `data-xn="name"`，`grep` 确认无硬编码「小暖」字面量新增于 `ui-shell.js`（INV-8）
- [ ] `git diff --stat` 只出现 §4.1 白名单内文件；`wc -c` 四冻结文件 = 251068 / 13723 / 13333 / 2646
- [ ] `app.js` / `privacy-audit.js` / `ltm-ui.js` / `consent-ui.js` / `local-model-ui.js` / `offline-indicator.js` / `voice.js` / `package.json` / `package-lock.json` / `manifest.json` 字节数**全部不变**

---

*文档结束 · 高见远（Gao）· 心屿 Xinyu v3 候选 D 架构设计*
*产品名「心屿」、AI 女友名「小暖」全文不改、不替换、不意译。冻结线四文件零改动。*
