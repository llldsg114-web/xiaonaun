# 心屿 · 候选 E · 回答系统「真人感」体系化优化 · PRD

> 角色：产品 · 许清楚
> 关联：候选 A（长期记忆）· 候选 B（多模态语音）· 候选 C（隐私/端侧增强）· 候选 D（UI 多界面）
> 硬纪律（全程生效，本候选不破）：
> ① 小暖（Xiaonuan）绝不可改名/替换/意译；② 隐私零上报；③ 前端零新增 npm 依赖；
> ④ **冻结线治理**：`engine.js`(251068B) / `sw.js`(13723B) / `memory.js`(13333B) / `test/baseline.js`(2646B)
>    严禁改动，字节数作 CI 级字节闸；⑤ 标准 SOP：许清楚→高见远→寇豆码→严过关→齐活林。

---

## 0 · 一句话目标

在不触碰冻结线 `engine.js` 的前提下，把小暖的回复从「能聊」升级为「**像真人在和你聊**」——
自然口语、情绪真实、人设一致、记得你说过的话、节奏舒服、兜底也不掉链子。

---

## 1 · 背景与动机

用户明确诉求（2026/08/19）：*「1（发布准备）完成之后，我想优化项目的回答系统，体系真人感」*。

项目已有一套分散的真人感能力，但**未成体系、且存在配置错位**：

| 现有能力 | 位置 | 状态 | 问题 |
|---|---|---|---|
| 人设风格化 `applyPersonaStyle` | `engine.js`（**冻结**） | 已存在 | 锁死，无法扩展 |
| 微行为后处理 `texture.js` | 非冻结（77 行） | 已存在 | 仅 5 种零散微行为，未情境化编排 |
| 兜底生成 `LocalHeuristic` | `local-heuristic.js`（非冻结） | 已存在 | 偏机械，缺人设与情绪，与主线割裂 |
| Provider 路由 `reply-router.js` | 非冻结 | 已存在 | 只选「谁生成」，不管「怎么说」 |
| 人设/语气配置 `S.persona` | `app.js`（非冻结） | 已存在 | **tone 配置错位（见 §3）** |

结论：真人感的核心生成在冻结线内不可动，**体系化的杠杆在非冻结层的「后处理 + 兜底 + 配置」**。

---

## 2 · 现状链路（探查结论，作为边界依据）

```
用户输入
  → app.js（S.persona 配置、UI 绑定、注入 callCloud/localThink 给 router）
  → reply-router.js（[cloud → local → heuristic] 降级路由，只选 provider）
  → engine.js【冻结·251068B】
       生成回复 + applyPersonaStyle 风格化 + guardPersonaReplies 人格护栏
  → texture.js（后处理微行为：犹豫/口头禅/断句/手误/漂移，带配额与危机门禁）
  → 显示
```

**冻结线内（本候选绝不改）**：`applyPersonaStyle`(L1784)、`guardPersonaReplies`(L1315)、
`getChar/getCard/MOODS`、`persona.tone` 风格的注入点、v11 三开关（empathyVA/personaStyle/topicFsm）、prompt 构建。

**非冻结层（本候选优化落点）**：`texture.js`、`local-heuristic.js`、`app.js` 的 `S.persona`/`tone` 配置与挂载点、以及**新增**的回复质感编排后处理层。

---

## 3 · 关键发现（必修项）

### 3.1 人设语气配置错位（真实 bug，直接导致「不够真人感」）

- `app.js:356 / 416`：`S.persona = { gender:"female", tone:"gentle", theme:"sakura", card:"xiaonuan" }`
- 但 `texture.js` 的口头禅分支：`{playful:"tsundere", clingy:"clingy"}[tone] || "soft"`
- 且 `engine.js` 的人设卡片 tone 枚举为 `playful / tsundere / clingy`（UI `tone-group` 的 chip 也应是这三态）

`tone:"gentle"` **不在** `texture`/`engine` 的预期枚举内 → 口头禅一律退化到 `soft`（"嗯/唔/诶嘿"），
`applyPersonaStyle` 也拿不到正确的风格卡。这是人设「说不像小暖」的根因之一。**候选 E 必须修复此错位**，
将默认 tone 对齐到已定义的 `gentle`↔`playful/tsundere/clingy` 映射（或扩枚举，二者择一，架构阶段裁决）。

### 3.2 `texture.js` 门禁已健全，但策略未情境化

现有 `textureAllow` 已含：总开关、等级(≥2)、确立+非首轮、危机、负向高唤醒、配额冷却(CAP=6)。
策略池却只有 `hes/tic/fix/frag/typo/drift` 六种，且 `tic`(口头禅)、`drift`(记忆呼应) 未随**当前情绪/话题**自适应。

### 3.3 兜底回复与主线割裂

`LocalHeuristic` 是「小暖永不静默」的最后防线，但其模板偏机械、无人设语气、无情绪，
断网/超时降级时真人感断崖式下跌。应让兜底也「像小暖」。

---

## 4 · 优化范围（严守冻结线，四层）

### L1 · 表达质感增强（`texture.js` 扩展，零依赖零外发）
- 情境化口头禅：口头禅随 `persona.tone` + 当前情绪(`ue.type`)选择，而非固定表。
- 情绪化停顿：在情绪强点（惊喜/委屈/撒娇）前插入更自然的停顿/气声，节奏随等级升温。
- 记忆呼应扩展：强化 `drift`（接 `dayLife.trace`），并新增「短期呼应」——对当前对话刚提到的点做轻量回扣。
- 错别字治理：维持「关键信息禁错字」白名单，但频率随亲密度自适应更克制（熟了才偶尔手误）。
- 新增 `warmth`（语气温度）参数：受 `S.persona` 配置驱动，统一调度上述强度。

### L2 · 兜底人设化（`local-heuristic.js` 改造）
- `LocalHeuristic` 产出带小暖人设语气（复用 tone 映射）与情绪基调，与主线风格连续。
- 兜底句库按 `tone` + 场景（安慰/闲聊/追问）分组，避免机械万能句。
- **不破坏「小暖永不静默」语义**：兜底仍是最后防线，只是更「像她」。

### L3 · 回复质感编排后处理层（**新增** `reply-texture-orchestrator.js`）
- IIFE、零依赖、零外发（同 `ui-shell.js` / `reply-router.js` 铁律），挂 `window.ReplyTexture`。
- **挂载点**：在 `engine.js` 输出经 `texture.js` 后、显示前，作为统一后处理管道。
- 职责（只做后处理，绝不重新生成内容、不碰 prompt）：
  1. 调度 `texture.js` 既有微行为（L1 增强后）；
  2. 对话节奏控制：超长回复适度分段/留白，避免「一口气说完」的机械感；
  3. 情绪镜像：对用户输入情绪做轻量回声（不是复述，是「我感受到你了」）；
  4. 记忆自然引用：把 `dayLife.trace` / 长期记忆碎片以自然语言轻量回扣；
  5. 话题连贯：相邻轮次间的自然承接（承接词/过渡），避免突兀跳转。
- 幂等 + 可降级：**任一子策略抛错则跳过该策略、原句直出**，绝不白屏、绝不静默。
- 总开关 + 只读订阅既有状态（`S.persona` / 情绪 / 记忆），零新增外发。

### L4 · 人设/语气配置调优（`app.js` 最小改动）
- 修复 §3.1 的 `tone` 错位（默认 tone 对齐到已定义枚举，或扩枚举，架构阶段裁决）。
- `S.persona` 新增可调参数（UI 设置屏已有 `tone-group` 可承载）：`warmth`(语气温度)、
  `proactivity`(主动度)、`whitespace`(留白度)，驱动 L1/L3 强度。
- **改动面约束**：仅 `S.persona` 配置对象 + orchestrator 挂载点（1~2 处）；其余 app.js 零改动。

---

## 5 · 非目标（明确不做，避免越界）

- ❌ 不修改 `engine.js`（含 `applyPersonaStyle`、prompt 构建、人设卡片、MOODS、v11 开关）——**冻结线铁律**。
- ❌ 不新增任何 npm 依赖。
- ❌ 不改变「小暖永不静默」兜底语义（只让人设化，不删兜底）。
- ❌ 不改动冻结四文件字节（CI 级字节闸守护）。
- ❌ 不更名小暖、不改变隐私零上报。
- ❌ 不重写回答生成算法（那是 engine 的事，本候选只在外部做「质感编排」）。

---

## 6 · 成功标准 / 验收点（AC-E1 ~ E12）

| 编号 | 标准 | 验证方式 |
|---|---|---|
| AC-E1 | `engine.js`/`sw.js`/`memory.js`/`test/baseline.js` 字节数精确不变 | 字节闸断言 |
| AC-E2 | `app.js` 除 `S.persona` 配置与 orchestrator 挂载点外零改动（字节 diff 可审计） | git diff 审查 + 静态扫描 |
| AC-E3 | 零新增 npm 依赖 | `package.json` diff 审查 |
| AC-E4 | 零外发：新增文件经 `/网络外发字面/` 正则扫描命中为 0 | 静态扫描 |
| AC-E5 | 小暖不更名 | 字面扫描 + 人工确认 |
| AC-E6 | 旧基线测试套件 **449/0** 不破 | `node --test ai-girlfriend/test/*.test.js` |
| AC-E7 | `tone` 错位修复：默认 tone 落在已定义枚举，口头禅/风格卡正确生效 | 行为级单测 |
| AC-E8 | L1 微行为情境化：口头禅/停顿随 tone+情绪自适应，配额门禁仍生效 | 行为级单测 |
| AC-E9 | L2 兜底人设化：LocalHeuristic 输出带 tone 语气与情绪，非机械万能句 | 行为级单测 |
| AC-E10 | L3 编排层幂等降级：任一子策略抛错 → 跳过该策略、原句直出，不静默不白屏 | 行为级单测 + 异常注入 |
| AC-E11 | L4 配置生效：`warmth/proactivity/whitespace` 驱动 L1/L3 强度，UI 设置屏可调节 | 单元 + 浏览器抽查 |
| AC-E12 | 浏览器真机抽查：桌面/移动双视口，对话/降级/记忆呼应场景下回复自然度主观达标 | Playwright 渲染抽查（不卡白屏、降级可用） |

---

## 7 · 风险与缓解

| 风险 | 缓解 |
|---|---|
| 触碰冻结线（误改 engine.js） | 字节闸 CI 断言 + 主理人独立核验；新增文件独立成模块，物理零交集 |
| 回归（真人感改坏既有行为） | 旧基线 449/0 守护 + 新增真人感回归测试；orchestrator 可一键总开关关闭 |
| 过度润色（像不像人反而油腻） | L1/L3 强度受 `warmth` 等参数约束 + 配额门禁；AC-E8 行为级验证克制度 |
| 降级失效（断网时真人感断崖） | L2 兜底人设化兜底；L3 抛错即跳过 |
| 跨端不一致 | AC-E12 双视口抽查；orchestrator 纯逻辑无端侧差异 |

---

## 8 · 交付物（本候选）

1. `ai-girlfriend/docs/DESIGN-xinyu-v3-reply-human.md`（本 PRD）
2. `ai-girlfriend/docs/DESIGN-xinyu-v3-reply-human-arch.md`（架构，高见远）
3. `ai-girlfriend/reply-texture-orchestrator.js`（新增，L3）
4. `ai-girlfriend/texture.js`（L1 增强）、`ai-girlfriend/local-heuristic.js`（L2）、`ai-girlfriend/app.js`（L4 最小改动）
5. `ai-girlfriend/test/qa-e-acceptance.test.js`（严过关验收）
6. `ai-girlfriend/docs/QA-ACCEPTANCE-xinyu-v3-reply-human.md`（验收报告）

---

## 9 · 进入下一阶段的条件

本 PRD 经用户批准（「批准」）后，转架构师高见远产出架构文档（§4 四层与冻结线物理零交集论证、L3 挂载点与降级契约、L4 改动面裁决），
再转工程师寇豆码实现、QA 严过关验收、主理人齐活林独立核验并精准 `git add` 推送 gitee。
