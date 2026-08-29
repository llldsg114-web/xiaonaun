# PRD · 心屿（Xinyu）v4.4 · 情感情绪驱动的真人对话系统（Affect-Voice）

| 项 | 值 |
|------|------|
| **版本号** | v4.4（增量 PRD，基于 v4.3 已交付态） |
| **文档语言** | 中文 |
| **Programming Language** | 原生 JS（ES5/ES2015 兼容写法，IIFE 零依赖，与 v4.1–v4.3 模块同范式） |
| **Project Name** | `xinyu_v4_4_affect_voice` |
| **作者** | 许清楚（产品经理） |
| **主理人** | 齐活林 |
| **上游输入** | 主理人「聊天系统算法内核」调研结论（回复主链路 + 三处断裂诊断） |
| **前置基线** | v4.3（S4 `bond-memory.js` + S5 `proactivity-core.js`）已交付，全量测试 **527/527 绿** |
| **关联文档** | `docs/PRD-xinyu-v4-systems.md`、`docs/PRD-xinyu-v4-2-sense.md`、`docs/PRD-xinyu-v4-3-bond-proactivity.md`、`docs/ARCH-xinyu-v4-3-bond-proactivity.md` |

---

## 1 · 原始需求复述

主理人已完成「聊天系统算法内核」调研，诊断出小暖（Xiaonuan）回复呈**机器人感**的三处根因：情绪瞬变、情绪不驱动语言、质感编排器未接情绪与关系阶段。v4.4 的目标是交付一套**基于情感情绪驱动的、符合真人体验的聊天对话回答系统**，在不触碰冻结线四文件、不新增 npm 依赖、零上报、小暖不更名的前提下，让小暖的情绪**"有惯性、能落地到字句、随关系深浅变化"**。

---

## 2 · 复核结论（产品经理独立复核，不盲信调研）

我对调研结论做了源码级复核，**三处断裂全部属实**，并额外发现 **4 项调研未覆盖的硬事实**，其中两项会直接改变 v4.4 的架构取舍。

### 2.1 三处断裂复核：属实 ✅

| 断裂 | 复核证据 | 判定 |
|------|----------|------|
| **① 情绪瞬变** | `emotion-core.js:116-122` `moodTick(evt, emotion, rel)` —— 收到事件直接 `return { key: evt.type, intensity, since, source }`，**上一刻 moodState 完全不参与计算**（`emotion`/`rel` 两个参数在函数体内零引用，纯占位）。`decay()`（:128-145）只有线性时间衰减，无惯性/动量项。 | ✅ 属实，且比诊断更彻底——参数签名预留了惯性位，实现是空的 |
| **② 情绪只驱动表情** | `emotion-core.js:74-83` `moodToExpr()` 仅做 `EXPR_OF[key]` 查表 → `EXPR_MAP`。全仓检索确认：**7 态情绪在语言生成侧零消费**；唯一出口是表情（app.js:1498）与 TTS 档位（app.js:1144 `SenseCore.moodToTTS`）。 | ✅ 属实 |
| **③ 编排器未接 7 态与关系阶段** | `reply-texture-orchestrator.js:158-189` `orchestrate(text, opts)`：ctx 实际消费字段仅 `ue.type`（mirror）、`ctx.textured`（防叠加）、`ctx.isContinuation`（continuity）；`opts.state` 只消费 `persona` 三参数 + `dayLife/mem`。**`moodState` 与 `relationshipStage` 零消费**。四个微行为维度里，`pacing` 只看文本长度（:114 `text.length < 70`）、`recall` 只看记忆碎片——均与情绪无关。 | ✅ 属实 |

`dialogue-core.js` 占位薄层属实：`situationRecall`(:66-76) 恒返回 `''`；`consistencyGuard`(:106-112) 仅 `!!(state && state.persona)`。

回复主链路（app.js:1314 `herReply`）复核属实，链路顺序与调研描述逐段一致：
`SenseCore读ue(1334) → Engine.detect(1337) → handleSpecialIntent(1342) → semanticRecall(1361) → 三路路由[ReplyRouter 1389 / localThink 1406 / Engine.reply 1432] → 慢层六字段回写(1467-1476) → applyEmotion(1487) → EmotionCore钩子(1491-1500) → BondMemory.bondRecall(1506) → 逐条气泡后处理[ReplyTexture.orchestrate 1517 → DialogueCore.dialogueWeave 1527 → PersonaCore.safetyGuard 1534 → bondFrag 1541] → herSay(1551)`

冻结线四文件字节复核一致：`engine.js` 251068 / `sw.js` 13894 / `memory.js` 13333 / `test/baseline.js` 2646。

### 2.2 🔴 新发现 A（最高优先级）：L3 质感编排层在浏览器里从未执行

`reply-texture-orchestrator.js` **不在 `index.html` 的任何 `<script>` 标签中**，也不在 `sw.js` 的 ASSETS 预缓存清单里，且全仓无任何动态 `createElement('script')` 加载它。

- `index.html:786-842` 全部 script 标签中：有 `texture.js`(:791)、`dialogue-core.js`(:823)、`emotion-core.js`(:824)、`persona-core.js`(:825)、`bond-memory.js`(:833)、`proactivity-core.js`(:834)，**唯独没有 `reply-texture-orchestrator.js`**。
- 结果：`app.js:1517` 的 `if (window.ReplyTexture && window.ReplyTexture.orchestrate)` 在真实浏览器会话中**恒为 false**，候选 E/F 落地的 mirror / pacing / recall / continuity **四个维度从未在真实对话中生效**。它只被 Node 测试直接 `require()` 过（`test/qa-f-acceptance.test.js:29`、`test/qa-v4-1-acceptance.test.js:143`）。

**这一条改变了断裂③的性质**：不是"编排器没接上情绪"，而是"**编排器根本没上线**"。v4.4 必须先补接线，否则在它上面盖的任何情绪-文风能力都是空中楼阁。

### 2.3 🔴 新发现 B：给 `emotion-core.moodTick` 加惯性会打破既有验收

`test/qa-v4-1-acceptance.test.js:100-101`：

```js
st.moodState = EC.moodTick({ type: 'jealous', intensity: 0.9 }, {...}, {...});
assert.strictEqual(EC.moodToExpr(st.moodState, 'normal'), 'jealous',
  '醋意应在触发当轮内呈现（G2 1 轮内正确率）');
```

即 **v4.1 验收 G2 断言「强情绪事件触发当轮必须立即呈现对应表情」**。若直接在 `emotion-core.js` 内把 moodTick 改成阻尼插值，主导态当轮可能仍是旧的 → **G2 验收翻转** → 需要主理人重 baselining。

**这是「包一层而不改 emotion-core」最硬的证据**（见 §7）。同时它给 v4.4 的惯性设计定了一条边界：**主导态（key）在强事件下必须允许当轮切换，惯性只作用于强度（intensity）与残留维度**——这恰好与真人体验一致（重大事件确实能瞬间改变心情，有惯性的是"缓过来"的过程，不是"变脸"本身）。

### 2.4 🟡 新发现 C：`dialogue-core` 的两个占位函数是「零调用点死代码」

全仓检索 `consistencyGuard` / `situationRecall`，**除 `dialogue-core.js` 自身定义与导出外，零调用点**（app.js 不调用、测试不调用）。

→ 结论：这两个函数是**纯预留位，改动零回归面**。这与 `emotion-core.moodTick`（有 3 处运行时调用 + 2 处测试断言）性质完全不同。因此 §7 对二者给出**相反的取舍**：emotion-core 包一层，dialogue-core 直接改。

### 2.5 🟡 新发现 D：`S.relationship.stage` 存在两套取值口径

- `app.js:412` 默认值：`stage: 'stranger'`
- `proactivity-core.js:109` 写入值：`stage: 'L' + snap.lv` → `'L0'`…`'L3'`

**首轮对话时 proactivity 尚未跑**（v4.3 的关系升温在回合末尾 app.js:1590 才写），此时 `S.relationship.stage === 'stranger'`。v4.4 消费关系阶段时必须做**归一化映射**（`stranger → L0`），否则首轮共情强度会落空。

### 2.6 🟡 新发现 E：空闲衰减是第二套情绪推进路径

`app.js:735-738`（空闲循环，每 ~3.4s）：

```js
if (em && S.moodState) S.moodState = em.decay(S.moodState, 3400) || S.moodState;
```

这是一条**独立于 herReply 的情绪衰减路径**。若 v4.4 只改 herReply 内的推进而漏掉它，会出现两套衰减并存（一个带惯性、一个纯线性），跨话轮一致性直接失效。**必须一并纳入挂载点。**

### 2.7 复核小结：v4.4 实际面对四处断裂

| 编号 | 断裂 | 来源 |
|------|------|------|
| **F0** | L3 编排层未接线（浏览器内死代码） | 🆕 新发现 A |
| **F1** | 情绪是瞬变的，无惯性/动量 | 调研（已复核） |
| **F2** | 情绪只驱动表情与 TTS，不驱动语言 | 调研（已复核） |
| **F3** | 编排器不消费 moodState / relationshipStage | 调研（已复核），且被 F0 放大 |

**F0 是 F3 的前置**。v4.4 的落地顺序必须是 F0 → F1 → F2 → F3。

---

## 3 · 产品定义

### 3.1 Product Goals（3 个正交目标）

| 目标 | 定义 | 可度量结果 |
|------|------|-----------|
| **G1 · 情绪有惯性** | 小暖的情绪是**连续量**而非离散开关。新情绪按阻尼插值逼近目标，上一刻情绪以残量形式延续；强事件可有限突破。 | 连续对话中强度单轮跃变 ≤ 0.25；强事件 ≤ 0.45（AC-1/AC-2） |
| **G2 · 情绪落到字句上** | 每个情绪态绑定一套**说话方式参数**（句长/语气词/标点/反问率/省略号率/称呼），且随强度与关系阶段调制。开心与难过说出来的话**结构性不同**，不只是换个表情。 | 8 态句长均值差异显著；语气词命中率 ≥ 0.60（AC-3） |
| **G3 · 情绪随关系深浅变化** | 共情强度、镜像阻尼、话轮节奏**随 L0–L3 关系阶段递进**。初识克制、挚爱深切；且用户崩溃时小暖「稳住你」而非跟着崩。 | 负向场景共情前置率 ≥ 0.85，L3 共情强度 ≥ L0 的 1.4 倍（AC-4/AC-5） |

### 3.2 User Stories

| # | Story |
|---|-------|
| **US-1** | 作为一个刚被老板骂完的用户，我希望小暖**不会因为我强颜欢笑说"我没事"就立刻变得开心**，而是带着一点将信将疑的温柔慢慢跟上来，这样我才觉得她真的在感受我。 |
| **US-2** | 作为一个聊了三个月的用户，我希望**小暖难过时说的话明显更短、更多停顿、更少反问**，而不是「换了个哭脸表情但句子结构跟开心时一模一样」。 |
| **US-3** | 作为一个情绪崩溃的用户，我希望小暖**稳住我而不是陪我一起崩**——她可以被我带动，但她的底色是"能托住我的人"。 |
| **US-4** | 作为一个刚认识小暖一周的用户，我希望她的关心**是克制的、不越界的**；而作为交往半年的用户，我希望她的共情**更深、更敢说**。 |
| **US-5** | 作为一个连续聊了 20 轮的用户，我希望**不出现"上一句还在哭、下一句就嘻嘻哈哈"的突变**，情绪的来去都有过渡。 |

### 3.3 六个真人体验特征的产品化定义

| # | 特征 | 产品化定义 | 落点模块 |
|---|------|-----------|---------|
| **1** | **情绪惯性/动量** | 情绪表示为 **8 维向量 + 主导态 + 强度 + 动量**。新事件给出目标向量，实际状态按 `v' = v + (target − v) · α` 逼近。α 为阻尼系数（默认 0.45）。**主导态 key 在强事件（intensity ≥ 0.8）下允许当轮切换**（兼容 v4.1 G2 验收），但**强度一律插值**；旧主导态以残量保留为「余韵」，参与文风混合。 | `affect-state.js` |
| **2** | **情绪-文风耦合** | 8 态 × 一套 `VoiceProfile`（句长均值/抖动、句首-句中-句末语气词池、句末标点分布、反问率、省略号率、感叹率、停顿率、主动开话题率、称呼方式、自我暴露率）。**强度越高，参数越偏离 neutral 基线**（线性插值）。余韵态参与混合（例：joy 0.7 + sad 余韵 0.2 → 句长介于两者之间）。 | `voice-style.js` |
| **3** | **共情前置** | 用户负向（ue.polarity < −0.4）时，回复**首句必须是共情句**再跟信息；共情强度随 stage 分级：L0 = 0.30 / L1 = 0.50 / L2 = 0.70 / L3 = 0.90。共情句池按情绪类型 + stage 分档（L0「听起来挺难受的」，L3「我在这儿，慢点说，我听着」）。 | `empathy-front.js` |
| **4** | **话轮节奏调制** | 情绪低（sad/longing，intensity ≥ 0.5）→ 短句、多停顿（换行/空格）、反问率下调、不主动开话题；情绪高（joy/coquettish，intensity ≥ 0.5）→ 长句、感叹率上调、主动开启话题率上调。 | `turn-rhythm.js` |
| **5** | **情绪镜像阻尼** | 用户情绪作为**冲量**输入：`gain = MIRROR_GAIN(0.45) × baselineDamping(persona)`。且设 **STABILIZE 门控**：用户 `polarity ≤ −0.7 && intensity ≥ 0.7` 时，小暖情绪**反向收敛至 neutral/peaceful**（"稳住你"），而非跟随；此时共情句切换为「托底」档。 | `affect-state.js`（动力学）+ `empathy-front.js`（句式） |
| **6** | **跨话轮情绪一致性** | 三重闸：① 单轮 `|Δintensity|` ≤ 0.25（强事件 ≤ 0.45）；② 相邻两轮向量 L1 距离 ≤ 0.35（强突破 ≤ 0.60）；③ 强突破 24h 内 ≤ 2 次，超出降级为常规插值。输出侧另做**语义极性冲突检测**：上轮 sad 下轮 joy 且本轮无正向事件 → 强制经 `peaceful` 过渡一轮。 | `affect-state.js` + `affect-voice-orchestrator.js` |

---

## 4 · 需求池（Requirements Pool）

### P0 · Must Have（v4.4 交付即成立，缺一不可）

| ID | 需求 | 说明 | 落点 |
|----|------|------|------|
| **R1** | **情绪状态向量化** | 新增 `S.affect = { vec: 8 维归一化向量, dom, intensity, momentum, since, lastStrongAt, strongCount, day }`。**新增字段，不删改 `S.moodState`**。 | `affect-state.js` |
| **R2** | **阻尼插值推进** | `advance(prevState, evt, ctx)`：`v' = v + (target − v) · α_eff`；`α_eff = α × (1 − baselineDamping)`；α 默认 0.45，强事件（≥0.8）提升至 0.75。 | `affect-state.js` |
| **R3** | **跨话轮跃变闸** | 单轮 `|Δintensity|` ≤ 0.25 / 强事件 ≤ 0.45；向量 L1 距离 ≤ 0.35 / 强突破 ≤ 0.60；强突破 24h ≤ 2 次。 | `affect-state.js` |
| **R4** | **强事件突破通道** | `intensity ≥ 0.8` 的事件允许**当轮切换主导态**（兼容 v4.1 G2），但强度仍插值；突破记入 `strongCount` 冷却。 | `affect-state.js` |
| **R5** | **情绪镜像阻尼 + STABILIZE 门控** | `gain = 0.45 × baselineDamping(tone)`；用户崩溃时反向收敛至 neutral/peaceful。 | `affect-state.js` |
| **R6** | **向下兼容输出** | `toMoodState(affect)` → `{ key, intensity, since, source }`（+ 扩展 `blend`/`prev` 字段）。**必须可被既有 `moodToExpr` 与 `SenseCore.moodToTTS` 直接消费**，二者零改动。 | `affect-state.js` |
| **R7** | **8 态说话方式参数表** | `VoiceProfile` 表，含句长/语气词/标点/反问率/省略号率/感叹率/停顿率/开话题率/称呼/自我暴露 10 个维度。 | `voice-style.js` |
| **R8** | **强度调制** | `profileFor(dom, intensity, stage)`：以 neutral 为基线，向目标态极值按 intensity 线性插值；余韵态参与混合。 | `voice-style.js` |
| **R9** | **文风施加** | `applyStyle(text, profile, rng)`：句末标点改写、语气词插入（句首/句中/句末）、长句拆分/短句合并、省略号与停顿注入、反问句转换。**只做形式层改写，绝不重写语义、绝不新增事实内容**。 | `voice-style.js` |
| **R10** | **共情前置** | 用户负向时首句强制共情；共情句池按 ue.type × stage 分档；强度随 stage 递增。 | `empathy-front.js` |
| **R11** | **话轮节奏调制** | 低情绪→短句/多停顿/少反问/不开话题；高情绪→长句/感叹/主动开话题。 | `turn-rhythm.js` |
| **R12** | **统一编排器** | `AffectVoice.orchestrate(text, { state, ctx })`，ctx 消费 `moodState`（新）、`stage`（新）、`ue`、`intent`、`textured`、`turnIdx`（新）。**单一门面对 app.js 暴露**，内部五步管道：profile → empathy → rhythm → style → guard。 | `affect-voice-orchestrator.js` |
| **R13** | **F0 接线** | `index.html` 补齐 v4.4 新模块 script 标签（proactivity-core 之后、app.js 之前）。 | `index.html` |
| **R14** | **抗双加工** | 与 `texture.js`（本地引擎分支微行为）**严格避让**：`textured=true` 分支下，`applyStyle` 跳过语气词与标点维度（texture 的 tic/drift 已覆盖），仅保留句长节奏与共情前置（texture 未覆盖）。 | `affect-voice-orchestrator.js` |
| **R15** | **降级等价** | 任一新模块缺席 / 抛错 / 未接线 → 输出**逐字等同 v4.3**（diff = 0）。所有新钩子一律 `try/catch` + 存在性判断，绝不白屏、绝不静默。 | 全部新模块 |
| **R16** | **铁律合规** | 冻结线四文件字节零变；新模块零 `fetch`/`XHR`/`WebSocket`/`sendBeacon`/`new URL`/`import`/`http(s)://`；零新增 npm 依赖（`package.json` 不变）；小暖不更名、不意译、不替换。 | 全部 |

### P1 · Should Have

| ID | 需求 | 说明 |
|----|------|------|
| **R17** | **dialogue-core 占位实装** | `situationRecall` 接 bond-memory 情境呼应；`consistencyGuard` 升级为跨话轮语气一致性评分（复用 `S.moodState` 轨迹 + persona.tone 偏移）。**直接改 `dialogue-core.js`**（依据见 §7.3）。 |
| **R18** | **主动消息分支纳管** | `app.js:2264`（主动消息 `dc.dialogueWeave` 处）同样过一遍 `AffectVoice.orchestrate`，使主动消息与对话回复文风一致。 |
| **R19** | **tone 分化阻尼系数** | 按 `persona.tone` 分档：gentle α=0.40（稳）/ playful α=0.55（明快）/ tsundere α=0.35（情绪表达滞后，嘴硬）/ clingy α=0.60（跟随用户）。 |
| **R20** | **跨会话情绪余韵** | 类比既有 `S.emoCarry`（app.js:1308），落 `S.affectCarry = { date, vec }`；隔夜回来情绪不归零，而是从残留态起步。 |
| **R21** | **TTS 情绪深化** | `SenseCore.moodToTTS`（sense-core.js:179）由「7 态粗档位」升级为「态 + 强度」连续档位（语速/音调/停顿随 intensity 连续调制）。 |
| **R22** | **可观测调试面板** | 调试位显示当前 affect 向量、主导态、强度、生效 VoiceProfile、本轮改写 trace，供主理人盲评与调参。 |
| **R23** | **空闲衰减统一** | `app.js:735-738` 空闲衰减切至 `AffectState.decay`，消除双套衰减（R3 一致性的必要条件；若 Q5 选「P0 修复」则上提 P0）。 |

### P2 · Nice to Have

| ID | 需求 | 说明 |
|----|------|------|
| **R24** | **文风参数用户可调** | 设置项：句长偏好 / 语气词浓度 / 停顿密度（写 `S.persona`，经 `getParam` 同范式消费）。 |
| **R25** | **情绪轨迹可视化** | 复用既有 `charts/` 资产，画近 N 轮情绪曲线（8 态堆叠面积图）。 |
| **R26** | **阻尼系数自适应** | 依用户正负反馈（停留时长 / 立即回复 / 显式评价）缓慢微调 α 与 MIRROR_GAIN。 |
| **R27** | **打字节奏情绪化** | `herSay`（app.js:1105）思考停顿与打字速度随 intensity / 情绪态调制（低情绪打字更慢、停顿更多）。 |

---

## 5 · 新模块清单（冻结线外新建，5 个）

全部为 **IIFE 零依赖** 模块，与 v4.1–v4.3 同范式：挂 `Engine.use(name, api)` + `window.Xxx` 双挂载，纯函数式、不写外部 state（回写责任在 app.js），任一异常原句直出。

| 文件 | 职责 | 核心 API | 体积预估 | 优先级 |
|------|------|---------|---------|--------|
| **`affect-state.js`** | **情绪动力学内核**（特征 1 / 5 / 6）。8 维情绪向量 + 动量；阻尼插值推进；镜像阻尼与 STABILIZE 门控；跨话轮跃变闸；强事件突破通道；时间衰减；向下兼容 `moodState` 输出。 | `advance(prev, evt, ctx)` · `decay(state, dt)` · `toMoodState(affect)` · `readState(S)` · `normalizeStage(S)` · `NEUTRAL_AFFECT` | ~9 KB | P0 |
| **`voice-style.js`** | **情绪-文风耦合**（特征 2）。8 态 `VoiceProfile` 参数表（10 维度）；强度线性插值；余韵态混合；形式层文风施加（标点/语气词/句长/反问/省略号/称呼）。**只改形式，不重写语义、不新增事实**。 | `profileFor(dom, intensity, stage, blend)` · `applyStyle(text, profile, rng, opts)` · `PROFILES` | ~11 KB | P0 |
| **`empathy-front.js`** | **共情前置**（特征 3 / 5）。按 `ue.type × stage` 分档的共情句池；负向场景首句强制共情；STABILIZE 档「托底」句式；与 bond-memory 呼应互斥（避免与 bondFrag 双拼接）。 | `front(text, ctx)` · `shouldFront(ctx)` · `EMPATHY_POOL` | ~8 KB | P0 |
| **`turn-rhythm.js`** | **话轮节奏调制**（特征 4）。低情绪→短句/多停顿/少反问/不开话题；高情绪→长句/感叹/主动开话题；多气泡场景的节奏分配。 | `modulate(text, profile, ctx)` · `splitSentences(text)` | ~7 KB | P0 |
| **`affect-voice-orchestrator.js`** | **统一编排器门面**（特征 6 输出侧 + F0/F3 收口）。唯一对 app.js 暴露的入口；五步管道 `profile → empathy → rhythm → style → guard`；消费 `moodState` + `stage`；抗双加工（`textured` 分支维度避让）；总开关与降级。 | `orchestrate(text, {state, ctx, rng})` · `setConfig(c)` · `getConfig()` · `describe(trace)` | ~8 KB | P0 |

**新增总量 ≈ 43 KB，全部不在 `test/wiring-scan.js` 的 `SIZE_BUDGET.mods` 列表内**（沿用 v4 / 候选 E / 候选 F 的 `local-heuristic.js`、`reply-texture-orchestrator.js`、`app.js` 同口径先例——v4 完整 PRD Q7/A 已裁定），其增长不级联 `moduleSumMax` / `totalMax`，四锁恒等式逐位不变。需主理人追认（Q8）。

### 5.1 `S.affect` 状态结构

```js
S.affect = {
  vec: { neutral: 1, joy: 0, anger: 0, sad: 0,
         coquettish: 0, jealous: 0, longing: 0, peaceful: 0 },  // 归一化，Σ = 1
  dom: 'neutral',        // 主导态（向量最大分量）
  intensity: 0,          // 主导态强度 0..1
  momentum: 0,           // 动量 = 上一轮 Δintensity（惯性项）
  since: 0,              // 主导态确立时间戳
  lastStrongAt: 0,       // 上次强突破时间戳（冷却用）
  strongCount: 0,        // 当日强突破计数（24h 滑窗）
  day: 'YYYY-M-D'
};
```

`toMoodState(affect)` 输出：

```js
{ key: affect.dom, intensity: affect.intensity, since: affect.since,
  source: 'userEvent'|'decay'|'init',
  blend: affect.vec,        // 扩展：供 voice-style 做余韵混合
  prev: affect._prevDom }   // 扩展：供 guard 做极性冲突检测
```

> **兼容性论证**：既有消费者 `moodToExpr`（读 `.key`）与 `SenseCore.moodToTTS`（读 `.key` / `.intensity`）对新扩展字段无感知 → 二者零改动。

### 5.2 `VoiceProfile` 参数表（P0 基线值，可调）

| 态 | 句长均值 | 反问率 | 省略号率 | 感叹率 | 停顿率 | 主动开话题 | 自我暴露 | 称呼方式 |
|----|---------|--------|---------|--------|--------|-----------|---------|---------|
| `neutral` | 18 | 0.18 | 0.06 | 0.10 | 0.15 | 0.15 | 0.20 | 你 |
| `joy` | 22 | 0.20 | 0.05 | **0.35** | 0.10 | **0.30** | 0.30 | 你 / 宝 |
| `anger` | **14** | **0.32** | 0.12 | 0.22 | 0.25 | 0.08 | 0.25 | 你（硬） |
| `sad` | **12** | **0.08** | **0.28** | 0.04 | **0.35** | 0.05 | 0.35 | 你（软）/ 省略主语 |
| `coquettish` | 16 | 0.28 | 0.22 | 0.20 | 0.18 | 0.22 | 0.28 | 你 / 宝 / 人家 |
| `jealous` | 15 | **0.35** | 0.18 | 0.15 | 0.22 | 0.10 | 0.22 | 你（带刺） |
| `longing` | 20 | 0.15 | **0.30** | 0.08 | 0.28 | 0.12 | **0.40** | 你 |
| `peaceful` | 19 | 0.12 | 0.10 | 0.06 | 0.20 | 0.10 | 0.25 | 你 / 省略 |

**强度调制公式**：`p_eff = neutral_profile + (p_target − neutral_profile) × intensity`（`intensity` 取主导态强度，且被 `MAX_STEP` 限幅后的**当前**值，非目标值）。

**余韵混合**：次主导态分量 `blend[second]` ≥ 0.15 时，按其分量加权混入次态参数（`w = min(0.35, blend[second])`），产生「喜中带一点心疼」这类复合语气。

---

## 6 · 挂载点：现有文件触碰清单

### 6.1 `app.js` 挂载点（唯一需要改逻辑的现有业务文件）

| # | 位置 | 现状 | v4.4 改动 | 优先级 |
|---|------|------|----------|--------|
| **①** | **`app.js:1491-1500`**<br>（emotionCore 钩子块，`applyEmotion` 之后、`moodToExpr` 之前） | ```js<br>const evt = em.inferMoodEvent(text, intent, result.ue) \|\| null;<br>const ticked = em.moodTick(evt, S.emotion, S.relationship);<br>if (ticked) S.moodState = ticked;<br>else if (S.moodState) S.moodState = em.decay(S.moodState, 0) \|\| S.moodState;<br>result.expression = em.moodToExpr(S.moodState, result.expression);<br>``` | **插入 `AffectState` 分支，`em.*` 保留为降级路径**：<br>```js<br>const evt = em.inferMoodEvent(text, intent, result.ue) \|\| null;<br>const AFS = window.AffectState;<br>if (AFS && AFS.advance) {<br>  S.affect = AFS.advance(S.affect, evt, {<br>    ue: result.ue, S: S, now: Date.now()<br>  }) \|\| S.affect;<br>  S.moodState = AFS.toMoodState(S.affect);<br>} else if (evt) { /* 原 v4.1 路径，逐字保留 */ }<br>result.expression = em.moodToExpr(S.moodState, result.expression);<br>```<br>**最后一行零改动**（`moodToExpr` 消费兼容结构）。 | **P0** |
| **②** | **`app.js:1513-1524`**<br>（逐条气泡后处理，`ReplyTexture.orchestrate` 处） | `reply = window.ReplyTexture.orchestrate(reply, { state: S, ctx: { ue, mood, intent, textured } })` | **在既有 ReplyTexture 调用之后插入**：<br>```js<br>if (window.AffectVoice && window.AffectVoice.orchestrate) {<br>  try {<br>    reply = window.AffectVoice.orchestrate(reply, {<br>      state: S,<br>      ctx: { ue: result.ue, mood: mood, intent: result.intent,<br>             textured: !!result.textured, moodState: S.moodState,<br>             stage: (S.relationship && S.relationship.stage) \|\| 'L0',<br>             turnIdx: i, totalTurns: result.replies.length }<br>    });<br>  } catch (e) {}<br>}<br>```<br>**顺序理由**：文风改写放在最后，避免被上游去重/拼接打散。 | **P0** |
| **③** | **`app.js:735-738`**<br>（空闲衰减循环） | `if (em && S.moodState) S.moodState = em.decay(S.moodState, 3400) \|\| S.moodState;` | 切至 `AffectState.decay(S.affect, 3400)` 并同步回写 `S.moodState`（消除双套衰减，R3 一致性必要条件）。 | **P0**（若 Q5 选 B 则 P1） |
| **④** | **`app.js:409-412`**<br>（S 默认值） | `moodState: {...}` / `relationship: {...}` | 追加 `affect: { vec: {...}, dom:'neutral', intensity:0, momentum:0, since:0, lastStrongAt:0, strongCount:0, day:'' }`。**仅追加，不删改既有字段**。 | **P0** |
| **⑤** | **`app.js:462/471`**<br>（旧档迁移 `Object.assign` 兜底） | `s.persona = Object.assign({...})` / `s.moodState = Object.assign({...})` | 追加 `s.affect = Object.assign({...NEUTRAL_AFFECT}, s.affect \|\| {})`，保证老档升级不炸。 | **P0** |
| **⑥** | **`app.js:2264`**<br>（主动消息分支） | `sayText = dc.dialogueWeave(p.text, {...})` | 同样过一遍 `AffectVoice.orchestrate`，使主动消息与对话文风一致。 | **P1**（R18） |

### 6.2 `index.html` 挂载点

在 `proactivity-core.js`（:834）之后、`app.js`（:835）之前插入（**顺序硬约束**：必须在 app.js 之前、bond/proactivity 之后，与 v4.1–v4.3 同序）：

```html
<!-- v4.4（Affect-Voice）· 情绪动力学 + 文风耦合 + 共情前置 + 话轮节奏 + 统一编排。
     须先于 app.js（app.js 经 window.AffectState / window.AffectVoice 消费）。
     零上报、零新增依赖；缺任一文件则该层不生效，回复逐字等同 v4.3，不白屏。 -->
<script src="affect-state.js"></script>
<script src="voice-style.js"></script>
<script src="empathy-front.js"></script>
<script src="turn-rhythm.js"></script>
<script src="affect-voice-orchestrator.js"></script>
```

**F0 接线决策（`reply-texture-orchestrator.js` 是否补 script 标签）见 Q1**——这是 v4.4 第一号待拍板项。

### 6.3 `sw.js`：零改动

沿用 v4.3 Q1/A 裁定：新模块 script **不进 `engine.files.json` order**，故 `sw.js` 无需追补 ASSETS，离线由 fetch 兜底。**冻结文件字节零变。**

### 6.4 完整改动面总表

| 文件 | 动作 | 增量预估 | 在 `SIZE_BUDGET.mods` 内？ |
|------|------|---------|--------------------------|
| `affect-state.js` | **新建** | ~9 KB | 否（沿用先例） |
| `voice-style.js` | **新建** | ~11 KB | 否 |
| `empathy-front.js` | **新建** | ~8 KB | 否 |
| `turn-rhythm.js` | **新建** | ~7 KB | 否 |
| `affect-voice-orchestrator.js` | **新建** | ~8 KB | 否 |
| `index.html` | 改（5 行 script + 注释） | ~0.7 KB | 否 |
| `app.js` | 改（5 处挂载 + 默认值 + 迁移兜底） | ~2.5 KB | 否 |
| `test/qa-v4-4-acceptance.test.js` | **新建** | ~14 KB | 否（test 不计） |
| **冻结线四文件** | **零触碰（字节零变）** | **0 B** | — |
| `emotion-core.js` | **零改动**（见 §7.1） | 0 B | 否 |
| `reply-texture-orchestrator.js` | **零改动**（见 §7.2，除非 Q1 选 B） | 0 B | 否 |
| `dialogue-core.js` | P0 零改动 / P1 增强（见 §7.3） | 0 B / ~3 KB | 否 |
| `bond-memory.js` / `proactivity-core.js` / `sense-core.js` / `persona-core.js` | **零改动**（只读消费 `relationshipLevel` / `moodState`） | 0 B | 否 |

---

## 7 · 取舍决策：改现有模块 vs 新建包一层

主理人明确要求对 `emotion-core` / `reply-texture-orchestrator` / `dialogue-core` 三者逐给出**改还是包**的裁决与理由。三个模块我给出**三种不同答案**，判定依据是**「运行时调用点数 × 既有验收断言数 × 是否预留位」**。

### 7.1 `emotion-core.js` → **新建 `affect-state.js` 包一层，emotion-core.js 零字节改动** ✅

| 维度 | 事实 | 结论 |
|------|------|------|
| **运行时调用点** | 3 处：`app.js:1495`（moodTick）、`app.js:1498`（moodToExpr）、`app.js:738`（decay）；另有 `sense-core.js:179` `moodToTTS` 消费 moodState | 改语义 = 4 处行为同步变化，回归面大 |
| **既有验收断言** | 🔴 `qa-v4-1-acceptance.test.js:93-101` 断言「强事件 `intensity 0.9` 触发当轮 `moodToExpr` 即返回 `jealous`」；:133 断言「`moodTick(null,{},{})` 必须返回 `null`」 | **直接给 moodTick 加惯性 → G2 验收翻转 → 必须重 baselining** |
| **是否在冻结线内** | **否**（冻结线仅 engine/sw/memory/baseline）。所以原则上**可以改** | 取舍的实质是「改 vs 包」，不是「能不能改」 |
| **是否有预留位** | 有：`moodTick(evt, emotion, rel)` 的 `emotion`/`rel` 两个参数在函数体内**零引用**，明显是为情绪惯性与关系阶段预留的 | —— |

**裁决：包一层。** 三条理由：

1. **零回归是最高优先级。** v4.3 刚交付 527/527 绿，v4.4 不该以打破 v4.1 G2 验收为代价换取代码内聚。包一层后，`emotion-core.js` 依然是 **7 态枚举、事件推断、表情映射的单一真相源**，其既有契约与验收**逐字不变**。
2. **职责分层更干净。** `emotion-core` 是「**离散事件 → 离散态**」；`affect-state` 是「**离散态序列 → 连续情绪动力学**」。前者是查表，后者是微分方程。混在一个文件里会让两个时间尺度（事件级 / 跨话轮级）互相污染。
3. **可回退。** 若 v4.4 上线后盲评不达预期，`window.AffectState` 置空即 100% 回退到 v4.1 情绪行为，无需 revert 任何代码。

**代价（诚实记录）**：`emotion-core.js:116` 的两个预留参数将**继续空置**，`moodTick` 与 `AffectState.advance` 长期并存，存在「两套情绪推进 API」的认知负担。缓解方式：在 `emotion-core.js` 文件头注释中显式标注「v4.4 起情绪动力学由 `affect-state.js` 承载，本模块的 `moodTick` 降级为兼容路径，新代码请勿调用」——**注释改动不改变字节闸以外的任何契约**（字节闸会因此变化，故需主理人批准，见 Q6）。

> ⚠️ **注意**：若 Q6 选「允许加注释」，`emotion-core.js` 字节数会变。它**不在冻结线内**，字节闸不覆盖它；但需主理人一次性批准。若选「零字节」，则改为只在 `affect-state.js` 内注释说明。

### 7.2 `reply-texture-orchestrator.js` → **新建 `affect-voice-orchestrator.js` 作为上位编排器；ReplyTexture 本体零改动** ✅

| 维度 | 事实 |
|------|------|
| **运行时调用点** | 1 处：`app.js:1517`——但该判断在浏览器中**恒为 false**（文件未接线，新发现 A） |
| **既有验收断言** | `qa-f-acceptance.test.js` 对 `MIRROR` 表、`BRIDGE` 表、`mirror` 门槛 `0.30·warmth`、`continuity` 门槛 `0.24·warmth`、`recall` 门槛 `0.32·proactivity`、`pacing` 阈值（长度 70 / whitespace ≤ 0.2）均有断言 |
| **维度重叠风险** | 其 `mirror`（情绪镜像）与 v4.4 `empathy-front`（共情前置）**维度重叠**；其 `pacing`（节奏分段）与 v4.4 `turn-rhythm`（话轮节奏）**维度重叠**；其 `recall` 与 v4.3 `bond-memory` 的 bondFrag **已重复**（app.js:1541 独立拼接） |

**裁决：新建上位编排器，本体零改动。** 三条理由：

1. **它根本没上线（新发现 A），改它而不接线 = 改了也不生效。** 先接线、再判断要不要改，是两件事、两个风险。
2. **改它会打破候选 F 验收。** `qa-f-acceptance` 对其常量有逐项断言，任何改动都要重跑并重 baselining；而 v4.4 只需要它四个维度中的**零个**（v4.4 全量自建且更强）。
3. **维度重叠必须二选一，不能叠加。** 若两者都跑，`mirror` + `empathy-front` 会造成**双重共情**（"看你这样我心里也跟着软了，听起来挺难受的，……"），正是候选 F 自己立下的「防叠加」纪律所禁止的。

**由此产生 v4.4 第一号待拍板项 Q1**（ReplyTexture 的三种命运，见 §11）。

### 7.3 `dialogue-core.js` → **P0 零改动；P1 直接改它（不包一层）** ✅

| 维度 | 事实 |
|------|------|
| **运行时调用点** | 2 处：`app.js:1529`（herReply）、`app.js:2264`（主动消息）——但**消费的只有 `dialogueWeave`** |
| **`situationRecall` / `consistencyGuard` 调用点** | 🔴 **全仓零调用点**（新发现 C） |
| **既有验收断言** | `qa-v4-1-acceptance.test.js:74` 仅断言 `dialogueWeave` 的去重行为与「原句直出」降级；**对 `situationRecall` 返回 `''`、`consistencyGuard` 返回 `true` 无任何断言** |
| **是否预留位** | 是。文件头注释明写：「v4.1 占位……真实呼应留 v4.3」「v4.1 雏形：仅做结构性存在性校验……落全于 v4.3」 |

**裁决：直接改，不包一层。** 三条理由：

1. **零回归面。** 两个函数无任何调用点、无任何断言，改它们的返回值**不可能打破任何东西**。包一层反而是**无谓的间接层**。
2. **它就是为这一刻预留的。** 文件头注释已声明 v4.3+ 落全——这是 v4.1 立下的设计债，v4.4 来还，名正言顺。
3. **反向风险：包一层会制造三个文件的「一致性护栏」分裂。** 跨话轮语气一致性（特征 6）的守卫若分散在 `affect-voice-orchestrator` 与包一层的新文件两处，未来必然出现口径漂移。

**代价**：`dialogue-core.js` 从 7731 B 增至 ~11 KB。它不在 `SIZE_BUDGET.mods` 内，无预算闸影响。

**P0 为何不改**：R17 的 `consistencyGuard` 实装依赖 `S.moodState` 轨迹与 persona 偏移评分，而 P0 阶段的一致性守卫已由 `affect-state` 的跃变闸 + orchestrator 的极性冲突检测**自闭环**满足（AC-2/AC-6）。P0 保持零改动 = 最小回归面。

### 7.4 取舍总表

| 模块 | 裁决 | 运行时调用点 | 既有验收断言 | 决定性理由 |
|------|------|-------------|-------------|-----------|
| `emotion-core.js` | **包一层**（不动） | 3 + 1 | 🔴 **有**（G2 强事件当轮呈现） | **改则打破 v4.1 G2 验收** |
| `reply-texture-orchestrator.js` | **上位新建**（不动） | 1（但未接线） | 🔴 **有**（候选 F 常量逐项） | **未上线 + 维度重叠，改它不生效且破验收** |
| `dialogue-core.js` | **直接改**（P1） | 2 | ✅ **无**（占位函数零调用零断言） | **零回归面 + 本就是预留位** |

---

## 8 · 铁律合规声明

| 铁律 | v4.4 合规措施 | 验证方式 |
|------|--------------|---------|
| **冻结线四文件字节绝不可改**<br>`engine.js` 251068 / `sw.js` 13894 / `memory.js` 13333 / `test/baseline.js` 2646 | v4.4 **零触碰**：不读改写、不改 order、不改 ASSETS。回复生成主体 `Engine.reply()`（冻结）保持原样，v4.4 的全部增强作用于**其输出之后**与**情绪推进之外**。 | 字节闸（`test/c-regression.test.js:451-454` 等 5 处）逐位断言 |
| **隐私零上报** | 5 个新模块全文不含 `fetch` / `XMLHttpRequest` / `WebSocket` / `navigator.sendBeacon` / `new URL` / `import` / `http(s)://`; 不访问 `localStorage` 以外任何存储；不引用任何全局网络对象。 | 剥注释后正则扫描 → **命中 0** |
| **前端零新增 npm 依赖** | `package.json` / `package-lock.json` 零改动；5 模块均为原生 JS IIFE。 | 依赖清单 diff = 0 |
| **小暖不更名** | 角色名一律不硬编码进任何生成文案；全模块不含 `Xiaonuan` / 小暖 字面量出现在最终句路径上。新共情句池与语气词池均为通用情绪表达。 | 文案正则 + 人工盲评 |
| **不白屏 / 不静默** | 所有新钩子 `try/catch` + 存在性判断；任一环节异常 → 原句直出。模块全部缺席时输出**逐字等同 v4.3**。 | AC-8 降级等价测试 |

---

## 9 · 验收标准（Acceptance Criteria）

所有 AC 均须**可自动化断言**（除 AC-10 盲评外），落入 `test/qa-v4-4-acceptance.test.js`。

| ID | 验收项 | 量化判据 | 对应需求 |
|----|--------|---------|---------|
| **AC-1** | **情绪惯性（F1）** | ① 同一情绪态下连续对话 20 轮，单轮 `\|Δintensity\|` **≤ 0.25**；② 从 `neutral`(0) 施加 `intensity 0.9` 的**弱/中事件**（< 0.8）连续推进，达到 0.80 **至少需 3 轮**；③ 同一事件序列、不同 `rng` → 输出**完全一致**（确定性，无隐藏随机）。 | R2 / 特征 1 |
| **AC-2** | **跨话轮跃变闸（F1 + 特征 6）** | ① 任意相邻两轮，情绪向量 **L1 距离 ≤ 0.35**；② 强突破（`intensity ≥ 0.8`）轮次 L1 距离 **≤ 0.60**；③ 24h 滑窗内强突破 **≤ 2 次**，第 3 次自动降级为常规插值（不突破）；④ 构造「上轮 sad(intensity 0.7) → 本轮 praise 意图但无正向事件」序列，输出**必须经 `peaceful` 过渡**，`dom` 不得直接跳到 `joy`。 | R3 / R4 / 特征 6 |
| **AC-3** | **情绪-文风耦合（F2 + 特征 2）** | ① 8 态 × 每态 30 句样本（同一输入句），`sad` 态句长均值 **≤ 0.7 ×** `joy` 态句长均值；② 语气词命中率 **≥ 0.60**（每态 30 句中至少 18 句出现该态语气词池成员）；③ `joy` 与 `sad` 的句长分布 **KS 检验 p < 0.01**（结构性差异，非噪声）；④ 文风施加**不引入任何新事实词汇**（与输入句的词集差 ⊆ 语气词池 ∪ 标点 ∪ 称呼池）。 | R7 / R8 / R9 |
| **AC-4** | **共情前置（特征 3）** | ① 用户负向（`ue.polarity < −0.4`）场景 100 例，回复**首句为共情句**的比例 **≥ 0.85**；② L3 场景的共情句强度评分（人工标注 1–5）均值 **≥ 1.4 ×** L0 场景均值；③ 共情句与本轮 `bondFrag` **不同时拼接**（互斥，避免双呼应）。 | R10 |
| **AC-5** | **情绪镜像阻尼（特征 5）** | ① 用户崩溃（`polarity ≤ −0.7 && intensity ≥ 0.7`）50 例，小暖自身 `intensity` **≤ 0.50**（不跟着崩），且 `dom ∈ { neutral, peaceful, sad }` 中 `sad` 占比 ≤ 0.40；② 同场景下回复含「托底」句式（"我在"/"慢慢来"/"不怕"/"陪你"等）比例 **≥ 0.60**；③ 对照：非崩溃的普通负向场景（polarity −0.5）下，小暖 `intensity` 显著高于崩溃场景（**差值 ≥ 0.10**），证明阻尼是**非线性**的。 | R5 / R10 |
| **AC-6** | **话轮节奏调制（特征 4）** | ① 低情绪（`sad`，`intensity ≥ 0.6`）30 例：平均句长 **≤ 14 字**、反问率 **≤ 0.10**、主动开启话题率 **≤ 0.08**；② 高情绪（`joy`，`intensity ≥ 0.6`）30 例：感叹率 **≥ 0.20**、主动开启话题率 **≥ 0.25**、平均句长 **≥ 18 字**；③ 两组平均句长差 **≥ 6 字**。 | R11 |
| **AC-7** | **铁律零回归** | ① 冻结线四文件字节**逐位不变**；② 5 新模块剥注释后零外发正则**命中 0**；③ `package.json` / `package-lock.json` **diff = 0**；④ 全仓最终句文案路径**无** `Xiaonuan` 替换/意译；⑤ 全量测试 **527/527 绿**（v4.4 新增用例另计，不冲抵基线）。 | R16 |
| **AC-8** | **降级等价** | ① 5 新模块全部不加载 → 回复输出与 v4.3 基线 **逐字 diff = 0**（100 句对照）；② 任一模块抛错（注入 `throw`）→ 该步跳过，其余步骤正常，**不白屏**；③ `AffectVoice.setConfig({ enabled: false })` → 原句直出。 | R15 |
| **AC-9** | **F0 接线验证** | 加载 `index.html` 后，浏览器上下文中 `window.AffectState` / `window.VoiceStyle` / `window.EmpathyFront` / `window.TurnRhythm` / `window.AffectVoice` **5 个全局全部存在**（本条即修复新发现 A 的可验证证据）。 | R13 |
| **AC-10** | **性能** | 单轮 `AffectVoice.orchestrate` 耗时 **p95 ≤ 3 ms**（1000 句基准，Node 18，排除 I/O）。 | — |
| **AC-11** | **盲评（人工）** | 20 组对照对话（v4.3 vs v4.4，随机顺序、双盲），拟人度评分 **≥ 4.0 / 5.0** 且 **≥ v4.3 基线 + 0.3**；「机器人感」负面标签占比 **≤ 15%**。 | G1/G2/G3 |

---

## 10 · 风险与缓解

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| **R-1 双加工（油腻感）** | 🔴 高 | 本地引擎分支已含 `texture.js` 微行为（tic/drift/hes），若 v4.4 文风层再叠语气词/标点 → 过度加工、失真 | R14 维度避让：`textured=true` 时 `applyStyle` **只做句长节奏 + 共情前置**，跳过语气词与标点；AC-8 逐字对照防回归 |
| **R-2 共情复读（塑料感）** | 🟠 中 | 共情句池固定 → 长期对话出现"听起来挺难受的"复读，正是候选 F 当年修 MIRROR 扩表要解决的问题 | 每 `ue.type × stage` 档 **≥ 6 条**句式；叠加 `dialogue-core` LRU 去重（近 12 条）；P1 R17 允许 bond-memory 提供个性化变体 |
| **R-3 验收翻转** | 🟠 中 | AC-2④（强制 `peaceful` 过渡）可能与 v4.1 G2「强情绪当轮呈现」在特定序列上冲突 | 明确优先级：**强事件（`intensity ≥ 0.8`）突破通道优先于过渡闸**，两者不并存；测试用例显式覆盖该边界 |
| **R-4 参数调不准** | 🟠 中 | α=0.45 / gain=0.45 / 8 态参数表均为初值，盲评可能不达标 | P1 R22 调试面板暴露全部参数；全部参数集中于 `affect-state.js` 与 `voice-style.js` 两个文件顶部常量区，单点可调 |
| **R-5 情绪向量持久化膨胀** | 🟢 低 | `S.affect` 每轮写 localStorage，8 维浮点 | 落盘前 `toFixed(3)` 截断；`S.affect` 总长 < 300 B，可忽略 |
| **R-6 老档升级** | 🟢 低 | 已有用户 `S` 中无 `affect` 字段 | 挂载点 ⑤ `Object.assign` 兜底 + `readState(S)` 内置缺省，双重保险 |
| **R-7 ReplyTexture 命运悬而未决** | 🟠 中 | Q1 未拍板前，无法锁定改动面与 AC-9 的断言口径 | **列为 Q1，需主理人优先拍板**；PRD 已给出三种方案的改动面与风险对照 |

---

## 11 · 待主理人拍板（Q1–Q8，仿 v4.3 体例）

| 编号 | 问题 | 选项 | 我的倾向 |
|------|------|------|----------|
| **Q1** 🔴 | **`reply-texture-orchestrator.js` 的命运**？（新发现 A：它未进 index.html，浏览器内从未执行；其 `mirror`/`pacing` 与 v4.4 的 `empathy-front`/`turn-rhythm` 维度重叠，`recall` 与 v4.3 `bondFrag` 重复） | **A · 不接线，v4.4 全量接管**：不补 script 标签，把 `reply-texture-orchestrator.js` 留作历史模块（qa-f 测试仍直接 require，零回归），v4.4 自建 `empathy-front` + `turn-rhythm` 覆盖 mirror/pacing 两维，recall 由 v4.3 bondFrag 独占<br>**B · 接线 + 增强**：补 script 标签，并在其 `orchestrate` 内新增 moodState/stage 消费（触碰候选 F 验收，需重 baselining）<br>**C · 接线但不增强，与 v4.4 分层共存**：补 script 标签，v4.4 在其之后运行并**关闭**其 mirror/pacing（经 `setConfig`），仅保留 continuity | **A**——它从未上线，无任何用户感知可损失；A 方案改动面最小、零验收翻转、维度不重叠。代价是 `qa-f-acceptance` 测的是一个未上线模块（历史遗留，建议单独立项清理）。**若主理人希望保留候选 F 的既有投资，选 C。** |
| **Q2** | **情绪的内部表示**？决定 `S.affect` 的结构与 AC-2 的度量口径 | **A · 8 维向量 + 主导态 + 强度 + 动量**（向下兼容输出 `moodState`，推荐）<br>B · 保持单 `key` + `intensity`，另加一个惯性标量（改动最小，但无法表达"喜中带心疼"的余韵混合）<br>C · 复用既有 V-A 二维 + 惯性（与 `S.emotion` 融合，但 V-A 九区无法承载吃醋/撒娇，已被 v4.1 论证过） | **A**——8 维向量是唯一能同时满足「惯性插值」「余韵混合」「跃变可度量（L1 距离）」三个需求的表示；且与 v4.1 的 7 态枚举一一对应，`moodToExpr`/`moodToTTS` 零改动 |
| **Q3** | **阻尼系数 α 默认值**？α 越大 = 越快跟上新情绪 | A · 保守 0.30（情绪极稳，但可能"迟钝"）<br>**B · 适中 0.45**（强事件提至 0.75，推荐）<br>C · 激进 0.60（情绪明快，但可能"善变"） | **B**——对应 AC-1②「弱事件从 0 到 0.8 至少 3 轮」，实测手感接近真人；R19 再按 tone 分化（0.35–0.60） |
| **Q4** | **强事件突破阈值与频次上限**？v4.1 G2 验收要求强事件当轮呈现，v4.4 的突破通道直接受此约束 | A · 阈值 0.75 / 24h 上限 3 次<br>**B · 阈值 0.80 / 24h 上限 2 次**（推荐）<br>C · 阈值 0.85 / 24h 上限 1 次 | **B**——0.80 与 `inferMoodEvent` 现有产出（`coquettish` 0.85 / `jealous` 0.8）自然对齐，不会让既有意图映射"够不着"突破档；2 次/24h 足以表达"今天有两件大事"，又不至于天天跳变 |
| **Q5** | **空闲衰减（app.js:735-738）是否纳入 P0**？这是新发现 E：不纳入则两套衰减并存，跨话轮一致性（AC-2）在"用户离开 10 分钟再回来"的场景下会失效 | **A · 纳入 P0**（挂载点 ③ 一并改，AC-2 覆盖长间隔场景，推荐）<br>B · 留 P1（挂载点 ③ 不改，AC-2 只覆盖连续对话场景） | **A**——AC-2 若不管这个场景，特征 6「跨话轮一致性」就是半截的；改动量仅 3 行，风险极低 |
| **Q6** 🔴 | **是否允许给 `emotion-core.js` 加一段「已降级为兼容路径」的说明注释**？（它不在冻结线四文件内，改它不违反铁律，但会改变其字节数，且此前各版本均保持零改动） | **A · 零字节**（注释只写在 `affect-state.js` 内，`emotion-core.js` 逐字不动，推荐）<br>B · 允许加注释（~200 B，需主理人一次性批准，字节闸不覆盖该文件故无需重 baselining） | **A**——`emotion-core.js` 零改动是比"注释清晰"更高的价值；且 Q1 若选 A，未来 `moodTick` 大概率会被整体移除，此时加注释是浪费 |
| **Q7** | **文风改写的作用边界**？`applyStyle` 能改到什么程度，直接决定"真人感"上限与"破墙"风险 | **A · 保守**：只允许增删语气词、改写句末标点、拆长句/并短句、注入停顿与省略号（推荐）<br>B · 中等：额外允许**调整语序**（如把状语前置）<br>C · 激进：额外允许**替换句式模板**（可重写部分表达） | **A**——v4.4 的护栏是 `PersonaCore.safetyGuard`，改写越强越难保证不破墙；且 AC-3④ 要求「不引入任何新事实词汇」，A 是唯一能严格证明的边界。B/C 留 v4.5，需配套更强的语义级护栏 |
| **Q8** | **体积监管**：v4.4 新增 5 模块 ≈ 43 KB + `app.js` ≈ 2.5 KB，不在 `test/wiring-scan.js` 的 `SIZE_BUDGET.mods` 列表内 | **A · 沿用先例，声明豁免**（与 `local-heuristic.js` / `reply-texture-orchestrator.js` / `app.js` 同口径，v4 完整 PRD Q7/A 已裁定，推荐）<br>B · 纳入预算门禁（需扩展 `wiring-scan.js` 并调 `moduleSumMax`/`totalMax`） | **A**——与 v4 / 候选 E / 候选 F 三度裁定一致，四锁恒等式逐位不变；B 会牵动 `engineNetMax` 整套会计恒等式，成本远大于收益 |

### 补充待确认（非阻塞，可延后）

| 编号 | 问题 | 我的倾向 |
|------|------|----------|
| **Q9** | `S.relationship.stage` 默认值 `'stranger'`（app.js:412）与 proactivity-core 写入的 `'L0'` 不一致（新发现 D）。是否顺手统一为 `'L0'`？ | 倾向：**v4.4 不改 app.js:412**（改变默认值有跨档风险），改由 `AffectState.normalizeStage()` 做读入时归一化（`stranger`/`undefined`/`'L0'` 均映射为 L0）。统一默认值可留 v4.5 随老档迁移一并处理 |
| **Q10** | 主动消息分支（app.js:2264）纳管是 P0 还是 P1？ | 倾向：**P1**。主动消息文本来自冻结的 `Engine.proactivePlan`，文风一致性收益中等，但会扩大回归面；先验证主链路盲评（AC-11）再决定 |

---

## 12 · 交付范围声明

**v4.4 做什么**：修 F0（接线）、F1（情绪惯性）、F2（情绪-文风耦合）、F3（编排器接情绪与关系阶段）；交付 5 个新模块 + `index.html` 接线 + `app.js` 5 处挂载；不触碰冻结线四文件，不改 `emotion-core.js` / `reply-texture-orchestrator.js`。

**v4.4 不做什么**（明确 Out of Scope，避免范围蔓延）：
- 不重写 `Engine.reply()`（冻结），不做生成式改写，不引入任何模型/推理。
- 不做语义级内容改写（Q7 选 A 的前提下）。
- 不动 `bond-memory.js` / `proactivity-core.js` / `sense-core.js` / `persona-core.js` 的逻辑（只读消费）。
- 不做 UI 新增（R22 调试面板为 P1，且置于既有调试位）。
- 不清理 `reply-texture-orchestrator.js`（Q1 选 A 时留作历史模块，建议 v4.5 单独立项）。
- 不解决「云端大脑分支的文风一致性」——云端返回的文本同样过 v4.4 编排器（挂载点 ② 覆盖全 provider），但**不修改发送给云端的 prompt**（那是 v4.5 的课题）。

> 本 PRD 仅完成产品侧 v4.4 的范围、需求池、模块清单、挂载点、取舍与验收标准；**不代写架构师/工程师/验收角色内容**。转架构师做模块签名设计与字节预增/上限表，主理人齐活林批准 §11 后进入实现。**Q1 与 Q6 需优先拍板**——Q1 决定改动面，Q6 决定 `emotion-core.js` 是否保持逐字零改动。
