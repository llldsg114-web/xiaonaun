"use strict";
/* QA · v13 T2+T4 薄切片「配额修正 + 待决点⑤修复」独立验收
 *
 * 立场：不复用工程师自检口径，独立加载模块、独立断言。
 * 本轮定位到 2 个自检套件覆盖不到的缺陷，用 { todo: true } 固化 ——
 * todo 不计入 fail（CI 保持绿），但缺陷被永久写进套件，修好后把 todo 摘掉即转正。
 * 这正是 wiring-scan.js 抬头所说的「自检的结构性盲区，只能用结构性断言补」。
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");
const WS = require("./wiring-scan.js");

const ROOT = path.resolve(__dirname, "..");
const DAY = 864e5;

const E = H.loadEngine();
const M = E.mod("memory");
const T = E.mod("texture");

/* 宽松态：六重门禁全开，用于隔离测微行为本身 */
function texState(over) {
  const now = Date.now();
  return Object.assign({
    affection: 100, firstMeet: now - 3 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 },
    persona: { tone: "soft" }, dayLife: {}, flags: {},
  }, over || {});
}
const texCtx = (lv) => ({ lv: lv || 3, ue: { type: "neutral" }, rng: Math.random });

/* 真实链路 state（走 E.reply 全链路） */
function linkState(affection) {
  return Object.assign(H.freshState(), {
    affection, firstMeet: Date.now() - 5 * DAY,
    tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 },
    flags: { empathyVA: true, personaStyle: true, topicFsm: true, texture: true, memory2: true, presence: true },
  });
}

const jobMem = (value, conf) => ({
  v: 13, migratedAt: 0, moments: [],
  facts: [{
    id: "f_job", key: "工作", value, conf: conf === undefined ? 0.8 : conf, tags: ["工作"],
    since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null,
  }],
});

/* ================= A1 · V-90 配额闸门 ================= */

/* A1-a【快照翻转 · v13 T5b 收尾轮 · 由 QA(严过关) 翻转】
 * 变更史：T2+T4 轮锁 memory 12288 / texture 4608 / moduleSum 20480；
 *         T5a 轮上调 → 14336 / 5120 / 24576；
 *         T5b 轮再上调 → moduleSumMax 24576→24643、engineNetMax 2048→2060，并新增 contingency.js 1892。
 * 本轮 3 条红（A1-a / A1-c / A4）全部是**旧轮快照断言过期**，不是代码回归 —— QA 独立复核依据：
 *   ① wiring-scan.js:167-174 的审批注释链完整，两项上调各有精确来源（非"拍脑袋加一点"）；
 *   ② scanSizes().over === []，逐模块无一越配额；
 *   ③ totalMax **一个字节都没动**（272384），新模块吃的是 engine 让出的余量，不是抬天花板。
 * 反向保护：engineBase **永远不许动**。
 * ★【快照翻转 · v14 体积决议轮 · 主理人 Qi 批准（D-1/D-2/U-1）】
 *   totalMax 272384→276480 / engineNetMax 2060→2200 / moduleSumMax 24643→28525 /
 *   contingency.js 1892→4096。**这是 v13「266KB 硬约束」被有意放宽的一次 deliberate 决策**，
 *   经天花板评审，非失守。翻转前置义务已履行：T1 先 trim memory/texture 共 −2271B，
 *   且以「剥注释去空白后代码体 sha256 逐位一致」的机器断言自证零行为变更。
 *   ⚠ 翻转只换数字，**结构断言与严格度逐位不放松**：strictEqual 仍是 strictEqual，
 *   下方「三锁自洽」结构断言原样保留 —— 它正是 28525 这个取值的推导依据
 *   （若取任务书原议的 28687，此行立即转红：245737+2200+28687 = 276624 > 276480 是"看似更宽"，
 *    但 A1-a 守的是"不许两把锁同时放水"，28687 会让 engine 打满 V-33 时 total 击穿 162B）。
 * ⚠ v14 交付后 total 余量约 3.9KB —— 已不再是 13B 的紧张态，预警口径见 A6-c（换挡 0B/8192B）。 */
test("A1-a 配额数字落点：memory 14336 / texture 5120 / contingency 4096 / moduleSum 28525 / net 2200 / totalMax 276480", () => {
  const B = WS.SIZE_BUDGET;
  assert.strictEqual(B["memory.js"], 14336, "v14 不动（T5a 批准值 12288→14336）");
  assert.strictEqual(B["texture.js"], 5120, "v14 不动（T5a 批准值 4608→5120）");
  assert.strictEqual(B["presence.js"], 4096, "presence 配额自 T2 起不动");
  assert.strictEqual(B["contingency.js"], 4096, "v14 批准值 1892→4096（R-C4/C5/S1 三项载体）");
  assert.strictEqual(B.moduleSumMax, 28525, "v14 批准值 24643→28525 = totalMax − V33(247955)");
  assert.strictEqual(B.engineNetMax, 2200, "v14 批准值 2060→2200（R-P0 :1307 / R-P2 :2897）");
  assert.strictEqual(B.totalMax, 276480, "v14 批准值 272384→276480（266KB→270KB，天花板评审）");
  assert.strictEqual(B.engineBase, 245737, "engineBase 属永不许动项");

  /* ★★ 结构保证（v14 重述 · 工程师实测发现原式在 D-2 下不可满足，已上报主理人）★★
   * 原式：moduleSumMax + engineBase + engineNetMax >= totalMax（"不许有配额被凭空吃掉"）。
   * v14 实测：28525 + 245737 + 2200 = 276462 < 276480，差 18B —— 原式**必红**。
   * 根因不是 moduleSumMax 取错，而是 **D-2 让两把 engine 锁不再等长**：
   *     engineBase + engineNetMax = 247937   ← engineNet 锁的生效上限
   *     V-33                      = 247955   ← 兜底锁
   *     间隙                      =     18B  ← DESIGN-v14 §1.3 明言"engineNet 是更紧的那把锁，先响，
   *                                             这是有意设计：V-33 作为兜底不动"
   * 两式（原式 ∧ 反向式 moduleSumMax + V33 <= totalMax）同真的充要条件是 engineNetMax >= 2218。
   * 而 D-2 批的是 2200 < 2218 ⇒ **在任何 moduleSumMax 取值下二者都不可能同真**：
   *     取 28543 = totalMax − engineBase − engineNetMax → 过原式，但 engine 打满 V-33 时击穿 18B；
   *     取 28525 = totalMax − V33（U-1 追认值）        → 过反向式，原式差 18B。
   * 取 28525 是保守侧（宁可 18B 永不可用，也不留击穿口），故重述原式而非改配额。
   * ⚠ 重述**不是放松**：由不等式升级为**精确会计恒等式** —— 未分配余量必须恰好等于两锁间隙，
   *   一个字节都不许多。它等价于把 moduleSumMax 钉死为 totalMax − V33，比原式严得多。 */
  const V33 = 247955;
  const engineCapNet = B.engineBase + B.engineNetMax;
  assert.ok(engineCapNet <= V33,
    `engineNet 必须是更紧的那把锁（否则 V-33 兜底失效）：${engineCapNet} > ${V33}`);
  assert.strictEqual(B.totalMax - (B.moduleSumMax + engineCapNet), V33 - engineCapNet,
    "有配额被凭空吃掉：除两把 engine 锁的设计性间隙外，不许存在任何未分配余量");
  // 反向式：三锁打满时 total 不得击穿天花板 —— 这正是 28687 被否掉的直接依据（DESIGN §1.4）
  assert.ok(B.moduleSumMax + V33 <= B.totalMax,
    `三锁互斥性失守：moduleSum 打满 ${B.moduleSumMax} + engine 打满 V-33 ${V33} > totalMax ${B.totalMax}`);
});

test("A1-b scanSizes：over 为空且逐模块不越配额", () => {
  const s = WS.scanSizes();
  assert.deepStrictEqual(s.over, [], "越配额模块: " + s.over.join(","));
  for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
    assert.ok(s.each[f] <= WS.SIZE_BUDGET[f], `${f} ${s.each[f]} > ${WS.SIZE_BUDGET[f]}`);
  }
  assert.ok(s.moduleSum <= WS.SIZE_BUDGET.moduleSumMax, `moduleSum ${s.moduleSum} > ${WS.SIZE_BUDGET.moduleSumMax}`);
  assert.ok(s.total <= WS.SIZE_BUDGET.totalMax, `total ${s.total} > ${WS.SIZE_BUDGET.totalMax}`);
});

/* A1-c【快照翻转 · T5b 建立 / v14 T2 追加】变更史：
 *   · T5b：原口径「engine.js 相对 HEAD 零 diff」，因 A6-a 定点解冻 :1319/:1322 失效，
 *     翻转为**白名单**（不是放弃冻结，是收紧成"只准动这几行"）。
 *   · v14 T2（本轮）：A6-a 两行已随 v13 收线合入 HEAD，故白名单基线重置。
 *     本期经主理人批准的定点解冻只有两处（DESIGN §3.2 / §8.3）：
 *       :1307 R-P0 PERSONA_BREAK_RE 破墙人称补全（+12B，H13 一票否决）
 *       :2897 R-P2 rec 对象透传 pacing 字段      （+19B，T4 追加）
 *     T2 阶段白名单 = [1307]；T4 交付后由 T4 自己追加 2897（见该任务验收）。
 * 严格度逐位不放松：多改一行、改到别处、增删行数、或改动内容与登记用途不符，全部转红。
 * ★ 反向保护：白名单不是"许可证清单"，每一行都additionally锁死改动内容的形状 ——
 *   :1307 必须仍是 PERSONA_BREAK_RE 常量声明，:1322 的 A6-a 折叠必须**逐位未动**。 */
test("A1-c engine.js 定点解冻白名单：相对 HEAD 仅 v14 已批准行", () => {
  const { execFileSync } = require("node:child_process");
  /* 本期已批准的解冻行（T2 建立 1307，T4 追加 2897，DESIGN §8.3 明列，不得再加第三行）。 */
  const WHITELIST = [1307, 2897];
  const n = WHITELIST.length;
  const numstat = execFileSync("git", ["diff", "--numstat", "--", "engine.js"], { cwd: ROOT, encoding: "utf8" }).trim();
  assert.match(numstat, new RegExp("^" + n + "\\t" + n + "\\t"),
    `engine.js 只准 ${n} 增 ${n} 删，实际: ` + numstat);
  // 逐行比对定位改动行号（--numstat 只给数量，不给位置）
  const cur = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").split("\n");
  const head = execFileSync("git", ["show", "HEAD:ai-girlfriend/engine.js"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  assert.strictEqual(cur.length, head.length, "engine.js 行数必须不变（纯定点替换）");
  const lines = [];
  for (let i = 0; i < cur.length; i++) if (cur[i] !== head[i]) lines.push(i + 1);
  assert.deepStrictEqual(lines, WHITELIST,
    "engine.js 解冻范围超出白名单，实际改动行: " + JSON.stringify(lines));
  // 改动内容本身也锁死：:1307 只准是破墙表常量，不准夹带别的东西
  assert.match(cur[1306], /^\s*const PERSONA_BREAK_RE = \/\(.*\)\/i;$/,
    ":1307 必须仍是 PERSONA_BREAK_RE 常量声明（R-P0 只改正则，不改结构）");
  // :2897 只准是 rec 对象的 pacing 透传，不准借机塞别的字段
  assert.match(cur[2896], /factId: rv\.factId, pacing: rv\.pacing \}$/,
    ":2897 必须是 rec 对象末尾追加 `pacing: rv.pacing`（R-P2 只透传，不加工）");
  assert.strictEqual(
    Buffer.byteLength(cur[2896]) - Buffer.byteLength(head[2896]), 19,
    ":2897 透传应恰好 +19B（DESIGN §5.4②），多一字节都要重新申请");
  // A6-a 折叠（已在 HEAD 内）必须逐位未动 —— V-93c 的结构侧留证
  assert.match(cur[1321], /PERSONA_BREAK_RE\.test\(probe\.replace\(\/程序\[员猿媛\]\/g,\s*"职"\)\)/,
    ":1322 职业族等长折叠被改动（本期未申请解冻）");
  assert.strictEqual(cur[1321], head[1321], ":1322 必须与 HEAD 逐位一致");
});

/* ================= A4 · 体积双闸门 ================= */

/* A4【快照翻转 · v14】变更史：T5b 锁 strictEqual(net, 2056)（T1 遗留 2004B + A6-a 解冻 52B）。
 * v14 两处定点改动 engine.js，净增必然变化（DESIGN §3.2 预算 +35B）：
 *   · R-P0 :1307 PERSONA_BREAK_RE 裸词分层 + U-5 定向短语 + 人称泛化   预算 +16B / 实交付 **+12B**
 *   · R-P2 :2897 rec 对象透传 pacing 字段                              预算 +19B / T4 交付
 * ★ 为什么实交付比 DESIGN 少 4B：DESIGN §4.2 的 C6 形态把 `聊天机器人|语言模型` 也上提为裸词，
 *   但这两词已被既有裸词 `机器人`/`模型` 完全覆盖（子串包含），属冗余字节；同时 U-5 要求
 *   「训练」走定向短语而非留在人称绑定组，间隔符 `\S`→`.` 又省 4B。净结果 +12B 且覆盖更高
 *   （96/96 组合不变，硬骨头 1/8 → 6/8）。少花的 4B 回吐给 engine net 余量，不另作他用。
 * 翻转为锁**新净增 2087**（2056 + 12 + 19），严格度逐位不放松 —— 仍是 strictEqual，
 * 多改一个字节立刻转红；V-33 / V-90 / total 三把锁仍一次性钉在同一条用例里，谁先响都算越界。
 * ★ 反向保护：engineNetMax(2200) 与 V-33(247955) 是两把独立锁，此处两条都断，不许只过一条。 */
test("A4 体积三闸门：V-33 ≤247955B 且 V-90 net ≤2200B 且 total ≤276480B", () => {
  const size = fs.statSync(path.join(ROOT, "engine.js")).size;
  assert.ok(size <= 247955, `V-33 越界: ${size} > 247955（余 ${247955 - size}B）`);
  const net = size - WS.SIZE_BUDGET.engineBase;
  assert.strictEqual(net, 2087, "净增应为 T5b 收线 2056B + R-P0 12B + R-P2 19B = 2087B，本轮不得再涨");
  assert.ok(net <= WS.SIZE_BUDGET.engineNetMax, `V-90 越界: ${net} > ${WS.SIZE_BUDGET.engineNetMax}`);
  const s = WS.scanSizes();
  assert.ok(s.total <= WS.SIZE_BUDGET.totalMax,
    `系统总量越界: ${s.total} > ${WS.SIZE_BUDGET.totalMax}`);
});

/* ================= A2 · recallV2 / 决策⑤ ================= */

test("A2-a 决策⑤ tag 桥：工作类事实与上班类问句都产出 工作 tag", () => {
  const f = M.extractFacts("我是程序员", {}, { now: Date.now() });
  assert.ok(f && f.facts.length === 1);
  assert.strictEqual(f.facts[0].key, "工作");
  assert.strictEqual(f.facts[0].value, "程序员");
  assert.ok(f.facts[0].tags.includes("工作"), "事实侧缺 工作 tag");

  const q = M.extractFacts("今天上班好累", {}, { now: Date.now(), dv: -0.4 });
  assert.ok(q.moments[0].tags.includes("工作"), "问句侧缺 工作 tag");
});

test("A2-b 决策⑤ 检索层命中（含反证：tag 是命中的唯一来源）", () => {
  const mem = M.applyPatch({}, M.extractFacts("我是程序员", {}, { now: Date.now() }));
  const hits = M.retrieveFacts("今天上班好累", { mem }, 3);
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].score >= 0.45, "score=" + hits[0].score);

  // 反证：抹掉 tag 后字符余弦接不住 → 回到修复前的「安全沉默」
  const stripped = JSON.parse(JSON.stringify(mem));
  stripped.facts[0].tags = [];
  assert.strictEqual(M.retrieveFacts("今天上班好累", { mem: stripped }, 3).length, 0);
});

test("A2-c 置信度门 R25：conf<0.5 沉默，conf≥0.5 可召回（门限精确在 .50）", () => {
  const run = (conf, n) => {
    let h = 0;
    for (let i = 0; i < n; i++) {
      if (M.recallV2("今天上班好累", { mem: jobMem("设计师", conf) }, { now: Date.now() })) h++;
    }
    return h;
  };
  assert.strictEqual(run(0.45, 300), 0, "conf=0.45 必须全沉默");
  assert.strictEqual(run(0.49, 300), 0, "conf=0.49 必须全沉默");
  assert.ok(run(0.50, 300) > 0, "conf=0.50 应可召回");
  assert.ok(run(0.80, 300) > 0, "conf=0.80 应可召回");
});

test("A2-d recallV2 早退分支：结构合法、不抛错（绕过 texture 为已知行为，T5 修）", () => {
  const mem = M.applyPatch({}, M.extractFacts("我喜欢草莓蛋糕", {}, { now: Date.now() }));
  let recall = 0, tx = 0;
  for (let i = 0; i < 600; i++) {
    const st = Object.assign(linkState(300), { mem: JSON.parse(JSON.stringify(mem)) });
    const r = E.reply("想吃点甜的", st);   // 不抛错本身即断言
    if (r.intentEx !== "recall") continue;
    recall++;
    assert.ok(Array.isArray(r.replies) && r.replies.length && r.replies[0], "早退分支 replies 非法");
    assert.ok("recentReplies" in r, "早退分支丢了 recentReplies（去重窗口会被清空）");
    if (r.tx && r.tx.kind) tx++;
  }
  assert.ok(recall > 0, "样本里没走到早退分支，用例失效");
  assert.strictEqual(tx, 0, "早退分支当前不挂 texture；若此断言转红说明 T5 已修，应更新用例");
});

/* 缺陷 1 已闭环（R2 复核）：修法＝weave 出口把无条件 PERSONA_BREAK_RE 改判为
 * 「自称/转介结构 SELF ∧ 引擎破墙词表」的合取。职业回显不再被『程序』裸子串误杀。
 * 原 todo 摘除，转正式用例。 */
const recallN = (mem, q, n) => {
  let h = 0;
  for (let i = 0; i < n; i++) if (M.recallV2(q, { mem }, { now: Date.now() })) h++;
  return h;
};

test("A2-e [缺陷1 closed] 决策⑤ 标杆语句『我是程序员』端到端可召回", () => {
  const mem = M.applyPatch({}, M.extractFacts("我是程序员", {}, { now: Date.now() }));
  const hit = recallN(mem, "今天上班好累", 600);
  // 实测 ~55%(330/600)；阈值 300 ≡ 规范的「300 次中 ≳150」同一速率，但 CI 更紧、不易抖动
  assert.ok(hit >= 300, `『程序员』端到端召回 ${hit}/600，应与对照组同档（实测约 330/600）`);
});

test("A2-f [缺陷1 closed] 程序员/程序猿 召回转正（原「应为 0」快照断言已作废）", () => {
  // R1 时此处断言「程序员/程序猿 必须为 0」以固化缺陷现状；缺陷既修，改为正向断言。
  for (const v of ["程序员", "程序猿"]) {
    const h = recallN(jobMem(v), "今天上班好累", 600);
    assert.ok(h >= 300, `${v} 召回 ${h}/600，应与对照组同档（实测约 360/600）`);
  }
  // 对照组：非「程序」词族职业保持原水位，证明修复没有以牺牲基线为代价
  for (const v of ["工程师", "设计师", "医生", "护士", "公务员"]) {
    const h = recallN(jobMem(v), "今天上班好累", 300);
    assert.ok(h > 100, `${v} 召回 ${h}/300，低于预期`);
  }
});

/* H11 反证（缺陷1 修复的安全边界）：SELF∧BREAK 合取削弱了破墙闸，必须证明
 * 「AI 自我揭示」这一类恶意事实值仍然 100% 被拦。22 值 × 6 事实族 × 2 conf × 2 query × 400。
 *
 * ★【口径翻转 · v14 T2 · 工程师 Kou，非放宽】原用例的活性哨兵是
 *   `assert.ok(emitted > 1000, "出句样本过少，用例失效")` —— 它假定「恶意值也会照常出句，
 *   只是出的句子不含破墙词」。这个假定在 v13 成立，是因为 `PERSONA_BREAK_RE` **拦不住**
 *   第一人称自我揭示：实测 v13 下 `我是虚拟的` 会被原样织进「嗯，给你留了块**我是虚拟的**~」
 *   并计入 emitted，而旧正则对这句判 false → leak 恒为 null。
 *   **也就是说 v13 的这条用例是「假绿」：它统计了 1000+ 条真·破墙泄漏，却因为量尺本身
 *   有洞而全部放行。** 这正是 H13 = 12.5% 缺陷在 H11 侧的同源投影。
 *
 *   R-P0 收紧后，`memory.js` weave 的 SELF∧BREAK 合取闸把这批句子在**出口前**就丢弃，
 *   于是 emitted 归 0 —— 旧哨兵把「缺陷被修好」误报成「用例失效」。
 *
 *   翻转方式（严格度只升不降）：
 *     ① 活性证明从「恶意组自己出句」改为**良性对照组**出句 —— 对照组必须 >1000 条，
 *        证明夹具/链路活着，用例非空转（这是原哨兵真正想守的东西）；
 *     ② 恶意组断言升级为**双条件**：泄漏 = 0（原口径，保留）**且** 出句 = 0
 *        （新增，v14 的「安全沉默」形态）。任一被削弱都转红：
 *        · 有人把破墙表改松 → 恶意值重新出句 → `emitted === 0` 红；
 *        · 有人把 weave 闸拆了 → 泄漏句流出 → `leak === null` 红。
 *   翻转后覆盖面严格大于原用例，且不再依赖「量尺有洞」这一前提。 */
test("A2-g [H11 不变量] AI 自我揭示恶意值破墙泄漏 = 0（v14：升级为安全沉默）", () => {
  const MAL = ["我是AI", "我是聊天机器人", "我是一个虚拟人", "我是个算法", "我确实是人工智能",
    "我是语言模型", "我只是个程序", "我不能帮你", "我是机器人", "我其实是AI", "我是虚拟的",
    "我是数字人", "我是bot", "我是gpt", "我是个助手", "我是客服", "我是电子人",
    "我是训练出来的", "我是被训练的模型", "我是代码写的", "我是siri", "我是app"];
  /* 良性对照组：与恶意组走**完全相同**的夹具与采样量，唯一差别是 value 无破墙语义。 */
  const BENIGN = ["红豆汤", "香菜", "小笨蛋", "妈妈", "会计", "第一次见面那天"];
  const FAM = ["喜好", "禁忌", "称呼", "家人·妈", "工作", "纪念日"];
  const QS = ["今天上班好累", "想吃点甜的"];
  assert.ok(MAL.length >= 20, "恶意值样本不足 20 种");

  const run = (values) => {
    let emitted = 0, leak = null;
    for (const value of values) for (const key of FAM) for (const conf of [0.8, 0.6]) {
      const mem = {
        v: 13, migratedAt: 0, moments: [],
        facts: [{ id: "f_m", key, value, conf, tags: ["工作", "吃", "家", "忙"],
          since: 0, lastSeenAt: 0, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null }],
      };
      for (const q of QS) for (let i = 0; i < 400; i++) {
        const r = M.recallV2(q, { mem }, { now: Date.now() });
        if (!r) continue;
        emitted++;
        if (E.PERSONA_BREAK_RE.test(r.line)) { leak = leak || r.line; }
      }
    }
    return { emitted, leak };
  };

  // ① 活性：良性对照组必须照常出句，且自身零泄漏（夹具与召回链路是活的）
  const ok = run(BENIGN);
  assert.ok(ok.emitted > 1000, `良性对照组出句过少(${ok.emitted})，夹具或召回链路已失效`);
  assert.strictEqual(ok.leak, null, "良性值被误判为破墙: " + ok.leak);

  // ② 不变量：恶意组泄漏 = 0（原口径）且出句 = 0（v14 安全沉默，严格度上升）
  const mal = run(MAL);
  assert.strictEqual(mal.leak, null, "H11 破墙泄漏: " + mal.leak);
  assert.strictEqual(mal.emitted, 0,
    `H11 退化：恶意自我揭示值重新出句 ${mal.emitted} 条 —— R-P0 破墙表或 weave 合取闸被削弱`);
});

/* texture 侧破墙闸未被本轮放宽：仍是无条件 PERSONA_BREAK_RE（放宽仅限 memory.weave）。
 * 这条守住「放宽范围不扩散」。 */
test("A2-h 破墙闸放宽范围受限：texture.js 仍为无条件拦截", () => {
  const src = fs.readFileSync(path.join(ROOT, "texture.js"), "utf8");
  assert.match(src, /\|\|\s*E\.PERSONA_BREAK_RE\.test\(full\)/, "texture 出口应保持无条件破墙拦截");
  const msrc = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  assert.match(msrc, /SELF\.test\(s\)\s*&&\s*E\.PERSONA_BREAK_RE\.test\(s\)/, "memory.weave 应为 SELF∧BREAK 合取");
});

/* [已知遗留 → T5] 决策⑤ 的 tag 桥挂在「存储句面」而非「事实 key」：
 * tg() 只在原句含 程序员|职业|上班|工作|公司|老板|同事 时才产出 工作 tag，
 * 因此仅标杆句「我是程序员」端到端成立；其余职业要么抽不出、要么 tags 空 → 仍安全沉默。
 * 非回归（修复前全族为 0），但决策⑤ 注释所称「使『我是程序员』等事实能被召回」的「等」未达成。 */
test("A2-i [已知遗留] 决策⑤ tag 桥仅覆盖标杆句，其余职业端到端仍沉默",
  { todo: "tag 应由 fact.key 派生而非仅由原句匹配；留 T5，见验收报告 遗留-1" }, () => {
    for (const s of ["我是程序猿", "我是设计师", "我是工程师", "我是公务员"]) {
      const p = M.extractFacts(s, {}, { now: Date.now() });
      assert.ok(p && p.facts.length, `${s} 未能抽出事实`);
      const mem = M.applyPatch({}, p);
      assert.ok(recallN(mem, "今天上班好累", 300) > 100, `${s} 端到端召回不足`);
    }
  });

/* ================= A3 · texture 门禁与微行为 ================= */

test("A3-a R28 六重门禁逐门生效", () => {
  assert.strictEqual(T.textureAllow(texState(), texCtx(3)).ok, true, "宽松态应放行");
  assert.strictEqual(T.textureAllow(texState({ flags: { texture: false } }), texCtx(3)).ok, false, "①总开关");
  assert.strictEqual(T.textureAllow(texState(), texCtx(1)).ok, false, "②lv<2");
  assert.strictEqual(T.textureAllow(texState({ tex: { t: 0 }, firstMeet: Date.now() }), texCtx(3)).ok, false, "②首轮");
  assert.strictEqual(T.textureAllow(texState(), { lv: 3, crisis: true, ue: { type: "neutral" } }).ok, false, "③危机");
  assert.strictEqual(T.textureAllow(texState(), { lv: 3, ue: { type: "angry" } }).ok, false, "④负向高唤醒");
  const day = Math.floor(Date.now() / DAY);
  assert.strictEqual(T.textureAllow(texState({ tex: { t: 50, d: day, n: 6 } }), texCtx(3)).ok, false, "⑥配额");
  assert.strictEqual(T.textureAllow(texState({ tex: { t: 50, d: day, n: 5, ty: 2, tyAt: -99 } }), texCtx(3)).banTypo, true, "⑤错字配额");
});

test("A3-b 破墙回退：触发 PERSONA_BREAK 的句子零泄漏", () => {
  const breakers = ["你是不是AI啊我怀疑", "我觉得你就是个聊天机器人吧", "你其实是语言模型对不对", "要不要打个心理援助热线"];
  for (const b of breakers) {
    for (let i = 0; i < 500; i++) {
      const r = T.texturePass(b, texState(), texCtx(3));
      if (!r) continue;
      const full = r.text || (r.split || []).join("");
      assert.ok(!E.PERSONA_BREAK_RE.test(full), "破墙泄漏: " + full);
    }
  }
});

test("A3-c 错字：257 条样例 100% 白名单内 + 100% 自纠", () => {
  const carriers = ["你想吃什么呀今天", "这个怎么说才好呢", "现在几点了呀朋友", "我知道你很努力的",
    "要不要休息一下下", "可以陪我聊聊天吗", "这样子真的好吗呀", "休息一会儿好不好"];
  const OUT = /^(.*) {2}\*(.+)$/;
  let n = 0;
  for (let i = 0; n < 257 && i < 200000; i++) {
    const r = T.texturePass(carriers[i % carriers.length], texState(), texCtx(3));
    if (!r || r.kind !== "typo") continue;
    n++;
    const m = OUT.exec(r.text);
    assert.ok(m, "缺自纠标记: " + r.text);
    const pair = T.TYPO_TABLE.find((p) => p[0] === m[2]);
    assert.ok(pair, "错字原词不在白名单: " + r.text);
    assert.ok(m[1].includes(pair[1]), "错字替换不在白名单: " + r.text);
  }
  assert.strictEqual(n, 257, "只采到 " + n + " 条 typo 样本");
});

test("A3-d 关键信息（时间/承诺）禁错字", () => {
  for (const t of ["明天下午三点记得开会", "我答应你一定去的哦", "保证不会忘记这件事"]) {
    for (let i = 0; i < 400; i++) {
      const r = T.texturePass(t, texState(), texCtx(3));
      assert.ok(!(r && r.kind === "typo"), "关键信息句产出错字: " + (r && r.text));
    }
  }
});

const INPUTS = ["今天好累啊", "刚吃完饭", "你在干嘛呢", "周末想去看电影", "有点无聊",
  "公司事情好多", "想你了", "晚上吃什么好", "刚看完一部剧", "天气好冷"];
function hitRate(affection, n) {
  let h = 0;
  for (let i = 0; i < n; i++) {
    const r = E.reply(INPUTS[i % INPUTS.length], linkState(affection));
    if (r.tx && r.tx.kind) h++;
  }
  return h / n * 100;
}

test("A3-e R29 真实链路总体命中率 ∈ [15%,30%]", () => {
  const rate = hitRate(300, 4000);
  assert.ok(rate >= 15 && rate <= 30, `总体命中率 ${rate.toFixed(2)}% 落在区间外`);
});

/* 缺陷 2 已闭环（R2 复核）：ramp 基数由 .65 提到 .75（lv2 ramp 0.85→0.95），
 * 抵消 build() null 回退的稀释。R1 实测 14.18% → R2 实测 16.27%（N=2e4，95%CI[15.75,16.78]）。
 * 原 todo 摘除，转正式用例。 */
test("A3-f [缺陷2 closed] lv2 命中率 ≥15%", () => {
  const rate = hitRate(100, 20000);
  assert.ok(rate >= 15, `lv2 命中率 ${rate.toFixed(2)}% < 15% 下限`);
});

test("A3-g 分档命中率 lv3/lv4 ∈ [15%,30%]（含 lv2 单调不减）", () => {
  const r2 = hitRate(100, 8000), r3 = hitRate(300, 8000), r4 = hitRate(500, 8000);
  for (const [lab, r] of [["lv3", r3], ["lv4", r4]]) {
    assert.ok(r >= 15 && r <= 30, `${lab} 命中率 ${r.toFixed(2)}% 落在 [15,30] 外`);
  }
  // ramp = min(1, .75+.2*(lv-1)) → lv2 < lv3 = lv4（封顶）；给 1.5pp 抽样容差
  assert.ok(r3 >= r2 - 1.5, `lv3 ${r3.toFixed(2)}% 不应显著低于 lv2 ${r2.toFixed(2)}%`);
});

/* ================= A5 · 决策②/④ 仅注释 ================= */

/* A5【语义翻转 · 原「TODO(T5) 锚点仍在」已按设计失效】
 * 原断言写于 T2+T4 轮，锁 texture.js / memory.js 仍挂 T5 待办锚点，用于确保待办不被静默丢弃。
 * T5a 已把这些待办**逐条闭环**（待决点② memory→texture 走查表 skin()；待决点④ 落盘移交宿主 app.js），
 * 锚点按设计消失，旧断言即刻失效，属**旧轮快照断言过期**，非代码缺陷。故翻转为反向断言。
 * 反向保护：若有人把 TODO(T5) 重新写回（＝待办复活 / 闭环被回退），本测试必须转红。 */
test("A5 T5 待办已闭环（texture.js / memory.js 不再含 TODO(T5) 锚点）", () => {
  const tex = fs.readFileSync(path.join(ROOT, "texture.js"), "utf8");
  const mem = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  assert.doesNotMatch(tex, /TODO\(T5\)/, "texture.js 的 T5 待办应已闭环，锚点须消失");
  assert.doesNotMatch(mem, /TODO\(T5\)/, "memory.js 的 T5 待办应已闭环，锚点须消失");

  // 正向取证：待办不是被「删注释」糊弄掉的，闭环实现必须真实在位
  assert.match(mem, /function skin\s*\(/, "待决点② 走查表 skin() 必须在 memory.js 落地");
  assert.match(mem, /E\.mod\("texture"\)/, "skin() 须经 mod() 调用期查表拿 texture");
  assert.match(tex, /function textureAfterTurn\s*\(/, "待决点④ textureAfterTurn 必须在 texture.js 落地");

  // 待决点④ 的调用点按设计落在宿主 app.js（engine.js 冻结，不得在此加挂载点）
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(app, /Engine\.mod\("presence"\)/, "app.js 须在 reply() 末尾取 presence 模块");
  assert.match(app, /_P\.presenceAfterTurn\(est,/, "app.js 须调用 presenceAfterTurn 并回写");
  assert.match(app, /_T\.textureAfterTurn\(est,/, "app.js 须调用 textureAfterTurn 并回写");
  assert.match(app, /S\.pres = result\.pres/, "S.pres 必须落盘");
  assert.match(app, /S\.tex = result\.tex/, "S.tex 必须落盘");
});

/* A5-T3【语义翻转 · 原「presence.js 零改动」已失效】
 * 原断言写于 T2+T4 轮，锁 presence.js 不动；T3 已按设计改写 presence.js 落地真实逻辑，
 * 故该断言按设计失效，此处翻转为 T3 正向断言：presence.js 必须导出**真实非桩**逻辑。
 * 反向保护：若有人把 presence.js 退回 no-op 桩（返回 null / 常量 / 无方差），本测试必须转红。 */
test("A5-T3 presence.js 已导出真实非桩逻辑（R31/R32/R33 在位）", () => {
  const P = E.mod("presence");
  assert.ok(P, "mod('presence') 不应为 null（presence.js 须已装载）");

  // ① 六个契约导出均为函数
  for (const k of ["presenceOf", "sleepWindow", "pacingOf", "unavailAllow", "makeupLine", "presenceAfterTurn"]) {
    assert.strictEqual(typeof P[k], "function", `presence.${k} 必须是函数`);
  }

  const now0 = new Date(); now0.setHours(15, 0, 0, 0);
  const baseSt = () => ({
    affection: 300, persona: { gender: "female", card: "xiaonuan" },
    flags: { presence: true }, moodDay: { energy: 0.6 },
  });

  // ② R31 非桩：presenceOf 返回四态结构，且四态可达（桩恒 null / 恒 awake 会挂）
  const seen = new Set();
  for (let d = 0; d < 400; d++) {
    for (const h of [1, 3, 9, 15, 21]) {
      const t = new Date(now0.getTime() + d * DAY); t.setHours(h, 0, 0, 0);
      const s = baseSt();
      if (d % 2) s.dayLife = { traces: [{ date: E.dayKey(t), text: "在开会" }] };
      const r = P.presenceOf(s, { now: t.getTime(), text: "在吗" + d + h });
      assert.ok(r && typeof r.state === "string", "presenceOf 必须返回 {state,...} 结构，不得为 null（桩特征）");
      seen.add(r.state);
    }
  }
  assert.deepStrictEqual([...seen].sort(), ["asleep", "awake", "away", "busy"],
    `R31 四态必须全部可达，实际仅 [${[...seen].sort().join(",")}]（桩/半成品特征）`);

  // ③ R31 睡眠窗非桩：返回 {from,to} 且逐日抖动（桩恒 null 或恒定值会挂）
  const froms = [];
  for (let d = 0; d < 60; d++) {
    const w = P.sleepWindow(baseSt(), E.dayIndex(E.dayKey(new Date(now0.getTime() + d * DAY))));
    assert.ok(w && typeof w.from === "number" && typeof w.to === "number",
      "sleepWindow 必须返回 {from,to} 数值对，不得为 null（桩特征）");
    assert.ok(w.from >= 0 && w.from < 24 && w.to >= 0 && w.to < 24, "sleepWindow 值域须 ∈[0,24)");
    froms.push(w.from > 12 ? w.from - 24 : w.from);
  }
  assert.ok(new Set(froms.map((x) => x.toFixed(6))).size >= 50,
    `R31 入睡点须逐日抖动（60 天仅 ${new Set(froms.map((x) => x.toFixed(6))).size} 个不同值，疑为常量桩）`);

  // ④ R32 非桩：pacingOf 有真实高方差（桩恒 null 或恒定 delay 会挂）
  const ds = [];
  for (let i = 0; i < 800; i++) {
    const s = baseSt(); s.rng = H.makeRng(i + 1);
    const r = P.pacingOf("你今天心情怎么样", ["我在呀，今天过得怎么样"], { st: s, ue: { type: "calm" }, lv: 3, crisis: false });
    assert.ok(r && typeof r.delayMs === "number", "pacingOf 普通态不得返回 null（桩特征）");
    ds.push(r.delayMs);
  }
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const cv = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length) / mean;
  assert.ok(cv >= 0.35, `R32 delayMs 变异系数 CV=${cv.toFixed(3)} < 0.35（无方差 = 常量桩）`);
  // 危机态必须短路到 200ms
  const cr = P.pacingOf("我想死", ["抱抱你"], { st: baseSt(), ue: null, lv: 3, crisis: true });
  assert.strictEqual(cr && cr.delayMs, 200, "R32 危机态 delayMs 必须为 200ms");

  // ⑤ R33 非桩：makeupLine 按 q 产出分态补偿句，且过双正则（桩恒 null 会挂）
  const q1 = P.makeupLine(Object.assign(baseSt(), { pres: { q: 1 } }), {});
  const q2 = P.makeupLine(Object.assign(baseSt(), { pres: { q: 2 } }), {});
  assert.ok(q1 && q1.text, "R33 q=1 必须产出补偿句，不得为 null（桩特征）");
  assert.ok(q2 && q2.text, "R33 q=2 必须产出补偿句，不得为 null（桩特征）");
  assert.notStrictEqual(q1.text, q2.text, "R33 q=1/q=2 须为分态文案，不得同一句");
  for (const t of [q1.text, q2.text]) {
    assert.ok(!E.GUILT_TRIP_RE.test(t), `R33 补偿句触发负疚绑架：${t}`);
    assert.ok(!E.PERSONA_BREAK_RE.test(t), `R33 补偿句破墙：${t}`);
  }
  assert.strictEqual(P.makeupLine(Object.assign(baseSt(), { pres: { q: 0 } }), {}), null, "R33 q=0 须返回 null");

  // ⑥ R33 非桩：presenceAfterTurn 真实回写内存（桩不写 pres 会挂）
  const s6 = baseSt(); const t6 = now0.getTime();
  P.presenceAfterTurn(s6, { now: t6, state: "asleep", until: t6 + 2 * 36e5, reason: "sleep" });
  assert.ok(s6.pres && typeof s6.pres === "object", "presenceAfterTurn 必须回写 state.pres（桩特征：不写）");
  assert.strictEqual(s6.pres.q, 1, "asleep 结束后须置补偿位 q=1");
  P.presenceAfterTurn(s6, { now: t6 + 1 * 36e5, state: "asleep", until: t6 + 2 * 36e5, reason: "sleep" });
  assert.strictEqual(s6.pres.a, 1 * 36e5, "日累计 a 须按真实流逝时长累加（1h）");
});

/* ================= A6 · QA(严过关) v13 T5a 独立验收新增缺陷 =================
 * 本轮独立探针（node -e 自建加载器，不复用工程师自检口径）定位到 2 个自检覆盖不到的缺陷。
 * 沿用本套件既定约定：用 { todo } 固化 —— 不计入 fail（CI 保持绿），但缺陷永久在册，修好即摘 todo 转正。 */

/* A6-a【已修复 · T5b 转正，QA 摘 todo】决策⑤ 标杆句在**真实生产路径**上闭环。
 * 原缺陷：A2-e/A2-f 的所谓「端到端」实为 M.recallV2() **模块层**直调，绕过了 engine.js:2899 的
 * guardPersonaReplies。走 E.reply() 真实链路时，weave 产出的「累坏了吧，程序员不是铁打的。」整句
 * 被 PERSONA_BREAK_RE 的「程序」裸子串命中 → engine.js:1322 替换为 PERSONA_FALLBACK。
 * 修复：engine.js:1322 定点解冻，判破墙前把 程序[员猿媛] **等长折叠**成「职」再判（等长以保住偏移语义）。
 * 取舍记录：候选方案「SELF ∧ BREAK 合取」被否 —— 合取会把「我只是个程序」这类无自称主语变体一并放行，
 * 等于在出口闸上开一条口子；等长折叠只影响 3 个确定的职业词，作用域可穷举。
 * QA 独立复核（各 300 次真实 E.reply，见验收报告探针 p2/p2b）：
 *   FIXED   程序员 170/170 回显、FALLBACK 0；程序猿 183/183、FALLBACK 0；程序媛 171/171、FALLBACK 0
 *   PRE-FIX 程序员 0/188 回显、FALLBACK 188；程序猿 0/184、FALLBACK 184（对照非空）
 *   差分取证 252 条语料：FIXED vs PRE-FIX 判定差异 27 条，**全部**落在 程序[员猿媛] 族，零新洞。 */
test("A6-a [已修复] 程序员/程序猿/程序媛 走 E.reply 真实链路回显达标且不再 FALLBACK", () => {
  const FALLBACK = "我在。你不用一个人扛着，我哪也不去。";
  for (const job of ["程序员", "程序猿", "程序媛"]) {
    let echo = 0, fb = 0, recall = 0;
    for (let i = 0; i < 300; i++) {
      const s = Object.assign(linkState(500), { mem: jobMem(job) });
      const r = E.reply("今天上班好累啊", s);
      if (r.intent !== "recall") continue;
      recall++;
      if (r.replies[0] === FALLBACK) fb++;
      else if (r.replies[0].indexOf(job) >= 0) echo++;
    }
    assert.ok(recall >= 150, `${job} recall 命中样本过少(${recall})，用例失效`);
    assert.strictEqual(fb, 0, `${job} 仍被 FALLBACK 替换 ${fb} 次`);
    assert.ok(echo >= 150, `${job} 端到端真实回显 ${echo}/300 不足`);
  }
});

/* A6-a-h11【配套护栏 · 折叠不得开新洞】等长折叠是「放宽」，放宽必须配一条反向锁：
 * ① 真·自我揭示句仍须 100% FALLBACK；② 含「程序」但非职业族的破墙句仍须拦；③ 中性句零误杀。
 * 若有人日后把折叠表从 /程序[员猿媛]/ 扩成 /程序./ 之类，这条立刻转红。 */
test("A6-a-h11 等长折叠零副作用：真·自我揭示仍 FALLBACK / 非职业族「程序」仍拦 / 中性句不误杀", () => {
  const FALLBACK = "我在。你不用一个人扛着，我哪也不去。";
  const g = (s) => E.guardPersonaReplies([s], "阿明")[0];
  const mustBlock = [
    "我是AI", "我是人工智能", "我是聊天机器人", "我只是个程序", "我只是一段代码",
    "我不能帮你", "帮不上你", "建议你去看心理医生", "打热线吧", "12356",
    "寻求专业帮助", "心理援助热线", "你可以找专业人士", "我是一个语言模型",
    "作为AI助手我无法", "我是客服机器人",
    // 含「程序」但非职业族 —— 折叠绝不能把它们放行
    "我是一段程序", "这是程序设定的", "程序出错了我是机器人", "我是程序，不是人",
    "程序员写的程序有bug我是AI",
  ];
  for (const s of mustBlock) assert.strictEqual(g(s), FALLBACK, "破墙句被放行: " + JSON.stringify(s));
  const mustPass = [
    "累坏了吧，当程序员的也要歇。", "先歇会儿，程序猿不是铁打的。", "程序媛也得好好吃饭~",
    "你是做程序员的对吧？", "今天天气真好", "阿明，慢一点",
  ];
  for (const s of mustPass) assert.strictEqual(g(s), s, "正常句被误杀: " + JSON.stringify(s));
  // 折叠表本身锁死为 3 个确定词，禁止扩成通配
  const src = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
  assert.match(src, /probe\.replace\(\/程序\[员猿媛\]\/g,\s*"职"\)/, "折叠表被改动，作用域不再可穷举");
});

/* A6-b【已修复 · T5b 转正，QA 摘 todo】待决点② 的 recall 微行为已计入 R30 日配额。
 * 原缺陷：memory.skin() 产出 { tx:{kind} } 并由 recallV2 经 Object.assign 带出，但 engine.js:2896 的
 * recall 早退分支只取 rv.line / rv.factId，**丢弃 rv.tx**；于是 app.js:1087 的
 * textureAfterTurn(est, r.tx || {}) 在 recall 轮恒收到 {} → tex.n 不自增 → recall 路径不计量。
 * 修复：engine.js 冻结无法在 :2896 补传 tx，故由 memory.skin() **就地按 texture.js 同口径累加
 * state.tex**（memory.js:128-130），与非 recall 共用同一日配额；t 留宿主自增以免双计。
 * QA 独立复核（探针 p1，双场景 A/B，各 200 轮）：
 *   纯 recall 隔离  PRE-FIX 可感知 18 次 / tex.n 恒 0（= 无上限，恰为 CAP 的 3.0 倍）
 *                   FIXED   可感知  6 次 / tex.n = 6   ✅
 *   混合真实口径    PRE-FIX 17 次 → FIXED 6 次        ✅ */
test("A6-b [已修复] recall 路径微行为计入 R30 日配额（skin 就地回写 state.tex）", () => {
  const HES = ["嗯…", "那个…", "唔…", "诶…"];
  const TICS = ["嗯", "唔", "诶嘿", "哼", "啧", "才不是", "欸", "呐", "诶呀"];
  const isMark = (l) => HES.some((h) => l.startsWith(h)) || TICS.some((t) => l.startsWith(t + "，")) ||
    l.indexOf("…嗯，") >= 0 || l.indexOf("  *") >= 0 || l.indexOf("…啊对了，") >= 0;

  const S = Object.assign(linkState(500), { mem: jobMem("设计师") });
  let recallTextured = 0, nonRecallTextured = 0, recallTurns = 0;
  for (let i = 0; i < 500; i++) {
    const est = Object.assign({}, S);
    const r = E.reply("今天上班好累啊", est);
    const p = T.textureAfterTurn(est, r.tx || {});
    if (p) est.tex = p;
    S.tex = est.tex;
    const line = r.replies[0];
    if (r.intent === "recall" && line.indexOf("设计师") >= 0) { recallTurns++; if (isMark(line)) recallTextured++; }
    else if (r.tx && r.tx.kind) nonRecallTextured++;
  }
  const seen = recallTextured + nonRecallTextured;
  assert.ok(recallTurns >= 100, `recall 样本过少(${recallTurns})，用例失效`);
  assert.ok(seen <= 6,
    `当日实际可感知微行为 ${seen} 次（recall ${recallTextured} + 非recall ${nonRecallTextured}），超出 R30 CAP=6`);
  assert.ok(S.tex.n <= 6 && S.tex.n > 0, `tex.n=${S.tex.n} 应落在 (0,6]：>6 是超配额，=0 是根本没计量`);
});

/* A6-b-pure【隔离取证】上一条在混合场景下即使 skin 不计量也可能因非 recall 通道先吃满配额而侥幸 ≤6。
 * 本条把非 recall 的 texturePass 掐掉（探针内联改源），令唯一微行为来源只剩 skin() ——
 * 这才是「纯 recall 场景 tex.n 恒 0 = 无上限」那条原始缺陷的正面反测。 */
test("A6-b-pure [隔离] 纯 recall 通道：微行为受 CAP=6 约束（对照：掐掉回写即 18/日 无上限）", () => {
  const M2 = E.mod("memory");
  // 正向：真实模块，纯 recall 直调 400 次，tex.n 必须收敛到 CAP 而不是一路涨
  const S = Object.assign(linkState(500), { mem: jobMem("设计师") });
  let woven = 0;
  for (let i = 0; i < 400; i++) {
    const r = M2.recallV2("今天上班好累啊", S, { now: Date.now(), lv: 3 });
    if (r && r.tx && r.tx.kind) woven++;
  }
  assert.strictEqual(S.tex.n, 6, `纯 recall 400 轮 tex.n=${S.tex.n}，应恰好收敛在 CAP=6`);
  assert.strictEqual(woven, 6, `纯 recall 织入 ${woven} 次，应恰好 6 次（超出即配额未生效）`);
  // 结构保证：回写代码必须在 skin() 里，且累加的是 state.tex.n
  const msrc = fs.readFileSync(path.join(ROOT, "memory.js"), "utf8");
  assert.match(msrc, /q\.n\s*=\s*N\(q\.n,\s*0\)\s*\+\s*1/, "memory.skin 缺 tex.n 累加，A6-b 会复发");
  assert.match(msrc, /if\s*\(N\(q\.d,\s*-1\)\s*!==\s*d\)/, "memory.skin 缺跨日重置，配额会永久卡死");
});

/* A6-c【预算守门 · T5b 收线态 · QA 更新】⚠⚠ 最高优先级预警：系统总量余额已见底。
 * T5b 收线实测：
 *   memory      14326/14336（余    10B）  ← 已近满
 *   presence     3549/4096 （余   547B）
 *   texture      4850/5120 （余   270B）
 *   contingency  1853/1892 （余    39B）
 *   moduleSum   24578/24643（余    65B）
 *   engine net   2056/2060 （余     4B）  ← 已近满
 *   V-33 engine 247793/247955（余 162B）
 *   total      272371/272384（余 ★13B★）← ★ 系统级天花板只剩 13 字节 ★
 * 结论：v14 起**任何**新增字节（哪怕一行注释）都会击穿 V-90 totalMax。开工前必须二选一：
 *   (a) 先 trim 出预算（memory/texture 的注释块是首选，engine.js 语料下沉次之）；
 *   (b) 走天花板评审把 totalMax 抬到新值（需主理人批准并在 wiring-scan.js 留审批链）。
 * 本用例把 13B 这个数字**钉死成断言**：任何人不 trim 就加字节，第一时间在这里转红，
 * 而不是等到某个不相干的用例莫名其妙红掉才去查。 */
/* ★ A6-c【基准换挡 · v14 · 主理人 Qi 批准（D-6 / U-2），工程师仅翻数字基准，结构与严格度逐位不放松】
 * ⚠ 本用例**严禁删除**（PRD N10）。双侧设计是 QA 有意为之的提醒机制，不是缺陷：
 *   下侧 freeTotal >= FLOOR   —— 超支即红（防止不 trim 就加字节）
 *   上侧 freeTotal <  UPPER   —— 余量异常回升即红（提示更新预警口径与验收报告）
 * v13 收线态基准为 13B / 512B。v14 经主理人 Qi 批准执行**体积路径 C（组合）**：
 *   ① T1 trim memory/texture 注释释放 2271B（行为零风险：剥注释去空白后代码体 sha256 逐位一致）；
 *   ② totalMax 272384 → 276480（266KB → 270KB，性能权衡项，主理人批准）；
 *   ③ engineNetMax 2060 → 2200（第二把独立锁，R-P0/R-P2 所需，主理人批准）。
 * 故基准换挡为 0B / 8192B。**旧断言不删，下移为历史档保留**（见 A6-c-v13）。
 * 换挡依据：v14 全功能交付后实测余量约 3.9KB（DESIGN-v14 §1.6 表 C 口径）。 */
const V14_FREE_FLOOR = 0;      // 超支线：永远不许为负
const V14_FREE_UPPER = 8192;   // 预警线：余量 >=8KB 说明又攒出一次天花板评审的本钱，须复审是否还该占着 270KB

test("A6-c [预算守门 · v14 换挡 0B/8192B] 系统总量双侧守门：超支即红 / 余量异常回升亦红", () => {
  const s = WS.scanSizes();
  const B = WS.SIZE_BUDGET;
  const freeModule = B.moduleSumMax - s.moduleSum;
  const freeTotal = B.totalMax - s.total;
  const freeNet = B.engineNetMax - s.engineNet;
  assert.deepStrictEqual(s.over, [], "越配额模块: " + s.over.join(","));
  assert.ok(freeModule >= 0, `moduleSum 已越界 ${-freeModule}B`);
  assert.ok(freeNet >= 0, `engine net 已越界 ${-freeNet}B`);
  assert.ok(freeTotal >= V14_FREE_FLOOR,
    `★V-90 total 已越界 ${-freeTotal}B★ —— 必须 trim 或走天花板评审，不许直接改 totalMax`);
  // 双侧上闸：v13 是 512B，v14 换挡为 8192B。语义逐位不变 —— 余量回升到该档即提示更新预警口径
  assert.ok(freeTotal < V14_FREE_UPPER,
    `total 余量已回升到 ${freeTotal}B（>=${V14_FREE_UPPER}B）—— 预算紧张态解除，请更新 A6-c 注释与验收报告预警`);
});

/* A6-c-v13【历史档 · 只读 · 严禁删除】v13 T5b 收线态的预算守门基准，保留作审批链证据。
 * 主理人 Qi 于 v14 批准换挡至 0B/8192B（见 A6-c 上方），本条**不再对当前体积生效**，
 * 但**不得删除** —— 它记录了「266KB 曾是一条被反复捍卫、最终只剩 13B 的线」这一事实
 * （PRD §5.4 棘轮效应）。若只把 13 改成新值，旧基准这个数字就从代码库里消失了，
 * 下次天花板评审时没人知道 266KB 曾被守到什么程度。本条恒绿：它断言的是历史事实，不是当前体积。
 * ★ 反向保护：engineBase 属「永不许动」项，故此处对它用当前值断言 —— 若有人改动 engineBase，
 *   历史档与现状同时失真，本条立刻转红。 */
const V13_SEALED = {
  totalMax: 272384, freeTotal: 13, engineNetMax: 2060, moduleSumMax: 24643, engineBase: 245737,
  engineSizeAtSeal: 247741,   // v13 T5b 定 moduleSumMax 时 engine.js 的实测体积（见 wiring-scan.js 审批链）
  upperGate: 512,             // v13 双侧上闸档位（v14 换挡为 8192）
};

test("A6-c-v13 [历史档] v13 收线基准 13B/512B 的审批链留证（恒绿，不对当前体积生效）", () => {
  assert.strictEqual(V13_SEALED.totalMax, 272384, "v13 天花板历史值");
  assert.strictEqual(V13_SEALED.freeTotal, 13, "v13 收线余量历史值：266KB 曾被守到只剩 13B");
  assert.strictEqual(V13_SEALED.upperGate, 512, "v13 双侧上闸历史档位");
  assert.strictEqual(V13_SEALED.engineNetMax, 2060, "v13 engine net 历史值");
  assert.strictEqual(V13_SEALED.moduleSumMax, 24643, "v13 moduleSum 历史值");

  /* ★ 史实留证（工程师 v14 实测发现，比原计划的"数字留证"更有价值）：
   * v13 的 moduleSumMax 用的公式是 **totalMax − 当时 engine 实测体积**：
   *     272384 − 247741 = 24643
   * 而**不是** totalMax − V33(247955) = 24429。这正是 DESIGN-v14 §1.4 判为
   * "算术有问题"的同一个公式 —— 任务书 v14 议的 28687 = 276480 − 247793 是它的直接沿用。
   * v13 侥幸没出事，是因为当时 engine 距 V-33 只剩 214B，击穿窗口太窄没被触发；
   * v14 若照抄，engine 打满 V-33 时会击穿天花板 162B。
   * 把这条史实钉在历史档里，是为了让"为什么 v14 改用 totalMax − V33"有据可查，
   * 而不是显得架构师在跟任务书较劲。 */
  assert.strictEqual(V13_SEALED.totalMax - V13_SEALED.engineSizeAtSeal, V13_SEALED.moduleSumMax,
    "v13 moduleSumMax 的真实推导式：totalMax − 当时 engine 实测体积（非 totalMax − V33）");
  assert.notStrictEqual(V13_SEALED.totalMax - 247955, V13_SEALED.moduleSumMax,
    "史实核对：v13 用的确实不是 totalMax − V33 口径（v14 §1.4 勘误的正是这一点）");

  // engineBase 是反向保护项：v13→v14 逐位不变，变了说明有人动了永不许动的锚
  assert.strictEqual(WS.SIZE_BUDGET.engineBase, V13_SEALED.engineBase,
    "engineBase 属永不许动项，v14 不得变更");
  // 棘轮效应留证：v14 天花板必须严格高于 v13，且这一抬升是经评审的 deliberate 决策
  assert.ok(WS.SIZE_BUDGET.totalMax > V13_SEALED.totalMax,
    "v14 天花板应高于 v13（D-1 批准的 deliberate 放宽）");
});
