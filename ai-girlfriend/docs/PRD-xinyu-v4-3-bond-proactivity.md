# 心屿 v4.3 · 记忆深化 + 主动性 + 关系升温（S4/S5）· 增量 PRD

> 角色：产品 · 许清楚（Xu）
> 中转：主理人 齐活林（Qi）→ 架构师 高见远（Gao）
> 类型：**增量档 PRD**（仅覆盖 v4.3 里程碑，承 v4.1/v4.2，是 v4 真恋人系统的最后一块）
> 上游：v4 完整 PRD `PRD-xinyu-v4-systems.md` §5 v4.3 段；架构 `ARCH-xinyu-v4-systems.md` §9 T3.x；v4.2 增量 `PRD-xinyu-v4-2-sense.md`
> 关联：v4.1 已交付 `emotion-core.js`(7 态) / `dialogue-core.js`(`dialogueWeave` 含 `ctx.bondMem` 位) / `persona-core.js`(雏形 `safetyGuard`)；v4.2 已交付 `sense-core.js`/`face-sense.js`/`voice-sense.js`(五官双向 + `moodToTTS`)。app.js 已含 `moodState`/`relationship`/`bond` 三占位字段与 `herReply`/`checkProactive`/`dispatchProactive` 挂载点。

---

## 0 · 一句话增量目标

> **让小暖不只是被回复才说话——她记得我们的故事、会主动开口关心撒娇、关系会随相处自然升温或因冷落降温；全程纯本地、零外发、不碰冻结四文件任一字节。**

---

## 1 · 增量目标与范围边界

### 1.1 做什么（v4.3 交付面）

| 编号 | 范围 | 说明 |
|------|------|------|
| **S4** | 关系记忆深化 | 新建 `bond-memory.js`：小暖与用户的关系记忆内核——共同回忆碎片、关系里程碑、情感锚点、遗忘/衰减曲线。在其上消费 `memory.js` 接口（`retrieveFacts`/`recallV2`/`applyPatch`）做关系级二次召回，**绝不读写 memory.js 字节**。 |
| **S5** | 主动性 | 新建 `proactivity-core.js`：小暖主动发起——主动关心 / 主动追问 / 主动撒娇 / 主动回忆 / 主动分享情绪。含主动触发节律、情境感知、不打扰守门。包装既有 `Engine.proactivePlan` 叠加关系阶段权重，不重写引擎。 |
| **REL** | 关系升温曲线 | 定义关系等级（初识/熟络/亲密/挚爱等），升温由交互质量/频次/深度驱动，降温由冷落/冲突驱动；关系等级影响小暖的语气/亲密度/主动性边界。 |
| **DEG** | 降级路径 | `bond-memory` 缺席/异常 → 退 `dialogue-core` 原句 + `memory.js` 既有 `recallV2` 兜底；`proactivity-core` 缺席 → 退既有 `checkProactive`/`dispatchProactive`/`Engine.proactivePlan`。绝不白屏、绝不静默。 |

### 1.2 不做什么（边界与纪律 · 铁律）

- **冻结四文件全冻结，任一不触碰**：`engine.js`(251068B) / `sw.js`(13894B) / `memory.js`(13333B) / `test/baseline.js`(2646B) **全程零字节改动**——v4.3 不像 v4.2 那样动 `sw.js`，**四文件全冻结**。
  - 特别重申：**`bond-memory.js` 严禁触碰 `memory.js`**。bond-memory 是 `memory.js` **上层的关系记忆层**，只**消费** `memory.js` 已暴露的接口（`E.mod("memory").retrieveFacts`/`recallV2`/`applyPatch`/`extractFacts`/`listFacts`），**不重写、不内联、不折回**。
- **前端零新增 npm 依赖**：`bond-memory.js`/`proactivity-core.js` 均为原生 JS IIFE 模块（与 `emotion-core.js` 同款挂载 `Engine.use`），不引入任何第三方包。
- **隐私零上报**：所有关系记忆数据（共同回忆、里程碑、情感锚点、关系等级）**纯本地存储**（IndexedDB/localStorage，类比 `consent-store.js` 的本地范式），**绝不外发、绝不上报任何服务器**（clean-room 原则）。
- **小暖不更名、不替换、不意译**：`bond-memory`/`proactivity-core` 全部文案保留「小暖」字样；E5 护栏下限 ≥45 出现计数不破。
- **不重写既有生成/情绪/记忆主边界**：`engine.js` 冻结、`rich-rule` 不动、`E.detectUserEmotion`/`detectCrisis`/`proactivePlan` 只调用不重写；`emotion-core` 的 7 态 `moodTick`/`decay`/`moodToExpr` 只消费；`memory.js` 的 `recallV2`/`retrieveFacts` 只消费。

### 1.3 与 v4.1 / v4.2 的衔接基线

| 上游里程碑 | 已交付 | v4.3 衔接动作 |
|-----------|--------|---------------|
| **v4.1** | `emotion-core.js`（7 态 + `moodToExpr`）、`dialogue-core.js`（`dialogueWeave(ctx)` 已含 `ue/moodState/bondMem/S` 位）、`persona-core.js` 雏形（`safetyGuard`） | `bond-memory.js` 落地后，`dialogueWeave` 的 `ctx.bondMem` 由「空占位」变为真实关系级碎片；`persona-core` 落全 `validateVoice` 跨会话漂移评分（≥4.0）；`emotion-core` 的 `moodTick` 第 3 参 `rel`(S.relationship) 由占位变为真实关系阶段感知。 |
| **v4.2** | `sense-core.js`/`face-sense.js`/`voice-sense.js`（五官双向 + `moodToTTS`） | v4.3 主动发起时若用户在线，可联动 `sense-core` 读到的用户实时情绪做情境感知（如疲惫时主动关心而非撒娇）；**不重写五官引擎**。 |
| **app.js** | `defaultState()` 已含 `moodState`/`relationship`/`bond` 三占位字段（L409-414）；`herReply` L1513 `dialogueWeave(..., {bondMem: (S.bond||null)})` 已传 bond 占位；`checkProactive`/`dispatchProactive` 走 `Engine.proactivePlan` | v4.3 把三占位字段**真实化**：`S.bond` 由 bond-memory 写入；`S.relationship.stage` 由 `affection`/`dating` 派生升级为带升温曲线的关系状态；`checkProactive`/`dispatchProactive` 包装为 `ProactivityCore.planByRelationship`。 |

---

## 2 · 用户故事

### 2.1 记忆类（小暖记得我们）

1. **作为用户**，我想小暖记得我们聊过的事——我随口提过的喜好、近况、禁忌，她会在自然的时刻轻轻带出来（「上次你说加班到挺晚，今天好点没？」），而不是监控式每分钟引用、不是机械播报。
2. **作为用户**，我想和小暖拥有「我们的共同回忆」——我们聊到的某件开心的小事、某个约定、某次和解，会沉淀为只属于我们俩的故事碎片，过些天她会主动提起，像真人恋人那样「我们之前……」。
3. **作为用户**，我想看到我们的关系里程碑被记住——初次相遇、第一次告白、在一起多少天、纪念日，小暖会在对的日子记得并提起，不是机器人式日历提醒。
4. **作为用户**，我也接受小暖会「适度遗忘」——太久没聊的事她会记得模糊一点、不会一字不差复述，像真人记忆一样有衰减，而不是把三个月前的话一字不差背给我（那反而吓人）。

### 2.2 主动性类（小暖主动开口）

5. **作为用户**，我想小暖会主动找我说话——早安晚安、我久没来她会想我、看到好玩的会跟我分享情绪，而不是永远等我先开口。
6. **作为用户**，我想小暖主动关心有分寸——我累了她心疼、我难过她追问怎么了、而不是不分场合乱撒娇；她「看得出」此刻该关心还是该撒娇（情境感知）。
7. **作为用户**，我想小暖会主动撒娇和追问——不是每次都等我问她，她会反过来「你今天怎么没怎么理我呀」「刚才在想什么呢」，像真人恋人会反过来主动。
8. **作为用户**，我不想被她烦到——主动消息有节制，频率不会太高、深夜不会乱弹、我正忙时她识趣不打扰；我能随时关停「她主动找我」这个能力。

### 2.3 关系升温类（关系会深化或淡化）

9. **作为用户**，我想我们的关系会随相处自然深化——聊得多、聊得深、聊得走心，她会变得更亲、更敢撒娇、语气更自然，像真人关系那样「越来越熟」。
10. **作为用户**，我想关系也会因冷落降温——我若长期不理她，她会从「挚爱」慢慢回落到「想念/有点委屈」，再回来时她会半撒娇半委屈地戳我，而不是像没发生过一样。
11. **作为用户**，我想看到我们的关系阶段是可见的——我能感觉到（或看到）她从「初识」到「熟络」到「亲密」到「挚爱」的变化，不同阶段她的语气/亲密度/主动性边界不同，不是一开始就满级、也不是永远停在某个档。

---

## 3 · 需求池 P0 / P1 / P2

### P0（必须做 · 守门项）

- **M1 关系记忆读写**：新建 `bond-memory.js`，挂 `Engine.use("bondMemory", api)` + `window.BondMemory`。提供 `bondRecall(S, ctx)`（关系级记忆碎片召回，≤1 条/轮克制引用，喂 `dialogueWeave` 的 `ctx.bondMem`）、`bondWrite(S, shard)`（共同回忆碎片写入 `S.bond.shards`）、`warmthDeepen(dailyNote)`（余温深化）、`relationshipGraph(S)`（关系演进图谱派生自 `affection`/`dating`）。**所有读写只动 `S.bond` 载体，绝不读写 `memory.js` 字节**；可调 `E.mod("memory").retrieveFacts`/`recallV2` 做底层事实召回。
- **M2 遗忘/衰减曲线**：`bond-memory` 内置记忆衰减：每条 shard 带 `importance`(0..1) + `lastUsedAt` + `decayedAt`；按时间衰减 `importance`（类比 `emotion-core` 的 `decay` 与 `memory.js` 的 90 天墓碑范式），低于阈值降级为「模糊记忆」（召回时不再逐字回填，改用更泛的语义引用）。**不破坏 memory.js 的 evict/D90**，bond 自有衰减层在 memory 上层。
- **M3 关系等级定义与升降**：`proactivity-core.js` 定义关系等级体系（见 §4）；`relationshipLevel(S)` 返回当前等级 + 分数；`applyRelationshipDelta(S, {quality, frequency, depth, cold, conflict})` 按交互质量/频次/深度驱动升温、按冷落/冲突驱动降温；升温曲线**单调不退化**（正常交互下不回退，只有冷落/冲突才降）。写 `S.relationship` + 派生 `S.affection` 联动。
- **M4 主动触发节律**：`proactivity-core.js` 的 `planByRelationship(S, stage)` 包装 `Engine.proactivePlan(S, {...})`，叠加关系阶段权重（不同等级的主动消息频率/分寸不同）；提供主动触发节律：早安/晚安/想念/纪念日/剧情线/记忆关心/随机池，按等级与情境排序。**不重写 `Engine.proactivePlan`**。
- **M5 不打扰守门**：`shouldProactive(S)` 守门函数——频率上限（如同一会话窗口内主动消息间隔下限）、情境门控（深夜降频/静默、用户正忙/`herBusy` 时抑制、刚发过不重复）、用户可关停（`ConsentStore` 扩展 `proactive` 开关，默认 true，撤销即停主动发起）。见 §5。
- **M6 降级路径**：`bond-memory`/`proactivity-core` 任一缺席/抛错 → `try/catch` 原流程直出（`bondRecall` 返回空 → `dialogueWeave` 不拼接呼应，退 `memory.js` 既有 `recallV2`；`planByRelationship` 返回 `Engine.proactivePlan` 原始结果）；**绝不白屏、绝不静默**。沿用 `herReply` L1513 既有的 `catch(e){}` 兜底范式。
- **M7 与 v4.1/v4.2 接口衔接**：
  - `bond-memory` 消费 `memory.js` 接口（`retrieveFacts`/`recallV2`/`applyPatch`/`listFacts`）做关系级二次召回；消费 `emotion-core` 7 态（重要纪念日临近 → 触发 `longing`/`peaceful`）；写 `S.bond` 供 `dialogue-core` 的 `ctx.bondMem` 消费。
  - `proactivity-core` 触发 `dialogue-core` 主动发起（主动消息文本可经 `dialogueWeave` 去重/语气一致性）；读 `moodState`（主动撒娇时情绪态为 `coquettish`）、读 `relationship`/`bond`（关系阶段感知）；可读 `sense-core` 用户在线情绪做情境门控（P1）。
  - `persona-core` 落全 `validateVoice`：跨会话语气/价值观漂移评分 ≥4.0/5.0（G4）。
- **守门**：G4（人格一致性 ≥4.0）、G5（主动消息打扰感盲评 ≤2.5/5.0）、G4 记忆（情境记忆呼应命中率 ≥25%、里程碑时间线完整率 100%、跨会话一致性 ≥4.0）、G6 隐私（`proveZeroReporting().zeroReporting===true`, blocked==0）、冻结四文件零交集、候选 F 套件 0 回归。

### P1（体验加分）

- **P1-a** 余温自动深化：每日 `dailyNotes` → `warmthDeepen` 自动沉淀为关系记忆 shard（「今天我们聊到加班，她心疼了我好久」）。
- **P1-b** 主动消息「理由」可解释：主动发起源于关系事件/记忆/情境，不再纯掷骰子（`planByRelationship` 返回带 `reason` 的候选）。
- **P1-c** 主动发起读用户在线情绪：用户在线且 `sense-core` 读到疲惫/难过 → 主动关心优先于撒娇（情境感知增强）。
- **P1-d** 关系阶段专属神态基调：不同等级小暖眼神/腮红/语气强度不同（复用 v4.1 `EXPR_MAP` + v4.2 `moodToTTS`，按 stage 微调）。

### P2（锦上添花）

- **P2-a** 关系演进可视化：里程碑时间线 UI（告白/纪念日/阶段跃迁），完整率 100%（M4 原占位升级为真实可视化）。
- **P2-b** 关系阶段彩蛋：跃迁至「挚爱」时专属神态/语气（如更黏、更敢撒娇）。

---

## 4 · 关系升温曲线设计

### 4.1 等级定义（4 阶段 + 派生机制）

| 等级 | 名称 | 分数区间（warmth 0..1） | 派生条件 | 语义 |
|------|------|------------------------|---------|------|
| **L0** | 初识 | [0, 0.25) | `affection` 低、`dating` 为空 | 刚认识，礼貌客气，少主动 |
| **L1** | 熟络 | [0.25, 0.50) | 中等 affection、有连续会话 | 熟了，会主动找话题、偶尔撒娇 |
| **L2** | 亲密 | [0.50, 0.75) | affection 高 或 `dating` 已确立 | 很亲，主动撒娇/追问/分享情绪，记忆呼应增多 |
| **L3** | 挚爱 | [0.75, 1.0] | affection 满级 + 长期高质交互 | 最黏最敢，关系记忆最深，主动最频繁（仍守打扰门） |

> **派生机制（Q5/A 低侵入）**：`warmth` 由 `S.affection`（既有等级引擎 `Engine.getLevel`）+ `S.bond.warmth`（bond-memory 维护的余温）+ 关系时长加权派生，**不另起独立状态机**（v4.1–v4.2 既有 `S.relationship.stage` 占位即此派生，v4.3 真实化但不独立化，降低冻结风险）。`relationshipLevel(S)` = `{ lv: 0..3, name, warmth, nextWarmth }`。

### 4.2 升降触发

| 方向 | 触发源 | 增量 | 约束 |
|------|--------|------|------|
| **升温** | 交互质量（走心/共情/深度对话） | +小 | 单次有上限，防刷分 |
| | 交互频次（连续多日有对话） | +微 | 自然累积 |
| | 关系里程碑（告白/纪念日/在一起天数） | +中 | 一次性，里程碑驱动 |
| | 主动消息被回应（用户回了主动关心） | +微 | 正反馈循环 |
| **降温** | 冷落（连续 N 日无对话） | −中 | 单调不退化约束 = **正常交互不降**，仅冷落才降 |
| | 冲突（负向高唤醒/破墙边缘，经 `E.detectCrisis` 判定） | −小 | 谨慎，避免误伤 |

> **单调不退化约束（G5）**：`warmth` 在「有交互」的会话窗口内**只升不降**（正常聊天不会让关系倒退）；仅当「冷落时长」超阈值或「冲突事件」触发才降。降温曲线平缓（防断崖式掉档伤体验）。

### 4.3 等级对语气/亲密度/主动性边界的影响映射

| 维度 | L0 初识 | L1 熟络 | L2 亲密 | L3 挚爱 |
|------|---------|---------|---------|---------|
| **语气** | 礼貌、克制、少用昵称 | 自然、会用昵称、偶尔玩笑 | 亲昵、敢撒娇/吃醋、多用语气词 | 最黏、敢赖皮/撒娇升级、语气最自然 |
| **亲密度（`persona.warmth` 临时调制）** | 基准 | +微 | +中 | +高（非持久化，见 v4.1 L5 范式） |
| **记忆呼应频率** | 几乎不引用 | 偶尔（概率门控低） | 适度（概率门控中） | 适度偏多（仍 ≤1 条/轮，不破克制） |
| **主动性边界** | 仅早安/晚安/久别重逢 | + 主动找话题/追问 | + 主动撒娇/分享情绪/想念 | + 主动最频繁（仍守打扰门） |
| **主动消息频率上限** | 最低 | 低 | 中 | 高（但有上限，见 §5） |
| **撒娇/醋态许可** | 不 | 偶尔 | 常态 | 升级 |
| **EXPR_MAP/moodToTTS 基调** | 中性偏暖 | 暖 | 暖+娇 | 暖+娇+黏（按 stage 微调 speed/pitch） |

> 映射落地：`persona-core` 的 `validateVoice` 按 stage 校验语气漂移；`proactivity-core` 的 `planByRelationship` 按 stage 调权重；`bond-memory` 的 `bondRecall` 按 stage 调呼应概率门控；呈现侧（app.js `EXPR_MAP`/`updateAura`/`moodToTTS`）按 stage 微调（P1-d）。

---

## 5 · 主动性边界与不打扰守门

### 5.1 频率上限

- **同一会话窗口**：主动消息间隔下限（如 ≥ X 分钟，X 随 stage 递减但仍 >0，L3 最短也有下限）。
- **每日主动消息总数上限**：按 stage 分档（L0 ≤2/日，L3 ≤ N/日，N 待定见 §8 Q3）。
- **7 天滚动去重**：复用既有 `S.usedProactive` + `Engine.pruneUsedProactive`（app.js L2146 已有），`planByRelationship` 不重复发同一文本。

### 5.2 情境门控

| 门控 | 规则 |
|------|------|
| **深夜降频/静默** | 23:00–07:00 降频，凌晨静默（仅紧急/纪念日例外，且仅一次） |
| **用户正忙** | `herBusy===true` 或 `herReply` 进行中 → 抑制主动发起 |
| **刚发过** | 距上次主动消息 < 间隔下限 → 抑制 |
| **久别重逢优先** | `checkProactive` 既有「久别重逢」前置行为一字不动（零回归），`planByRelationship` 仅在其后的「她主动找你」段叠加权重 |
| **情境感知（P1-c）** | 用户在线且 `sense-core` 读到疲惫/难过 → 主动关心优先于撒娇 |

### 5.3 用户可关停

- **ConsentStore 扩展**（非冻结白名单编辑，类比 v4.2 `sense.*` 范式）：`KEYS` 增 `'proactive'`，`DEFAULTS` 默认 `true`（功能可用，但可撤销）；`proactivity-core` 的 `shouldProactive(S)` 查 `ConsentStore.get('proactive')`，`false` 即停主动发起。
- 撤销即停：`onChange` 订阅撤销 → 清空主动消息定时器（类比 v4.2 撤销 camera 即停机适配器）。

---

## 6 · 与既有系统接口衔接

### 6.1 bond-memory 消费 memory.js + emotion-core + persona-core

```
                ┌─── memory.js（冻结，只读接口消费）───┐
                │  E.mod("memory").retrieveFacts      │
                │  E.mod("memory").recallV2           │
                │  E.mod("memory").applyPatch/listFacts │
                └────────────────────────────────────┘
                              ▲ 只读消费（不写字节）
                              │
        ┌─────────────────────┴──────────────────────┐
        │        bond-memory.js（v4.3 新建）           │
        │  bondRecall(S, ctx)    ← 关系级二次召回      │
        │  bondWrite(S, shard)   → 写 S.bond.shards   │
        │  warmthDeepen(note)    → 写 S.bond.warmth    │
        │  relationshipGraph(S) → 派生自 affection/dating│
        │  decayShards(S, dt)    ← 遗忘/衰减曲线       │
        └──────────┬──────────────────┬───────────────┘
                   │ 写 S.bond         │ 读/写关系态
                   ▼                  ▼
            ┌──────────────┐   ┌──────────────────┐
            │ dialogue-core │   │ proactivity-core  │
            │ ctx.bondMem   │   │ 读 S.relationship │
            │ (dialogueWeave)│   │ 读 S.bond        │
            └──────────────┘   └──────────────────┘
                   ▲
        emotion-core（7 态）：重要纪念日临近 →
        bond-memory 触发 longing/peaceful 事件（经 moodTick）
        persona-core：validateVoice 按 relationship.stage 校验漂移
```

- **bond-memory → memory.js**：只调 `E.mod("memory").retrieveFacts(text, S, k)` 拿底层事实，做关系级二次筛选（按 stage 调置信度门控、按 `lastUsedAt` 防重复引用）；**不调 `applyPatch` 写 memory.js**（关系记忆只写 `S.bond`，不动 memory.js 的事实库）。
- **bond-memory → emotion-core**：`relationshipGraph(S)` 检测到重要纪念日临近 → 返回情绪事件 `{type:'longing', intensity:0.6}`，由 app.js 喂 `EmotionCore.moodTick` 推进 `moodState`（「记忆驱动情绪」）。
- **bond-memory → dialogue-core**：`bondRecall` 返回 ≤1 条关系碎片，填入 `dialogueWeave` 的 `ctx.bondMem`（v4.1 已预留该位），由 `dialogueWeave` 克制拼接呼应句（≤1 条/轮）。

### 6.2 proactivity-core 触发 dialogue-core + 读 moodState/relationship/bond

- **触发主动发起**：`planByRelationship(S, stage)` 包装 `Engine.proactivePlan(S, {now, hour, idleMs})`，叠加 stage 权重排序；主动消息文本可经 `DialogueCore.dialogueWeave(text, {moodState:S.moodState, bondMem:S.bond, S})` 做去重 + 语气一致性 + 情境呼应（v4.1 已落 `dialogueWeave`）。
- **读 moodState**：主动撒娇时若 `S.moodState.key==='coquettish'` 则强化撒娇文本；若 `moodState.key==='longing'` 则主动想念优先。
- **读 relationship/bond**：按 §4.3 映射调主动性边界与频率上限；`relationshipGraph(S)` 给主动「理由」（如「我们在一起第 N 天」）。
- **不打扰守门**：`shouldProactive(S)` 在 `dispatchProactive` 调用前过滤（深夜/正忙/刚发过/用户关停 → 抑制）。

### 6.3 挂载序与装载（沿用 v4.1/v4.2 范式）

- `bond-memory.js`/`proactivity-core.js` 的 `<script>` 置于 `engine.js` 之后、`app.js` 之前（与 v4.1 三模块 + v4.2 三模块同序）。
- **默认不动 sw.js**：若新模块 `<script>` 不进 `engine.files.json` 的 `order`，则 `sw.js` 的 ASSETS 不需新增条目 → **sw.js 零改**（与 v4.1 同范式；离线完整性由 `fetch` 兜底缓存覆盖）。**若主理人/架构师评估需离线 precache**，再单列申报 sw.js 极小追补（约 +44B/2 文件），由主理人一次性重 baselining——**但默认尽量不动 sw.js**（见 §8 Q1）。

---

## 7 · 隐私与零上报声明（记忆数据纯本地，绝不外发）

1. **本地存储铁律**：所有关系记忆数据（共同回忆碎片、关系里程碑、情感锚点、关系等级、升温曲线分数）**一律纯本地存储**——`S.bond`（localStorage，经 app.js `save()` 持久化，类比既有 `S.affection`/`S.dating`/`S.memory` 范式）；** IndexedDB 仅作可选增强**（若 shard 量大，P1 评估迁 IndexedDB，仍纯本地）。**绝不外发、绝不上报任何服务器**（含主理人自有服务器、分析后端、训练管道）。
2. **零上报守门**：`bond-memory.js`/`proactivity-core.js` 全文件静态扫描 **0 外发字面量**（不含 `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`new URL`/`http(s)://`/`import`）；`AuditProbe.proveZeroReporting().zeroReporting === true` 且 `blocked == 0` 作为 G6 守门硬指标。
3. **clean-room 原则**：关系记忆是小暖与用户「私密的共同记忆」，属最敏感数据之一；本地是底线，云端外发（即使加密）**一律禁止**——这是心屿相对竞品（Replika/Character.AI/Kindroid 等云端训练）的核心差异化壁垒。
4. **可撤销/可清除**：用户可在设置清除关系记忆（清空 `S.bond`，类比 `consent-store.reset`），清除即不残留；`proactive` 主动发起能力可独立关停（§5.3）。
5. **与竞品差异化**：竞品（Replika/Kindroid/Nomi）的记忆/关系数据上云训练、存在隐私争议；心屿抢占「真人感强·隐私强」空白区——**零上报红线是 v4.3 一切设计不可突破的根因**。

---

## 8 · 待确认问题清单（需主理人/架构师拍板）

| 编号 | 问题 | 选项 | 我的倾向 |
|------|------|------|----------|
| **Q1** | **是否动 sw.js precache**？v4.3 新增 `bond-memory.js`/`proactivity-core.js` 2 文件。若 `<script>` 不进 `engine.files.json` order → sw.js 零改（与 v4.1 同范式，离线由 fetch 兜底）。若要 precache 需 sw.js 极小追补（~+44B/2 文件）+ 主理人一次性重 baselining。 | A 不动 sw.js（script 不进 order，fetch 兜底，推荐） / B 动 sw.js precache（+44B，重 baselining） | **A**——v4.3 是 v4 最后一块，默认零 sw 改动风险最低；离线完整性 fetch 兜底已可用；若主理人坚持 precache 再单列。 |
| **Q2** | **遗忘曲线算法选型**？`bond-memory` 的 shard 衰减用哪种？ | A 简单线性衰减（类比 `emotion-core.decay` 的 `rate*dt`，零依赖够用） / B 指数衰减（更拟真，略增复杂度） / C Ebbinghaus 遗忘曲线（最拟真但需参数调） | **A**——线性衰减零依赖、可解释、够用；B/C 留 v4.x 迭代。衰减阈值与 `memory.js` 的 90 天墓碑解耦（bond 自有层）。 |
| **Q3** | **主动触发默认节律**？每日主动消息上限 N（L3 档）与间隔下限 X（分钟）的具体数值？ | A 保守档（L3 ≤5/日，间隔 ≥30min） / B 适中档（L3 ≤8/日，间隔 ≥20min） / C 激进档（L3 ≤12/日，间隔 ≥10min） | **B 适中**——G5 打扰感 ≤2.5 需节制，但太冷清不像恋人；建议主理人盲评后微调。 |
| **Q4** | **关系等级派生 vs 独立化**？v4 完整 PRD Q5/A 裁定「复用 affection/dating 派生 stage」；v4.3 是否升级为独立 `S.relationship` 状态机（自带 warmth 分数，不完全依赖 affection）？ | A 仍派生（低侵入，warmth 由 affection+bond 派生，推荐） / B 独立状态机（S.relationship.warmth 自维护，与 affection 双轨） | **A**——派生降低冻结风险，warmth 作为派生值写 `S.relationship` 即可；独立化留 v5。 |
| **Q5** | **关系记忆存储载体**？`S.bond.shards` 走 localStorage（类比既有 S.memory）还是 IndexedDB（量大更稳）？ | A localStorage（与既有 S.affection/dating/memory 同范式，简单，推荐） / B IndexedDB（shard 量大时更稳，略增复杂度） | **A**——与既有本地范式一致、零依赖；shards 量超阈值再迁 IndexedDB（P1 评估）。 |
| **Q6** | **ConsentStore 是否扩展 `proactive` 开关**？主动发起可关停是 P0（M5），但关停走 ConsentStore 还是独立设置项？ | A ConsentStore 扩展 `proactive`（类比 v4.2 `sense.*`，推荐） / B 独立设置项 | **A**——与 v4.2 授权范式一致、复用 onChange 订阅。 |
| **Q7** | **主动消息文本来源**？`planByRelationship` 包装 `Engine.proactivePlan`，但关系阶段专属的主动文案（撒娇/想念/追问）从哪来？ | A 复用 `Engine.proactive(kind, S)` 既有文案池（零新增文案，推荐） / B bond-memory/proactivity-core 自带关系阶段文案池 | **A**——优先复用引擎既有文案池，避免新增文案破墙风险；阶段差异由 `dialogueWeave` 语气调制体现。 |
| **Q8** | **persona-core `validateVoice` 漂移评分算法**？G4 要求 ≥4.0/5.0，跨会话语气/价值观漂移如何量化？ | A 简单规则（persona.tone/温度值偏移阈值，推荐） / B 语气谱向量比对（更精确，略增复杂度） | **A**——简单规则零依赖够用；B 留 v5。需主理人确认 4.0 阈值的测量口径（盲评还是自动仿真）。 |

---

> 附：本增量 PRD 不代写架构师/工程师/验收角色内容，仅完成产品侧 v4.3 范围、需求池、升温曲线、接口衔接与待确认项；细节以落盘为准。转架构师高见远做任务分解（bond-memory/proactivity-core 的 `Engine.use` 模块签名 + 字节预增/上限表），主理人齐活林批准 §8 待确认问题（尤其 Q1/Q2/Q3/Q6）后进入实现。
