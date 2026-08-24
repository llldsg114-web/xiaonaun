# 心屿 · 候选 E · 回答系统「真人感」体系化优化 · 架构

> 角色：架构 · 高见远
> 输入：PRD `DESIGN-xinyu-v3-reply-human.md`（许清楚，已批准）
> 铁律（全程生效）：① 小暖不更名；② 隐私零上报；③ 零新增 npm 依赖；
> ④ **冻结线治理**：`engine.js`(251068B)/`sw.js`(13723B)/`memory.js`(13333B)/`test/baseline.js`(2646B) 严禁改动，字节数作 CI 级字节闸；
> ⑤ SOP：许清楚→高见远→寇豆码→严过关→齐活林。

---

## 0 · 设计目标（一句话）

在**绝对不碰冻结线 `engine.js`** 的前提下，于「engine 生成之后、显示之前」构建一条统一的**回复质感编排后处理管道**，
把分散的 `texture.js` 微行为、`local-heuristic.js` 兜底、以及新增的节奏/情绪/记忆/话题策略，体系化地作用在**所有 provider 出口**上。

---

## 1 · 冻结线治理结论（物理零交集）

### 1.1 字节闸（CI 级断言，本候选绝不破）

| 文件 | 冻结字节 | 本候选是否改动 | 守护测试 |
|---|---|---|---|
| `engine.js` | 251068 | **否**（0 字节差） | `c-regression.test.js` / `qa-c-privacy-acceptance.test.js` |
| `sw.js` | 13723 | 否 | 同上 |
| `memory.js` | 13333 | 否 | 同上 |
| `test/baseline.js` | 2646 | 否 | 同上 |

### 1.2 物理零交集表（改动落点全部在非冻结层）

| 层 | 文件 | 改动性质 | 与冻结线交集 |
|---|---|---|---|
| L1 | `texture.js`（非冻结，77 行） | 扩展微行为策略（情境化口头禅、情绪停顿、记忆呼应扩展） | 无 |
| L2 | `local-heuristic.js`（非冻结，211 行） | 句库按 `tone` 分流 + 亲密度轻调 | 无 |
| L3 | `reply-texture-orchestrator.js`（**新增**） | IIFE 零依赖零外发，挂 `window.ReplyTexture` | 无（独立文件） |
| L4 | `app.js`（非冻结，221KB） | **仅 2 处**：① `S.persona` 配置对象（tone 修复 + 新增 warmth/proactivity/whitespace）；② `app.js:1389` for 循环挂载点 1 处 | 字节可变，但**仅配置与挂载，不含生成逻辑** |
| L4 | `index.html`（非冻结） | `tone-group` 的 chip `data-tone` 与默认值对齐（如需） | 无 |

> **关键论证**：`engine.js` 的 `applyPersonaStyle` / prompt 构建 / 人设卡片 / `MOODS` / v11 三开关**全部字节不变**。
> 真人感的所有增量都在 `engine` 之外，通过既有 `Engine.mod("texture")` 插件机制（候选 A/B/C 已验证的模式）与「显示前挂载点」注入。

---

## 2 · 现状链路与挂载点（探查实证）

```
用户输入 text
  → app.js herReply()（约 L1283 起）
      ├─ 云端分支  L1291-1305：__replyRouter.route(text) → routed（cloud/local/heuristic 纯文本）
      │     └─ result = { replies:[routed], ... }        ← ★ routed 直出，未过 texturePass
      ├─ 端侧分支  L1307-1309：localThink(text)
      └─ 本地引擎  L1313-1354：Engine.reply(text, est)
            └─ Engine 内部经 Engine.mod("texture").texturePass 做微行为  ← ★ 仅此分支有微行为
            └─ Engine.mod("texture").textureAfterTurn 更新 est.tex（日配额）
      → L1356-1378：state 字段回写 + save()
      → L1384-1385：情绪状态机
      → L1389-1392：for 循环 —— 逐条 herSay(result.replies[i], expression)  ★ 统一显示关卡
```

### 2.1 核心发现（决定 L3 形态）

1. **`texture.js` 的微行为后处理（`texturePass`）只在「本地引擎兜底分支」(L1313-1354) 经 `Engine.mod("texture")` 生效**。
2. **云端主力路径 (L1293-1296) 直出 `routed`，完全绕过 `texturePass`** —— 这是「云端小暖不够真人感」的硬成因之一。
3. `app.js:1389` 的 `for` 循环是**所有 provider 出口的统一显示关卡**，且位于「engine 生成之后、显示（herSay）之前」。

### 2.2 L3 唯一挂载点（裁决）

**`app.js:1389` 的 `for` 循环内、每个 `herSay` 调用之前**，插入一行后处理：

```javascript
for (let i = 0; i < result.replies.length; i++) {
  let reply = result.replies[i];
  // ★ 候选 E（L3）：回复质感编排后处理管道（engine 之外，对所有分支统一生效）
  if (window.ReplyTexture && window.ReplyTexture.orchestrate) {
    try { reply = window.ReplyTexture.orchestrate(reply, { state: S, ctx: { ue: result.ue, mood, intent: result.intent } }); }
    catch (e) { /* 任一异常 → 原句直出，绝不静默 */ }
  }
  await herSay(reply, result.expression);
  if (i < result.replies.length - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
}
```

**收益**：
- 一处挂载，覆盖 cloud / local / heuristic / engine 全部出口，**补齐云端逃过 `texturePass` 的缺口**。
- 不改 `engine.js`、不改 `app.js` 生成逻辑，仅 1 处「显示前」钩子 → **L4 改动面极小且可审计**。
- `orchestrate` 返回新字符串，纯函数语义，与既有 `herSay` 完全解耦。

---

## 3 · L3 管道内部设计（`reply-texture-orchestrator.js`）

### 3.1 文件契约

```javascript
(function () {
  'use strict';
  var G = (typeof window !== 'undefined') ? window : (...);
  if (!G) return;                       // 无 DOM/无 window 环境直接 return（node 测试兼容）
  var VERSION = 'e1';
  // 总开关：S.flags.textureOrch === false 时 orchestrate 原样返回（降级闸门）
  // 零依赖：仅用 G.Engine.mod / G.LocalHeuristic / DOM / localStorage
  // 零外发：全文无 fetch/XHR/WebSocket/URL 构造等网络 API（可由 /网络外发字面/ 正则扫描守护）
  function orchestrate(text, opts) { ... }   // 纯函数：text+ctx → 新 text（绝不重新生成内容）
  G.ReplyTexture = { version: VERSION, orchestrate: orchestrate,
                     setConfig: function(c){...}, state: {...} };
})();
```

### 3.2 `orchestrate` 顺序调度（每步独立 try/catch，失败跳过该步）

```
orchestrate(text, {state, ctx}) =
  1. 防叠加检测：若 text 已含明显微行为标记（语气词/口头禅前缀），跳过"轻量微行为补充"
  2. 节奏控制（pacing）：超长回复依 warmth/whitespace 适度分段/留白（不破坏语义、不切断句子）
  3. 情绪镜像（mirror）：对 ctx.ue 做轻量回声（"感受到你了"而非复述），强度随 mood/affection
  4. 记忆自然引用（recall）：把 state.mem / state.dayLife.trace 以自然语言轻量回扣（复用 texture drift 思路，扩到短期）
  5. 话题连贯（continuity）：相邻轮次自然承接（承接词/过渡），避免突兀跳转
  6. 返回加工后 text
```

> **幂等**：相同 `(text, ctx)` 多次调用结果一致（无随机串入最终文本，或随机仅用于"可选增强"且被总开关/配额约束）。
> **可降级**：`try/catch` 包每个子策略；任一抛错 → 跳过该策略继续，最终仍返回**可读文本**；`orchestrate` 外层再包一层，异常则 `return text`（原句直出，绝不静默/白屏）。

### 3.3 L3 与 `texture.js` 职责切分（**防叠加，硬约束**）

| 维度 | 归属 | 说明 |
|---|---|---|
| 犹豫词 / 口头禅 / 断句 / 手误错别字 | **texture.js**（仅本地引擎分支，现状保持） | 不重复造轮子，L3 不调用 `texturePass` |
| 节奏分段 / 情绪镜像 / 记忆自然引用 / 话题连贯 | **L3 orchestrator**（全分支生效） | texture 未覆盖的新维度 |
| 轻量微行为补充（仅云端分支） | **L3**（受防叠加检测约束） | 仅当 text 不含微行为标记时，对云端裸文本补极轻量口语化；本地引擎分支因已含 texture 微行为，L3 跳过此步 |

> **绝不双重微行为**：L3 明确**不调用** `Engine.mod("texture").texturePass`（否则本地引擎分支会被 texture + L3 双重加工，导致"嗯…那个…唔…"堆砌）。职责按上表切分，互不重叠。

### 3.4 状态入参（只读，不写）

`orchestrate(text, { state: S, ctx })` 中 `S` 仅作**只读**来源（`S.persona` / `S.affection` / `S.ue` / `S.tex` / `S.mem` / `S.dayLife`）。
**不写 state**——写回责任沿用 v13 待决点④的「宿主回写」模式（在 app.js 落盘），L3 是纯函数后处理，与 `textureAfterTurn` 口径一致。

### 3.5 配置驱动（L4 联动）

`orchestrate` 的强度由 `S.persona` 新增参数驱动：
- `warmth`(语气温度)：统调情绪镜像/承接词强度
- `proactivity`(主动度)：记忆引用/话题延伸的频率上限
- `whitespace`(留白度)：节奏分段/留白程度

默认值在 `app.js:356/416` 的 `S.persona` 配置对象中定义。

---

## 4 · L4 改动面裁决（tone 错位修复）

### 4.1 问题（PRD §3.1 实证）

- `app.js:356/416`：`S.persona = { gender:"female", tone:"gentle", theme:"sakura", card:"xiaonuan" }`
- `texture.js` 口头禅分支：`{playful:"tsundere", clingy:"clingy"}[tone] || "soft"`
- `engine.js` 人设卡片 tone 枚举：`playful / tsundere / clingy`

`tone:"gentle"` **不在**下游预期枚举 → 口头禅退化到 `soft`、风格卡走默认。**根因：配置演进不一致（app.js 停留在旧 `gentle`，下游演进到三态）。**

### 4.2 裁决方案（不改 `engine.js`，推荐）

**采用「app.js 层 `toneAlias` 归一化映射」+ 默认值对齐三态**：

```javascript
// app.js（仅配置层，不改生成逻辑）
var TONE_ALIAS = { gentle: "playful", soft: "playful", cute: "playful",
                   tsundere: "tsundere", clingy: "clingy", playful: "playful" };
// S.persona 默认 tone 改为已定义三态之一（推荐 "playful"，最贴近原人设"温柔软萌偶尔小傲娇"）
S.persona = { gender:"female", tone:"playful", theme:"sakura", card:"xiaonuan",
              warmth: 0.6, proactivity: 0.5, whitespace: 0.5 };
// 对外/下游消费前归一化：normTone = TONE_ALIAS[S.persona.tone] || "playful"
```

- **不碰 `engine.js`**（applyPersonaStyle / getCard 保持原样，拿到的已是归一化三态）。
- **`index.html` 的 `tone-group` chip**：`data-tone` 同步为 `playful/tsundere/clingy`（移除/替换 `gentle` chip），保证 UI 选择态与下游一致（app.js:4062 的 chip toggle 按 `data-tone` 匹配）。
- UI 设置屏原有「语气」分组可承载 warmth/proactivity/whitespace 三滑杆（如未存在则在「设置屏」内新增，零新增依赖）。

> **否决方案**：扩展 `engine.js` 的 `getCard` 枚举加 `gentle`（触碰冻结线，否）；直接改默认 tone 但不同步 UI（导致 chip 选中态错乱，否）。

---

## 5 · 降级与回滚契约

| 场景 | 行为 |
|---|---|
| `window.ReplyTexture` 未加载（脚本缺失/未就绪） | 挂载点 `if` 短路，原句直出，**零影响** |
| `orchestrate` 内部任一子策略抛错 | 跳过该策略，继续后续；最终返回可读文本 |
| `orchestrate` 外层异常 | `catch` → `return text`（原句直出，不静默不白屏） |
| 总开关 `S.flags.textureOrch === false` | `orchestrate` 首行直接 `return text`（一键关闭所有真人感后处理，回退原行为） |
| L2 兜底异常 | `local-heuristic.js` 自身 `try/catch` 保障，例外走 `DEFAULT_POOL`，保证永不静默 |

**回滚路径**：`git revert` 候选 E 提交即完全回退；或仅置 `S.flags.textureOrch=false` 在线关闭 L3，无需发版。

---

## 6 · 零外发 / 零依赖论证

- `reply-texture-orchestrator.js`：IIFE，仅引用 `window`（含 `Engine.mod` / `LocalHeuristic` 既有门面）、`document`、`localStorage`；**全文不含** `fetch`/`XMLHttpRequest`/`WebSocket`/`navigator.sendBeacon`/`new URL`/`import` 等网络/模块 API。
- 由 `/网络外发字面/` 正则静态扫描，命中恒为 0（与 `ui-shell.js` / `reply-router.js` 同铁律，QA 阶段复验）。
- 零 `npm install`：`package.json` 不变。

---

## 7 · 验收契约（对应 PRD AC-E1~E12）

| AC | 本架构对应守护 |
|---|---|
| E1 冻结字节精确 | §1.1 字节闸 + CI 断言 |
| E2 app.js 改动可审计 | §2.2 / §4.2：仅 `S.persona` 配置 + 挂载点 1 处 + index.html chip 同步 |
| E3 零新增依赖 | §6 `package.json` diff 审查 |
| E4 零外发 | §6 正则扫描 |
| E5 小暖不更名 | 字面扫描 |
| E6 旧基线 449/0 | `node --test ai-girlfriend/test/*.test.js` |
| E7 tone 错位修复 | §4.2 行为级单测（normTone 映射 + 口头禅分支生效） |
| E8 L1 情境化 | texture 单测（口头禅随 tone+ue、配额门禁仍生效） |
| E9 L2 兜底人设化 | local-heuristic 单测（tone 分流 + 非机械） |
| E10 L3 幂等降级 | orchestrator 单测 + 异常注入（子策略抛错→跳过→原句直出） |
| E11 L4 配置生效 | 单元 + 浏览器抽查（warmth/proactivity/whitespace 驱动强度） |
| E12 浏览器真机抽查 | Playwright 双视口（桌面/移动）：对话/降级/记忆呼应自然度、不卡白屏 |

---

## 8 · 风险与开放问题

| 风险 | 缓解 |
|---|---|
| 误改 engine.js | 字节闸 + 主理人独立核验 + L3 为独立文件物理隔离 |
| L3 与 texture 双重微行为 | §3.3 防叠加硬约束（L3 不调 texturePass + 防叠加检测） |
| 过度润色（油腻） | warmth/whitespace 受配额与等级门禁约束；AC-E8/E11 行为级守克制度 |
| 云端分支仍缺 texture 微行为 | L3 轻量微行为补充（受防叠加检测，仅云端裸文本触发）；接受"微行为维度仅本地引擎分支"的现状（冻结线约束下的已知取舍） |
| 降级失效 | §5 多层降级 + 总开关 |

**开放问题（实现阶段定）**：L3 节奏分段的最大长度阈值、记忆引用的最大条数、情绪镜像的触发意图白名单——在实现阶段以行为级单测固化，避免过度。

---

## 9 · 进入实现阶段的条件

本架构经用户批准（「批准」）后，转工程师寇豆码实现：
1. `texture.js`（L1 扩展）
2. `local-heuristic.js`（L2 tone 分流）
3. `reply-texture-orchestrator.js`（L3 新增）
4. `app.js`（L4：`S.persona` 配置 + `toneAlias` + 挂载点 1 处）
5. `index.html`（L4：tone-group chip 同步）
6. `test/qa-e-acceptance.test.js`（严过关验收）
