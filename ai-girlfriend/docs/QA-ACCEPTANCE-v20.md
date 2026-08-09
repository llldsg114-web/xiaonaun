# QA 独立验收报告 · v20

> **验收人**：严过关（Yan）· QA 工程师
> **验收对象**：v20「零字节纪律时代的第一次有意花钱」——在冻结的 SIZE_BUDGET 配额封顶内填充 contingency 语料
> **真源**：`docs/PRD-v20.md` / `docs/DESIGN-v20.md`（8 章，T01–T05、§1.3/§7.2 929B 边界证明、§5.9.1 锁④实现细节）
> **工程师自检**：寇豆码报 `IS_PASS: YES` —— **本次验收不采信该结论**，全部证据由 QA 自制复现。

---

## 〇、验收结论

| 项 | 结论 |
| --- | --- |
| **总判定** | ✅ **PASS** |
| `npm test` | **350 passed / 0 failed**（exit 0） |
| `npm run test:probe` | **6 探针全 PASS**（exit 0） |
| `npm run test:probe:fast` | exit 0，**H13 泄漏率 0.000%（0/480）** |
| `npm run test:ceiling-drill` | exit 0，演练后仓库零残留 |
| **发现源码 Bug** | **无** |
| **遗留问题** | 1 项 P3 文档性口径漂移（不阻断，详见 §7） |

**独立性声明**：本报告全部数字均由 QA 亲自执行命令取得；工程师取证包 `docs/v20-evidence-pack.md` 仅作交叉参考，未作为任何一条结论的依据。凡工程师声称的行为（尤其门禁红→绿），QA 均**自行注入红样复现**后才予认可。

**方法论提示（一次自查纠错）**：本仓 git 根为 `/workspace`，而工作目录为 `/workspace/ai-girlfriend`（prefix `ai-girlfriend/`）。首轮 `git diff HEAD -- ai-girlfriend/engine.js` 因 pathspec 相对 cwd 解析而**匹配空集**，产生"看似通过实为空转"的假阴性。QA 已识别并改用 cwd 相对路径重跑，且加入**反向自检**（同一 pathspec 查 contingency.js 必须有输出）以证明该项检查非空转。下文 A 段结论基于修正后的命令。

---

## 一、A · 零预算封顶硬核复核

### A-1 改动集不含四大核心模块

```
$ git diff HEAD --name-only
ai-girlfriend/contingency.js
ai-girlfriend/docs/DESIGN-v20.md
ai-girlfriend/docs/v20-evidence-pack.md
ai-girlfriend/package.json
ai-girlfriend/test/qa-rs2-type.test.js
ai-girlfriend/test/qa-v13-t2t4-fix.test.js
ai-girlfriend/test/qa-v19-quota-gate.js
ai-girlfriend/test/qa-v20-ceiling-drill.js
ai-girlfriend/test/wiring-scan.js

$ git diff HEAD --name-only | grep -E '(^|/)(engine|memory|presence|texture)\.js$'
OK: engine/memory/presence/texture 均无改动条目
```

改动集共 9 个条目，与声明的改动集**完全一致**：contingency.js + 5 个 test/package 文件 + wiring-scan.js + 新增 drill + 2 份文档。

### A-2 逐位比对（不止于"大小相同"）

仅比对字节数不足以证明"逐位不变"，故 QA 追加 SHA-256 全文比对：

```
$ for f in engine.js memory.js presence.js texture.js; do
    h=$(git show HEAD:ai-girlfriend/$f | sha256sum | cut -c1-16)
    w=$(sha256sum $f | cut -c1-16); ...
PASS engine.js    HEAD=829acc93302f1823  WT=829acc93302f1823  逐位一致
PASS memory.js    HEAD=e9bc76a178db3955  WT=e9bc76a178db3955  逐位一致
PASS presence.js  HEAD=8924c42baf313198  WT=8924c42baf313198  逐位一致
PASS texture.js   HEAD=dad00580ae828b49  WT=dad00580ae828b49  逐位一致

$ git diff HEAD --numstat -- engine.js memory.js presence.js texture.js
（无输出 = 零改动）
$ git diff HEAD --numstat -- contingency.js        # 反向自检：证明 pathspec 有效
4	4	ai-girlfriend/contingency.js
```

### A-3 fs.statSync 实测

```
PASS  engine.js        实测= 248395  期望= 248395  Δ=0
PASS  memory.js        实测=  13333  期望=  13333  Δ=0
PASS  presence.js      实测=   3566  期望=   3566  Δ=0
PASS  texture.js       实测=   4366  期望=   4366  Δ=0
PASS  contingency.js   实测=   6270  期望=   6270  Δ=0
---
contingency Δ vs T0(5652) = 618   上限929 => PASS
```

**contingency.js 5652 → 6270，Δ=+618 ≤ 929 ✅**

### A-4 SIZE_BUDGET 九值冻结

以正则从 HEAD 版与工作区版各自解析 SIZE_BUDGET 后三方比对（HEAD / 工作区 / DESIGN 期望值）：

| key | HEAD | 工作区 | 期望 | 判定 |
| --- | --- | --- | --- | --- |
| engineBase | 245737 | 245737 | 245737 | PASS |
| engineNetMax | 2800 | 2800 | 2800 | PASS |
| engineMax (V33) | 248537 | 248537 | 248537 | PASS |
| memory.js | 13365 | 13365 | 13365 | PASS |
| presence.js | 3598 | 3598 | 3598 | PASS |
| texture.js | 4398 | 4398 | 4398 | PASS |
| contingency.js | 6582 | 6582 | 6582 | PASS |
| moduleSumMax | 27943 | 27943 | 27943 | PASS |
| totalMax | 276480 | 276480 | 276480 | PASS |

键数量 HEAD/WT/期望 = 9 / 9 / 9 —— **无增删、无改值**。

`wiring-scan.js` diff 中唯一涉及数值行的改动是 contingency 行的**行尾注释**（930→929 口径订正），`"contingency.js": 6582,` 的**值本体逐字未动**：

```diff
- "contingency.js": 6582,  // ... 实测 5652，**真实可用 930B**（...）
+ "contingency.js": 6582,  // ... v20 实测 6270（T0 基线已迁移...），配额余量 312B；★门禁锁④用严格 >...安全 Δ 上限是 929B 而非 930B ...
```

> **A 段结论：PASS。** 零预算封顶成立——四大模块逐位不变，唯一字节增长发生在 contingency.js 且落在既有配额内，九个预算值一个字节未动。

---

## 二、B · 四锁恒等式 + V33 三针

### B-1 两套测试实跑数字

```
$ npm test
# tests 350
# pass  350
# fail  0
UNIT_EXIT=0

$ npm run test:probe
PROBE_EXIT=0
── test/qa-probe-mutation.js          M1/M2/M3 判定: PASS（绿转红，断言非空）
── test/qa-v17-adversarial.js         总判定: PASS（归一化前置与统一收口成立）
── test/qa-v17-independent-size.js    总判定: PASS（体积四锁全绿）
── test/qa-probe-h13.js               H13 结论: PASS（0 泄漏）
── test/qa-probe-v15-acceptance.js    === 总判定: PASS ===
── test/qa-v19-quota-gate.js          === 配额门禁总判定: PASS ===
探针文件数 = 6
```

与预期 **350 pass / 0 fail**、**6 探针全 PASS** 完全吻合。

### B-2 四锁手工验算（QA 自算，不引用门禁自报输出）

```
PASS  ① engineMax = engineBase + engineNetMax  →  248537 === 245737+2800 = 248537
PASS  ② Σ(4配额) = moduleSumMax                →  13365+3598+4398+6582 = 27943 === 27943
PASS  ③ base+net+moduleSum = totalMax(slack=0) →  245737+2800+27943 = 276480 === 276480
PASS  ④ 逐模块配额 > 实测（严格>）              →  memory:13365>13333(余32) / presence:3598>3566(余32)
                                                  / texture:4398>4366(余32) / contingency:6582>6270(余312)
PASS  ⑧ V16_ANCHOR + NET_MAX = contingency配额  →  4518+2064 = 6582 === 6582
```

### B-3 929B 边界独立推导

```
锁④严格 > ⇒ 允许最大实测 = 6582-1 = 6581
自 T0=5652 起安全 Δ = 6581-5652 = 929   → 期望 929 ⇒ PASS
本轮实际 Δ = 6270-5652 = 618  ≤929      ⇒ PASS
剩余可用（严格>口径）= 6581-6270 = 311  |  裸算差 = 6582-6270 = 312
```

**口径澄清（两个数字都对，勿混用）**：
- **312** = 配额 − 实测，是"裸算差"，`wiring-scan.js` 行尾注释与门禁 E 段打印用此口径；
- **311** = (配额−1) − 实测，是"锁④严格 `>` 之下**还能真正安全写入**的字节数"，排预算时必须按此口径。

二者相差 1，根源即 §2 所述比较符差异。QA 确认 DESIGN §1.3/§7.2 的 929B 论证与实现一致。

### B-4 V33 三针实读

```
$ grep -n "248537" test/wiring-scan.js test/qa-v13-t2t4-fix.test.js test/qa-v16-size-probe.js
test/wiring-scan.js:373            engineMax: 248537,
test/qa-v13-t2t4-fix.test.js:117   const V33 = 248537;
test/qa-v16-size-probe.js:38/50/77 ok(s.engine <= 248537 ...) / ①' 落位 248537 / ⑤' V33 === engineMax
```

三针**均为 248537**。因 SIZE_BUDGET 九值零改动、engineMax 为 `engineBase + engineNetMax` 派生量，两加数均未触碰 ⇒ V33 **同步条目数 = 0，天然不翻转**。QA 复核 `qa-v13-t2t4-fix.test.js:117` 不在本轮 diff 内（该文件唯一改动在 :79，见 §5）。

> **B 段结论：PASS。** 四锁恒等式与 ⑧ 全部成立，V33 三针一致且天然免同步。

---

## 三、C · H13 人设崩坏 0% 一票否决

```
$ npm run test:probe:fast
H13_FAST_EXIT=0

=== H13 破墙密闭性 · QA 独立探针 ===
人格卡 3 × 性别 2 × 输入 20 × 3turn
扫描回复行数: 480
泄漏条数: 0
泄漏率: 0.000%
H13 结论: PASS（0 泄漏）

（qa-v17-adversarial.js 同轮）
各模块 PERSONA_BREAK_RE.test 调用数: {"memory.js":2,"presence.js":1,"texture.js":1,"contingency.js":1}
ok  B-1 模块侧所有破墙判定均经 E.pnorm（无裸判/自造折叠）  0 处不一致
ok  B-2 engine.js 内所有破墙判定均经 pnorm（无裸判）        0 处裸判
总判定: PASS
```

**泄漏率 0.000%（0/480 行）**，exit 0。

### C-2 护栏本体未被触碰

```
$ diff <(git show HEAD:ai-girlfriend/engine.js | sed -n '1307p') <(sed -n '1307p' engine.js)
PASS: engine.js:1307 与 HEAD 逐字一致
```

`PERSONA_BREAK_RE` 位于 engine.js:1307，而 A 段已证 engine.js 整文件 SHA-256 与 HEAD 一致，故该正则**不可能被本轮改动影响**；此处再做单行比对作双保险。

### C-3 新增语料的独立复扫（不依赖工程师测试）

QA 直接加载引擎、取出 24 条 SFT 语料，用 engine 导出的四条正则自行复扫：

```
=== 破墙/钩子/绑架/指控 独立复扫 ===
  四项违规合计 = 0  PASS
（PERSONA_BREAK_RE(pnorm)=0 / RELATION_HOOK_RE 命中率 100% / GUILT_TRIP_RE=0 / ACCUSE_RE=0）
```

> **C 段结论：PASS。** H13 一票否决项 0% 泄漏，护栏本体逐字未动，新增语料经 QA 独立复扫无一违规。

---

## 四、D · 门禁红→绿 自制取证（最关键）

**验收立场**：门禁全绿只能证明"此刻没人越界"，**不能**证明"越界时门禁真会响"。工程师关于"T01 交付时红、T03 同步后绿"的叙事属于**不可复核的历史陈述**，QA 一律不采信，改为**亲手注入红样**，逐一确认门禁可证伪。

四次红样全部执行 → 全部转红 → 全部还原 → 全部复绿。演练前后指纹逐位一致。

### D-1 基线回退到 5652（模拟 T01 刚交付、基线未同步）

```
$ perl -pi -e 's/"contingency\.js": 6270,/"contingency.js": 5652,/' test/qa-v19-quota-gate.js
$ npm run test:probe
===红样1 EXIT=1（期望非0）===

--- B. diff=0 硬闸（实测字节 must === T0 基线）---
  ok   memory.js 字节 === 基线  → 实测 13333 / 基线 13333 / Δ+0
  ok   presence.js 字节 === 基线  → 实测 3566 / 基线 3566 / Δ+0
  ok   texture.js 字节 === 基线  → 实测 4366 / 基线 4366 / Δ+0
  FAIL contingency.js 字节 === 基线  → 实测 6270 / 基线 5652 / Δ+618

  ⚠ 检测到**未经重谈的源码 diff**。注意：这不等于超配额 ——
     · contingency.js  Δ+618B，当前仍余 312B 配额（四锁可能仍全绿）
  ▶ 请走配额重谈流程（DESIGN-v19 §4.4，三件套缺一即违规）...
     ✗ 禁止「先改 T0_BYTES 让 CI 变绿，再补流程」。

=== 配额门禁总判定: FAIL ===
失败项: [ "contingency.js 字节 === 基线" ]
```

**完全复现工程师所述的 T01 红态**，且输出正含 `实测 6270 / 基线 5652 / Δ+618`。
注意此时四锁 ①②③④ 仍全绿（④ 比的是 `配额 > 基线` = `6582>5652`），**红的是 B 段 diff=0 硬闸**——门禁对"未重谈的 diff"与"超配额"做了正确的语义区分。

**还原验证**：

```
$ perl -pi -e 's/"contingency\.js": 5652,/"contingency.js": 6270,/' test/qa-v19-quota-gate.js
3bb7e929281ccc04f9130133ced2d6c3f2a6733ee7515778f8cdc739bdf080c5  test/qa-v19-quota-gate.js
PASS: 与验收前基准逐位一致
PASS: 与备份零差异
===还原后门禁 EXIT=0（期望0）===   === 配额门禁总判定: PASS ===
$ git diff -- test/qa-v19-quota-gate.js
[空 = 无未暂存改动]
```

### D-2 contingency.js 追加 +5B（仍在配额内，但偏离基线）

证明门禁抓的是"**未经重谈的 diff**"，而非只抓超限。

```
$ printf '//ab\n' >> contingency.js       # 恰好 5 字节
contingency.js = 6275（基线6270，配额6582 ⇒ 仍在配额内）

$ node test/qa-v19-quota-gate.js
===红样2 EXIT=1（期望1）===
  FAIL contingency.js 字节 === 基线  → 实测 6275 / 基线 6270 / Δ+5
     · contingency.js  Δ+5B，当前仍余 307B 配额（四锁可能仍全绿）
  ok   ④ 逐模块配额 > 基线（配额不倒挂）  → ... / 6582>6270
=== 配额门禁总判定: FAIL ===
```

**关键取证**：仅 5 字节、距配额尚余 307B，门禁照样转红，而锁④保持绿。这证明 diff=0 硬闸**独立于配额余量**生效，"配额内随便改"的漏洞不存在。

**还原**：`cp` 回备份 → SHA `4169d1c7...` 一致 → 门禁 exit 0。

### D-3a 顶到超配额（6600 > 6582）

```
$ python3 -c "open('contingency.js','ab').write(b'//'+b'x'*327+b'\n')"
注入后 contingency.js = 6600（配额6582 ⇒ 已超限）

$ node test/qa-v19-quota-gate.js
===红样3a EXIT=1===
  FAIL contingency.js 字节 === 基线  → 实测 6600 / 基线 6270 / Δ+330
     · contingency.js  Δ+330B，当前仍已超配额 18B

$ node --test test/qa-rs2-type.test.js
业务测试 EXIT=1
not ok 17 - AC-RS2-8 · contingency.js ≤ SIZE_BUDGET 配额 ...
  error: 'contingency.js=6600B 超 6582B 配额（SIZE_BUDGET 单一真源；须先砍语料条数，
          不许动选择器/不许申请二次配额）'
```

超配额时**门禁与业务锁双双转红**，双保险成立。

### D-3b ★ 930B 边界真身（同步了基线的越界 —— 最危险场景）

D-1~D-3a 覆盖的都是"基线未同步"。但锁④的第二个操作数是 **T0_BYTES 基线常量，不是实测字节**，因此"把文件撑大"永远不会让锁④红。锁④真正翻转的时刻是——**有人合规地走完基线同步流程，却把 Δ 排到了 930**。QA 专门构造该场景：

```
# 实测顶到 6582，同时把门禁 T0_BYTES 同步到 6582（模拟"流程走全了但排到 930"）
实测 contingency.js = 6582
T0: 82:  "contingency.js": 6582,
自 5652 起 Δ = 930

$ node test/qa-v19-quota-gate.js
===D-3b EXIT=1（期望1）===

--- B. diff=0 硬闸 ---
  ok   contingency.js 字节 === 基线  → 实测 6582 / 基线 6582 / Δ+0     ← B 段被"合规同步"骗过

--- C. 四锁 ①②③④ + ⑧ 自证 ---
  ok   ① / ② / ③ / ⑧
  FAIL ④ 逐模块配额 > 基线（配额不倒挂）  → 13365>13333 / 3598>3566 / 4398>4366 / 6582>6582
=== 配额门禁总判定: FAIL ===
失败项: [ "④ 逐模块配额 > 基线（配额不倒挂）" ]
```

**同一时刻的业务侧**：

```
$ node --test test/qa-rs2-type.test.js
=== 业务锁 EXIT=0（仍绿）===   # tests 17 / # pass 17 / # fail 0
ok 17 - AC-RS2-8 · contingency.js ≤ SIZE_BUDGET 配额 ...

$ node --test test/qa-v15-t1.test.js
=== 业务锁 EXIT=0 ===          # pass 12 / # fail 0
```

> **★ 929B 边界得到实证**：在 Δ=930（实测 = 配额 = 6582）这一点上，
> **门禁锁④ 红**（`6582 > 6582` = false），而 **业务锁 17/17、12/12 全绿**（`6582 <= 6582` = true）。
> 业务侧对这次越界**毫无察觉**——DESIGN §1.3/§7.2 的论证与实现完全一致，
> 「排预算按 929 不按 930」这条铁律有真实取证支撑，非纸面推演。

**还原**：两文件均 `cp` 回备份，SHA 与验收前基准 `diff` 零差异。

### D-4 追加红样：D 段全目录扫描是否真的堵住了盲区（QA 自主追加）

R-2 声称把硬编码 4 文件扩为全目录，从而堵住"新开一个文件即可绕过"的旁路。但"扫描 37 文件，0 违规"本身也可能是**空转式假绿**。QA 遂构造该旁路的最经典形态——**新建一个文件**（旧门禁的 4 文件硬编码绝对看不见它）：

```
$ cat > test/zz-qa-bypass-probe.js <<'EOF'
const assert = require("assert");
assert.strictEqual(SIZE, 5671, "平行字面量旁路测试");
EOF

$ node test/qa-v19-quota-gate.js
===D段红样 EXIT=1（期望1）===
  FAIL 全目录断言性行中，平行字面量 5671/1180/2064 计数 = 0  →
      zz-qa-bypass-probe.js:4  [5671] v17 残差锁，应改读 SIZE_BUDGET["contingency.js"]
        assert.strictEqual(SIZE, 5671, "平行字面量旁路测试");
  ok   D 段非空转：全目录被扫文件数 >= 30  → 已扫描 38 个文件（其中 31 个含断言行）
=== 配额门禁总判定: FAIL ===
```

扫描集从 37 自动涨到 38 并**当场逮到新文件的 file:line**。清理后复跑：

```
$ rm test/zz-qa-bypass-probe.js && node test/qa-v19-quota-gate.js
EXIT=0
  ok  全目录断言性行中，平行字面量 5671/1180/2064 计数 = 0  → 扫描 37 文件，0 违规
```

**R-2 的盲区闭合是真实的，不是假绿。**

> **D 段结论：PASS。** 四次红样（+1 次 QA 自主追加）全部成功转红、全部干净还原。门禁**可证伪**，且对
> 「未重谈 diff」「超配额」「合规同步但排到 930」「新文件旁路」四类风险分别由不同的锁精确接住。

---

## 五、E · R-1 / R-2 / Q4 / U-4 实现正确性

### E-1（R-1）`qa-v13-t2t4-fix.test.js:79` 失败消息去字面量

```diff
- assert.strictEqual(B["contingency.js"], 6582, "v18 批准值 5671→6582（受援方 +911B · 残差式 27943−21361）");
+ assert.strictEqual(B["contingency.js"], 6582, "v18 批准值（旧配额见 wiring-scan.js v18 审批块）→ 6582（受援方 +911B · 残差式 27943−21361）");
```

- ✅ 文案中的 `5671` 已移除，改为指向 wiring-scan.js 审批块（单一真源）；
- ✅ 断言比较值**仍是 `6582`**，断言强度未被削弱（不破）；
- ✅ 该文件本轮**仅此一行**改动（`2 +-`），`:117` 的 `const V33 = 248537;` 未受影响。

### E-2（R-2）D 段扫描范围：硬编码 4 文件 → 全目录

```diff
-const SCAN_FILES = [
-  "qa-v15-t1.test.js", "qa-rs2-type.test.js",
-  "qa-v17-independent-size.js", "qa-v16-size-probe.js",
-];
+const SCAN_DIR  = path.join(ROOT, "test");
+const SCAN_GLOB = /\.js$/;
+const EXEMPT    = [];
+const ALL_FILES = fs.readdirSync(SCAN_DIR).filter((f) => SCAN_GLOB.test(f)).sort();
+const SCAN_FILES = ALL_FILES.filter((f) => !EXEMPT.some((e) => e.f === f));
```

- ✅ 已改为 `fs.readdirSync` **全目录扫描** `test/*.js`（不按 `.test.js` 后缀过滤，裸探针同样入网）；
- ✅ `EXEMPT` **出厂为空 `[]`**；
- ✅ 豁免协议校验落地：每项须 `{f, why}`，`why` 非空 + 文件必须真实存在，否则判红（僵尸豁免检测）；
- ✅ 实跑取证：`扫描 37 文件，0 违规` / `EXEMPT 出厂为空（0 项）`；
- ✅ **可证伪性已由 D-4 红样独立证明**（新建文件当场被抓）。

### E-3（Q4）`chk()` 标题自指消解

```diff
-chk("4 个测试文件的断言性行中，平行字面量 5671/1180/2064 计数 = 0",
+const BANNED_LABEL = BANNED.map((b) => b.n).join("/");
+chk(`全目录断言性行中，平行字面量 ${BANNED_LABEL} 计数 = 0`,
```

- ✅ 标题已由 `BANNED.map(b => b.n).join("/")` **动态拼接**，不再复述字面量；
- ✅ 新增 T05 元测试把该修复钉死：
  `ok 元测试 · 门禁自指：扫描自身命中 = 0 → qa-v19-quota-gate.js 在扫描集内 = true，自身命中 0`
  （同时断言门禁**必须在**扫描集内，杜绝"执法者豁免自己"）；
- ✅ 无自指误红：全目录扫描下门禁扫到自己，命中数为 0。

### E-4（U-4）`length >= 3` → `>= PER_TYPE(6)` —— 重点验证项

```diff
+const PER_TYPE  = 6;
+const SFT_TOTAL = TYPES.length * PER_TYPE;
+const MAX_ENTRY_BYTES = 57;
-  assert.ok(Array.isArray(C.SFT[y]) && C.SFT[y].length >= 3, y + " 语料条数不足 3（DESIGN §3.3）");
+  assert.ok(Array.isArray(C.SFT[y]) && C.SFT[y].length >= PER_TYPE,
+    y + " 语料条数不足 " + PER_TYPE + "（DESIGN-v20 §3.1.2：每型 3 → 6）");
-  assert.strictEqual(total, 12, "四型 × 3 条 = 12，实测 " + total);
+  assert.strictEqual(total, SFT_TOTAL, "四型 × " + PER_TYPE + " 条 = " + SFT_TOTAL + "，实测 " + total);
+  assert.strictEqual(seen.size, SFT_TOTAL, "语料全局唯一性失守：去重后仅 " + seen.size + " 条");
```

**QA 独立核验（绕开工程师测试，直接加载引擎实测）**：

```
=== U-4 独立核验：SFT 语料实测 ===
  stable     条数=6  PASS(>=6)
  expand     条数=6  PASS(>=6)
  challenge  条数=6  PASS(>=6)
  boundary   条数=6  PASS(>=6)
---
  总条数 = 24   期望 24 ⇒ PASS
  去重后 = 24   全局唯一 ⇒ PASS
  单条最大字节 = 54   上限57 ⇒ PASS
  单条最大字符 = 18   上限44 ⇒ PASS
```

**U-4 实现验证无误 ✅**，且实现质量高于要求：
- 阈值 `PER_TYPE` 与总数 `SFT_TOTAL = TYPES.length × PER_TYPE` **派生化**，未留第二个字面量（与 v19 三锁归一同口径）；
- 附带两项 QA 视角的加固：**单条字节上限 57B**（防"一条顶掉整批预算"）与 **Q-7 跨型全局去重**（防复制粘贴事故）——二者均由 QA 独立实测确认真实生效（最大 54B、24 条零重复）。

> **E 段结论：PASS。** R-1 / R-2 / Q4 / U-4 四项实现均正确，且 R-2、Q4 的有效性已由 QA 红样独立证伪验证。

---

## 六、F · ceiling-drill 自清理

```
$ npm run test:ceiling-drill
===CEILING_DRILL_EXIT=0===

--- 1. 派生安全线（全部现算，不写字面量）---
  配额 = 6582 / 锁④允许最大实测 = 6581 / v19 锚点 = 5652
  ★ 安全 Δ 上限 = 6581 − 5652 = 929  （不是 930！）
  门禁当前 T0 基线（正则抽取） = 6270
--- 2. 边界三判 ---
  ok  Δ=929（实测 6581）→ 锁④ 应绿      → 6582 > 6581 = true
  ok  Δ=930（实测 6582）→ 锁④ 应红 ★核心 → 6582 > 6582 = false
  ok  Δ=930（实测 6582）→ 业务锁仍绿 ★缺口实证 → 6582 <= 6582 = true
  ok  两把锁在越界点给出相反答案
--- 3. 临时目录构造超限副本 ---  ok（且临时目录已清理）
--- 4a. 未同步基线的越界 → B 段 diff 硬闸接住 ---  ok  exit = 1
--- 4b. 基线同步到越界值 → C 段锁④接住 ★核心 ---  ok  exit = 1
--- 4c. 自清理取证 ---
  ok ★ 演练前后真实 contingency.js 字节逐位不变  → 6270 → 6270
  ok ★ 演练前后真实 contingency.js 内容逐字节一致  → byte-identical
  ok ★ 演练前后门禁文件内容逐字节一致  → byte-identical
  ok ★ 复跑门禁确认已回到全绿  → exit = 0

=== 天花板演练总判定: PASS ===
```

### F-2 QA 独立复核仓库洁净度（不采信 drill 自报的 4c）

drill 的 4c 是**自证**，QA 另行在演练前后各取一次外部指纹比对：

```
$ sha256sum -c /tmp/pre_drill.sha
contingency.js: OK
test/qa-v19-quota-gate.js: OK
engine.js: OK
memory.js: OK
presence.js: OK
texture.js: OK

$ git status --short | grep -v '^??'     # 演练后与演练前逐行相同，无新增条目
M  contingency.js
A  docs/DESIGN-v20.md
A  docs/v20-evidence-pack.md
M  package.json
M  test/qa-rs2-type.test.js
M  test/qa-v13-t2t4-fix.test.js
M  test/qa-v19-quota-gate.js
A  test/qa-v20-ceiling-drill.js
M  test/wiring-scan.js
```

**仓库最终不脏**：无 contingency.js / 门禁文件的改动残留，无临时文件遗留。

### F-3 设计合理性评价（QA 视角）

- drill **不进** `npm test` / `test:probe` / `test:probe:fast`，仅 `npm run test:ceiling-drill` 手动跑 —— 段 4 存在真实改写窗口期，不该常驻 CI，此决策 QA 认同；
- 安全兜底三重（`try/finally` + 内存 Buffer 原文缓存 + `exit/SIGINT/SIGTERM/SIGHUP/uncaughtException` 钩子）齐备；
- 全脚本**不写** 929/930/6581/6582 任何阈值字面量，全部由 SIZE_BUDGET 派生，故不会自己成为第 5 个平行数字（也不会被 D 段全目录扫描抓到）；唯一字面量 `V19_ANCHOR = 5652` 有来源注释且不在 BANNED 之列，合规。

> **F 段结论：PASS。** 演练可复跑、取证为不可伪造的子进程退出码、自清理彻底。

---

## 七、遗留问题与观察

### P3-1（唯一遗留 · 文档性口径漂移 · 不阻断）

`test/qa-v19-quota-gate.js:40` 的 v20 变更说明写道：

```
①  D 段扫描范围：4 文件硬编码 → **全目录 test/*.js（36 个，不递归 fixtures/）**。
```

而实测 `ls test/*.js | wc -l` = **37**（本轮新增 `qa-v20-ceiling-drill.js` 后由 36 变 37，注释未同步）。

**影响评估：无功能风险。**
- 扫描集由 `fs.readdirSync` **运行时派生**，不依赖该注释数字；
- 非空转断言用的是 `SCAN_FILES.length >= 30` 阈值，非等值比较，不会误红；
- 该数字仅出现在注释中，不构成平行字面量（未被 BANNED 覆盖，也不影响 D 段）。

**建议**（可留待 v21 顺手处理，不必为此打回）：将注释中的"36 个"改为不写具体数字的表述（如"全目录 `test/*.js`（数量运行时派生）"），避免每次增删测试文件都产生新的口径漂移——这与本轮 R-1/Q4 "不留第二个可写位置"的治理精神一致。

### 观察-2（非问题，仅记录供 v21 参考）

`312`（配额−实测）与 `311`（安全可写余量）两个口径在 wiring-scan 注释、门禁 E 段、DESIGN 中并存。当前各处使用均正确且注释已说明成因，但 v21 排预算时若误取 312 会恰好踩中 930 边界。建议后续在门禁 E 段打印中**并排显示两个数字**并标注口径，进一步降低误读概率。

### 未发现的问题

- ❌ 无源码 Bug
- ❌ 无零预算破口
- ❌ 无四锁破口
- ❌ 无 H13 泄漏
- ❌ 无门禁不可证伪问题（四类风险均已红样验证）
- ❌ 无 R-1 / R-2 / Q4 / U-4 实现错误

---

## 八、终态审计

验收过程共注入 5 次临时改动（D-1、D-2、D-3a、D-3b、D-4），**全部已还原**。终态与验收开始时逐位一致：

```
$ sha256sum -c /tmp/pre_drill.sha
contingency.js: OK          test/qa-v19-quota-gate.js: OK
engine.js: OK               memory.js: OK
presence.js: OK             texture.js: OK

$ 终态字节实测
  engine.js        248395
  memory.js        13333
  presence.js      3566
  texture.js       4366
  contingency.js   6270
```

**终态四件套全绿复跑**：

| 命令 | exit | 结果 |
| --- | --- | --- |
| `npm test` | 0 | 350 passed / 0 failed |
| `npm run test:probe` | 0 | 6 探针全 PASS |
| `npm run test:probe:fast` | 0 | H13 泄漏 0 条 / 0.000% |
| `npm run test:ceiling-drill` | 0 | 天花板演练 PASS，仓库零残留 |

QA 未修改任何产品/测试逻辑源码；本报告为本次验收唯一新增文件。

---

## 九、验收项清单总表

| # | 验收项 | 自制证据 | 结论 |
| --- | --- | --- | --- |
| A-1 | 改动集不含 engine/memory/presence/texture | `git diff HEAD --name-only` + grep | ✅ PASS |
| A-2 | 三模块（+engine）逐位不变 | SHA-256 HEAD vs WT 全文比对 + numstat（含反向自检） | ✅ PASS |
| A-3 | fs.statSync 五文件实测 | 248395/13333/3566/4366/6270 | ✅ PASS |
| A-4 | contingency Δ=+618 ≤ 929 | 6270−5652=618 | ✅ PASS |
| A-5 | SIZE_BUDGET 九值冻结 | HEAD/WT/期望 三方比对，9/9/9 | ✅ PASS |
| B-1 | `npm test` 350/0 | exit 0 | ✅ PASS |
| B-2 | `test:probe` 6 探针 | exit 0 | ✅ PASS |
| B-3 | 四锁 ①②③④ + ⑧ 手工验算 | QA 自算，不引门禁自报 | ✅ PASS |
| B-4 | 929B 边界独立推导 | 6581−5652=929 | ✅ PASS |
| B-5 | V33 三针 = 248537 且天然不翻转 | grep 实读三处 | ✅ PASS |
| C-1 | H13 泄漏率 0% | 0/480 行，0.000% | ✅ PASS |
| C-2 | `PERSONA_BREAK_RE` 未被改动 | engine.js:1307 逐字比对 + 全文 SHA | ✅ PASS |
| C-3 | 新增语料独立复扫四正则 | QA 直接加载引擎，0 违规 | ✅ PASS |
| D-1 | 基线回退 5652 → 门禁红 | exit 1，`实测6270/基线5652/Δ+618` | ✅ PASS |
| D-2 | +5B 配额内偏离基线 → 门禁红 | exit 1，Δ+5，锁④仍绿 | ✅ PASS |
| D-3a | 超配额 6600 → 门禁+业务双红 | exit 1 / exit 1 | ✅ PASS |
| D-3b | **Δ=930 → 锁④红、业务锁全绿** | exit 1 vs 17/17+12/12 绿 | ✅ PASS |
| D-4 | 新文件旁路 → D 段抓获（QA 追加） | exit 1，扫描 37→38，file:line 定位 | ✅ PASS |
| D-5 | 所有红样干净还原 | SHA 比对 + `git diff` 空 | ✅ PASS |
| E-1 | R-1：`5671` 移出文案，断言仍 6582 | diff 复核 | ✅ PASS |
| E-2 | R-2：全目录扫描 + EXEMPT 空 | 代码复核 + D-4 红样证伪 | ✅ PASS |
| E-3 | Q4：标题 BANNED 派生，无自指误红 | 代码复核 + 元测试实跑 | ✅ PASS |
| E-4 | **U-4：`>= PER_TYPE(6)` 实现正确** | QA 独立实测 6/6/6/6、24 条、唯一、≤54B | ✅ PASS |
| F-1 | ceiling-drill exit 0 | 全段 ok | ✅ PASS |
| F-2 | 演练后仓库不脏 | 外部 SHA 比对 + git status | ✅ PASS |

**总计 25 项，25 项 PASS，0 项 FAIL。**

---

## 十、最终结论

> # ✅ 验收通过（PASS）
>
> v20 作为"零字节纪律时代的第一次有意花钱"，QA 独立验证确认：
> 1. **零预算封顶成立** —— 四大核心模块逐位不变，SIZE_BUDGET 九值一个字节未动，
>    唯一支出 contingency.js Δ=+618B，安全落在 929B 边界内（余量 311B）；
> 2. **四锁 / V33 / H13 全部成立** —— 350+6 测试全绿，H13 泄漏率 0.000%；
> 3. **门禁真实可证伪** —— 四类越界风险经 QA 亲手注入红样逐一确认能被精确接住，
>    尤以 Δ=930 场景实证「门禁红而业务侧全绿」的一字节缺口，
>    DESIGN §1.3/§7.2 的 929B 论证获得可复跑的实证支撑；
> 4. **R-1/R-2/Q4/U-4 实现无误**，其中 R-2 的盲区闭合经新文件旁路红样独立证伪验证；
> 5. **未发现任何源码 Bug**，遗留 1 项 P3 文档性口径漂移（注释"36 个"↔实测 37），不阻断交付。
>
> 建议合入。

---

*报告人：严过关（Yan）· QA 工程师 · 独立验收，不采信工程师自检结论*

