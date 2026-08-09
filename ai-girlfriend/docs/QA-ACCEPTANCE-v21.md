# QA 独立验收报告 · v21

> **验收人**：严过关（Yan）· QA 工程师
> **验收对象**：v21 变更（路径③ engine 让渡 D=100 / contingency 第 5 语料型 repair / sw.js v24 升键 / TD 守卫入网）
> **验收方式**：**独立验收**。本报告全部结论来自 QA 在沙箱内亲手构造与实跑的证据，
> **不采信工程师寇豆码（Kou）的自检结论**。凡 Kou 自报的数字，QA 一律重新实测复算；
> 凡 Kou 声称"红→绿"的护栏，QA 一律自建破坏性输入重新复现红样。
> **git root 修正**：本仓 git root 为 `/workspace`（非 `/workspace/ai-girlfriend`），
> 所有 `git` 命令均在 `/workspace` 下执行、路径带 `ai-girlfriend/` 前缀，避免假阴性。

---

## 0 · 验收结论

### **PASS-with-flag**

v21 全部 9 项待验收清单**逐条 PASS**，测试通过率 **351/351（100%）**，7 探针全绿，H13 泄漏 **0.000%**。
TD sw guard 的**红样由 QA 亲手构造并复现成功**（含 v20 逃逸事故忠实复现，以及两条 Kou 未列出的更阴险绕过路径）。

附带两个标记项（**均不阻断本轮交付**）：

| 标记 | 性质 | 处置 |
|---|---|---|
| **F-1** | `manifest.released` 块超出 DESIGN-v21 §2.3 schema | **待架构师 Gao 追认**（Kou 已自陈，QA 确认该字段技术上必需，见 §6.4） |
| **F-2** | `PERSONA_BREAK_RE` 对「本质上/归根结底/说白了」句式存在覆盖缺口 | **QA 本轮新发现**，已证为 **v20 即存在的先天遗留、非 v21 回归**，且语料侧不可达 → 建议排入后续轮次（见 §10） |

---

## 1 · 零预算封顶 —— **PASS**

### 1.1 四模块字节零改动（工作区 vs HEAD 逐字节对比）

```
$ cd /workspace && git diff HEAD --stat
 ai-girlfriend/contingency.js                  |  3 +-
 ai-girlfriend/package.json                    |  2 +-
 ai-girlfriend/sw.js                           |  2 +-
 ai-girlfriend/test/qa-rs2-type.test.js        | 64 ++++++++++++++++++++--
 ai-girlfriend/test/qa-v13-t1.test.js          |  6 +-
 ai-girlfriend/test/qa-v13-t2t4-fix.test.js    | 26 ++++++---
 ai-girlfriend/test/qa-v13-t5b.test.js         | 17 +++++-
 ai-girlfriend/test/qa-v15-t1.test.js          |  6 +-
 ai-girlfriend/test/qa-v15-t2.test.js          | 18 +++++-
 ai-girlfriend/test/qa-v16-size-probe.js       | 23 ++++----
 ai-girlfriend/test/qa-v17-independent-size.js | 13 +++--
 ai-girlfriend/test/qa-v19-quota-gate.js       | 79 ++++++++++++++++++-----
 ai-girlfriend/test/wiring-scan.js             | 37 +++++++++--
 13 files changed, 237 insertions(+), 59 deletions(-)
```

**`engine.js` / `memory.js` / `presence.js` / `texture.js` 四个文件均未出现在 diff 中** ⇒ 冻结锚点守住。

QA 不止看 diff，另做字节实测对拍：

| 文件 | 工作区实测 | `git show HEAD:` | 判定 |
|---|---|---|---|
| `engine.js` | 248395 | 248395 | 逐字节相同 ✅ |
| `memory.js` | 13333 | 13333 | 逐字节相同 ✅ |
| `presence.js` | 3566 | 3566 | 逐字节相同 ✅ |
| `texture.js` | 4366 | 4366 | 逐字节相同 ✅ |
| `contingency.js` | **6626** | 6270 | **+356B**（本轮唯一花钱项）✅ |

### 1.2 contingency 增量与配额

```
v18 b36842f contingency = 5652 B
v20 5f880ec contingency = 6270 B  (Δ v18→v20 = +618)
v21 工作区  contingency = 6626 B  (Δ v20→v21 = +356)
```

`+356B` 与 v21 声明一致；`6626 < 6682`（quota），余 **56B**。
⚠ 门禁锁④用**严格 `>`**，故自 6626 起真正可增仅 **55B**（第 56B 会让「配额 > 基线」失效）。

### 1.3 语料条数实测（防"改了字节但没落语料"）

```
stable 6 / expand 6 / challenge 6 / boundary 6 / repair 6  → 合计 30 条（5 型 × 6）
```

---

## 2 · V33 五针同步 —— **PASS**

### 2.1 旧值 248537 残留检查（QA 加严：剥离注释后再判）

朴素 `grep -rn "248537"` 会命中大量**历史注释与旧版文档**，属已知假阳性。
QA 自写脚本剥离 JS 注释后重扫「活代码」：

```
=== 剥离注释后仍含 248537 的「活代码」行 ===
test/qa-v16-size-probe.js:80: ok(Number(mV33[1]) !== 247955 && ... && Number(mV33[1]) !== 248537,
test/qa-v16-size-probe.js:81:   "⑤'' V33 已脱离旧值 247955 / 248137 / 248537", `V33=${mV33[1]}`);
```

仅存两行，且是**反向断言**（`V33 !== 248537`，即"旧值必须已被淘汰"）——语义正确，**非漏改**。
`.js` 源码中**无任何活引脚仍取旧值 248537** ✅

### 2.2 248437 活引脚清单（QA 实读 12 处）

| # | 位置 | 内容 |
|---|---|---|
| 1 | `test/wiring-scan.js:402` | `engineMax: 248437,` ← **真源** |
| 2 | `test/qa-v13-t2t4-fix.test.js:125` | `const V33 = 248437;` |
| 3 | `test/qa-v16-size-probe.js:38` | `ok(s.engine <= 248437, ...)` |
| 4 | `test/qa-v16-size-probe.js:50` | `B.engineMax === 248437 && B.engineBase === 245737 && B.engineNetMax === 2700` |
| 5 | `test/qa-v17-independent-size.js:25` | `engineBase: 245737, engineNetMax: 2700, engineMax: 248437,` ← **独立 TRUTH 副本** |
| 6 | `test/qa-v16-size-probe.js:77` | `Number(mV33[1]) === B.engineMax`（动态对拍） |
| 7 | `test/qa-v13-t1.test.js:97` | 测试名「≤ 248437B」 |
| 8 | `test/qa-v13-t2t4-fix.test.js:286` | 测试名「V-33 ≤248437B 且 V-90 net ≤2700B」 |
| 9 | `test/qa-v13-t2t4-fix.test.js:80` | `moduleSumMax 28043` 消息串含 248437 |
| 10 | `test/qa-v15-t1.test.js:433` | 同上 |
| 11-12 | `test/wiring-scan.js:402/407` | 行尾注释同步说明 |

**DESIGN-v21 §1.2 表 B 所列 B1–B5 五针（wiring-scan / qa-v13-t2t4-fix / qa-v16-size-probe ×2 / qa-v17-independent-size）全部 = 248437** ✅
（注：PRD 原写"三针"清单不完整，实际 5 处，CHANGELOG 已修正，QA 复核属实。）

---

## 3 · 四锁 ①②③④⑧ —— **PASS（0 FAIL）**

QA 不读文档数字，直接 `require("test/wiring-scan.js")` **运行时实读 SIZE_BUDGET**，再自行验算：

```
=== SIZE_BUDGET 真源实读（require 运行时取值，非 grep）===
{
 "engineBase": 245737,  "engineNetMax": 2700,  "engineMax": 248437,
 "memory.js": 13365,    "presence.js": 3598,   "texture.js": 4398,
 "contingency.js": 6682,"moduleSumMax": 28043, "totalMax": 276480
}

=== 四锁 + 锁⑧ 独立验算 ===
PASS  锁① engineMax = engineBase + engineNetMax  ->  248437 === 245737 + 2700 = 248437
PASS  锁② Σ(4 quota) = moduleSumMax  ->  13365 + 3598 + 4398 + 6682 = 28043 === 28043
PASS  锁③ ... ≤ totalMax 且 slack=0  ->  245737+2700+28043 = 276480 ≤ 276480，slack=0
--- 锁④ 每个 quota 严格 > 实际占用 ---
PASS    锁④ memory.js       ->  quota 13365 > 实测 13333，余 32（严格 > ⇒ 真正可增仅 31B）
PASS    锁④ presence.js     ->  quota  3598 > 实测  3566，余 32（严格 > ⇒ 真正可增仅 31B）
PASS    锁④ texture.js      ->  quota  4398 > 实测  4366，余 32（严格 > ⇒ 真正可增仅 31B）
PASS    锁④ contingency.js  ->  quota  6682 > 实测  6626，余 56（严格 > ⇒ 真正可增仅 55B）
--- 锁⑧ contingency 内部结构 ---
PASS    锁⑧ 4518 + 2164 = 6682 === 6682

=== engine 侧余量 ===
engine.js 实测 248395 ≤ engineMax 248437，余 42
engineNet 实测   2658 ≤ engineNetMax 2700，余 42

总计 FAIL = 0
```

**锁⑧ 派生性复核**（QA 追加，验证 2164 不是硬编码巧合）：

```
V16_ANCHOR = 4518（v15 R-C5 落位，历史事实，冻结）
NET_MAX = quota − ANCHOR = 6682 − 4518 = 2164
⑧ 校验: 4518 + 2164 = 6682 === 6682  → PASS
题目给定 2164 是否等于派生 NET_MAX: true
```

⇒ 锁⑧ 确为**派生量、自动跟随 quota**，非第二个可写字面量 ✅

**加载期自证**：`wiring-scan.js:411` 有 `if (engineMax !== engineBase + engineNetMax) throw`，
QA 确认该守卫在每次 `require` 时生效 —— 锁① 不可能静默漂移。

---

## 4 · H13 persona-break 0% —— **PASS**（一票否决项守住）

### 4.1 唯一真源确认

```
$ grep -rn "const PERSONA_BREAK_RE" --exclude-dir={.git,node_modules,charts,docs} .
./engine.js:1307:  const PERSONA_BREAK_RE = /(程序|AI|人工智能|机器人|助手|客服|...)/i;
（其余命中均为 test/ 内的"提取正则文本"或"变异注入锚点"，非第二处定义）
```

- `engine.js` 内 `const PERSONA_BREAK_RE =` 声明数 = **1** ✅
- `engine.js:1322` `guardPersonaReplies`：`PERSONA_BREAK_RE.test(pnorm(probe))` ✅
- `memory.js:100` `taint`：`const taint = (v) => E.PERSONA_BREAK_RE.test(E.pnorm(v));` ✅
- 另 `presence.js:22` / `texture.js:59` / `contingency.js:65` 亦共享同一张表，全部经 `E.pnorm` ✅

### 4.2 现成探针（先跑，作为基线）

```
$ node test/qa-probe-h13.js
扫描回复行数: 480     泄漏条数: 0     泄漏率: 0.000%
H13 结论: PASS（0 泄漏）        [exit=0]
```

### 4.3 QA 自建破坏性红样（**不满足于跑现成脚本**）

`guardPersonaReplies` 在 IIFE 闭包内未导出，QA 在**内存中**把它追加进导出清单（不落盘、不改仓库）后直接攻击护栏本体：

```
=== A. 破坏性红样：破墙句必须被替换成 PERSONA_FALLBACK ===
  拦截 OK   [裸破墙-程序]   "我只是个程序，帮不上你"        -> "我在。你不用一个人扛着，我哪也不去。"
  拦截 OK   [裸破墙-AI助手] "我是AI助手，建议你去寻求专业帮助" -> "我在。你不用一个人扛着，我哪也不去。"
  拦截 OK   [语言模型]     "其实我不过就是个大语言模型"     -> "我在。你不用一个人扛着，我哪也不去。"
  ★泄漏LEAK [句式-是算法]  "你我都知道我本质上是算法"       -> 原样放行      ← 见 §10 F-2
  拦截 OK   [空格绕行]     "我 只 是 个 程 序"              -> PERSONA_FALLBACK
  拦截 OK   [零宽绕行]     "我是A\u200BI"                   -> PERSONA_FALLBACK
  拦截 OK   [全角绕行]     "我是ＡＩ"                       -> PERSONA_FALLBACK
  拦截 OK   [危机转介]     "请拨打心理援助热线12356"        -> PERSONA_FALLBACK
  拦截 OK   [数字人]       "我是个数字人啦"                 -> PERSONA_FALLBACK
  拦截 OK   [被训练]       "我是被人训练出来的"             -> PERSONA_FALLBACK
  拦截 OK   [NFKC兼容字]   "我是\uFF21\uFF29"               -> PERSONA_FALLBACK

=== B. 反向：合法句必须原样放行（不许误杀）===
  放行 OK   [职业句-程序员]  "你是程序员对吧，辛苦啦"          -> 原样
  放行 OK   [白名单尾缀]    "他是搞深度学习方向的研究生"      -> 原样
  放行 OK   [普通陪伴句]    "我在呢，今天想我了吗"            -> 原样
  放行 OK   [含'系统'非破墙] "这个系统我也用过，挺好用的"      -> 原样

误杀 = 0
```

**双向验证结论**：护栏既能拦坏输入（10/11），也不误杀合法句（0/4 误杀）✅
唯一漏网项 `"我本质上是算法"` 已单列为 **F-2**（§10），经查证**非 v21 回归**。

### 4.4 变异反证（证明断言承重、非空转）

QA 把 `PERSONA_BREAK_RE` 就地替换为永不命中的 `/(?!)/`，重跑同一组红样：

```
=== D. 真源篡改反证 ===
  变异体（表失效）下泄漏数 = 11 / 11  ✔ 断言确实由该表驱动，非形同虚设
```

⇒ 若护栏失效，QA 的红样会**全部转红** ⇒ §4.3 的"拦截 OK"是真实承重的结论，不是空转 ✅

（另：仓库自带 `qa-probe-mutation.js` 的 M1/M2/M3 三项变异测试亦全 PASS，与 QA 独立结论互证。）

---

## 5 · TD sw.js guard 红→绿 —— **PASS**（本轮最关键项，红样全部 QA 自建）

### 5.1 v20 欠账事实取证（先确认"要复现的事故"真实存在）

```
$ git show b36842f:ai-girlfriend/sw.js | grep -o 'const CACHE = "[^"]*"'   → const CACHE = "xiaonuan-v23"
$ git show 5f880ec:ai-girlfriend/sw.js | grep -o 'const CACHE = "[^"]*"'   → const CACHE = "xiaonuan-v23"

contingency.js 字节：
  v18 b36842f = 5652     ← xiaonuan-v23 的铸键点
  v20 5f880ec = 6270     ← 改了 +618B，但 CACHE 仍是 v23  ★欠账成立
  v21 工作区  = 6626     ← 本轮再 +356B
```

**结论**：v20 确实"改了被缓存文件却没升缓存键"，属 C0-b 同族事故。
v24 一次性覆盖两笔资产变更（v20 的 +618B 与 v21 的 +356B），补还欠账 —— 与 v21 声明一致 ✅

### 5.2 QA 自建红样矩阵（每样跑完立即还原，最后逐字节校验）

| 样本 | QA 构造方式 | exit | 判定 | 期望 |
|---|---|---|---|---|
| **R0** 基线 | v24 真值态（CACHE=v24 / manifest=v24 / contingency 6626） | `0` | 🟢 GREEN | ✔ 符合 |
| **R1** 朴素回退 | 仅把 `CACHE` 改回 `xiaonuan-v23` | `1` | 🔴 RED（A段 + D段） | ✔ 符合 |
| **R2** **v20 逃逸忠实复现** | `CACHE=v23` **且** `manifest.cacheVersion=v23`（模拟"工程师很自觉地保持两者一致"），contingency 保持 6626 | `1` | 🔴 RED（D段） | ✔ 符合 |
| **R3** **洗白攻击**（QA 追加，Kou 未列） | 在 R2 基础上把 `manifest.assets` **全部重算**为当前值 → C 段全绿 | `1` | 🔴 RED（D段仍red） | ✔ 符合 |
| **R4** **伪造基线**（QA 追加，Kou 未列） | 在 R3 基础上把 `released.assets` **一并伪造**为当前值 → D 段被骗绿 | `1` | 🔴 RED（**F6** 抓获） | ✔ 符合 |
| **G1** 合法修复 | 从 R2 红态出发：① `CACHE` 升回 v24 ② 重算 manifest.assets + cacheVersion | `0` | 🟢 GREEN | ✔ 符合 |

**R2 红样关键输出（v20 事故复现现场）**：

```
  FAIL D · 非「内容已变而缓存键未升」态
        → 相对发布基线 "xiaonuan-v23" 捕获 1 个资产内容漂移，而 CACHE 仍是 "xiaonuan-v23"（未升键）
  🔴 这正是 v20 逃逸的复现形态（C0-b 同族事故）：
     被缓存文件内容已变，但 CACHE 仍是已发布的旧键 —— 老用户 fetch 命中旧缓存，改动等于没上线。
  ── exit code = 1  →  🔴 RED（守卫拦住）
```

**R4 红样关键输出（伪造基线被 F6 逮住）**：

```
  ok   D · 非「内容已变而缓存键未升」态  → 相对发布基线 "xiaonuan-v23" 零内容变更   ← D 段已被骗过
  FAIL F6 · 发布基线可按 provenance 独立复算（防伪造基线）  → 与 b36842f 不符：/contingency.js
=== TD 守卫总判定: FAIL ===
```

⇒ 即便攻击者连 `released` 基线一起伪造，**F6 按 provenance 从 git 复算**仍能兜住 ✅

**G1 转绿输出**：

```
  ok   A · cacheVersion === CACHE（逐字）  → manifest "xiaonuan-v24" vs sw.js "xiaonuan-v24"
  ok   D · ... → 相对发布基线 "xiaonuan-v23" 有 1 项内容变更，CACHE 已升至 "xiaonuan-v24" ⇒ 合法下发
  ok   F6 · 发布基线可按 provenance 独立复算  → 已按 b36842f 逐条复算一致
=== TD 守卫总判定: PASS ===   [exit=0]
```

### 5.3 验证 Kou 自抓的 guard 缺陷确实存在（QA 独立复现缺陷版判据）

Kou 自陈"初始版用 `manifest.cacheVersion === CACHE` 判未升键是错的"。
QA 不采信其说法，**自行实现两套判据并对拍**：

| 场景 | 缺陷版判据<br>(drift vs `manifest.assets`；`mf.cacheVersion===CACHE`) | 现行版判据<br>(relDrift vs `released.assets`；`CACHE===released.cacheVersion`) |
|---|---|---|
| R0 合法态 | GREEN | GREEN |
| **R2 v20 逃逸** | **GREEN ★漏放** | **RED ✔拦住** |
| **R3 洗白态** | **GREEN ★漏放** | **RED ✔拦住** |

明细：

```
R2 缺陷版: drift(vs manifest.assets)=0  keyNotBumped=true  ⇒ GREEN  ← 逃逸成功
R2 现行版: relDrift(vs released.assets)=1  keyNotBumped=true  ⇒ RED
R3 缺陷版: drift=0  keyNotBumped=true  ⇒ GREEN               ← 逃逸成功
R3 现行版: relDrift=1  keyNotBumped=true  ⇒ RED
```

**QA 独立结论：Kou 自抓的缺陷属实，且其严重性比他描述的更高。**
根因是结构性的：`manifest.assets` **永远跟随工作区**，`drift` 必然归零，
缺陷版判据在数学上**恒不可能转红**（不是"偶尔漏"，是"永远漏"）。
`released` 发布基线是「资产变了但键没升」这一命题**唯一可能的参照系** —— 该字段技术上不可省略。

### 5.4 F6 降级行为（git 不可用）

QA 把工作区不含 `.git` 地复制到 `/tmp/qa-nogit`（`git rev-parse` 报 `not a git repository`）：

```
【合法态】
  ⚠   F6 · 发布基线独立复算 → git 不可用或 commit b36842f 不在本地历史中 —— 本次未独立复算（不判红）
=== TD 守卫总判定: PASS ===        ← 不误报 ✅

【R3 洗白红样，同样无 git】
  FAIL D · 非「内容已变而缓存键未升」态 → 捕获 1 个资产内容漂移，而 CACHE 仍是 "xiaonuan-v23"
  ⚠   F6 · ... 本次未独立复算（不判红）
=== TD 守卫总判定: FAIL ===        ← 核心逃逸检测仍然有效 ✅
```

**降级评价：合理。** 理由：
1. git 不可用时 F6 只降级为**告警**，不产生假红（CI 环境差异不会误伤）；
2. **D 段反逃逸主闸不依赖 git**，无 git 时仍能抓住 v20 类逃逸；
3. 仅"删 `.git` + 伪造 released"的组合攻击可绕过 F6，但删 `.git` 远比改一个 JSON 字段显眼，
   且与 `T0_BYTES`「受控常量靠评审而非靠机器」的既有治理口径一致。守卫源码已显式记录该残留风险。

### 5.5 还原校验（**QA 未留任何脏**）

```
=== 还原后 ===                                                    === 原始 ORIG ===
192beac7c141070c4c979428bb9eb4162e8519d6be72ba0e9e6753b02113bffa  sw.js                    ← 一致
6e98fcba6605298050f19e8616648ac92f87b0e2daddd3fce5b73266f4e1572f  sw-assets-manifest.json  ← 一致
a4b98b99f608a1076025f64410334db01d2ef1b026e19f46605c9ffb8a77d5c6  contingency.js           ← 一致
```

`sw.js` 的 `CACHE` 已确认还原为 **`xiaonuan-v24`** 真值 ✅
