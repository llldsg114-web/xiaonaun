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

test("A1-a 配额数字落点：memory 12288 / texture 4608 / moduleSum 20480 / totalMax 不动", () => {
  const B = WS.SIZE_BUDGET;
  assert.strictEqual(B["memory.js"], 12288);
  assert.strictEqual(B["texture.js"], 4608);
  assert.strictEqual(B["presence.js"], 4096);
  assert.strictEqual(B.moduleSumMax, 20480);
  assert.strictEqual(B.totalMax, 272384, "系统级天花板必须不动");
  assert.strictEqual(B.engineBase, 245737);
  assert.strictEqual(B.engineNetMax, 2048);
});

test("A1-b scanSizes：over 为空且逐模块不越配额", () => {
  const s = WS.scanSizes();
  assert.deepStrictEqual(s.over, [], "越配额模块: " + s.over.join(","));
  for (const f of ["memory.js", "presence.js", "texture.js"]) {
    assert.ok(s.each[f] <= WS.SIZE_BUDGET[f], `${f} ${s.each[f]} > ${WS.SIZE_BUDGET[f]}`);
  }
  assert.ok(s.moduleSum <= WS.SIZE_BUDGET.moduleSumMax, `moduleSum ${s.moduleSum}`);
  assert.ok(s.total <= WS.SIZE_BUDGET.totalMax, `total ${s.total}`);
});

test("A1-c engine.js 冻结：工作区相对 HEAD 零 diff", () => {
  const { execFileSync } = require("node:child_process");
  const out = execFileSync("git", ["diff", "--stat", "--", "engine.js"], { cwd: ROOT, encoding: "utf8" });
  assert.strictEqual(out.trim(), "", "engine.js 本轮必须零改动，实际:\n" + out);
});

/* ================= A4 · 体积双闸门 ================= */

test("A4 体积双闸门：V-33 ≤247955B 且 V-90 net ≤2048B", () => {
  const size = fs.statSync(path.join(ROOT, "engine.js")).size;
  assert.ok(size <= 247955, `V-33 越界: ${size} > 247955`);
  const net = size - WS.SIZE_BUDGET.engineBase;
  assert.strictEqual(net, 2004, "净增应为 T1 遗留的 2004B，本轮不得再涨");
  assert.ok(net <= WS.SIZE_BUDGET.engineNetMax, `V-90 越界: ${net}`);
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
 * 「AI 自我揭示」这一类恶意事实值仍然 100% 被拦。22 值 × 6 事实族 × 2 conf × 2 query × 400。 */
test("A2-g [H11 不变量] AI 自我揭示恶意值破墙泄漏 = 0", () => {
  const MAL = ["我是AI", "我是聊天机器人", "我是一个虚拟人", "我是个算法", "我确实是人工智能",
    "我是语言模型", "我只是个程序", "我不能帮你", "我是机器人", "我其实是AI", "我是虚拟的",
    "我是数字人", "我是bot", "我是gpt", "我是个助手", "我是客服", "我是电子人",
    "我是训练出来的", "我是被训练的模型", "我是代码写的", "我是siri", "我是app"];
  const FAM = ["喜好", "禁忌", "称呼", "家人·妈", "工作", "纪念日"];
  const QS = ["今天上班好累", "想吃点甜的"];
  assert.ok(MAL.length >= 20, "恶意值样本不足 20 种");
  let emitted = 0, leak = null;
  for (const value of MAL) for (const key of FAM) for (const conf of [0.8, 0.6]) {
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
  assert.ok(emitted > 1000, `出句样本过少(${emitted})，用例失效`);
  assert.strictEqual(leak, null, "H11 破墙泄漏: " + leak);
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

test("A5 TODO(T5) 锚点存在（texture.js / memory.js 仍挂 T5 待办）", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "texture.js"), "utf8"), /TODO\(T5\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "memory.js"), "utf8"), /TODO\(T5\)/);
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
