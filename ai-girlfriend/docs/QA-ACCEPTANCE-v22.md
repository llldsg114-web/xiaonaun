# QA-ACCEPTANCE-v22 · 独立验收报告

> **验收人**：严过关（Yan）· QA 工程师
> **验收对象**：v22（配额重谈 / H13 覆盖闭合 / repair 路由启用 / sw.js v25）
> **验收性质**：**独立验收**。本报告全部结论由 QA 在沙箱中亲手复现取证，
> **不复述、不采信** 工程师寇豆码（Kou）的自检结论与 `docs/v22-evidence-pack.md` 的任何断言。
> 凡涉及护栏，一律先自建"红样"证其能拦坏输入、再证其不误伤好输入；
> 凡涉及测试，一律用变异（mutation）证其**承重**，而非只看它报绿。
> **仓库路径校正**：git root 实为 `/workspace`，项目在 `/workspace/ai-girlfriend`，
> 故所有 git 命令均以 `ai-girlfriend/` 为路径前缀执行。

---

## 0. 验收结论

### **PASS-with-flag（有保留通过）**

v22 的**已批准变更范围**（配额重谈、四锁、repair 路由、AC-RS2-9 假绿修复、sw.js 升键）
**全部达标且经变异验证承重**，可以放行收线。

但 QA 独立取证发现 **2 项须追认的遗留缺口**，均**不属 v22 引入的回归**
（v21 同样存在），但其中 QA-FIND-2 直接影响"H13 已闭合"这一表述的准确性：

| 编号 | 摘要 | 级别 | 是否阻断 v22 收线 |
|---|---|---|---|
| **QA-FIND-2** | `PERSONA_BREAK_RE` 的连接词枚举被置于**人称绑定组内部**，导致中文**主语省略句**（"说白了就是代码堆出来的"）仍全量漏网 | **中**（护栏纵深缺口，非当前可触发泄漏） | 否，但**"H13 已闭合"的措辞必须降级为"H13 有主语形态已闭合"** |
| **QA-FIND-3** | `qa-v21-sw-guard.js` 对 `(released, current]` 区间内的 stale 缓存键**不敏感**：CACHE=v24 且资产已变时守卫仍报 PASS | **低**（守卫核心 C0-b 检测正常，此为参照系局限） | 否，需记入已知限制 |

**放行建议**：v22 可收线；QA-FIND-2 / QA-FIND-3 转 v23 待办，且**必须在 CHANGELOG 与
对外口播中把"H13 闭合"改述为"H13 人称自曝形态闭合"**，不得沿用"闭合"的无限定表述。

---

## 1. 测试通过率总表

| 套件 | 命令 | 结果 | 判定 |
|---|---|---|---|
| 全量单测 | `npm test` | **351 pass / 0 fail**（tests 351 / suites 1 / duration ≈ 11.0s） | ✅ PASS |
| 探针全量 | `npm run test:probe` | **9/9 全 PASS** | ✅ PASS |
| 探针快通道 | `npm run test:probe:fast` | H13 **泄漏条数 0 / 泄漏率 0.000%**；adversarial PASS | ✅ PASS |
| 接线扫描 | `node test/wiring-scan.js` | exit **0** | ✅ PASS |
| 配额门禁 | `node test/qa-v19-quota-gate.js` | `=== 配额门禁总判定: PASS ===` exit 0 | ✅ PASS |
| 天花板演练 | `npm run test:ceiling-drill` | `=== 天花板演练总判定: PASS ===` + 自清理取证 | ✅ PASS |
| TD 守卫 | `node test/qa-v21-sw-guard.js` | `=== TD 守卫总判定: PASS ===` | ✅ PASS（含 FIND-3 限制） |

**QA 自建台架（不在仓库内，落在 `/tmp/qa-yan/`，不污染仓库）**：

| 台架 | 用途 | 结果 |
|---|---|---|
| `h13-ab.js` | v21/v22 双引擎 A/B 红样对照 | 红样 21 条 / 良性 13 条，**发现 1 条未拦** |
| `gap-charac.js` | H13 残留缺口边界穷举刻画 | 280 组合，定位缺口成因 |
| `reach.js` | 缺口在三个消费点的可达性 | 三点全放行 |
| `repair-fuzz.js` | repair 路由 10 万次 fuzz + 全枚举 | 全绿 |
| `sw-guard-matrix.sh` | TD 守卫检测边界 6 场景矩阵 | 4 红 2 绿，定位 FIND-3 |
| `fix-candidate.js` / `fix-b.js` | QA-FIND-2 候选补丁的误伤与字节成本实测 | 供架构裁定 |

---

## 2. 清单 1 · 零预算封顶（字节零改动验证）—— ✅ PASS

**QA 执行命令**：

```bash
cd /workspace && git diff HEAD --stat -- ai-girlfriend/{engine,memory,presence,texture,contingency,sw}.js
git diff HEAD --numstat -- ai-girlfriend/{engine,contingency,sw}.js
git diff HEAD -U0 -- ... | grep -E '^@@'
for f in memory.js presence.js texture.js; do git show HEAD:ai-girlfriend/$f | cmp -s - ai-girlfriend/$f; done
```

**关键输出**：

```
 ai-girlfriend/contingency.js | 2 +-
 ai-girlfriend/engine.js      | 2 +-
 ai-girlfriend/sw.js          | 2 +-
 3 files changed, 3 insertions(+), 3 deletions(-)
```

memory.js / presence.js / texture.js **根本没有出现在 diff 中**。

**改动行号精确定位（`git diff -U0`）**：

```
+++ b/ai-girlfriend/engine.js        @@ -1307 +1307 @@
+++ b/ai-girlfriend/contingency.js   @@ -34   +34   @@
+++ b/ai-girlfriend/sw.js            @@ -2    +2    @@
```

**字节核对表（HEAD → 工作区）**：

| 文件 | HEAD | 当前 | Δ | 期望 Δ | 判定 |
|---|---|---|---|---|---|
| `engine.js` | 248395 | **248436** | **+41** | +41 | ✅ |
| `contingency.js` | 6626 | **6664** | **+38** | +38 | ✅ |
| `memory.js` | 13333 | 13333 | **0** | 0 | ✅ |
| `presence.js` | 3566 | 3566 | **0** | 0 | ✅ |
| `texture.js` | 4366 | 4366 | **0** | 0 | ✅ |
| `sw.js` | 5816 | 7267 | +1451 | 仅 CACHE 行 | ✅ 见下 |

**QA 加严复核（不满足于"大小相同"）**：三个零改动模块用 `cmp` 与 HEAD **逐字节**比对：

```
  memory.js    逐字节相同 OK
  presence.js  逐字节相同 OK
  texture.js   逐字节相同 OK
```

**关于 sw.js 的 +1451B —— QA 追查说明**：
初看 "1 行改动却涨 1451 字节" 可疑，故 QA 展开完整 diff 核实：sw.js 第 2 行是
`const CACHE = "xiaonuan-vNN";` **加一条超长行尾注释**（历代收线叙述累积）。
本次仅该行被替换，v22 追加的收线说明全部落在**同一行的行内注释**中，
**行数 81 → 81 不变**，且 `sw.js` 按口径不计入 engine+四模块体积预算，**不消耗四锁额度**。
结论：符合"仅 CACHE 行"约束，非违规。

> **QA 结论**：解冻点纪律严格遵守。engine.js 只动 `:1307`、contingency.js 只动 `:34`、
> 三数据模块逐字节冻结。**PASS**。

---

## 3. 清单 2 · V33 全针同步 —— ✅ PASS

**方法学说明**：任务书要求"全仓 grep 248437 应为空（注释除外）"。
QA 首次执行时踩到 **zsh 把 `--include=*.js` 当 glob 展开**的坑（报
`no matches found`，结果假空），已识别并改用 ripgrep 工具重做，此处记录以防他人复用错误命令。

**QA 执行命令（DESIGN §5 T-v33 指定口径，排除注释行）**：

```bash
grep -rnE '\b(248437|2700|2658|248395|571|28043|13365|3598|4398)\b' test/ \
  | grep -v '^[^:]*:[0-9]*: *[/*]'
```

**输出：空**（活代码中旧值族计数 = 0）✅

`docs/` 中 `248437` 仍有 9 个文件命中，全部为**历史交付记录**
（PRD-v18/v21、DESIGN-v21、CHANGELOG、QA-ACCEPTANCE-v21 等），
按 DESIGN-v22 §5 的裁定属**不得篡改的审计链**，QA 认可其豁免。

**新值落位统计（`grep -rl … test/ | wc -l`）**：

| 值 | 含义 | 命中文件数 |
|---|---|---|
| `248477` | engineMax / V33 | **7**（与 PRD G-4 的"七文件"口径吻合） |
| `2740` | engineNetMax | 11 |
| `28003` | moduleSumMax | 6 |
| `2699` | engine 实测净增 | 8 |
| `248436` | engine.js 实测落位 | 1 |
| `6664` | contingency 实测落位 | 3 |
| `13352` / `3585` / `4384` | 三模块配额 | 5 / 5 / 5 |
| `612` | 累计净增会计 | 1 |

**QA 实读的活引脚清单（逐条打开确认，非 grep 计数）**：

| # | 位置 | 活值 |
|---|---|---|
| 1 | `test/wiring-scan.js:438` | `engineNetMax: 2740` ← **真源** |
| 2 | `test/wiring-scan.js:439` | `engineMax: 248477` ← **派生真源** |
| 3 | `test/wiring-scan.js:444` | `moduleSumMax: 28003` |
| 4 | `test/wiring-scan.js:445` | `totalMax: 276480`（未抬顶） |
| 5 | `test/qa-v17-independent-size.js:31` | `engineBase: 245737, engineNetMax: 2740, engineMax: 248477` ← **独立 TRUTH 副本** |
| 6 | `test/qa-v17-independent-size.js:33` | `moduleSumMax: 28003, totalMax: 276480` |
| 7 | `test/qa-v16-size-probe.js:38` | `s.engine <= 248477` |
| 8 | `test/qa-v16-size-probe.js:45/46` | `engineNet <= 2740` / `moduleSum <= 28003` |
| 9 | `test/qa-v16-size-probe.js:52` | `engineMax===248477 && engineBase===245737 && engineNetMax===2740` |
| 10 | `test/qa-v16-size-probe.js:58/71/79` | `quotaSum===28003` / 四配额落位 / `V33===engineMax` |
| 11 | `test/qa-v13-t2t4-fix.test.js:74/83/84` | 标题与断言：`moduleSumMax 28003` / `engineNetMax 2740` |
| 12 | `test/qa-v13-t2t4-fix.test.js:137` | `const V33 = 248477;` |
| 13 | `test/qa-v13-t2t4-fix.test.js:298` | 标题 `V-33 ≤248477B 且 V-90 net ≤2740B` |
| 14 | `test/qa-v15-t1.test.js:435/436/437` | `moduleSumMax 28003` / `totalMax 276480` / `engineNetMax 2740` |
| 15 | `test/qa-v13-t1.test.js:100` | 标题 `engine.js 字节数 ≤ 248477B` |
| 16 | `test/qa-v19-quota-gate.js:150` | `MODULE_SUM_WITNESS = 28003` ← **锁② 第二证人** |

`node test/wiring-scan.js` → **exit 0**（静默即通过，加载期自证未抛异常）。

> **QA 结论**：**PASS**。含第二证人 `MODULE_SUM_WITNESS` 在内的 16 处活引脚全部同步，无漏改。

---

## 4. 清单 3 · 四锁 ①②③④⑧ —— ✅ PASS

**QA 执行**：`node test/qa-v19-quota-gate.js`（原样输出，未加工）

```
--- B. diff=0 硬闸（实测字节 must === T0 基线）---
  ok   memory.js 字节 === 基线       → 实测 13333 / 基线 13333 / Δ+0
  ok   presence.js 字节 === 基线     → 实测  3566 / 基线  3566 / Δ+0
  ok   texture.js 字节 === 基线      → 实测  4366 / 基线  4366 / Δ+0
  ok   contingency.js 字节 === 基线  → 实测  6664 / 基线  6664 / Δ+0

--- C. 四锁 ①②③④ + ⑧ 自证 ---
  ok   ① engineMax = engineBase + engineNetMax      → 248477 === 245737 + 2740
  ok   ② Σ(4 模块配额) === moduleSumMax              → 28003 === 28003（受控见证值 28003）
  ok   ③ engineBase+engineNetMax+moduleSumMax === totalMax（slack=0）
                                                     → 276480 === 276480（松弛 0）
  ok   ④ 逐模块配额 > 基线（配额不倒挂）
                                → 13352>13333 / 3585>3566 / 4384>4366 / 6682>6664
  ok   ⑧ V16_ANCHOR + NET_MAX ≡ SIZE_BUDGET[contingency.js] → 4518 + 2164 = 6682 === 6682

--- D. 单一真源回归扫描 ---
  ok   全目录断言性行中，平行字面量 5671/1180/2064 计数 = 0  → 扫描 40 文件，0 违规
  ok   D 段非空转：已扫描 40 个文件（其中 32 个含断言行）
  ok   元测试 · 门禁自指：扫描自身命中 = 0
  ok   豁免清单无腐化：EXEMPT 出厂为空（0 项）

--- E. 真实缓冲 ---
  memory.js        13333 / 配额  13352   余   19
  presence.js       3566 / 配额   3585   余   19
  texture.js        4366 / 配额   4384   余   18
  contingency.js    6664 / 配额   6682   余   18
  （派生）NET_MAX     2164 = 配额 6682 − 锚点 4518
  engine.js(净增)    2699 / 上限   2740   余   41
  Σ 四模块             27929 / 上限  28003   余   74
  总量                276365 / 上限 276480   余  115

=== 配额门禁总判定: PASS ===   (exit 0)
```

**QA 独立手算复核（不采信门禁自报）**：

| 锁 | 等式 | QA 手算 | 判定 |
|---|---|---|---|
| ① | `engineMax = engineBase + engineNetMax` | 245737 + 2740 = **248477** ✓ | ✅ |
| ② | `Σ(4 quota) = moduleSumMax` | 13352+3585 = 16937；+4384 = 21321；+6682 = **28003** ✓ | ✅ |
| ③ | `base+net+moduleSum ≤ totalMax`，slack=0 | 245737+2740+28003 = **276480** = 276480，**slack = 0** ✓ | ✅ |
| ④ | 每 quota > 实测（**严格 >**） | 13352>13333(余19) / 3585>3566(余19) / 4384>4366(余18) / 6682>6664(余18) ✓ | ✅ |
| ⑧ | `V16_ANCHOR + NET_MAX ≡ contingency 配额` | 4518 + 2164 = **6682** ✓ | ✅ |

三模块回让会计复核：13365−13352 = **13**、3598−3585 = **13**、4398−4384 = **14**，
Σ = **40** = engineNetMax 的 2700→2740 增量 ✓，contingency 配额 6682 **逐位不动** ✓。

> **QA 结论**：**PASS**。五把锁全部成立，slack 严格为 0，totalMax 276480 未抬顶。

---

## 5. 清单 4 · H13 0% + 闭合有效性 —— ⚠️ **PASS-with-flag（发现 QA-FIND-2）**

这是本次验收投入最大、也是**唯一发现实质缺口**的一项。

### 5.1 官方探针：0 泄漏 ✅

```
── test/qa-probe-h13.js
泄漏条数: 0
泄漏率: 0.000%
H13 结论: PASS（0 泄漏）
```

`test:probe` 中 `qa-v22-h13-closure.js` 亦报 `H13 闭合结论: PASS`（红样 12/12、良性 14/14）。

**但 QA 不接受"跑了 Kou 的脚本得到 PASS"作为闭合证据**，遂自建红样台架。

### 5.2 QA 自建红样 A/B 台架（`/tmp/qa-yan/h13-ab.js`）

**方法**：把 HEAD（v21，engine.js 248395B）导出到 `/tmp/qa-yan/v21/`，
与工作区（v22，248436B）**同时加载为两个引擎实例**，用**同一批 QA 自造样本**分别打靶。
样本刻意**不复用** Kou 的任何一条，含任务书点名三句 + QA 追加的换人称 / 副词叠加 /
动词换 算·当·作为 / 英文技术词 / **零宽字符插入** 等 21 条红样、13 条良性。

**【A】v21 打靶结果 —— 复现 QA-FIND-1**：

```
  ★泄漏  "我本质上是算法"
  ★泄漏  "说白了就是代码堆出来的"
  ★泄漏  "你本质上是算法罢了"
  ★泄漏  "咱本质上就是个模型啊"
  ★泄漏  "它归根结底是个对话系统"
  ★泄漏  "她说白了也就是个bot"
  ★泄漏  "我本质上都是算法"        ★泄漏  "我归根结底也就是代码"
  ★泄漏  "我说白了还只是模型"      ★泄漏  "我从本质上讲就是神经网络"
  ★泄漏  "我本质上是GPT"           ★泄漏  "我归根结底是LLM"
  ★泄漏  "我本​质上是算​法"（含零宽）  ★泄漏  "我归根﻿结底是代码"（含 BOM）
  ...
  v21 泄漏 18/21 条 —— 这就是 QA-FIND-1 的实证
```

> 说明：其中 `"归根结底我只是段程序"` 在 v21 即被拦，因其含基础禁词 `我只是`；
> `"您从本质上讲是语言模型"` 含 `语言模型`；`"我归根结底当的是客服"` 含 `客服`。
> QA 保留这 3 条作为**对照组**，证明台架不是靠"全都拦不住"来制造对比。

**【B】v22 打靶结果**：

```
  红样：20/21 拦截      —— 1 条 MISS
  MISS hit=放行  "说白了就是代码堆出来的"     ← ★ 任务书点名的第 3 句
  良性：13/13 全部放行  —— 0 误伤
```

**【C】v21 良性对照**：13/13 放行、0 误伤 —— 证明 v22 **不是靠"一刀切收紧"**换取红样通过，
收紧是精准的。

### 5.3 QA-FIND-2 · 缺口根因与边界刻画（`/tmp/qa-yan/gap-charac.js`）

**根因**：v22 把三个新连接词追加进了 `PERSONA_BREAK_RE` 的**人称绑定组内部**：

```js
[你我咱它他她您]们?(?: … |从?本质上讲?|归根结底|说白了)?[都也还只就]{0,2}(?:[是算当]|作为).{0,8}(算法|代码|…)
^^^^^^^^^^^^^^^^^^ 人称是【必需】的
```

因此**中文极常见的主语省略句**（"说白了就是代码堆出来的"）因缺少人称前缀而整体不匹配。

**穷举刻画（280 组合 = 4 连接词 × 10 技术名词 × 形态）**：

| 形态 | 拦截 | 泄漏 | 说明 |
|---|---|---|---|
| A 有主语（`我本质上就是算法`） | **40** | **0** | v22 目标形态，已闭合 ✅ |
| B 省主语（`本质上就是算法`） | 0 | **200** | ★ 全量泄漏 |
| C 省主语+尾缀（`本质上就是算法堆出来的`） | 0 | **40** | ★ 全量泄漏 |

**成因确证（补一个人称即被拦）**：

```
  ★泄漏  说白了就是代码堆出来的
  拦截    我说白了就是代码堆出来的     ← 仅多一个「我」
  ★泄漏  归根结底是个模型
  拦截    我归根结底是个模型           ← 仅多一个「我」
```

### 5.4 可达性实测（`/tmp/qa-yan/reach.js`）—— 定级依据

QA 逐一验证省主语破墙句在**三个消费点**的表现：

| 消费点 | 位置 | 省主语句 | 有主语句（对照） |
|---|---|---|---|
| engine 出口网 `guardPersonaReplies` | `engine.js:1322` | **★放行** | 拦截 |
| `memory.taint()` 入口闸 | `memory.js:100` | **★入库（可被回声）** | 静音 |
| `innerGuard()` | `engine.js:1393` | **★原样返回** | 返回 `null` |

**三道消费点全部放行** ⇒ 该缺口在护栏层是**真实存在**的，不是理论问题。

**但严重级定为「中」而非「高」，依据如下**：
1. 端到端 `qa-probe-h13.js` 仍为 **0 泄漏** —— 她的回复由**固定语料表**生成，
   语料中不存在此类句式，故当前**无法自发产出**该串；
2. 该缺口 **v21 即存在**，**不是 v22 引入的回归**；
3. 风险路径是"用户注入 → 事实入库 → weave 回声"这类间接链路，需多步巧合。

### 5.5 对 Kou 闭合测试的方法学审查

QA 通读 `test/qa-v22-h13-closure.js`：**12 条红样（`:19-31`）全部带显式人称主语**
（`你就是个程序` / `我本质上是算法` / …），14 条良性中虽有 3 条省主语句
（`归根结底还是要看你自己开心` 等）但**均不含技术名词**，因此**无论正则是否覆盖省主语形态，
该测试都会报绿**。

> **这是"测到了实现、没测到需求"的典型盲区**：测试用例是照着补丁的形状写的，
> 而不是照着"H13 破墙 0%"这条需求写的。建议 v23 在该文件补入省主语形态红样，
> 使其具备发现本缺口的能力。

### 5.6 修复方向可行性实测（QA 附加取证，供架构裁定）

QA 不越权实现，但实测了两个候选，给出预算结论（engine 现余 **41B**）：

| 候选 | 改法 | 字节 | 省主语拦截 | 原有红样回退 | 良性误伤 | 结论 |
|---|---|---|---|---|---|---|
| **A** | 人称改可省 `[你我咱它他她您]?们?` | **+1B** | 6/6 ✅ | 无 | **9/20 ★** | ❌ 不可用 |
| **B** | 人称可省 + **省人称时连接词必现**（追加独立分支） | **+49B** | 5/6 | 无 | **0/20** ✅ | ⚠ **超预算 8B** |

候选 A 的误伤实例（说明"加个 `?` 就完事"是错的）：

```
    ★误伤: 我今天读的是算法导论      ★误伤: 我买的是模型飞机
    ★误伤: 他玩的是乐高模型          ★误伤: 我看的是代码规范手册
    ★误伤: 她做的是app运营           ★误伤: 今天的重点是代码评审
```

> **QA 给架构师的结论**：本缺口**在 41B 预算内无零误伤解**（候选 B 需 49B）。
> v23 若要闭合，须**重新谈判 engine 配额**（约需再回让 ≥8B）或采用更紧凑的正则重构。
> **不建议在 v22 内临时打补丁** —— 会撞穿四锁。

### 5.7 本项判定

| 子项 | 判定 |
|---|---|
| H13 端到端 0% 泄漏 | ✅ PASS |
| 有主语形态闭合（QA-FIND-1 主体） | ✅ PASS（QA 自建 18 条 v21 泄漏样本，v22 全拦） |
| 良性零误伤 | ✅ PASS（QA 13 条 + Kou 14 条，均 0 误伤） |
| 任务书点名的「说白了就是代码堆出来的」被拦 | ❌ **FAIL** |
| 省主语形态整体闭合 | ❌ **FAIL（QA-FIND-2，240/240 泄漏）** |

> **QA 结论**：**PASS-with-flag**。v22 声称的改动确实生效且精准，
> 但"H13 闭合"这一表述**过宽**，必须限定为"人称自曝形态闭合"。

---

## 6. 清单 5 · repair 路由（P0-3）—— ✅ PASS

### 6.1 被测实现（QA 实读 `contingency.js:33-35`）

```js
const sfType=(s,c,u)=>{const S=E.selfGet(s),v=N(c.lv,0),p=PL(c,u);
 return S.security<.5?p<0?"boundary":O(s.negGate).count>0?"repair":"stable":S.independence>=.55&&v>=5&&p>=0?"challenge"
  :S.openness>=.5&&String(u).length>19?"expand":"stable";};
```

**QA 首轮阅读即注意到一处结构性行为迁移**（并非笔误，须确认是否有意）：
v21 的 `S.security<.5 && p<0 ? "boundary" : …` 是**合取短路**，
低安全 + 正极性会**继续下落**到 challenge/expand 链；
v22 改为**嵌套三元**后，`security<.5` 一旦成立就**不再有机会**到达 challenge/expand。

QA 查证 `DESIGN-v22.md:329`，架构师已明确记载：

> 「启用前落在 `security<.5 && p>=0` 的组合原会流向 challenge/expand/stable；
> 启用后其中**仅「当日有负面事件」的子集**改判 repair，**其余仍回 `stable`**
> （不是 challenge——这是方案 E 相对 PM 原案的关键收紧：宁可回落 stable，也不让道歉外溢）。」

⇒ **属已批准的有意收紧，不是回归**。QA 认可，但记为"低安全用户不再触发 challenge/expand"
的行为变更，建议 PM 知悉。

### 6.2 QA 自建 fuzz 台架（`/tmp/qa-yan/repair-fuzz.js`）

**刻意不复用 Kou 的 `base()` 工厂** —— QA 自造 state 工厂 `S(sec, ind, opn, negCount)`，
**默认就带 `negGate` 字段**，从结构上杜绝"忘了给 negGate 导致恒 false"这一 A-3 假绿根因。

**① 五型可达性（QA 自建构造）**

```
  ok   期望 boundary   实得 boundary
  ok   期望 repair     实得 repair
  ok   期望 stable     实得 stable
  ok   期望 challenge  实得 challenge
  ok   期望 expand     实得 expand
  五型覆盖: boundary, challenge, expand, repair, stable  (5/5)
```

**② 10 万次 fuzz —— repair 越界检测**（线性同余确定性随机，seed=20260810）

```
  样本 100000，类型分布:
    {"expand":10096,"boundary":29919,"stable":44233,"repair":11173,"challenge":4579}
  repair 命中 11173 次，其中 negGate.count===0 的越界 0 次   OK
```

> **五型在 10 万次随机中全部实际出现**（最少的 challenge 也有 4579 次），
> 证明五型不仅"构造得出"，在随机分布下也真实可达，无死枝。

**③ AC-3.6 全枚举 —— 无冲突绝不道歉**

```
  security∈[0,0.5) 步长 0.01 × independence{0,.3,.55,.9} × openness{0,.3,.5,.9}
  × lv{1,4,5,6,9} × ue 7 类 × 长短文本 2 种 = 56000 组，negGate.count=0
  repair 命中 0   OK
```

> QA 的扫描面（**56000 组**）比 Kou 探针的 1440 组宽 **38.9 倍**，
> 且 security 下探到 **0**（Kou 只扫 [0.45, 0.5)），仍然 0 命中。

**④ 有冲突时的接管率**

```
  security<.5 ∧ 极性>=0 ∧ negGate.count=1：1350/1350 判 repair（应为 100%）
```

> **QA 结论**：**PASS**。五型全可达、repair 严格受"当日冲突门"约束、
> 中性平静对话在 56000 组全枚举下**零误触**（AC-3.6 达标，不冒道歉）。

---

## 7. 清单 6 · AC-RS2-9 假绿已修 —— ✅ PASS（三重取证）

这是本轮**第二关键项**。QA 分三步取证，其中第 1 步是**历史假绿的实证复现**。

### 7.1 【实证一】v21 旧断言确为假绿 —— QA 亲手复现

**方法**：把 HEAD 版 `test/qa-rs2-type.test.js` 导出到隔离目录
`/tmp/qa-yan/v21test/`，将其 `ROOT` 重指向 `/workspace/ai-girlfriend`，
即：**用 v21 的旧断言，去测 v22 已经可达 repair 的生产代码**。

```bash
git show HEAD:ai-girlfriend/test/qa-rs2-type.test.js > /tmp/qa-yan/v21test/qa-rs2-type-HEAD.test.js
sed -i 's|const ROOT = path.join(__dirname, "..");|const ROOT = "/workspace/ai-girlfriend";|' ...
node --test qa-rs2-type-HEAD.test.js
```

**输出**：

```
# Subtest: AC-RS2-9 · repair 型语料就位（6 条 · 质量门全过）；选型层暂不可达（纯数据增补，记录不修）
ok 18 - AC-RS2-9 · repair 型语料就位（6 条 · 质量门全过）；选型层暂不可达（纯数据增补，记录不修）
# pass 18
# fail 0
```

> **假绿铁证**：测试标题白纸黑字写着**「选型层暂不可达」**，
> 而它正在测的生产代码 **repair 早已可达**，测试却报 `ok / pass 18 / fail 0`。
> 根因确如 DESIGN §0 A-3 所述：旧 `baseState` 不含 `negGate` 字段 ⇒
> `O(s.negGate).count` 恒 `undefined` ⇒ `> 0` 恒 false ⇒ 笛卡尔扫描 `hit===0` 恒成立。
> **QA 独立确认 A-3 的定性完全属实。**

### 7.2 【实证二】v22 改写后是**真正向断言**，且**承重**

仅仅"改成正向"还不够 —— **正向断言也可能写成永真式**。
QA 用**变异测试（mutation）**证明它真能转红：

**变异 M-1 · 把 `sfType` 回退成 v21 形态（摘除 repair 分支）**：

```js
// 注入的变异
 return S.security<.5&&p<0?"boundary":S.independence>=.55&&v>=5&&p>=0?"challenge"
```

```
not ok 18 - AC-RS2-9 · repair 路由可达：五型互不遮蔽 + 平静对话不冒道歉（AC-3.6 · 正向断言）
    security=.47 + 中性语气 + 当日有冲突 应走 repair
# pass 17
# fail 1
```

✅ **转红** —— 证明"repair 可达"这条断言承重。

**变异 M-2 · 摘除当日冲突门（即 PM 原 +8B 方案，A-2 被否决的那个）**：

```js
 return S.security<.5?p<0?"boundary":"repair":S.independence>=.55&&v>=5&&p>=0?"challenge"
```

```
not ok 18 - AC-RS2-9 · …
    无冲突的低安全态应回落 stable，不得误触 repair（A-2 平静对话冒道歉禁令）
# pass 17
# fail 1

（同时 Kou 的探针也转红，交叉验证）
五型可达性:   FAIL ["stable → repair"]
AC-3.6 平静对话冒道歉: 720/1440  FAIL
repair 路由结论: FAIL
```

✅ **转红** —— 证明"平静对话不冒道歉"这条断言同样承重，
且**实测出 720/1440 = 50% 的平静对话会冒道歉**，
从反面确证了架构师否决 PM 原案（A-2）的判断是正确的。

### 7.3 【实证三】QA 自建构造的正反双向验证

（见 §6.2）QA 用**自己的 state 工厂**独立复验：

| 构造 | 期望 | 实得 | 判定 |
|---|---|---|---|
| `baseState` 带 `negGate.count>0`（security .40，中性） | repair | **repair** | ✅ 可达性真成立 |
| 中性 state（`negGate.count=0`，security .40） | 非 repair | **stable** | ✅ 无泄漏 |
| 全枚举 56000 组 `count=0` | repair 命中 0 | **0** | ✅ 护栏未被绕过 |
| 全枚举 1350 组 `count=1` | 100% repair | **1350/1350** | ✅ 门确实在起作用 |

### 7.4 变异后还原核对

```
cp /tmp/qa-yan/contingency.js.v22bak contingency.js
md5: 13a1f1cd1d14d8201d51f692e827fa4d  （备份）
md5: 13a1f1cd1d14d8201d51f692e827fa4d  （还原后）   → 一致
git diff HEAD --numstat: 1  1  ai-girlfriend/contingency.js   → 仍是单行改动
```

> **QA 结论**：**PASS**。AC-RS2-9 已由假绿转为**真正向且承重**的断言 ——
> 这不是"看它报绿"得出的，而是**两次变异注入均成功转红**证明的。

---

## 8. 清单 7 · TD sw.js guard 红→绿 —— ⚠️ **PASS-with-flag（发现 QA-FIND-3）**

### 8.1 基线（v25 真值）：GREEN ✅

```
=== TD 守卫总判定: PASS ===
  sw.js CACHE           xiaonuan-v25
  manifest.cacheVersion xiaonuan-v25
  已发布基线            xiaonuan-v23（git b36842f，v18 收线提交）
  基线独立复算          已按 b36842f 逐条复算一致
  ASSETS 成员           13 项，已全部现算 sha256
  vs manifest 漂移      0 项
  vs 发布基线 漂移      2 项（/engine.js、/contingency.js —— 本轮真正要下发的内容）
```

**QA 独立复算资产指纹（不采信守卫自报，用 python hashlib 现算）**：

```
  /engine.js
    QA 现算   ab272002cfabd23f0db4b50a90b89595e93d22748501809292de1b3333d71079
    manifest  ab272002cfabd23f0db4b50a90b89595e93d22748501809292de1b3333d71079   一致 OK
    released  829acc93302f1823d82b0dc4100ea440bfa4bea81f0fcd593ff4085c148f2400   （与 v23 基线不同 = 本轮需下发）
  /contingency.js
    QA 现算   38aeafdc347a291a65db4d6d1f5e623e7613a908ff189552cc2de776dfaa6093
    manifest  38aeafdc347a291a65db4d6d1f5e623e7613a908ff189552cc2de776dfaa6093   一致 OK
    released  df13af95a58942084f41eb8a831736b71f9525f8e6fe9980bfaaac336237583e   （与 v23 基线不同 = 本轮需下发）
  released 块 cacheVersion: xiaonuan-v23  （C-2 纪律：逐字未动 ✅）
```

### 8.2 QA 自建红样矩阵（`/tmp/qa-yan/sw-guard-matrix.sh`）

任务书要求构造 "CACHE=v24 + 改后资产" 应转 RED。QA 执行后**结果与预期不符**，
遂扩展为 6 场景矩阵，完整刻画守卫的检测边界（资产始终保持 v22 改后内容）：

| 场景 | CACHE | manifest | rc | 判定 | 触发的 FAIL 项 |
|---|---|---|---|---|---|
| S1 v22 真值（基线） | v25 | v25 | 0 | PASS | — |
| **S2 任务书点名的 stale** | **v24** | **v24** | **0** | **PASS ★意外** | **无** |
| S3 = released 基线 | v23 | v23 | 1 | **FAIL** ✅ | `D · 非「内容已变而缓存键未升」态` → 捕获 2 个资产漂移而 CACHE 仍 v23 |
| S4 低于 released | v22 | v22 | 1 | **FAIL** ✅ | `F2 · 版本号单调不回退` → 22 >= 23 |
| S5 sw/清单不同步 | v25 | v24 | 1 | **FAIL** ✅ | `A · cacheVersion === CACHE（逐字）` |
| S6 sw 漏升、清单已升 | v24 | v25 | 1 | **FAIL** ✅ | `A · cacheVersion === CACHE（逐字）` |

**红→绿闭环取证**：S3/S4/S5/S6 **四个 QA 自建红样全部成功转红**（rc=1 且总判定 FAIL），
还原到 v25 真值后 S1 **转回 GREEN**（rc=0）。
⇒ **守卫确实承重，不是空转**（E 段反空转项亦自证：13 项资产全部现算、累计读入 597194B）。

### 8.3 QA-FIND-3 · 守卫的检测盲区

**S2 为何是绿的**：守卫的 D 段判据是
「**相对 `released` 基线**：内容变了 **且** 缓存键**未升过 released**」。
由于 C-2 纪律要求 `released` **锚死在 v23 不动**，任何 `> v23` 的键
（v24、v25、v99）都被视为"已升键"，守卫**无法区分 v24 与 v25**。

**这不是实现 bug，而是参照系的固有局限** —— sw.js 的行内注释本身也承认：

> 「条件② **不可判定**（manifest.released 仍锚 xiaonuan-v23，字面表明 v24 未移入受控基线；
> 但 v21 收线 commit 已 push，若部署面直接服务仓库内容则 v24 事实上已发布）」

**QA 的判定与影响**：
- 守卫的**核心 C0-b 检测能力完好**（S3/S4 证明），v13/v20/v21 那类"键 ≤ 已发布基线却改了资产"
  的事故**能被抓住**；
- 但 **v24 → v25 这一跳并非由守卫强制，而是靠人工纪律**。
  Kou 若声称"守卫保证了 v25 升键"，**该表述不成立**；
- 实际风险**低**：本轮 v25 已正确落位，且 S5/S6 保证 sw.js 与 manifest 不会不同步。

**QA 建议（v23）**：在 `released` 之外增设 `lastShipped` 字段（记录上一次实际推送的键），
使守卫能检测 `(lastShipped, current]` 区间的 stale；或在 C-2 会签流程中把
"released 推进"作为发版的强制步骤，让参照系不再长期滞后两个版本。

### 8.4 还原核对（无脏）

```
  sw.js md5:    c8665f1953ef55db3d2d86afb48e73ee  (期望 c8665f1953ef55db3d2d86afb48e73ee) ✅
  manifest md5: 2f32e48106cf745e663c24e04b4c4796  (期望 2f32e48106cf745e663c24e04b4c4796) ✅
```

矩阵脚本内置 `trap restore EXIT`，任何异常退出都会自动还原，**已验证仓库无残留**。

> **QA 结论**：**PASS-with-flag**。守卫红→绿闭环成立（4 红样自建并全部转红），
> `released` 块按 C-2 逐字未动，资产指纹 QA 独立复算一致；
> 但记入 QA-FIND-3：守卫对 `(released, current]` 区间的 stale 键不敏感。

---

## 9. 清单 8 · ceiling-drill 自清 —— ✅ PASS

`npm run test:ceiling-drill` 关键输出：

```
--- 3. 临时目录构造超限副本（Q2：不落盘到仓库）---
  ok   padding 真实生效：副本字节 === 越界目标  → 实测 6682 / 目标 6682
  ok   以副本复算锁④ → 判定为 FAIL             → 6682 > 6682 = false
  ok   临时目录已清理                          → /tmp/v20drill-ippkgv

--- 4a. 真实顶到越界点（基线未同步）→ B 段 diff 硬闸应接住 ---
  ok   4a 门禁退出码非 0（真的转红了）  → exit = 1
  ok   4a 门禁输出含总判定 FAIL         → === 配额门禁总判定: FAIL ===
  ok   4a B 段 diff 硬闸明确报红        → FAIL contingency.js 字节 === 基线 → 实测 6682 / 基线 6664 / Δ+18

--- 4b. 基线被同步到越界值 → C 段锁④应接住（业务侧此时全绿）---
  ok   4b C 段锁④ 明确报红  ★核心取证
       → FAIL ④ 逐模块配额 > 基线 → 13352>13333 / 3585>3566 / 4384>4366 / 6682>6682
  ok   4b 业务锁在同一时刻仍绿（业务侧毫无察觉）
       → 业务锁 6682 <= 6682 = true，而门禁锁④ = false

--- 4c. 自清理取证（Q2：仓库不得留下任何痕迹）---
  ok   ★ 演练前后真实 contingency.js 字节逐位不变  → 6664 → 6664
  ok   ★ 演练前后真实 contingency.js 内容逐字节一致  → byte-identical
  ok   ★ 演练前后门禁文件内容逐字节一致              → byte-identical
  ok   ★ 复跑门禁确认已回到全绿                      → exit = 0

=== 天花板演练总判定: PASS ===   (exit 0)
```

**QA 复核**：演练确实在**超 ceiling 时把 gate 打红**（4a 的 B 段 diff 硬闸、4b 的 C 段锁④
双路径均取证），且 4b 揭示的"业务锁绿 / 门禁锁红"正是**严格 `>` 而非 `>=`** 的价值所在
（与四锁④ 的口径一致）。运行后 QA 用 `git status` 确认仓库无脏。

> **QA 结论**：**PASS**。

---

## 10. 清单 9 · 全量测试 —— ✅ PASS

| 项 | 期望 | 实测 | 判定 |
|---|---|---|---|
| `npm test` | 351 pass / 0 fail | **tests 351 / pass 351 / fail 0 / skipped 0 / todo 0** | ✅ |
| `npm run test:probe` | 9/9 | **9 个探针文件，全部 PASS** | ✅ |
| `npm run test:probe:fast` | H13 0 泄漏 | **泄漏条数 0 / 泄漏率 0.000%** | ✅ |

**`test:probe` 9/9 明细（QA 逐条核对结论行）**：

```
── test/qa-probe-mutation.js          M1/M2/M3 三项全 PASS（含"绿转红"承重自证）
── test/qa-v17-adversarial.js         总判定: PASS（归一化前置与统一收口成立）
── test/qa-v17-independent-size.js    总判定: PASS（体积四锁全绿）
── test/qa-probe-h13.js               H13 结论: PASS（0 泄漏）
── test/qa-probe-v15-acceptance.js    P1/P2/P3 全 PASS
── test/qa-v19-quota-gate.js          配额门禁总判定: PASS
── test/qa-v21-sw-guard.js            TD 守卫总判定: PASS
── test/qa-v22-h13-closure.js         H13 闭合结论: PASS      ← v22 新增
── test/qa-v22-repair-route.js        repair 路由结论: PASS   ← v22 新增
```

**QA 补充确认**：两个 v22 新增文件均为 `.js`（非 `.test.js`），
故不进入 `node --test test/*.test.js` 的 351 计数，
"351 不变"与"probe 从 7 增至 9"两者**自洽无矛盾**，与任务书预期一致。

**最终回归**（在完成全部红样注入与还原之后重跑，确认沙箱操作未留副作用）：

```
# tests 351   # pass 351   # fail 0     ← 与验收开始时逐位一致
```

> **QA 结论**：**PASS**。


---

## 11. 已知问题 / 遗留项（统一追认清单）

本节汇总 QA 在独立验收中**亲手构造红样**发现的、不属 v22 引入回归、但须记入待办的缺口。
两者在 v21 同样存在，故**不构成 v22 回退理由**，但 QA-FIND-2 须修正"H13 已闭合"的措辞。

### QA-FIND-2 · H13 主语省略形态缺口（级别：中）
- **成因**：`engine.js:1307` 的 `PERSONA_BREAK_RE` 把连接词枚举
  `[从?本质上讲?|归根结底|说白了]` 置于**人称绑定组内部**
  `([你我咱它他她您]们?(?:…))`，使**主语省略句**无法命中。
- **红样实证**：A/B 台架 21 条红样中，v22 拦下 20 条，**漏拦 1 条**
  ——「**说白了就是代码堆出来的**」（任务书点名句，无主语）；
  `gap-charac.js` 280 组合穷举：带主语 40/40 全拦，省主语 240/240 全漏。
- **可达性**：`reach.js` 证明省主语句在 guardPersonaReplies / memory.taint / innerGuard
  三消费点**全部放行**，确为护栏层真实缺口（非测试盲区臆测）。
- **为何非 v22 回归**：v21 同款正则结构，A/B 中 v21 漏 18/21，v22 已修至漏 1/21。
- **为何当前不触发泄漏**：固定语料 `qa-probe-h13.js` 12 红样**全带主语**，故快通道仍 0% 泄漏；
  但 Kou 该文件对省主语缺口**盲目**，结论行"H13 闭合"表述过度。
- **补丁成本（已实测）**：QA 候选补丁在 41B 预算内**无法**做到零误伤
  （Candidate A +1B 误伤 9/20；Candidate B +49B 零误伤但**超预算**）。
- **处置**：转 **v23 待办**；CHANGELOG / 口播须把"H13 闭合"改述为
  "**H13 人称自曝形态闭合**"，不得以"闭合"无定语对外。
- **遗留风险**：若后续语料引入省主语破墙句，将立即复现泄漏；建议 v23 用"主语可选 + 连接词必现"二分叉重构。

### QA-FIND-3 · sw 守卫对 (released, current] 区间 stale 键不敏感（级别：低）
- **成因**：`qa-v21-sw-guard.js` 以 `released` 基线（v23/b36842f）锚定，
  凡落在 `(released=v23, current=v25]` 之间的陈旧键（如 CACHE=v24）不被判违规。
- **红样实证**：`sw-guard-matrix.sh` 六场景——S2（CACHE=v24，资产已变）报 **GREEN（即漏判）**；
  S3/S4/S5/S6 均正确 **RED**。
- **影响**：核心 C0-b（资产内容 sha256 漂移）检测**完好**，此为参照系滞后盲区，非逻辑 bug。
- **处置**：记入已知限制；后续守卫应改为"**当前键 + 最近 N 个历史键**"滚动比对，消除滞后窗。

---

> **QA 终审结论（与 §0 一致）**：v22 已批准变更范围 **PASS（有保留）**，可收线；
> 全量 351/0、9/9 探针全过、H13 快通道 0% 泄漏均经 QA 复跑确认。
> 遗留 **QA-FIND-2（中）**、**QA-FIND-3（低）** 转 v23，按上处置。
