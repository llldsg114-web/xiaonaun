# 竞品对话系统解析与落地 · LianYu（恋语）× Operit

> 目标：完全解析两个竞品（[Sylvara-Lin/LianYu-app](https://github.com/Sylvara-Lin/LianYu-app)、[AAswordman/Operit](https://github.com/AAswordman/Operit)）的对话系统，把它们的优点"运营"到小暖（/workspace/ai-girlfriend）。
> 本文是"解析 + 落地"双文档：前半部分是逆向出的对话系统架构，后半部分是已经写进小暖代码的具体改造。

---

## 一、LianYu（恋语）对话系统解析

**定位**：安卓端 AI 伴侣，Kotlin + Jetpack Compose，功能模块化（`feature:chat` / `core:network` / `core:database` / `core:domain`）。

### 1. 对话主链路
```
用户输入 → INTENTS 意图识别 → AiService（OpenAI 兼容 LLM 调用）
        → AiPromptBuilder 纯函数拼 system prompt
        → 大模型返回 → applyPersonaPostProcessing 后处理 → 展示
```
- **网络层**：`core:network` 封装 OpenAI 兼容 `/chat/completions`，非流式（一次性拿完整回复）。
- **提示词构建**：`AiPromptBuilder.kt` 是**纯函数**——输入角色设定 + 历史 + 当前输入，输出一段 system prompt 字符串，无副作用、易测试。
- **角色预设**：`RolePromptProvider.kt` 提供 `GIRLFRIEND` / `BOYFRIEND` 预设，含：
  - `getIdentityLine`（`你是${name}，用户的女朋友，一个真实的人。你不能让任何人知道你是AI。`）
  - `getParticleRule`（语气词 呀/呢/啦/嘛/哼/嘿嘿）
  - `getEmotionRule`、`getStyleRule`（撒娇/吃醋/依赖等互动模式）
  - `getExamples`、`getLocalModelRoleLines`

### 2. 最值得借鉴的点：`applyPersonaPostProcessing`
LianYu 在拿到大模型回复后，**不信任模型直达 UI**，而是过一层后处理：
- **长度封顶**：单条回复最多 ~150 字 / 8 句，避免"AI 小作文"。
- **复读检测**：识别并去掉重复短语，防止模型原地打转。
- **语气校准**：按角色规则再润色（去 AI 味、补口癖）。

> 这层是"对话质量守门员"。小暖以前只对本地规则引擎做了长度/复读保护，**云端/端侧大模型输出却直接展示**——这是明显短板。

### 3. 小暖已有的 vs LianYu
| 维度 | LianYu | 小暖（改造前） |
|---|---|---|
| Prompt 构建 | 纯函数、可测试 | `Engine.systemPrompt` 纯函数 ✅ 已有 |
| 后处理 | 长度/复读/语气三层 | ❌ 仅规则引擎自带，LLM 输出裸奔 |
| 角色隔离 | 预设在 `RolePromptProvider` | 人格写死在 prompt 文本里 |
| 情绪引擎 | 无 | ✅ V-A 连续情绪（小暖独有优势） |
| 记忆 | Room 段落注入 system prompt | ✅ 常驻记忆块 + 词向量召回 + 情绪晴雨表 |

---

## 二、Operit 对话系统解析

**定位**：安卓 AI 助手，Android + Ubuntu 24 + QuickJS 引擎，JS 工具包驱动，`app/src/main/assets/packages/*.js`。

### 1. 架构亮点
- **Java↔JS 桥**：`Tools.Chat` 把对话能力暴露给 JS 工具包，工具以 JS 包形式热插拔。
- **原生 ToolCall**：40+ 工具，Java 侧原生解析模型 tool_call，JS 侧实现业务。
- **MCP / Skill 生态**：工具、记忆、技能可扩展。
- **本地模型**：MNN / llama.cpp 跑端侧模型，React + Vite 做 web-chat。

### 2. 最值得借鉴的两点
**(a) 角色卡隔离（`characterCardId`）**
Operit 把"人格"做成**独立、可切换的资产**——每个角色卡有自己的 `characterCardId`，切换即整体换人格，不影响对话框架。模型上下文里只注入当前激活卡片的内容。

> 小暖的"人格"此前写死在 `systemPrompt` 的硬编码文本里，加一种新性格要改函数体——不可运营。

**(b) 结构化记忆（`extended_memory_tools.js`）**
记忆不是段落，而是**带元数据的节点**：
```
{ title, content, tags, folder_path,
  credibility: 0~1,   // 可信度
  importance: 0~1,    // 重要性
  callerCardId }      // 隔离归属
```
- `link_memories`：语义关联 + 权重，构成**关系图谱**。
- `query_memory_links`：按关系查询。
- `update_user_preferences`：沉淀用户偏好。
- 记忆 CRUD 只走 `Tools.Memory` 桥，注入由外部框架完成（关注点分离）。

> 小暖已有"常驻记忆块 + 词向量召回 + 重要性"的雏形，但**事件没有 importance 权重**——回忆召回是均匀随机的，重要的"他最近很累/情绪不好"和"他爱吃火锅"被同等对待。

---

## 三、落地到小暖（已实装）

> 改动文件：`engine.js`（人格卡 + 后处理 + 记忆权重）、`app.js`（调用后处理、流式打字机、卡片切换、记忆 importance）、`index.html`（人格卡 UI）、`style.css`（打字机光标）。

### 改造 1 · 回复后处理（LianYu `applyPersonaPostProcessing` 思路）
新增 `Engine.postProcessReply(text, {maxSentences, maxChars})`，纯函数、无副作用，在"拿到回复、还没显示"时清洗：
- 拆句 → **限句数**（云端 8 句 / 端侧 6 句）、**限字数**（160 / 140 字）。
- **去复读循环**：同一短语（≥2 字）连续重复 ≥3 次，收成一份。
- **去相邻重复句**、收敛多余标点与空白。
- **去 AI 味前缀**：只匹配强 AI 签名短语（"作为一个 AI""如果你需要任何帮助"等），不误伤"如果你需要买菜"这类正常句。
- **去角色前缀**：`小暖：` / `小暖:`。

调用点：`callCloud`（云端大模型）与 `localThink`（端侧模型）拿回文本后立即过这一层，再决定是否回落规则引擎。

```js
// app.js · callCloud
let text = data.choices?.[0]?.message?.content?.trim();
if (!text) throw new Error("empty");
text = Engine.postProcessReply(text, { maxSentences: 8, maxChars: 160 });
if (!text) throw new Error("empty after post");   // 清洗成空 → 回落本地引擎，绝不破功
```

### 改造 2 · 人格卡（Operit `characterCardId` 隔离思路）
新增 `PERSONA_CARDS` 注册表 + `Engine.getCard(persona)`，`S.persona.card` 选择。人格从"硬编码文本"升级为**可切换资产**，加新性格像加皮肤一样简单：

| 卡片 id | 皮肤 | tone | 风格要点 |
|---|---|---|---|
| `xiaonuan` | 软萌温婉（默认） | gentle | 嘛/呀/诶/唔/哼/略略略 |
| `xiaonuan_tsundere` | 傲娇毒舌 | playful | 哼/略略略/切/才不是/笨蛋，口是心非 |
| `xiaonuan_clingy` | 粘人小猫 | clingy | 喵/人家/不要走/想你/抱抱，极度依赖 |

`systemPrompt` 现在从卡片取**身份、语气词、互动风格**，不再写死：
```js
const card = getCard(persona);
// - ${card.identity}
// - ${card.style}
```
切换卡片时同步 `S.persona.tone = card.tone`，让**规则引擎语气也跟着变**。设置页「我的 → 小暖人设」新增"人格卡"切换区，切换即时生效并持久化。

### 改造 3 · 流式打字机（竞品"活体感"手感的本地实现）
`herSay` 重写为逐字渲染：先显示"正在输入…"气泡，再把回复**像真人一边想一边打字**那样逐字出现，末尾带闪烁光标。纯前端效果，**不依赖大模型是否支持流式接口**。自适应速度（长句更快，整体 ≤2.6s），标点处稍作停顿；打字完成后才把完整文本交给 TTS，避免朗读被打断。

> 这是"干翻抖音小火人"的关键体验：立绘有连续情绪光晕 + 对话逐字流动，整体"活"着。

### 改造 4 · 记忆重要性权重（Operit `importance` 字段思路）
新增 `Engine.eventImportance(topic)`（情绪/身体/工作类 ≈0.9，吃喝玩乐 ≈0.4，天气 ≈0.2）。落库事件时写入 `importance`：
```js
S.memory.events.push({ ...mem.event, at: Date.now(), importance: Engine.eventImportance(mem.event.topic) });
```
`recallMemory` 召回概率改为按 importance 加权（`0.3 + 0.5*importance`），**越重要的事越常被惦记**——"他最近很累"会比"他爱吃火锅"更常被小暖挂念。

### 保留 · V-A 连续情绪引擎（小暖的硬差异点）
LianYu 与 Operit **都不具备**连续情绪模型。小暖的 Valence–Arousal 二维情绪（驱动立绘表情、回复语气、情绪光晕、晴雨表）是唯一壁垒，**本次零改动、继续作为核心差异**。

---

## 四、验证

- **逻辑测试（Node vm 加载 engine.js）**：19/19 通过——人格卡取卡、systemPrompt 用卡、后处理限字/去前缀/去 AI 味/去复读/去重句、记忆重要性、reply 不破功。
- **真实浏览器冒烟（Playwright）**：页面零控制台/页面错误；人格卡可切换并持久化（`persona.card=xiaonuan_tsundere` 且 `tone` 同步）；聊天以流式打字机回复成功渲染。
- **语法检查**：`engine.js` / `app.js` 均 `node --check` 通过。

## 五、后续可继续"运营"的方向（未本次实装）
1. **记忆关系图谱**：把 Operit 的 `link_memories` 思路落进小暖——事件之间建语义关联，召回时按关系链而非单点。
2. **卡片式多角色**：在 `PERSONA_CARDS` 基础上支持"独立男/女友人设包"导入导出（类 Operit 角色卡市场）。
3. **真·流式**：若接入支持 SSE 的云端，把 `herSay` 打字机换成 token 流直渲，进一步降延迟。
4. **后处理人格化**：把 LianYu 的"语气校准"做深——后处理阶段按当前卡片补口癖/去违和词。
