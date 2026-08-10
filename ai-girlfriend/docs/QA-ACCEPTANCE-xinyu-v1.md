# QA 验收报告 · 「心屿」品牌 + UI 增量变更（U-8）

| 项 | 值 |
|---|---|
| 验收人 | 严过关（QA Engineer） |
| 基线 | v22 收线（`xiaonuan-v25` 待发布键 / `released` 锚 `xiaonuan-v23` @ `b36842f`） |
| 验收日期 | 2026-08-10 |
| 结论 | **PASS** |

> **独立验收声明**：本报告所有静态检查、sha256 现算、测试运行均由 QA 独立完成，未采信工程师自测结论。

---

## 1. 验收范围与口径说明

本轮为**纯呈现层增量变更**，边界如下：

- **必须变更**：产品名 6 处（manifest ×2、index.html title/apple-title/me-foot、app.js `document.title`）；动漫图标三 PNG 覆盖；设置页分组/折叠/搜索；sw 缓存键 `xiaonuan-v25 → xiaonuan-v26` + `assets` 7 条 sha256 重算。
- **严禁变更**：`engine.js`、`memory.js`、`presence.js`、`texture.js`、`contingency.js`（四锁五文件零消耗）；`released` 基线块；`sw.js` ASSETS 路径清单；所有 localStorage/存储 key；所有设置项 `id` 与卡片内部结构。

### 1.1 关于「小暖」净减少量的修正口径

PRD AC-6 原写「净减少=6/7」，DESIGN §5 修正为「不做 N-7 时净减少=5，做 N-7 时净减少=6」。本轮实际复核后：

- 应删产品级字面量：manifest 2 处 + index.html 3 处 = **5 处**
- 设置页新增组名「🎀 小暖的样子」（角色级，按 PRD 不得改）= **+1 处**
- `app.js:3793` 原句为 `${ch.name}` 插值，不含「小暖」字面量，故改名不减少字面量
- **实际净减少 = 5 − 1 = 4**

因此，**不得以盲数净减少作为唯一判据**。本轮以「6 处改名逐点正确 + 角色级『小暖』全站 intact」为通过标准。

---

## 2. A–E 逐项验收结果

### A. 改名验收（产品名→心屿，角色名小暖零误伤）

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| A-1 | manifest.json `name` | `心屿 · 你的 AI 女友` | **PASS** | `manifest.json:2` |
| A-2 | manifest.json `short_name` | `心屿` | **PASS** | `manifest.json:3` |
| A-3 | `<title>` 静态文本 | `心屿 · 你的 AI 女友`，且**已移除 `data-xn="title"`** | **PASS** | `index.html:9` |
| A-4 | `app.js` 运行时 `document.title` | `心屿 · 你的 AI ${role}`，保留 `${role}` | **PASS** | `app.js:3794` |
| A-5 | apple-mobile-web-app-title | `content="心屿"` | **PASS** | `index.html:12` |
| A-6 | 设置页页脚 `.me-foot` | `心屿 v1.2 · 用爱发电 💕` | **PASS** | `index.html:481` |
| A-7 | 男版交叉校验 | 运行时标题应为「心屿 · 你的 AI 男友」 | **PASS** | 代码逻辑：`role = ch.gender === "male" ? "男友" : "女友"` |
| A-8 | 角色名「小暖」零误伤 | 角色级表面全部 intact | **PASS** | 见 §2.1 详细走查 |

#### A-8 角色名零误伤详细走查

对 `index.html` 与 `app.js` 全量 `grep` 复核：

- 聊天页 `nav-name`、她页 `nav-name-lg`、通话浮层 `call-name`、tabbar「小暖」、splash `data-xn="name"` 均保留 `小暖`
- gender-picker「遇见小暖 · AI 女友」保留
- her 页「🧠 小暖记得」保留
- 设置页「🎀 小暖人设」「🔊 语音（小暖开口说话）」「📨 让小暖主动找你」等文案保留
- `app.js` 内 `ch.name`/persona 逻辑、engine.js 人格文案未改（四锁五文件 diff=0）

**净减少计数复核**：

```text
index.html  HEAD=42  NOW=40  Δ=-2  （删 title/apple-title/foot 3 处，新增组名「小暖的样子」1 处）
manifest.json HEAD=2 NOW=0   Δ=-2
app.js      HEAD=39  NOW=39  Δ=0   （原句为 ${ch.name} 插值）
package.json HEAD=1  NOW=1   Δ=0
style.css   HEAD=4   NOW=4   Δ=0
sw.js       HEAD=4   NOW=4   Δ=0
─────────────────────────────────
全仓小暖字面量净减少 = 4
```

所有被移除的「小暖」均为产品级表面；所有保留的均为角色级/技术级表面，无「心屿」误替。

---

### B. 图标验收

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| B-1 | `icon-192.png` 有效 | 192×192，可解码，opaque | **PASS** | `192x192 opaque=true depth=16` |
| B-2 | `icon-512.png` 有效 | 512×512，可解码，opaque | **PASS** | `512x512 opaque=true depth=16` |
| B-3 | `apple-touch-icon.png` 有效 | 180×180，可解码，opaque | **PASS** | `180x180 opaque=true depth=16` |
| B-4 | SVG 底图圆角 | `rx="0"` | **PASS** | `icon-xinyu.svg:13` |
| B-5 | manifest icons 引用 | `/icon-192.png`、`/icon-512.png`（any + maskable） | **PASS** | `manifest.json:13-15` |
| B-6 | apple-touch-icon link | 存在 | **PASS** | `index.html:11` |
| B-7 | apple-touch-icon **不在 sw ASSETS** | 不出现 | **PASS** | `grep` 未命中 |
| B-8 | 视觉目检 | 动漫头像居中、渐变无断层、四角填满 | **PASS** | 人工目检 512 图通过 |

> 注：三 PNG 为 16-bit/color RGBA，文件体积较原 8-bit 占位图大（192: 28KB vs 6.7KB；512: 35KB vs 20KB；apple: 26KB vs 6.3KB），不影响功能与验收。

---

### C. 设置页重构验收

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| C-1 | 搜索框 | `#me-search` 在 `me-body` 顶部，带清空按钮 | **PASS** | `index.html:164-168` |
| C-2 | 分组数与默认状态 | 5 个 `.me-group`，组 1/2 展开，组 3/4/5 折叠 | **PASS** | `index.html:171-479` |
| C-3 | 13 张卡片全覆盖 | 无遗漏、无重复 | **PASS** | 逐组清点：2+2+4+3+2=13 |
| C-4 | 组名 | 💞我们的关系 / 🎀小暖的样子 / 🧠智能与模型 / ☁️连接与同步 / 🗄数据与隐私 | **PASS** | `index.html:174/200/255/330/457` |
| C-5 | 卡片顺序 | 语音音色紧随语音，消息提醒归入连接与同步 | **PASS** | 组 3/4 边界连续 |
| C-6 | 所有 `id` 原样保留 | 与 HEAD diff 仅新增搜索相关 3 个 id | **PASS** | 见 §2.3 id 对比 |
| C-7 | `data-xn-*` 属性与内部文案保留 | 无删改 | **PASS** | grep 复核 |
| C-8 | 隐藏类 | 使用 `.me-hit-off`，非 `.hidden` | **PASS** | `style.css:1012`、`app.js:3960` |
| C-9 | `initMeGroups()` / `initMeSearch()` 存在 | 定义完整 | **PASS** | `app.js:3916/3942` |
| C-10 | 初始化挂载位置 | `init()` 末尾，`bindArcUI()` 之后 | **PASS** | `app.js:4014` |
| C-11 | 逻辑静态审查 | 无空引用/选择器不匹配 | **PASS** | 见 §2.4 代码审查 |

#### C-6 设置页 `id` 对比

```text
HEAD 与 NOW 的 page-me id 集合差异：
+ id="me-search"
+ id="me-search-clear"
+ id="me-search-empty"
（仅新增搜索相关 3 个 id；其余 71 个业务 id 全部保留）
```

#### C-9/C-10 初始化时序

`app.js:4014` 在 `bindArcUI()` 之后调用 `initMeGroups(); initMeSearch();`，注释明确说明必须在 `refreshCharacter()→applyCharIdentity()` 与 `bindSettings()` 之后，确保搜索读到最终角色文案。

#### C-11 逻辑静态审查要点

- `initMeGroups()`：使用 `head.closest(".me-group")` 获取分组容器，不存在则跳过；点击/键盘事件均正确更新 `collapsed` 与 `aria-expanded`
- `initMeSearch()`：
  - 搜索实时读取 `card.textContent` 并 `toLowerCase()` 匹配
  - 命中组添加 `.has-hit`，CSS 强制展开且不改 `collapsed` 类
  - 清空后移除 `.searching`/`.has-hit`/`.me-hit-off`/`.me-hit-on`，恢复 HTML 初始折叠态
  - 空结果提示 `#me-search-empty` 使用既有 `.hidden` 类，与卡片隐藏类分离
  - 增加 `Escape` 键清空，提升可用性（超出 PRD 最低要求，无副作用）

---

### D. sw 升键 + 指纹验收

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| D-1 | `sw.js` 缓存键 | `const CACHE = "xiaonuan-v26"` | **PASS** | `sw.js:2` |
| D-2 | 缓存键前缀 | 仍为 `xiaonuan-`，未改成 `xinyu-` | **PASS** | `sw.js:2` |
| D-3 | `sw.js` ASSETS 路径清单 | 逐字未变 | **PASS** | `git diff sw.js` 仅 CACHE 行变化 |
| D-4 | manifest `cacheVersion` | `xiaonuan-v26` | **PASS** | `test/sw-assets-manifest.json:3` |
| D-5 | 7 条变更资产 sha256 | 与现算一致 | **PASS** | 见 §2.5 指纹比对 |
| D-6 | `released` 块 | 逐字未动 | **PASS** | diff 无变化 |
| D-7 | 未变更资产指纹 | engine/memory/presence/texture/localmodel 保持原值 | **PASS** | 与 HEAD 一致 |

#### D-5 指纹现算比对

```bash
sha256sum index.html style.css app.js manifest.json icon-192.png icon-512.png
```

| 文件 | 现算 sha256 | manifest.assets 记录 | 结果 |
|---|---|---|---|
| `index.html` | `0798209d66a99a0a2029a0838164010b165d3a4e54ded980a6b3b0ee275d0370` | `/` 与 `/index.html` 同为该值 | PASS |
| `style.css` | `e19306bf10a06d22292fb33a23d16bb3528c0bad746990895a5a93c30d455910` | `style.css` | PASS |
| `app.js` | `200826397854d0a22825dbdce9ddcd96bda407db324ed65bb17c6945f6fa5023` | `app.js` | PASS |
| `manifest.json` | `d04ea30a718af131638cc2fa62a7366b6526219c81b219c4d94b084d57198227` | `manifest.json` | PASS |
| `icon-192.png` | `9257474288199c80ed371216171271e75f45009b8caaca3428f8ffce59f60db9` | `icon-192.png` | PASS |
| `icon-512.png` | `c18eb778487d1736acb33a55aa9025c5fa9125809d1597bd4908145ca417de9e` | `icon-512.png` | PASS |

#### D-6 `released` 块复核

```bash
python3 -c "import json; d=json.load(open('test/sw-assets-manifest.json')); print(json.dumps(d['released'], ensure_ascii=False, indent=2))"
```

与 HEAD 的 `released` 块做 diff：**无差异**。`cacheVersion` 仍为 `xiaonuan-v23`，`provenance` 仍为 `git b36842f（v18 收线提交，即 xiaonuan-v23 的铸键点）`。

---

### E. 四锁与回归测试

| # | 检查项 | 期望 | 结果 | 证据 |
|---|---|---|---|---|
| E-1 | 四锁五文件本轮 diff | `engine.js`/`memory.js`/`presence.js`/`texture.js`/`contingency.js` 不在改动列表 | **PASS** | `git diff --stat -- ai-girlfriend/{engine,memory,presence,texture,contingency}.js` 为空 |
| E-2 | `node --check` | `app.js`/`sw.js`/`server.js` 语法通过 | **PASS** | 均 OK |
| E-3 | `npm test` | 全绿 | **PASS** | 351 tests / 351 pass / 0 fail |
| E-4 | `test:probe` 9 项 | 全绿 | **PASS** | 9/9 PASS |
| E-5 | `qa-v21-sw-guard.js` | A/C/D/F 全绿 | **PASS** | TD 守卫总判定 PASS |
| E-6 | `qa-v19-quota-gate.js` | 四锁配额零消耗 | **PASS** | 配额门禁总判定 PASS |
| E-7 | `qa-v22-h13-closure.js` | H13 破墙 0% | **PASS** | 0 泄漏，PASS |
| E-8 | `qa-v22-repair-route.js` | repair 路由正常 | **PASS** | PASS |

#### E-4 `test:probe` 逐项结果

```text
── test/qa-probe-mutation.js           PASS
── test/qa-v17-adversarial.js          PASS
── test/qa-v17-independent-size.js     PASS
── test/qa-probe-h13.js                PASS
── test/qa-probe-v15-acceptance.js     PASS
── test/qa-v19-quota-gate.js           PASS
── test/qa-v21-sw-guard.js             PASS
── test/qa-v22-h13-closure.js          PASS
── test/qa-v22-repair-route.js         PASS
```

> 注：`qa-v21-sw-guard.js` D 段显示相对 `released` 基线 `xiaonuan-v23` 有 9 项漂移，其中 `engine.js` 与 `contingency.js` 的漂移为 **v21/v22 历史变更**（本轮四锁五文件 diff=0，见 E-1），其余 7 项为本轮变更。缓存键已升至 `xiaonuan-v26`，满足 C0-b 升键纪律。

---

## 3. 发现的 Bug 清单

**无源码 bug，无测试 bug。**

| 类型 | 数量 | 路由 |
|---|---|---|
| 源码 bug | 0 | — |
| 测试 bug | 0 | — |

---

## 4. 总体结论

**PASS**

本轮增量变更 U-8 全部 P0 验收项通过：

- ✅ 6 处产品名改名逐点正确，角色名「小暖」全站零误伤
- ✅ 三 PNG 图标有效、不透明、引用正确，apple-touch-icon 未入 sw 缓存
- ✅ 设置页 5 组 13 卡结构正确，id/存储 key/内部文案原样保留，搜索/折叠逻辑无缺陷
- ✅ sw 升键至 `xiaonuan-v26`，7 条变更资产 sha256 现算一致，`released` 块冻结
- ✅ 四锁五文件本轮零改动，核心回归测试全绿

---

## 5. 已知问题与遗留项

以下项目**不阻塞本次验收**，但建议记录：

| # | 项 | 说明 | 建议 |
|---|---|---|---|
| K-1 | `package.json` description 仍为「小暖…」 | N-7 为 P2 可选项，本轮未实施 | 若需下一版补齐，可单独提交 |
| K-2 | PNG 图标为 16-bit 深度 | 文件体积偏大（192/512/apple 分别为 28KB/35KB/26KB） | 可选转为 8-bit 以减小体积，不影响功能 |
| K-3 | `index.html:196` HTML 注释「角色外观」与实际组名「小暖的样子」不一致 | 仅为注释笔误，UI 显示正确 | 工程师可在下次顺手清理注释 |
| K-4 | 图标仍为手绘占位图 | PRD Q2 已决策先上占位图，真图到位后按同样流程替换 | 真图替换时升 `xiaonuan-v27` 并重算 icon 指纹 |

---

## 6. 测试运行原始命令摘要

```bash
cd /workspace/ai-girlfriend

# 改名与静态检查
grep -n "心屿\|小暖" manifest.json index.html app.js
git diff --stat -- ai-girlfriend/{engine,memory,presence,texture,contingency}.js

# 图标
file icon-192.png icon-512.png apple-touch-icon.png icon-xinyu.svg
identify -format '%f %wx%h opaque=%[opaque]\n' icon-192.png icon-512.png apple-touch-icon.png

# sw 指纹
sha256sum index.html style.css app.js manifest.json icon-192.png icon-512.png

# 测试
node --check app.js && node --check sw.js && node --check server.js
npm test
npm run test:probe
```

---

**签名**：严过关 · QA Engineer  
**状态**：验收通过，可进入发布流程。
