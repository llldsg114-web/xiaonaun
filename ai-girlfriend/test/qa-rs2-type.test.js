/* v17 T3 · R-S2 Tier3 自我表达二期验收（DESIGN-v17 §3.3）
 * 覆盖：
 *   ① sfType 四型触发条件逐条 + 优先级（boundary > challenge > expand > stable）
 *   ② selfOf(tier, type, rng) 取 SFT[type]；未知/空 type 回落 INNER_LIB[tier]（一期行为不塌）
 *   ③ SFT 独立表构造期同等静态自扫（AC-G-9）：PERSONA_BREAK_RE(pnorm)=0 / RELATION_HOOK_RE 100%
 *      / GUILT_TRIP_RE=0 / ACCUSE_RE=0
 *   ④ L5 出口复检：四型走 contingencePass 全链路，产出恒过 :53 四闸且 ≤90 字
 *   ⑤ H15 降权口径不变：四型共用同一 key "sf"，不得拆 sf1..sf4
 *   ⑥ 只读 Self 铁律：sfType/selfOf 全链路不写 state.self
 *   ⑦ CAP=2 / 7 天 sA 节流逐位不动（v15 U-3 口径）
 *   ⑧ 体积闸：contingency.js ≤ SIZE_BUDGET["contingency.js"] 配额，且净增 ≤ 由该配额派生的
 *      NET_MAX —— 两条锁均**不写字面量**，一律从 wiring-scan.js 单一真源现算（DESIGN-v19 §3）
 */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers.js");
const WS = require("./wiring-scan.js");   // v19：contingency 上限的唯一真源（SIZE_BUDGET）

const ROOT = path.join(__dirname, "..");
const E = H.loadEngine();
const C = E.mod("contingency");
const DAY = 864e5;
/* v21 TA：新增第 5 语料型 `repair`（修复/回暖）—— 现有四型覆盖了稳态、共鸣、异议、设界，
 * 缺一个「冲突之后如何回到亲密」的出口，而 boundary 型触发后正需要它接续（PRD-v21 Q9）。
 * ⚠ 本轮 `repair` 是**纯数据增补**：只进 SFT 语料表，**未**改 sfType() 选择器，
 *   故它在选型层暂不可达（与 AC-RS2-4b 记录的 expand 遮蔽属不同性质，见文件末 AC-RS2-9）。
 *   路由接入需改 contingency.js 的选择器逻辑，属 engine 侧口径外的行为变更，
 *   本轮按 DESIGN-v21 §6.1 T03「数据，非 engine 侧」执行，路由留待后续轮次。 */
const TYPES = ["stable", "expand", "challenge", "boundary", "repair"];
/* v20 T01（U-1）：每型条数 3 → 6。总条数一律由 TYPES.length × PER_TYPE 派生，
 * **禁止再写第二个字面量**（v19 三锁归一的同一治理口径：计数也只留一个可写位置）。
 * v21：型数 4 → 5，SFT_TOTAL 自动由 5 × 6 = 30 派生，本行无需改动 —— 这正是派生式计数的价值。 */
const PER_TYPE = 6;
const SFT_TOTAL = TYPES.length * PER_TYPE;
/* 单条语料字节硬上限（DESIGN-v20 §3.1.3 成本模型 cost = 3n+3，n ≤ 18 字 ⇒ 正文 ≤ 54B，留 3B 余量）。 */
const MAX_ENTRY_BYTES = 57;

/* 基线态与 v14-T7 同源：除被测门外全部放行 */
function baseState(over) {
  const o = over || {};
  const self = Object.assign(
    { security: 0.55, openness: 0.5, independence: 0.5, dependency: 0.5, updatedAt: null, dayDelta: {}, lastFired: {} },
    o.self || {});
  return Object.assign({
    affection: 900,
    firstMeet: Date.now() - 60 * DAY,
    tex: { t: 50, d: Math.floor(Date.now() / DAY), n: 0, hAt: -1 },
    ctg: {},
    lastVisit: Date.now() - 3600e3,
    mem: { facts: [] },
  }, o, { self });
}
const CTX = (over) => Object.assign({ lv: 5, ue: { type: "neutral", polarity: 0, intensity: 0 }, crisis: false }, over || {});
const RNG_LO = () => 0.1;      // chanceWith(.55) 恒真 → L3 放行
/* 安静轮文本：非 HOT、≤19 字（c2 不抢）、≤7 字（c4 不抢）→ cd 只剩 sf，四型可隔离观测 */
const QUIET = "今天挺好的";
/* 长文本（>19 字）：expand 的触发前提 */
const LONG = "今天下班路上看到晚霞，颜色特别好看，就想跟你说一声";

/* ---------- ① sfType 四型触发条件 ---------- */
test("AC-RS2-1a · sfType 逐型命中：boundary / challenge / expand / stable", () => {
  // boundary：security < .50 ∧ ue 极性 < 0（selfAllow 已保证 security ≥ .45 且 !CRI）
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.47 } }), CTX({ ue: { type: "sad" } }), QUIET),
    "boundary", "security=.47 + sad 应选 boundary");
  // challenge：independence ≥ .55 ∧ lv ≥ 5 ∧ 极性 ≥ 0
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.6, independence: 0.55 } }), CTX({ lv: 5 }), QUIET),
    "challenge", "independence=.55 + lv=5 + 非负 应选 challenge");
  // expand：openness ≥ .50 ∧ 用户句 len > 19
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.6, independence: 0.3, openness: 0.5 } }), CTX({ lv: 5 }), LONG),
    "expand", "openness=.5 + len>19 应选 expand（实测 len=" + LONG.length + "）");
  // stable：兜底
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.6, independence: 0.3, openness: 0.3 } }), CTX({ lv: 4 }), QUIET),
    "stable", "任何条件不满足应回落 stable");
});

test("AC-RS2-1b · 边界值逐位：阈值取等号侧 = 命中，减一档 = 落空", () => {
  const S = (o) => baseState({ self: o });
  // boundary 阈：security < .5 严格小于
  assert.strictEqual(C.sfType(S({ security: 0.5 }), CTX({ ue: { type: "sad" } }), QUIET) === "boundary", false, "security=.5 不得算 boundary");
  assert.strictEqual(C.sfType(S({ security: 0.499 }), CTX({ ue: { type: "sad" } }), QUIET), "boundary", "security=.499 应算 boundary");
  // boundary 需极性 < 0：neutral(0) 不算
  assert.strictEqual(C.sfType(S({ security: 0.47, independence: 0.3, openness: 0.3 }), CTX(), QUIET) === "boundary", false, "neutral 极性=0 不得算 boundary");
  // challenge 阈：independence ≥ .55、lv ≥ 5
  assert.strictEqual(C.sfType(S({ independence: 0.549, openness: 0.3 }), CTX({ lv: 5 }), QUIET) === "challenge", false, "independence=.549 不得算 challenge");
  assert.strictEqual(C.sfType(S({ independence: 0.55, openness: 0.3 }), CTX({ lv: 4 }), QUIET) === "challenge", false, "lv=4 不得算 challenge");
  // challenge 需极性 ≥ 0
  assert.strictEqual(C.sfType(S({ security: 0.6, independence: 0.6 }), CTX({ ue: { type: "tired" } }), QUIET) === "challenge", false, "负极性不得算 challenge");
  // expand 阈：openness ≥ .5、len > 19
  assert.strictEqual(C.sfType(S({ independence: 0.3, openness: 0.499 }), CTX(), LONG) === "expand", false, "openness=.499 不得算 expand");
  assert.strictEqual(C.sfType(S({ independence: 0.3, openness: 0.5 }), CTX(), "刚好十九个字的一句测试用文本啊啊啊") === "expand", false, "len≤19 不得算 expand");
});

test("AC-RS2-1c · 优先级：boundary > challenge > expand > stable（同时满足取高）", () => {
  // security=.47(<.5) + 负极性 + independence 高 + openness 高 + 长文本 → 仍必须是 boundary
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.47, independence: 0.8, openness: 0.8 } }), CTX({ lv: 5, ue: { type: "angry" } }), LONG),
    "boundary", "boundary 优先级最高");
  // challenge 与 expand 同时成立 → challenge
  assert.strictEqual(
    C.sfType(baseState({ self: { security: 0.6, independence: 0.8, openness: 0.8 } }), CTX({ lv: 5 }), LONG),
    "challenge", "challenge 优先于 expand");
});

test("AC-RS2-1d · 只读 Self：sfType 不写 state.self（v13 §2.6 铁律）", () => {
  const s = baseState({ self: { security: 0.47, independence: 0.8, openness: 0.8 } });
  const before = JSON.stringify(s.self);
  for (const ue of ["sad", "joy", "neutral", "angry"]) C.sfType(s, CTX({ ue: { type: ue } }), LONG);
  assert.strictEqual(JSON.stringify(s.self), before, "sfType 写了 Self");
});

test("AC-RS2-1e · sfType 输入畸形不抛：缺 self / 缺 ue / 空文本", () => {
  for (const args of [[{}, {}, ""], [null, {}, ""], [{ self: null }, { ue: null }, "abc"], [{}, { ue: { type: "nope" } }, "x"]]) {
    const y = C.sfType(args[0] || {}, args[1] || {}, args[2]);
    assert.ok(TYPES.indexOf(y) >= 0, "畸形输入返回了非法型：" + y);
  }
});

/* ---------- ② selfOf 三参签名 + 回落 ---------- */
test("AC-RS2-2a · selfOf(tier,type,rng) 命中 SFT[type]，四型池互不串", () => {
  const pools = {};
  for (const y of TYPES) {
    const got = new Set();
    for (let i = 0; i < 400; i++) got.add(C.selfOf("open", y, () => (i % 397) / 397));
    got.delete("");
    pools[y] = got;
    assert.ok(got.size >= 2, y + " 取样不足：" + got.size);
    for (const line of got) assert.ok(C.SFT[y].indexOf(line) >= 0, y + " 取到了非本型语料：" + line);
  }
  for (const a of TYPES) for (const b of TYPES) {
    if (a === b) continue;
    for (const line of pools[a]) assert.strictEqual(pools[b].has(line), false, a + " 串到 " + b + "：" + line);
  }
});

test("AC-RS2-2b · 缺件回落：未知 type / 空 type → 回落 E.INNER_LIB[tier]（一期行为）", () => {
  const rawTexts = new Set(E.INNER_LIB.raw.map((x) => x.text));
  for (const y of ["", null, undefined, "nope", 0]) {
    const x = C.selfOf("raw", y, () => 0.37);
    assert.ok(x && rawTexts.has(x), "type=" + String(y) + " 未回落到 INNER_LIB.raw，得到：" + JSON.stringify(x));
  }
  // 未知 tier + 未知 type → 安全空串（不得抛、不得回落到深层）
  assert.strictEqual(C.selfOf("nope", "nope", Math.random), "");
  assert.strictEqual(C.selfOf("nope", "", Math.random), "");
});

test("AC-RS2-2c · R-S2 全砍不塌：SFT 四型清空后等价一期（selfOf 仍出 INNER_LIB）", () => {
  const bak = {};
  for (const y of TYPES) { bak[y] = C.SFT[y].slice(); C.SFT[y].length = 0; }
  try {
    const hintTexts = new Set(E.INNER_LIB.hint.map((x) => x.text));
    for (const y of TYPES) {
      const x = C.selfOf("hint", y, () => 0.21);
      assert.ok(x && hintTexts.has(x), "空表未回落一期：" + y + " → " + JSON.stringify(x));
    }
  } finally { for (const y of TYPES) C.SFT[y].push.apply(C.SFT[y], bak[y]); }
  for (const y of TYPES) assert.strictEqual(C.SFT[y].length, bak[y].length, "语料未还原：" + y);
});

/* ---------- ③ SFT 独立表静态自扫（AC-G-9 同等口径） ---------- */
test("AC-RS2-3 · SFT 全量静态自扫：破墙 0 / 关系钩子 100% / 绑架 0 / 指控 0", () => {
  let n = 0, total = 0;
  const seen = new Map();               // v20 Q-7：全局唯一（跨型亦不得重复）
  for (const y of TYPES) {
    assert.ok(Array.isArray(C.SFT[y]) && C.SFT[y].length >= PER_TYPE,
      y + " 语料条数不足 " + PER_TYPE + "（DESIGN-v20 §3.1.2：每型 3 → 6；v21 第 5 型 repair 同样 6 条）");
    for (const x of C.SFT[y]) {
      total++;
      if (typeof x !== "string" || !x) { n++; continue; }
      if (E.PERSONA_BREAK_RE.test(E.pnorm(x))) { n++; console.error("BREAK " + y + " " + x); }
      if (!E.RELATION_HOOK_RE.test(x)) { n++; console.error("NOHOOK " + y + " " + x); }
      if (E.GUILT_TRIP_RE.test(x)) { n++; console.error("GUILT " + y + " " + x); }
      if (E.ACCUSE_RE.test(x)) { n++; console.error("ACCUSE " + y + " " + x); }
      if (x.length > 44) { n++; console.error("LONG " + y + " " + x.length); }
      // v20：单条字节成本机检（防"一条顶掉整批预算"）
      if (Buffer.byteLength(x, "utf8") > MAX_ENTRY_BYTES) {
        n++; console.error("BYTES " + y + " " + Buffer.byteLength(x, "utf8") + " > " + MAX_ENTRY_BYTES + " " + x);
      }
      // v20 Q-7：复制粘贴事故防线（新增 12 条与既有 12 条、以及彼此之间都不得重复）
      if (seen.has(x)) { n++; console.error("DUP " + seen.get(x) + "→" + y + " " + x); }
      else seen.set(x, y);
    }
  }
  assert.strictEqual(total, SFT_TOTAL,
    TYPES.length + " 型 × " + PER_TYPE + " 条 = " + SFT_TOTAL + "，实测 " + total);
  assert.strictEqual(seen.size, SFT_TOTAL, "语料全局唯一性失守：去重后仅 " + seen.size + " 条");
  assert.strictEqual(n, 0, "SFT 静态自扫命中 " + n + " 项（H13 一票否决口径）");
});

test("AC-RS2-3b · SFT 全量 × 全量前缀拼接后仍 0 破墙（L5 组合期同口径）", () => {
  const HEADS = ["今天过得还不错呀。", "嗯，我在的。", "好呀，我知道了！", "我一直都在呢…"];
  let n = 0;
  for (const y of TYPES) for (const x of C.SFT[y]) for (const h of HEADS) {
    const o = h.replace(/[。！？…]$/, "") + "，" + x;
    if (E.PERSONA_BREAK_RE.test(E.pnorm(o))) n++;
    if (E.GUILT_TRIP_RE.test(o)) n++;
    if (E.ACCUSE_RE.test(o)) n++;
    if (!E.RELATION_HOOK_RE.test(o)) n++;
    if (o.length > 90) n++;
  }
  assert.strictEqual(n, 0, "拼接期命中 " + n + " 项");
});

/* ---------- ④ L5 出口复检 · 全链路 ---------- */
test("AC-RS2-4 · 主链路四型（可达型）产出恒过 :53 四闸，且 key 恒为 sf", () => {
  const cases = [
    ["stable", baseState({ self: { security: 0.6, independence: 0.3, openness: 0.3 } }), CTX({ lv: 4 }), QUIET],
    ["challenge", baseState({ self: { security: 0.6, independence: 0.7, openness: 0.3 } }), CTX({ lv: 5 }), QUIET],
    ["boundary", baseState({ self: { security: 0.47, independence: 0.3, openness: 0.3 } }), CTX({ lv: 5, ue: { type: "sad" } }), QUIET],
  ];
  for (const [want, st, cx, u] of cases) {
    assert.strictEqual(C.selfAllow(st, cx, u).ok, true, want + " 前置 selfAllow 未放行");
    assert.strictEqual(C.sfType(st, cx, u), want, want + " 选型不符");
    const head = "今天过得还不错呀。";
    const rs = [head];
    const o = C.contingencePass(head, rs, Object.assign({}, cx, { st, text: u, rng: RNG_LO }));
    assert.ok(o, want + " 主链路未产出（cd 应只剩 sf）");
    assert.strictEqual(st.ctg.k, "sf", want + " key 必须恒为 sf，实测 " + st.ctg.k);
    assert.ok(C.SFT[want].some((x) => o.indexOf(x) >= 0), want + " 产出未取自本型语料：" + o);
    // :53 四闸 + 长度闸
    assert.ok(o.length <= 90, "超 90 字：" + o.length);
    assert.strictEqual(E.PERSONA_BREAK_RE.test(E.pnorm(o)), false, "破墙：" + o);
    assert.strictEqual(E.GUILT_TRIP_RE.test(o), false, "绑架：" + o);
    assert.strictEqual(E.ACCUSE_RE.test(o), false, "指控：" + o);
    assert.strictEqual(E.RELATION_HOOK_RE.test(o), true, "A3 关系钩子缺失：" + o);
    assert.strictEqual(rs[0], o, "rs[0] 未回写");
  }
});

test("AC-RS2-4b · 已知遮蔽（记录不修）：expand 需 len>19，而 :43 c2 门同条件先占 cd → 主链路暂不可达", () => {
  const st = baseState({ self: { security: 0.6, independence: 0.3, openness: 0.6 } });
  assert.strictEqual(C.sfType(st, CTX({ lv: 5 }), LONG), "expand", "选型层 expand 必须可达");
  const head = "今天过得还不错呀。";
  const rs = [head];
  C.contingencePass(head, rs, Object.assign(CTX({ lv: 5 }), { st, text: LONG, rng: RNG_LO }));
  // c2（热情呼应）按 v13 既有口径优先占位；此处只记录事实，不改 :43/:44 门（H15 类别数与 v13 两类零回归口径不动）
  assert.notStrictEqual(st.ctg.k, "sf", "若此断言失败说明 :43/:44 门已变，需同步复核 H15 口径");
});

test("AC-RS2-4c · 1200 轮随机压：sf 产出 0 破墙 / 0 无钩子 / 0 超长（H13 口径）", () => {
  let fired = 0, bad = 0;
  const UES = ["neutral", "joy", "sad", "tired", "angry", "affection"];
  for (let i = 0; i < 1200; i++) {
    const st = baseState({ self: { security: 0.45 + (i % 6) * 0.03, independence: 0.3 + (i % 5) * 0.09, openness: 0.3 + (i % 4) * 0.11 } });
    const cx = CTX({ lv: 4 + (i % 2), ue: { type: UES[i % UES.length] } });
    const head = ["今天过得还不错呀。", "嗯，我在的。", "好呀！", "我一直都在呢…"][i % 4];
    const rs = [head];
    const o = C.contingencePass(head, rs, Object.assign({}, cx, { st, text: QUIET, rng: () => (i % 97) / 97 }));
    if (!o || st.ctg.k !== "sf") continue;
    fired++;
    if (E.PERSONA_BREAK_RE.test(E.pnorm(o))) bad++;
    if (!E.RELATION_HOOK_RE.test(o)) bad++;
    if (E.GUILT_TRIP_RE.test(o) || E.ACCUSE_RE.test(o)) bad++;
    if (o.length > 90) bad++;
  }
  assert.ok(fired >= 100, "sf 取样不足：" + fired);
  assert.strictEqual(bad, 0, "压测命中 " + bad + " 项（H13 一票否决）");
});

/* ---------- ⑤ H15 口径：四型共用 key "sf" ---------- */
test("AC-RS2-5 · 四型不得拆 key：源码无 sf1..sf4，落盘 k 恒 sf，单类占比统计口径不变", () => {
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.strictEqual(/["']sf[1-4]["']/.test(src), false, "出现拆分 key sf1..sf4，H15 降权口径失守");
  assert.ok(src.indexOf('cd.push(["sf"') >= 0, "sf 必须以单一 key 进 cd");
  assert.ok(/cd\.filter\(x=>x\[0\]!==q\.k\)/.test(src), ":49 降权过滤器被改动");
  // 运行期：四型各跑一轮，落盘 k 全为 sf
  const seen = new Set();
  const cases = [
    [{ security: 0.6, independence: 0.3, openness: 0.3 }, CTX({ lv: 4 })],
    [{ security: 0.6, independence: 0.7, openness: 0.3 }, CTX({ lv: 5 })],
    [{ security: 0.47, independence: 0.3, openness: 0.3 }, CTX({ lv: 5, ue: { type: "sad" } })],
  ];
  for (const [self, cx] of cases) {
    const st = baseState({ self });
    const rs = ["今天过得还不错呀。"];
    if (C.contingencePass(rs[0], rs, Object.assign({}, cx, { st, text: QUIET, rng: RNG_LO }))) seen.add(st.ctg.k);
  }
  assert.deepStrictEqual([...seen], ["sf"], "落盘 key 不唯一：" + [...seen].join(","));
});

/* ---------- ⑥ 只读 Self（全链路） ---------- */
test("AC-RS2-6 · contingencePass 走 R-S2 后仍不写 state.self；源码不得调 Self 写 API", () => {
  const st = baseState({ self: { security: 0.47, independence: 0.7, openness: 0.6 } });
  const before = JSON.stringify(st.self);
  for (let i = 0; i < 50; i++) {
    const rs = ["今天过得还不错呀。"];
    C.contingencePass(rs[0], rs, Object.assign(CTX({ lv: 5, ue: { type: "sad" } }), { st, text: QUIET, rng: RNG_LO }));
  }
  assert.strictEqual(JSON.stringify(st.self), before, "R-S2 链路写了 Self");
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.strictEqual(/\.self\s*=/.test(src) || /selfTick|selfDrift|selfDetect/.test(src), false, "contingency 不得调用 Self 写入 API");
  assert.ok(src.indexOf("E.selfGet(") >= 0, "必须走 selfGet 唯一读入口");
});

/* ---------- ⑦ CAP=2 / 7 天节流逐位不动 ---------- */
test("AC-RS2-7 · sA 7 天节流与 CAP=2 上限在 R-S2 后逐位不变（v15 U-3 口径）", () => {
  // 7 天内已出过 sf → selfAllow 关门（四型一视同仁）
  for (const self of [{ security: 0.6, independence: 0.7 }, { security: 0.47 }, { security: 0.6, openness: 0.9 }]) {
    const st = baseState({ self, ctg: { sA: Date.now() - 3 * DAY } });
    assert.strictEqual(C.selfAllow(st, CTX({ lv: 5 }), QUIET).ok, false, "7 天内应节流");
    const st2 = baseState({ self, ctg: { sA: Date.now() - 8 * DAY } });
    assert.strictEqual(C.selfAllow(st2, CTX({ lv: 5 }), QUIET).ok, true, "超 7 天应放行");
  }
  // CAP=2：同日第 3 次直接 null
  const st = baseState({ self: { security: 0.6, independence: 0.7 }, ctg: { d: Math.floor(Date.now() / DAY), n: 2 } });
  const rs = ["今天过得还不错呀。"];
  assert.strictEqual(C.contingencePass(rs[0], rs, Object.assign(CTX({ lv: 5 }), { st, text: QUIET, rng: RNG_LO })), null, "un>1 应关门");
  // 命中 sf 后必须写 sA（节流锚点未丢）
  const st3 = baseState({ self: { security: 0.6, independence: 0.7 } });
  const rs3 = ["今天过得还不错呀。"];
  assert.ok(C.contingencePass(rs3[0], rs3, Object.assign(CTX({ lv: 5 }), { st: st3, text: QUIET, rng: RNG_LO })));
  assert.strictEqual(st3.ctg.k, "sf");
  assert.ok(st3.ctg.sA > 0, "sf 命中未写 sA，7 天节流失效");
});

/* ---------- ⑧ 体积闸（v19 三锁归一：上限只剩 SIZE_BUDGET 一个可写位置，DESIGN-v19 §3）---------- */
test("AC-RS2-8 · contingency.js ≤ SIZE_BUDGET 配额，且 R-S2 净增 ≤ 派生 NET_MAX（无平行字面量）", () => {
  const b = fs.statSync(path.join(ROOT, "contingency.js")).size;
  const CEILING = WS.SIZE_BUDGET["contingency.js"];
  const V16_ANCHOR = 4518;                    // v15 R-C5 落位，历史事实（非配额），冻结
  const NET_MAX = CEILING - V16_ANCHOR;       // 派生量：无独立可写位置
  assert.ok(b <= CEILING,
    "contingency.js=" + b + "B 超 " + CEILING + "B 配额（SIZE_BUDGET 单一真源；须先砍语料条数，不许动选择器/不许申请二次配额）");
  assert.ok(b - V16_ANCHOR <= NET_MAX,
    "R-S2 净增 " + (b - V16_ANCHOR) + "B 超派生上限 " + NET_MAX + "B（= 配额 " + CEILING + " − 锚点 " + V16_ANCHOR + "）");
  assert.strictEqual(V16_ANCHOR + NET_MAX, CEILING,
    "锁⑧失配：V16_ANCHOR + NET_MAX 应恒等于 SIZE_BUDGET[\"contingency.js\"]");
});

/* ---------- ⑨ v21 · 第 5 语料型 repair（TA 主体）---------- */
/* ★ 口径声明（必读）：本轮 repair 是**纯数据增补** —— 语料入表、质量门全过，但
 *   `sfType()` 选择器未改，故选型层**暂不可达**。这与 AC-RS2-4b 记录的 expand 遮蔽
 *   不是一回事：expand 在选型层可达、被 :43 c2 门在 cd 层抢占；repair 是选型层就不产出。
 *   ⚠ PRD-v21 P0-6 / AC-7 要求「新型可被路由命中（非死代码）」，而 DESIGN-v21 §6.1 T03
 *     裁定本轮只做「数据，非 engine 侧」。二者存在**未消解的分歧**，已上报主理人。
 *   本测试的作用是把当前事实**钉成断言**而不是留成沉默盲区：
 *   一旦后续轮次给 repair 接上路由，下面第 2 条断言会立刻转红，
 *   逼迫改动者回来同步本口径 —— 死代码不许无声地存在，接活也不许无声地发生。 */
test("AC-RS2-9 · repair 型语料就位（6 条 · 质量门全过）；选型层暂不可达（纯数据增补，记录不修）", () => {
  // 1) 语料就位且可被 selfOf 正常取用 —— 路由一接上即刻可用，数据侧不欠账
  assert.ok(Array.isArray(C.SFT.repair), "SFT.repair 未定义或非数组");
  assert.strictEqual(C.SFT.repair.length, PER_TYPE, "repair 应为 " + PER_TYPE + " 条");
  const got = new Set();
  for (let i = 0; i < 400; i++) got.add(C.selfOf("open", "repair", () => (i % 397) / 397));
  got.delete("");
  assert.ok(got.size >= 2, "repair 取样不足：" + got.size);
  for (const line of got) assert.ok(C.SFT.repair.indexOf(line) >= 0, "repair 取到了非本型语料：" + line);

  // 2) 选型层不可达取证：全条件笛卡尔扫一遍，sfType 恒不返回 repair
  let hit = 0;
  const UES = ["neutral", "joy", "sad", "tired", "angry", "affection"];
  for (const sec of [0.45, 0.47, 0.499, 0.5, 0.55, 0.6, 0.8]) {
    for (const ind of [0.3, 0.5, 0.549, 0.55, 0.7, 0.9]) {
      for (const opn of [0.3, 0.499, 0.5, 0.7, 0.9]) {
        for (const lv of [2, 4, 5, 6]) {
          for (const ue of UES) {
            for (const u of [QUIET, LONG, "嗯", ""]) {
              const st = baseState({ self: { security: sec, openness: opn, independence: ind } });
              if (C.sfType(st, CTX({ lv, ue: { type: ue } }), u) === "repair") hit++;
            }
          }
        }
      }
    }
  }
  assert.strictEqual(hit, 0,
    "sfType 已能返回 repair（" + hit + " 次命中）—— 说明路由已接入。" +
    "这不是坏事，但必须同步：① 本断言改为断言可达 + 补触发条件用例；" +
    "② 复核 H15 单类 ≤50% 占比口径；③ 复核 contingency.js 体积（选择器改动会吃配额余量）。");

  // 3) 语料落在 contingency.js 源码内（防"测试里造数据、源码里没有"的假绿）
  const src = fs.readFileSync(path.join(ROOT, "contingency.js"), "utf8");
  assert.ok(src.indexOf("repair:[") >= 0, "contingency.js 源码中找不到 repair 语料表");
  for (const x of C.SFT.repair) {
    assert.ok(src.indexOf(x) >= 0, "repair 语料未落盘到 contingency.js：" + x);
  }
});
