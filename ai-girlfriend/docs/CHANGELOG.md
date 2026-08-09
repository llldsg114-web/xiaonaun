# CHANGELOG

> 本文件自 v21 起建立。v20 及更早的变更记录见 `docs/DESIGN-v*.md` 与 `docs/QA-ACCEPTANCE-v*.md`。

## v21

### TD · Service Worker 缓存逃逸修复（P0 前置闸）

- `sw.js`：`CACHE` `xiaonuan-v23` → **`xiaonuan-v24`**。
  一次升版覆盖两笔资产变更：① 补还 **v20 欠账**（v20 改了 `contingency.js` 却未升键，属 C0-b 同族事故）；
  ② v21 本轮 `contingency.js` 再次改动。
- 新增 `test/sw-assets-manifest.json`：ASSETS 各成员的 sha256 指纹 + 对应 `cacheVersion`，
  是「内容 ↔ 版本」的唯一真相源。
- 新增 `test/qa-v21-sw-guard.js`：CI 期现算各 ASSETS 文件 sha256 与 manifest 比对，
  内容变而缓存键未升 → 转红。只报告，不修改 `sw.js`。
- 修正两处方向反了的旧快照断言（`qa-v13-t5b.test.js` / `qa-v15-t2.test.js`）：
  `strictEqual(cur, 23)` 人工钉死 → 改为跟随 `manifest.cacheVersion` 真相源。

#### ★ T06 自查修正：清单增加 `released` 发布基线块

守卫初版用 `manifest.cacheVersion === CACHE` 判定「版本没升」，**这是错的** ——
该字段的语义是「这批哈希隶属于哪个键」，它本来就必须等于 `CACHE`（A 段的职责）。
「升没升版」是相对**上一次真正发布出去的键**而言，而初版清单里不存在这个概念，
于是守卫无法计算自己声称要判的谓词；重算清单即可让「偷改资产不升键」一并转绿。

清单 schema 因此扩展为：

```jsonc
{
  "cacheVersion": "xiaonuan-v24",     // 待发布键；下方 assets 隶属于它
  "released": {                        // ★受控基线，只在「真正发版」时移动
    "cacheVersion": "xiaonuan-v23",
    "provenance": "git b36842f（v18 收线提交，即 v23 铸键点）",
    "assets": { "...": "v23 铸键时的 13 条指纹" }
  },
  "assets": { "...": "工作区当前 13 条指纹" }
}
```

反逃逸判据（守卫 D 段）：
`∃ 资产现算哈希 ≠ released.assets[该资产] ∧ CACHE === released.cacheVersion ⇒ 红`。
洗白免疫：只重算 `assets` 动不了 `released`，漂移依旧存在 ⇒ 强制升键。
守卫 F 段进一步守住基线自身（命名可比、单调不回退、无僵尸条目、指纹格式、
provenance 非空、**F6 按 provenance 用 `git show` 独立复算**防伪造）。

基线取值依据（可审计）：`xiaonuan-v23` 铸于 `b36842f`（v18 收线），此后 **v19 / v20 两版都没升键**。
以该 commit 为基线实测，13 个资产中**只有 `/contingency.js` 漂移**（5652 → 6626）——
机器独立指认出了 v20 逃逸的当事人。

### 清单重算程序（改被缓存文件后必做）

> 守卫刻意**不提供 `--write`**：那等于给「改了资产不升版」发一个一键变绿按钮。
> 重算前必须先确认 `CACHE` 已相对**已发布键**升版。

```bash
cd ai-girlfriend && node -e '
const fs=require("fs"),crypto=require("crypto");
const sw=fs.readFileSync("sw.js","utf8");
const CACHE=sw.match(/const\s+CACHE\s*=\s*"([^"]+)"/)[1];
const A=[...sw.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const R=a=>{const r=a.replace(/^\//,"");return r===""?"index.html":r;};
const P="test/sw-assets-manifest.json", m=JSON.parse(fs.readFileSync(P,"utf8"));
m.cacheVersion=CACHE;
for(const a of A) m.assets[a]=crypto.createHash("sha256").update(fs.readFileSync(R(a))).digest("hex");
fs.writeFileSync(P,JSON.stringify(m,null,2)+"\n");
console.log("已重算 assets，cacheVersion =",CACHE);'
node test/qa-v21-sw-guard.js     # 必须 exit 0
```

**`released` 块不由上述脚本触碰**。它只在版本真正发布给用户后手工推进（连同 provenance
的 commit 号一起更新），与配额门禁的 `T0_BYTES` 同级纪律。

### TA · SFT 第 5 语料型 + 配额路径③ 首次实战（P0 业务主体）

- `contingency.js`：SFT 追加第 5 型 **`repair`（修复/回暖）** 6 条，
  **6270 → 6626 B（Δ+356，配额 6682，余 56）**。本轮为**纯数据增补**，
  `sfType()` 路由未改（见下方「待裁定」）。
- 该 Δ 越过旧配额严格上限 6581，触发 v19 建制以来**首次「超封顶重谈」**，
  走 **路径③（engine 让渡 D=100B）**，主理人 Qi 于 Q3 批准锁② 两边同步右移：

  | 项 | v20 | v21 |
  |---|---|---|
  | `engineNetMax` | 2800 | **2700** |
  | `engineMax` / V33 | 248537 | **248437** |
  | `moduleSumMax` | 27943 | **28043** |
  | `SIZE_BUDGET["contingency.js"]` | 6582 | **6682** |

  四锁 + ⑧ 全部成立：① `248437 = 245737 + 2700`；② `Σ4 = 28043`；
  ③ `276480`（松弛 0）；④ `13365>13333 / 3598>3566 / 4398>4366 / 6682>6626`；
  ⑧ `4518 + 2164 = 6682`。engine 侧余量由 142B 收窄至 **42B**（有代价，已追认）。
- V33 钉点**全量**同步为 248437，共 5 处（PRD 的「三针」清单不完整）：
  `wiring-scan.js`（真源）、`qa-v13-t2t4-fix.test.js:117`、`qa-v16-size-probe.js`、
  `qa-v17-independent-size.js`（TRUTH 副本）、`qa-v13-t1.test.js:95`。
- `qa-v19-quota-gate.js`：`T0_BYTES["contingency.js"]` 6270 → **6626**（`fs.statSync` 实测）；
  锁② 第二证人 27943 → 28043。**基线同步刻意与语料落地分成两个任务**，
  中间保留了门禁必然转红的窗口（先红后绿，逼出显式手续）。

### TC · 技术债清扫（P2 顺风车）

- `qa-v19-quota-gate.js:40` 注释「36 个」去具体化 —— 该数字在 v20 交付当日即漂移为 37、
  本轮增补守卫后为 38；它是 `readdirSync` 的**结果**而非**约定**，写进注释等于开第二个可写位置。
- 同文件重谈提示中的「engine 让渡 ≤142B」改为**运行时现算**（v21 后实为 42B，硬写即误导）；
  「须 V33 三针同步」改为指向 DESIGN-v21 §1.2 完整钉点清单（「三针」会让人以为改完 3 处就齐了）。
- E 段增补 engine 净增 / Σ 四模块 / 总量三行缓冲打印（PRD-v21 P2-3）——
  「142B 腐化」的根因正是 engine 余量从不打印、只能人工心算。

### 未变更（显式声明）

- **`engine.js` 本轮零改动**（`git status` 空），`:1307` `PERSONA_BREAK_RE` 一字未动 —— H13 0% 一票否决。
- `memory.js` / `presence.js` / `texture.js` 字节零改动，各仍余 32B。

### 待主理人 / 架构师裁定（工程师不自行决断）

1. **第 5 语料型是否应被 `sfType()` 路由**（PRD 与 DESIGN 冲突）。
   PRD-v21 P0-6/AC-7 要求 `repair` 可达、非死代码；DESIGN-v21 T03 与任务书均写明「纯数据增补」。
   本轮**遵从 DESIGN**（数据落地、引擎侧零改动），并新增 `AC-RS2-9` 把当前状态钉死：
   断言 `repair` 6 条可取、且 `sfType()` 在全笛卡尔扫描下**永不**返回 `repair`。
   若后续补上路由，该断言会立刻转红，强制这次分歧被显式解决而不是悄悄漂过去。
2. **`released` 发布基线块**是 DESIGN-v21 §2.3 清单 schema 之外的新增字段（见上文 T06 自查）。
   判断依据：没有它，§2.3 要求的「内容变而 CACHE 未升 → 红」在数学上无法计算，
   故属「实现既定谓词所必需的最小结构」而非扩范围。请架构师追认。
3. **F6 的降级残留**：`git` 不可用或浅克隆缺该 commit 时，基线独立复算会跳过且**不判红**
   （CI 环境合法地各不相同），快照中会打印「未独立复算」。
   即：删除 `.git` 可使 F6 退化。此风险与门禁 `T0_BYTES`「受控常量靠评审而非靠机器」
   的既有治理口径一致，已显式记录而非隐藏，是否接受请裁定。
4. **`released` 何时推进到 `xiaonuan-v24`**：应在 v21 真正部署给用户之后，
   由发布动作单独提交（同时更新 `provenance` 的 commit 号）。本轮**未**推进。
