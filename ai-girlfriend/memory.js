/* 小暖 memory.js · 契约§2.3 · 约定§2.1A–H · V-90 ≤14336B · 纯函数不写 state，异常吞掉返 null */
(function (E) {
"use strict";
if (!E || typeof E.use !== "function") return;
const O = E.safeObj, A = E.safeArr, C = E.clamp01, HS = E.hashStr, PW = E.pickWith;
const MAXF = 200, MAXM = 120, GAP = 216e5, D90 = 7776e6, MILE = { 告白: 1, 纪念日: 1, 和解: 1, story: 1 };
const N = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const get = (a, i) => { for (const x of a) if (x && x.id === i) return x; return null; };
const up = (a, i, p) => { for (let k = 0; k < a.length; k++) if (a[k] && a[k].id === i) { a[k] = Object.assign({}, a[k], p); return; } };
const norm = (m) => ({ v: 13, facts: A(O(m).facts).filter(Boolean).slice(), moments: A(O(m).moments).filter(Boolean).slice(), migratedAt: N(O(m).migratedAt, 0) });

const TAGS = [[/(吃|饿|外卖|火锅|奶茶|蛋糕|甜|饭)/, "吃"], [/(累|困|睡|熬夜|加班|下班|上班|开会)/, "忙"],
 [/(难受|生病|疼|感冒|药|发烧)/, "身"], [/(妈|爸|家里|奶奶|外婆|哥|姐|弟|妹)/, "家"],
 [/(游戏|看剧|追剧|电影|音乐|歌|球)/, "玩"], [/(考试|作业|论文|上课)/, "学"],
 [/(程序员|职业|上班|工作|公司|老板|同事)/, "工作"]];
const tg = (t) => { const o = []; for (const p of TAGS) if (p[0].test(t)) o.push(p[1]); return o; };
const tgf = (t, key, value) => tg(t + "|" + key + "|" + value);

/* R23 宁可漏抽不可错抽（H11 第一道闸）：[正则, key, 基线 conf, 捕获组] */
const ASK = /[?？]|(吗|呢|么)\s*[?？]?$/, BADV = /^(说|不是|真|想|要|来|去|在|有|没|什么|啥|谁|哪|怎|个|的|了)/;
const W = "[\\u4e00-\\u9fa5A-Za-z0-9_]", RX = (s) => new RegExp(s.replace(/#/g, W));
const RULES = [[RX("(?:我叫|我的?名字[叫是])\\s*(#{1,8})"), "称呼", .85, 1],
 [RX("我(妈|爸|哥|姐|弟|妹|奶奶|外婆|老板|同事|室友|猫|狗)(?:叫|名字叫)\\s*(#{1,6})"), "家人·$1", .85, 2],
 [RX("(?:最)?(?:喜欢|爱)(?:吃|喝|看|玩|听)?\\s*(?!你|上你)(#{1,8})"), "喜好", .8, 1],
 [RX("(?:讨厌|不喜欢|受不了|怕|过敏)\\s*(?!你)(#{1,8})"), "禁忌", .8, 1],
 [RX("我是(?:个|名)?\\s*(#{1,6}[师员生工家猿媛士计])"), "工作", .8, 1],
 [/我(?:的)?生日(?:是|在)?\s*(\d{1,2}月\d{1,2}[日号])/, "纪念日", .85, 1]];
const mk = (key, value, conf, tags, now) => ({ id: "f_" + HS(key + "|" + value), key, value, conf, tags,
 since: now, lastSeenAt: now, lastUsedAt: 0, hits: 1, src: "chat", negatedAt: null });

function extractFacts(text, state, ctx) {
 try {
  const t = String(text || ""); if (!t) return null;
  const c = O(ctx), now = N(c.now, Date.now()), tags = tg(t), fa = [], mo = [];
  if (!ASK.test(t.trim())) for (const r of RULES) {   // 提问不是陈述：「我喜欢什么？」是考她
   const m = t.match(r[0]); if (!m) continue;
   const v = String(m[r[3]] || "").trim();
   if (v && v.length < 13 && !BADV.test(v)) { const k = r[1].replace("$1", m[1]); fa.push(mk(k, v, r[2], tgf(t, k, v), now)); }
  }
  const dv = Math.max(-1, Math.min(1, N(c.dv, 0))), k = String(c.intent || "chat");
  if (Math.abs(dv) >= .25 || MILE[k]) mo.push({ id: "t_" + HS(t.slice(0, 24) + Math.floor(now / 6e4)),
   at: now, kind: k, gist: t.slice(0, 40), emo: { v: dv, a: N(c.da, 0) }, peak: Math.abs(dv) || .4, tags, usedAt: [], jokeScore: 0 });
  return (fa.length || mo.length) ? { facts: fa, moments: mo } : null;
 } catch (e) { return null; }
}

function applyPatch(mem, patch) {
 try {
  const m = norm(mem), p = O(patch), now = Date.now();
  for (const f of A(p.facts)) { const o = get(m.facts, f.id);
   if (o) up(m.facts, f.id, { hits: N(o.hits, 1) + 1, lastSeenAt: f.since, negatedAt: null,
    conf: C(Math.max(N(o.conf, .6), f.conf) + .1), tags: A(o.tags).length ? o.tags : f.tags });
   else m.facts.push(f); }
  for (const x of A(p.moments)) if (!get(m.moments, x.id)) m.moments.push(x);
  for (const i of A(p.used)) { if (get(m.facts, i)) up(m.facts, i, { lastUsedAt: now });
   const x = get(m.moments, i); if (x) up(m.moments, i, { usedAt: A(x.usedAt).concat(now).slice(-8) }); }
  const c = O(p.correction), f = c.factId ? get(m.facts, c.factId) : null;
  if (f && c.kind === "deny") up(m.facts, c.factId, { negatedAt: now });
  else if (f && c.value) up(m.facts, c.factId, { value: String(c.value), conf: .95, lastSeenAt: now, hits: N(f.hits, 1) + 1, negatedAt: null, src: "fix" });
  return m;
 } catch (e) { return norm(mem); }
}

/* R27 纠错：锚点＝30min 内被召回的最近一条，无锚点即不纠 */
const DENY = /(记错|没说过|不是我说的|搞错了)/, REV = new RegExp("(?:不对|不是)[，,]?\\s*(?:是|应该是|其实是)\\s*(" + W + "{1,10})");
function detectCorrection(text, state) {
 try {
  const t = String(text || ""); if (!t) return null;
  const now = Date.now(); let L = null;
  for (const f of norm(O(state).mem).facts)
   if (!f.negatedAt && N(f.lastUsedAt, 0) && now - f.lastUsedAt <= 18e5 && (!L || f.lastUsedAt > L.lastUsedAt)) L = f;
  if (!L) return null;
  const r = t.match(REV);
  return r ? { factId: L.id, kind: "revise", value: r[1] } : (DENY.test(t) ? { factId: L.id, kind: "deny", value: "" } : null);
 } catch (e) { return null; }
}

function retrieveFacts(query, state, k) {
 try {
  const q = String(query || ""); if (!q) return [];
  const live = norm(O(state).mem).facts.filter(f => !f.negatedAt && f.value);
  if (!live.length) return [];
  const qv = E.vec(E.tokenize(q)), qt = tg(q), out = [], n = N(k, 3) > 0 ? N(k, 3) : 3;
  for (const f of live) { const s = .55 * E.cosine(qv, E.vec(E.tokenize(f.value + f.key))) + (A(f.tags).some(x => qt.indexOf(x) >= 0) ? .45 : 0);
   if (s > .28) out.push({ fact: f, score: s }); }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
 } catch (e) { return []; }
}

/* R25 融入式：事实只作从句成分，不做播报；槽位只回填 value 原文，禁一切生成式改写 —— H11＝0% 的实现保证 */
const BODY = { 喜好: ["#这时候最合适了", "给你留了块#", "回头给你带#"], 禁忌: ["反正离#远一点", "#就别碰了", "#那种别试"],
 称呼: ["#，先喘口气", "#，我在呢", "#呀，慢一点"], 家人: ["也跟#说一声", "别让#太操心", "#那边你也顾着点"],
 工作: ["当#的也要歇", "#不是铁打的", "#也得好好吃饭"], 纪念日: ["#那天不许加班", "#快到了呢", "#我数着日子呢"] };
const PROBE = { 喜好: "你还挺喜欢#的吧", 禁忌: "你不太能碰#吧", 称呼: "我该叫你#对吧", 家人: "#最近还好吧", 工作: "你是做#的对吧", 纪念日: "你生日是#来着" };
const OPEN = { tired: ["累坏了吧", "先歇会儿"], sad: ["抱抱", "别难过"], anxious: ["别慌", "慢慢来"], joy: ["这么开心呀", "嘿嘿"], neutral: ["", "嗯"] };
const TB = ["。", "呀。", "~", "哦。"], BAN = /(我记得|我还记得|你之前说|你上次说|你说过|还记着)/;
const SELF = /我\S{0,3}是|我只是|我不能|帮不上|热线|心理援助|建议你去|专业人[士师]/;
/* 遗留-2 脱敏：入口闸净化 value —— 命中即静音，零改写（改写即破 H7=0）；JOBX 等长折叠后再判。*/
const JOBX = /程序[员猿媛]/g, SF = "上班族";
const taint = (v) => E.PERSONA_BREAK_RE.test(String(v).replace(JOBX, "职"));

function weave(f, text, rng) {
 const fam = String(f.key).split("·")[0], pb = N(f.conf, 0) < .75, fr = pb ? PROBE[fam] : BODY[fam];
 if (!fr || taint(f.value)) return null;   // 遗留-2：破墙值不回显
 const ue = E.detectUserEmotion(text) || { type: "neutral" }, op = PW(OPEN[ue.type] || OPEN.neutral, rng);
 const s = (op ? op + "，" : "") + (pb ? fr : PW(fr, rng)).replace(/#/g, f.value) + (pb ? "？" : PW(TB, rng));
 return (s.length > 42 || BAN.test(s) || (SELF.test(s) && E.PERSONA_BREAK_RE.test(s))) ? null : s;
}

/* 横向走查表（挂载点契约详见 DESIGN-v14 §13.1）：recallV2 自 engine:2899 早退绕过 :3032/:3057，
   故挂载点上移本模块 —— mod() 调用期查表，缺件返 null 落回原句，D 单向依赖不破。
   nosplit＝调用方只收单条 replies[0]；SF 是「程序族」等长折叠件（S-6）。
   A6-b：engine:2896 丢弃 rv.tx，故就地按 texture.js 同口径累加 state.tex，t 留宿主自增免双计。*/
function skin(line, text, state, c, rng) {
 try {
  const ue = E.detectUserEmotion(text), out = { line };
  /* ① texture：命中才改写 line 记 tx 累配额；未命中留原句继续走 ②（v14 前此处 return null 早退，H16 仅 14%）*/
  const T = E.mod("texture");
  if (T && typeof T.texturePass === "function") {
   const j = (line.match(JOBX) || [])[0], fd = j ? line.split(j).join(SF) : line;
   const x = T.texturePass(fd, state, { rng, lv: c.lv, ue,
    intent: "recall", intentEx: "recall", crisis: false, nosplit: true });
   if (x && x.text) {
    const q = (O(state).tex = O(O(state).tex)), d = Math.floor(Date.now() / 864e5), ty = x.kind === "typo";
    if (N(q.d, -1) !== d) { q.d = d; q.n = 0; q.ty = 0; }
    q.n = N(q.n, 0) + 1; if (ty) { q.ty = N(q.ty, 0) + 1; q.tyAt = N(q.t, 0); }
    out.line = j ? x.text.split(SF).join(j) : x.text; out.tx = { kind: x.kind };
   }
  }
  /* ② v14 R-P2 补两层：pacingOf 内已挂 contingencePass 并就地改 rs[0]，故传数组回读；
     须排 ① 之后（同 :3032→:3057 序）；★严禁另调 contingencePass（双计 CAP）。 */
  const P = E.mod("presence");
  if (P && typeof P.pacingOf === "function") {
   const rs = [out.line];
   const pc = P.pacingOf(text, rs, { st: state, ue, lv: c.lv, crisis: false, rng, tx: !!out.tx });
   if (rs[0]) out.line = rs[0];
   if (pc) out.pacing = pc;
  }
  return out;
 } catch (e) { return null; }
}

function recallV2(text, state, ctx) {
 try {
  const t = String(text || ""); if (!t) return null;
  const c = O(ctx), now = N(c.now, Date.now()), rng = E.rngOf(c);
  for (const h of retrieveFacts(t, state, 3)) { const f = h.fact;
   if (N(f.conf, 0) < .5) continue;                 // ★ 置信度门：不确定就闭嘴，绝不猜
   if (t.indexOf(f.value) >= 0) continue;           // 用户此刻正说的事，复读回去只显得傻
   if (now - N(f.lastUsedAt, 0) < GAP) continue;    // 同一事实 6h 不重复
   if (!E.chanceWith(.45 + .35 * h.score, rng)) continue;   // 概率性，不做节拍器
   const line = weave(f, t, rng);
   if (line) return Object.assign({ line, mode: f.conf >= .75 ? "blend" : "probe", factId: f.id },
    skin(line, t, state, c, rng)); }
  return null;
 } catch (e) { return null; }
}

/* §5 淘汰：墓碑 90 天防重抽，超容量最低分先走 */
function evict(mem, now) {
 try {
  const m = norm(mem), t = N(now, Date.now());
  m.facts = m.facts.filter(f => !f.negatedAt || t - f.negatedAt < D90);
  const live = m.facts.filter(f => !f.negatedAt);
  if (live.length > MAXF) { const fs = (f) => N(f.conf, .6) + Math.min(N(f.hits, 0), 5) * .08;
   const d = live.slice().sort((a, b) => fs(a) - fs(b)).slice(0, live.length - MAXF); m.facts = m.facts.filter(f => d.indexOf(f) < 0); }
  if (m.moments.length > MAXM) m.moments = m.moments.slice()
   .sort((a, b) => (Math.abs(N(b.peak, 0)) + (MILE[b.kind] ? .4 : 0)) - (Math.abs(N(a.peak, 0)) + (MILE[a.kind] ? .4 : 0))).slice(0, MAXM);
  return m;
 } catch (e) { return norm(mem); }
}

/* §5.4 迁移：幂等 / conf 一律 .6 / 不动 memory.events */
function migrateV12(state) {
 try {
  const st = O(state), old = O(st.memory), t0 = Date.now();
  if (N(O(st.mem).v, 0) === 13) return { mem: norm(st.mem), migrated: 0 };
  const out = { v: 13, facts: [], moments: [], migratedAt: t0 };
  const pf = (k, v, at) => { const f = mk(k, String(v).slice(0, 12), .6, tgf("", k, String(v)), at); f.src = "v12"; f.lastSeenAt = at; if (!get(out.facts, f.id)) out.facts.push(f); };
  const pm = (i, at, kind, v) => { if (!get(out.moments, i)) out.moments.push({ id: i, at, kind, gist: "", emo: { v, a: 0 }, peak: Math.abs(v), tags: [], usedAt: [], jokeScore: 0 }); };
  if (old.userName) pf("称呼", old.userName, t0);
  for (const l of A(old.likes)) if (l) pf("喜好", l, t0);
  for (const e of A(old.events)) { if (!e || !e.topic) continue;
   const at = N(e.at, t0), im = N(e.importance, .5);
   pf(String(e.topic), e.t || e.topic, at);
   if (im >= .7) pm("t_" + HS(e.topic + "|" + at), at, String(e.topic), im); }
  const el = O(st.emotionLog);
  for (const d in el) for (const x of A(el[d])) { const v = N(O(x).v, 0);
   if (Math.abs(v) >= .5) pm("t_" + HS(d + "|" + v), N(O(x).t, t0), "emo", v); }
  return { mem: out, migrated: out.facts.length + out.moments.length };
 } catch (e) { return { mem: norm(O(state).mem), migrated: 0 }; }
}

const listFacts = (s) => norm(O(s).mem).facts.filter(f => !f.negatedAt)
 .map(f => ({ id: f.id, label: String(f.key).replace("·", " "), tone: N(f.conf, 0) >= .75 ? "sure" : "maybe", text: f.value }));
const editFact = (m, i, v) => { const x = norm(m); up(x.facts, i, { value: String(v), conf: 1, negatedAt: null, src: "user" }); return x; };
const deleteFact = (m, i) => { const x = norm(m); up(x.facts, i, { negatedAt: Date.now() }); return x; };
const jokeCandidates = () => [];

E.use("memory", { extractFacts, applyPatch, detectCorrection, retrieveFacts, recallV2, evict, migrateV12, listFacts, editFact, deleteFact, jokeCandidates, BAN });
})(typeof Engine !== "undefined" ? Engine : null);
