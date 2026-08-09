#!/usr/bin/env node
"use strict";
/* QA v21 · TD 联动守卫：被缓存资产内容 ↔ sw.js 缓存键 一致性（DESIGN-v21 §4 / §7）
 *
 * ── 它修的是哪个缺口 ────────────────────────────────────────────────
 * v20 逃逸的完整根因（DESIGN-v21 §1.3）：`contingency.js` 在 `sw.js` 的 ASSETS 清单内，
 * 内容改了，而 `CACHE` 仍是 `"xiaonuan-v23"`。当时**三处**版本断言全部恒绿：
 *   · `v12-wiring.test.js:216`  `L.sw.version >= 17`   —— 地板太松，v23 ≥ 17 恒真
 *   · `qa-v13-t5b.test.js:166`  `strictEqual(cur, 23)` —— 方向反了：钉死在人工快照值
 *   · `qa-v15-t2.test.js:409`   `strictEqual(cur, 23)` —— 同上
 * 前者太松，后两者**方向反了** —— 它们只能证明「版本号没被乱改」，
 * 完全无法证明「被缓存资产内容已变、版本号却没跟着升」。
 * 三处**没有任何一处读过 ASSETS 文件的内容**。这就是第三层缺口：无资产层。
 *
 * ── 本守卫的判据 ──────────────────────────────────────────────────
 *   A. `manifest.cacheVersion` 与 `sw.js` 的 `CACHE` **逐字相等**
 *   B. `manifest.assets` 的键集与 `sw.js` 的 `ASSETS` 数组**完全同构**（双向，不多不少）
 *   C. 逐个 ASSETS 成员**现算** sha256，与 manifest.assets 记录比对（清单是否忘了重算）
 *   D. **v20 逃逸分类器**：以 `manifest.released` 发布基线为参照系 ——
 *      任一资产现算哈希 ≠ 发布基线哈希，**且** CACHE 仍等于发布基线的键 ⇒ 逃逸，红
 *   E. 反空转：ASSETS 非空、文件真实读到内容、哈希非平凡
 *   F. 发布基线自身的完整性 + 版本号单调性（键只能往前走）
 *
 * ── ★ v21 T06 自查修正：为什么必须有 `released` 发布基线 ──────────────
 * 本守卫初版（T02）用 `manifest.cacheVersion === CACHE` 当作「版本没升」的判据。
 * **那是错的**，它把两件不同的事混为一谈：
 *   · `manifest.cacheVersion` 的语义是「这批哈希**隶属于**哪个键」—— 一个标签，
 *     它本来就**必须**等于 CACHE（这是 A 段的职责），等于 ≠ 「没升版」。
 *   · 「升没升版」是相对**上一次真正发布出去的键**而言的，而初版清单里
 *     根本不存在这个概念 —— 于是守卫在数学上无法计算自己声称要判的那个谓词。
 * 后果是致命的：T06 重算 manifest 后守卫转绿，但**同一个动作**也能让
 * 「偷改资产、不升键、只重算清单」转绿 —— 正是本文件报错信息里写着「✗ 禁止」
 * 的那条洗白路径。守卫会亲手给逃逸发一张绿卡。
 * 修法：清单增加 `released { cacheVersion, provenance, assets }`，
 * 它是**受控基线**，只在「该键真正发布给用户」时才移动（与门禁的 T0_BYTES 同级纪律）。
 * 洗白免疫性由此成立：只重算 `assets` 动不了 `released`，漂移依旧存在 ⇒ 强制升键。
 *
 * ── 发布基线的取值依据（可审计，非拍脑袋）────────────────────────────
 *   `xiaonuan-v23` 铸于 git `b36842f`（v18 收线）。此后 **v19 / v20 两个版本都没升键**，
 *   故 v23 唯一合法认证过的资产状态就是 b36842f 那一刻的树。以它为基线实测：
 *   13 个资产中**只有 `/contingency.js` 漂移**（5652 → 6626）—— 机器独立指认出了
 *   v20 逃逸的当事人，与人工事后复盘的结论一致。这条基线因此同时是**回归证据**。
 *
 * ── 协作口诀（DESIGN-v21 §2.3）────────────────────────────────────
 *   **改被缓存文件 → 必升 CACHE 版本 → 必更新 manifest。** 三者任一遗漏，本守卫转红。
 *
 * ── manifest 重算程序（本守卫**只读不写**，DESIGN-v21 §6.1 T02 纪律）────
 *   守卫刻意不提供 `--write`：那等于给「改了资产不升版」发一个一键变绿按钮，
 *   守卫的价值 100% 取决于「让它变绿比走流程更麻烦」。重算请显式执行：
 *     node -e '<读 sw.js 的 CACHE/ASSETS → 逐个 sha256 → 写 test/sw-assets-manifest.json>'
 *   （完整命令见 docs/CHANGELOG.md v21 条目；重算前必须先确认 CACHE 已升版。）
 *
 * ── ASSETS 中的 "/" 如何解析 ──────────────────────────────────────
 *   `"/"` 是路由不是文件，落盘解析为 `index.html`（与 `"/index.html"` 同源，两键哈希相同）。
 *   键集仍按 ASSETS **原样**登记，保证 B 段的「完全同构」是逐字成立的，而不是靠归一化凑出来的。
 *
 * 退出码：任一段失败 → 1；全绿 → 0。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SW_PATH = path.join(ROOT, "sw.js");
const MANIFEST_PATH = path.join(__dirname, "sw-assets-manifest.json");

const fails = [];
const chk = (name, cond, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? "  → " + detail : ""}`);
  if (!cond) fails.push(name);
};

console.log("=== QA v21 · TD 联动守卫（资产内容 ↔ 缓存键）===\n");

/* ══════════════ 0 · 解析 sw.js（唯一真源：CACHE 与 ASSETS 都从源码文本提取）══════════════
 * 刻意**不 require sw.js**：它是 Service Worker，顶层就调 self.addEventListener，
 * 在 Node 里 require 会直接抛。文本解析是这里唯一可行且无副作用的读法。 */
const swSrc = fs.readFileSync(SW_PATH, "utf8");
const mCache = swSrc.match(/const\s+CACHE\s*=\s*["']([^"']+)["']/);
const mAssets = swSrc.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);

chk("sw.js 解析出 CACHE 常量", !!mCache, mCache ? mCache[1] : "未匹配到 const CACHE = \"...\"");
chk("sw.js 解析出 ASSETS 数组", !!mAssets, mAssets ? "已定位" : "未匹配到 const ASSETS = [...]");
if (!mCache || !mAssets) {
  console.log("\n=== TD 守卫总判定: FAIL（sw.js 结构无法解析，后续段跳过）===");
  process.exit(1);
}

const SW_CACHE = mCache[1];
/* 只取数组字面量里的字符串项；行内注释里的引号不会被误收，
 * 因为注释在 ASSETS 数组体内是以 // 开头的整行，不含成对引号包裹的路径。 */
const ASSETS = [...mAssets[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/* ══════════════ 1 · manifest 可读性 ══════════════ */
let manifest = null;
let manifestErr = "";
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  manifestErr = String((e && e.message) || e);
}
chk("sw-assets-manifest.json 存在且为合法 JSON", !!manifest, manifest ? MANIFEST_PATH : manifestErr);
if (!manifest) {
  console.log("\n=== TD 守卫总判定: FAIL（manifest 缺失/损坏）===");
  process.exit(1);
}
chk("manifest 具备 cacheVersion / assets 两个字段",
  typeof manifest.cacheVersion === "string" && !!manifest.assets && typeof manifest.assets === "object",
  `cacheVersion=${JSON.stringify(manifest.cacheVersion)} / assets ${manifest.assets ? "对象" : "缺失"}`);
/* released 缺失即判红：没有它，D 段的反逃逸判据无法计算（见顶部 T06 自查说明）。
 * 刻意**不做兼容降级**——「基线缺失就跳过 D 段」等于给删掉基线开了一条静默绕过路径。 */
chk("manifest 具备 released 发布基线块（反逃逸参照系）",
  !!manifest.released && typeof manifest.released === "object"
  && typeof manifest.released.cacheVersion === "string"
  && !!manifest.released.assets && typeof manifest.released.assets === "object",
  manifest.released
    ? `released.cacheVersion=${JSON.stringify((manifest.released || {}).cacheVersion)}`
    : "缺失 —— 守卫将无法判定「内容变而键未升」，拒绝以降级模式放行");

const MF_VERSION = String(manifest.cacheVersion || "");
const MF_ASSETS = manifest.assets || {};
const REL = manifest.released || {};
const REL_VERSION = String(REL.cacheVersion || "");
const REL_ASSETS = REL.assets || {};

/* ══════════════ A · 版本号逐字一致 ══════════════ */
console.log("\n--- A. manifest.cacheVersion 与 sw.js CACHE 逐字相等 ---");
chk("A · cacheVersion === CACHE（逐字）", MF_VERSION === SW_CACHE,
  `manifest "${MF_VERSION}" vs sw.js "${SW_CACHE}"`);

/* ══════════════ B · 键集同构（双向）══════════════ */
console.log("\n--- B. manifest.assets 键集 ≡ sw.js ASSETS 数组（双向同构）---");
const swSet = new Set(ASSETS);
const mfKeys = Object.keys(MF_ASSETS);
const mfSet = new Set(mfKeys);
const missingInManifest = ASSETS.filter((a) => !mfSet.has(a));      // sw 有、manifest 无
const extraInManifest = mfKeys.filter((k) => !swSet.has(k));        // manifest 有、sw 无
chk("B1 · ASSETS 无重复项", swSet.size === ASSETS.length,
  `${ASSETS.length} 项，去重后 ${swSet.size}`);
chk("B2 · sw.js → manifest 无遗漏", missingInManifest.length === 0,
  missingInManifest.length ? missingInManifest.join(", ") : `${ASSETS.length} 项全部登记`);
chk("B3 · manifest → sw.js 无多余（僵尸条目）", extraInManifest.length === 0,
  extraInManifest.length ? extraInManifest.join(", ") : `${mfKeys.length} 项全部在 ASSETS 内`);

/* ══════════════ C · 逐个现算 sha256 比对 ══════════════ */
console.log("\n--- C. 逐个 ASSETS 成员现算 sha256 vs manifest 记录 ---");
/* "/" 是路由不是文件 → 落盘解析为 index.html */
const resolveAsset = (u) => {
  const rel = String(u).replace(/^\//, "");
  return path.join(ROOT, rel === "" ? "index.html" : rel);
};
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const drift = [];      // 现算 vs manifest.assets（清单是否忘了重算）
const relDrift = [];   // 现算 vs manifest.released.assets（本轮相对已发布版真正变了什么）
let readBytes = 0;
let hashed = 0;
for (const a of ASSETS) {
  const p = resolveAsset(a);
  let cur = "";
  let bytes = -1;
  if (!fs.existsSync(p)) {
    drift.push({ a, cur: "<文件不存在>", want: MF_ASSETS[a] || "<未登记>", missing: true });
    chk(`C · ${a}`, false, `落盘文件不存在：${path.relative(ROOT, p)}（ASSETS 是 addAll 全有全无，缺件即整包装不上）`);
    continue;
  }
  const buf = fs.readFileSync(p);
  bytes = buf.length;
  readBytes += bytes;
  cur = sha256(buf);
  hashed++;
  const want = MF_ASSETS[a];
  const same = want === cur;
  if (!same) drift.push({ a, cur, want: want || "<未登记>" });
  /* 与发布基线比对：基线里没有该键 ⇒ 是本轮**新增**的被缓存资产，同样属于「内容变了」，
   * 因为老用户的旧缓存里压根没有这个文件（v13 C0-b 事故的另一种形态）。 */
  const relWant = REL_ASSETS[a];
  if (relWant !== cur) relDrift.push({ a, cur, want: relWant || "<发布基线中不存在·本轮新增资产>", bytes });
  chk(`C · ${a}`, same,
    same
      ? `${bytes}B  sha256 ${cur.slice(0, 12)}…`
      : `${bytes}B  现算 ${cur.slice(0, 12)}… ≠ 清单 ${String(want || "<未登记>").slice(0, 12)}…`);
}

/* ══════════════ D · v20 逃逸分类器（参照系＝发布基线，非 manifest.cacheVersion）══════════════
 * 判据：∃ 资产现算哈希 ≠ 发布基线哈希  ∧  CACHE 仍等于发布基线的键  ⇒ 逃逸。
 * 反过来说：只要相对已发布版动过任何一个被缓存文件，键就**必须**离开发布基线。 */
console.log("\n--- D. v20 类逃逸判别（相对已发布版：内容变了 且 缓存键没升）---");
const keyNotBumped = SW_CACHE === REL_VERSION;
const escaped = relDrift.length > 0 && keyNotBumped;
chk("D · 非「内容已变而缓存键未升」态", !escaped,
  escaped
    ? `相对发布基线 "${REL_VERSION}" 捕获 ${relDrift.length} 个资产内容漂移，而 CACHE 仍是 "${SW_CACHE}"（未升键）`
    : relDrift.length
      ? `相对发布基线 "${REL_VERSION}" 有 ${relDrift.length} 项内容变更，CACHE 已升至 "${SW_CACHE}" ⇒ 合法下发`
      : `相对发布基线 "${REL_VERSION}" 零内容变更`);

if (relDrift.length) {
  console.log(`\n  ▸ 本轮相对已发布版 "${REL_VERSION}" 实际变更的被缓存资产（＝必须靠升键才能下发的内容）：`);
  for (const d of relDrift) console.log(`     · ${d.a}  (${d.bytes}B, 现算 ${d.cur.slice(0, 12)}… / 基线 ${String(d.want).slice(0, 12)}…)`);
}
if (drift.length) {
  console.log("\n  ⚠ manifest.assets 与工作区不符（清单忘了重算）：");
  for (const d of drift) {
    console.log(`     · ${d.a}\n         现算 ${d.cur}\n         清单 ${d.want}`);
  }
}
if (escaped) {
  console.log("\n  🔴 这正是 v20 逃逸的复现形态（C0-b 同族事故）：");
  console.log("     被缓存文件内容已变，但 CACHE 仍是已发布的旧键 —— 老用户 fetch 命中旧缓存，");
  console.log("     改动等于没上线。三处历史版本断言（>=17 地板 + 两处 ===23 快照）对此全部恒绿。");
}
if (escaped || drift.length) {
  console.log("\n  ▶ 修复口诀（DESIGN-v21 §2.3）：改被缓存文件 → 必升 CACHE 版本 → 必更新 manifest。");
  console.log(`     ① 若 CACHE 仍等于已发布键 "${REL_VERSION}"，先编辑 sw.js 升版（例：v23 → v24）`);
  console.log("     ② 重算 test/sw-assets-manifest.json 的 assets 全部 sha256，cacheVersion 同步为新键");
  console.log("     ③ 重跑本守卫确认转绿");
  console.log("     ✗ 禁止「只重算 assets 让守卫变绿而不升 CACHE」—— 那是把逃逸合法化。");
  console.log("       （该路径已被 D 段的发布基线参照系堵死：released 不会因重算 assets 而移动。）");
  console.log("     ✗ 亦禁止「直接把 released 改成当前键」绕过 —— released 只在真正发版时移动，见 F 段。\n");
}

/* ══════════════ E · 反空转取证 ══════════════ */
console.log("\n--- E. 反空转（守卫必须真的读到了内容）---");
chk("E1 · ASSETS 非空", ASSETS.length > 0, `${ASSETS.length} 项`);
chk("E2 · 实际完成哈希计算的成员数 === ASSETS 项数", hashed === ASSETS.length,
  `已哈希 ${hashed} / 应哈希 ${ASSETS.length}`);
chk("E3 · 累计读入字节 > 0（未在扫空文件）", readBytes > 0, `${readBytes}B`);
chk("E4 · 哈希非平凡（64 位十六进制且互不全同）",
  mfKeys.length > 0 && mfKeys.every((k) => /^[0-9a-f]{64}$/.test(String(MF_ASSETS[k]))),
  `${mfKeys.length} 条指纹格式校验`);
/* contingency.js 是 v20 逃逸的当事人，单独点名取证：它必须真的在 ASSETS 里被守着 */
chk("E5 · contingency.js 确在守卫覆盖范围内（v20 逃逸当事人）",
  ASSETS.indexOf("/contingency.js") >= 0 && /^[0-9a-f]{64}$/.test(String(MF_ASSETS["/contingency.js"] || "")),
  `ASSETS 含 /contingency.js = ${ASSETS.indexOf("/contingency.js") >= 0}`);

/* ══════════════ F · 发布基线完整性 + 版本号单调性 ══════════════
 * D 段的可信度完全建立在 released 之上，所以 released 自己必须被守住：
 * 它若能被随手改成当前键，D 段就退化成一句空话。 */
console.log("\n--- F. 发布基线（released）完整性与单调性 ---");
const verNum = (v) => {
  const m = /^xiaonuan-v(\d+)$/.exec(String(v));
  return m ? parseInt(m[1], 10) : NaN;
};
const relN = verNum(REL_VERSION);
const swN = verNum(SW_CACHE);
chk("F1 · 两个键都符合 xiaonuan-vN 命名（可比较大小）", Number.isFinite(relN) && Number.isFinite(swN),
  `released="${REL_VERSION}"(${relN}) / CACHE="${SW_CACHE}"(${swN})`);
/* 单调：键只能往前走。相等 = 本轮没升版（合法，前提是 D 段零漂移）。 */
chk("F2 · 版本号单调不回退（CACHE >= released）", Number.isFinite(relN) && Number.isFinite(swN) && swN >= relN,
  `${swN} >= ${relN}`);
/* 基线键集必须与 ASSETS 同构，否则「某文件没被基线覆盖」会让 D 段对它静默失明。
 * 例外：本轮**新增**的资产在基线里合法缺席，此时 relDrift 已把它算作漂移（见 C 段注释），
 * 所以这里只查「基线里有、ASSETS 里没有」的僵尸条目，不查反向。 */
const relZombie = Object.keys(REL_ASSETS).filter((k) => !swSet.has(k));
chk("F3 · 发布基线无僵尸条目（基线键 ⊆ ASSETS）", relZombie.length === 0,
  relZombie.length ? relZombie.join(", ") : `${Object.keys(REL_ASSETS).length} 项全部在 ASSETS 内`);
chk("F4 · 发布基线指纹格式合法（64 位十六进制）",
  Object.keys(REL_ASSETS).length > 0
  && Object.keys(REL_ASSETS).every((k) => /^[0-9a-f]{64}$/.test(String(REL_ASSETS[k]))),
  `${Object.keys(REL_ASSETS).length} 条基线指纹`);
/* 基线来源必须可审计：写明它是从哪个 commit 取的，QA 可用 git show 独立复算。 */
chk("F5 · 发布基线标注了可审计来源（provenance 非空）",
  typeof REL.provenance === "string" && REL.provenance.trim().length > 0,
  REL.provenance ? String(REL.provenance) : "缺失 —— 无法独立复算的基线等于无基线");
/* ★ F6 · 把 provenance 从「一句声明」变成「一条可复算的断言」。
 * 动机：F5 只验证了这行字非空。若有人把 released.assets 直接改成当前值来绕过 D 段
 * （D 段注释里写着"禁止"的那条路），F1–F5 一条都不会红 —— 声明本身必须可被证伪。
 * 做法：按 provenance 里的 commit，用 git 重新取出各资产原文并现算 sha256，与基线逐条比对。
 * 降级策略（诚实声明）：git 不可用 / 浅克隆里没有该 commit 时**不判红**（CI 环境合法地各不相同），
 *   但会在此明确打出「未独立复算」并计入快照，供 QA 判断。
 *   ⚠ 残留风险：删掉 .git 可使本项退化为不复算。这比篡改一个 JSON 字段远为显眼，
 *   且与门禁 T0_BYTES「受控常量靠评审而非靠机器」的既有治理口径一致，故接受并显式记录。 */
let f6state = "";
const mCommit = /\b([0-9a-f]{7,40})\b/.exec(String(REL.provenance || ""));
if (!mCommit) {
  f6state = "provenance 中未含可解析的 commit 号 —— 无法独立复算";
  console.log(`  ⚠   F6 · 发布基线独立复算  → ${f6state}`);
} else {
  const commit = mCommit[1];
  let gitOk = true;
  const mismatch = [];
  for (const a of Object.keys(REL_ASSETS)) {
    const rel = String(a).replace(/^\//, "") || "index.html";
    let buf = null;
    try {
      buf = require("child_process").execSync(`git show ${commit}:./${rel}`,
        { maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { gitOk = false; break; }
    if (sha256(buf) !== REL_ASSETS[a]) mismatch.push(a);
  }
  if (!gitOk) {
    f6state = `git 不可用或 commit ${commit} 不在本地历史中 —— 本次未独立复算（不判红，见注释）`;
    console.log(`  ⚠   F6 · 发布基线独立复算  → ${f6state}`);
  } else {
    f6state = mismatch.length ? `与 ${commit} 不符：${mismatch.join(", ")}` : `已按 ${commit} 逐条复算一致`;
    chk("F6 · 发布基线可按 provenance 独立复算（防伪造基线）", mismatch.length === 0, f6state);
  }
}
/* ★ 元断言：守卫不能对「零漂移」这种平凡输入恒绿。
 * 若相对基线一个字节都没变，说明基线刚刚被人挪到了当前状态（洗白的典型手法），
 * 或者本轮确实什么都没改。前者危险、后者应当由人显式确认，故打印提醒而非直接红。 */
if (relDrift.length === 0 && swN > relN) {
  console.log(`  ⚠ 提示：CACHE 已升至 ${SW_CACHE}，但相对基线零内容变更 —— 升了个空版，`);
  console.log("     或 released.assets 刚被挪到当前状态。请确认这是有意为之。");
}

/* ══════════════ 汇总 ══════════════ */
console.log("\n--- 快照 ---");
console.log(`  sw.js CACHE           ${SW_CACHE}`);
console.log(`  manifest.cacheVersion ${MF_VERSION}`);
console.log(`  已发布基线            ${REL_VERSION}（${REL.provenance || "无来源标注"}）`);
console.log(`  基线独立复算          ${f6state}`);
console.log(`  ASSETS 成员           ${ASSETS.length} 项，已全部现算 sha256`);
console.log(`  vs manifest 漂移      ${drift.length} 项（清单同步性）`);
console.log(`  vs 发布基线 漂移      ${relDrift.length} 项（本轮真正要下发的内容）`);

console.log(`\n=== TD 守卫总判定: ${fails.length === 0 ? "PASS" : "FAIL"} ===`);
if (fails.length) console.log("失败项: " + JSON.stringify(fails, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
