# QA 验收报告 · 「心屿」项目头像资产变更（U-9 · v26→v27）

| 项 | 值 |
|---|---|
| 验收人 | 严过关（QA Engineer） |
| 基线 | U-8 v26 收线（`xiaonuan-v26` / `released` 锚 `xiaonuan-v23` @ `b36842f`） |
| 验收日期 | 2026-08-10 |
| 结论 | **PASS** |

> **独立验收声明**：本报告所有静态检查、sha256 现算、守卫运行、视觉核验均由 QA 独立完成，未采信工程师自测结论。

---

## 1. 验收范围与口径说明

本轮为**纯图标资产变更**，边界如下：

- **必须变更**：`icon-xinyu.svg`（占位手绘 → 卡通动漫少女）；`icon-192.png` / `icon-512.png` / `apple-touch-icon.png`（cairosvg 复现栅格化覆盖）；`sw.js` 缓存键 `xiaonuan-v26 → xiaonuan-v27`；`test/sw-assets-manifest.json` `cacheVersion` v26→v27 与 13 条 sha256 重算（icon-192/512 必变，其余 11 条须与 v26 一致）。
- **严禁变更**：`engine.js`、`memory.js`、`presence.js`、`texture.js`、`contingency.js`（四锁五模块源码冻结）；`index.html`、`app.js`、`style.css`、`manifest.json`、`package.json`（无关源码冻结）；`released` 基线块（仅真正发版时移动）。

### 1.1 关键事实复述

- `sw.js` 的 `ASSETS` 数组共 **13 项**：6 个脚本（engine.js/localmodel.js/memory.js/presence.js/texture.js/contingency.js）+ 根壳 7 项（`/`、`/index.html`、`/style.css`、`/app.js`、`/manifest.json`、`/icon-192.png`、`/icon-512.png`）。
- `manifest.assets` 必须 **13 条且键集与 ASSETS 双向同构**，否则 `qa-v21-sw-guard.js` 的 B2/B3 转红。
- `apple-touch-icon.png` 仅被 `index.html:11` `<link rel="apple-touch-icon">` 引用，**不**入 `sw.js` ASSETS、**不**写 `manifest.assets`（守卫 E5 不冲突）。

---

## 2. A–C 逐项验收结果

### A. 图标资产

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| A-1 | `identify` 三图 opaque | 三图均 `opaque=true` | **PASS** | `true 192x192 sRGB` / `true 512x512 sRGB` / `true 180x180 sRGB` |
| A-2 | `identify` 三图尺寸 | 192×192 / 512×512 / 180×180 | **PASS** | 同上 |
| A-3 | `identify` 三图色彩空间 | 均为 sRGB | **PASS** | 同上 |
| A-4 | `file` 三图类型 | 均为 `PNG image data` | **PASS** | `PNG image data, 192x192, 8-bit/color RGB, non-interlaced` 等 |
| A-5 | PNG 类型细节 | 8-bit/color RGB（无 alpha 通道） | **PASS** | `Type: TrueColor`，`Matte color: grey74`（TrueColor 不存 alpha） |
| A-6 | 四角像素采样不透明 | 渐变色填充，无黑角 | **PASS** | 左上 `srgb(255,217,232)`、右下 `srgb(207,230,255)`（粉→蓝渐变底） |
| A-7 | SVG 是卡通动漫风格 | 有眼睛/发型/爱心发夹等角色元素 | **PASS** | 见下 §2.A.1 元素清单 |
| A-8 | SVG 背景 `<rect>` 满铺 `rx="0"` | 512×512 满铺方角 | **PASS** | `icon-xinyu.svg:59` `<rect x="0" y="0" width="512" height="512" rx="0" fill="url(#bg)"/>` |
| A-9 | SVG 用 `<linearGradient>` 而非 `<filter>`/`<radialGradient>` | 仅 linearGradient | **PASS** | `linearGradient`=8 个；`<filter>` `<radialGradient>` `<mask>` `<foreignObject>` `<text>` `<image>` `<style>` `<script>` `<clip-path=>` 在剥离注释的元素级扫描中均为 0 |
| A-10 | SVG 含品牌色 `#ff5b8a` | 爱心发夹主色 | **PASS** | `icon-xinyu.svg:53` 渐变中间色 + `72` 漂浮爱心 + `90` 衣领描边 + `175` 发夹填充 |
| A-11 | SVG 中误植产品/角色名文字 | 无 | **PASS** | `grep "小暖\|心屿" icon-xinyu.svg` exit=1 无匹配；任意中文字符仅出现在 XML 注释行（不渲染） |
| A-12 | 三图与 SVG 现算复现像素一致 | RMSE=0 | **PASS** | `compare -metric RMSE` 三图均 `0 (0)` |

#### §2.A.1 SVG 元素清单（剥离注释后 XML 解析）

```
tag inventory: {circle:8, defs:1, ellipse:15, g:4, linearGradient:8, path:27, rect:1, stop:25, svg:1}
```

- 8 个 `<linearGradient>`（bg / hairBack / hairFront / hairShine / skin / iris / cloth / heartPin），无 `<radialGradient>`、`<filter>`、`<mask>`、`<foreignObject>`、`<text>`、`<image>`、`<style>`、`<script>`、`clip-path=`。
- 卡通动漫特征齐备：27 条 `<path>`（刘海/后发/眼线/眉毛/衣领/嘴/爱心等）+ 15 个 `<ellipse>`（双眼、瞳孔、腮红三层同心）+ 8 个 `<circle>`（星光/光晕）+ 1 个 `<rect>`（背景满铺）。

### B. sw 升键 + 13 指纹守卫（核心回归）

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| B-1 | `sw.js:2` CACHE 字面值 | `xiaonuan-v27`（前缀 `xiaonuan-` 未改） | **PASS** | `const CACHE = "xiaonuan-v27"` |
| B-2 | `manifest.cacheVersion` | `xiaonuan-v27` | **PASS** | `test/sw-assets-manifest.json:3` |
| B-3 | `sw.js` ASSETS 项数 | 13 | **PASS** | 解析后 13 项（含注释剥离后正则） |
| B-4 | `manifest.assets` 项数 | 13 | **PASS** | 解析后 13 项 |
| B-5 | B 双向同构（ASSETS ≡ manifest.assets） | 集合与顺序均一致 | **PASS** | `set(assets)==set(mk) && len==13`、顺序 `assets==mk` |
| B-6 | 13 条 sha256 逐条现算 vs manifest 记录 | 13/13 全过 | **PASS** | 见 §2.B.1 |
| B-7 | icon-192/512 哈希应**不同于 v26** | 两条 CHANGED | **PASS** | icon-192 `9257474288199…`→`abeb1225cbbc05…`；icon-512 `c18eb778487d1…`→`4caea97630e3dc…` |
| B-8 | 其余 11 条应**与 v26 一致** | 11/11 SAME-as-v26 | **PASS** | `/` `/index.html` `/style.css` `/engine.js` `/app.js` `/localmodel.js` `/memory.js` `/presence.js` `/texture.js` `/contingency.js` `/manifest.json` 全部 SAME |
| B-9 | `released` 块**逐字未动** | 字面与 v26 完全一致 | **PASS** | `json.dumps(sort_keys=True)` 双侧相等；仍锚 `xiaonuan-v23` / git `b36842f` |
| B-10 | `qa-v21-sw-guard.js` A/B/C/D/E/F 六段 | 全绿 | **PASS** | `=== TD 守卫总判定: PASS ===`，exit code 0（详见 §3） |

#### §2.B.1 13 条 sha256 逐条比对（独立现算）

```
PASS /                  0798209d66a9…  SAME-as-v26
PASS /index.html        0798209d66a9…  SAME-as-v26
PASS /style.css         e19306bf10a0…  SAME-as-v26
PASS /engine.js         ab272002cfab…  SAME-as-v26
PASS /app.js            200826397854…  SAME-as-v26
PASS /localmodel.js     7979f6a85f22…  SAME-as-v26
PASS /memory.js         e9bc76a178db…  SAME-as-v26
PASS /presence.js       8924c42baf31…  SAME-as-v26
PASS /texture.js        dad00580ae82…  SAME-as-v26
PASS /contingency.js    38aeafdc347a…  SAME-as-v26
PASS /manifest.json     d04ea30a718a…  SAME-as-v26
PASS /icon-192.png      abeb1225cbbc…  CHANGED-vs-v26
PASS /icon-512.png      4caea97630e3…  CHANGED-vs-v26
13/13 全过: True
```

### C. 边界与零误伤

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| C-1 | `git diff --name-only` 仅 6 文件 | `icon-xinyu.svg` / `icon-192.png` / `icon-512.png` / `apple-touch-icon.png` / `sw.js` / `test/sw-assets-manifest.json` | **PASS** | 6 文件，零其他 |
| C-2 | 四锁五模块源码冻结 | `engine.js` `memory.js` `presence.js` `texture.js` `contingency.js` 全部 diff=0 | **PASS** | 逐文件 `git diff --numstat` 行数=0 |
| C-3 | 无关源码冻结 | `index.html` `app.js` `style.css` `manifest.json` `package.json` `localmodel.js` 全部 diff=0 | **PASS** | 逐文件 `git diff --numstat` 行数=0 |
| C-4 | SVG 中无产品/角色名字面量 | 无「小暖」「心屿」字面量 | **PASS** | `grep -rn "小暖\|心屿" icon-xinyu.svg` exit=1（无匹配） |
| C-5 | `apple-touch-icon.png` 仅 index.html link 引用 | 仅 `index.html:11` 引用 | **PASS** | `grep -rn apple-touch-icon` 命中：index.html:11 与 sw.js 注释 + docs 历史报告 |
| C-6 | `apple-touch-icon.png` 未进 sw.js ASSETS | 数组无该 key | **PASS** | `grep apple-touch sw.js` 命中行 = 仅 :2 注释，**不在 ASSETS 数组内**（数组解析 13 项不含） |
| C-7 | `apple-touch-icon.png` 未写 manifest.assets | manifest 无该 key | **PASS** | `grep apple-touch test/sw-assets-manifest.json` exit=1 无匹配 |

#### §2.C.1 `git diff --stat` 全量输出

```
 ai-girlfriend/apple-touch-icon.png         | Bin 26015 -> 19943 bytes
 ai-girlfriend/icon-192.png                 | Bin 28060 -> 21527 bytes
 ai-girlfriend/icon-512.png                 | Bin 35018 -> 69715 bytes
 ai-girlfriend/icon-xinyu.svg               | 196 +++++++++++++++++++++++++----
 ai-girlfriend/sw.js                        |   2 +-
 ai-girlfriend/test/sw-assets-manifest.json |   6 +-
 6 files changed, 174 insertions(+), 30 deletions(-)
```

注：仓库中另有 **未跟踪** 项 `ai-girlfriend/charts/` 与两份顶层 `.md` 文件——这些是仓库历史残留，与本轮变更无关，不计入本验收范围。

---

## 3. qa-v21-sw-guard.js 守卫输出摘要

完整 6 段全绿，关键行摘录：

```
=== A. manifest.cacheVersion 与 sw.js CACHE 逐字相等 ===
  ok   A · cacheVersion === CACHE（逐字）  → manifest "xiaonuan-v27" vs sw.js "xiaonuan-v27"

=== B. manifest.assets 键集 ≡ sw.js ASSETS 数组（双向同构）===
  ok   B1 · ASSETS 无重复项  → 13 项，去重后 13
  ok   B2 · sw.js → manifest 无遗漏  → 13 项全部登记
  ok   B3 · manifest → sw.js 无多余（僵尸条目）  → 13 项全部在 ASSETS 内

=== C. 逐个 ASSETS 成员现算 sha256 vs manifest 记录 ===
  ok   C · / (34127B sha256 0798209d…) / /index.html (34127B) /
       /style.css (48016B) / /engine.js (248436B) / /app.js (189071B) /
       /localmodel.js (4307B) / /memory.js (13333B) / /presence.js (3566B) /
       /texture.js (4366B) / /contingency.js (6664B) / /manifest.json (592B) /
       /icon-192.png (21527B) / /icon-512.png (69715B)
  —— 共 13/13 全过

=== D. v20 类逃逸判别 ===
  ok   D · 相对发布基线 "xiaonuan-v23" 有 9 项内容变更，CACHE 已升至
       "xiaonuan-v27" ⇒ 合法下发（非「内容已变而缓存键未升」态）

=== E. 反空转 ===
  ok   E1 · ASSETS 非空 → 13 项
  ok   E2 · 已哈希 13 / 应哈希 13
  ok   E3 · 累计读入字节 > 0 → 677847B
  ok   E4 · 哈希非平凡（64 位十六进制且互不全同）→ 13 条指纹格式校验
  ok   E5 · contingency.js 确在守卫覆盖范围内 → ASSETS 含 /contingency.js = true

=== F. 发布基线完整性与单调性 ===
  ok   F1 · 两个键都符合 xiaonuan-vN 命名（可比较大小）  → released="xiaonuan-v23"(23) / CACHE="xiaonuan-v27"(27)
       （源码取证 `test/qa-v21-sw-guard.js:243`：`const m = /^xiaonuan-v(\d+)$/.exec(String(v));` —— 正则与 v27 匹配）
  ok   F2 · 版本号单调不回退（CACHE >= released）→ 27 >= 23
  ok   F3 · 发布基线无僵尸条目（基线键 ⊆ ASSETS）→ 13 项全部在 ASSETS 内
  ok   F4 · 发布基线指纹格式合法（64 位十六进制）→ 13 条基线指纹
  ok   F5 · 发布基线标注了可审计来源（provenance 非空）→ git b36842f（v18 收线提交，即 xiaonuan-v23 的铸键点）
  ok   F6 · 发布基线可按 provenance 独立复算（防伪造基线）→ 已按 b36842f 逐条复算一致

=== TD 守卫总判定: PASS ===
exit code: 0
```

---

## 4. 视觉抽检（icon-512.png）

渲染 `icon-512.png` 至 320×320 预览：可见大眼睛动漫少女轮廓清晰（双眼/虹膜渐变/双高光/瞳孔分层/睫毛上扬、柳眉、浅笑嘴、腮红三层同心），右侧刘海别 #ff5b8a 品牌色爱心发夹（带白色高光），深梅棕短发高对比剪影，粉→蓝渐变底（粉→淡紫→浅蓝四档无灰浊断层），左上有星光、右上有漂浮爱心，整体卡通动漫风格成立，无 iOS 黑角，无 `<text>` 误植文字，无透明区域。

---

## 5. Bug 清单与路由

| 编号 | 描述 | 路由 | 处置 |
|---|---|---|---|
| — | 无 bug | — | — |

**路由决策**：**NoOne**。所有静态核查、sha256 现算、守卫运行、视觉抽检均通过，零源码/资产 bug，零测试脚本问题。

---

## 6. 总体结论

**PASS**。

- A 段（图标资产 12 项）全 PASS。
- B 段（sw 升键 + 13 指纹守卫 10 项）全 PASS，含 A/B/C/D/E/F 六段守卫全绿。
- C 段（边界与零误伤 7 项）全 PASS。
- 视觉抽检确认卡通动漫风格头像渲染正确。
- 无已知遗留缺陷。

---

## 7. 已知遗留（非本轮问题，仅备查）

1. **仓库内未跟踪残留**：`ai-girlfriend/charts/` 目录与顶层两份 `.md` 文件（`小暖_全量升级实施路线图.md`、`小暖升级清单_从3个竞品仓库借鉴.md`）——历史残留，与本轮图标变更无关，不影响 PWA 离线/缓存路径。
2. **`released` 仍锚 `xiaonuan-v23`**（git `b36842f`）：按 DESIGN-v22 §4.3 C-2「只在真正发版时移动」要求，本轮不动 released 块（已逐字校验），属预期态。
3. **本轮未涉及：人物设人设/对话人格/破墙护栏** 等系统级变更——本报告仅覆盖图标资产变更。