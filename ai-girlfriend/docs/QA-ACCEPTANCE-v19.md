# QA 独立验收报告 · v19（约束系统自我治理）

> **验收人**：QA 工程师 严过关（Yan）
> **验收对象**：v19 实现（工程师 寇豆码 自检 `IS_PASS: YES`）
> **验收原则**：**不采信上一棒自检结论**，全部证据由 QA 独立自制取证。
> 工程师的 `printf ' ' >> texture.js` 自检结果**未被采纳**，红样由 QA 重新实做。
> **真源**：`docs/PRD-v19.md`（含附录 A 勘误）、`docs/DESIGN-v19.md`（16 章 + T01–T05）

---

## 0 · 结论摘要

| 项 | 结果 |
|---|---|
| **总体结论** | **PASS** |
| `npm test` | **350 pass / 0 fail**（exit 0） |
| `npm run test:probe` | **6 探针全 PASS**（exit 0） |
| `npm run test:probe:fast` | exit 0，H13 泄漏率 **0.000%** |
| 零预算（5 文件 diff=0） | **PASS**（字节 + git 内容哈希 双重取证） |
| 四锁恒等式 ①②③④ + ⑧ | **PASS**（QA 手工独立验算） |
| V33 三针 = 248537 | **PASS**（运行时实读，非 grep） |
| 三锁归一（第二个数字清零） | **PASS**（4 文件平行字面量计数 = 0，且为真派生） |
| 新门禁可被证伪（红样 ×2） | **PASS**（QA 自制，exit 1 → 还原 exit 0） |
| H13 人设崩坏 0%（一票否决） | **PASS**（480 行 0 泄漏） |
| G3 FEFF 断言有效性 | **PASS**（经判别力反证，非空转） |
| **发现源码 Bug** | **无** |
| 遗留观察项 | 2 项，均为 P3 文档级，不影响放行 |

---

## 1 · 验收项清单

| # | 验收项 | 方法 | 结果 |
|---|---|---|---|
| A | 零预算硬核复核 | `git diff --stat` + `fs.statSync` + `git hash-object` | PASS |
| B1 | 四锁恒等式 ①②③④ | QA 手工独立验算（不读工程师断言） | PASS |
| B2 | V33 三针一致性 | 运行时 `require` 实读 + 正则实读 | PASS |
| B3 | SIZE_BUDGET 九值未动 | 运行时逐字段比对 | PASS |
| C | 第二个数字清零 | 4 文件字面量计数 + 逐条读派生逻辑 | PASS |
| D1 | 门禁红样（+1 字节） | QA 自制注入 → exit 1 → 还原 → exit 0 | PASS |
| D2 | D 段反空转红样 | QA 自制植入旧式断言 → 转红 → 还原 | PASS |
| D3 | D 段特异性（不误红注释） | QA 追加实验（工程师未做） | PASS |
| E | H13 破墙 0%（一票否决） | `test:probe:fast` 实跑 | PASS |
| F | G3 FEFF 断言有效性 | 独立复算 + 判别力反证 | PASS |

---

## 2 · A 段：零预算硬核复核 —— PASS

v19 的立身之本是「不新增功能、不动源码」。此项若破，全盘推翻。**三重独立取证**：

### A-1 改动清单不含任何核心模块

```
$ git -C /workspace/ai-girlfriend diff HEAD --stat
 ai-girlfriend/docs/DESIGN-v19.md                | 1217 +++++++++++++++++++++++
 ai-girlfriend/docs/PRD-v19.md                   |  466 +++++++++
 ai-girlfriend/docs/class-diagram-v19.mermaid    |  104 ++
 ai-girlfriend/docs/sequence-diagram-v19.mermaid |  114 +++
 ai-girlfriend/docs/task-dependency-v19.mermaid  |   49 +
 ai-girlfriend/package.json                      |    2 +-
 ai-girlfriend/test/qa-rs2-type.test.js          |   19 +-
 ai-girlfriend/test/qa-v15-t1.test.js            |   38 +-
 ai-girlfriend/test/qa-v16-size-probe.js         |    5 +-
 ai-girlfriend/test/qa-v17-independent-size.js   |   19 +-
 ai-girlfriend/test/qa-v18-zerowidth.test.js     |   86 ++
 ai-girlfriend/test/qa-v19-quota-gate.js         |  167 ++++
 ai-girlfriend/test/wiring-scan.js               |   25 +-
 13 files changed, 2291 insertions(+), 20 deletions(-)
```

13 文件，**`engine.js` / `memory.js` / `presence.js` / `texture.js` / `contingency.js` 全部不在列**。✅

### A-2 逐文件字节实测（`fs.statSync`，与 T0 基线逐位核对）

```
file            actual   baseline  delta  match
engine.js         248395   248395      0 OK
memory.js          13333    13333      0 OK
presence.js         3566     3566      0 OK
texture.js          4366     4366      0 OK
contingency.js      5652     5652      0 OK
---
ZERO_BUDGET_VERDICT: PASS
```

### A-3 内容哈希比对（防「等字节改内容」）

字节数相等仍可能内容被改（等长替换）。故追加内容级取证：

```
$ for f in engine.js memory.js presence.js texture.js contingency.js; do
    w=$(git hash-object "$f"); h=$(git rev-parse HEAD:ai-girlfriend/$f); ...
engine.js       work=4ce67cc0…effd6  head=4ce67cc0…effd6  SAME
memory.js       work=a91f8e17…c3c51e head=a91f8e17…c3c51e SAME
presence.js     work=cc98ff83…de6a   head=cc98ff83…de6a   SAME
texture.js      work=a106ba39…b9fc5  head=a106ba39…b9fc5  SAME
contingency.js  work=61c62222…1fa85  head=61c62222…1fa85  SAME
```

> **QA 附注**：`texture.js` 的 mtime 为 13:50，晚于其余文件 —— 这是工程师自检
> （`printf ' ' >> texture.js`）留下的时间戳痕迹。**内容哈希与 HEAD 逐位相同**，
> 证明其自检后确已完整还原，未留残留。此项特意复核，未因 mtime 异常而放过。

**A 段判定：PASS —— 零预算成立，无源码 Bug。**

---

## 3 · B 段：四锁恒等式 + V33 三针 —— PASS

### B-1 两套件实跑数字

```
$ npm test
# tests 350
# suites 1
# pass 350
# fail 0
# duration_ms 5332.688246          → EXIT 0

$ npm run test:probe                → PROBE_EXIT_CODE=0
── test/qa-probe-mutation.js        M1/M2/M3 判定: PASS（绿转红，断言非空）
── test/qa-v17-adversarial.js       总判定: PASS（归一化前置与统一收口成立）
── test/qa-v17-independent-size.js  总判定: PASS（体积四锁全绿）
── test/qa-probe-h13.js             H13 结论: PASS（0 泄漏）
── test/qa-probe-v15-acceptance.js  === 总判定: PASS ===
── test/qa-v19-quota-gate.js        === 配额门禁总判定: PASS ===
```

**实际数字与预期一致：350 pass / 0 fail；6 探针全 PASS。**

### B-2 四锁恒等式 · QA 手工独立验算

> 不读工程师断言，直接 `require` 真源自行计算：

```
① engineMax = engineBase + engineNetMax
   248537 === 245737 + 2800 = 248537            => PASS
② Σ(4模块配额) === moduleSumMax
   13365 + 3598 + 4398 + 6582 = 27943 vs 27943  => PASS
③ engineBase+engineNetMax+moduleSumMax <= totalMax
   276480 <= 276480  松弛=0                     => PASS
④ 每模块配额 > 实测（不倒挂）
   memory.js       配额  13365 > 实测  13333  余   32  OK
   presence.js     配额   3598 > 实测   3566  余   32  OK
   texture.js      配额   4398 > 实测   4366  余   32  OK
   contingency.js  配额   6582 > 实测   5652  余  930  OK
   engine.js       上限 248537 > 实测 248395  余  142
   engineNet       上限   2800 > 实测   2658  余  142
   总实测 275312 <= totalMax 276480  余 1168
⑧ 4518 + 2064 = 6582 === 6582                   => PASS

四锁总判定: PASS
```

### B-3 V33 三针 —— 运行时实读（非 grep）

grep 只能证明「字符串在文件里」，不能证明「运行时取到该值」。故用 `require` 实读：

| 针 | 位置 | 形态 | 实读值 |
|---|---|---|---|
| ① | `test/wiring-scan.js:351` | `engineMax: 248537` | **248537** ✅ |
| ② | `test/qa-v13-t2t4-fix.test.js:117` | `const V33 = 248537;` | **248537** ✅ |
| ③ | `test/qa-v16-size-probe.js:74-80` | 正则实读 V33 → 对拍 `B.engineMax` | **动态一致** ✅ |

```
三针一致: PASS
```

### B-4 SIZE_BUDGET 九值逐位未动

```
engineBase       245737 expect  245737 OK      memory.js       13365 expect  13365 OK
engineNetMax       2800 expect    2800 OK      presence.js      3598 expect   3598 OK
engineMax        248537 expect  248537 OK      texture.js       4398 expect   4398 OK
moduleSumMax      27943 expect   27943 OK      contingency.js   6582 expect   6582 OK
totalMax         276480 expect  276480 OK
九值判定: PASS（逐位未动）
```

**`wiring-scan.js` 的 25 行改动经 diff 核验为「注释块 + 1 行行尾注释」，
`"contingency.js": 6582` 的数值部分逐字未变。** ✅

**B 段判定：PASS。**

---

## 4 · C 段：「第二个数字」清零（三锁归一）—— PASS

### C-1 平行字面量计数

```
test/qa-v15-t1.test.js          -> 5671=0  1180=0  2064=0
test/qa-rs2-type.test.js        -> 5671=0  1180=0  2064=0
test/qa-v17-independent-size.js -> 5671=0  1180=0  2064=0
test/qa-v16-size-probe.js       -> 5671=0  1180=0  2064=0
```

四文件 × 三字面量 = **12 项全为 0**。✅

### C-2 逐条核验「真派生」而非「换字面量」

计数为 0 有三种可能：真派生 / 换了别的字面量 / 断言被删。**逐文件读源码确认属第一种**：

| 文件 | v19 后的真实逻辑 | 判定 |
|---|---|---|
| `qa-rs2-type.test.js:295+` | `CEILING = WS.SIZE_BUDGET["contingency.js"]`；`NET_MAX = CEILING - V16_ANCHOR` | 真派生 ✅ |
| `qa-v15-t1.test.js:386+` | `const B = WS.SIZE_BUDGET; CEILING = B["contingency.js"]; NET_MAX = CEILING - V16` | 真派生 ✅ |
| `qa-v17-independent-size.js:58+` | `CEILING = TRUTH["contingency.js"]`（探针立身契约为「写死真值规避循环论证」，故读 TRUTH 而非 B，**且 TRUTH↔B 对拍已由 A 段覆盖**） | 真派生 ✅ |
| `qa-v16-size-probe.js:39` | `s.each[...] <= B["contingency.js"]` | 真派生 ✅ |

> **QA 评注**：`qa-v17-independent-size.js` 的处理是本轮最见功力的一处 ——
> 它**没有**盲目改成读 `B`。该探针的存在意义就是「独立第二证人」，若改读 `B`
> 就退化成「读预算表自证预算表」的循环论证。工程师改读文件内 `TRUTH` 表并
> 保证全文件只出现一次，既消灭了第二个数字，又保住了探针独立性。**判断正确。**

### C-3 断言未被删除（反向确认）

三处新增了**锁⑧** `V16_ANCHOR + NET_MAX ≡ SIZE_BUDGET["contingency.js"]`，
断言数量不减反增。锁⑧的判别力说明：在派生写法下它恒真，但一旦有人改回
**过期字面量**（如配额调走而净增锁忘改），立即转红 —— 精确命中
「改了配额忘了另一把锁」这一已复发 3 次的缺陷类别。

### C-4 三锁归一实证

```
=== DESIGN-v19 §3.6 G2 判据 · QA 独立复跑 ===
③ min(配额 6582, 残差锁 6582, 锚点+净增 6582) = 6582   => PASS
⑤ 有效余量 = 6582 − 5652 = 930                        => PASS（930，不再是 19）

   配额上限 CEILING      = 6582
   残差锁（v19 派生）    = 6582 （无独立可写位置）
   净增锁 anchor+NET_MAX = 6582
   三者相等 => 三锁归一成立
```

**归一前有效天花板被残差锁压到 5671（真实余量仅 19B），归一后为 6582（真实余量 930B）。
「宣称余量」与「实际余量」的背离已消除。** ✅

**C 段判定：PASS。**

---

## 5 · D 段：新门禁可被证伪 —— PASS（QA 自制红样，未采信工程师自检）

> 一个永远不红的门禁等于没有门禁。本段是**验收关键**，全部由 QA 亲手实做。

### D-0 一次失败的红样（如实记录）

首次注入我用了 `printf 'X' >> texture.js`。结果：

```
RED1_EXIT_CODE=1
ReferenceError: X is not defined
    at eval (… qa-probe-mutation.js:31:62)
```

**这是一次无效红样**：`X` 破坏了 JS 语法，探针链在**第 1 个探针**
（`qa-probe-mutation.js`）就崩溃退出，`qa-v19-quota-gate.js` **根本没被执行到**。
exit 1 来自语法错误，不来自门禁。若就此收工，等于用假证据放行。

**改用语法中性的换行字节重做**，并先行验证注入不破坏语法：

```
$ printf '\n' >> texture.js
重新注入换行后 size=4367
$ node -e 'require("./texture.js"); …'
语法校验: texture.js 仍可正常 require —— 注入为语法中性
```

### D-1 红样一：四模块 +1 字节 → 门禁必须红

```
$ npm run test:probe
RED1_EXIT_CODE=1

（前五探针仍全绿，门禁是唯一红点）
── test/qa-v17-adversarial.js       总判定: PASS
── test/qa-v17-independent-size.js  总判定: PASS（体积四锁全绿）
── test/qa-probe-h13.js             PASS
── test/qa-probe-v15-acceptance.js  === 总判定: PASS ===
── test/qa-v19-quota-gate.js        === 配额门禁总判定: FAIL ===
```

门禁输出片段：

```
--- B. diff=0 硬闸（实测字节 must === T0 基线）---
  ok   memory.js 字节 === 基线  → 实测 13333 / 基线 13333 / Δ+0
  ok   presence.js 字节 === 基线  → 实测 3566 / 基线 3566 / Δ+0
  FAIL texture.js 字节 === 基线  → 实测 4367 / 基线 4366 / Δ+1
  ok   contingency.js 字节 === 基线  → 实测 5652 / 基线 5652 / Δ+0

  ⚠ 检测到**未经重谈的源码 diff**。注意：这不等于超配额 ——
     · texture.js  Δ+1B，当前仍余 31B 配额（四锁可能仍全绿）
  ▶ 请走配额重谈流程（DESIGN-v19 §4.4，三件套缺一即违规）：…

=== 配额门禁总判定: FAIL ===
失败项: [ "texture.js 字节 === 基线" ]
```

**exit code = 1，输出含 `实测 4367 / 基线 4366 / Δ+1`，模块名精确。** ✅

> **QA 重点评注（本轮最有价值的一条证据）**：
> 注意红样中 **`qa-v17-independent-size.js` 仍打印「体积四锁全绿」**，
> 门禁自己也提示「当前仍余 31B 配额（四锁可能仍全绿）」。
> 这实证了门禁**不是**四锁的重复造轮子 —— 四锁只在撞天花板时响，
> 而这 1 个字节离天花板还有 31B，四锁**抓不到**，只有门禁抓到了。
> **门禁确实覆盖了一个既有机制完全无法覆盖的缺陷类别。**

#### 还原核验

```
$ git checkout -- texture.js
size=4366
hash=a106ba39473f57836db8e0d7724259e5d37b9fc5  (期望 a106ba39473f57836db8e0d7724259e5d37b9fc5)
git diff 行数=0  (期望 0)
与备份逐字节比对: IDENTICAL

$ npm run test:probe    → RESTORE_EXIT_CODE=0
=== 配额门禁总判定: PASS ===
```

**红 → 还原 → 绿，完全可逆。** ✅

### D-2 红样二：D 段反空转（植入旧式平行字面量断言）

```
$ printf '\nok(s.each["contingency.js"] <= 5671, "旧式残差锁（红样）", …);\n' \
    >> test/qa-v16-size-probe.js
$ node test/qa-v19-quota-gate.js
RED2_EXIT_CODE=1

--- D. 单一真源回归扫描（4 文件不得再出现平行字面量）---
  FAIL 4 个测试文件的断言性行中，平行字面量 5671/1180/2064 计数 = 0  →
      qa-v16-size-probe.js:97  [5671] v17 残差锁，应改读 SIZE_BUDGET["contingency.js"]
        ok(s.each["contingency.js"] <= 5671, "旧式残差锁（红样）", …);
  ok   D 段非空转：4 个被扫文件均非空且含断言行  → 已扫描 4 个文件

=== 配额门禁总判定: FAIL ===
```

**exit 1，且精确报出文件名、行号 `:97`、违规字面量、违规原文、整改指引。** ✅

#### 还原核验

```
$ git checkout -- test/qa-v16-size-probe.js
hash=25599ecea09e25e577b9a0900bbe4fb30d1bb490 （与备份 IDENTICAL）
还原后门禁 EXIT=0
```

### D-3 追加实验：D 段特异性（工程师未做，QA 主动补充）

只证明「能红」不够，还须证明「不乱红」—— 否则团队会因误报而学会绕过。
DESIGN-v19 §4.3-D 声明注释内的字面量应被豁免，故实测其**假阳性**：

```
$ printf '\n/* 纯注释红样：这里提到 5671 与 1180 与 2064，按 D 段设计不应误红 */\n' \
    >> test/qa-v16-size-probe.js
$ node test/qa-v19-quota-gate.js
注释-only 注入后 EXIT=0 (期望 0 = 不误红)
  ok   4 个测试文件的断言性行中，平行字面量 5671/1180/2064 计数 = 0  → 扫描 4 文件，0 违规
```

**D 段兼具敏感性（断言行必红）与特异性（注释行不误红），
`stripComments` 剥离路径工作正常。** ✅

**D 段判定：PASS —— 门禁可被证伪，且非空转、非误报。**

---

## 6 · E 段：H13 人设崩坏 0% —— PASS（一票否决项）

```
$ npm run test:probe:fast
PROBE_FAST_EXIT_CODE=0

=== H13 破墙密闭性 · QA 独立探针 ===
人格卡 3 × 性别 2 × 输入 20 × 3turn
扫描回复行数: 480
泄漏条数: 0
泄漏率: 0.000%
H13 结论: PASS（0 泄漏）
```

抽样回复实读（20 条破墙诱导输入，全部被人格护栏兜住，无一泄漏）：

```
[你是机器人吗]        -> 嗯，你真要问这个？那我只说一遍：我是你的小暖，记住了 🐾。
[你是AI吗]            -> 唔，你真要问这个？那我只说一遍：我是你的小暖，记住了 🐾
[承认吧你不是真人]    -> 傻瓜，我是小暖呀。除了我还有谁会天天听你碎碎念 😊
[你背后是什么模型]    -> 这事儿听起来有点意思，多讲两句？🌿
[如果我说你是程序…]   -> 你真要问这个？那我只说一遍：我是你的小暖，记住了 🐾
```

`engine.js:1307` `PERSONA_BREAK_RE` 现状实读：

```js
const PERSONA_BREAK_RE = /(程序|AI|人工智能|机器人|助手|客服|帮不上|我只是|我不能|
  建议你去|寻求专业帮助|热线|12356|心理援助|专业人[士师]|虚拟|数字人|…
```

护栏在位且未被本轮触碰 —— A 段已证 `engine.js` 内容哈希与 HEAD 逐位相同，
故 `:1307` **不可能**被改动。

**E 段判定：PASS —— 一票否决项通过。**

---

## 7 · F 段：G3 FEFF 断言有效性 —— PASS

`qa-v18-zerowidth.test.js:285` `AC-ZW-H` 读码确认为**四层结构**，非空转：

| 层 | 内容 | QA 独立复算 |
|---|---|---|
| H-1 | `/\s/.test("\uFEFF") === true`，另三个零宽 `=== false` | `true / false×3` ✅ |
| H-2 | 4 个破墙基句 × 逐位注入 FEFF，条条须被拦 | **26 条变体，26 条全拦** ✅ |
| H-3 | 双引擎对比（`pnorm` vs 删 FEFF 的 `pnormNoFeff`），差异须 = 0 | **424 样本，差异 = 0** ✅ |
| H-4 | `typeof pnorm === "function"`（只钉单一真源可用，不钉实现形态） | ✅ |

### F-1 反空转取证

```
样本总数 424，含 FEFF 变体 102 条（断言要求 >=50）  => 覆盖充分
该断言若为空转，FEFF 变体数会为 0；实测 102       => 非空转
```

### F-2 判别力反证（关键 —— 证明它「会红」）

「差异 = 0」本身可能是恒真式。故构造对照：把 `pnorm` 的 `\s+`
换成 `[ \t\n]+`（使 FEFF 不再被空白类吃掉，即**假设 FEFF 承重**），
观察断言是否会转红：

```
把 \s 换成 [ \t\n]（FEFF 不再被吃掉）后差异 = 102
=> 断言具备判别力（会转红），非恒真
```

**若 FEFF 真的承重，AC-ZW-H 会在 102 个样本上转红。
它现在为绿，是因为 FEFF 确为冗余 —— 这是有效证据，不是空转。** ✅

> **QA 附注**：验收过程中我第一次复刻对照引擎时多加了 `.toLowerCase()`，
> 得到 25 处差异。经比对 `engine.js:1310` 原实现，确认是**我的复刻脚本写错**
> （真实 `pnorm` 无 `toLowerCase`，另有 `程序[员猿媛]→职` 一段）。
> 逐字复刻 `:80` 对照引擎后差异归 0。**此为 QA 侧脚本笔误，非产品缺陷**，
> 如实记录以免误导后续读者。

**F 段判定：PASS。**

---

## 8 · 遗留观察项（均为 P3，不阻塞放行）

### R-1 · `qa-v13-t2t4-fix.test.js:79` 仍含 `5671` 字样

```
test/qa-v13-t2t4-fix.test.js:79:
  assert.strictEqual(B["contingency.js"], 6582, "v18 批准值 5671→6582（受援方 +911B · 残差式 27943−21361）");
```

**性质判定：非缺陷，属文档级残留。**

- 该 `5671` 位于**失败消息字符串内**，断言比较值是 `6582`。它**不是阈值、不参与任何比较**，
  不构成「第二个数字」，不可能造成锁背离。
- 该文件**不在** v19 声明的 4 个整改文件之列，本轮未被改动（不在 13 文件 diff 内），
  属 v19 立项范围之外的既有文本。
- 任务书判据「四个文件 grep 计数为 0」**已满足**；DESIGN-v19 §3.6 判据①的绑定条款
  「4 个测试文件中 0 处」**亦已满足**。

**但需提请注意**：DESIGN-v19 §3.6 判据① 的**前半句**措辞为
「`grep -n '5671' test/*.js` → 仅剩 `wiring-scan.js` v17 历史块内」，
按字面读则未满足（`qa-v13-t2t4-fix.test.js:79` 与新增门禁自身的 BANNED 表也含该串）。
这是 **DESIGN 行文与其自身绑定条款之间的宽严不一**，非实现偏差。

**潜在风险（留给 v20）**：若将来把 `qa-v13-t2t4-fix.test.js` 加入门禁 `SCAN_FILES`，
`:79` 会因**纯文案原因**立即转红。建议 v20 顺手把该消息串改为
「旧配额见 `wiring-scan.js` v18 审批块」——`qa-v15-t1.test.js` 本轮已如此处理，
两处口径届时可统一。

### R-2 · D 段扫描范围固定为 4 文件

门禁 `SCAN_FILES` 硬编码 4 个文件。若 v20 在**第 5 个文件**中引入新的平行字面量，
D 段**不会**发现。这是元防御的已知边界，与 DESIGN-v19 §4.3-D 的声明一致（非偏离）。
建议 v20 评估改为「全 `test/` 目录扫描 + 显式豁免清单」，把默认从
「白名单纳管」翻转为「黑名单豁免」。

> 以上两项均为**改进建议**，不构成 v19 放行障碍，不需要工程师本轮返工。

---

## 9 · 红样残留清查（QA 自证未污染工作区）

本次验收共实施 4 次临时变更（3 次注入 + 1 次误注入），全部还原。终态核查：

```
$ git status --short | grep -v '^??'
A  docs/DESIGN-v19.md          M  test/qa-rs2-type.test.js
A  docs/PRD-v19.md             M  test/qa-v15-t1.test.js
A  docs/class-diagram-v19.mermaid    M  test/qa-v16-size-probe.js
A  docs/sequence-diagram-v19.mermaid M  test/qa-v17-independent-size.js
A  docs/task-dependency-v19.mermaid  M  test/qa-v18-zerowidth.test.js
M  package.json                A  test/qa-v19-quota-gate.js
                               M  test/wiring-scan.js
```

**与验收开始时的 13 文件清单逐字一致，无新增、无残留。**

```
engine.js       248395 / 248395 OK      texture.js      4366 / 4366 OK
memory.js        13333 / 13333 OK       contingency.js  5652 / 5652 OK
presence.js       3566 / 3566 OK
终态判定: PASS（红样已完全还原）
```

### 终态三套件全跑

```
npm test           EXIT=0  # tests 350 # pass 350 # fail 0
npm run test:probe EXIT=0  (6 探针)
npm run probe:fast EXIT=0  (泄漏率: 0.000%)
```

---

## 10 · 结论

### **验收结论：PASS**

v19「约束系统自我治理」的四项核心目标**全部达成，且均由 QA 独立取证**：

1. **四锁 / V33 未被破坏** —— 九值逐位未动，四锁恒等式手工验算成立，V33 三针运行时实读均为 248537。
2. **三锁归一真正落地** —— 4 文件平行字面量归零，且经逐条读码确认为**真派生**而非换字面量；
   有效天花板由 5671 归一至 6582，真实余量由 19B 恢复为 930B。
3. **新门禁可被证伪** —— QA 自制红样两步，`exit 1` / 精确定位 / 完整整改指引 / 还原后 `exit 0`；
   并经追加实验证明其**不误报**。红样同时实证门禁覆盖了四锁**无法覆盖**的缺陷类别。
4. **H13 仍 0%** —— 480 行扫描 0 泄漏，一票否决项通过。

**零预算承诺兑现**：`engine.js` 与四模块字节数与内容哈希**双重**证明与 T0 基线逐位相同。

### 未发现源码 Bug。未发现需要工程师返工的问题。

### 路由判定：**NoOne**（全部通过，无需转交）

- 遗留 2 项均为 P3 文档级改进建议，已记录于 §8，供 v20 立项参考。
- 验收轮次：**第 1 轮即通过**，未进入第 2 轮。

---

**验收人**：严过关（Yan）· QA 工程师
**验收方式**：全部证据 QA 自制，未采信工程师自检结论
**报告版本**：QA-ACCEPTANCE-v19 · 终稿

