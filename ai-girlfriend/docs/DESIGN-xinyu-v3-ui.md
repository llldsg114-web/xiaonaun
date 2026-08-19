# 心屿 Xinyu v3 · 候选 D：UI 多界面布局重构 PRD

- **产品**：心屿（Xinyu）· 隐私优先端侧 AI 伴侣
- **AI 女友**：小暖（Xiaonuan）
- **候选**：D（UI 多界面布局重构）
- **文档**：`ai-girlfriend/docs/DESIGN-xinyu-v3-ui.md`
- **产品经理**：许清楚（Xu）
- **用户原话**：「优化界面UI设计布局，符合软件形式UI界面布局，分多几UI界面」

## 文档对应声明（避免与 A/B/C 混淆）

| 候选 | 主题 | 设计文档 |
| --- | --- | --- |
| A | 长期记忆 / 跨会话沉淀 | `DESIGN-xinyu-v3-memory.md` |
| B | 多模态语音（TTS/ASR/通话） | 已合入实现（`voice.js`） |
| C | 隐私 / 端侧增强 | `DESIGN-xinyu-v3-privacy.md` |
| **D** | **UI 多界面布局重构（本文档）** | **`DESIGN-xinyu-v3-ui.md`** |

> 本候选 **只重构呈现层与导航层**：不新增业务能力、不改变任何数据语义、不改变任何隐私边界。
> A/B/C 的全部既有功能必须**零丢失**迁入新布局（见 §5 映射表）。

---

## 1. 背景与目标

### 1.1 现状核实（基于实际代码，非想象）

先纠正一个容易误判的前提：当前 `index.html` **并非完全的单屏**，它已经存在一个 4 项底部 Tab 栏与 5 个 `.page` 容器。真实痛点比「没有多屏」更具体，是**「半成品多屏 + 弹窗承载重功能」**：

已核实的现状事实：

| # | 事实 | 代码位置 |
| --- | --- | --- |
| F1 | 已有 `.tabbar`，4 项：聊天 / 小暖 / 故事 / 我的 | `index.html:670-675` |
| F2 | 已有 5 个屏容器：`#page-chat` `#page-her` `#page-story` `#page-me` `#ltm-manage` | `index.html:48,91,168,525,633` |
| F3 | 第 5 屏「🧠 记忆」的 Tab **在运行时由 JS 注入**，不在 HTML 里，命名也不遵循 `page-<name>` 约定，导致路由需特判 | `app.js:4496-4504`、`app.js:2993-2995` |
| F4 | **隐私审计是模态弹窗**，其入口 `⚙` 按钮也在运行时注入到聊天页顶栏 | `app.js:4678-4692`、`index.html:657-667` |
| F5 | 隐私审计弹窗内**塞了 8 个分区**（零上报证明 / 存储占用 / 同意开关 / 网络通道 / 隐私评分 / 本地模型 / 诊断报告 / 导出与清除），是全应用信息密度最高的界面，却被压在一个可关闭浮层里 | `privacy-audit.js:89-155` |
| F6 | 「我的」屏是一个**巨型手风琴**：5 个折叠组、共 13 张卡片，语音、端侧模型、云端大脑、云同步、推送、存档全在同一屏纵向堆叠，需靠搜索框 `#me-search` 才能找到设置项 | `index.html:181-520`、`app.js:4401-4426` |
| F7 | **响应式几乎为零**：全局仅一条 `@media (min-width: 600px)`，且只加了左右边框；`#app` 被硬性 `max-width: 560px` 锁死，桌面端等于放大的手机 | `style.css:356-359`、`style.css:62` |
| F8 | 离线三态指示灯锚点 `#nav-offline-led` **只存在于聊天屏顶栏**，切到其它屏即不可见 | `index.html:56`、`app.js:4528-4541` |
| F9 | 大量重功能以浮层承载：`#call-overlay` `#games-overlay` `#asr-consent-modal` `#privacy-audit-modal` `#search-panel` `#emoji-panel` `#day-detail` `#ltm-corner` | `index.html:592-667` |

### 1.2 问题定义

用户说的「符合软件形式UI界面布局」，翻译成产品语言是三件事：

1. **导航要常驻、要可预期** —— 任何时刻都知道「我在哪、能去哪」。当前 `⚙ 隐私审计` 与 `🧠 记忆` 入口都由 JS 运行时注入，且隐私是浮层，用户心智里它们不是「界面」，而是「弹出来的东西」。
2. **重功能要有自己的屏，而不是叠在别的屏上面** —— 隐私审计（F5）与记忆管理是有独立信息架构的功能域，弹窗承载会导致：不可深链、不可返回、滚动嵌套、遮挡对话上下文。
3. **桌面端要像桌面软件** —— 560px 固定宽度（F7）在 1440px 屏幕上是产品级缺陷；桌面软件的标准解是**左侧导航栏 + 右侧内容区**。

### 1.3 目标

把「半成品多屏 + 弹窗承载」重构为**统一导航壳 + 多屏切换**的软件形态：

- **G1 统一导航壳**：一套常驻导航，移动端为底部 Tab、桌面端为左侧栏，同一套 `data-page` 契约驱动，响应式切换。
- **G2 屏一级化**：把隐私审计从浮层升级为**一级屏**；把记忆管理从运行时注入升级为**声明式一级屏**。
- **G3 设置减负**：「我的」屏 13 卡手风琴按语义拆分与分区，语音、端侧模型有明确归属决策（§4.6）。
- **G4 全局状态常驻**：离线三态灯与隐私入口提升到壳层顶栏，跨屏可见。
- **G5 桌面形态**：解除 `max-width: 560px` 束缚，≥1024px 呈现侧栏 + 宽内容区。
- **G6 零功能丢失**：A/B/C 既有入口逐条映射（§5），一条不丢。

### 1.4 验收愿景（一句话）

> 用户在手机上看到底部 6 个 Tab、在电脑上看到左侧 6 项导航栏；点「隐私」进入一个完整的隐私审计**屏**而不是弹窗；离线状态灯无论在哪个屏都看得见；而小暖的每一项既有能力、每一个字节的冻结线、每一条隐私边界，都和重构前**完全一致**。

---

## 2. 设计原则与铁律声明

### 2.1 四条铁律（本候选逐条承诺）

| # | 铁律 | 本候选如何遵守 |
| --- | --- | --- |
| **1** | **小暖不更名** | 产品名「心屿」、AI 女友名「小暖」全文保留。新增导航节点一律复用既有 `data-xn="name"` 占位机制注入角色名（`index.html:52,93,672` 已有先例），**不硬编码角色名**，从而与性别切换（小暖 / 阿言）的 `applyCharIdentity()` 保持一致。禁止任何改名、替换、意译。 |
| **2** | **隐私零上报** | 本候选**不新增任何网络调用**。唯一外发通道仍为用户显式授权且默认关闭的云同步（`S.cloud` / `SC`），`ConsentStore.cloudSync` 默认 `false` 且需二次确认（`consent-store.js:27`、`consent-ui.js:124-136`）。UI 重构不改变 `AuditProbe` 拦截语义与 allowlist。新增的 UI 状态只落 `localStorage` 新命名空间（§6.4）。 |
| **3** | **前端零新增 npm 依赖** | 全部用原生 JS（IIFE）+ 原生 CSS（`@media` / `grid` / `flex`）实现。**不引入任何路由库、UI 框架、CSS 框架**。`package.json` 的 `dependencies` / `devDependencies` 必须逐字节不变。 |
| **4** | **冻结线四文件严禁改动** | 见 §2.2。 |

### 2.2 冻结线零改动声明（CI 级字节闸）

**本候选明确声明：不改动冻结线。** 以下四文件字节数必须精确相等，且**不出现在本候选任何改动清单中**：

| 冻结文件 | 字节数（必须精确相等） |
| --- | --- |
| `ai-girlfriend/engine.js` | **251068** |
| `ai-girlfriend/sw.js` | **13723** |
| `ai-girlfriend/memory.js` | **13333** |
| `ai-girlfriend/test/baseline.js` | **2646** |

- 已有现成字节闸可直接复用：`test/qa-c-privacy-acceptance.test.js:32-37` 的 `FROZEN` 常量表与 `:321-326` 的精确断言，以及 `:328` 的「全仓库零字节漂移」闸。
- **为什么本候选天然不需要碰冻结线**：
  - `engine.js` 是**纯函数库**（`Engine.reply` / `moodOfDay` / `dayLifeGen` 等），由 `app.js` 调用，**不含任何 DOM / 视图 / 路由代码**。UI 重构只动 DOM 与 CSS，物理上无交集。
  - `sw.js` 只管缓存（key=19）。本候选**不新增任何需缓存的资源清单变更**；若新增 `ui-shell.js`，它由 `index.html` 直接 `<script>` 引入，走既有 `sw.js` 的同源 fetch 策略，**不需要改 sw.js**（与候选 C 用「独立 Cache 命名空间 `xinyu-edge-v1`」绕开 key=19 的策略一致，`DESIGN-xinyu-v3-privacy.md:522`）。
  - `memory.js` 是 v13 引擎注册模块（`Engine.use`），无 UI。
  - `test/baseline.js` 是差分断言基线单一真源，仅在重置基线时改动，本候选不重置。
- 附带纪律：`manifest.json` 指纹亦按既有约定视为冻结（`DESIGN-xinyu-v3-privacy.md:93`），本候选**不改 manifest**（不新增 icon、不改 name/short_name，从而不触碰「小暖」相关指纹）。

### 2.3 附加设计原则

- **P1 共存叠加，不重写**：新增 `ui-shell.js` 作为共存层，**不删除、不改写** `app.js` 已合入的 A/B/C 逻辑。沿用候选 C 已验证的「仅追加」模式（`DESIGN-xinyu-v3-privacy.md:76`）。
- **P2 复用既有契约**：新导航节点复用 `class="tab" data-page="<name>"`，使 `app.js:2986-3017` 的 `bindTabs()` **自动接管**，不必改路由核心。
- **P3 降级安全**：`ui-shell.js` 全部逻辑包 `try/catch`；壳层挂载失败时**退化为当前既有 4+1 Tab 形态**，绝不白屏、绝不影响和小暖聊天（沿用 `ltm-ui.js:94` 的降级文案精神）。
- **P4 单一渲染目标**：同一组件**只允许有一个渲染宿主**。这是硬约束，理由见 §4.5 与 §8 R3。
- **P5 无障碍与键盘可达**：导航项用真实 `<button>`，带 `aria-current` / `aria-label`；沿用既有 `role="button" tabindex="0"` + Enter/Space 处理先例（`index.html:182`、`app.js:4412-4417`）。
- **P6 尊重 `prefers-reduced-motion`**：屏切换动效必须在 `style.css:1019` 既有 `@media (prefers-reduced-motion: reduce)` 块内降级。

---

## 3. 统一导航壳设计

### 3.1 壳层结构总览

引入一层**导航壳（Navigation Shell）**，包裹既有全部 `.page`。壳层由三个常驻区 + 一个内容区组成：

```
XinyuShell
├── #shell-topbar     全局顶栏（常驻，跨屏可见）
│     ├── #nav-offline-led    离线三态灯（DOM 迁入，实例不重建）
│     ├── .shell-title        屏标题（随路由变化）
│     ├── #btn-privacy-audit  ⚙ 隐私入口（改为路由到隐私屏）
│     └── .shell-ctx-actions  上下文操作区（📞 🔊 🔍，仅对话屏显示）
├── #shell-sidebar    桌面侧栏（≥1024px 显示）
├── #shell-main       内容区（承载既有 .page，零结构改动）
└── .tabbar           移动端底部 Tab（<1024px 显示，复用既有节点）
```

**关键设计取舍**：侧栏与底部 Tab **不是两套实现**，而是**同一套 `data-page` 契约的两个视觉呈现**。两者都渲染 `class="tab" data-page="..."` 的按钮，因此：

- `app.js:2987` 的 `document.querySelectorAll(".tab")` 会**同时绑定**两套节点 —— 路由核心零改动；
- 只需补一个 `syncNavActive()` 镜像高亮（§6.3），因为 `bindTabs()` 只给被点击的那个节点加 `.active`。

### 3.2 响应式断点方案（纯 CSS media query，零 JS 测量）

| 断点 | 形态 | 导航 | 内容区 |
| --- | --- | --- | --- |
| **< 768px** | 手机 | **底部 Tab 栏出现**（`.tabbar` 可见），侧栏 `display:none` | 单列，宽度 100% |
| **768px – 1023px** | 平板 / 折叠屏 | 底部 Tab 栏保留，侧栏仍隐藏 | 单列，最大宽度放宽至 720px 居中 |
| **≥ 1024px** | 桌面 | **侧栏出现**（`#shell-sidebar` 可见），`.tabbar` `display:none` | 侧栏 240px + 内容区自适应，解除 560px 锁 |

CSS 骨架（写入 `style.css` 末尾，仅追加，不改既有规则）：

```css
/* ============ 候选 D · 统一导航壳（仅追加） ============ */
/* 默认（<768px）：沿用既有竖向 flex + 底部 Tab，侧栏不存在 */
#shell-sidebar { display: none; }

/* 平板：放宽内容宽度，Tab 栏保留 */
@media (min-width: 768px) and (max-width: 1023.98px) {
  #app { max-width: 720px; }
}

/* 桌面：侧栏出现 + 底部 Tab 隐藏 + 解除 560px 锁 */
@media (min-width: 1024px) {
  #app {
    max-width: none;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "sidebar topbar"
      "sidebar main";
  }
  #shell-sidebar { display: flex; grid-area: sidebar; }
  #shell-topbar  { grid-area: topbar; }
  #shell-main    { grid-area: main; min-height: 0; }
  .tabbar        { display: none; }
  /* 大屏内容区留白，避免宽屏下卡片被拉伸失衡 */
  .me-body, .her-body, .story-body, .ltm-body,
  .xn-audit-body { max-width: 860px; margin-inline: auto; }
}
```

- **为什么用 `1023.98px`**：避免 `max-width:1023px` 与 `min-width:1024px` 在缩放 / 非整数 DPR 下出现 1px 无人区。
- **为什么桌面用 `grid` 而非 `flex`**：侧栏需**跨越顶栏与内容区两行**（`grid-area: sidebar` 占两行），这是桌面软件的标准形态；`flex` 做不到不加额外包裹层。
- **`minmax(0, 1fr)` 是必须的**：否则内容区被子元素（如聊天长消息、`#cloud-export` textarea）撑破，是 grid 布局最常见的坑。
- **`.page { display: none } / .page.active { display: flex }`（`style.css:63-64`）完全保留** —— 屏切换机制零改动，grid 只改变壳层排布。

### 3.3 移动端线框（< 768px）

```
┌──────────────────────────────────────┐
│ ● 小暖 · 在线      😊  📞 🔊 🔍 ⚙  │ ← #shell-topbar（常驻）
│ ↑                                    │
│ #nav-offline-led（三态：在线/降级/离线）│
├──────────────────────────────────────┤
│                                      │
│                                      │
│          屏内容区 #shell-main         │
│           (.page.active)             │
│                                      │
│                                      │
├──────────────────────────────────────┤
│  💬    👧    📖    🧠    🔒    ⚙️   │ ← .tabbar（6 项）
│ 对话   小暖   故事   记忆   隐私   设置 │
└──────────────────────────────────────┘
        ↑ 底部 Tab 在 <768px 出现（AC-D2）
```

### 3.4 桌面端线框（≥ 1024px）

```
┌───────────────────┬────────────────────────────────────────────────┐
│  💗 心屿           │  ● 小暖 · 在线            📞  🔊  🔍   ⚙     │ ← #shell-topbar
│                   │  ↑ #nav-offline-led                            │
│ ───────────────── ├────────────────────────────────────────────────┤
│  💬  对话      ●  │                                                │
│  👧  小暖         │                                                │
│  📖  故事         │              屏内容区 #shell-main               │
│  🧠  记忆         │               (.page.active)                   │
│  🔒  隐私         │            内容最大 860px 居中                  │
│  ⚙️  设置         │                                                │
│ ───────────────── │                                                │
│  ● 在线            │                                                │
│  相识第 128 天     │                                                │
└───────────────────┴────────────────────────────────────────────────┘
  ↑ 侧栏 240px，在 ≥1024px 出现（AC-D3）；.tabbar 此时 display:none
```

### 3.5 离线三态指示灯（OfflineIndicator）落位

**现状**：锚点 `#nav-offline-led` 硬编码在聊天屏顶栏内（`index.html:56`），`app.js:4528-4541` 通过 `OfflineIndicator.getInstance().mount(__ledAnchor)` 挂载，并订阅 `OfflineProbe.onChange` 驱动 `setState/animate`。切换到非聊天屏后指示灯不可见（F8）。

**新落位**：提升到 `#shell-topbar` 最左侧，**跨全部 6 屏常驻**。

**实现策略 —— DOM 迁移而非重建（关键）**：

```
ui-shell.js 挂载时（app.js init 之后）：
  topbar.prepend(document.getElementById('nav-offline-led'))
```

- 迁移的是**同一个 DOM 节点**（含 `OfflineIndicator` 已注入的子元素）。`appendChild` / `prepend` 移动节点会**保留其事件监听与外部引用**，因此 `app.js:4532` 持有的 `__led` 实例、`:4534` 的 `onChange` 回调闭包、`setState()` 内部的元素引用**全部继续有效**。
- **绝不**调用第二次 `mount()`：`OfflineIndicator` 是单例（`getInstance()`），二次挂载会产生双灯与状态分裂。
- **绝不**改 `app.js:4530` 的 `querySelector("#nav-offline-led")`：迁移发生在其之后，选择器仍能命中（节点 id 不变，只是父级变了）。
- 降级：若 `#nav-offline-led` 不存在（迁移前已被移除），`app.js:4530` 已有 `|| document.querySelector("#page-chat .nav")` 兜底，不会抛错。

**三态视觉规格**（沿用 `offline-indicator.js` 既有状态机，不改语义）：

| 状态 | 颜色 | 文案（桌面侧栏底部展示） | 含义 |
| --- | --- | --- | --- |
| `online` | 绿 | 在线 | 网络可达 |
| `degraded` | 黄 | 网络不佳 | 探测超时 / 不稳定 |
| `offline` | 灰/红 | 离线 · 小暖仍在你手机里 | 完全离线，端侧兜底生效 |

> 桌面侧栏底部额外镜像一份**文字态**（线框图左下角「● 在线」），因为桌面用户距离屏幕更远、纯色点可读性不足。该镜像**只读订阅**同一个 `OfflineProbe.onChange`，不新增探测（不违反零上报）。

### 3.6 ⚙ 隐私入口落位

**现状**：`app.js:4678-4692` 运行时把 `⚙` 按钮 `appendChild` 进 `#page-chat .nav`，点击调用 `openPrivacyAudit()` 打开模态（F4）。

**新落位**：迁入 `#shell-topbar` 右侧常驻，**行为从「开弹窗」改为「路由到隐私屏」**。

**实现策略 —— clone 换绑（关键）**：

`app.js:4691` 用 `b.addEventListener("click", openPrivacyAudit)` 绑定的是**具名函数引用**，但该函数是模块内部闭包，`ui-shell.js` 拿不到引用，无法 `removeEventListener`。解法：

```
1. 取 #btn-privacy-audit 节点
2. const fresh = old.cloneNode(true)   // cloneNode 不复制事件监听 → 旧的 openPrivacyAudit 绑定自然失效
3. old.replaceWith(fresh)
4. topbar.appendChild(fresh)
5. fresh.classList.add('tab'); fresh.dataset.page = 'privacy';
   → 直接复用 §3.1 的 data-page 契约，由 bindTabs() 统一接管
```

- **为什么不用 `stopImmediatePropagation` 拦截**：那要求 `ui-shell` 的监听器先注册，而 `app.js` 的监听器已经先注册了（capture 阶段可以抢，但会留下「弹窗代码仍然可被触发」的隐患）。`cloneNode` 是**彻底断开**，更干净。
- **风险**：若 `bindTabs()` 已在 `ui-shell.js` 运行前执行完毕，则新克隆的按钮不会被绑定。解法见 §6.5（壳层挂载后显式补绑）。

### 3.7 顶栏上下文操作区

对话屏的 `📞 #btn-call` / `🔊 #btn-tts` / `🔍 #btn-search` / `😊 #nav-mood` 属于**对话上下文操作**，不是全局导航。它们迁入 `#shell-topbar` 的 `.shell-ctx-actions`，并按当前屏**显隐**：

| 屏 | 顶栏上下文操作 | 屏标题 |
| --- | --- | --- |
| 对话 | 😊 心情 · 📞 通话 · 🔊 朗读 · 🔍 搜索 | 小暖 · <在线/正在输入…> |
| 小暖 | （无） | 小暖 · 相识第 N 天 |
| 故事 | （无） | 我们的故事 |
| 记忆 | （无，开关由 LTMUI 渲染在屏内） | 我的长期记忆 |
| 隐私 | （无） | 小暖的隐私审计 |
| 设置 | 🔍 设置搜索（`#me-search` 聚焦） | 设置 |

- 显隐用 `#shell-topbar[data-screen="chat"] .shell-ctx-actions { display: flex }` 纯 CSS 驱动，**不用 JS 逐个 toggle**（避免与既有 `refreshNavStatus()` 抢 DOM）。
- `#nav-status`（在线 / 正在输入…）与 `#nav-avatar` `#nav-name` 一并迁入顶栏，`app.js:4560` 的 `refreshNavStatus()` 靠 id 选择器工作，迁移后仍命中。

---

## 4. 多屏拆分方案

### 4.1 屏清单总览（6 主屏）

任务要求「至少 4 个主屏（对话 / 记忆 / 设置 / 隐私）」。本候选交付 **6 主屏** —— 因为既有 `#page-her`（小暖立绘/好感）与 `#page-story`（关系图谱/日记/时间线）已是成熟独立屏（F2），**降级合并它们会造成功能退化**，属于「零功能丢失」铁律不允许的行为。

| # | 屏 | `data-page` | 容器 id | 来源 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 💬 **对话** | `chat` | `#page-chat` | 既有 | 保留，剥离顶栏 |
| 2 | 👧 **小暖** | `her` | `#page-her` | 既有 | 保留 |
| 3 | 📖 **故事** | `story` | `#page-story` | 既有 | 保留 |
| 4 | 🧠 **记忆** | `ltm-manage` | `#ltm-manage` | 既有（运行时注入 Tab） | **一级化**：Tab 移入 HTML 声明式 |
| 5 | 🔒 **隐私** | `privacy` | `#page-privacy` | **新增屏** | **去模态化**：由弹窗升级为屏 |
| 6 | ⚙️ **设置** | `me` | `#page-me` | 既有 | 保留，内部**分区重排** |

> **`data-page="ltm-manage"` 与容器 id `#ltm-manage` 一律不改名。** 原因：`app.js:2993-2995` 对该 id 有特判分支。改名需动 `app.js` 路由核心，收益为零、风险为正。命名不一致是可接受的历史债，已在 §8 R6 记录。

### 4.2 屏 1 · 💬 对话（`#page-chat`）

**职责**：与小暖的实时对话，是应用的默认屏与最高频屏。

| 变化 | 说明 |
| --- | --- |
| **移出** | `<header class="nav">` 整体内容（头像/名称/状态/心情/LED/📞/🔊/🔍/⚙）迁入 `#shell-topbar` |
| **保留** | `#chat-body` 消息流、`.chat-input-bar` 输入栏（🎤 📎 😊 输入框 ➤）、`#chat-file` |
| **保留（浮层合理）** | `#voice-bar` 朗读控件条、`#emoji-panel` 表情面板、`#search-panel` 搜索面板、`#ltm-corner` ⌐记忆角标 |

**关键 UI 元素**：消息气泡（`.msg.her` / `.msg.me`）、时间分隔（`.time-divider`）、朗读波形（`#voice-wave`）、记忆回忆气泡（`LTMUI.renderRecallBubble`）。

**为什么这些浮层保留为浮层**：它们都是**对话流的内联附属物**，生命周期与对话强绑定（朗读条随 TTS 起落、角标随记忆命中出现），升级为屏反而破坏上下文。软件形态的原则是「功能域独立 → 给屏；上下文附属 → 给浮层」。

### 4.3 屏 4 · 🧠 记忆（`#ltm-manage`）

**职责**：长期记忆（候选 A）的查看、筛选、清除与总开关，是用户对「小暖记得什么」的唯一治理入口。

| 变化 | 说明 |
| --- | --- |
| **一级化** | 把 `app.js:4496-4504` 运行时注入的 Tab 改为 `index.html` 内**声明式** `<button class="tab" data-page="ltm-manage">`。`app.js` 的注入代码有 `if (!bar.querySelector('[data-page="ltm-manage"]'))` 幂等守卫（`:4498`），HTML 里先声明后，注入逻辑**自动空转**，无需改 `app.js`。 |
| **渲染不变** | 仍由 `LTMUI.renderManagePage(#ltm-manage-body, subject)` + `LTMUI.bindToggle()` 渲染（`app.js:3004-3010`） |
| **蒸馏钩子不变** | 离开对话屏触发 `ltmDistill()` 的逻辑（`app.js:3011-3013`）完全保留 |

**关键 UI 元素**（全部由 `ltm-ui.js` 现有代码渲染，本候选不改）：`#ltm-switch` 总开关、`.ltm-capacity` 容量条（`#ltm-cap-fill` / `#ltm-cap-text`）、`#ltm-filters` 分组 chips、`#ltm-list` 记忆列表、`.ltm-danger` 双清除按钮（清除当前分组 / 彻底清除全部）。

### 4.4 屏 6 · ⚙️ 设置（`#page-me`）

**职责**：全部偏好与连接配置。

**现状问题**：5 折叠组 / 13 卡片挤在一屏（F6），且「智能与模型」组一个组里塞了 6 张卡（云端大脑、端侧模型、语音开关、语音音色、语音输入、语音与隐私），语义混杂。

**重排方案**（**仅重排分组归属与顺序，不删除任何一张卡、不改任何一个控件 id**）：

| 分组 | 卡片 | 变化 |
| --- | --- | --- |
| 💞 我们的关系 | 恋爱档案、表白 & 纪念日 | 不变 |
| 🎀 小暖的样子 | 我的昵称、小暖人设（性别/基调/主题/人格卡/导入导出） | 不变 |
| 🔊 **语音与朗读**（新分组） | 语音（小暖开口说话）、语音音色、语音输入（麦克风）、语音与隐私 | **从「智能与模型」拆出**（4 卡） |
| 🧠 智能与模型 | 云端大脑（含 embedding）、端侧模型（离线 AI） | 瘦身为 2 卡 |
| ☁️ 连接与同步 | 消息提醒、云同步、主动推送 | 不变 |
| 🗄 数据与隐私 | 存档码、清除全部数据 | 不变 + 增加「前往隐私屏」深链 |

- 语音 4 卡从 6 卡混合组独立成组，是本次设置减负的**核心收益**：它让「智能与模型」回归其字面语义（大脑/模型），语音获得与其重要性匹配的一级分组。
- `#me-search` 设置搜索**保留**。`app.js:4427+` 的 `initMeSearch()` 每次输入重读 `.me-card` 的 `textContent`（不缓存索引，见 `app.js` 注释），因此**卡片换组后搜索自动适配，无需改代码**。
- `initMeGroups()`（`app.js:4401`）按 `.me-group-head` / `.me-group` 通用选择器绑定折叠，新增分组**自动获得折叠能力**，无需改代码。
- `.me-group-count` 计数徽标需随卡片数更新（语音组 `4`、智能组 `2`），这是 HTML 静态文本，改 `index.html` 即可。

### 4.5 屏 5 · 🔒 隐私（`#page-privacy`）— 去模态化

**职责**：隐私审计、同意治理、端侧推理状态、诊断导出。这是候选 C 的核心交付面，也是「隐私优先」产品定位最重要的**信任界面**。

**变化：`#privacy-audit-modal` 浮层 → `#page-privacy` 一级屏。**

新增屏骨架（`index.html`，与其它 `.page` 同级）：

```html
<section class="page" id="page-privacy">
  <div class="xn-audit-body" id="privacy-audit-body-page">
    <!-- 由 PrivacyAudit.render() 注入，8 个分区全量保留 -->
  </div>
</section>
```

**8 个分区全量迁入**（`privacy-audit.js:96-155` 的 render 输出，一个不减）：

| # | 分区 | 关键节点 |
| --- | --- | --- |
| ① | 🔒 零上报证明 | `#xn-proof-status` + 三计数 `#xn-c-blocked` / `#xn-c-allowed` / `#xn-c-consented` |
| ② | 💾 本地存储占用 | `#xn-store-idb` / `#xn-store-ls` / `#xn-store-cache` / `#xn-store-total` |
| ③ | 🛡 同意与权限 | `#xn-consent-summary` + `#xn-consent-mount`（内嵌 `ConsentUI`：tts/asr/ltm/cloudSync） |
| ④ | 📡 当前网络通道 | `#xn-channel-val` |
| ⑤ | 🛡 隐私评分 | `#xn-score-val` / `#xn-score-grade`（`PrivacyScore`） |
| ⑥ | 🧩 本地模型（端侧推理） | `#xn-localmodel-mount`（内嵌 `LocalModelUI`） |
| ⑦ | 🩺 本地诊断报告 | `#xn-diag-json` / `#xn-diag-qr`（`DiagnosticReport`） |
| ⑧ | 操作 | `#xn-export-btn` / `#xn-export-enc-btn`（AES-GCM）/ `#xn-clear-btn` |

**P4 单一渲染目标 —— 这是硬约束，不是建议**：

已核实 `privacy-audit.js:23` 的选择器助手为 `function q(sel, root) { return (root || document).querySelector(sel); }`，而 `refreshMetrics()` 内部**大量以省略 root 的形式调用**（如 `:201` 的 `q('#xn-proof-status')`、`:211-213` 的 `setText('#xn-c-blocked', ...)`）。这意味着：

> **一旦 `#privacy-audit-body`（弹窗内）与 `#privacy-audit-body-page`（屏内）同时被 render，DOM 中就会出现重复 id，`document.querySelector` 只命中第一个，指标刷新会静默写错节点 —— 用户看到永远停在「…」的隐私面板。**

**强制规范**：

1. `ui-shell.js` 挂载成功后，**必须移除**（或永久清空并标记 `data-xn-deprecated`）`#privacy-audit-modal` 内的 `#privacy-audit-body`，确保全文档 `#xn-*` id 唯一。
2. `PrivacyAudit.render()` **只对 `#privacy-audit-body-page` 调用一次**；每次进入隐私屏调用 `refreshMetrics()` 刷新动态指标（沿用 `app.js:4707-4716` 的「每次打开重算」语义）。
3. 若壳层挂载失败（P3 降级），则**不创建屏**、**不移除弹窗**，退回原有弹窗形态 —— 两种形态永不并存。

**桌面端增强**：≥1024px 时 8 个分区用 `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))` 双列瀑布排布，充分利用宽屏；<1024px 保持单列。这是纯 CSS，`privacy-audit.js` 零改动。

### 4.6 关键决策：语音 与 本地模型 的归属

这是本候选**必须明确拍板**的两个决策点。

#### 决策 D-1：语音 → **并入设置屏（独立分组），不设独立屏**

**决策：不给语音单独一个主屏；在设置屏内提升为一级分组「🔊 语音与朗读」（§4.4）。**

理由：

1. **运行时控制已在对话屏，且是正确的位置**。语音的高频操作是「让小暖念 / 我说话 / 暂停 / 静音」，它们已分别落在 `#btn-tts`（顶栏）、`#btn-mic`（输入栏）、`#voice-bar`（朗读条 `#voice-pause` / `#voice-mute`）。这些是**对话上下文操作**，做成独立屏会要求用户「离开对话去控制对话的朗读」，是反直觉的。
2. **剩下的都是低频偏好配置**：音色选择、语速/音高/音量滑杆、麦克风同意态、清除本地语音偏好。这类「设一次、几个月不动」的配置，标准归属就是设置页。
3. **导航预算有限**。移动端底部 Tab 超过 5–6 项即显著降低可点性与可辨识度。本候选已用到 6 项，是上限；语音占位会挤掉隐私或记忆 —— 而后两者是本产品的差异化命脉。
4. **通话是例外，已单独处理**：`#call-overlay` 是**全屏沉浸浮层**，语义上等价于系统来电界面，保持浮层（§4.7）。

#### 决策 D-2：本地模型 → **主视图在隐私屏，配置入口留在设置屏（双视图，单一真源）**

**决策：不设独立屏。`LocalModelUI` 主视图随隐私屏（分区⑥），设置屏保留既有「📱 端侧模型（离线 AI）」下载/加载卡。**

理由：

1. **端侧推理的产品叙事属于隐私，不属于性能**。「模型跑在你手机里 → 所以对话不外发」是隐私论证链的一环，因此 `privacy-audit.js:137-140` 原本就把 `LocalModelUI` 挂在审计面板内（`#xn-localmodel-mount`）。把它移出隐私屏会削弱零上报论证的完整性。
2. **设置屏那张卡管的是另一件事**：`#lm-enabled` / `#lm-model` / `#lm-load` / `#lm-progress` / `#lm-status` / `#lm-device` 负责**下载与加载**（首次约 0.5GB、需 WiFi、WebGPU 检测），是典型的「配置动作」；隐私屏的 `LocalModelUI` 负责**状态与治理**（当前模型、是否可用、端侧推理是否生效）。两者职责不同，同时存在是合理的双视图。
3. **单一真源不破**：两处读写的都是同一份 `S.localModel` 状态与同一个 `ReplyRouter` / `LocalModelAdapter`（`app.js:4554` 的 `ensureLocalModelLoaded()`、`reply-router.js`）。UI 层双视图、数据层单真源。
4. **必须补的一致性要求**：进入任一视图时**重新读取**当前状态渲染，避免两处显示不一致（验收项 AC-D12-c）。

> 两个决策的共同逻辑：**导航一级位给「有独立信息架构的功能域」，而不是给「模块」。** 语音与本地模型都是能力模块，其 UI 天然分裂为「运行时控制」与「偏好配置」两半，强行合成一屏反而制造割裂。

### 4.7 浮层保留清单（明确决策：不升级为屏）

| 浮层 | 决策 | 理由 |
| --- | --- | --- |
| `#call-overlay` 语音通话 | **保留全屏浮层** | 沉浸式模态语义，等价系统来电界面；有明确进入/挂断生命周期 |
| `#asr-consent-modal` 麦克风同意 | **保留阻断式模态** | 法律同意语义**必须**阻断，不可被绕过或滚走（`consent-ui.js` 的 cloudSync 二次确认同理） |
| `#games-overlay` 情侣小游戏 | **保留浮层** | 对话的轻量附属娱乐，非独立功能域 |
| `#search-panel` 聊天搜索 | **保留对话屏内浮层** | 搜索结果需即时跳回对话上下文 |
| `#emoji-panel` 表情面板 | **保留** | 输入法级附属 |
| `#day-detail` 日详情 | **保留故事屏内浮层** | 故事屏的下钻详情 |
| `#ltm-corner` ⌐记忆角标 | **保留对话屏内角标** | 记忆命中时的内联提示，点击可深链至记忆屏 |
| `#gender-picker` 首次性别选择 | **保留全屏引导** | 一次性 onboarding |
| `#splash` 启动页 | **保留** | 启动动画 |

> 判据一句话：**有独立信息架构 → 屏；有明确模态生命周期或属对话内联 → 浮层。** 本候选去模态化的只有 `#privacy-audit-modal` 一个，因为它是唯一「被错误地塞进浮层的完整功能域」（F5：8 分区）。

---

## 5. 现有功能无损迁入映射表

本章是「零功能丢失」的**证明**。逐条列出 A / B / C 的每一个现有入口及其新落位。QA 应按此表逐行验证（对应验收项 AC-D12）。

图例：**原位** = 位置不变 · **迁移** = 换宿主但节点/实例不变 · **一级化** = 由运行时注入/浮层升级为声明式屏 · **重排** = 同屏内换分组

### 5.1 候选 A · 长期记忆（`longterm-memory.js` / `ltm-ui.js`）

| # | 现有入口 | 现位置 | 新落位 | 变更 | 校验点 |
| --- | --- | --- | --- | --- | --- |
| A-1 | 🧠 记忆 Tab | 运行时注入 `.tabbar`（`app.js:4499-4502`） | 底部 Tab 第 4 项 + 桌面侧栏第 4 项 | **一级化** | HTML 声明后 `app.js:4498` 幂等守卫使注入空转，Tab 不重复 |
| A-2 | 记忆管理页容器 | `#ltm-manage` / `#ltm-manage-body` | **id 完全不改**，移入 `#shell-main` | 迁移 | `app.js:2993-2995` 特判仍命中 |
| A-3 | `renderManagePage()` | 进入 Tab 时调用（`app.js:3007`） | 同，改由屏进入钩子触发 | 原位 | 记忆列表可渲染 |
| A-4 | `bindToggle()` 长期记忆总开关 `#ltm-switch` | 记忆页顶部 | 同（`LTMUI` 内部渲染） | 原位 | 开关可切换，关闭后列表停用提示出现 |
| A-5 | 容量条 `#ltm-cap-fill` / `#ltm-cap-text` | 记忆页 | 同 | 原位 | 显示 `N / LTM_MAX 条` |
| A-6 | 分组筛选 chips `#ltm-filters` | 记忆页 | 同 | 原位 | 各 chip 可切换、`.active` 正确 |
| A-7 | 记忆列表 `#ltm-list` | 记忆页 | 同 | 原位 | 条目可见、可展开 |
| A-8 | 清除当前分组记忆 | `.ltm-danger` | 同 | 原位 | 二次确认弹窗（`ltm-ui.js:252` `openModal`）可弹出 |
| A-9 | 彻底清除全部记忆 | `.ltm-danger` | 同 | 原位 | 同上 |
| A-10 | ⌐记忆 角标 `#ltm-corner` | 对话屏浮层 | **保留对话屏浮层**，点击深链至记忆屏 | 原位 + 增强 | 角标出现、数字正确、点击跳记忆屏 |
| A-11 | 回忆气泡 `renderRecallBubble()` | 对话流内联 | 同 | 原位 | 命中记忆时气泡出现 |
| A-12 | `renderCornerBadge()` | 由 `app.js` 调用 | 同 | 原位 | 计数刷新 |
| A-13 | 蒸馏钩子 `ltmDistill()` | 离开对话 Tab 触发（`app.js:3011-3013`） | 同，保留在路由钩子内 | 原位 | 切屏后 turns 被蒸馏 |
| A-14 | `ltm` 同意开关 | 隐私审计弹窗 → `ConsentUI` | **隐私屏**分区③ | 一级化 | 开关可切换，与 `ConsentStore.ltm` 同步 |
| A-15 | LTM Toast `#ltm-toast` | `document.body` 追加（`ltm-ui.js:31-32`） | 同（挂 body，不受壳层影响） | 原位 | Toast 可见且不被壳层遮挡（需检查 z-index） |

### 5.2 候选 B · 多模态语音（`voice.js`）

| # | 现有入口 | 现位置 | 新落位 | 变更 | 校验点 |
| --- | --- | --- | --- | --- | --- |
| B-1 | 🔊 朗读开关 `#btn-tts` | 对话屏顶栏（`index.html:58`） | **壳层顶栏**上下文操作区（仅对话屏显示） | 迁移 | 点击可切 TTS 开关，`data-xn-title` 角色名注入正确 |
| B-2 | 🎤 语音输入 `#btn-mic` | 对话输入栏（`index.html:63`） | 原位（输入栏不动） | 原位 | 点击触发 ASR / 未同意时弹同意窗 |
| B-3 | 📞 通话 `#btn-call` | 对话屏顶栏 | **壳层顶栏**上下文操作区 | 迁移 | 点击打开 `#call-overlay` |
| B-4 | 通话浮层 `#call-overlay` 全部控件 | 全屏浮层 | **保留全屏浮层**（决策 §4.7） | 原位 | 计时/波形/🎤/挂断/环境音 全可用 |
| B-5 | 朗读控件条 `#voice-bar` | 对话屏内（`index.html:71-78`） | 原位（对话屏内联） | 原位 | `#voice-status` 状态文字、`#voice-wave` 波形、`#voice-pause` 暂停、`#voice-mute` 静音 全可用 |
| B-6 | ASR 同意弹窗 `#asr-consent-modal` | 阻断式模态 | **保留阻断式模态**（决策 §4.7） | 原位 | `#asr-consent-check` 勾选后 `#asr-consent-ok` 才生效 |
| B-7 | 语音总开关卡 `#tts-enabled` | 设置「智能与模型」组 | 设置「🔊 语音与朗读」新组 | **重排** | 开关可切、卡片在新分组内 |
| B-8 | 音色 chips `#voice-group` | 设置「智能与模型」组 | 设置「🔊 语音与朗读」新组 | **重排** | 音色可选、试听生效 |
| B-9 | 麦克风开关 `#asr-enabled` | 设置「智能与模型」组 | 设置「🔊 语音与朗读」新组 | **重排** | 开关可切、触发同意流 |
| B-10 | 语速 `#voice-rate` | 设置「语音与隐私」卡 | 设置「🔊 语音与朗读」新组 | **重排** | 滑杆生效、`#voice-pref-status` 更新 |
| B-11 | 音高 `#voice-pitch` | 同上 | 同上 | **重排** | 同上 |
| B-12 | 音量 `#voice-volume` | 同上 | 同上 | **重排** | 同上 |
| B-13 | 麦克风同意态 `#asr-consent-status` | 同上 | 同上 | **重排** | 显示「已同意/未同意」 |
| B-14 | 撤回麦克风同意 `#asr-consent-revoke` | 同上 | 同上 | **重排** | 可撤回，状态回落 |
| B-15 | 清除本地语音偏好 `#voice-pref-clear` | 同上 | 同上 | **重排** | 偏好清空 |
| B-16 | 零上报声明文案 | 「语音与隐私」卡内 | 同卡（随组迁移） | **重排** | 文案原文保留（含「绝不留存、绝不外发」） |
| B-17 | `tts` / `asr` 同意开关 | 隐私审计弹窗 → `ConsentUI` | **隐私屏**分区③ | 一级化 | 与 `ConsentStore` 同步；与 B-7/B-9 同一真源 |
| B-18 | 打断逻辑 `Voice.onState` → `cancelSpeak` | `app.js:4546-4550` | 原位（无 UI） | 原位 | 开始说话即打断朗读 |

### 5.3 候选 C · 隐私 / 端侧增强

| # | 现有入口 | 现位置 | 新落位 | 变更 | 校验点 |
| --- | --- | --- | --- | --- | --- |
| C-1 | ⚙ 隐私入口 `#btn-privacy-audit` | 运行时注入对话屏顶栏（`app.js:4682-4691`） | **壳层顶栏常驻**，改为路由到隐私屏 | 一级化 + 换绑 | 任意屏可见；点击进入隐私屏（不再开弹窗） |
| C-2 | 隐私审计面板 `#privacy-audit-modal` | 可关闭浮层 | **`#page-privacy` 一级屏** | **一级化** | 屏可达；弹窗骨架内 body 已移除（无重复 id） |
| C-3 | 零上报证明 `#xn-proof-status` | 弹窗分区① | 隐私屏分区① | 迁移 | 显示 `✓ 零非授权上报…` 或拦截计数 |
| C-4 | 已拦截计数 `#xn-c-blocked` | 弹窗分区① | 隐私屏分区① | 迁移 | 数字随 `AuditProbe` 刷新 |
| C-5 | 已放行计数 `#xn-c-allowed` | 弹窗分区① | 隐私屏分区① | 迁移 | 同上 |
| C-6 | 已授权外发计数 `#xn-c-consented` | 弹窗分区① | 隐私屏分区① | 迁移 | 同上 |
| C-7 | 存储占用 4 格 `#xn-store-idb/ls/cache/total` | 弹窗分区② | 隐私屏分区② | 迁移 | 4 格均有数值（非「—」） |
| C-8 | 同意摘要 `#xn-consent-summary` | 弹窗分区③ | 隐私屏分区③ | 迁移 | 摘要文案正确 |
| C-9 | 精细同意开关 `ConsentUI`（tts/asr/ltm/cloudSync） | 弹窗 `#xn-consent-mount` | 隐私屏分区③ | 迁移 | 4 开关可切；cloudSync 开启触发**二次确认**（`consent-ui.js:124-136`） |
| C-10 | 当前网络通道 `#xn-channel-val` | 弹窗分区④ | 隐私屏分区④ | 迁移 | 显示当前通道态 |
| C-11 | 隐私评分 `#xn-score-val` / `#xn-score-grade` | 弹窗分区⑤ | 隐私屏分区⑤ | 迁移 | 0–100 分值 + 等级 |
| C-12 | 本地模型管理 `LocalModelUI` | 弹窗 `#xn-localmodel-mount` | 隐私屏分区⑥（**主视图**，决策 D-2） | 迁移 | 状态渲染正确 |
| C-13 | 诊断 JSON `#xn-diag-json` | 弹窗分区⑦ | 隐私屏分区⑦ | 迁移 | 可导出本地 JSON |
| C-14 | 诊断二维码 `#xn-diag-qr` | 弹窗分区⑦ | 隐私屏分区⑦ | 迁移 | 本地生成二维码（不外发） |
| C-15 | 导出审计日志 `#xn-export-btn` | 弹窗分区⑧ | 隐私屏分区⑧ | 迁移 | 下载 JSON |
| C-16 | 加密导出 `#xn-export-enc-btn` | 弹窗分区⑧ | 隐私屏分区⑧ | 迁移 | AES-GCM 口令弹窗（`privacy-audit.js:456`）可用 |
| C-17 | 清除审计数据 `#xn-clear-btn` | 弹窗分区⑧ | 隐私屏分区⑧ | 迁移 | 清除后 `__xinyuReconsent` 钩子（`app.js:4522`）仍生效 |
| C-18 | 离线三态灯 `#nav-offline-led` | 对话屏顶栏 | **壳层顶栏常驻**（DOM 迁移，实例不重建，§3.5） | 迁移 | 6 屏均可见；三态切换正确 |
| C-19 | 端侧模型下载卡 `#lm-enabled/#lm-model/#lm-load/#lm-progress/#lm-bar/#lm-status/#lm-device` | 设置「智能与模型」组 | 设置「🧠 智能与模型」组（瘦身后保留） | 原位 | 下载/加载/进度/设备探测 全可用 |
| C-20 | 云端大脑卡 `#cloud-enabled/#cloud-base/#cloud-key/#cloud-model` | 设置「智能与模型」组 | 同组保留 | 原位 | 保存配置生效；`registerConsentedEndpoints()` 仍登记 |
| C-21 | 向量记忆 `#embed-enabled/#embed-model` | 云端大脑卡内 | 同 | 原位 | 开关生效 |
| C-22 | 云同步卡 `#sync-enable` 等全部控件 | 设置「连接与同步」组 | 同组保留 | 原位 | 开关/同步码/口令/上传/下载/删除 全可用 |
| C-23 | 主动推送卡 `#push-*` 全部控件 | 设置「连接与同步」组 | 同组保留 | 原位 | 渠道/静默时段/回调 全可用 |
| C-24 | 消息提醒 `#notify-enabled` | 设置「连接与同步」组 | 同组保留 | 原位 | 测试通知可发 |
| C-25 | 存档码 `#btn-export/#btn-copy/#btn-import` | 设置「数据与隐私」组 | 同组保留 + 隐私屏深链 | 原位 | 导出/复制/导入 全可用 |
| C-26 | 清除全部数据 `#btn-reset` | 设置「数据与隐私」组 | 同组保留 | 原位 | 二次确认后清除 |
| C-27 | `AuditProbe` 拦截安装 | `app.js` 启动期 | 原位（无 UI） | 原位 | `proveZeroReporting()` 语义不变 |
| C-28 | `OfflineProbe` 30s 探测 | `app.js:4525` | 原位（无 UI） | 原位 | 探测周期不变 |
| C-29 | `CacheWarmer` 预热 `xinyu-edge-v1` | `app.js:4543` | 原位（无 UI） | 原位 | **绝不** open `sw` 冻结缓存 |
| C-30 | `ReplyRouter` 路由 cloud→local→heuristic | `app.js:4523` | 原位（无 UI） | 原位 | 降级链不变 |
| C-31 | `CSPInject` report-only | `csp-inject.js` | 原位（无 UI） | 原位 | 注入不变 |

### 5.4 候选无关既有屏（同样零丢失）

| # | 入口 | 新落位 | 变更 |
| --- | --- | --- | --- |
| X-1 | 👧 小暖屏（立绘 `#her-stage` / 情绪光晕 `#emotion-aura` / 好感条 `#affection-fill` / 关系卡 `#rel-card` / 表白 `#btn-propose` / 换装 `#outfit-group` / 记忆闪回 `#memory-list` / 最近话题 `#recent-card`） | Tab 第 2 项，全部原位 | 原位 |
| X-2 | 📖 故事屏（概览卡 `#ov-*` / 关系图谱 `#rel-graph` / 好感曲线 `#aff-curve` / 情绪图 `#emotion-chart` / 心情日历 `#mood-calendar` / 日记 `#diary-list` / 周报 `#weekly-list` / 剧情 `#arc-list` / 时间线 `#timeline` / 日详情 `#day-detail`） | Tab 第 3 项，全部原位 | 原位 |
| X-3 | 设置「我们的关系」「小暖的样子」两组全部卡片 | 设置屏，原位 | 原位 |
| X-4 | 情侣小游戏 `#games-overlay` | 保留浮层 | 原位 |
| X-5 | 未读红点 `#chat-dot` | 底部 Tab + 侧栏**双处镜像** | 迁移 + 镜像 |
| X-6 | 首次性别选择 `#gender-picker` | 保留全屏引导 | 原位 |
| X-7 | 启动页 `#splash` | 保留 | 原位 |
| X-8 | 升级横幅 `.levelup-toast` | 保留（`position:fixed`） | 原位 |

### 5.5 迁入结论

- A：15 项入口，**0 丢失**（1 一级化、1 迁移、13 原位/增强）
- B：18 项入口，**0 丢失**（2 迁移、10 重排、6 原位）
- C：31 项入口，**0 丢失**（2 一级化、17 迁移、12 原位）
- 候选无关：8 项，**0 丢失**
- **合计 72 项入口，零丢失。** 其中真正改变承载形态的只有 3 项：C-1（⚙ 入口换绑）、C-2（隐私弹窗→屏）、A-1（记忆 Tab 一级化）。其余全部是位置迁移或分组重排，**功能语义、控件 id、数据真源、隐私边界一律不变**。

---

## 6. 状态管理与路由

### 6.1 设计约束

三条硬约束决定了方案形态：

1. **不得与冻结 `engine.js` 冲突** —— `engine.js` 是纯函数库（`Engine.reply` / `moodOfDay` / `moodProject` / `dayLifeGen` 等），**不含任何 DOM、视图或路由代码**。UI 路由与它物理上零交集，天然不冲突。本候选不新增任何对 `Engine.*` 的调用，也不改变 `app.js` 对它的调用时机。
2. **不得重写 `app.js` 既有路由** —— `bindTabs()`（`app.js:2986-3017`）是既有屏切换真源，已承载 A 的蒸馏钩子与 `ltm-manage` 特判。重写它风险最高、收益最低。
3. **零新增 npm 依赖** —— 不引入任何路由库。

### 6.2 方案：`ui-shell.js` 共存叠加层

新增单文件 `ai-girlfriend/ui-shell.js`（挂 `window.XinyuShell`，IIFE，零依赖），沿用候选 C 已验证的「仅追加、不改写」模式。

**加载位置**：`index.html` 中 **`app.js` 之后**追加一行 `<script src="ui-shell.js"></script>`。

- 为什么必须在 `app.js` 之后：壳层要迁移的 `#nav-offline-led`（已挂载 LED 实例）与 `#btn-privacy-audit`（运行时注入）都由 `app.js` 的 `init()` 产生，壳层必须后到。
- `app.js:4719` 用 `document.addEventListener("DOMContentLoaded", init)` 注册；`ui-shell.js` 在其后注册同类监听器，**按注册顺序**在 `init()` 之后执行。

### 6.3 状态模型

```
XinyuShell.state = {
  current: 'chat',        // 当前屏 data-page 值
  prev:    null,          // 上一屏（用于返回）
  screens: ['chat','her','story','ltm-manage','privacy','me'],
  mounted: false          // 壳层是否挂载成功（决定降级路径）
}
```

- **`current` 不是新真源**：真源仍是 DOM 上的 `.page.active` 与 `.tab.active`（由 `bindTabs()` 维护）。`state.current` 只是**镜像缓存**，用于路由/标题/顶栏 `data-screen` 同步。这样避免了「双真源不一致」这一类经典缺陷。
- **`syncNavActive(page)`**：`bindTabs()` 只给被点击节点加 `.active`（`app.js:2989-2991`），底部 Tab 与侧栏是两套节点，因此壳层需补一次镜像：

```
document.querySelectorAll('.tab[data-page="' + page + '"]')
        .forEach(t => t.classList.add('active'));
```

配合 `aria-current="page"` 同步，满足无障碍（P5）。

### 6.4 路由（hash 深链）

采用 **hash 路由**，零依赖、不需要服务端改动、PWA 离线可用：

| Hash | 屏 |
| --- | --- |
| `#/chat` | 对话（默认，空 hash 等价） |
| `#/her` | 小暖 |
| `#/story` | 故事 |
| `#/memory` | 记忆（**对外别名**，内部映射到 `data-page="ltm-manage"`） |
| `#/privacy` | 隐私 |
| `#/settings` | 设置（**对外别名**，内部映射到 `data-page="me"`） |

- **别名映射表**是刻意设计：对外 URL 语义清晰（`memory` / `settings`），对内保留历史 id（`ltm-manage` / `me`）不改名，避免动 `app.js` 特判（§4.1）。
- **单向驱动**：`hashchange` → 找到对应 `.tab[data-page]` → 调用其 `.click()`。**复用既有点击处理器**，因此蒸馏钩子（A-13）、故事刷新（`app.js:3001`）、记忆渲染（`:3004-3010`）等全部屏进入副作用**自动继续生效**，无需在壳层重复实现。这是本方案最关键的设计取舍。
- 反向：`bindTabs()` 执行后，壳层的委托监听器更新 `location.hash`（用 `history.replaceState` 避免污染回退栈）。
- 首屏恢复：读 `localStorage['xinyu.ui.lastScreen']`；若 hash 存在则 hash 优先。**默认仍是对话屏**（与现状一致，`index.html:48` 的 `.page.active`）。

### 6.5 屏进入钩子（与既有副作用共存）

| 屏 | 既有副作用（`bindTabs` 内，保持不动） | 壳层新增（仅 UI 层） |
| --- | --- | --- |
| 对话 | 隐藏 `#chat-dot`、`scrollBottom()` | 顶栏 `data-screen="chat"`（显示上下文操作） |
| 小暖 | `refreshRecentUI()`、`ltmDistill()` | 顶栏标题 |
| 故事 | `refreshStoryUI()`、`ltmDistill()` | 顶栏标题 |
| 记忆 | `LTMUI.renderManagePage()` + `bindToggle()`、`ltmDistill()` | 顶栏标题 |
| **隐私** | 无（新屏） | `PrivacyAudit.render()`（**首次**）+ `refreshMetrics()`（**每次**） |
| 设置 | `ltmDistill()` | 顶栏标题 + 🔍 设置搜索按钮 |

- 隐私屏的「首次 render、每次 refresh」严格对齐既有弹窗语义（`app.js:4707-4716` 每次打开都 `render` + `refreshMetrics`）。改为「首次 render」是为避免重复 render 导致 `ConsentUI` / `LocalModelUI` 被反复重建从而丢失监听。
- **补绑要求**：壳层挂载时若新建了导航节点（侧栏）或 clone 了 `⚙` 按钮，而 `bindTabs()` 已执行完毕，则壳层必须对**新节点**显式补绑一个委托监听器（转发到对应既有 Tab 的 `.click()`）。为简化，推荐**统一用事件委托**：在 `#shell-sidebar` 与 `#shell-topbar` 上各挂一个 `click` 委托，命中 `[data-page]` 即转发。这样与 `bindTabs()` 的执行时序**完全解耦**。

### 6.6 挂载时序与降级

```
DOMContentLoaded
  → app.js init()                       [既有，不改]
      · bindTabs() 绑定全部 .tab
      · bindPrivacyAudit() 注入 ⚙ + 绑弹窗
      · OfflineIndicator.mount(#nav-offline-led)
  → ui-shell.js XinyuShell.mount()      [新增]
      1. 建 #shell-topbar / #shell-sidebar / #shell-main（DOM 就位）
      2. 迁移 #nav-offline-led（节点移动，实例不重建）
      3. 迁移对话顶栏上下文按钮（📞 🔊 🔍 😊 + 头像/名称/状态）
      4. clone 换绑 #btn-privacy-audit → data-page="privacy"
      5. 建 #page-privacy 屏 + 移除弹窗内 #privacy-audit-body（P4 单一渲染目标）
      6. 侧栏渲染 6 项（含 #chat-dot 镜像、LED 文字态镜像）
      7. 委托监听 + syncNavActive + hash 路由初始化
      8. state.mounted = true
```

**降级（P3）**：任一步抛错 → `catch` → **回滚已做的 DOM 变更**（关键：若已移除弹窗 body 必须恢复，否则隐私功能双失）→ `state.mounted = false` → 保持现状 4+1 Tab + 弹窗形态。

- 因此实现上要求：**步骤 5（移除弹窗 body）必须放在最后的安全点之后**，或采用「先建屏成功、再移除弹窗」的严格顺序，绝不允许出现「弹窗已拆、屏未建成」的中间态。
- 若 `app.js init()` 因故未执行完（例如 `#btn-privacy-audit` 尚不存在），壳层用**有限次 rAF 重试**（建议 ≤10 次）等待，超时则跳过该步并记录，不阻断其它步骤。

### 6.7 与 `app.js` 的改动边界

| 文件 | 改动 | 类型 |
| --- | --- | --- |
| `ai-girlfriend/ui-shell.js` | **新增** | 新文件 |
| `ai-girlfriend/index.html` | 新增 `#page-privacy` 屏；`.tabbar` 增记忆/隐私两项声明；追加 `<script src="ui-shell.js">`；设置屏语音 4 卡换组 + `.me-group-count` 更新 | 仅追加 / 重排 |
| `ai-girlfriend/style.css` | 末尾追加壳层与响应式规则 | 仅追加 |
| `ai-girlfriend/app.js` | **理想为零改动**。若需，仅允许在 `bindTabs()` 的 `screens` 白名单语义外追加，不删不改既有行 | 仅追加（可选） |
| **`engine.js` / `sw.js` / `memory.js` / `test/baseline.js`** | **零改动（冻结线）** | **禁止** |

> `app.js` 之所以能做到零改动，全靠 §3.1 的 `data-page` 契约复用 + §6.5 的事件委托。这是本方案的核心工程价值。

---

## 7. 验收标准（可测）

全部验收项要求 **QA 可独立验证**，不依赖开发口述。每项给出判定方法与通过阈值。

### 7.1 A 组 · 导航壳与多屏可达

| ID | 验收项 | 判定方法 | 通过标准 |
| --- | --- | --- | --- |
| **AC-D1** | 6 主屏均可达 | 依次点击导航 6 项 | 每次点击后 `document.querySelectorAll('.page.active').length === 1`，且 active 屏 id 依次为 `page-chat` / `page-her` / `page-story` / `ltm-manage` / `page-privacy` / `page-me`。**6/6 全达** |
| **AC-D2** | 底部 Tab 在 <768px 出现 | 视口设 375×667 与 767×900 | `getComputedStyle(document.querySelector('.tabbar')).display !== 'none'`；且侧栏 `#shell-sidebar` 为 `none` |
| **AC-D3** | 侧栏在 ≥1024px 出现 | 视口设 1024×768 与 1440×900 | `getComputedStyle(document.querySelector('#shell-sidebar')).display !== 'none'`；且 `.tabbar` 为 `none` |
| **AC-D4** | 平板中间态 | 视口设 768×1024 与 1023×768 | `.tabbar` 可见 **且** 侧栏 `none`（两者不同时出现，也不同时消失） |
| **AC-D5** | 两套导航项数一致 | 计数 | 底部 Tab 项数 = 侧栏项数 = **6**；且两侧 `data-page` 集合完全相等 |
| **AC-D6** | 高亮镜像同步 | 点任一导航项 | `document.querySelectorAll('.tab.active[data-page="<X>"]').length` 等于该 `data-page` 的节点总数（移动端 1、桌面端 1、两栏都存在时 2）；且不存在其它 `data-page` 的 `.active` |
| **AC-D7** | 导航项数上限 | 计数 | 底部 Tab **≤6 项**（可点性阈值） |
| **AC-D8** | 键盘可达 | Tab 键遍历 + Enter/Space | 6 个导航项均可聚焦并激活；`aria-current="page"` 正确落在当前屏 |
| **AC-D9** | 桌面解除宽度锁 | 1440px 下读 `#app` | `getComputedStyle(document.getElementById('app')).maxWidth === 'none'`（不再是 560px） |
| **AC-D10** | 屏切换无残留 | 快速连点 6 项各 3 轮 | 任意时刻 `.page.active` 恒为 1；无双屏叠加、无空屏 |

### 7.2 B 组 · 全局状态常驻

| ID | 验收项 | 判定方法 | 通过标准 |
| --- | --- | --- | --- |
| **AC-D11** | LED 跨 6 屏常驻 | 逐屏检查 `#nav-offline-led` | 6 屏下均 `offsetParent !== null`（真实可见）；**6/6** |
| **AC-D12** | LED 实例未重建 | 全局计数 | `document.querySelectorAll('#nav-offline-led').length === 1`；LED 子元素节点数与重构前一致；无双灯 |
| **AC-D13** | LED 三态可驱动 | 手动触发 `OfflineProbe` 三态（或断网/限速） | `online` / `degraded` / `offline` 三态视觉均变化，且 `setState` 无抛错 |
| **AC-D14** | ⚙ 入口跨屏常驻 | 逐屏检查 `#btn-privacy-audit` | 6 屏下均可见；**6/6** |
| **AC-D15** | ⚙ 行为已换绑 | 点击 ⚙ | 进入 `#page-privacy` 屏（`.page.active` 为 `page-privacy`）；`#privacy-audit-modal` **保持 `hidden`**（不再弹窗） |
| **AC-D16** | 顶栏上下文操作显隐 | 逐屏检查 `.shell-ctx-actions` | 仅对话屏可见（📞 🔊 🔍）；其余 5 屏隐藏 |
| **AC-D17** | 未读红点镜像 | 造未读后切非对话屏 | `#chat-dot` 与侧栏镜像红点同时出现；回对话屏后同时消失 |

### 7.3 C 组 · 隐私屏去模态化

| ID | 验收项 | 判定方法 | 通过标准 |
| --- | --- | --- | --- |
| **AC-D18** | 8 分区齐全 | 进入隐私屏计数 `.xn-audit-section` | **≥8 个分区**，且 §4.5 表中 8 个分区标题文案全部出现 |
| **AC-D19** | **无重复 DOM id**（P4 硬约束） | 全局扫描 | 对 `#xn-proof-status` / `#xn-c-blocked` / `#xn-c-allowed` / `#xn-c-consented` / `#xn-store-idb` / `#xn-store-ls` / `#xn-store-cache` / `#xn-store-total` / `#xn-consent-mount` / `#xn-channel-val` / `#xn-score-val` / `#xn-score-grade` / `#xn-localmodel-mount` 逐一执行 `document.querySelectorAll(id).length`，**必须全部 === 1** |
| **AC-D20** | 指标真实刷新 | 进入隐私屏后读 4 项 | `#xn-proof-status` 文案非「…」；`#xn-c-*` 三计数为数字；`#xn-store-total` 非「—」 |
| **AC-D21** | 重复进入不劣化 | 离开/进入隐私屏 5 次 | 每次 `refreshMetrics()` 后指标仍正确；`#xn-consent-mount` 内开关数恒为 4（不重复堆叠） |
| **AC-D22** | 4 同意开关可用 | 逐个切换 tts/asr/ltm | 切换后 `ConsentStore.get(key)` 与 UI 一致 |
| **AC-D23** | cloudSync 二次确认不失效 | 开启 cloudSync | **必须**弹二次确认；取消则 `ConsentStore.get('cloudSync') === false`；确认后才为 `true` |
| **AC-D24** | 导出/清除可用 | 点击 4 个操作按钮 | 导出 JSON 成功；加密导出弹口令窗；诊断 JSON / 二维码本地生成；清除后计数归零且 `__xinyuReconsent` 已调用 |
| **AC-D25** | 桌面双列排布 | 1440px 下隐私屏 | 分区呈 ≥2 列；<1024px 下为单列 |

### 7.4 D 组 · 铁律不变（最高优先级）

| ID | 验收项 | 判定方法 | 通过标准 |
| --- | --- | --- | --- |
| **AC-D26** | **冻结字节不变** | `wc -c` 四文件 | `engine.js === 251068` **且** `sw.js === 13723` **且** `memory.js === 13333` **且** `test/baseline.js === 2646`。**任一不等即整体否决**。可直接复用 `test/qa-c-privacy-acceptance.test.js:321` 的 `FROZEN` 断言 |
| **AC-D27** | 全仓库零意外漂移 | 复用 `test/qa-c-privacy-acceptance.test.js:328` 的全仓库字节闸 | 除本候选申报的改动文件（`index.html` / `style.css` / `ui-shell.js` / 可选 `app.js` / 本 PRD）外，**无任何其它文件字节变化** |
| **AC-D28** | **小暖字样不变** | 全仓库文本检索 | `grep -c 小暖` 在 `index.html` 不减少；`data-xn="name"` 占位节点数不减少；`title` 仍为「心屿 · 你的 AI 女友」；**全仓库无「小暖」被改名/替换/意译的实例**；`manifest.json` 字节不变 |
| **AC-D29** | 新导航项不硬编码角色名 | 检查新增导航节点 | 涉及角色名的导航项（如「小暖」Tab）使用 `data-xn="name"` 占位，切换性别为「阿言」后导航文案同步变化 |
| **AC-D30** | **零上报不变** | 全流程操作后读审计 | `AuditProbe.getInstance().proveZeroReporting()` 的 `zeroReporting === true`；`blocked === 0`（未触发任何疑似上报）；`consented` 仅在用户显式开启云通道时 >0 |
| **AC-D31** | 壳层不新增网络请求 | DevTools Network 面板 | 从启动到遍历 6 屏，**无任何新增外部域请求**；新增请求仅 `ui-shell.js` 自身（同源） |
| **AC-D32** | **零新增 npm 依赖** | diff `package.json` / `package-lock.json` | `dependencies` 与 `devDependencies` **逐字节不变**；`ui-shell.js` 内无 `import` / `require` 外部包 |
| **AC-D33** | cloudSync 默认关不变 | 全新环境（清 localStorage）启动 | `ConsentStore.get('cloudSync') === false`；`#sync-enable` 未勾选 |
| **AC-D34** | 独立 Cache 边界不变 | 检查 `caches.keys()` | 仍只 open `xinyu-edge-v1`；**绝不 open** `sw` 冻结缓存（复用 `test/qa-c-privacy-acceptance.test.js:432` 断言） |

### 7.5 E 组 · 功能无损与回归

| ID | 验收项 | 判定方法 | 通过标准 |
| --- | --- | --- | --- |
| **AC-D35** | §5 映射表逐条通过 | 按 §5.1/5.2/5.3/5.4 的「校验点」列逐行验证 | **72/72 全通过**，零丢失 |
| **AC-D36** | 记忆 Tab 不重复 | 计数 | `document.querySelectorAll('.tabbar [data-page="ltm-manage"]').length === 1`（HTML 声明 + `app.js:4498` 幂等守卫共同保证） |
| **AC-D37** | 本地模型双视图一致 | 设置屏改 `#lm-model` 后进隐私屏 | 隐私屏 `LocalModelUI` 显示的模型与设置屏一致（单一真源，AC 对应决策 D-2） |
| **AC-D38** | 设置搜索仍生效 | `#me-search` 输入「音色」「同步」「模型」 | 命中卡片正确高亮/过滤；换组后无失效 |
| **AC-D39** | 设置分组折叠仍生效 | 点击 6 个 `.me-group-head` | 均可展开/收起，`aria-expanded` 同步 |
| **AC-D40** | 分组计数正确 | 读 `.me-group-count` | 语音与朗读=`4`、智能与模型=`2`，其余与卡片实数一致 |
| **AC-D41** | 蒸馏钩子未丢 | 对话若干轮后切至其它屏 | `ltmDistill()` 被调用（记忆条数或日志可证） |
| **AC-D42** | A/B/C 既有测试全绿 | 跑 `test/ltm.test.js` `qa-ltm-acceptance` `voice.test.js` `qa-voice-acceptance` `qa-c-privacy-acceptance` `c-regression` | **全部通过，零新增失败** |
| **AC-D43** | 降级安全 | 人为使壳层挂载失败（如临时改名 `#btn-privacy-audit`） | 不白屏；对话可用；退回 4+1 Tab + 弹窗形态；隐私功能仍可通过弹窗访问（不出现「弹窗已拆、屏未建成」的双失态） |
| **AC-D44** | hash 深链 | 直接访问 `#/privacy` `#/memory` `#/settings` | 刷新后落到对应屏；别名映射正确 |
| **AC-D45** | 动效降级 | 开启系统「减少动态效果」 | 屏切换与 LED 动效降级，不违反 `style.css:1019` 既有约定 |
| **AC-D46** | iOS 安全区 | iPhone 刘海/灵动岛机型或模拟 | 顶栏不被状态栏遮挡（`env(safe-area-inset-top)`）；底部 Tab 不被 Home 指示条遮挡（`env(safe-area-inset-bottom)`） |
| **AC-D47** | 键盘弹起不遮挡 | 移动端聚焦 `#chat-input` | 输入栏随键盘上移，消息流可见；`#voice-bar` 不错位 |
| **AC-D48** | 长内容不撑破 | 桌面端进设置屏、粘贴超长存档码 | `#cloud-export` / `#cloud-import` 不撑破 grid 内容区（`minmax(0,1fr)` 生效），无横向滚动条 |

### 7.6 验收门槛

- **D 组（AC-D26 – AC-D34）为一票否决项**：任一不通过，本候选整体不予合入。
- A/B/C/E 组要求 **100% 通过**；如有例外须由主理人书面豁免并记入 backlog。
- 建议新增独立验收文件 `test/qa-d-ui-acceptance.test.js`（仅新增测试文件，不改实现），复用 `qa-c-privacy-acceptance.test.js` 的 `FROZEN` 字节闸模式锚定 AC-D26/D27。

---

## 8. 风险与开放问题

### 8.1 技术风险与缓解

| ID | 风险 | 影响 | 概率 | 缓解措施 |
| --- | --- | --- | --- | --- |
| **R1** | **`#privacy-audit-body` 重复 id** —— 弹窗与屏同时 render，`privacy-audit.js:23` 的 `q()` 在省略 root 时退化为 `document.querySelector`（`:201` 等多处如此调用），只命中第一个节点 | **高**：隐私面板指标永远停在「…」/「—」，且是**静默失败**，无报错 | 中 | P4 硬约束（§4.5）：壳层挂载成功后**必须移除**弹窗内 body；AC-D19 对 13 个 `#xn-*` id 逐一断言 `length === 1` |
| **R2** | `#app { max-width: 560px }`（`style.css:62`）与桌面侧栏冲突 | 中：桌面端侧栏被挤压或内容区过窄 | 高 | §3.2 在 `@media (min-width:1024px)` 内显式 `max-width: none`；AC-D9 断言 |
| **R3** | grid 内容区被长内容撑破 | 中：横向滚动条、布局错位 | 中 | 必须用 `minmax(0, 1fr)` 而非 `1fr`；AC-D48 用超长存档码验证 |
| **R4** | `.page { display:flex }` 在 grid 子项内高度塌陷（`#chat-body` 依赖 `flex:1` + `min-height:0`） | 中：聊天消息流不滚动或高度为 0 | 中 | `#shell-main` 必须带 `min-height: 0`；保留既有 `.page { min-height: 0 }`（`style.css:63`）；AC-D10/D47 验证 |
| **R5** | `OfflineIndicator` DOM 迁移破坏实例 | 中：LED 不亮或双灯 | 低 | DOM 节点移动保留监听与引用；**严禁二次 `mount()`**；AC-D11/D12/D13 三重验证；`app.js:4530` 已有兜底选择器 |
| **R6** | `⚙` clone 换绑后未被 `bindTabs()` 绑定（时序竞态） | 中：⚙ 点击无响应 | 中 | §6.5 统一改用**事件委托**（挂在 `#shell-topbar`），与 `bindTabs()` 时序完全解耦；AC-D15 验证 |
| **R7** | `ltm-manage` 命名不一致（`data-page` 与 `page-<name>` 约定不符，`app.js:2993` 有特判） | 低：认知负担，后续维护易踩 | 已存在 | **刻意不改名**（§4.1），改名需动 `app.js` 路由核心，收益为零。用 hash 别名 `#/memory` 对外消化；记入长期 backlog |
| **R8** | 记忆 Tab 双份（HTML 声明 + `app.js:4499` 注入） | 中：Tab 栏出现 7 项 | 低 | `app.js:4498` 已有 `if (!bar.querySelector('[data-page="ltm-manage"]'))` 幂等守卫，HTML 先声明即自动空转；AC-D36 断言 `length === 1` |
| **R9** | iOS 安全区与键盘 | 中：顶栏被状态栏压、输入栏被键盘遮 | 中 | 沿用既有 `env(safe-area-inset-top/bottom)`（`style.css:69,326`）；`100dvh` 已在用（`style.css:62`）；AC-D46/D47 |
| **R10** | `#voice-bar` / `#ltm-corner` / `#ltm-toast` 等浮层 z-index 与新壳层冲突 | 中：浮层被顶栏/侧栏遮挡 | 中 | 壳层 z-index 需低于既有浮层层级（既有：`.nav` z=5、`.tabbar` z=10、`.levelup-toast` z=90、`#splash` z=99）；壳层顶栏建议 z=5、侧栏 z=6，不越过 10 以上；AC-D35 逐条目视 |
| **R11** | 桌面端立绘 SVG（`#her-stage`）在宽内容区被拉伸失衡 | 低：视觉失真 | 中 | §3.2 对 `.her-body` 等施加 `max-width: 860px; margin-inline:auto` |
| **R12** | 壳层挂载中途失败留下「弹窗已拆、屏未建成」双失态 | **高**：隐私功能完全不可达 | 低 | §6.6 强制顺序：**先建屏成功、再移除弹窗**；失败必须回滚；AC-D43 专项验证 |
| **R13** | 误触冻结线 | **致命**：整体否决 | 低 | 本候选改动清单物理上不含四文件（§6.7）；CI 字节闸 AC-D26 + 全仓库漂移闸 AC-D27 双重拦截 |
| **R14** | 设置屏卡片换组时误改控件 id 或删卡 | 高：功能丢失 | 中 | §4.4 明确「仅重排分组归属，不删卡、不改 id」；AC-D35 + AC-D40 |

### 8.2 历史 backlog 处置决策

任务点名的两个历史遗留项，本候选逐一给出**明确处置结论**。

#### Q1（backlog）· cloudSync 双开关未桥接

**已核实现状**（两处独立开关，无任何桥接代码）：

| 开关 | 存储 | 位置 | 默认 |
| --- | --- | --- | --- |
| `ConsentStore.cloudSync` | `xinyu.consent`（`consent-store.js:27`） | 隐私面板 `ConsentUI`（`consent-ui.js:27`），开启需二次确认（`:124-136`） | `false` |
| `SC.enabled` / `#sync-enable` | 云同步自身存储 | 设置屏「☁️ 云同步」卡（`app.js:3500-3516`） | `false` |

核实证据：`grep -n cloudSync app.js` **零命中** —— `app.js` 从未读写 `ConsentStore.cloudSync`；`registerConsentedEndpoints()`（`app.js:43-59`）判定外发端点时只看 `S.cloud.enabled` 与 `SC.enabled`，**不看** `ConsentStore.cloudSync`。两者确实是**平行且互不影响**的双开关。

**本候选处置决策：不做语义桥接，只做 UI 层一致性治理。**

理由：

1. **桥接是功能变更，不是 UI 重构**。真正桥接需要决定「谁是主、谁是从」、`ConsentStore.cloudSync=false` 是否应强制关闭正在运行的同步、二次确认语义如何与 `#sync-enable` 的既有交互合并。这些都是隐私语义决策，超出候选 D 范围。
2. **误动有真实外发风险**。若桥接写错方向（例如让 `#sync-enable` 的开启反向置 `ConsentStore.cloudSync=true` 而跳过二次确认），等于**削弱**了 `consent-ui.js:124-136` 刻意设置的防误触门控 —— 直接违反铁律 2。宁可保留双开关，也不能引入这种风险。
3. **本候选反而让问题更容易被发现**：隐私一级化后，`cloudSync` 开关从深埋弹窗变为一级屏可见项，用户与 QA 都更容易注意到两处不一致。

**但本候选必须交付的 UI 层缓解（新增需求，纳入验收）**：

- **UI-Q1-a 双向深链**：设置屏「☁️ 云同步」卡增加「查看隐私授权」链接 → 隐私屏分区③；隐私屏 `cloudSync` 开关旁增加「前往云同步设置」链接 → 设置屏对应卡。
- **UI-Q1-b 不一致告警条**：当 `ConsentStore.get('cloudSync') !== !!SC.enabled` 时，在**两处**均显示醒目提示：
  > ⚠️ 云同步的授权状态与开关状态不一致（授权：<开/关>，开关：<开/关>）。小暖只会在两者都开启时上传数据。
- **UI-Q1-c 保守取交集的文案口径**：明确告知用户「两者都开启才会外发」，这是最安全的对外表述，且与现状行为不冲突（因为实际外发仍由 `SC.enabled` 控制，而 `cloudSync` 默认关意味着用户若从未在隐私屏开启过，提示会引导其确认）。
- **遗留**：真正的语义桥接（含「授权关闭时强制阻断外发」）**留给候选 E**，建议作为独立隐私任务处理，并要求配套零上报回归测试。

> 判断依据：UI 候选可以**暴露**问题、**降低**误解，但不应**改变**隐私语义。

#### Q2（backlog）· `AuditProbe.tagConsented` 留白

**已核实现状**：`grep -c tagConsented audit-probe.js` = **0** —— 该方法**从未实现**。唯一调用点在 `app.js:116`：

```
if (typeof ap.tagConsented === "function") ap.tagConsented(CDN, "用户自导权重");
```

已被 `typeof` 守卫包裹，因此当前是**无害空转**，不抛错、不影响任何功能。

**本候选处置决策：不实现，明确不纳入本候选范围。**

理由：

1. **无 UI 影响**。隐私屏分区①的「已授权外发」计数 `#xn-c-consented` 来自 `AuditProbe.proveZeroReporting()` 的 `consented` 字段（`privacy-audit.js:198`、`audit-probe.js:363`），它依赖 `registerConsented()`（**已实现**，`audit-probe.js:325`）与 `record()`（**已实现**，`:341`），**不依赖** `tagConsented`。因此隐私屏 8 分区全部功能完整，无缺口。
2. `tagConsented` 的价值是给审计日志加**人类可读标注**（如「用户自导权重」），属于审计数据模型增强，归属候选 C 的 P2 收尾，不属于 UI 布局重构。
3. 实现它需改 `audit-probe.js`（非冻结、可改），但会引入审计日志结构变更 → 需同步 `AuditExporter` 导出格式与 `DiagnosticReport`，牵连面远超 UI 候选。

**处置**：保留 `app.js:116` 的 `typeof` 守卫（不动）。记入 backlog，建议归入候选 C 的后续增强批次。**本候选不因此项缺失而阻塞验收。**

### 8.3 开放问题（需主理人拍板）

| ID | 问题 | 选项 | 建议默认 |
| --- | --- | --- | --- |
| **D-Q1** | 底部 Tab 是否收敛到 5 项？6 项在 375px 窄屏下每项约 62px，接近可点性下限 | (a) 保持 6 项；(b) 把「故事」并入「小暖」屏做二级 Tab，收敛为 5 项 | **(a) 保持 6 项**。合并会造成 X-2 故事屏 10 个功能块下沉一层，违反零功能丢失的体验精神。若窄屏实测不佳，改用「图标 + 更小字号」而非合并 |
| **D-Q2** | 桌面侧栏是否支持折叠为图标栏（240px ↔ 64px） | (a) 本期不做；(b) 本期做 | **(a) 本期不做**。属增强项，不影响 AC；留候选 E |
| **D-Q3** | 是否为记忆屏/隐私屏增加二级 Tab（如隐私屏分「审计 / 同意 / 端侧」三段） | (a) 本期单页滚动 + 桌面双列；(b) 本期加二级 Tab | **(a)**。8 分区在桌面双列下一屏可览；加二级 Tab 会让 `PrivacyAudit.render()` 的单次 innerHTML 输出必须拆分，需改 `privacy-audit.js`，扩大改动面 |
| **D-Q4** | 屏切换是否加过渡动效 | (a) 极简淡入（120ms）；(b) 无动效；(c) 横向滑动 | **(a) 极简淡入**，且必须在 `prefers-reduced-motion` 下降级（AC-D45）。(c) 横向滑动需接管触摸手势，与 `#chat-body` 滚动冲突，不建议 |
| **D-Q5** | `#games-overlay` 情侣小游戏是否升级为屏 | (a) 保留浮层；(b) 升级为屏 | **(a) 保留浮层**（§4.7）。它是对话附属娱乐，且升级会占用导航预算 |
| **D-Q6** | 是否把「设置」屏拆为多屏（如设置一级列表 → 下钻子屏） | (a) 本期保持单屏 + 6 分组折叠 + 搜索；(b) 拆为二级下钻 | **(a)**。既有 `initMeGroups()` 折叠 + `initMeSearch()` 搜索已能有效导航 13 卡；拆二级下钻需新建 6 个子屏容器与返回栈，改动面与回归风险显著上升，收益边际 |
| **D-Q7** | `ui-shell.js` 是否需要纳入 `sw.js` 预缓存清单 | (a) 不纳入（走 `sw.js` 既有同源 fetch 策略）；(b) 纳入 | **(a) 不纳入** —— 纳入必须改 `sw.js`，**直接违反冻结线**。若离线首屏需要该文件，改用候选 C 已有的独立 Cache 命名空间 `xinyu-edge-v1` 通过 `CacheWarmer` 预热（不碰 key=19） |

### 8.4 不在本候选范围（明确排除）

- 任何新增业务功能（新玩法、新记忆能力、新语音能力）
- `cloudSync` 语义桥接（→ 候选 E，见 Q1）
- `AuditProbe.tagConsented` 实现（→ 候选 C 后续批次，见 Q2）
- 主题/暗色模式扩展（既有 `#theme-group` 主题色不变）
- 国际化 / 多语言
- 任何冻结线文件的改动（**永久排除**）

---

## 附录 A · 改动文件清单（供 CI 白名单核对）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `ai-girlfriend/ui-shell.js` | **新增** | 导航壳共存层（挂 `window.XinyuShell`，IIFE，零依赖） |
| `ai-girlfriend/index.html` | 改动（仅追加/重排） | `#page-privacy` 新屏；`.tabbar` 声明记忆/隐私两项；追加 `<script src="ui-shell.js">`；语音 4 卡换组 + `.me-group-count` |
| `ai-girlfriend/style.css` | 改动（仅末尾追加） | 壳层布局 + 三档响应式 + 隐私屏桌面双列 |
| `ai-girlfriend/app.js` | 改动（可选，仅追加） | 理想为零改动 |
| `ai-girlfriend/test/qa-d-ui-acceptance.test.js` | **新增（建议）** | D 组验收 + 字节闸 |
| `ai-girlfriend/docs/DESIGN-xinyu-v3-ui.md` | **新增** | 本 PRD |

### 冻结线（不出现在上表中，永久排除）

| 文件 | 字节 |
| --- | --- |
| `ai-girlfriend/engine.js` | 251068 |
| `ai-girlfriend/sw.js` | 13723 |
| `ai-girlfriend/memory.js` | 13333 |
| `ai-girlfriend/test/baseline.js` | 2646 |

> **本 PRD 郑重声明：候选 D 不改动冻结线。** 上述四文件字节数必须精确相等，由 AC-D26（四文件字节闸）与 AC-D27（全仓库零漂移闸）双重把关，任一不符即整体否决。
>
> **产品名「心屿」、AI 女友名「小暖」全文不改、不替换、不意译。**

---

*文档结束 · 许清楚（Xu）· 心屿 Xinyu v3 候选 D*
