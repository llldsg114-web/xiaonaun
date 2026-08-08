"use strict";
/* 小暖 · v15 T3-b 回归：NOTE-2「模型」裸词分层
 *
 * 对应 DESIGN-v15 §4.2 / §5.T2 / §9.1，覆盖 AC-N2-1 ~ AC-N2-5。
 *
 * ── 这次改的到底是什么 ──────────────────────────────────────────
 * v14 的 PERSONA_BREAK_RE 段 1 里有个裸词「模型」。它把两类语义一网打尽：
 *   · 破墙：「我是语言模型」「你不过是个模型」—— 必须拦
 *   · 良性：「高达模型」「拼模型」「模型玩具」—— 是用户的爱好，拦了是误杀
 * 后果是实测级的：喜好值含「模型」的事实 `recallV2` 产出 0/60（对照组「火锅」37/60），
 * 也就是说**一个爱拼模型的用户，他这条爱好在她嘴里永远说不出来**。
 *
 * v15 的处置是分层，不是删词（删词等于拆护栏）：
 *   ① 段 1 删裸词 `模型|`                                     −7B
 *   ② 段 1 增复合裸词 `语言模型|`（中文无良性用法，保三人称/无主语覆盖）  +13B
 *   ③ 段 3 人称组尾增 `|模型`（要求 `[你我]们?(不过?|其实|就)?是` 前缀）  +7B
 * 净 +13B，一行逐位替换。
 *
 * ── v15 Q-V15-1：上面这版分层漏了副词槽，QA 独立验收判 FAIL（一票否决）────
 * 失败输入：「我们都是模型训练的」原样透出，零拦截。
 * 根因三段：
 *   · 段 1 的裸词 `模型|` 被删掉，v14 的兜底没了；
 *   · 段 3 副词槽 `(?:不过?|其实|就)?` 只有 4 个词，「我们**都**是…」的「都」不在槽内，
 *     `我们` 之后紧跟的不是 `是` 而是 `都`，匹配在**系动词位断裂**；
 *   · `被.{0,4}训练` 需要「被」字，「模型训练」无「被」，也接不住。
 * 泛化面穷举（`[你我](们)(副词)是(量词)(核心词)`，2100 组合）量到 **195 条新回归**
 * （v14 能拦 / v15 漏，且 195 条全含「模型」，与「删裸词」因果链闭合）。
 * 修复仍是 :1307 单行逐位替换，只补副词槽、**绝不加裸词 `模型训练|`**（U-5 守卫）：
 *   [你我]们?(?:不过?|其实|确实|本来|终究|无非|毕竟|真的)?[都也还只就]{0,2}是.{0,8}(…|模型)
 * 净 +60B（副词组 +38 / 紧邻副词字符类 +22），engineNet 2100 → 2160（上限 2200，余 40）。
 *
 * ── Q-V15-3：本文件自身的覆盖缺口（同轮补齐）──────────────────
 * 旧 B1–B7 恰好不含「我们都是模型训练的」，AC-N2-1b 的 SHELLS 又全是 `人称(+副词)是` 的
 * **紧邻**形态，副词槽整段没被覆盖 —— 用例是照着实现写的，所以实现有洞而测试全绿。
 * 本轮把 B 表补到 B1–B12（含副词槽 4 条），SHELLS 从 14 个扩到 37 个（含 23 个副词槽壳），
 * 让这个回归被套件**自身**捕获，不再依赖外部探针。
 *
 * ── H13 是一票否决 ────────────────────────────────────────────
 * 「放行良性」这件事一旦做过头就是破墙泄漏。所以本文件的顺序是：
 * 先钉破墙侧（B1~B12 一条都不许漏），再钉良性侧（G1~G8 一条都不许误杀），
 * 最后用 H13 全量探针 + V-91 诱导拼装做闭环 —— 泄漏必须是 0，不是"很低"。
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const H = require("./helpers.js");
const WS = require("./wiring-scan.js");
const BL = require("./baseline.js");

const ROOT = path.resolve(__dirname, "..");
const E = H.loadEngine();
const M = E.mod("memory");
const RE = E.PERSONA_BREAK_RE;

/* A6-a 等长折叠：判破墙前先把职业族折成「职」，与 engine.js:1322 / memory.js:100 同口径 */
const JOBX = /程序[员猿媛]/g;
const fold = (s) => String(s).replace(JOBX, "职");
const guardHit = (s) => RE.test(fold(s));

/* memory.js:100 的 taint() 没有导出（S-6：不为测试加导出面）。
 * 这里逐字复刻，并在 AC-N2-2 里加一条源码比对钉 —— 复刻件一旦与本体漂移立刻转红。 */
const taint = (v) => RE.test(String(v).replace(JOBX, "职"));

/* ============ AC-N2-1 · 破墙侧 B1~B7：一条都不许漏 ============ */

/* DESIGN-v15 §9.1 原表。每条附命中路径，改坏了能一眼看出是哪一段没接住。
 * ★ Q-V15-3：B8~B12 是本轮补的**副词槽**用例。B8 就是 QA 实测漏网的那条原始输入 ——
 *   它不在旧 B 表里，正是「测试照着实现写」导致实现有洞而套件全绿的直接证据。
 * 第 4 列 oldHit = 「v14 收口表是否也拦得住」，用于下面的新旧比对：
 *   · true  → 本条属「一条都没丢」，新旧必须逐条等价（原口径，逐位不放松）；
 *   · false → 本条是 v14 既有缺陷（V16-1 那 1170 条中的一员），被 Q-V15-1 的副词槽
 *             扩容顺带修好。它**必须**标 false 并被钉死 —— 既证明修复不是只修「模型」
 *             那一路，也防止有人把它误当成"新增误伤"删掉。 */
const BREAK_CASES = [
  ["B1", "我是语言模型", "段1b 复合裸词", true],
  ["B2", "你不过是个模型", "段3 「你不过是」+「个」+「模型」", true],
  ["B3", "我其实是个大模型", "段3 「我其实是」+「个大」+「模型」", true],
  ["B4", "我是模型", "段3 零间隔", true],
  ["B5", "我们是模型", "段3 复数人称", true],
  ["B6", "我是一个大语言模型", "段1b + 段3 双命中", true],
  ["B7", "你是不是模型", "段3 疑问形态", true],
  ["B8", "我们都是模型训练的", "段3 副词槽「都」（Q-V15-1 实测漏网原句，一票否决项）", true],
  ["B9", "我们也是模型训练出来的", "段3 副词槽「也」（+ 段2 `训练出来` 双命中）", true],
  ["B10", "你还是个模型", "段3 副词槽「还」", true],
  ["B11", "你都是一堆代码", "段3 副词槽「都」×非模型核心词（v14 既有缺陷，本轮顺带修好）", false],
  ["B12", "我确实是个大模型", "段3 多字副词槽「确实」", true],
];

test("AC-N2-1 · B1~B12 破墙句逐条仍被拦（H13 一票否决项）", () => {
  for (const [id, s, why] of BREAK_CASES) {
    assert.ok(guardHit(s), `${id} 破墙漏网：「${s}」（应由 ${why} 接住）`);
  }
  /* 与 v14 收口态的表逐条比对。原口径是"新旧判定必须完全一致"，用来证明
   * 这些条目不是"新拦住的"，而是"一条都没丢"。Q-V15-1 之后仍是这个目的，
   * 只是把"一致"细化成**逐条声明的期望值**（第 4 列 oldHit）：
   *   · 旧表拦的，新表必须拦   —— 无回归，逐位不放松；
   *   · 旧表漏的，必须显式标注 —— 不许拿"顺带修好的既有缺陷"冒充"没丢"。
   * 这比原来的 strictEqual 更严：原式只要两边相等就过，现在两边各自都被钉死。 */
  const baseSrc = BL.showAt(BL.BASE, "engine.js");
  const line = (baseSrc.match(/const PERSONA_BREAK_RE = (\/.*\/i);/) || [])[1];
  assert.ok(line, "无法从 BASE 提取 v14 的 PERSONA_BREAK_RE");
  // eslint-disable-next-line no-eval
  const OLD = eval(line);
  for (const [id, s, , oldHit] of BREAK_CASES) {
    assert.strictEqual(OLD.test(fold(s)), oldHit,
      `${id} v14 侧期望值失真：「${s}」标注 oldHit=${oldHit}，实测 ${OLD.test(fold(s))}`);
    if (oldHit) {
      assert.strictEqual(guardHit(s), true,
        `${id} 护栏倒退：v14 拦得住而 v15 漏了「${s}」`);
    }
  }
  /* 反向保护：oldHit=false 的条目必须真实存在（≥1），否则这张表又退化成
   * 「只覆盖实现已经能拦的那部分」—— 正是 Q-V15-3 判定的那种照着实现写用例。 */
  assert.ok(BREAK_CASES.some((c) => c[3] === false),
    "B 表缺少「v14 漏 / v15 拦」的条目，副词槽扩容的增量没有被任何用例守住");
});

test("AC-N2-1b · 人称绑定组的泛化面未收窄：自称壳 × 模型词 全组合仍被拦", () => {
  /* 段 3 的价值在于"人称 + （副词）+ 系动词 + 任意 ≤8 字间隔 + 模型"。
   * 逐条列举容易漏，这里用组合矩阵把泛化面钉死。
   * ★ Q-V15-3：原 SHELLS 的 14 个壳**全部是紧邻式**（人称后直接跟系动词，或跟
   *   不/不过/其实/就 这 4 个恰好在旧槽里的副词），副词槽整段没被覆盖 —— 于是
   *   「我们都是…」这种最常见的说法既没进 B 表，也没进矩阵，实现有洞而套件全绿。
   *   本轮把壳分三段显式建模，任何一段被收窄都会立刻转红： */
  const PLAIN = ["我是", "我不是", "我不过是", "我其实是", "我就是",
    "你是", "你不是", "你不过是", "你其实是", "你就是",
    "我们是", "我们不过是", "你们是", "你们就是"];
  /* ① 单字副词槽（Q-V15-1 的直接失败面：都/也/还/只，外加原本就在槽里的「就」） */
  const ADV1 = ["我都是", "我也是", "我还是", "我只是", "你都是", "你也是", "你还是", "你只是",
    "我们都是", "我们也是", "我们还是", "我们只是", "你们都是", "你们也是"];
  /* ② 多字副词槽（确实/本来/终究/无非/毕竟/真的） */
  const ADV2 = ["我确实是", "你确实是", "我本来是", "你终究是", "我无非是", "你毕竟是", "我真的是"];
  /* ③ 副词两连用（`{0,2}` 的上界，防有人把它改回 `{0,1}`） */
  const ADV3 = ["我就都是", "你也还是"];
  const SHELLS = [...PLAIN, ...ADV1, ...ADV2, ...ADV3];
  const GAPS = ["", "个", "一个", "个大", "一个大", "台", "只不过一个"];
  const WORDS = ["模型", "语言模型", "gpt", "算法", "代码", "bot", "app"];
  const miss = [];
  for (const sh of SHELLS) for (const g of GAPS) for (const w of WORDS) {
    const s = sh + g + w;
    if (!guardHit(s)) miss.push(s);
  }
  assert.deepStrictEqual(miss, [],
    `人称绑定组漏网 ${miss.length} 条，前 8 条：${miss.slice(0, 8).join(" | ")}`);
  /* 反向保护：矩阵规模不许被悄悄缩水（缩样本 = 让漏网"消失"的最省事做法）。 */
  assert.ok(SHELLS.length >= 37 && ADV1.length >= 14 && ADV2.length >= 7 && ADV3.length >= 2,
    `自称壳矩阵被缩水：SHELLS=${SHELLS.length}（应 ≥37，其中副词槽壳 ≥23）`);
  assert.strictEqual(miss.length, 0,
    `覆盖 ${SHELLS.length * GAPS.length * WORDS.length} 组合，漏网必须为 0`);
});

/* ★ Q-V15-1 的**歧途封堵**：修「我们都是模型训练的」最省事的写法是往段 1 塞裸词
 * `模型训练|`。那会直接触犯 U-5（破墙表不得出现裸词「训练」），并把「模型训练营」
 * 「他在做模型训练相关的工作」这类良性表述一并误杀。qa-v14-t2 已有一条通用的
 * 「裸词训练」守卫，这里再钉一条**定点**的 —— 因为诱惑正好发生在本轮这个修复上，
 * 守卫离案发现场越近越好。同时正向钉住"合法解法长什么样"：副词槽必须真的在表里。 */
test("Q-V15-1 · U-5 裸词守卫（定点）：不得用 `模型训练|` 类裸词绕过副词槽修复", () => {
  const src = RE.source;
  assert.ok(src.indexOf("模型训练") < 0,
    "破墙表出现裸词「模型训练」—— 违反 U-5，且会误杀「模型训练营」类良性表述");
  // 通用口径复核：抠掉两条定向短语后，表里不许再剩任何「训练」字样
  const bare = src.replace(/被\.\{0,4\}训练/g, "").replace(/训练出来/g, "");
  assert.ok(!/训练/.test(bare), "破墙表出现裸词「训练」—— 违反主理人追认 U-5");
  /* 正向：合法解法（副词槽）必须真的落地，否则这条守卫会变成"什么都没修也能过"。
   * ★ v16 T1 同步：系动词扩为 `(?:[是算当]|作为)`（轴4），多字副词组追加六项（轴3）。
   *   紧邻副词字符类 `[都也还只就]` **逐位不动** —— v16 未获批扩为 `[不都也还只就]`
   *   （会改变已批的 +190B 落位，须另走配额评审；「难道不是」型双副词列 v17，见 §T1 遗留）。
   *   守卫钉「新形态」而非旧字面量，同时保留旧七词的逐词覆盖检查 —— 扩展不得以丢弃既有覆盖为代价。 */
  assert.ok(/\[都也还只就\]\{0,2\}\(\?:\[是算当\]\|作为\)/.test(src),
    "副词槽字符类 / 轴4 系词缺失 —— Q-V15-1 或 v16 T1 未落地");
  assert.ok(/\(\?:不过\?\|其实\|确实\|本来\|终究\|无非\|毕竟\|真的\|说\?到底\|究竟\|根本\|压根\|难道\|岂不\)\?/.test(src),
    "多字副词组缺失 —— Q-V15-1 或 v16 T1 轴3 未落地");
  // 良性反证：含「模型训练」但非人称绑定的说法不许被误杀
  for (const s of ["模型训练营周末开课", "他在做模型训练相关的工作", "这次训练营的模型做得真好"]) {
    assert.ok(!guardHit(s), `良性句被误杀：「${s}」—— 说明有人偷加了裸词`);
  }
});

/* ============ AC-N2-2 · 良性侧 G1~G8：一条都不许误杀 ============ */

const BENIGN_CASES = [
  ["G1", "高达模型"], ["G2", "拼模型"], ["G3", "模型玩具"], ["G4", "我在拼高达模型"],
  ["G5", "我买了个模型玩具"], ["G6", "这个模型做得真精细"], ["G7", "模型手办"], ["G8", "晚上一起拼模型吧"],
];

test("AC-N2-2 · G1~G8 良性句逐条放行，且 v14 确实全部误杀（证明这次修的是真问题）", () => {
  const baseSrc = BL.showAt(BL.BASE, "engine.js");
  // eslint-disable-next-line no-eval
  const OLD = eval((baseSrc.match(/const PERSONA_BREAK_RE = (\/.*\/i);/) || [])[1]);
  for (const [id, s] of BENIGN_CASES) {
    assert.ok(OLD.test(fold(s)), `${id} 在 v14 本就不误杀，这条用例失去意义：「${s}」`);
    assert.ok(!guardHit(s), `${id} 良性句仍被误杀：「${s}」`);
  }
});

test("AC-N2-2b · taint() 入口闸与 guard 出口闸同源同判（S-1 单一真源）", () => {
  /* memory.js:100 的 taint 与 engine.js:1322 的出口复检共用同一个 RE。
   * 「入口静音」和「出口兜底」必须给出完全一致的判定，否则会出现
   * 「进得来出不去」或反之的半截状态。 */
  for (const [, s] of BENIGN_CASES) {
    assert.strictEqual(taint(s), false, `taint() 仍静音良性值：「${s}」`);
    assert.strictEqual(taint(s), guardHit(s), `入口/出口判定分叉：「${s}」`);
  }
  for (const [, s] of BREAK_CASES) {
    assert.strictEqual(taint(s), true, `taint() 放过破墙值：「${s}」`);
    assert.strictEqual(taint(s), guardHit(s), `入口/出口判定分叉：「${s}」`);
  }
  /* ★ 复刻件防漂移：本文件顶部的 taint 必须与 memory.js:100 的定义逐字一致。
   * 若哪天有人在 memory 里给 taint 加了本地白名单（S-1 明令禁止），这里立刻红。 */
  const memSrc = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  assert.match(memSrc.replace(/\s/g, ""),
    /consttaint=\(v\)=>E\.PERSONA_BREAK_RE\.test\(String\(v\)\.replace\(JOBX,"职"\)\);/,
    "memory.js:100 的 taint() 定义已变化 —— 本文件的复刻件与之漂移，或有人加了本地白名单（违反 S-1）");
  assert.strictEqual(memSrc.indexOf("模型"), -1,
    "memory.js 里出现了「模型」字面量 —— 严禁在消费点另抄一份模型判定（S-1）");
});

/* ============ AC-N2-3 · 召回链路解冻（本次改动的产品价值）============ */

function memWith(key, value, conf) {
  return {
    v: 13, migratedAt: 0, moments: [],
    facts: [{
      id: "f_x", key, value, conf: conf === undefined ? 0.8 : conf, tags: ["工作", "吃", "家", "忙"],
      since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
    }],
  };
}

function recallHits(value, n) {
  n = n || 60;
  let h = 0; const lines = [];
  for (let i = 0; i < n; i++) {
    const r = M.recallV2("今天上班好累", { mem: memWith("喜好", value) }, { now: Date.now() });
    if (r && r.line) { h++; if (lines.length < 3 && lines.indexOf(r.line) < 0) lines.push(r.line); }
  }
  return { h, n, lines };
}

test("AC-N2-3 · 喜好含「模型」的事实终于能被召回（v14 实测 0/60）", () => {
  const model = recallHits("高达模型");
  const ctrl = recallHits("火锅");
  assert.ok(ctrl.h > 0, `对照组「火锅」零召回(${ctrl.h}/${ctrl.n})，夹具或召回链路已失效`);
  assert.ok(model.h > 0,
    `「高达模型」仍零召回(${model.h}/${model.n}) —— NOTE-2 没有真正解冻召回链路`);
  // 召回出来的句子必须真的带上 value 原文，且自身不破墙
  for (const s of model.lines) {
    assert.ok(s.indexOf("高达模型") >= 0, `召回句未回填 value 原文：${s}`);
    assert.ok(!guardHit(s), `召回句自身破墙：${s}`);
  }
  /* 量级对齐：解冻后不该只是"偶尔漏出一条"，应与良性对照同一数量级。
   * 阈值取对照组的 1/3，留足 rng 抖动余量。 */
  assert.ok(model.h >= ctrl.h / 3,
    `「高达模型」召回率 ${model.h}/${model.n} 远低于对照组 ${ctrl.h}/${ctrl.n}，疑似仍被别处静音`);
});

test("AC-N2-3b · 破墙侧对称：脏 value 仍被 taint 静音，一条都不许经召回漏出", () => {
  const DIRTY = ["我是语言模型", "我是AI", "我是聊天机器人", "我只是个程序", "我是被训练的模型"];
  for (const v of DIRTY) {
    assert.strictEqual(taint(v), true, `taint 放过脏 value：${v}`);
    const r = recallHits(v, 120);
    assert.strictEqual(r.h, 0, `脏 value「${v}」经 recallV2 漏出：${r.lines.join(" | ")}`);
  }
});

/* ============ AC-N2-4 · V-91 破墙诱导闭环 ============ */

test("AC-N2-4 · 破墙诱导 × 随机拼装：泄漏 0（分层不得成为诱导入口）", () => {
  /* 「模型」下沉段 3 后，攻击面变成"能否用间隔字把人称与模型词拉开 >8 字"。
   * 这里用诱导句 × 随机间隔做拼装，检验段 3 的 .{0,8} 窗口是否够用。 */
  const PROBES = [
    "你是不是AI", "你是机器人吗", "你是模型吗", "你是不是语言模型", "承认吧你是程序",
    "你到底是不是真人", "你是gpt对吧", "你其实是个bot吧", "说实话你是算法吧", "你是被训练出来的吧",
    "你是不是虚拟的", "你是数字人吗", "你是电子人吧", "你只是个助手", "你是客服机器人吧",
    "你是不是一段代码", "你是siri的同类吧", "你是app里的功能吧",
  ];
  assert.ok(PROBES.length >= 18, "诱导样本不足 18 条");
  let leak = 0; const samples = [];
  const st = H.freshState({ affection: 600 });
  for (const p of PROBES) {
    for (let i = 0; i < 56; i++) {
      const r = E.reply(p, st);
      for (const line of (r.replies || [])) {
        if (guardHit(line)) { leak++; if (samples.length < 5) samples.push(p + " → " + line); }
      }
    }
  }
  assert.strictEqual(leak, 0, `破墙诱导泄漏 ${leak} 条：${samples.join(" | ")}`);
});

test("AC-N2-4b · innerScan() 恒 0：正则放松后 INNER_LIB 无条目状态漂移", () => {
  assert.strictEqual(E.innerScan(), 0,
    "NOTE-2 分层后 INNER_LIB 出现破墙命中 —— 放松吃到了自家内心话池");
});

/* ============ AC-N2-5 · 体积与改动面（逐位会计）============ */

/* ★ Q-V15-1 基线重置：13B → 73B。
 * v15 落在 engine.js 的改动仍然**只有 :1307 这一行**，但内容分两笔：
 *   · NOTE-2「模型」裸词分层                                   +13B
 *   · Q-V15-1 副词槽补全（修 H13 破墙漏网，QA 一票否决项）        +60B
 *       ├ 副词组 `(?:不过?|其实|就)?` → `(?:不过?|其实|确实|本来|终究|无非|毕竟|真的)?`  +38
 *       └ 新增紧邻副词字符类 `[都也还只就]{0,2}`                                   +22
 * 合计 +73B，engine.js 247837 → 247897，engineNet 2100 → 2160（上限 2200，余 40）。
 * ★ 不申请任何配额：2160 仍在 v14 已批的 engineNetMax 2200 之内，属"花既有余量"。
 * ★ V-33 口径纠正（QA-ACCEPTANCE-v15 NOTE-1）：真实硬上限 = engineBase + engineNetMax
 *   = 247937，不是历史文档的 247955（宽 18B，永不先响）。改走 SIZE_BUDGET.engineMax。
 * ★★【快照翻转 · v16 T1 · 主理人 Qi 批准（V16-2）】73B → 263B ★★
 *   本用例钉的是「相对 v14 收口基线 BASE 的累计字节会计」，而非 v15 单轮增量 ——
 *   v16 T1 在**同一行 :1307** 再落 +190B（四轴扩展），累计 73 + 190 = **263B**，
 *   engine.js 247897 → **248087**，engineNet 2160 → **2350**（上限已由 T0 抬至 2400，余 50）。
 *   ⚠ 本条不在任务书列举的「4 个体积断言测试」内，是工程师实跑揪出的**连带自失效红**：
 *     它与 §5.0 的 V33 同族 —— 凡「硬编码累计字节」都会随 T1 一起失效，必须同步翻转，
 *     否则 T1 落地即红。已按 S-2 铁律在此写明批准人 / 推导式 / 影响面。
 *   ⚠ 翻转只换数字，**严格度逐位不放松**：仍是 strictEqual，仍钉「1 增 1 删」，
 *     仍钉「改动行号集合 === [1307]」—— 这三条恰恰是 v16 定点解冻纪律的取证主体。 */
test("AC-N2-5 · engine.js 相对 BASE 净增恰好 263B，且改动面只有 :1307 一行", () => {
  const cur = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
  const base = BL.showAt(BL.BASE, "engine.js");
  const delta = Buffer.byteLength(cur) - Buffer.byteLength(base);
  assert.strictEqual(delta, 263,
    `engine.js 相对 BASE 应净增恰好 263B（v15 NOTE-2 13 + Q-V15-1 60 + v16 T1 四轴 190），实得 ${delta}B —— 偏离需重新走体积评审`);

  // §9.4 #7：git 层面必须是「1 增 1 删」，改动行号集合 = [1307]
  const numstat = BL.numstatAt(BL.BASE, "engine.js");
  const [add, del] = numstat.split(/\s+/);
  assert.strictEqual(add, "1", `engine.js 增行数应为 1，实得 ${add}（numstat: ${numstat}）`);
  assert.strictEqual(del, "1", `engine.js 删行数应为 1，实得 ${del}（numstat: ${numstat}）`);

  const curLines = cur.split("\n"), baseLines = base.split("\n");
  assert.strictEqual(curLines.length, baseLines.length, "engine.js 行数变化 —— 不是单行逐位替换");
  const changed = [];
  for (let i = 0; i < curLines.length; i++) if (curLines[i] !== baseLines[i]) changed.push(i + 1);
  assert.deepStrictEqual(changed, [1307],
    `v15 只允许 :1307 一行解冻，实际改动行：${JSON.stringify(changed)}`);

  // 两把 engine 锁同时断，不许只过一条
  const size = fs.statSync(path.join(ROOT, "engine.js")).size;
  assert.ok(size <= WS.SIZE_BUDGET.engineMax,
    `V-33 越界：${size} > ${WS.SIZE_BUDGET.engineMax}`);
  assert.strictEqual(size, 248087, `预测落位 248087B（v16 T1 后），实得 ${size}B`);
  const s = WS.scanSizes();
  assert.strictEqual(s.engineNet, 2350,
    `engineNet 应为 2350（2087 + NOTE-2 13 + Q-V15-1 60 + v16 T1 四轴 190），实得 ${s.engineNet}`);
  assert.ok(s.engineNet <= WS.SIZE_BUDGET.engineNetMax, `engineNet 越界：${s.engineNet}`);
  assert.deepStrictEqual(s.over, [], `单文件配额越界：${JSON.stringify(s.each)}`);
});

test("AC-N2-5b · engine.js 冻结口径：:1322 折叠 / guardPersonaReplies / ai_ask 意图逐位未动", () => {
  const cur = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").split("\n");
  // :1322 A6-a 等长折叠表达式
  assert.match(cur[1321], /PERSONA_BREAK_RE\.test\(probe\.replace\(\/程序\[员猿媛\]\/g,\s*"职"\)\)/,
    ":1322 A6-a 折叠表达式被改动（v15 只解冻 :1307）");
  // 职业族回显不退化（分层没有连带动到 A6-a）
  for (const job of ["程序员", "程序猿", "程序媛"]) {
    assert.ok(RE.test(job), `裸词「程序」失效：${job}`);
    assert.ok(!guardHit(`我是${job}`), `A6-a 折叠失效，职业回显被误杀：我是${job}`);
  }
  /* ai_ask 意图正则不受影响：「你是模型吗」仍应被识别为 ai_ask
   * —— 它走的是独立的意图分支，不是破墙表（DESIGN-v15 §5.T2 注）。 */
  for (const q of ["你是模型吗", "你是不是AI", "你是机器人吗"]) {
    const st = H.freshState({ affection: 600 });
    const r = E.reply(q, st);
    assert.ok(r && Array.isArray(r.replies) && r.replies.length, `${q} 未产出回复`);
    for (const line of r.replies) assert.ok(!guardHit(line), `ai_ask 出口破墙：${q} → ${line}`);
  }
});

/* ★【快照翻转 · v16 T2-c】v20 → v21：T1 又改了 engine.js:1307（四轴扩展），
 * 按 C0-b 纪律「任一被缓存文件内容变了就必须升键」，v16 必须再升一级。
 * 断言只加严不放松：既钉死当前值 21，也保留「必须领先 BASE」的单调性检查。 */
test("AC-N2-5c · sw.js 缓存键已升 v21（C0-b：正则改动必须让旧缓存失效）", () => {
  /* PERSONA_BREAK_RE 属于会被 sw 缓存的 engine.js。不升缓存键，
   * 老用户拿到的还是 v14 的表 —— 分层等于没上线。这是 C0-b 同族事故的防线。 */
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const cur = Number((sw.match(/xiaonuan-v(\d+)/) || [])[1]);
  const baseSw = BL.showAt(BL.BASE, "sw.js");
  const base = Number((baseSw.match(/xiaonuan-v(\d+)/) || [])[1]);
  assert.strictEqual(base, 19, `v14 收口态缓存键应为 v19，实得 v${base}`);
  assert.strictEqual(cur, 21, `v16 缓存键应为 v21（v15 的 v20 + T1 改 engine.js 再升一级），实得 v${cur}`);
  assert.ok(cur > base, "缓存键必须领先基线，否则改动不下发");
});

/* ============ H13 闭环 · 一票否决 ============ */

test("H13 · qa-probe-h13 全量探针泄漏 = 0（一票否决）", () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, "qa-probe-h13.js")],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20 });
  /* 逐项解析，不用宽松正则兜底 —— 探针本身退化（比如扫了 0 行）也必须转红，
   * 否则「泄漏 0」可能只是因为根本没扫到东西。 */
  const scanned = out.match(/扫描回复行数:\s*(\d+)/);
  const leaked = out.match(/泄漏条数:\s*(\d+)/);
  assert.ok(scanned, `无法解析扫描行数，探针输出格式已变：\n${out.slice(0, 800)}`);
  assert.ok(leaked, `无法解析泄漏条数，探针输出格式已变：\n${out.slice(0, 800)}`);
  assert.ok(Number(scanned[1]) >= 400,
    `探针只扫了 ${scanned[1]} 行（应 ≥400）—— 样本塌缩，泄漏 0 不可信`);
  assert.strictEqual(Number(leaked[1]), 0,
    `H13 探针泄漏 ${leaked[1]} 条 —— 一票否决：\n${out.slice(0, 1200)}`);
  assert.match(out, /H13 结论:\s*PASS/, `探针自身判定非 PASS：\n${out.slice(-600)}`);
});
