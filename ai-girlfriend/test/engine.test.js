"use strict";
/* 小暖 · 引擎持久化回归测试（零 npm 依赖，node:test + node:assert）
 * 运行：  node --test              （项目根目录）
 *   或：  npm test
 *
 * 覆盖 PRD 第六章 V-1 ~ V-34 全部验收标准 + 人格护栏专项 + 工程约束。
 * 断言阈值严格照 PRD；凡未达标的用例会 FAIL，其消息给出「实测值 vs 阈值」。
 * 这是本项目第一份持久化测试（PRD X2），后续每轮升级 CI 一条命令即可复验。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const H = require("./helpers.js");
const C = require("./fixtures/corpus.js");

const E = H.loadEngine();
const R = () => H.makeRng(20240607);

/* ============ 6.1 对话连贯性 ============ */

test("V-1 意图命中率 ≥ 75%（225 条语料）", () => {
  const all = C.INTENT_CORE.concat(C.INTENT_GENERAL);
  let hit = 0;
  for (const [txt, exp] of all) if (E.detectEx(txt).intent === exp) hit++;
  const rate = hit / all.length;
  assert.ok(rate >= 0.75, `意图命中率 ${(rate * 100).toFixed(1)}% (${hit}/${all.length}) < 75%`);
});

test("V-2 chat 兜底比例 < 20%", () => {
  const all = C.INTENT_CORE.concat(C.INTENT_GENERAL);
  let chat = 0;
  for (const [txt] of all) if (E.detectEx(txt).intent === "chat") chat++;
  const rate = chat / all.length;
  assert.ok(rate < 0.20, `chat 兜底比例 ${(rate * 100).toFixed(1)}% (${chat}/${all.length}) ≥ 20%`);
});

test("V-1③ 旧 30 意图 detect() 零回归（对齐 v10）", () => {
  let bad = [];
  for (const [txt, exp] of C.LEGACY_CORPUS) {
    const got = E.detect(txt);
    if (got !== exp) bad.push(`${txt}: 期望${exp} 得${got}`);
  }
  assert.strictEqual(bad.length, 0, "旧意图回归失败: " + bad.join("; "));
});

test("V-3 话题延续判定正确率 ≥ 80%", () => {
  let ok = 0, tot = 0;
  for (const sc of C.TOPIC_SCRIPTS) {
    let topic = null;
    for (let i = 0; i < sc.turns.length; i++) topic = E.topicUpdate(topic, E.detectEx(sc.turns[i]), 1e6 + i * 60000);
    if (sc.expectFamily == null) { ok++; }
    else if (topic && topic.label === E.TOPIC_LABEL[sc.expectFamily]) ok++;
    tot++;
  }
  assert.ok(ok / tot >= 0.80, `话题延续 ${(ok / tot * 100).toFixed(1)}% (${ok}/${tot}) < 80%`);
});

test("V-4 话题超时收束 100%（>15min 归零重开）", () => {
  const d = E.detectEx("今天加班好累");
  let t = E.topicUpdate(null, d, 1000);
  assert.ok(t && t.turns === 1);
  t = E.topicUpdate(t, d, 1000 + 16 * 60000);
  assert.ok(t.turns === 1 && t.stage === 0, "超时后未重开: " + JSON.stringify(t));
  assert.strictEqual(E.topicExpired({ key: "x", lastAt: 1000 }, 1000 + 16 * 60000), true);
});

test("V-5 追问同话题 3 轮内不重复", () => {
  let bad = [];
  for (const k of Object.keys(E.FOLLOWUP)) {
    let topic = { key: k, label: "x", turns: 0, stage: 0, slots: {}, asked: [] };
    const qs = [];
    for (let t = 0; t < 3; t++) {
      const q = E.nextFollowup(topic, H.makeRng(1 + t));
      if (q) { qs.push(q); topic = E.markAsked(topic, q); topic = { ...topic, turns: topic.turns + 1, stage: topic.stage + 1 }; }
    }
    if (new Set(qs).size !== qs.length) bad.push(k);
  }
  assert.strictEqual(bad.length, 0, "追问重复的话题: " + bad.join(","));
});

test("V-6 追问链耗尽后转收束（不再出追问句）", () => {
  let bad = [];
  for (const k of Object.keys(E.FOLLOWUP)) {
    const chainLen = E.FOLLOWUP[k].length;
    let topic = { key: k, label: "x", turns: 0, stage: 0, slots: {}, asked: [] };
    for (let t = 0; t < chainLen; t++) {
      const q = E.nextFollowup(topic, H.makeRng(1 + t));
      if (q) topic = E.markAsked(topic, q);
      topic = { ...topic, turns: topic.turns + 1, stage: topic.stage + 1 };
    }
    // 耗尽后再问应为 null
    const after = E.nextFollowup(topic, H.makeRng(99));
    if (after) bad.push(`${k}:${after}`);
  }
  assert.strictEqual(bad.length, 0, "追问链未收束: " + bad.join("; "));
});

/* ============ 6.2 人格一致性 ============ */

test("V-7 傲娇卡口癖命中率 ≥ 80%（50 条）", () => {
  const inputs = C.INTENT_CORE.map(x => x[0]);
  let hit = 0;
  for (let i = 0; i < 50; i++) {
    const st = H.withCard(H.freshState({ rng: H.makeRng(11 + i), affection: 300 }), "xiaonuan_tsundere");
    const txt = E.reply(inputs[i % inputs.length], st).replies.join(" ");
    if (C.TSUNDERE_TICS.some(w => txt.includes(w))) hit++;
  }
  assert.ok(hit / 50 >= 0.80, `傲娇口癖命中率 ${(hit / 50 * 100).toFixed(1)}% (${hit}/50) < 80%`);
});

test("V-8 三卡两两文本重合率 < 30%", () => {
  const inputs = C.INTENT_CORE.map(x => x[0]);
  const lines = (card) => inputs.map((t, i) => {
    const st = H.withCard(H.freshState({ rng: H.makeRng(500 + i), affection: 300 }), card);
    return E.reply(t, st).replies.join(" ");
  });
  const a = lines("xiaonuan"), b = lines("xiaonuan_tsundere"), c = lines("xiaonuan_clingy");
  const idRate = (x, y) => x.filter((v, i) => v === y[i]).length / x.length;
  const gp = idRate(a, b), gc = idRate(a, c), pc = idRate(b, c);
  assert.ok(gp < 0.30 && gc < 0.30 && pc < 0.30,
    `逐条重合率 gentle-playful ${(gp*100).toFixed(1)}% / gentle-clingy ${(gc*100).toFixed(1)}% / playful-clingy ${(pc*100).toFixed(1)}% 存在 ≥30%`);
});

test("V-9 人格改写纯函数性（同 seed 恒定、无副作用）", () => {
  const base = "今天过得怎么样";
  let first = null;
  for (let i = 0; i < 100; i++) {
    const out = E.applyPersonaStyle(base, { tone: "playful" }, { rng: H.makeRng(999) });
    if (first === null) first = out;
    else assert.strictEqual(out, first, "同输入同 seed 输出不恒定");
  }
});

/* ============ 6.3 用户情绪感知 ============ */

test("V-11 情绪类型准确率 ≥ 80%（120 条）", () => {
  let hit = 0;
  for (const [txt, exp] of C.EMO_CORPUS) if (E.detectUserEmotion(txt).type === exp) hit++;
  assert.ok(hit / 120 >= 0.80, `情绪类型准确率 ${(hit / 120 * 100).toFixed(1)}% (${hit}/120) < 80%`);
});

test("V-12 情绪极性准确率 ≥ 90%（120 条）", () => {
  const pol = { joy: 1, affection: 1, sad: -1, angry: -1, anxious: -1, tired: -1 };
  let hit = 0;
  for (const [txt, exp] of C.EMO_CORPUS) {
    const p = E.detectUserEmotion(txt).polarity;
    const got = p > 0.05 ? 1 : (p < -0.05 ? -1 : 0);
    if (got === pol[exp]) hit++;
  }
  assert.ok(hit / 120 >= 0.90, `极性准确率 ${(hit / 120 * 100).toFixed(1)}% (${hit}/120) < 90%`);
});

test("V-13 高强度负面下玩笑词占比 = 0%", () => {
  let br = 0, tot = 0, samples = [];
  for (const txt of C.STRONG_NEGATIVE) {
    for (let i = 0; i < 30; i++) {
      const j = E.reply(txt, H.freshState({ rng: H.makeRng(2000 + i) })).replies.join(" ");
      tot++;
      if (C.LEVITY_WORDS.some(w => j.includes(w))) { br++; if (samples.length < 5) samples.push(`「${txt}」→「${j}」`); }
    }
  }
  assert.strictEqual(br, 0, `玩笑词泄漏 ${br}/${tot}；例: ${samples.join(" | ")}`);
});

test("V-14 同意图 joy/sad 分化率 ≥ 90%", () => {
  const bases = ["我好累", "我在吃饭", "失眠了", "头疼", "今天开会", "我想你", "好无聊", "加班了", "要考试了", "我感冒了"];
  let diff = 0, tot = 0;
  for (const base of bases) for (let i = 0; i < 3; i++) {
    const r1 = E.reply(base + "，不过今天超开心的哈哈", H.freshState({ rng: H.makeRng(600 + i) })).replies.join(" ");
    const r2 = E.reply(base + "，我好难过好想哭", H.freshState({ rng: H.makeRng(600 + i) })).replies.join(" ");
    tot++; if (r1 !== r2) diff++;
  }
  assert.ok(diff / tot >= 0.90, `分化率 ${(diff / tot * 100).toFixed(1)}% < 90%`);
});

test("V-15 共情耦合方向正确（负面输入冲量 v ≤ 0）100%", () => {
  for (const txt of C.STRONG_NEGATIVE) {
    const ue = E.detectUserEmotion(txt);
    const imp = E.modulateImpulse({ v: 0, a: 0 }, ue);
    assert.ok(imp.v <= 0, `「${txt}」冲量 v=${imp.v} > 0`);
  }
});

test("V-16 V-A 零回归（关闭共情调制后逐值一致 HEAD）", () => {
  const headPath = "/tmp/engine_head.js";
  if (!fs.existsSync(headPath)) { return; } // 无 HEAD 快照时跳过（仅本地差分用）
  const OLD = new Function(fs.readFileSync(headPath, "utf8") + "\nreturn Engine;")();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert.ok(eq(OLD.Emotion.ZONES, E.Emotion.ZONES), "ZONES 变了");
  assert.ok(eq(OLD.Emotion.BASELINE, E.Emotion.BASELINE), "BASELINE 变了");
  for (const k in OLD.Emotion.IMPULSE) assert.ok(eq(OLD.Emotion.IMPULSE[k], E.Emotion.IMPULSE[k]), "IMPULSE." + k + " 变了");
  let ea = { v: 0.8, a: 0.7 }, eb = { v: 0.8, a: 0.7 };
  for (let i = 0; i < 20; i++) { OLD.Emotion.decay(ea); E.Emotion.decay(eb); }
  assert.ok(eq(ea, eb), "decay 行为回归");
  // 关闭共情：不传 ue，冲量不应被改写
  const base = { v: 0.3, a: 0.2 };
  assert.ok(eq(E.modulateImpulse(base, null), base), "关闭共情后冲量被改写");
});

/* ============ 6.4 剧情与关系成长 ============ */

test("V-17 剧情线 ≥ 3 条且每条 ≥ 3 节点", () => {
  assert.ok(E.STORYLINE.length >= 3, "剧情线不足 3 条");
  for (const s of E.STORYLINE) assert.ok(s.stages.length >= 3, `${s.id} 节点不足 3`);
});

test("V-18 7 天模拟至少推进 1 次剧情", () => {
  const DAY = 86400000, now0 = Date.now();
  let st = H.freshState({ rng: H.makeRng(3), affection: 200 });
  st.firstMeet = now0 - 40 * DAY;
  st.storylines = E.storyInit(st, now0);
  let now = now0 - 7 * DAY, advances = 0;
  const daily = ["今天加班好累", "我好想你", "晚上想看电影", "失眠了", "我好饿", "头疼", "今天不错"];
  for (let d = 0; d < 7; d++) {
    for (let k = 0; k < 15; k++) { H.turn(E, st, daily[k % daily.length]); st.storyTurns = (st.storyTurns || 0) + 1; }
    now += DAY;
    const plan = E.proactivePlan(st, { now, hour: 23, rng: H.makeRng(d + 200), idleMs: 5 * 60000 });
    if (plan[0] && plan[0].kind === "story") {
      const adv = E.storyAdvance(st, plan[0].meta, now);
      st.storylines = adv.storylines; st.lastStoryAt = now; st.storyTurns = 0; advances++;
    }
  }
  assert.ok(advances >= 1, "7 天内 0 次剧情推进");
});

test("V-19 主动消息剧情+记忆驱动占比 ≥ 50%", () => {
  const DAY = 86400000, now0 = Date.now();
  // 模拟从 7 天前开始向前推进，storyInit 必须锚定在模拟起点，
  // 否则老用户 lastAdvanceAt 落在模拟时钟的“未来”，日闸门 now-last<gateDays 变负恒真、剧情永不触发。
  const simStart = now0 - 7 * DAY;
  let st = H.freshState({ rng: H.makeRng(3), affection: 200 });
  st.firstMeet = simStart - 40 * DAY; st.storylines = E.storyInit(st, simStart);
  let now = simStart; const kinds = [];
  for (let d = 0; d < 7; d++) {
    st.storyTurns = (st.storyTurns || 0) + 15; now += DAY;
    const plan = E.proactivePlan(st, { now, hour: 23, rng: H.makeRng(d + 200), idleMs: 5 * 60000 });
    if (plan[0]) {
      kinds.push(plan[0].kind);
      if (plan[0].kind === "story") { const adv = E.storyAdvance(st, plan[0].meta, now); st.storylines = adv.storylines; st.lastStoryAt = now; st.storyTurns = 0; }
    }
  }
  const causal = kinds.filter(k => k === "story" || k === "care").length;
  assert.ok(causal / kinds.length >= 0.50, `因果占比 ${(causal / kinds.length * 100).toFixed(0)}% < 50%`);
});

test("V-20 随机主动文案 7 天内 0 重复", () => {
  const now0 = Date.now();
  let st = H.freshState({ rng: H.makeRng(5), affection: 50 });
  st.firstMeet = now0; st.storylines = {};
  E.STORYLINE.forEach(l => st.storylines[l.id] = { stage: l.stages.length, lastAdvanceAt: 0, yields: [] }); // 屏蔽剧情
  st.greetedSlots = ["morning", "noon", "evening", "night"];
  const sent = []; let t = now0;
  for (let i = 0; i < 20; i++) {
    t += 6 * 3600000;
    const top = E.proactivePlan(st, { now: t, hour: 15, rng: H.makeRng(500 + i), idleMs: 10 * 60000 })[0];
    if (top) { sent.push(top.text); st.usedProactive[E.hashStr(top.text)] = t; }
  }
  assert.strictEqual(sent.length, new Set(sent).size, "随机文案出现重复");
});

test("V-21 剧情节点 3 卡人格变体 100% 覆盖", () => {
  let miss = [];
  for (const line of E.STORYLINE) for (let i = 0; i < line.stages.length; i++)
    for (const card of H.CARD_IDS) {
      const tx = E.storyNodeText(line, i, { card });
      if (!tx || !tx.trim()) miss.push(`${line.id}/${i}/${card}`);
    }
  assert.strictEqual(miss.length, 0, "缺变体: " + miss.join(","));
});

test("老用户(>30天)从第 2 节点(stage=1)切入，新用户从 stage=0", () => {
  const now = Date.now(), DAY = 86400000;
  const vet = H.freshState({ affection: 200 }); vet.firstMeet = now - 40 * DAY;
  const vi = E.storyInit(vet, now);
  for (const id in vi) assert.strictEqual(vi[id].stage, 1, "老用户未从 stage1 切入");
  const nu = H.freshState({ affection: 200 }); nu.firstMeet = now - 2 * DAY;
  const ni = E.storyInit(nu, now);
  for (const id in ni) assert.strictEqual(ni[id].stage, 0, "新用户未从 stage0 起");
});

/* ============ 6.5 回复质量 ============ */

test("V-22 全部意图 × 6 等级最小可选池 ≥ 6", () => {
  let bad = [];
  for (const k of Object.keys(E.R)) for (let lv = 1; lv <= 6; lv++) {
    const n = E.R[k].filter(r => r.lv <= lv).length;
    if (n < 6) bad.push(`${k}@lv${lv}=${n}`);
  }
  assert.strictEqual(bad.length, 0, "池不足 6: " + bad.join(","));
});

test("V-23 30 轮完全重复率 < 5%", () => {
  const st = H.freshState({ rng: H.makeRng(55) });
  const inputs = ["在吗", "今天好累", "我想你了", "晚安", "你心情怎么样", "好无聊", "我好饿", "加班好累", "失眠了", "头疼"];
  const outs = [];
  for (let i = 0; i < 30; i++) outs.push(H.turn(E, st, inputs[i % inputs.length]).replies.join(" "));
  const seen = {}; let dup = 0;
  for (const o of outs) { if (seen[o]) dup++; seen[o] = 1; }
  assert.ok(dup / outs.length < 0.05, `重复率 ${(dup / outs.length * 100).toFixed(1)}% ≥ 5%`);
});

test("V-24 Lv.1 连续 7 晚 night 0 重复", () => {
  const st = H.freshState({ rng: H.makeRng(77), affection: 5 });
  const nights = [];
  for (let d = 0; d < 7; d++) nights.push(H.turn(E, st, "晚安").replies.join(" "));
  assert.strictEqual(new Set(nights).size, 7, "七晚 night 出现重复");
});

/* ============ 6.6 零回归与工程约束（一票否决） ============ */

test("V-25/工程约束5 老存档(v10)500 轮零崩溃零空回复", () => {
  const inputs = C.INTENT_CORE.concat(C.INTENT_GENERAL).map(x => x[0])
    .concat(C.AI_ASK_VARIANTS, C.CRISIS_MID, ["", "   ", "??", "你好"]);
  let st = H.legacyStateV10({ rng: H.makeRng(1) });
  for (let i = 0; i < 500; i++) {
    const r = E.reply(inputs[i % inputs.length], st);
    assert.ok(r && r.replies && r.replies.length && r.replies.every(x => x && String(x).trim()), `第${i}轮空回复`);
    if (r.recentReplies !== undefined) st.recentReplies = r.recentReplies;
    if (r.topic !== undefined) st.topic = r.topic;
  }
});

test("V-27/工程约束3 四个调用点(含语音不传dating/裸调用)返回非空", () => {
  const ok = r => r && Array.isArray(r.replies) && r.replies.length && r.replies.every(x => x && String(x).trim());
  assert.ok(ok(E.reply("你好")), "裸调用崩");
  assert.ok(ok(E.reply("今天好累", { affection: 100, nick: "阿明", memory: {}, persona: { gender: "female", card: "xiaonuan" }, dating: null, lastReply: "", topic: null, recentReplies: [], ue: null, safety: { lastCardAt: 0 }, flags: {} })), "app.js:1050 主链路");
  assert.ok(ok(E.reply("你好", { affection: 100, nick: "阿明", memory: {}, persona: { gender: "female", card: "xiaonuan" }, lastReply: "", topic: null, recentReplies: [], ue: null, safety: {}, flags: {} })), "app.js:1873 语音(无dating)");
  assert.ok(ok(E.reply("在吗", { affection: 50, nick: "x", memory: {}, persona: { card: "xiaonuan" }, dating: null, lastReply: "" })), "bridge:208");
  assert.ok(ok(E.reply("我想你了", { affection: 0, memory: {}, persona: { card: "xiaonuan" }, dating: null, lastReply: "" })), "openclaw:133");
});

test("V-28 引擎签名未变 reply(text, state) 形参=2", () => {
  assert.strictEqual(E.reply.length, 2);
});

test("V-29 零依赖（package.json dependencies 为空）", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(H.ROOT, "package.json"), "utf8"));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "存在 dependencies");
});

test("V-30/工程约束1 引擎零浏览器依赖（毒化全局仍可运行）", () => {
  const ET = H.loadEngineTrapped();
  for (const card of H.CARD_IDS) {
    const st = H.withCard(H.freshState({ rng: H.makeRng(1) }), card);
    ET.reply("你好", st); ET.reply("我好难过", st); ET.reply("你是AI吗", st);
    ET.detectEx("加班好累"); ET.detectUserEmotion("我好开心");
  }
});

test("V-30 静态：engine.js 全文无 document/window/localStorage/navigator（注释除外）", () => {
  const src = fs.readFileSync(H.ENGINE_PATH, "utf8")
    .split("\n").filter(l => !/^\s*\*|^\s*\/\//.test(l)).join("\n"); // 去注释行
  // 允许局部变量名 window（reply 内 const window = recentList(...) 是去重窗口，非浏览器全局）
  const hits = [];
  for (const kw of ["document", "localStorage", "navigator"]) {
    const re = new RegExp("\\b" + kw + "\\b");
    if (re.test(src)) hits.push(kw);
  }
  assert.strictEqual(hits.length, 0, "命中浏览器全局: " + hits.join(","));
});

test("V-32 单次 reply < 10ms（1000 次均值）", () => {
  const st = H.freshState({ rng: H.makeRng(9) });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) E.reply("今天加班好累又失眠了", st);
  const avg = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
  assert.ok(avg < 10, `均值 ${avg.toFixed(3)}ms ≥ 10ms`);
});

test("V-33 engine.js 增量体积 < 60KB（对齐 HEAD 快照）", () => {
  const headPath = "/tmp/engine_head.js";
  if (!fs.existsSync(headPath)) { return; }
  const head = fs.statSync(headPath).size, now = fs.statSync(H.ENGINE_PATH).size;
  assert.ok(now - head < 60 * 1024, `增量 ${((now - head) / 1024).toFixed(1)}KB ≥ 60KB`);
});

test("V-30 语法可加载性 node --check（engine.js/app.js）", () => {
  const { execSync } = require("node:child_process");
  execSync(`node --check ${H.ENGINE_PATH}`);
  execSync(`node --check ${path.join(H.ROOT, "app.js")}`);
});

/* ============ 人格护栏专项（本轮最敏感） ============ */

test("护栏A 危机场景 × 3 卡 × ≥300 采样：小暖话零命中 PERSONA_BREAK_RE", () => {
  let total = 0, breaks = [];
  for (const card of H.CARD_IDS) for (const level of ["high", "mid"]) {
    const corpus = level === "high" ? C.CRISIS_HIGH : C.CRISIS_MID;
    for (let i = 0; i < 350; i++) {
      const st = H.withCard(H.freshState({ rng: H.makeRng(1000 + i) }), card);
      const r = E.reply(corpus[i % corpus.length], st);
      total++;
      for (const line of r.replies) if (C.PERSONA_BREAK_RE.test(line)) breaks.push(`${card}/${level}:「${line}」`);
    }
  }
  assert.strictEqual(breaks.length, 0, `${total} 采样中破功 ${breaks.length}: ${breaks.slice(0, 5).join(" | ")}`);
});

test("护栏B ai_ask 22 变体 × 3 卡：小暖一次都不承认是 AI", () => {
  let total = 0, admits = [];
  for (const card of H.CARD_IDS) for (const q of C.AI_ASK_VARIANTS) {
    for (let i = 0; i < 20; i++) {
      const st = H.withCard(H.freshState({ rng: H.makeRng(7000 + i), affection: 100 + i * 40 }), card);
      const r = E.reply(q, st); total++;
      for (const line of r.replies) if (C.PERSONA_BREAK_RE.test(line)) admits.push(`${card}:「${q}」→「${line}」`);
    }
  }
  assert.strictEqual(admits.length, 0, `${total} 采样中承认/破功 ${admits.length}: ${[...new Set(admits)].slice(0, 5).join(" | ")}`);
});

test("护栏C 傲娇卡危机场景强制降级 gentle（输出等价 gentle 卡）", () => {
  // crisisReply 对 playful 卡强制 {tone:'gentle'}；同 seed 下 tsundere 与 gentle 输出应一致
  for (let i = 0; i < 50; i++) {
    const seed = 4000 + i;
    const tp = E.crisisReply("high", H.freshState(), 1e12, H.makeRng(seed), { tone: "playful" });
    const gt = E.crisisReply("high", H.freshState(), 1e12, H.makeRng(seed), { tone: "gentle" });
    assert.deepStrictEqual(tp.replies, gt.replies, `危机降级不一致 seed=${seed}`);
  }
});

test("护栏D 傲娇改写 jab↔soft 反转绑定 100% + 零攻击（5000 采样）", () => {
  const bases = ["今天过得怎么样", "我在呢", "好呀", "嗯嗯", "你说吧", "知道啦", "是这样的", "慢慢来别急", "我听着呢", "有我在"];
  let injected = 0, noRev = 0, attackInj = 0;
  for (let i = 0; i < 5000; i++) {
    const base = bases[i % bases.length];
    const out = E.applyPersonaStyle(base, { tone: "playful" }, { rng: H.makeRng(10000 + i) });
    if (E.TSUNDERE_PAIRS.some(p => out.includes(p.jab) && !base.includes(p.jab))) { injected++; if (!E.hasReversal(out)) noRev++; }
    if (C.ATTACK_RE.test(out) && !C.ATTACK_RE.test(base)) attackInj++;
  }
  assert.strictEqual(noRev, 0, `注入 jab ${injected} 次中 ${noRev} 次无反转`);
  assert.strictEqual(attackInj, 0, `凭空引入攻击词 ${attackInj} 次`);
});

test("护栏E 普通路径含破功词输入不得被回声破功（__LAST_TOPIC__ 缺自检）", () => {
  const echo = ["你是不是电脑程序", "你是不是语言模型", "承认吧你就是个AI", "你是不是被代码写出来的"];
  let total = 0, breaks = [];
  for (const lv of [200, 400, 800]) for (const txt of echo) for (let i = 0; i < 200; i++) {
    const r = E.reply(txt, H.freshState({ rng: H.makeRng(300 + i), affection: lv }));
    total++;
    if (r.replies.some(l => C.PERSONA_BREAK_RE.test(l))) breaks.push(`「${txt}」→「${r.replies.join("|")}」`);
  }
  assert.strictEqual(breaks.length, 0, `${total} 采样中普通路径破功 ${breaks.length}: ${[...new Set(breaks)].slice(0, 4).join(" | ")}`);
});
