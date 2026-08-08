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

/* v13 收线态的旧正则（从 git HEAD 取，不硬抄字面量 —— 抄错了就测了个寂寞）。
 * 用于 V-93b「新旧判定逐位比对」：新表只准**多拦**，一条都不许**少拦**。 */
function headRegex() {
  const { execFileSync } = require("node:child_process");
  const src = execFileSync("git", ["show", "HEAD:ai-girlfriend/engine.js"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
  const line = (src.match(/const PERSONA_BREAK_RE = (\/.*\/i);/) || [])[1];
  assert.ok(line, "无法从 HEAD 提取旧 PERSONA_BREAK_RE");
  // eslint-disable-next-line no-eval
  return eval(line);
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

test("T2 · V-93b 生产语料新旧判定：新表只多拦不少拦，且新增误伤 = 0", () => {
  const old = headRegex();
  const corpus = productionCorpus();
  assert.ok(corpus.length >= 1000, `语料池过小(${corpus.length})，用例失效`);
  const lost = [];     // 旧表拦、新表不拦 —— 护栏倒退，绝对不允许
  const added = [];    // 新表拦、旧表不拦 —— 对生产语料而言即新增误伤
  for (const s of corpus) {
    const f = s.replace(/程序[员猿媛]/g, "职");
    const o = old.test(f), n = RE.test(f);
    if (o && !n) lost.push(s);
    if (!o && n) added.push(s);
  }
  assert.strictEqual(lost.length, 0, `护栏倒退，旧表能拦新表拦不住：${lost.join(" | ")}`);
  assert.strictEqual(added.length, 0, `生产语料新增误伤 ${added.length}：${added.slice(0, 5).join(" | ")}`);
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
test("T2 · 存量文案零漂移：全量导出语料（含相邻拼接）新旧命中集合完全一致", () => {
  const old = headRegex();
  const oldHit = [], newHit = [];
  const fold = (s) => String(s).replace(/程序[员猿媛]/g, "职");
  const scan = (s, tag) => {
    if (typeof s !== "string" || !s) return;
    const f = fold(s);
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
  assert.deepStrictEqual(lost, [], `护栏倒退，旧表能拦新表拦不住：${lost.slice(0, 5).join(" | ")}`);
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

test("T2 · 体积：R-P0 相对 v13 净增 12B（≤ DESIGN 预算 16B）", () => {
  const { execFileSync } = require("node:child_process");
  const head = execFileSync("git", ["show", "HEAD:ai-girlfriend/engine.js"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
  const cur = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
  const pick = (s) => (s.match(/const PERSONA_BREAK_RE = .*/) || [""])[0];
  const delta = Buffer.byteLength(pick(cur)) - Buffer.byteLength(pick(head));
  assert.strictEqual(delta, 12, `R-P0 净增应为 12B，实际 ${delta}B`);
  assert.ok(delta <= 16, `R-P0 超 DESIGN 预算：${delta} > 16`);
});
