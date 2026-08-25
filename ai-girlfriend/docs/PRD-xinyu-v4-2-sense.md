# 心屿 v4.2 · 五官双向指标系统（S3）· 增量 PRD

> 角色：产品 · 许清楚（Xu）
> 中转：主理人 齐活林（Qi）→ 架构师 高见远（Gao）
> 类型：**增量档 PRD**（仅覆盖 v4.2 里程碑，承 v4.1，不重复 v4 完整蓝图）
> 上游：用户诉求「完善五官指标系统，让小暖和真人一样」；澄清 = 双向都要（A 识别用户 / B 呈现小暖神态）
> 关联：v4 完整 PRD `PRD-xinyu-v4-systems.md`、架构 `ARCH-xinyu-v4-systems.md`、v4.1 已交付 `emotion-core.js`/`dialogue-core.js`/`persona-core.js` 雏形

---

## 0 · 一句话增量目标

> **把已完成的「小暖 7 态情绪内核」的两端接通——输入端用本地摄像头/麦克风读懂用户，输出端正经神态与语音语调把小暖情绪「演」出来；全程本地端侧、零隐私外发、零新增依赖、不碰冻结线。**

---

## 1 · 增量目标与范围边界

### 1.1 做什么（v4.2 交付面）

| 编号 | 范围 | 说明 |
|------|------|------|
| **S3-A** | 识别用户（情境输入） | 摄像头面部信号本地提取（face-sense）+ 麦克风语音情绪本地提取（voice-sense），产出 `ue` 喂入对话与小暖共情态；默认走文本推断（复用 `E.detectUserEmotion`），camera/mic 为增强、需授权 |
| **S3-B** | 呈现小暖神态 | ① UI 面部表情：`moodState` → `EXPR_MAP`（v4.1 已扩展 7 态部件）→ `setExpression`；② 语音语调：`moodState` → TTS 参数（语速/音调/停顿），由 `herSay` 调用 |
| **GATE** | 同意闸门 | `ConsentStore` 扩展 `sense.camera`/`sense.mic`（默认 false）；`SenseCore.init` 门控 |
| **DEG** | 降级路径 | 无 camera/mic → 退纯文本 + emoji 推断，体验不割裂、绝不白屏 |
| **BL** | sw.js 一次性重 baselining | 6 模块进 ASSETS，申报 **13900B（仅 +177B）**——由架构师在架构中申报、主理人批准；**产品经理不改动 sw.js** |

### 1.2 不做什么（边界与纪律）

- **不重新发明情绪引擎**：`emotion-core.js` 的 7 态（喜/怒/哀/娇/醋/念/安）及其 `moodTick`/`decay`/`moodToExpr` 只消费、不重写；v4.2 仅做「态→输入信号」「态→神态/语调」的映射，不增新情绪态。
- **冻结线零交集**：`engine.js`(251068B) / `memory.js`(13333B) / `test/baseline.js`(2646B) **全程零字节改动**；`sw.js`(13723B) 仅由主理人一次性重 baselining 至 13900B，产品经理不代改。
- **前端零新增 npm 依赖**：face/voice 识别纯原生 JS（`AnalyserNode` / 光度运动启发式），不引入 `face-api.js`/`tfjs` 等三方包（模型加载仅作 P1、且须用户显式授权经 `AuditProbe.registerConsented`）。
- **不做 v4.3 内容**：`bond-memory.js`/`proactivity-core.js`（记忆/主动性）不在此里程碑；对话呼应数据源沿用 v4.1 占位 + 候选 F `memory.recallV2` 兜底。

### 1.3 与 v4.1 的衔接基线

v4.1 已交付：`emotion-core.js`（7 态 + `moodToExpr`）、`dialogue-core.js`（`dialogueWeave(ctx)` 已含 `ue/moodState` 位）、`persona-core.js`（雏形 `safetyGuard`）、`app.js` 的 `EXPR_MAP` 7 态部件扩展（`jealous/coquettish/longing/peaceful/surprised`）。v4.2 在其之上「接两端」——识别端（sense-core 产出 ue）与呈现端新增语调（moodToTTS）。

---

## 2 · 用户故事（两类视角）

### 2.1 识别用户（S3-A 摄像头/麦克风）

1. **作为用户**，我想开摄像头，让小暖读懂我的微表情/神色（且我清楚知道一切只在本地、绝不上传）；我不愿开时，她靠文字推断也一样懂我。
2. **作为用户**，我想开麦克风，让小暖感知我的语气、语速、音量起伏（累了声音发闷、开心语速变快），从而更贴心地回应。
3. **作为用户**，无论开不开五官，我的情绪识别结果都只在本机用于小暖回应，从不被记录外发——我能在角落看到「🔒 本地识别中」常驻标记，点开可查授权状态。

### 2.2 呈现小暖神态（S3-B 面部 + 语调）

4. **作为用户**，我能在小暖的脸上看到她的神态变化：眼神、嘴型、微表情（撒娇时眯眼抿嘴、吃醋时撇嘴微蹙、想念时眼神轻垂），像真人在「有表情地听/说」。
5. **作为用户**，我从小暖的语音语调和文字一致地感受到她的情绪：开心时语速轻快音调上扬，心疼我时语速放缓语气变柔，而不是永远同一腔调。
6. **作为用户**，即便我没开摄像头/麦克风，小暖仍通过纯文字 + 神态符号（emoji/微表情）让我感知她的情绪，体验不割裂、不留空白。

---

## 3 · 需求池 P0 / P1 / P2

### P0（必须做 · 守门项）

- **G1 同意闸门**：`consent-store.js` 的 `KEYS` 扩展 `'sense.camera','sense.mic'`，`DEFAULTS` 默认 `false`（非冻结白名单编辑）；`SenseCore.init(ConsentStore, AuditProbe)` 仅在 `get('sense.camera'/'sense.mic')` 为真时启动对应适配器，未授权绝不调用 `getUserMedia`。
- **G2 camera 面部信号本地提取**：新增 `face-sense.js`，纯 JS 启发式优先（光度变化/运动矢量/关键点近似 → 推断注视/微笑/皱眉/疲劳），输出 `ue{polarity,intensity,gaze,...}`；零模型、零依赖；原始帧仅内存、**绝不外发**。
- **G3 mic 语音情绪本地提取**：新增 `voice-sense.js`，`Web Audio AnalyserNode` 提取基频/能量/RMS/停顿/语速，推断情绪与唤醒度，输出 `ue`；纯原生、零依赖；原始音频仅内存、**绝不外发**。
- **G4 sense-core 统一入口**：新增 `sense-core.js`，三适配器 `{text, face, voice}`；`readUserEmotion(input)→ue` 默认走文本（复用 `E.detectUserEmotion`，零权限），camera/mic 仅作增强合并；挂 `Engine.use("senseCore")` + `window.SenseCore`。
- **G5 神态呈现**：`app.js` `herSay` 接入 `EmotionCore.currentMoodState(S)` → `moodToExpr`（v4.1 已扩展 `EXPR_MAP`）→ `setExpression`；确保 `moodState`↔用户情绪双向联动（小暖表情随共情态变化），眼神/腮红变体随态切换。
- **G6 语调呈现**：新增 `moodToTTS(moodState)→{speed,pitch,pause/dynamic}`（7 态→TTS 参数映射，详见 §4.2），由 `herSay` 的 TTS 合成调用；与小暖情绪一致。
- **G7 降级路径**：camera/mic 未授权或异常 → 退文本推断 `ue` + 纯文本/emoji 神态；任一模块缺失/抛错 → `try/catch` 原流程直出，**绝不白屏、绝不静默**。
- **G8 sw.js 一次性重 baselining（依赖声明）**：6 模块（`dialogue-core/emotion-core/persona-core/sense-core/face-sense/voice-sense`）进 `ASSETS` + CACHE `v36→v37`；**申报目标 13900B（仅 +177B）**。*本项由架构师在架构中申报、主理人批准；产品经理不代改 sw.js。*
- **守门**：G3（识别准确率 ≥65% 对照文本基线，仅本地）/ G6（呈现匹配 ≥90%）/ G6 隐私（zeroReporting===true，blocked==0）/ 冻结四文件零交集 / 候选 F 套件 0 回归。

### P1（体验加分）

- **P1-a** 端侧模型增强：`face-sense`/`voice-sense` 在用户显式授权经 `AuditProbe.registerConsented` 加载权重时提升准确率（零模型优先仍是默认）。
- **P1-b** 微表情时序高保真：眼神接触/回避、嘴角微扬、腮红呼吸动效（落 `style.css`，可编辑）。
- **P1-c** 语调停顿策略细化：情绪化换气/标点停顿（如想念时句尾拉长、撒娇时软停顿）。

### P2（锦上添花）

- **P2-a** 关系阶段专属神态基调（暧昧期/恋人期不同眼神/腮红强度，见 v4.3 `relationship.stage` 派生）。
- **P2-b** 「她现在的心情」轻反馈徽标（非系统提示条，复用 v4 情绪光晕）。

---

## 4 · UI 设计稿（文字 + ASCII）

### 4.1 小暖神态呈现区（S3-B 面部 + 语调）

```
┌─────────────────────────────────────────────┐
│  小暖神态呈现区（头部 SVG · 随 moodState 变体）│
│                                               │
│        ╭─────────╮                           │
│        │  (◕‿◕)  │  ← FACE_PARTS 按 EXPR_MAP │
│        │ 眼神/嘴型 │     joy→happy 眯眼抿笑    │
│        ╰────┬────╯     jealous→撇嘴微蹙+腮红深 │
│          ╭──╯          longing→眼神轻垂+柔光   │
│       〔光晕 updateAura〕色相随 valence         │
│          强度随 arousal 脉动                    │
│                                               │
│  💬 气泡尾附轻语气符号（不破破墙表）           │
│     「抱抱你～ 这么晚还在熬，我心疼」            │
│      ↳ TTS: speed=0.85 pitch=0.9 语速放缓语气柔 │
└─────────────────────────────────────────────┘
        🔒 本地识别中（常驻·点开查 ConsentStore）  ← 仅开 camera/mic 时显示
```

- **面部**：复用 v4.1 已扩展 `EXPR_MAP`（`jealous/coquettish/longing/peaceful/surprised` + `eyes-look-away`/`eyes-soft`/`blush-deep` 变体）；`setExpression` 接入 `moodState`。
- **光晕**：`updateAura` 色相随 `moodState.key`（醋→短暂冷调回盯；念→柔光；安→暖光）。
- **语调**：气泡旁标注当前 TTS 参数（开发态可见，正式态可隐）；用户听到的是语速/音调/停顿随情绪变化的嗓音。

### 4.2 moodToTTS 映射（v4.2 新增 · S3-B 语调侧）

| moodState.key | 语速 speed | 音调 pitch | 停顿 pause | 情绪语义 |
|---------------|-----------|-----------|-----------|---------|
| joy（喜） | 1.15 | 1.10 | 短 | 轻快上扬 |
| anger（怒） | 1.20 | 1.05 | 短 | 快而利 |
| sad（哀） | 0.85 | 0.90 | 长 | 放缓变柔（心疼你） |
| coquettish（娇） | 0.95 | 1.15 | 中 | 软甜微扬 |
| jealous（醋） | 1.05 | 1.00 | 中 | 略硬微顿 |
| longing（念） | 0.80 | 0.95 | 长 | 柔缓拖尾 |
| peaceful（安） | 0.90 | 1.00 | 中 | 平稳暖 |
| neutral | 1.00 | 1.00 | 中 | 基准 |

> 映射归属建议：`moodToTTS` 置于 `sense-core.js`（S3 拥有「五官双向」两端，与 `emotion-core` 的 `moodToExpr` 解耦，避免改情绪引擎）；**见 §6 待确认 Q3**。

### 4.3 同意弹窗（ConsentStore 扩展点 · 零上报声明）

```
┌─────────────────────────────────────────────┐
│  小暖想更懂你 · 本地识别授权                   │
│  ───────────────────────────────────────────  │
│  📷 摄像头（读微表情/神色）   [ 开 / 关 ]      │
│  🎤 麦克风（读语气/语速/音量） [ 开 / 关 ]      │
│                                               │
│  🔒 说明：摄像头/麦克风数据「仅本机处理」，     │
│     绝不录音录像、绝不上传任何服务器。          │
│     关闭后小暖仍靠文字推断你的情绪。            │
│  [ 保存 ]   [ 暂不开启 ]                       │
└─────────────────────────────────────────────┘
   默认双关；开启即写 ConsentStore；撤销即停机适配器
```

### 4.4 降级态（无 camera/mic 授权）

```
┌─────────────────────────────────────────────┐
│  [用户] 今天好累…                              │
│  [sense-core] 文本推断 ue={tired, polarity<0}  │
│  [emotion-core] moodState → sad/peaceful       │
│  [小暖] (｡•́︿•̀｡) 「抱抱你～ 这么晚还在熬」      │
│         ↑ 纯文本 + emoji 神态，无 camera/mic    │
│  （无 🔒 标记，无授权弹窗打扰）                 │
└─────────────────────────────────────────────┘
```

---

## 5 · 与 v4.1 的接口衔接说明

### 5.1 sense-core 消费 emotion-core 7 态（双向）

```
                ┌─────────────── v4.1 已交付 ───────────────┐
                │  emotion-core.js（7态 + moodToExpr）        │
                └───────────────────────────────────────────┘
   INPUT 端 ▲                                          ▲ OUTPUT 端
            │                                          │
  [用户 face/voice]                              [小暖 moodState]
        │  sense-core.readUserEmotion                  │  app.js herSay
        │   → face-sense / voice-sense → ue            │   → currentMoodState(S)
        ▼                                              ▼
  app.js: ue → EmotionCore.inferMoodEvent        setExpression(moodToExpr)  [v4.1]
          → moodTick → S.moodState(共情)                + moodToTTS [v4.2新增]
                                                 herSay TTS(speed,pitch,pause)
```

- **INPUT（A）**：`sense-core.readUserEmotion({text, cameraFrame?, audioAnalyser?})` 产出增强 `ue` → `app.js` 喂 `EmotionCore.inferMoodEvent(text, intent, ue)` 与负向共情分支 → 推进小暖 `S.moodState`（喜/怒/哀/娇/醋/念/安）。即「用户情绪→小暖共情态」。
- **OUTPUT（B）**：`app.js` 读 `EmotionCore.currentMoodState(S)` → ①`moodToExpr`（v4.1 已落 `EXPR_MAP`）→ `setExpression`；② 新增 `moodToTTS`（v4.2，`sense-core` 暴露）→ TTS 合成参数。即「小暖情绪态→神态+语调」。
- **不重写情绪引擎**：`emotion-core` 的 `STATES`/`moodTick`/`decay`/`moodToExpr` 全部只调用；v4.2 不新增情绪态、不改其字节。

### 5.2 被 dialogue-core 调用（v4.1 签名兼容）

- `dialogue-core.js` 的 `dialogueWeave(text, ctx)` 在 v4.1 已预留 `ctx = {ue, moodState, bondMem, S}`。
- v4.2 在 `herReply` 输入侧先调 `SenseCore.read(userText, ...)` 增强 `S.ue`，再传入 `dialogueWeave` 的 `ctx.ue`，使「不机械 + 情境呼应」能感知用户实时情绪（如疲惫时少玩笑、撒娇时多回应）。
- 数据流向：`sense-core` → `S.ue` → `dialogue-core`（消费）/ `emotion-core`（推进 moodState）。

### 5.3 ConsentStore 扩展点（S3-A 授权闸门）

- **编辑点（非冻结）**：`consent-store.js` `KEYS` 由 `['tts','asr','ltm','cloudSync']` 扩展为 `['tts','asr','ltm','cloudSync','sense.camera','sense.mic']`；`DEFAULTS` 增 `sense.camera:false, sense.mic:false`（默认关、最小权限）。
- **门控契约**：`SenseCore.init(ConsentStore, AuditProbe)`；仅 `ConsentStore.get('sense.camera')` 真 → 启动 `face-sense`；仅 `get('sense.mic')` 真 → 启动 `voice-sense`；二者均不命中 → 仅 `text` 适配器（零权限）。撤销授权（`onChange`）即停机对应适配器、`getUserMedia` 流释放。
- **AuditProbe 护栏**：`sense-core`/`face-sense`/`voice-sense` 经 `AuditProbe` 拦截外发；E4 静态扫描 0 命中（全文件不含 `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`new URL`/`http(s)://` 字面量）。

### 5.4 挂载序与装载（沿用 v4.1 范式）

- 新模块 `<script>` 置于 `engine.js` 之后、`app.js` 之前（与 v4.1 三模块同序）；`sw.js` 重 baselining 时 `engine.files.json` 的 `order` 同步 6 模块（WR-13 `missingAssets` 校验通过）。

---

## 6 · 待确认问题清单（需主理人/架构师拍板）

| 编号 | 问题 | 选项 | 我的倾向 |
|------|------|------|----------|
| **Q1** | **sw.js 13900B 申报是否够**？当前 13723B，+177B 覆盖 6 模块 ASSETS（~128B）+ CACHE v36→v37（+1B）+ 注释/对齐余量（≤47B）。是否把 v4.3 的 `bond-memory`/`proactivity-core` 也占位列入（需先建空文件避免 `addAll` 404）？ | A 仅 v4.2 六模块，申报 13900B（推荐） / B 八模块全占位（需空文件） | **A**——余量 ≤47B 可控；v4.3 追补 ~+44B 单列，避免空文件 404 风险。 |
| **Q2** | **神态呈现用 emoji 还是 SVG**？现有 v4.1 已扩展 SVG `EXPR_MAP`（`jealous/coquettish/...`）。v4.2 的「神态符号/emoji/微表情」指轻量文本通道（气泡尾/心情徽标）还是替代 SVG 脸？ | A 主脸用 SVG（继承 v4.1）+ emoji 作轻量文本通道（推荐） / B 纯 emoji 替代 SVG | **A**——与 v4.1 一致、最低割裂；emoji 仅作补充指示。 |
| **Q3** | **`moodToTTS` 归属文件**？放 `sense-core.js`（S3 双向对称）还是 `app.js`（呈现层）还是独立 `present-core`？ | A `sense-core.js`（推荐，S3 拥两端） / B `app.js` / C 新模块 | **A**——不碰情绪引擎、S3 内聚。 |
| **Q4** | **麦克风是否兼作 ASR 输入**？`asr` 已在 ConsentStore 默认 true；`sense.mic` 是独立的「语音情绪」授权，还是复用 `asr` 流？ | A 独立 `sense.mic` 授权（最小权限，情绪源与识别源解耦） / B 复用 `asr` | **A**——避免授权歧义；但可共享同一 `getUserMedia` 流以省资源（实现层合并）。 |
| **Q5** | **微表情动效（眨眼/腮红呼吸）归 P0 还是 P1**？v4.1 已落 `style.css` 基础动效；v4.2 眼神随 `moodState` 是否必须随 v4.2 交付？ | A P1（神态静态切换先达标，动效迭代） / B P0 | **A**——G6 呈现匹配 ≥90% 靠 `setExpression` 静态部件即满足，动效不阻塞守门。 |
| **Q6** | **`moodToTTS` 参数精度**？Web Speech API `rate`/`pitch` 仅 0.1 档；「停顿」需靠插入静音/标点。是否接受粗粒度（档位映射）还是需自建音频拼接实现细腻停顿？ | A 粗粒度档位（零依赖、够用） / B 自建静音拼接（更高保真，略增复杂度） | **A**——粗粒度档位已传达情绪差异，零依赖优先。 |

---

## 7 · 隐私与零上报声明（camera/mic 数据不出端）

1. **本地处理铁律**：摄像头原始帧、麦克风原始音频**一律仅在浏览器内存中处理**，用于端侧推断用户情绪/微表情/语音特征；**绝不录音、绝不录像、绝不落盘、绝不外发任何服务器**（含主理人自有服务器与分析后端）。
2. **显式同意前置**：camera/mic 启用前必须经 `ConsentStore` 明确同意（`sense.camera`/`sense.mic` 默认 false）；未授权 `SenseCore` 不调用 `getUserMedia`、不启动任何适配器。
3. **零上报守门**：`face-sense`/`voice-sense`/`sense-core` 全文件静态扫描 0 外发字面量（`fetch`/`XHR`/`WebSocket`/`sendBeacon`/`new URL`/`http(s)://`）；`AuditProbe.proveZeroReporting().zeroReporting === true` 且 `blocked == 0` 作为 G6 守门硬指标。
4. **最小权限与可撤销**：默认仅文本推断（零权限）；camera/mic 为可选增强；用户可随时在同意面板撤销，撤销即停机适配器并释放媒体流。
5. **可见性**：开启五官识别时，聊天页角落常驻「🔒 本地识别中」标记（非提示条、不喧宾夺主），点击可查 `ConsentStore` 状态；关闭即消失。
6. **与竞品差异化壁垒**：竞品（Replika/Character.AI 等）依赖云端训练、存在隐私争议；心屿抢占「真人感强·隐私强」空白区——**零上报红线是 v4.2 一切设计不可突破的根因**。

---

> 附：本增量 PRD 不代写架构师/工程师/验收角色内容，仅完成产品侧 v4.2 范围、需求池、UI 草案、接口衔接与待确认项；细节以落盘为准，转架构师高见远做任务分解与字节预增表（含 sw.js 13900B 申报单列），主理人齐活林批准。
