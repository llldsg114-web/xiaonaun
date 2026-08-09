# v21 工程师取证包

> 作者：工程师 寇豆码（Kou）。本文只放**实跑证据**，不含验收结论。
> 验收由 QA 独立进行，`docs/QA-ACCEPTANCE-v21.md` **本轮未创建**（该文件属 QA 产出）。

## 0. 一句话

D 闸（T01/T02，SW 缓存逃逸）先于 A 闸（T03/T04，第 5 语料型 + 配额重谈）完成；
`contingency.js` 实测 **6626 B**（Δ+356，配额 6682，余 56）；四锁 + ⑧ 全绿；
`engine.js` 零改动、H13 **0 泄漏**；`npm test` **351/0**，三条 npm 命令 exit 0。

## 1. 命令级证据

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm test` | `# tests 351 / # pass 351 / # fail 0` | 0 |
| `npm run test:probe` | 7 个探针全 PASS | 0 |
| `npm run test:probe:fast` | H13 + adversarial 全 PASS | 0 |
| `node test/qa-v19-quota-gate.js` | 配额门禁总判定 PASS | 0 |
| `node test/qa-v21-sw-guard.js` | TD 守卫总判定 PASS | 0 |
| `node test/qa-probe-h13.js` | **H13 结论: PASS（0 泄漏）** | 0 |

`test:probe` 逐项：`qa-probe-mutation` / `qa-v17-adversarial` / `qa-v17-independent-size` /
`qa-probe-h13` / `qa-probe-v15-acceptance` / `qa-v19-quota-gate` / `qa-v21-sw-guard`，
均独立 exit 0。新增守卫已接入 `test:probe`（不是孤儿探针）。

> 基线 350 → 351：净增 1 条，即新增的 `AC-RS2-9`（钉死第 5 型「数据已落地但未被路由」的现状）。

## 2. 体积与四锁（实测）

```
--- E. 真实缓冲 ---
  memory.js        13333 / 配额  13365   余   32
  presence.js       3566 / 配额   3598   余   32
  texture.js        4366 / 配额   4398   余   32
  contingency.js    6626 / 配额   6682   余   56
  （派生）NET_MAX     2164 = 配额 6682 − 锚点 4518
  engine.js(净增)    2658 / 上限   2700   余   42   ← 净增 = 248395 − engineBase 245737
  Σ 四模块           27891 / 上限  28043   余  152
  总量              276286 / 上限 276480   余  194

--- C. 四锁 ①②③④ + ⑧ 自证 ---
  ok ① 248437 === 245737 + 2700
  ok ② 28043 === 28043（受控见证值 28043）
  ok ③ 276480 === 276480（松弛 0）
  ok ④ 13365>13333 / 3598>3566 / 4398>4366 / 6682>6626
  ok ⑧ 4518 + 2164 = 6682 === 6682
```

**929B 边界纪律**：锁④ 用严格 `>`，故 contingency 上限是 6681 而非 6682；
实测 6626 距严格上限 **余 55**、距配额裸差 56。两者已在门禁 E 段并排打印，无歧义。

## 3. T03 → T04 的「先红后绿」（设计预期，非事故）

**T03 交付后、T04 同步前**（基线仍 6270）：

```
FAIL contingency.js 字节 === 基线  → 实测 6626 / 基线 6270 / Δ+356
FAIL ② Σ(4 模块配额) === moduleSumMax  → 28043 === 28043
     ⚠ · contingency.js  Δ+356B，当前仍余 56B 配额（四锁可能仍全绿）
=== 配额门禁总判定: FAIL ===
```

**T04 履行三件套后**：`ok contingency.js 字节 === 基线 → 实测 6626 / 基线 6626 / Δ+0`，
门禁总判定 **PASS**。

> ② 当时同红是因为门禁自带的第二证人字面量仍是旧值 —— 这正是它存在的意义：
> 真源被改了而见证人没跟上，锁② 立刻报警，而不是跟着真源一起悄悄右移。

## 4. TD 守卫反向取证（四条，全部实跑）

| # | 构造 | D 段 | F6 | 总判定 | 退出码 |
|---|---|---|---|---|---|
| **A** | CACHE 退回 v23 + 清单同步退回 v23（contingency 已改） | 🔴 红 | ok | FAIL | 1 |
| **B** | CACHE=v24 + 清单重算（正常态） | ok | ok | **PASS** | 0 |
| **C** | **洗白**：不升键，只把 `assets` 重算到与工作区一致 | 🔴 红 | ok | FAIL | 1 |
| **D** | **伪造基线**：把 `released.assets` 挪到当前值 | ok（被骗过） | 🔴 红 | FAIL | 1 |

取证 A 原文：

```
FAIL D · 非「内容已变而缓存键未升」态
  → 相对发布基线 "xiaonuan-v23" 捕获 1 个资产内容漂移，而 CACHE 仍是 "xiaonuan-v23"（未升键）
  ▸ /contingency.js  (6626B, 现算 a4b98b99f608… / 基线 df13af95a589…)
  🔴 这正是 v20 逃逸的复现形态（C0-b 同族事故）
```

**取证 C 是本轮最关键的一条**：A 段绿、B 段绿、C 段**全绿**（清单确实"重算"到位）、
E/F 全绿，唯独 D 段红。守卫初版在这个状态下会**全绿放行** —— 这就是 T06 自查修出来的缺陷。

**取证 D** 证明纵深防御成立：伪造基线能骗过 D 段，但 F6 用 `git show b36842f` 独立复算把它抓住，
同时 F 段的 ⚠ 提示（「升了个空版，或 released.assets 刚被挪到当前状态」）一并触发。

取证后三个文件已按 `/tmp/{sw,mf,ctg}.bak` 逐字还原，还原后守卫 exit 0。

## 5. v20 逃逸的机器化复盘

`xiaonuan-v23` 铸于 `b36842f`（v18 收线）。以该 commit 为基线对 13 个 ASSETS 全量比对：

```
/                 30161B → 30161B   一致        /texture.js        4366B →  4366B   一致
/index.html       30161B → 30161B   一致        /contingency.js    5652B →  6626B   ⚠ 漂移
/style.css        42437B → 42437B   一致        /manifest.json      592B →   592B   一致
/engine.js       248395B →248395B   一致        /icon-192.png      6712B →  6712B   一致
/app.js          185632B →185632B   一致        /icon-512.png     20827B → 20827B   一致
/localmodel.js     4307B →  4307B   一致
/memory.js        13333B → 13333B   一致        ★ 漂移 1 / 13
/presence.js       3566B →  3566B   一致
```

**13 个资产中只有 `/contingency.js` 漂移过**，而 v19、v20 两版都没升键 ——
守卫在无人提示的情况下独立指认出了逃逸当事人，与人工事后复盘完全一致。

## 6. H13 一票否决核验

```
$ git status --short engine.js
（空 —— engine.js 本轮零改动）
$ node test/qa-probe-h13.js
H13 结论: PASS（0 泄漏）
```

`engine.js:1307` `PERSONA_BREAK_RE` 一字未动。第 5 语料型是**兜底语料数据**，
不是正则、不是人格判定，与破墙闭环无交集。

## 7. 本轮改动文件（git status，已排除 charts/ 与微信 dump）

```
 M contingency.js                     M test/qa-v15-t2.test.js
 M package.json                       M test/qa-v16-size-probe.js
 M sw.js                              M test/qa-v17-independent-size.js
 M test/qa-rs2-type.test.js           M test/qa-v19-quota-gate.js
 M test/qa-v13-t1.test.js             M test/wiring-scan.js
 M test/qa-v13-t2t4-fix.test.js      ?? docs/CHANGELOG.md
 M test/qa-v13-t5b.test.js           ?? test/qa-v21-sw-guard.js
 M test/qa-v15-t1.test.js            ?? test/sw-assets-manifest.json
```

（`docs/DESIGN-v21.md` / `docs/PRD-v21.md` 为上游产出，本轮仅由工程师回填 §11。）

## 8. 移交 QA 时建议重点复核

1. **取证 C（洗白免疫）**能否独立复现 —— 这是 TD 闸真正的承重点。
2. `released` 基线是否应被追认进 DESIGN §2.3 schema（工程师已标注需架构师裁定）。
3. **第 5 型未被 `sfType()` 路由**：PRD-v21 P0-6/AC-7 与 DESIGN-v21 T03 冲突，
   本轮遵从 DESIGN，并用 `AC-RS2-9` 把现状钉死。这条分歧**尚未解决**，需主理人裁定。
4. F6 的降级残留（删 `.git` 可使基线复算退化）是否接受。
5. 锁④ 余量已压到 **56B**（严格口径 55B），engine 侧可让渡量仅剩 **42B** ——
   下一轮若还要增语料，两条最廉价的路径都接近枯竭。
