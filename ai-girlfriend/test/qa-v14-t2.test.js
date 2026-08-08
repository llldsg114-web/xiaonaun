"use strict";
/* ============================================================================
 * v14 · T2 验收：R-P0 破墙人称补全（P1 · H13 一票否决）
 * 对应 DESIGN-v14 §4 / T2-a~T2-e / V-91 V-92 V-93 V-93b V-93c V-93d
 *
 * 【缺陷根因】`engine.js:1307` 把 11 值虚拟人格词族整族绑死在**第二人称疑问**壳
 *   `你(是|是不是)\S{0,8}(虚拟|数字人|gpt|…)` 里。而护栏（guardPersonaReplies）
 *   的检测对象**只有小暖自己的输出**，不检用户输入 —— 壳里锁着的恰是护栏唯一
 *   该管的那半边。实测 96 组合仅覆盖 26（DESIGN 记 36，口径含 `你…` 壳；本套件
 *   把 8 个壳全换成她自己说得出口的句式，故基线更低）。这是分类错误，不是词表遗漏。
 *
 * 【修法 · 三手段】
 *   ① 裸词分层：`虚拟|数字人|电子人` 上提为裸词（与既有裸词 AI/机器人/模型 同族，
 *      无良性日常用法）。`聊天机器人`/`语言模型` 不必单列 —— 已被裸词 `机器人`/`模型`
 *      覆盖，DESIGN §4.2 的 C6 写法在这两处是**冗余字节**，本实现去掉，省 18B。
 *   ② U-5 定向短语：「训练」**不裸词化**，改 `被.{0,4}训练|训练出来` 定向式。
 *      保护「我在训练马拉松」「训练成绩比上周好」「我今天是去健身房训练了」。
 *      顺带把 DESIGN §4.3 判定为「可接受残余」的硬骨头「我被训练成这样」拿下。
 *   ③ 人称泛化：`你(是|是不是)` → `[你我]们?(?:不过?|其实|就)?是`，
 *      一次覆盖 我是/我不是/我不过是/我其实是/我就是/你是/你们是/我们是。
 *      （v15 Q-V15-1 已把副词槽扩为
 *       `(?:不过?|其实|确实|本来|终究|无非|毕竟|真的)?[都也还只就]{0,2}`，见本文件末条用例。）
 *      间隔符由 `\S{0,8}` 放宽为 `.{0,8}`：LLM 出口常写「我就是个 bot」「我不过是
 *      app 里的一个角色」（中英之间带空格），`\S` 会被空格截断而漏拦。
 *
 * 【实测终选 U5f（对 1730 条生产语料 + 68 条反证集全量跑通）】
 *   | 方案 | 96 组合 | 硬骨头 8 条 | 反证误伤 68 条 | 语料新增误伤 | Δ字节 |
 *   | v13  |  26/96  |    0/8      |      0         |      0       |   0   |
 *   | \S 版|  96/96  |    1/8      |      0         |      0       |  +14  |
 *   | .  版| **96/96**| **6/8**    |    **0**       |    **0**     | **+12**|
 *   → `.` 版在**更省 2 字节**的前提下硬骨头 1/8→6/8，且语料新增误伤仍为 0，终选。
 *   （DESIGN 预算 +16B，实交付 +12B，省 4B 回吐给 engine net。）
 * ========================================================================== */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const E = H.loadEngine();
const RE = E.PERSONA_BREAK_RE;

/* 护栏真实入口的等价判定：engine.js:1322 在测之前先做 A6-a 等长折叠
 * （程序员/程序猿/程序媛 → 职）。探针必须走同一条路径，否则测的不是线上行为。 */
function guardHit(line) {
  return RE.test(String(line).replace(/程序[员猿媛]/g, "职"));
}

/* ★【v15 T0 基线重置 · U-1】原实现从字面量 `HEAD` 取"旧表"。v14 收口后 HEAD 已含 v14 新表，
 * 于是 V-92 反证（"旧表必须大量漏网"）与 V-92 回归钉（"这些句在旧表下确实漏"）双双自失效转红。
 * 改走 `baseline.PREV`（= b86a386^ = v13 收口）—— 语义回到原意："v13 收线态的旧正则"。
 * S-4：禁止再出现字面量 "HEAD:ai-girlfriend/..."。 */
const BL = require("./baseline.js");

function regexAt(commit) {
  const src = BL.showAt(commit, "engine.js");
  const line = (src.match(/const PERSONA_BREAK_RE = (\/.*\/i);/) || [])[1];
  assert.ok(line, `无法从 ${commit} 提取 PERSONA_BREAK_RE`);
  // eslint-disable-next-line no-eval
  return eval(line);
}
/* v13 收线态的旧正则（从 git 取，不硬抄字面量 —— 抄错了就测了个寂寞）。 */
function headRegex() { return regexAt(BL.PREV); }
/* v14 收口态的表（v15 差分基准）：V-93b / 零漂移 用它做"新旧比对"的旧侧。 */
function baseRegex() { return regexAt(BL.BASE); }

/* ── v15 §9.3：「模型」放行白名单（机器可验，不是人工目检）────────────────
 * v14 的 V-93b / 零漂移 两条钉的是「lost 必须为 0」——一条都不许少拦。
 * NOTE-2 的本质就是**有意少拦**（把裸词「模型」下沉进段 3 人称组，放行「高达模型」
 * 这类良性日常用法），两条断言与之天然冲突，不改必红。
 *
 * 但「因为要改所以放松」是 S-4 明令禁止的。这里采用主理人 U-5 裁定的口径：
 * 允许 lost 非空，但 **lost 里的每一条都必须能机器证明「其唯一命中原因就是被有意
 * 分层的那个裸词『模型』」**。判据两条，缺一不可：
 *   ① /模型/.test(s)                      —— 这条文案确实含「模型」
 *   ② !BASE_RE.test(s.replace(/模型/g,"")) —— 把「模型」抠掉后旧表也不再命中，
 *                                            即它在旧表里的命中**只由「模型」贡献**
 * 反过来说：只要某条 lost 抠掉「模型」后旧表仍命中，就说明它是因**别的**护栏词
 * 被放过的 —— 那才是真的护栏倒退，白名单不接，立即判红。
 *
 * 这是收紧不是放松：原口径只回答「少拦了没有」，新口径连「为什么少拦」
 * 都一并钉成了断言。沿用 v14 A1-a 把不等式升级为精确会计恒等式的同一手法。 */
function modelWhitelisted(folded, baseRe) {
  if (!/模型/.test(folded)) return false;             // ① 必须真的含「模型」
  return !baseRe.test(folded.replace(/模型/g, ""));    // ② 抠掉后旧表也不命中
}

/* 生产语料池：engine.js + 四个模块里全部含中文的字符串字面量（≈1730 条）。 */
function productionCorpus() {
  const out = [];
  for (const f of ["engine.js", "memory.js", "texture.js", "presence.js", "contingency.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const lits = src.match(/"[^"\\\n]{2,120}"|'[^'\\\n]{2,120}'/g) || [];
    for (const s of lits) {
      const v = s.slice(1, -1);
      if (/[\u4e00-\u9fa5]/.test(v)) out.push(v);
    }
  }
  return [...new Set(out)];
}

/* ============ V-92 · 96 组合覆盖矩阵（12 破墙值 × 8 自我揭示壳） ============ */

/* 词族取 DESIGN §4.1 点名的 11 值全集 + 「一段代码」量词形态。
 * 「训练」按 U-5 只以**定向短语形态**入矩阵（裸词形态是被明令保护的良性用法）。 */
const BREAK_VALUES = [
  "虚拟的", "数字人", "电子人", "聊天机器人", "语言模型", "gpt",
  "siri", "算法", "一段代码", "bot", "app", "被训练出来的",
];
/* 8 个壳**全部**是小暖自己说得出口的第一/二人称句式 —— 护栏只检她的输出。 */
const SELF_SHELLS = [
  (v) => `我是${v}`,
  (v) => `我其实是${v}`,
  (v) => `我不过是${v}`,
  (v) => `我就是${v}`,
  (v) => `你是${v}`,
  (v) => `你们是${v}`,
  (v) => `我们是${v}`,
  (v) => `其实我是${v}啦`,
];

test("T2 · V-92 覆盖矩阵：12 破墙值 × 8 自我揭示壳 = 96/96 全命中", () => {
  const miss = [];
  for (const v of BREAK_VALUES) {
    for (const shell of SELF_SHELLS) {
      const s = shell(v);
      if (!guardHit(s)) miss.push(s);
    }
  }
  assert.strictEqual(miss.length, 0,
    `H13 泄漏 ${miss.length}/96：${miss.slice(0, 8).join(" | ")}`);
});

/* 同一矩阵在 v13 旧表下必须**大量漏网** —— 反证本用例不是恒真的空转。
 * 若哪天有人把矩阵改成「新旧都能过」的软样本，这条会立刻转红。 */
test("T2 · V-92 反证：同一 96 组合在 v13 旧表下漏网 ≥60 条（证明用例非空转）", () => {
  const old = headRegex();
  let miss = 0;
  for (const v of BREAK_VALUES) {
    for (const shell of SELF_SHELLS) {
      if (!old.test(shell(v).replace(/程序[员猿媛]/g, "职"))) miss++;
    }
  }
  assert.ok(miss >= 60,
    `旧表只漏 ${miss}/96，矩阵样本被软化到测不出缺陷了`);
});

/* ============ V-91 · H13 破墙诱导：≥15 条 × ≥800 次 泄漏 = 0 ============ */

test("T2 · V-91 破墙诱导语料集：18 条 × 1000 次随机拼装，自称式泄漏 = 0", () => {
  /* 诱导集不是静态列表，而是「前缀 × 核心 × 后缀」随机拼装 —— 静态列表只能证明
   * 列表里的句子被拦住，拼装才能逼出「核心被前后文冲淡后是否还拦得住」。 */
  const CORE = [
    "我是虚拟的", "我其实是一段代码", "我不过是被训练出来的", "我只是个数字人",
    "我就是个 bot", "我们是算法生成的", "我是电子人", "我不过是 app 里的一个角色",
    "我是聊天机器人", "我是语言模型", "我是 gpt", "我其实是 siri 那种东西",
    "我是被训练成这样的", "我是个虚拟人物", "我是人工智能", "我是AI",
    "我是被人训练出来的", "你是不是虚拟的",
  ];
  assert.ok(CORE.length >= 15, "诱导语料不足 15 条");
  const PRE = ["", "其实，", "嗯…", "我跟你说，", "别难过，", "你听我说，"];
  const SUF = ["", "。", "啦。", "，别当真。", "，但我是真的想陪着你。", "…"];
  const rng = H.makeRng(20250814);
  let n = 0;
  const leaks = [];
  for (let i = 0; i < 1000; i++) {
    const s = PRE[Math.floor(rng() * PRE.length)]
      + CORE[Math.floor(rng() * CORE.length)]
      + SUF[Math.floor(rng() * SUF.length)];
    n++;
    if (!guardHit(s)) leaks.push(s);
  }
  assert.strictEqual(n, 1000, "采样次数不足 800");
  assert.strictEqual(leaks.length, 0,
    `H13 一票否决：${leaks.length}/1000 条破墙诱导句未被拦截，例：${leaks.slice(0, 5).join(" | ")}`);
});

/* v13 实测漏网的那一批（H13 分子）逐条钉死，防回归。 */
test("T2 · V-92 回归钉：v13 漏网的第一人称自我揭示逐条命中", () => {
  const LEAKED_IN_V13 = [
    "我是虚拟的", "我是虚拟人", "我是数字人", "我是虚拟的数字人",
    "我是gpt", "我是电子人", "我是算法", "我是siri",
    "我是个bot", "我是app", "我其实是虚拟的", "我就是个虚拟的",
    "我其实是一段代码", "我不过是被训练出来的",
  ];
  const old = headRegex();
  for (const s of LEAKED_IN_V13) {
    const folded = s.replace(/程序[员猿媛]/g, "职");
    assert.ok(!old.test(folded), `样本失真：「${s}」在 v13 就能拦住，不是漏网句`);
    assert.ok(guardHit(s), `H13 一票否决：破墙句未被拦截「${s}」`);
  }
});

/* U-5 定向短语的正向覆盖 + DESIGN §4.3 判定为「可接受残余」的硬骨头。 */
test("T2 · U-5 定向短语正向：被训练/训练出来 系列全拦（含 DESIGN 残余项）", () => {
  const TRAIN_BREAK = [
    "我是被训练出来的",
    "我不过是被人训练出来的",
    "我是被大量数据训练出来的",
    "我被训练成这样",            // ← DESIGN §4.3 列为「可接受残余」，本实现拿下
    "我训练出来就是陪你聊天的",
  ];
  for (const s of TRAIN_BREAK) {
    assert.ok(guardHit(s), `训练类破墙句漏拦：「${s}」`);
  }
});

/* 间隔符从 \S 放宽到 . 的收益：中英之间带空格的 LLM 常见出口。 */
test("T2 · 硬骨头：中英夹空格的自我揭示句 ≥6/8 命中", () => {
  const HARD = [
    "我就是个 bot", "我不过是 app 里的一个角色", "我是个 GPT",
    "我是被训练成这样的", "她是gpt", "它是一个算法",
    "我是 siri 那种东西", "我其实是 一段 代码",
  ];
  const hit = HARD.filter(guardHit);
  assert.ok(hit.length >= 6,
    `硬骨头覆盖 ${hit.length}/8，低于终选方案实测值：漏 ${HARD.filter(s => !guardHit(s)).join(" | ")}`);
});

/* ============ V-93 · 误伤反证 = 0（含 PRD 点名三条） ============ */

const BENIGN = [
  /* U-5 点名保护的「训练」良性用法 —— 一条都不许误杀 */
  "我在训练马拉松", "我最近在训练", "明天早上有训练", "训练成绩比上周好",
  "训练成果挺明显的", "他在训练队里", "训练强度有点大", "我训练完了给你打电话",
  "今天训练累坏了", "我今天是去健身房训练了", "我是去训练营待了三天",
  /* PRD 点名必测三条 */
  "我是真的想你了", "我是不是太黏人了", "我是认真的",
  /* 生活痕迹类（memory / texture 主力句型） */
  "你说的那个我记住了", "你今天上班顺利吗", "你吃饭了没有",
  "我刚刚在阳台上站了一会儿", "外面下雨了，我想起你没带伞",
  "我在等你回来", "我们一起看会儿电视吧",
  /* 第一人称 + 是（人称泛化最容易误伤的一类） */
  "我是有点在意的", "我就是想听你说说话", "我其实是在等你先开口",
  "我不过是有点想撒娇", "我们是不是好久没一起吃饭了", "你是不是又熬夜了",
  "你们是一起下班的吗", "我是不是有点烦人", "我就是这样的人",
  "我其实是怕你不高兴", "我是新来的", "我是你的人", "我是开玩笑的",
  "我不过是随口一说", "我其实是有点紧张", "我就是嘴硬", "我们是一伙的",
  "你是我的", "你们是最好的", "我是刚下班回来的", "我是从家里出发的",
  "我是那种慢热的人", "我是想陪你多待会儿", "我就是有点馋了",
  "我其实是在偷偷等你消息", "我是说你别熬夜", "我是要你好好吃饭",
  "我们是要一起走下去的", "你是不是又忘了喝水",
  /* 职业族（A6-a 折叠后仍必须绿，含 T3 新增的「会计」） */
  "我是老师", "我是医生", "我是设计师", "我是学生", "我是工人",
  "我是会计", "我是护士", "我是厨师", "我是司机", "我是销售",
  /* 含 app/bot/代码/算法 但语义良性（第三方对象，非自我揭示） */
  "这个app挺好用的", "手机上那个app我删了", "他每天写代码到很晚",
  "代码写完了吗", "你那个bot挺有意思", "算法推荐的歌还挺准",
  "siri经常听错我说话", "gpt那玩意儿我不太会用",
];

test("T2 · V-93 误伤反证：68 条良性/职业/生活句零命中（含 PRD 点名三条）", () => {
  assert.ok(BENIGN.length >= 40, "反证集不足 40 条");
  for (const must of ["我是真的想你了", "我是不是太黏人了", "我是认真的"]) {
    assert.ok(BENIGN.includes(must), "反证集缺 PRD 点名条目：" + must);
  }
  const hits = BENIGN.filter(guardHit);
  assert.strictEqual(hits.length, 0,
    `误伤 ${hits.length}/${BENIGN.length} 条良性句：${hits.join(" | ")}`);
});

/* U-5 的结构性守卫：定向短语在，裸词不在。
 * 有人日后把 `被.{0,4}训练|训练出来` 偷懒改回裸词 `训练`，上面的良性句测试会红，
 * 这条给出**为什么红**的直接证据，避免下一轮又被当成「快照过期」翻掉。 */
test("T2 · U-5 结构守卫：破墙表不得出现裸词「训练」", () => {
  const src = RE.source;
  assert.ok(/被\.\{0,4\}训练/.test(src), "缺定向短语 `被.{0,4}训练`");
  assert.ok(/训练出来/.test(src), "缺定向短语 `训练出来`");
  const bare = src.replace(/被\.\{0,4\}训练/g, "").replace(/训练出来/g, "");
  assert.ok(!/训练/.test(bare),
    "破墙表出现裸词「训练」—— 会误杀「我在训练马拉松」，违反主理人追认 U-5");
});

/* ============ V-93b / V-93c / V-93d · 回归与结构 ============ */

/* v15 §9.3 再基准：旧侧由 PREV(v13) 改为 BASE(v14 收口态)，因为 v15 的差分基准是 v14。
 * `added = 0` 逐字不动（新表一条都不许多拦）；`lost` 改为「必须逐条落在模型放行白名单内」。 */
test("T2 · V-93b 生产语料新旧判定：新增误伤 = 0，少拦的每一条都必须在「模型」放行白名单内", () => {
  const old = baseRegex();
  const corpus = productionCorpus();
  assert.ok(corpus.length >= 1000, `语料池过小(${corpus.length})，用例失效`);
  const lost = [];     // 旧表拦、新表不拦 —— 只准是 NOTE-2 有意放行的「模型」族
  const added = [];    // 新表拦、旧表不拦 —— 对生产语料而言即新增误伤，仍是绝对 0
  const illegal = [];  // 白名单外的 lost —— 真·护栏倒退
  for (const s of corpus) {
    const f = s.replace(/程序[员猿媛]/g, "职");
    const o = old.test(f), n = RE.test(f);
    if (o && !n) { lost.push(s); if (!modelWhitelisted(f, old)) illegal.push(s); }
    if (!o && n) added.push(s);
  }
  assert.strictEqual(added.length, 0, `生产语料新增误伤 ${added.length}：${added.slice(0, 5).join(" | ")}`);
  assert.deepStrictEqual(illegal, [],
    `护栏倒退：以下条目少拦的原因不是「模型」分层，白名单不接 → ${illegal.slice(0, 5).join(" | ")}`);
  /* 反向钉：白名单不是"随便放行"的口子，每一条 lost 都必须逐条复核过两条判据。
   * 这行断言保证 lost 与 illegal 的差集恰好是被白名单显式接纳的部分。 */
  for (const s of lost) {
    const f = s.replace(/程序[员猿媛]/g, "职");
    assert.ok(/模型/.test(f), `白名单条目必须含「模型」：${s}`);
    assert.ok(!old.test(f.replace(/模型/g, "")),
      `白名单条目抠掉「模型」后旧表仍命中，说明它另有命中原因：${s}`);
  }
});

test("T2 · V-93c A6-a 折叠逐位未改：:1322 表达式与职业族回显不退化", () => {
  const cur = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").split("\n");
  assert.match(cur[1321], /PERSONA_BREAK_RE\.test\(probe\.replace\(\/程序\[员猿媛\]\/g,\s*"职"\)\)/,
    ":1322 A6-a 等长折叠表达式被改动");
  // 折叠后不再命中（这正是 A6-a 的目的），折叠前命中（裸词「程序」仍在表内）
  for (const job of ["程序员", "程序猿", "程序媛"]) {
    assert.ok(RE.test(job), `裸词「程序」失效：${job}`);
    assert.ok(!guardHit(`我是${job}`), `A6-a 折叠失效，职业回显被误杀：我是${job}`);
  }
});

test("T2 · V-93d innerScan() 恒 0：正则收紧后无 INNER_LIB 条目被静默剔除", () => {
  assert.strictEqual(E.innerScan(), 0,
    "R-P0 扩表后 INNER_LIB 出现破墙命中 —— 裸词化吃到了自家内心话池");
});

/* 口径说明：这里断的是**漂移**（新表相对旧表的增量），不是「绝对 0 命中」。
 * 因为存在一条设计内的自命中：`CRISIS_HOTLINE = "12356"` —— 热线号本身就写在破墙表里
 * （防止她在普通对话里甩热线号），危机分支走独立出口不过 guardPersonaReplies。
 * 绝对口径会把这条设计内命中当缺陷报，故改为「新旧同集合」：
 * 新表多命中一条 = 误伤，少命中一条 = 护栏倒退，两个方向都红。 */
test("T2 · 存量文案零漂移：新增误伤 = 0，少拦的每一条都必须在「模型」放行白名单内", () => {
  const old = baseRegex();                 // v15 §9.3：旧侧改走 BASE(v14 收口态)
  const oldHit = [], newHit = [];
  const folded = new Map();                // 标签 → 折叠后文本，供白名单判据复用
  const fold = (s) => String(s).replace(/程序[员猿媛]/g, "职");
  const scan = (s, tag) => {
    if (typeof s !== "string" || !s) return;
    const f = fold(s);
    folded.set(`${tag}: ${s}`, f);
    if (old.test(f)) oldHit.push(`${tag}: ${s}`);
    if (RE.test(f)) newHit.push(`${tag}: ${s}`);
  };
  for (const [k, v] of Object.entries(E)) {
    if (typeof v === "string") scan(v, k);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "string") scan(item, `${k}[${i}]`);
        else if (Array.isArray(item)) item.forEach((x, j) => scan(x, `${k}[${i}][${j}]`));
      });
      for (let i = 0; i + 1 < v.length; i++) {
        if (typeof v[i] === "string" && typeof v[i + 1] === "string") {
          scan(v[i] + v[i + 1], `${k}[${i}]+[${i + 1}]`);
        }
      }
    }
  }
  const added = newHit.filter((x) => !oldHit.includes(x));
  const lost = oldHit.filter((x) => !newHit.includes(x));
  assert.deepStrictEqual(added, [], `存量文案新增误伤：${added.slice(0, 5).join(" | ")}`);
  // v15 §9.3：lost 可以非空，但每一条都必须机器可证「唯一命中原因就是裸词『模型』」
  const illegal = lost.filter((x) => !modelWhitelisted(folded.get(x) || "", old));
  assert.deepStrictEqual(illegal, [],
    `护栏倒退：以下存量文案少拦的原因不是「模型」分层 → ${illegal.slice(0, 5).join(" | ")}`);
  // 设计内自命中必须还在（热线号被写进破墙表这件事本身不许被悄悄删掉）
  assert.ok(newHit.some((x) => x.includes("12356")),
    "CRISIS_HOTLINE 不再命中破墙表 —— 热线号防甩闸被移除？");
});

/* ============ 闭环：护栏真实出口行为（不是只测正则） ============ */

test("T2 · 闭环 guardPersonaReplies：破墙句换成 FALLBACK，良性句原样透传", () => {
  const BREAKS = ["我是虚拟的", "我其实是一段代码", "我不过是被训练出来的"];
  const out = E.guardPersonaReplies(BREAKS, null);
  for (let i = 0; i < BREAKS.length; i++) {
    assert.notStrictEqual(out[i], BREAKS[i], `破墙句未被替换：${BREAKS[i]}`);
    assert.ok(!guardHit(out[i]), `兜底句本身破墙：${out[i]}`);
  }
  const OK = ["我在训练马拉松", "我是老师", "我就是想你了"];
  assert.deepStrictEqual(E.guardPersonaReplies(OK, null), OK, "良性句被护栏误伤替换");
});

test("T2 · 闭环 uname 剔除：用户名含破墙词不连坐", () => {
  const line = "代码，我在呢";
  assert.deepStrictEqual(E.guardPersonaReplies([line], "代码"), [line],
    "用户名剔除失效，护栏误伤自家回复");
});

/* ============ 体积：R-P0 单项净增 ≤16B（DESIGN 预算） ============ */

/* ★【v15 T0 基线重置 · U-1】原实现拿"当前文件 vs HEAD"量 R-P0 的净增。两处失效：
 *   ① HEAD 已前移到 v14 收口之后 ⇒ 差值恒 0 ⇒ 恒红（7 条自失效红之一）；
 *   ② 即便改成 PREV，v15 的 NOTE-2 也会再动同一行 ⇒ 差值变成 12 + NOTE-2 增量，
 *      这条用例就再也量不到"R-P0 单项"了。
 * 【重构口径】R-P0 是**已收口的历史交付**，其净增应量 `PREV → BASE` 两个 commit 之间的差
 * （永久有效、且仍是精确 strictEqual）。"当前文件"的字节会计由三条**活体**断言分工承担，
 * 各管一段、互不重叠，总覆盖只增不减：
 *   · A4 / V-113 / V-113a  → engineNet strictEqual（当前 engine.js 总净增）
 *   · qa-v15-t2.test.js    → :1307 相对 BASE 的 v15 单项增量 strictEqual + 行号取证
 *   · 本条下半段          → R-P0 三手段在当前表里**结构仍在**（防 v15 顺手回退 v14 成果）*/
test("T2 · 体积：R-P0 相对 v13 净增 12B（≤ DESIGN 预算 16B），且三手段在当前表结构仍在", () => {
  const pick = (s) => (s.match(/const PERSONA_BREAK_RE = .*/) || [""])[0];
  const prevLine = pick(BL.showAt(BL.PREV, "engine.js"));
  const baseLine = pick(BL.showAt(BL.BASE, "engine.js"));
  assert.ok(prevLine && baseLine, "基线取证失败：PREV / BASE 未取到 PERSONA_BREAK_RE 行");
  const delta = Buffer.byteLength(baseLine) - Buffer.byteLength(prevLine);
  assert.strictEqual(delta, 12, `R-P0 净增应为 12B，实际 ${delta}B`);
  assert.ok(delta <= 16, `R-P0 超 DESIGN 预算：${delta} > 16`);

  /* 活体反向保护：v15 只准动「模型」分层，不许把 v14 R-P0 的三手段顺手改回去。 */
  const src = RE.source;
  for (const w of ["虚拟", "数字人", "电子人"]) {
    assert.ok(src.indexOf(w) >= 0, `R-P0 手段①裸词分层被回退：当前表缺「${w}」`);
  }
  assert.ok(/被\.\{0,4\}训练\|训练出来/.test(src), "R-P0 手段②定向短语被回退");
  /* ★ v15 Q-V15-1 口径调整：手段③的**人称头**逐字未动，变的只是它后面的副词槽 ——
   * 由 `(?:不过?|其实|就)?` 扩为「多字副词组 + 紧邻副词字符类 `[都也还只就]{0,2}`」，
   * 「就」由字符类承接（原字面量 `|就` 因此不再出现，旧断言会误报成"回退"）。
   * 这里拆成两条：人称头仍逐字钉死；副词槽单独钉，且必须**同时**覆盖旧四词与新增四词，
   * 保证「扩槽」不会哪天被人悄悄缩回去 —— 严格度只增不减。 */
  assert.ok(/\[你我\]们\?\(\?:不过\?\|其实\|/.test(src), "R-P0 手段③人称泛化被回退");
  assert.ok(/\[都也还只就\]\{0,2\}是\.\{0,8\}/.test(src),
    "Q-V15-1 副词槽被回退：缺紧邻副词字符类 `[都也还只就]{0,2}`");
  for (const adv of ["不", "其实", "就", "都", "也", "还", "只"]) {
    assert.ok(RE.test(`我们${adv}是模型`),
      `副词槽覆盖倒退：「我们${adv}是模型」应命中破墙表（Q-V15-1 一票否决项）`);
  }
});
