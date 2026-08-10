# v22 证据包 · 工程师自审取证（非 QA 结论）

> ⚠ **本文件不是 QA 验收报告**（那由 QA 严过关独立出具 `QA-ACCEPTANCE-v22.md`）。
> 这是**工程师（寇豆码 Kou）自审 IS_PASS 的取证归档**：记录四锁实跑、引脚归零、SW 守卫红→绿
> 三项硬证据，以及改动面与字节增量。供 QA 复核时对照，不构成验收结论。

---

## 0. 改动面总览（相对 v21）

| # | 文件 | 落点 | 性质 | Δ | 落位 |
|---|---|---|---|---|---|
| 1 | `engine.js` | `:1307` | `PERSONA_BREAK_RE` 连接词枚举扩展（单行） | +41 | 248395 → **248436** |
| 2 | `contingency.js` | `:33-35` | `sfType()` 增 `repair` 分支（方案 E，含当日冲突门） | +38 | 6626 → **6664** |
| 3 | `sw.js` | `:2` | `CACHE` `xiaonuan-v24` → **`v25`**（C0-b） | — | — |
| 4 | `test/wiring-scan.js` | `:401-:407` | SIZE_BUDGET 六值更新 + v22 审批块 | — | — |
| 5 | `test/qa-v19-quota-gate.js` | `:108/:115` | `T0_BYTES.contingency` 6664；`MODULE_SUM_WITNESS` 28003 | — | — |
| 6 | 13 文件 V33/配额引脚 | 见 §2 | 全量同步（7 配额字面量 + 6 实测值族） | — | — |
| 7 | `test/qa-rs2-type.test.js` | `:345` | **AC-RS2-9 改写**：反向不可达 → 正向可达（A-3 假绿修复） | — | — |
| 8 | `test/qa-v22-h13-closure.js` | 新增 | H13 覆盖闭合三段取证 | — | — |
| 9 | `test/qa-v22-repair-route.js` | 新增 | repair 路由三段取证 | — | — |
| 10 | `test/sw-assets-manifest.json` | — | `cacheVersion`→v25；重算 `/engine.js` `/contingency.js` 两 sha256；**released 不动** | — | — |
| 11 | `package.json` | `test:probe` | 追加两新探针 | — | — |

**未改动**：memory.js / presence.js / texture.js 文件内容零改动（仅调其配额数字）；`docs/CHANGELOG.md` 与 `docs/QA-ACCEPTANCE-v21.md` 逐字未动（v21 交付物保护）。

---

## 1. 四锁实跑输出（node test/qa-v19-quota-gate.js · 工程师现跑）

```
=== QA v19 配额门禁（四模块 diff=0）===

--- B. diff=0 硬闸（实测字节 must === T0 基线）---
  ok   memory.js 字节 === 基线  → 实测 13333 / 基线 13333 / Δ+0
  ok   presence.js 字节 === 基线  → 实测 3566 / 基线 3566 / Δ+0
  ok   texture.js 字节 === 基线  → 实测 4366 / 基线 4366 / Δ+0
  ok   contingency.js 字节 === 基线  → 实测 6664 / 基线 6664 / Δ+0

--- C. 四锁 ①②③④ + ⑧ 自证 ---
  ok   ① engineMax = engineBase + engineNetMax  → 248477 === 245737 + 2740
  ok   ② Σ(4 模块配额) === moduleSumMax  → 28003 === 28003（受控见证值 28003）
  ok   ③ engineBase+engineNetMax+moduleSumMax === totalMax（slack=0）  → 276480 === 276480（松弛 0）
  ok   ④ 逐模块配额 > 基线（配额不倒挂）  → 13352>13333 / 3585>3566 / 4384>4366 / 6682>6664
  ok   ⑧ V16_ANCHOR + NET_MAX ≡ SIZE_BUDGET[contingency.js]  → 4518 + 2164 = 6682 === 6682

--- D. 单一真源回归扫描（全目录 · 不得再出现平行字面量）---
  ok   全目录断言性行中，平行字面量 5671/1180/2064 计数 = 0  → 扫描 40 文件，0 违规
  ok   D 段非空转：全目录被扫文件数 >= 30 且多数文件含断言行  → 已扫描 40 个文件（其中 32 个含断言行）
  ok   元测试 · 门禁自指：扫描自身命中 = 0  → qa-v19-quota-gate.js 在扫描集内 = true，自身命中 0
  ok   豁免清单无腐化：每项 why 非空且文件真实存在  → EXEMPT 出厂为空（0 项）

--- E. 真实缓冲 ---
  memory.js        13333 / 配额  13352   余   19
  presence.js       3566 / 配额   3585   余   19
  texture.js        4366 / 配额   4384   余   18
  contingency.js    6664 / 配额   6682   余   18
  （派生）NET_MAX     2164 = 配额 6682 − 锚点 4518
  engine.js(净增)    2699 / 上限   2740   余   41   ← 净增 = 248436 − engineBase 245737
  Σ 四模块             27929 / 上限  28003   余   74
  总量                276365 / 上限 276480   余  115

=== 配额门禁总判定: PASS ===
```

**四锁逐锁复核**

| 锁 | 判据 | v22 代入 | 结论 |
|---|---|---|---|
| ① | `engineMax = engineBase + engineNetMax` | `248477 = 245737 + 2740` | ✅ |
| ② | `Σ(4 quota) = moduleSumMax`（双证人） | `13352+3585+4384+6682 = 28003` | ✅ |
| ③ | `engineBase+engineNetMax+moduleSumMax ≤ totalMax`，slack=0 | `245737+2740+28003 = 276480 ≤ 276480` | ✅ |
| ④ | 每模块配额 **严格 >** 实际 | `13352>13333`(19)/`3585>3566`(19)/`4384>4366`(18)/`6682>6664`(18) | ✅ |
| ⑧ | `V16_ANCHOR + NET_MAX ≡ contingency 配额` | `4518 + 2164 = 6682` | ✅ |
| 附 | `engineNet ≤ engineNetMax` | `2699 ≤ 2740`，余 41 ≥ 35 | ✅ |
| 附 | `engine.js ≤ engineMax`(V33) | `248436 ≤ 248477`，余 41 | ✅ |
| 附 | `totalMax` 未抬顶 | `276480` 逐位不变 | ✅ |

---

## 2. V33 / 配额引脚归零（grep · 仅限 test/ 活代码）

实测命令（DESIGN §5 T-v33 硬判据，范围严格限定 `test/`，`docs/` 历史沿革允许保留）：

```bash
grep -rnE '\b(248437|2700|2658|248395|571|28043|13365|3598|4398)\b' test/ | grep -v '^\S*:[0-9]*: *[/*]'
```

**实跑结果**：

```
0 residual live-code pins (PASS)
```

> 全 9 类旧字面量在 `test/` 活代码（assert/赋值）中**零残留**；注释内历史沿革叙述不在扫描范围（符合 DESIGN §5「`docs/` 必须排除」纪律）。
> 反向落位已验证：`248477` 落 7 个 V33 配额文件，`2699/612/248436/6664/28003/13352/3585/4384` 各自就位；
> `npm test`（351 项）与 `qa-v16-size-probe.js` 双双 PASS，13 文件与 `SIZE_BUDGET` 数值闭环。

---

## 3. SW 守卫 红→绿（node test/qa-v21-sw-guard.js）

**实施前（saved /tmp/v22-sw-guard-before.txt）**：

```
FAIL · C · /engine.js
FAIL · C · /contingency.js
=== TD 守卫总判定: FAIL ===
```

**实施后（现跑）**：

```
  ASSETS 成员           13 项，已全部现算 sha256
  vs manifest 漂移      0 项（清单同步性）
  vs 发布基线 漂移      2 项（本轮真正要下发的内容）

=== TD 守卫总判定: PASS ===
```

达成手段（C0-b 强制）：
- `sw.js` `CACHE` `xiaonuan-v24` → **`xiaonuan-v25`**（在 `v24 是否已发布` 不可判定时取保守分支，避免第四犯 C0-b 事故）。
- `test/sw-assets-manifest.json` `cacheVersion` → `xiaonuan-v25`；`/engine.js` sha256 → `ab272002cfabd23f0db4b50a90b89595e93d22748501809292de1b3333d71079`；`/contingency.js` sha256 → `38aeafdc347a291a65db4d6d1f5e623e7613a908ff189552cc2de776dfaa6093`（均对实际文件现算）。
- **`released` 块逐字不动**（仍锚 `xiaonuan-v23` / `git b36842f`），`git diff` 已核：仅 `cacheVersion` 与两资产哈希变更，`released` 零改动（C-2 洗白免疫 + 反逃逸参照系保护）。

---

## 4. 功能验收闸（A-3 假绿修复 · 正向断言）

### 4.1 AC-RS2-9 改写（test/qa-rs2-type.test.js:345）

| 维度 | v21（旧·反向断言） | v22（新·正向断言） |
|---|---|---|
| 断言形态 | 笛卡尔扫描 `hit===0` 证「不可达」 | 证「可达」+ 五型不遮蔽 + 平静对话不冒道歉 |
| A-3 假绿根因 | `baseState` 无 `negGate` ⇒ `O(s.negGate).count` 恒 undefined ⇒ `>0` 恒 false ⇒ `hit===0` 仍成立 ⇒ **报绿但生产已可达** | 构造态**显式带 `negGate`**，正面证明可达；并反向补刀（negGate.count=0 平静对话扫描，repair 命中必=0） |

现跑结果：`node --test test/qa-rs2-type.test.js` → `# pass 18 / # fail 0`，含 `ok 18 - AC-RS2-9 · repair 路由可达：五型互不遮蔽 + 平静对话不冒道歉（AC-3.6 · 正向断言）`。

### 4.2 新增探针（test:probe 已接线）

**`qa-v22-h13-closure.js`**（H13 闭合 · 端口径单一真源）：
```
红样拦截:     12/12  OK
良性零误伤:   14/14  OK
语料零流失:   INNER_LIB=136(期望136) innerScan=0  OK
SFT 五型破墙: 0  OK
H13 闭合结论: PASS
```

**`qa-v22-repair-route.js`**（repair 路由启用 · AC-3.6 + H15）：
```
五型可达性:   OK
AC-3.6 平静对话冒道歉: 0/1440  OK
H15 单 key "sf": OK
H15 repair 单类占比: 3.1% (≤50%)  OK
repair 路由结论: PASS
```

---

## 5. 全量自审 IS_PASS 汇总

| 门 | 命令 | 结果 |
|---|---|---|
| 单元/集成 | `npm test`（node --test test/*.test.js） | **351 pass / 0 fail** |
| 探针全量 | `npm run test:probe` | **9/9 PASS**（含 2 新探针） |
| 探针快速 | `npm run test:probe:fast` | **2/2 PASS** |
| 四锁 | `qa-v19-quota-gate.js`（§1） | **PASS** |
| 引脚归零 | grep（§2） | **0 residual** |
| SW 守卫 | `qa-v21-sw-guard.js`（§3） | **PASS（红→绿）** |

### 字节增量对账

- engine.js：`248395 → 248436`（+41，仅 `:1307` 一行；`:1310`/`:1322`/其余逐字未动）
- contingency.js：`6626 → 6664`（+38，仅 `:33-35` 选择器；`selfOf`/`selfAllow`/`:43`/:44 门零改动）
- sw.js：CACHE 升 v25（不计入四锁预算）
- 三零增长模块回让 40B（memory 13 / presence 13 / texture 14）→ engine 余量恢复 41B
- totalMax `276480` 逐位不动（270KB 承诺守住）

### 纪律合规声明

1. engine.js 零预算纪律：**本轮仅 `:1307` 一行改动**，由 `A1-c` 定点白名单与 `AC-N2-5` 改动面两条测试机器校验。
2. H13 单一真源：`PERSONA_BREAK_RE` 仅 `engine.js:1307` 一处 `const`；消费点（`:1322/:1382/:1393/:1435/:1461/:2488/:2935`）与 `memory.js:100 taint()`、`contingency.js:65 L5` 复用，无第二拷贝。
3. `released` 治理等级同 `T0_BYTES`，v22 功能轮不携带发布动作，`released` 块零改动（C-2）。
4. 未改动 v21 交付物（`QA-ACCEPTANCE-v21.md` / `CHANGELOG.md`）；本证据包为工程师自审归档，**非 QA 验收报告**。

---

**工程师自审结论：IS_PASS = YES**（详见 §5 全量门禁表，六项全绿）。
