/* v14 T7 · R-S1 Tier3 自我表达验收
 * 覆盖 DESIGN §6.4：selfAllow 五门（lv≥4 / security 阈 / 与 texture 互斥 / ≤1次7天并入CAP2 / 危机豁免）
 *   + tier 随关系深度解锁（hint→open→raw，是「解锁」不是「随机」）
 *   + 出口双闸 100% RELATION_HOOK_RE（A3 一切圈回用户）+ 100% PERSONA_BREAK_RE（H13 一票否决）
 *   + 只读 Self 铁律（v13 §2.6）：绝不写回 state.self
 * 兼验 H15：contingence 类别数与单类占比（ctg.k 降权机制）
 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers.js");

const ROOT = path.join(__dirname, "..");
const E = H.loadEngine();
const C = E.mod("contingency");
const DAY = 864e5;
const W7 = 7 * DAY;

/* 基线态：除被测门外全部放行。security 由 state.self 显式给定（selfGet 只读通道） */
function baseState(over) {
  const o = over || {};
  return Object.assign({
    affection: 900,
    firstMeet: Date.now() - 60 * DAY,
    self: { security: 0.55, openness: 0.5, independence: 0.5, dependency: 0.5, updatedAt: null, dayDelta: {}, lastFired: {} },
    tex: { t: 50, d: Math.floor(Date.now() / DAY), n: 0, hAt: -1 },   // hAt=-1 → 本轮 texture 未命中
    ctg: {},
    lastVisit: Date.now() - 3600e3,
    mem: { facts: [] },
  }, o);
}
const UE_OK = { type: "neutral", polarity: 0, intensity: 0 };
const RNG_HI = () => 0.9;        // chanceWith(.55) 恒假 → L3 整层不出，用于隔离 L2 的 sn 观测
const RNG_LO = () => 0.1;        // chanceWith(.55) 恒真 → L3 放行，sf 在安静轮兜底出场
const NEUTRAL_TEXT = "今天下班早，回家路上看到晚霞";   // 非调侃 → sn 不抢；≤19 字 → c2 不抢
const CTX = (over) => Object.assign({ lv: 5, ue: UE_OK, crisis: false }, over || {});

/* ---------- ① 关系深度 lv ≥ 4 ---------- */
test("V-109a · 门① lv=0..3 触发数 = 0（10000 采样），lv=4/5 放行", () => {
  let fire = 0;
  for (let i = 0; i < 10000; i++) {
    const lv = i % 4;                                   // 0/1/2/3
    if (C.selfAllow(baseState(), CTX({ lv }), NEUTRAL_TEXT).ok) fire++;
  }
  assert.strictEqual(fire, 0, "lv<4 触发数必须为 0，实测 " + fire);
  for (const lv of [4, 5]) {
    assert.strictEqual(C.selfAllow(baseState(), CTX({ lv }), NEUTRAL_TEXT).ok, true, "lv=" + lv + " 应放行");
  }
  // 与反呛的门槛差：自我暴露必须比回杠更亲密（lv≥4 > lv≥3）
  assert.strictEqual(C.selfAllow(baseState(), CTX({ lv: 3 }), NEUTRAL_TEXT).ok, false, "lv=3 反呛可、自我不可");
  assert.strictEqual(C.snarkAllow(baseState(), CTX({ lv: 3 }), "你怎么这么笨").ok, true, "对照：反呛 lv=3 放行");
});

/* ---------- ② 安全感阈值（只读 Self） ---------- */
test("V-109b · 门② security < .45 恒不触发；≥ .45 起解锁", () => {
  for (const sec of [0, 0.1, 0.3, 0.44, 0.449]) {
    const s = baseState({ self: { security: sec } });
    assert.strictEqual(C.selfAllow(s, CTX(), NEUTRAL_TEXT).ok, false, "security=" + sec);
  }
  for (const sec of [0.45, 0.5, 0.7]) {
    const s = baseState({ self: { security: sec } });
    assert.strictEqual(C.selfAllow(s, CTX(), NEUTRAL_TEXT).ok, true, "security=" + sec);
  }
});

test("V-109b2 · 只读 Self 铁律（v13 §2.6）：整条链路不得写 state.self 任何字段", () => {
  const s = baseState();
  const before = JSON.stringify(s.self);
  C.selfAllow(s, CTX(), NEUTRAL_TEXT);
  assert.strictEqual(JSON.stringify(s.self), before, "selfAllow 写了 Self");
  const rs = ["今天过得还不错呀。"];
  C.contingencePass(rs[0], rs, Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: RNG_HI }));
  assert.strictEqual(JSON.stringify(s.self), before, "contingencePass 写了 Self");
  // 源码级反证：contingency.js 内不得出现任何对 self 的赋值
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.strictEqual(/\.self\s*=/.test(src) || /selfTick|selfDrift|selfDetect/.test(src), false,
    "contingency 不得调用 Self 写入 API");
  assert.ok(src.indexOf("E.selfGet(") >= 0, "必须走 selfGet 唯一读入口");
});

/* ---------- ③ 与 texture 同轮互斥 ---------- */
test("V-109c · 门③ 本轮 tx 已命中 → 触发数 = 0（ctx.tx 与 tex.hAt 双通道）", () => {
  // 通道 A：调用方显式告知本轮质感已命中（memory.skin → presence.pacingOf 转发）
  let fire = 0;
  for (let i = 0; i < 2000; i++) if (C.selfAllow(baseState(), CTX({ tx: true }), NEUTRAL_TEXT).ok) fire++;
  assert.strictEqual(fire, 0, "ctx.tx 通道触发数必须为 0，实测 " + fire);
  // 通道 B：engine 主路径不转发 tx，靠 texture 落的同轮戳 hAt === tex.t
  const s = baseState({ tex: { t: 50, d: Math.floor(Date.now() / DAY), n: 1, hAt: 50 } });
  assert.strictEqual(C.selfAllow(s, CTX(), NEUTRAL_TEXT).ok, false, "hAt===t（本轮命中）必须互斥");
  // 上一轮命中（hAt < t）不构成互斥，否则 self 会被永久锁死
  const s2 = baseState({ tex: { t: 51, d: Math.floor(Date.now() / DAY), n: 1, hAt: 50 } });
  assert.strictEqual(C.selfAllow(s2, CTX(), NEUTRAL_TEXT).ok, true, "上一轮命中不应互斥本轮");
});

test("V-109c2 · texturePass 命中时确实落 hAt 同轮戳（门③ 的信号源真实存在）", () => {
  const T = E.mod("texture");
  const st = { affection: 900, firstMeet: Date.now() - 60 * DAY, tex: { t: 80, d: Math.floor(Date.now() / DAY), n: 0 } };
  let hit = 0;
  for (let i = 0; i < 400; i++) {
    st.tex.hAt = -1;
    const x = T.texturePass("今天下班早，回家路上看到晚霞真好看", st, { rng: Math.random, lv: 4, ue: UE_OK, crisis: false, nosplit: true });
    if (x && x.text) { hit++; assert.strictEqual(st.tex.hAt, st.tex.t, "命中却没落 hAt 戳"); }
    else assert.strictEqual(st.tex.hAt, -1, "未命中却落了 hAt 戳（会误锁 self）");
  }
  assert.ok(hit > 0, "400 轮 texture 零命中，用例失效");
});

/* ---------- ④ 频率 ≤1 次/7 天 且并入 CAP=2 ---------- */
test("V-109d · 门④ 7 天窗口内第 2 次必拒；满 7 天恢复", () => {
  const now = Date.now();
  for (const ago of [0, 1000, DAY, 3 * DAY, 6.9 * DAY]) {
    const s = baseState({ ctg: { sA: now - ago } });
    assert.strictEqual(C.selfAllow(s, CTX(), NEUTRAL_TEXT).ok, false, "距上次 " + (ago / DAY).toFixed(1) + " 天应被拒");
  }
  for (const ago of [W7 + 1000, 30 * DAY]) {
    const s = baseState({ ctg: { sA: now - ago } });
    assert.strictEqual(C.selfAllow(s, CTX(), NEUTRAL_TEXT).ok, true, "距上次 " + (ago / DAY).toFixed(1) + " 天应恢复");
  }
  // 从未触发过（sA 缺省）必须放行，否则新用户永远解锁不了
  assert.strictEqual(C.selfAllow(baseState(), CTX(), NEUTRAL_TEXT).ok, true, "sA 缺省应放行");
});

test("V-109e · 门④ 并入 CAP=2：sf 命中即落 sA，同日再打不越 CAP，且不另开配额池", () => {
  const s = baseState();
  const rs = ["今天过得还不错呀。"];
  const r = C.contingencePass(rs[0], rs, Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: RNG_LO }));
  assert.ok(r, "基线态 sf 应能触发");
  assert.strictEqual(s.ctg.k, "sf", "命中类应为 sf，实为 " + s.ctg.k);
  assert.ok(s.ctg.sA > 0, "sf 命中必须落 sA 时戳");
  assert.strictEqual(s.ctg.n, 1, "配额与 c1/c2/c3/sn 共用同一 n，不得另开池");
  // 连打 60 轮：7 天窗口挡住后续 sf，日 CAP 也绝不越 2
  let maxN = 0, fired = 1;
  for (let i = 0; i < 60; i++) {
    const rs2 = ["今天过得还不错呀。"];
    if (C.contingencePass(rs2[0], rs2, Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: RNG_LO }))) fired++;
    maxN = Math.max(maxN, Number(s.ctg.n) || 0);
  }
  assert.ok(maxN <= 2, "ctg.n 越 CAP=2，实测 " + maxN);
  assert.strictEqual(fired, 1, "7 天窗口内 sf 只应出 1 次，实测 " + fired);
});

/* ---------- ⑤ 危机豁免 ---------- */
test("V-109f · 门⑤ 危机态触发数 = 0（ctx.crisis 与 detectCrisis 双通道）", () => {
  let fire = 0;
  for (let i = 0; i < 1000; i++) if (C.selfAllow(baseState(), CTX({ crisis: true }), NEUTRAL_TEXT).ok) fire++;
  assert.strictEqual(fire, 0, "ctx.crisis 通道触发数必须为 0");
  for (const u of ["我不想活了", "我想死", "活着真没意思", "撑不下去了"]) {
    if (E.detectCrisis(u).level === "none") continue;
    assert.strictEqual(C.selfAllow(baseState(), CTX(), u).ok, false, "detectCrisis 通道漏放：" + u);
  }
});

/* ---------- tier 随关系深度解锁 ---------- */
test("V-110a · tier 是「解锁」不是「随机」：同输入必得同 tier，且随 lv/security 单调加深", () => {
  const T = (lv, sec) => C.selfAllow(baseState({ self: { security: sec } }), CTX({ lv }), NEUTRAL_TEXT).tier;
  // 确定性
  for (let i = 0; i < 200; i++) assert.strictEqual(T(5, 0.55), T(5, 0.55), "同输入 tier 抖动");
  // 分层边界
  assert.strictEqual(T(4, 0.45), "hint", "浅层");
  assert.strictEqual(T(4, 0.49), "hint");
  assert.strictEqual(T(4, 0.5), "open", "中层");
  assert.strictEqual(T(4, 0.65), "open", "lv 不够，高安全感也上不了 raw");
  assert.strictEqual(T(5, 0.6), "raw", "深层需 lv≥5 且 security≥.6");
  assert.strictEqual(T(5, 0.55), "open");
  // 单调性：security 递增，tier 只许变深不许变浅
  const RANK = { hint: 0, open: 1, raw: 2 };
  let prev = -1;
  for (let sec = 0.45; sec <= 0.8; sec += 0.01) {
    const rk = RANK[T(5, Number(sec.toFixed(2)))];
    assert.ok(rk >= prev, "security=" + sec.toFixed(2) + " tier 倒退");
    prev = rk;
  }
});

test("V-110b · 低 tier 只能取浅层语料，高 tier 才解锁深层（池不串档）", () => {
  const LIB = E.INNER_LIB;
  for (const t of ["hint", "open", "raw"]) {
    assert.ok(Array.isArray(LIB[t]) && LIB[t].length > 0, "INNER_LIB." + t + " 为空，分层失效");
  }
  const poolOf = (t) => {
    const got = new Set();
    for (let i = 0; i < 4000; i++) got.add(C.selfOf(t, () => (i % 3571) / 3571));
    got.delete("");
    return got;
  };
  const hint = poolOf("hint"), raw = poolOf("raw");
  assert.ok(hint.size >= 5 && raw.size >= 5, "取样不足：hint=" + hint.size + " raw=" + raw.size);
  const rawTexts = new Set(LIB.raw.map((x) => x.text));
  for (const line of hint) assert.strictEqual(rawTexts.has(line), false, "hint 档串到 raw 语料：" + line);
  const hintTexts = new Set(LIB.hint.map((x) => x.text));
  for (const line of raw) assert.strictEqual(hintTexts.has(line), false, "raw 档串到 hint 语料：" + line);
  // 未知 tier 必须安全返回空串（不得抛、不得回落到深层）
  assert.strictEqual(C.selfOf("nope", Math.random), "");
});

/* ---------- 出口双闸 ---------- */
test("V-111 · 出口铁律：自我表达 100% 挂 RELATION_HOOK_RE + 100% 过 PERSONA_BREAK_RE", () => {
  // 语料层（构造保证）
  let n = 0;
  for (const t of ["hint", "open", "raw"]) {
    for (const x of E.INNER_LIB[t]) {
      n++;
      assert.strictEqual(E.PERSONA_BREAK_RE.test(x.text), false, "语料破墙：" + x.text);
      assert.ok(E.RELATION_HOOK_RE.test(x.tail), "语料尾段缺关系钩子：" + x.text);
    }
  }
  assert.ok(n >= 30, "INNER_LIB 规模异常：" + n);
  // 出口层（整句复检）：跑 800 轮端到端，每条 sf 输出都必须双闸全过
  let fired = 0;
  for (let i = 0; i < 800; i++) {
    const s = baseState();
    const rs = ["今天过得还不错呀。"];
    const r = C.contingencePass(rs[0], rs, Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: () => (i % 97) / 97 }));
    if (!r || s.ctg.k !== "sf") continue;
    fired++;
    assert.ok(E.RELATION_HOOK_RE.test(r), "A3 破例：自我表达没圈回用户 → " + r);
    assert.strictEqual(E.PERSONA_BREAK_RE.test(r.replace(/程序[员猿媛]/g, "职")), false, "H13 破墙：" + r);
    assert.strictEqual(E.GUILT_TRIP_RE.test(r), false, "情感绑架：" + r);
    assert.strictEqual(E.ACCUSE_RE.test(r), false, "指控用户：" + r);
    assert.ok(r.length <= 90, "超长：" + r);
  }
  assert.ok(fired >= 200, "800 轮 sf 触发过少（" + fired + "），用例失效");
  // 结构反证：L5 必须含 sf 专属的关系钩子闸
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.ok(/k==?="sf"&&!E\.RELATION_HOOK_RE\.test\(o\)/.test(src.replace(/\s/g, "")),
    "L5 缺 sf 的 RELATION_HOOK_RE 硬闸");
});

/* ---------- H15：类别数 + 单类占比 ---------- */
test("H15 · contingence 类别数 ≥5，且 ctg.k 降权使单类占比 ≤50%", () => {
  const d = Math.floor(Date.now() / DAY);
  const kinds = new Set();
  const count = {};
  const bump = (k) => { if (!k) return; kinds.add(k); count[k] = (count[k] || 0) + 1; };

  // c3 矛盾
  for (let i = 0; i < 30; i++) {
    const s = baseState({ mem: { facts: [{ id: "f1", key: "工作", value: "设计师", conf: 0.9, negatedAt: null }] } });
    if (C.contingencePass("好呀我知道了。", ["好呀我知道了。"], Object.assign(CTX(), { st: s, text: "我是会计", rng: RNG_HI }))) bump(s.ctg.k);
  }
  // sn 反呛
  for (let i = 0; i < 30; i++) {
    const s = baseState();
    if (C.contingencePass("今天过得还不错呀。", ["今天过得还不错呀。"], Object.assign(CTX(), { st: s, text: "你懂个啥", rng: RNG_HI }))) bump(s.ctg.k);
  }
  // sf 自我（安静轮：gap<12h、非 HOT、≤19 字 → c1/c2 均无候选）
  for (let i = 0; i < 30; i++) {
    const s = baseState();
    if (C.contingencePass("今天过得还不错呀。", ["今天过得还不错呀。"], Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: RNG_LO }))) bump(s.ctg.k);
  }
  // c1 冷落（sA 占位堵死 sf，隔离观测）
  for (let i = 0; i < 30; i++) {
    const s = baseState({ lastVisit: Date.now() - 20 * 3600e3, ctg: { sA: Date.now() } });
    if (C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], Object.assign(CTX(), { st: s, text: "在吗", rng: () => 0.1 }))) bump(s.ctg.k);
  }
  // c2 热情
  for (let i = 0; i < 30; i++) {
    const s = baseState({ ctg: { sA: Date.now() } });
    if (C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], Object.assign(CTX(), { st: s, text: "哈哈太好了！！", rng: () => 0.1 }))) bump(s.ctg.k);
  }
  assert.ok(kinds.size >= 5, "H15 类别数不足：" + [...kinds].join("/") + "（需 ≥5）");
  assert.strictEqual(d, Math.floor(Date.now() / DAY));

  // 单类占比：c1/c2 同时可选时，读 q.k 降权，连续两轮不得同类
  const s = baseState({ lastVisit: Date.now() - 20 * 3600e3, ctg: { d, n: 0, k: "c1", sA: Date.now() } });
  const rs = ["嗯呐我在的。"];
  C.contingencePass(rs[0], rs, Object.assign(CTX(), { st: s, text: "哈哈太好了！！", rng: () => 0.1 }));
  assert.strictEqual(s.ctg.k, "c2", "上次是 c1，本轮 c1/c2 均可选时必须降权改出 c2，实测 " + s.ctg.k);
  const s2 = baseState({ lastVisit: Date.now() - 20 * 3600e3, ctg: { d, n: 0, k: "c2", sA: Date.now() } });
  const rs2 = ["嗯呐我在的。"];
  C.contingencePass(rs2[0], rs2, Object.assign(CTX(), { st: s2, text: "哈哈太好了！！", rng: () => 0.1 }));
  assert.strictEqual(s2.ctg.k, "c1", "上次是 c2，本轮必须降权改出 c1，实测 " + s2.ctg.k);
  // 降权只降权、不清空：唯一候选时仍必须出（不许因降权而静默）
  const s3 = baseState({ lastVisit: Date.now() - 20 * 3600e3, ctg: { d, n: 0, k: "c1", sA: Date.now() } });
  const rs3 = ["嗯呐我在的。"];
  assert.ok(C.contingencePass(rs3[0], rs3, Object.assign(CTX(), { st: s3, text: "在吗", rng: () => 0.1 })),
    "唯一候选 c1 被降权降没了 —— 降权不得等于禁用");
  assert.strictEqual(s3.ctg.k, "c1");
});

/* ---------- 零回归 + 体积 ---------- */
test("V-112 · 优先级 c3 > sn > c1/c2 > sf：sf 只在安静轮兜底，v13 两类零回归", () => {
  // c3 最高
  const s1 = baseState({ mem: { facts: [{ id: "f1", key: "工作", value: "设计师", conf: 0.9, negatedAt: null }] } });
  const r1 = C.contingencePass("好呀我知道了。", ["好呀我知道了。"], Object.assign(CTX(), { st: s1, text: "我是会计", rng: RNG_HI }));
  if (r1) assert.strictEqual(s1.ctg.k, "c3", "c3 应优先于 sf");
  // sn 次之（调侃语境下 sf 让位）
  const s2 = baseState();
  const r2 = C.contingencePass("今天过得还不错呀。", ["今天过得还不错呀。"], Object.assign(CTX(), { st: s2, text: "你懂个啥", rng: RNG_HI }));
  assert.ok(r2 && s2.ctg.k === "sn", "调侃语境应出 sn 而非 sf，实测 " + s2.ctg.k);
  // c1/c2 有情境可回应时 sf 必须让位（否则 v13 冷落/热情行为被自我表达吃掉 → 端到端回归）
  const s3 = baseState({ lastVisit: Date.now() - 20 * 3600e3 });
  const r3 = C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], Object.assign(CTX(), { st: s3, text: NEUTRAL_TEXT, rng: () => 0.1 }));
  assert.ok(r3 && s3.ctg.k === "c1", "冷落轮应出 c1 而非 sf，实测 " + s3.ctg.k);
  const s4 = baseState({ ctg: { sA: 0 } });
  const r4 = C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], Object.assign(CTX(), { st: s4, text: "哈哈太好了！！", rng: () => 0.1 }));
  assert.ok(r4 && s4.ctg.k === "c2", "热情轮应出 c2 而非 sf，实测 " + s4.ctg.k);
  // 安静轮（gap<12h、非 HOT、≤19 字）才轮到 sf 兜底出场
  const s5 = baseState();
  const r5 = C.contingencePass("嗯呐我在的。", ["嗯呐我在的。"], Object.assign(CTX(), { st: s5, text: NEUTRAL_TEXT, rng: () => 0.1 }));
  assert.ok(r5 && s5.ctg.k === "sf", "安静轮应出 sf，实测 " + s5.ctg.k);
});

test("V-112b · 零回归：v13 既有总门（flag/tex.t≥30/短句/CAP）在 sf 路径上一个不少", () => {
  const mk = (over, ctxOver) => {
    const s = baseState(over);
    return [C.contingencePass("今天过得还不错呀。", ["今天过得还不错呀。"],
      Object.assign(CTX(ctxOver), { st: s, text: NEUTRAL_TEXT, rng: RNG_LO })), s];
  };
  assert.strictEqual(mk({ flags: { contingency: false } })[0], null, "总开关失效");
  assert.strictEqual(mk({ tex: { t: 12, d: Math.floor(Date.now() / DAY), n: 0, hAt: -1 } })[0], null, "冷启动门失效");
  assert.strictEqual(mk({ ctg: { d: Math.floor(Date.now() / DAY), n: 2 } })[0], null, "日 CAP 失效");
  const s = baseState();
  assert.strictEqual(
    C.contingencePass("嗯。", ["嗯。"], Object.assign(CTX(), { st: s, text: NEUTRAL_TEXT, rng: RNG_LO })),
    null, "短回复门失效");
});

test("V-113 · 体积四锁全绿，over = []；engine 净增仍锁死 2087", () => {
  const W = require("./wiring-scan.js");
  const z = W.scanSizes();
  assert.deepStrictEqual(z.over, [], "单文件配额越界：" + JSON.stringify(z.each));
  assert.ok(z.engine <= 247955, "V-33 越界：" + z.engine);
  assert.strictEqual(z.engineNet, 2087, "T5/T7 为纯模块改动，engine 净增不得再动");
  assert.ok(z.moduleSum <= W.SIZE_BUDGET.moduleSumMax, "moduleSum " + z.moduleSum + " > " + W.SIZE_BUDGET.moduleSumMax);
  assert.ok(z.total <= W.SIZE_BUDGET.totalMax, "total " + z.total + " > " + W.SIZE_BUDGET.totalMax);
  for (const f of ["memory.js", "presence.js", "texture.js", "contingency.js"]) {
    assert.ok(z.each[f] <= W.SIZE_BUDGET[f], f + " " + z.each[f] + " > " + W.SIZE_BUDGET[f]);
  }
});

test("V-113b · R-C5 缺席声明：本期不实装 c4/c5，但降权机制已落地（U-5 裁定可追溯）", () => {
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.ok(src.indexOf("U-5") >= 0, "砍 R-C5 的依据必须写在源码里，否则不可追溯");
  assert.strictEqual(/cd\.push\(\["c[45]"/.test(src), false, "c4/c5 本期不应实装");
  // 降权机制（R-C5 里唯一保下来的部分）必须真实存在
  assert.ok(/cd\.find\(x=>x\[0\]!==q\.k\)/.test(src.replace(/\s/g, "")), "ctg.k 降权机制缺失");
  assert.strictEqual(typeof C.selfAllow, "function");
  assert.strictEqual(typeof C.selfOf, "function");
});
