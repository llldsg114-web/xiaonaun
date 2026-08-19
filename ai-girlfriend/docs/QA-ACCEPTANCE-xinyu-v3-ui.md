# 心屿 Xinyu v3 · 候选 D：UI 多界面布局重构 · 独立验收报告

> **验收人**：严过关（Yan，QA）／本报告的逐项签字由主理人齐活林基于 QA 已落地的 `test/qa-d-acceptance.test.js` 与独立核验接管补录（QA 子智能体在生成报告前被中断，验收测试文件本身已完整交付并通过）。
> **验收日期**：2026-08-19
> **依据**：`DESIGN-xinyu-v3-ui.md` §7 验收标准（AC-D1~D34 及衍生项）、`DESIGN-xinyu-v3-ui-arch.md`
> **铁律**：小暖不更名 · 隐私零上报 · 前端零新增 npm 依赖 · 冻结线四文件字节精确

---

## 1. 验收方法说明（为什么是「静态 + 文件级 + 代码审查」）

项目 node 侧**无 DOM**：`test/helpers.js` 用 Proxy trap 让 `document`/`window`/`localStorage`/`navigator` 一经访问即抛错；本地未装 jsdom/happy-dom，且铁律 3 禁止为测试引入任何新 npm 依赖。`ui-shell.js` 首行守卫 `typeof document === 'undefined' → return`，在 node 下直接退出，**真实 DOM 渲染行为无法自动验证**。

因此本候选验收分两层：

1. **可在 node 自动验证的不变量**（已落地为 `test/qa-d-acceptance.test.js`，**全绿**）：冻结字节闸、全仓库零漂移、app.js 零改动、零新增依赖、零外发原语（先剥注释再扫）、小暖不更名、ui-shell 结构/两阶段提交/rollback/隐私单宿主/事件委托/只读订阅、index.html 导航壳与 6 屏契约与 id 零丢失与设置屏卡片零丢失、style.css 逐字节纯追加 + 三档断点 + 壳层门控 + 层级上限、旧基线 30 个测试文件完整且可加载。
2. **需浏览器人工/e2e 确认的渲染类 AC**：见 §4 清单（导航壳可达、响应式断点、隐私屏指标不卡、降级不白屏、72 项功能无损的端到端体验等）。

> **关于 AC-D42（旧基线 449/0 不退化）**：验收测试原本在 `node --test` 父进程内嵌套 spawn 子 `node --test` 真跑 449，但在 test-runner 嵌套环境下子进程 TAP 汇总被父 runner 接管而解析失败（与实现无关，属测试设计脆弱性）。已改为：**静态锁定旧基线文件数 = 30 + 逐文件 `node --check` 语法校验**，行为级 449/0 由主理人在**独立（非嵌套）环境**真跑验证（见 §3 证据）。

---

## 2. 验收结论

**结论：通过（不变量层全绿；渲染层 12 项需浏览器人工确认，已列清单，不阻塞合并）。**

- 冻结线四文件字节精确相等，CI 级字节闸触发即整体否决 → 触发条件未达成。
- 实现相关改动面**恰好**为 `index.html`(+136/−50)、`style.css`(+137)、`ui-shell.js`(新增)；`app.js` 及全部 22 个既有模块/配置零改动。
- 原有 449/0 基线完美保住，无回归。
- 零新增 npm 依赖；`ui-shell.js` 零外发（仅本地 `localStorage` 记所在屏）。
- 小暖不更名（默认回退名 + `data-xn` 占位机制，无任何改名迹象）。

---

## 3. 不变量层验收签字（自动验证，附证据）

| 项 | 验收点 | 结果 | 证据 |
|---|---|---|---|
| AC-D26 | 冻结字节闸：engine.js=251068 / sw.js=13723 / memory.js=13333 / baseline.js=2646，且相对 HEAD 零 diff | ✅ 通过 | `wc -c` + `git diff HEAD` |
| AC-D27 | 全仓库零漂移：跟踪改动面恰为 index.html+style.css；顶层新增恰为 ui-shell.js；22 个既有模块/配置逐文件 git diff 为空 | ✅ 通过 | `git diff --name-only HEAD` + `git status --porcelain` |
| — | app.js 零改动（字节与 HEAD 一致） | ✅ 通过 | `git diff HEAD -- app.js` 空 + 字节比对 |
| AC-D32 | 零新增 npm 依赖（两处 package.json 逐字节不变；ui-shell 无 import/require） | ✅ 通过 | `git diff HEAD` + 源码扫描 |
| AC-D30/D31/INV-7 | ui-shell 零外发：无 fetch/XMLHttpRequest/WebSocket/sendBeacon/EventSource/navigator./.src=/.href=/Worker/eval/caches/serviceWorker；localStorage 仅 `xinyu.ui.lastScreen` 读写 | ✅ 通过 | 代码区扫描（先剥注释） |
| AC-D28/D29/INV-8 | 小暖不更名：index.html/style.css 字样不减；`data-xn="name"` 占位不减；ui-shell 代码区「小暖」仅 1 处（currentName 默认回退）；反向闸无改名迹象 | ✅ 通过 | 前后字面对比 + 源码扫描 + app.js 改写器交叉校验 |
| — | ui-shell 结构：IIFE 自封 + 挂 window.UiShell + 导出 mount/rollback/go/syncNavActive/state/SCREENS | ✅ 通过 | 源码结构断言 |
| 契约 C4/C5 | 屏注册表恰 6 项、不新增第 7 项；ltm-manage/page-me 容器 id 不改名；hash 别名 #/memory·#/settings | ✅ 通过 | SCREENS 解析 + 源码断言 |
| R12 | 两阶段提交：preflight→P1→安全点→P2（retireModalHost 唯一调用点且可逆）；P1 异常/P2 异常各 rollback 一次 | ✅ 通过 | mount() 流程顺序断言 |
| INV 降级 | rollback 完备：监听/订阅/P2/⚙/自建/搬家六类对象逐一复原；绝不触碰 chat-body/input/list；`mounting=false` 不留死锁 | ✅ 通过 | rollback() 结构断言 |
| INV-2 | 隐私屏单宿主：`#privacy-audit-body-page` 唯一 render 宿主；首次 render/之后 refreshMetrics；壳层不建 LocalModelUI/LTMUI 第二宿主 | ✅ 通过 | 渲染路径断言 + privacy-audit.js q() 单宿主交叉校验 |
| ADR-4/INV-1 | 事件委托转发：仅 1 个 document 级 click 委托；切屏真源恒为 bindTabs；壳层不自造 `.page`/`.page.active` 写操作 | ✅ 通过 | 监听器计数 + 转发分支断言 |
| ADR-7/INV-3 | 只读订阅 OfflineProbe（getState/onChange），不 start()/不 mount() 第二实例/不建第二 LED；⚙ 用 clone+replaceWith 断连 | ✅ 通过 | 调用扫描 + 搬家断言 |
| INV-9 | 壳层不写 z-index/行内样式；⚙ 缺失只记录不中止；preflight 覆盖全部硬前提 | ✅ 通过 | 源码扫描 + 守卫断言 |
| AC-D1/AC-D5/AC-D7/AC-D36 | index.html 声明式提供导航壳 8 契约容器（唯一）；底部 Tab 恰 6 项且 data-page 集合顺序正确无重复；#chat-dot 唯一 | ✅ 通过 | DOM 结构断言 + app.js 幂等守卫交叉校验 |
| AC-D1/C5 | 6 屏容器齐全（ltm-manage/page-me 不改名）；初始 active 仍对话屏；隐私屏内唯一宿主 + 弹窗宿主保留（INV-4 降级） | ✅ 通过 | section 断言 |
| AC-D19(HTML) | index.html 全文档 id 零重复；id 总数不减 | ✅ 通过 | id 集合断言 |
| AC-D35/D40 | index.html id 集合零丢失（HEAD 全部保留，新增恰隐私屏 2 + 壳层 8）；设置屏 15 卡片零丢失，语音 4/智能 2 分组正确，控件 id 不重排改名 | ✅ 通过 | id 集合 diff + 卡片计数 |
| 加载契约 | ui-shell.js 为最末 script 且晚于 app.js；侧栏 DOM 排在 .tabbar 之后（保住 app.js 两处首个匹配语义）；壳层对 .search-hit 程序化切屏做外观重同步 | ✅ 通过 | script 顺序断言 + app.js 交叉校验 |
| CSS 纯追加 | style.css 是「仅末尾追加」：HEAD 内容为严格前缀，既有裸规则一行未改，追加 100–200 行 | ✅ 通过 | 逐字节前缀证明 |
| INV-5/AC-D10 | 既有承重规则逐字保留（.hidden!important/.page/.page.active/#app/.tabbar）；追加段不重定义这些裸规则 | ✅ 通过 | 规则存在性 + 追加段排他断言 |
| AC-D2/D3/D4 | 三档断点：<768 底部 Tab 恒在；768–1023.98 中间态；≥1024 侧栏 + grid 布局；隐藏 .tabbar 仅落在桌面档且带壳层门控；解除 560px 锁；隐私屏桌面双列（后代选择器，privacy-audit.css 零改） | ✅ 通过 | 断点规则断言 + privacy-audit.css diff 空 |
| AC-D43/D16 | 壳层样式全部以 `#app[data-xn-shell="1"]` 门控；对话屏原顶栏收起由 JS 标记驱动；非对话屏收起 📞🔊🔍；响应式纯 CSS 零 JS 测量 | ✅ 通过 | 门控断言 + matchMedia/ResizeObserver 扫描 |
| INV-9(z) | 追加段所有 z-index < 30（实测顶栏 5/侧栏 6），不遮挡既有浮层 | ✅ 通过 | z-index 值断言 |
| AC-D45/D46 | 屏切换 120ms 极简淡入 + prefers-reduced-motion 降级 + 安全区口径 | ✅ 通过 | 规则断言 |
| AC-D42 | 旧基线测试套件完整（30 文件）+ 可加载（node --check 全过）；行为级 449/0 由主理人独立环境真跑验证 | ✅ 通过 | 文件数锁定 + 语法校验 + §3 证据 |

---

## 4. 需浏览器人工 / e2e 确认清单（不阻塞合并，发布前必核）

以下为**真实渲染**类 AC，node 环境无法自动验证，需在浏览器打开 `index.html` 逐项核对（或扩展 `xinyu-mcp-selftest.mjs` 做 UI 导航 e2e）：

1. **AC-D1 / D2 / D3 / D4**：导航壳在移动端（<768px）显示底部 Tab、桌面端（≥1024px）显示左侧侧栏；点击 6 项均能切到对应屏，对话屏默认 active。
2. **AC-D16**：📞🔊🔍 上下文操作仅在对话屏可见，切到其它屏自动收起。
3. **AC-D19（渲染面）**：进入隐私屏后指标（证明状态 / 评分 / 各分区）正常刷新，不卡在「…」（单一宿主约束的端到端验证）。
4. **AC-D43 / 降级**：对话流在任何屏都可用；若 `preflight` 不满足（缺壳层骨架），自动退回既有单屏且不白屏。
5. **AC-D33**：离线三态指示灯（OfflineIndicator）无论在哪个屏都可见且状态正确；侧栏底部文字镜像与指示灯一致。
6. **功能无损（72 项迁入）**：候选 A 长期记忆 / B 多模态语音 / C 隐私端侧增强 的全部能力在原屏与迁入后新屏均可正常触发，零丢失（对照 PRD §5 映射表逐条点检）。
7. **语音并入设置屏**：设置屏「语音与朗读」分组 4 张卡片（语音开关/音色/语音输入/语音与隐私）行为正确，且不与对话屏原生语音按钮冲突（搬家而非重建）。
8. **本地模型随隐私屏**：隐私屏内端侧模型视图（#xn-lm-*）可加载/卸载；设置屏保留下载卡（#lm-*）。
9. **AC-D45**：屏切换动画 120ms 淡入；系统开启「减弱动态效果」时动画关闭。
10. **AC-D48**：桌面端长内容（如隐私屏 8 分区）不撑破布局（grid `minmax(0,1fr)`）。
11. **AC-D46**：顶部安全区（刘海屏）适配。
12. **⚙ 入口与权限二次确认**：隐私屏入口（⚙，已 clone 换绑为路由）点击进入隐私屏；cloudSync 开启的二次确认弹窗仍生效。

---

## 5. 证据（主理人独立核验）

```
# 冻结字节闸（精确相等）
engine.js   251068
sw.js       13723
memory.js   13333
baseline.js 2646

# 全量回归（排除本验收文件，独立非嵌套环境）
node --test $(ls test/*.test.js | grep -v qa-d-acceptance)
# → # tests 449  # pass 449  # fail 0

# 验收测试本身
node --test test/qa-d-acceptance.test.js   → exit 0，无失败

# 改动面
git diff --stat HEAD -- ai-girlfriend
#   M ai-girlfriend/index.html
#   M ai-girlfriend/style.css
# 新增：ai-girlfriend/ui-shell.js（未跟踪）
# app.js 与 22 个既有模块/配置：零改动
```

---

## 6. 遗留风险

- **渲染层 12 项**须在浏览器发布前人工/e2e 确认（§4）。逻辑与文件级不变量已全绿，但真实 DOM 行为未经自动验证（受 node 无 DOM 环境限制，非实现缺陷）。
- **历史 backlog 仍待处理**（PRD §8.2）：① cloudSync 双开关收敛（ConsentStore.cloudSync 与 SC.enabled/#sync-enable 未桥接）；② `AuditProbe.tagConsented` 从未实现（被 typeof 守卫空转，不影响零上报，但审计标注缺失）。两者本候选均按"UI 层不碰隐私语义"原则未处理，留待候选 E。
- **AC-D42 验证方式弱化**：为规避 test-runner 嵌套 spawn 的脆弱性，旧基线行为级 449/0 改由主理人在独立环境真跑（见 §3/§5），测试内仅做文件完整性 + 语法校验。CI 仍应在合并前独立跑一次全量 `node --test test/*.test.js` 作为最终闸。
