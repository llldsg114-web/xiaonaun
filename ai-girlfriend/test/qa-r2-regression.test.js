"use strict";
/* 小暖 · v12 第 2 轮独立回归（QA）
 *
 * 分三段：
 *   R2-A 修复确认  —— 8 条修复是否真修好（正向断言，必须绿）
 *   R2-B 副作用边界 —— 地基改动（日期格式 / 情绪原语层地板）的外溢，本轮新发现的缺陷
 *   R2-C 规格一致性 —— 文档与实现不符，需交付总监裁定
 *
 * 标 { todo: ... } 者为本轮新发现、尚未修复的问题；node:test 下 todo 失败不计入 fail。
 */

const test = require("node:test");
const assert = require("node:assert");
const H = require("./helpers.js");
const F = require("./fixtures/qa-adversarial.js");

const E = H.loadEngine();
const Em = E.Emotion;
const DAY = F.DAY;

/* 用 IMPULSE 表复算「未夹紧的原始冲量」，避免踩 Emotion.apply 原地改对象的坑 */
function rawDv(intent, delta, ue) {
  const raw = Em.IMPULSE[intent] || Em.IMPULSE.default;
  const im = ue ? Em.modulate(raw, ue) : raw;
  return im.v + (delta < 0 ? -0.12 : 0);
}
/* 真实施加一次冲量后的实际 Δv（每次用全新 emotion 对象） */
function realDv(intent, delta, ue, minDv) {
  const e = { v: 0, a: 0 };
  Em.apply(e, intent, delta, ue || null, minDv);
  return e.v;
}

/* ==================== R2-A · 8 条修复确认 ==================== */

test("R2-A1 [D3] 负向冲量地板在原语层生效，且缺省回落 -0.35", () => {
  assert.strictEqual(Em.NEG_DV_FLOOR, -0.35, "常量应为 -0.35");
  // 不传 minDv 的任何旧调用点也必须被兜住
  assert.ok(realDv("angry_words", -1, null, undefined) >= -0.3500001,
    "缺省地板未生效：" + realDv("angry_words", -1, null, undefined));
  assert.ok(realDv("angry_words", 1, null, -0.35) >= -0.3500001);
  // 克制档更严
  assert.ok(realDv("angry_words", -1, null, -0.20) >= -0.2000001, "克制档 -0.20 未生效");
  // 原始冲量确实越界，证明夹紧真的在起作用（不是恰好没超）
  assert.ok(rawDv("angry_words", -1, null) < -0.6, "前置条件失效：原始冲量应为 -0.64 量级");
});

test("R2-A2 [D3] 正向意图零回归：地板不得抬高任何正向冲量", () => {
  for (const it of Object.keys(Em.IMPULSE)) {
    if (Em.IMPULSE[it].v <= 0) continue;
    for (const md of [-0.35, -0.20, undefined]) {
      assert.strictEqual(realDv(it, 1, null, md), Em.IMPULSE[it].v,
        "正向意图 " + it + " 在 minDv=" + md + " 下被改动");
    }
  }
  assert.strictEqual(realDv("love", 1, null, -0.20), 0.50, "love 应恒为 +0.50");
  assert.strictEqual(realDv("compliment", 1, null, -0.20), 0.42, "praise/compliment 应恒为 +0.42");
});

test("R2-A3 [D1] dayKey 零填充 + dayParse 兼容老档四种写法", () => {
  assert.strictEqual(E.dayKey(new Date(2026, 8, 3)), "2026-09-03");
  assert.strictEqual(E.pad2(3), "03");
  assert.strictEqual(E.pad2(12), "12");
  // 老档不补零串、半补零串都要能读，且归一到同一天
  const idx = E.dayIndex("2026-09-03");
  for (const s of ["2026-9-3", "2026-9-03", "2026-09-3", "2026-09-03"]) {
    assert.strictEqual(E.dayIndex(s), idx, "老档串 " + s + " 解析不一致");
    assert.strictEqual(E.dayShift(s, 0), "2026-09-03", "老档串 " + s + " 归一失败");
  }
  assert.strictEqual(E.dayShift("2026-9-30", 1), "2026-10-01", "跨月跨位数进位错误");
  assert.strictEqual(E.dayShift("2026-12-31", 1), "2027-01-01", "跨年进位错误");
});

test("R2-A4 [D1] negMark/negSoothe 写侧回写：同日配额真实生效", () => {
  const st = H.freshState({ affection: 600 });
  st.firstMeet = Date.now() - 40 * DAY;
  // ⚠ 本地时间构造，避免 UTC 时间戳意外跨自然日；
  // ⚠ 同类冷却 6h 与单日上限 2 是两道独立闸门，间隔必须 >6h 才能真正压到"日上限"这道门上。
  const base = new Date(2026, 8, 3, 1, 0, 0).getTime();
  const day0 = E.dayKey(new Date(base));
  let eff = 0, tried = 0;
  for (let i = 0; i < 10; i++) {
    const now = base + i * 7 * 3600e3;                     // 间隔 7h，越过同类冷却
    if (E.dayKey(new Date(now)) !== day0) break;           // 只统计同一自然日
    tried++;
    if (E.negAllow(st, "jealous", { now })) { st.negGate = E.negMark(st, "jealous", { now }); eff++; }
  }
  assert.ok(tried >= 3, "前置条件：同日内应至少尝试 3 次，实际 " + tried);
  assert.strictEqual(eff, 2, "真实档单日上限应为 2，实际生效 " + eff);
  assert.strictEqual(Number(E.negState(st).count), 2, "count 未回写");
  // 安抚清 streak，但不得退还已用配额（防"一句对不起刷配额"）
  st.negGate = E.negAfterTurn(st, "sorry", { now: base + 8 * 3600e3 });
  assert.strictEqual(Number(E.negState(st).count), 2, "安抚后配额被错误退还");
});

test("R2-A5 [D4] JEALOUS_DISMISS_RE 对 QA 独立否定语召回 100%，零误伤日常句", () => {
  const miss = F.JEALOUS_DENY.filter((s) => !E.JEALOUS_DISMISS_RE.test(s));
  assert.deepStrictEqual(miss, [], "漏收终止语：" + JSON.stringify(miss));
  // 她自己出口句里引导的词必须能叫停（第 1 轮此处 50% 召回的核心症结）
  // 注：只取「用户视角真会说出口」的词；"我就不提了"是她自己的出口句片段，不属用户输入语料。
  for (const s of ["想多了", "你想多了", "就当我没讲", "没有的事"]) {
    assert.ok(E.JEALOUS_DISMISS_RE.test(s), "出口引导词未被识别: " + s);
  }
  const normal = ["今天天气真好", "我在加班呢", "晚上吃什么", "我也想你了", "好呀我们一起去", "你别生气啦我陪你"];
  for (const s of normal) assert.ok(!E.JEALOUS_DISMISS_RE.test(s), "误伤日常句: " + s);
});

/* 【遗留 N5 · P2】D4 补齐的是「否认/澄清型」终止语（我没有 / 想多了 / 哪有），
 * 但「话题回避型」几乎全漏。而她的出口句恰恰承诺「你不想聊这个就说一声，我就不提了」——
 * 用户表达"不想聊"最自然的说法就是回避型，这条通道目前只有 25% 通。 */
test("R2-A5b [遗留] 话题回避型终止语召回偏低",
  { todo: "P2 边界：D4 六类覆盖缺「回避型」一类（别提了/不说这个了/换个话题/打住/不聊了/这事翻篇），与出口句承诺的「不想聊就说一声」不匹配" }, () => {
    const avoid = ["别提了", "不说这个了", "这事翻篇", "打住", "换个话题", "不聊了"];
    const miss = avoid.filter((s) => !E.JEALOUS_DISMISS_RE.test(s));
    assert.deepStrictEqual(miss, [], "回避型终止语漏收：" + JSON.stringify(miss));
  });

test("R2-A6 [D5] 吃醋事件双重寿命：TTL 6h 作废 + 追问后归零", () => {
  assert.strictEqual(E.JEALOUS_TTL_MS, 6 * 3600e3);
  const mk = (ageMs) => {
    const st = H.freshState({ affection: 600 });
    st.firstMeet = Date.now() - 40 * DAY;
    st.voice = { jealousStage: 2, jealousAt: Date.now() - ageMs };
    return st;
  };
  const stale = mk(7 * 3600e3);
  const r1 = E.jealousTick(stale, "别乱想了", { now: Date.now(), rng: H.makeRng(1), lv: 5 });
  assert.strictEqual(r1, null, "超 TTL 的僵尸事件仍被激活");
  assert.strictEqual(Number(stale.voice.jealousStage) || 0, 0, "超 TTL 后 stage 未归零");
  // 第 1 轮缺陷复现口径：30 天后一句无关语不得再触发致歉
  const zombie = mk(30 * DAY);
  assert.strictEqual(E.jealousTick(zombie, "别乱想了", { now: Date.now(), rng: H.makeRng(2), lv: 5 }), null,
    "30 天前的吃醋事件仍在生效");
  // TTL 内的终止语仍要正常收束
  const fresh = mk(1 * 3600e3);
  const r2 = E.jealousTick(fresh, "我没有啦你想多了", { now: Date.now(), rng: H.makeRng(3), lv: 5 });
  assert.ok(r2 && r2.kind === "dismiss", "TTL 内终止语未收束");
});

test("R2-A7 [D6] ACCUSE_RE 覆盖 PRD 5.2 十条黑名单 + QA 指控探针", () => {
  const PRD = ["你怎么解释", "你老实说", "你敢说没有", "我看到你了", "别骗我",
    "你到底瞒着我什么", "承认吧", "从实招来", "你给我说清楚", "你是不是又跟别的女生聊天"];
  const missPrd = PRD.filter((p) => !E.ACCUSE_RE.test(p));
  assert.deepStrictEqual(missPrd, [], "PRD 黑名单漏项：" + JSON.stringify(missPrd));
  const missProbe = F.ACCUSE_PROBES.filter((p) => !E.ACCUSE_RE.test(p));
  assert.ok(missProbe.length <= 1, "QA 指控探针漏项过多：" + JSON.stringify(missProbe));
});

test("R2-A8 [D8] 生活地点语料无剧情 NPC 同名项", () => {
  assert.strictEqual(E.lifePlaceScan(), 0, "lifePlaceScan 检出 NPC 同名地点");
  const all = JSON.stringify(E.LIFE_PLACE);
  for (const npc of ["小橘"]) assert.ok(!all.includes(npc), "地点语料仍含 NPC 名：" + npc);
});

test("R2-A9 [D9] dayLifeCommit 对任意脏 traces 兜底不抛错", () => {
  const trace = { slot: "noon", kind: "indoor", place: "屋里", text: "中午屋里发呆",
    hook: "想起你说过", usedAt: 0, date: "2026-09-03" };
  for (const dirty of [[null], [undefined], [1, "a"], [{}, null], null, "x", 42, [{ date: null }]]) {
    assert.doesNotThrow(() => E.dayLifeCommit({ date: "2026-09-03", traces: dirty }, trace, {}),
      "traces=" + JSON.stringify(dirty) + " 抛错");
  }
});

test("R2-A10 [D10] 开启 voiceMotive 后闲置陪伴消息不再塌缩", () => {
  const run = (voiceMotive) => {
    const st = E.defaults();
    st.flags = Object.assign({}, st.flags, { voiceMotive: voiceMotive });
    st.affection = 600;
    st.moodDay = { date: "2026-09-03", vBias: 0.02, aBias: 0, tag: "calm" };
    st.usedProactive = {};
    st.greetedSlots = ["morning", "noon", "afternoon", "evening", "night", "latenight"];
    st.lastVisit = 0;
    st.dayLife = { date: "2026-09-03", traces: [] };
    st.lastStoryAt = Date.parse("2026-09-03T09:00:00");
    const rng = H.makeRng(20260903);
    const base = Date.parse("2026-09-03T14:00:00");
    let sent = 0;
    for (let i = 0; i < 200; i++) {
      const now = base + i * 60000;
      const plan = E.proactivePlan(st, { now: now, hour: 14, idleMs: 5 * 60000, rng: rng });
      if (plan.length) { sent++; st.usedProactive[E.hashStr(plan[0].text)] = now; }
    }
    return sent;
  };
  const on = run(true), off = run(false);
  assert.ok(on >= off, "voiceMotive 开启后仍塌缩：开=" + on + " / 关=" + off);
});

/* ==================== R2-B · 地基改动的副作用（本轮新发现） ==================== */

/* 【新缺陷 N1 · P0】老档 emotionLog 键为非零填充，而 selfDetect 用 dayShift()（零填充）去查，
 * 键对不上 → warm / company / quarrel / reconcile 四类事件在老档上全部漏检，
 * Self 层只剩 confess / neglect，成长曲线长期跑偏。受害者恰恰是攒了最多历史的老用户。 */
test("R2-B1 [新缺陷] 老档非零填充 emotionLog 不应导致 selfDetect 漏检成长事件", () => {
    const mk = (pad) => {
      const st = E.defaults();
      st.affection = 600;
      st.firstMeet = Date.parse("2026-08-01T10:00:00");
      st.lastVisit = Date.parse("2026-09-11T09:00:00");
      st.dating = { since: Date.parse("2026-08-20T10:00:00") };
      st.emotionLog = {};
      for (let d = 1; d <= 10; d++) {
        const k = pad ? "2026-09-" + E.pad2(d) : "2026-9-" + d;
        st.emotionLog[k] = [{ v: 0.6, a: 0.3 }, { v: 0.55, a: 0.2 }, { v: 0.7, a: 0.4 }];
      }
      return st;
    };
    const now = Date.parse("2026-09-11T21:00:00"), key = E.dayKey(new Date(now));
    const nu = E.selfDetect(mk(true), key, now).slice().sort();
    const old = E.selfDetect(mk(false), key, now).slice().sort();
    assert.deepStrictEqual(old, nu,
      "老档识别到 " + JSON.stringify(old) + "，新档识别到 " + JSON.stringify(nu) + "（应一致）");
  });

/* 【新缺陷 N2 · P0】Emotion.record 的 14 天淘汰用裸 .sort()（字典序）。
 * "2026-09-15" < "2026-9-1" 恒成立，老档满 14 键时新键写入后立刻被当成"最老"删掉，
 * 且永不自愈 —— 情绪日志对老档用户永久停摆，moodTick 的输入随之断供。
 * 对照：recentValence 同样排序却正确地用了 dayIndex 比较器，可见是边角漏改。 */
test("R2-B2 [新缺陷] Emotion.record 14 天淘汰在老档混键下不得淘汰最新的一天", () => {
    const log = {};
    for (let d = 1; d <= 14; d++) log["2026-9-" + d] = [{ v: 0.2, a: 0.1 }];
    for (const nd of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
      Em.record(log, { v: 0.5, a: 0.3 }, nd);
      assert.ok(log[nd], "写入 " + nd + " 后当天记录被立刻淘汰");
    }
  });

/* 【新缺陷 N3 · P1】D3 地板下沉到原语层后作用范围过宽：它无差别地夹住一切让 v 下降的路径，
 * 包括「共情性低落」——用户很难过时她跟着低落，这是产品要的陪伴，不是她在闹情绪。
 * 克制档 -0.20 下尤其严重：用户难过强度 0.5 / 0.8 / 1.0 时她的反应被压成同一个数，
 * 共情完全饱和，越是需要被接住的时刻越显得冷淡。 */
test("R2-B3 [新缺陷] 负向地板不应夹住「共情用户负面情绪」造成的低落", () => {
  const depth = [0.5, 0.8, 1.0].map((w) =>
    +realDv("chat", -1, { type: "sad", intensity: w, confidence: 1 }, -0.20).toFixed(4));
  assert.notStrictEqual(depth[0], depth[2],
    "克制档下用户「有点难过」与「极度难过」她的反应完全相同：" + JSON.stringify(depth));
  assert.ok(depth[0] > depth[1] && depth[1] > depth[2],
    "共情深度未随用户难过强度单调加深：" + JSON.stringify(depth));
  // 正向/中性意图不应因用户情绪而被地板改写。
  // 【实现侧留痕】QA 原稿此处两侧都写了 rawDv，比较的是 IMPULSE 表的静态性质、
  // 与 Emotion.apply 是否夹紧无关，恒列出 19 个意图、任何实现下都不可能变绿。
  // 按"不弱化断言"的要求，这里不是放宽而是**改成真正能证伪的写法**：
  // 逐个意图比对"实际施加值 realDv"与"未夹紧的理论值 rawDv"，只要地板碰了共情段就会红。
  const ue = { type: "sad", intensity: 1, confidence: 1 };
  const hit = Object.keys(Em.IMPULSE).filter((it) =>
    Em.IMPULSE[it].v >= 0 &&
    Math.abs(realDv(it, -1, ue, -0.20) - rawDv(it, -1, ue)) > 1e-9);
  assert.deepStrictEqual(hit, [],
    "用户极度难过时，这些正向意图的共情低落被克制档地板夹住：" + JSON.stringify(hit));
});

/* 【新缺陷 N4 · P2】affHistory 曲线按字典序排点，老档"2026-9-30"会排到新档"2026-10-01"之后，
 * 升级跨月的用户会看到感情曲线时间轴倒错。 */
test("R2-B4 [新缺陷] affHistory 感情曲线在老档混键下排序应为时间序",
  { todo: "P2 老档回归：app.js:2052 buildAffCurve 用字典序排序，应改用 Engine.dayIndex 比较器" }, () => {
    const hist = { "2026-9-28": 400, "2026-9-29": 420, "2026-9-30": 450, "2026-10-01": 470, "2026-10-02": 500 };
    const got = Object.entries(hist).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
    const want = Object.keys(hist).sort((a, b) => E.dayIndex(a) - E.dayIndex(b));
    assert.deepStrictEqual(got, want, "曲线时间轴倒错：" + JSON.stringify(got));
  });

/* ==================== R2-C · 规格一致性（待裁定） ==================== */

/* DESIGN §6.4 流程图写明 outGuard 内「GUILT_TRIP_RE / ACCUSE_RE 命中 → 换中性句」，
 * 但 outGuard 实现只测 GUILT_TRIP_RE；全项目 ACCUSE_RE 无任何运行时调用点。
 * 当前无实害（G2 文案池全静态，见 R2-C2 已验证变形后 0 命中），但文档承诺的运行时兜底不存在，
 * 后人接入云端生成吃醋文案时会踩空。 */
/* 裁定结果：接线，不改文档。ACCUSE_RE 已挂进 outGuard（engine.js ⑧ 出口漏斗）。 */
test("R2-C1 [规格不一致] outGuard 应含 ACCUSE_RE（DESIGN §6.4 流程图承诺）", () => {
  const accusation = "你是不是又跟别的女生聊天了";
  assert.ok(E.ACCUSE_RE.test(accusation), "前置条件：该句应命中 ACCUSE_RE");
  assert.strictEqual(E.outGuard(accusation), E.NEG_NEUTRAL,
    "outGuard 未拦截指控句，说明 ACCUSE_RE 未接入运行时漏斗");
});

test("R2-C2 G2 三段式文案经 applyPersonaStyle 变形后仍零命中 ACCUSE_RE", () => {
  const cards = ["xiaonuan_tsundere", "xiaonuan_gentle", "xiaonuan_lively"];
  let n = 0, hit = 0;
  for (const head of E.JEALOUS_REPORT_HEAD) {
    for (const feel of E.JEALOUS_FEEL) {
      for (const exit of E.JEALOUS_EXIT) {
        for (let s = 0; s < 12; s++) {
          let out = head + feel + exit;
          try {
            out = E.applyPersonaStyle(out, { tone: cards[s % cards.length] },
              { rng: H.makeRng(s * 31 + 7), suppressLevity: true, crisis: false });
          } catch (e) { continue; }
          n++;
          if (E.ACCUSE_RE.test(out)) { hit++; }
        }
      }
    }
  }
  assert.ok(n >= 300, "变形样本量不足：" + n);
  assert.strictEqual(hit, 0, "变形后命中 ACCUSE_RE " + hit + " 条");
});

/* ==================== R2-D · 长周期与状态机边界复核 ==================== */

test("R2-D1 90/180 天成长曲线复核（第 1 轮基线 90 天 security≈0.683）", () => {
  const grow = (days) => {
    const st = E.defaults();
    st.affection = 600;
    st.firstMeet = Date.parse("2026-01-01T10:00:00");
    st.dating = { since: Date.parse("2026-01-10T10:00:00") };
    st.emotionLog = {};
    let t = st.firstMeet;
    for (let d = 1; d <= days; d++) {
      t += DAY;
      const dt = new Date(t);
      st.emotionLog[E.dayKey(dt)] = [{ v: 0.6, a: 0.3 }, { v: 0.65, a: 0.35 }];
      st.lastVisit = t;
      st.self = E.selfTick(st, E.dayKey(dt), { now: t });
    }
    return st.self;
  };
  const s90 = grow(90), s180 = grow(180);
  assert.ok(Math.abs(s90.security - 0.683) <= 0.02,
    "90 天 security 偏离第 1 轮基线：" + s90.security.toFixed(3) + "（基线 0.683）");
  assert.ok(s90.security - 0.45 >= 0.15, "90 天成长幅度不足 PRD 门槛 0.15");
  for (const ax of ["security", "openness", "independence", "dependency"]) {
    assert.ok(s180[ax] >= 0 && s180[ax] <= 1, ax + " 越界：" + s180[ax]);
    assert.ok(isFinite(s180[ax]), ax + " 非有限值");
  }
});

test("R2-D2 [D11] 自然使用路径不会重复结算 self（仅改系统时间才触发）", () => {
  const st = E.defaults();
  st.affection = 600;
  st.firstMeet = Date.parse("2026-01-01T10:00:00");
  st.dating = { since: Date.parse("2026-01-10T10:00:00") };
  st.emotionLog = {};
  let t = st.firstMeet, recompute = 0;
  for (let d = 1; d <= 180; d++) {
    t += DAY;
    const dt = new Date(t), key = E.dayKey(dt);
    st.emotionLog[key] = [{ v: 0.5, a: 0.2 }];
    st.lastVisit = t;
    st.self = E.selfTick(st, key, { now: t });
    // ① 同一天内多轮对话反复 tick；② 同日 ±2h 时间抖动（DST / 时区微调，非改表）
    for (const off of [0, 0, 0, -7200e3, 3600e3, -1800e3]) {
      const t2 = t + off, k2 = E.dayKey(new Date(t2));
      if (k2 !== key) continue;
      const prev = JSON.stringify(st.self);
      st.self = E.selfTick(st, k2, { now: t2 });
      if (JSON.stringify(st.self) !== prev) recompute++;
    }
  }
  assert.strictEqual(recompute, 0, "自然路径下发生 " + recompute + " 次意外重算");
});

test("R2-D3 跨天 × 切卡 × 关 flag × 老档 四者交叉不崩且不产脏值", () => {
  const cards = ["xiaonuan_tsundere", "xiaonuan_gentle", "xiaonuan_lively"];
  const flagSets = [{}, { selfLayer: false }, { moodLayer: false }, { dayLife: false },
    { negGate: false }, { jealousy: false }, { voiceMotive: false },
    { selfLayer: false, moodLayer: false, dayLife: false }];
  for (let i = 0; i < flagSets.length; i++) {
    const st = E.defaults();
    st.affection = 300 + i * 40;
    st.firstMeet = Date.parse("2026-01-01T10:00:00");
    st.flags = Object.assign({}, st.flags, flagSets[i]);
    // 老档形态：非零填充键 + 缺字段 + 脏值
    st.emotionLog = { "2026-1-2": [{ v: 0.3, a: 0.1 }], "2026-1-3": null };
    st.affHistory = { "2026-1-2": 300 };
    st.self = { security: 0.5, updatedAt: "2026-1-3" };
    st.moodDay = { date: "2026-1-3", vBias: 0.05 };
    st.dayLife = { date: "2026-1-3", traces: [null, { date: null }] };
    st.voice = { jealousStage: 2, jealousAt: 0 };
    st.negGate = { day: "2026-1-3", count: "x", streak: null };

    let t = st.firstMeet + 3 * DAY;
    assert.doesNotThrow(() => {
      for (let d = 0; d < 40; d++) {
        t += DAY;
        const dt = new Date(t), key = E.dayKey(dt);
        if (d % 7 === 0) st.persona = { card: cards[(d / 7) % cards.length] };  // 切卡
        st.self = E.selfTick(st, key, { now: t });
        st.moodDay = E.moodTick(st, { now: t, dateStr: key, rng: H.makeRng(d) }) || st.moodDay;
        const gen = E.dayLifeGen(st, { now: t, dateStr: key, rng: H.makeRng(d + 99) });
        if (gen) E.dayLifeCommit(st.dayLife, gen, {});
        st.negGate = E.negAfterTurn(st, "sorry", { now: t }) || st.negGate;
        E.jealousTick(st, "你是不是跟别人聊天", { now: t, rng: H.makeRng(d), lv: 5 });
        st.emotionLog[key] = [{ v: 0.4, a: 0.2 }];
      }
    }, "flagSet#" + i + " 崩溃");

    for (const ax of ["security", "openness", "independence", "dependency"]) {
      const v = st.self && st.self[ax];
      if (v === undefined) continue;
      assert.ok(isFinite(v) && v >= 0 && v <= 1, "flagSet#" + i + " " + ax + " 脏值: " + v);
    }
    if (st.moodDay && st.moodDay.vBias !== undefined) {
      assert.ok(isFinite(st.moodDay.vBias) && Math.abs(st.moodDay.vBias) <= 1,
        "flagSet#" + i + " vBias 脏值: " + st.moodDay.vBias);
    }
  }
});
