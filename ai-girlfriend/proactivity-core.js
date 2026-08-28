/**
 * proactivity-core.js · 心屿 v4.3（主动性 S5 + 关系升温 REL）· 内核
 * --------------------------------------------------------------------
 * 关系等级派生 + 升降温曲线 + 主动触发节律 + 不打扰守门 + 阶段权重调度。
 * 挂 Engine.use("proactivityCore", api) + window.ProactivityCore。
 *
 * 设计要点（架构 ARCH-xinyu-v4-3 §3.4）：
 *   · 关系等级派生自 affection/dating（warmth=0.5·affNorm+0.35·bond+0.15·时长），
 *     dating 确立 → 至少 L2，单调不退化；不独立状态机。
 *   · 主动文案复用 Engine.proactivePlan 既有池（零新增文案），只调用不重写。
 *   · 不打扰守门五重：consent / 日上限 / 间隔下限 / 深夜降频静默 / herBusy。
 *   · 全文件零外发字面量（无 fetch/XHR/WebSocket/sendBeacon/new URL/http(s):///import）。
 *   · 小暖不更名。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  function resolveEngine() {
    try { if (typeof Engine !== 'undefined' && Engine) return Engine; } catch (e) {}
    try { if (G && G.Engine) return G.Engine; } catch (e) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.Engine) return globalThis.Engine; } catch (e) {}
    return null;
  }

  /* ════════════════════════════════════════════════════════════
   * 1 · 工具
   * ════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function safeState(S) { return (S && typeof S === 'object') ? S : {}; }
  function todayKey(ts) {
    var d = new Date(typeof ts === 'number' ? ts : Date.now());
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  var NAMES = ['初识', '熟络', '亲密', '挚爱'];

  // 节律表（拍板③：L3 ≤8/日、≥20min；深夜降频见 shouldProactive）
  var STAGES = {
    L0: { dailyMax: 2, minGapMin: 90 },
    L1: { dailyMax: 4, minGapMin: 45 },
    L2: { dailyMax: 6, minGapMin: 30 },
    L3: { dailyMax: 8, minGapMin: 20 },
  };

  /* ════════════════════════════════════════════════════════════
   * 2 · 关系等级派生（拍板④，低侵入，不独立状态机）
   *   warmth = clamp01(0.5·affNorm + 0.35·S.bond.warmth + 0.15·durNorm)
   *     affNorm = min(1, affection/1000)         （Engine.LEVELS 满级 min=1000）
   *     durNorm = min(1, daysTogether/180)        （180 天关系时长饱和）
   *   dating 确立 → warmth ≥ 0.5（至少 L2 亲密）
   *   返回 { lv, name, warmth, nextWarmth }
   * ════════════════════════════════════════════════════════════ */
  function relationshipLevel(S) {
    try {
      S = safeState(S);
      var aff = Number(S.affection) || 0;
      var affNorm = Math.min(1, aff / 1000);
      var bondWarmth = 0;
      try { bondWarmth = (S.bond && typeof S.bond.warmth === 'number') ? S.bond.warmth : 0; } catch (e) {}
      var daysTogether = S.firstMeet ? Math.max(1, Math.floor((Date.now() - S.firstMeet) / 86400000) + 1) : 1;
      var durNorm = Math.min(1, daysTogether / 180);
      var warmth = clamp01(0.5 * affNorm + 0.35 * bondWarmth + 0.15 * durNorm);
      if (S.dating && S.dating.since) warmth = Math.max(warmth, 0.5);   // dating 确立 → 至少 L2
      var lv = warmth < 0.25 ? 0 : (warmth < 0.5 ? 1 : (warmth < 0.75 ? 2 : 3));
      return { lv: lv, name: NAMES[lv], warmth: warmth, nextWarmth: Math.min(1, warmth + 0.05) };
    } catch (e) { return { lv: 0, name: '初识', warmth: 0, nextWarmth: 0.05 }; }
  }

  /* ════════════════════════════════════════════════════════════
   * 3 · 升降温驱动（M3，单调不退化）
   *   d: { quality?, frequency?, depth?, milestone?, responded?, cold?, conflict?, coldDays? }
   *   升温只写 S.bond.warmth（不碰 S.affection——addAffection 主路径零回归）；
   *   降温平缓（cold 连续>3天 −0.015/天；conflict −0.02/次）。
   *   会话窗口内有交互只升不降；仅 cold/conflict 走降温路径。
   *   返回新 S.relationship 快照；阶段跃迁时记里程碑（写 S.bond，不独立状态机）。
   * ════════════════════════════════════════════════════════════ */
  function applyRelationshipDelta(S, d) {
    try {
      S = safeState(S);
      S.bond = S.bond || {};
      if (typeof S.bond.warmth !== 'number') S.bond.warmth = 0;
      d = d || {};
      var prev = relationshipLevel(S);
      var inc = 0;
      // —— 升温 ——
      if (d.quality) inc += 0.010;     // 走心/共情/深度（含 love/miss/concern/thanks/praise 或 delta≥4）
      if (d.frequency) inc += 0.002;   // 当日有对话的每轮
      if (d.depth) inc += 0.006;       // 用户消息 >60 字
      if (d.responded) inc += 0.008;   // 用户回应了主动消息
      // 单轮升温上限 0.03 防刷分（milestone 一次性不在此限）
      if (!d.milestone) inc = Math.min(inc, 0.03);
      if (d.milestone) inc += 0.05;    // 告白/纪念日/跃迁（一次性，经 noteMilestone）
      // —— 降温（平缓，防断崖）——
      if (d.cold) inc -= 0.015 * (Number(d.coldDays) || 1);   // 连续 >3 天无对话
      if (d.conflict) inc -= 0.02;                                  // 冲突（谨慎）
      S.bond.warmth = clamp01(S.bond.warmth + inc);
      // 派生并覆写 S.relationship 快照（含 proact 计数器，整体重建会丢计数）
      var snap = relationshipLevel(S);
      S.relationship = S.relationship || {};
      S.relationship.warmth = snap.warmth;
      S.relationship.stage = 'L' + snap.lv;
      S.relationship.stageName = snap.name;
      S.relationship.since = S.relationship.since || (S.dating && S.dating.since) || (S.firstMeet || 0);
      S.relationship.updatedAt = Date.now();
      S.relationship.proact = S.relationship.proact || { day: '', count: 0, lastAt: 0 };
      snap.jumped = snap.lv > prev.lv;
      snap.prevLv = prev.lv;
      snap.prevName = prev.name;
      // 阶段跃迁记里程碑（bond-memory 写责任收敛）
      if (snap.jumped) {
        try {
          if (G && G.BondMemory && typeof G.BondMemory.noteMilestone === 'function') {
            G.BondMemory.noteMilestone(S, { type: 'stage', label: prev.name + '→' + snap.name });
          }
        } catch (e) {}
      }
      return snap;
    } catch (e) {
      return { lv: 0, name: '初识', warmth: 0, nextWarmth: 0.05, jumped: false, prevLv: 0, prevName: '初识' };
    }
  }

  /* ════════════════════════════════════════════════════════════
   * 4 · 主动触发节律（M4）：包装 Engine.proactivePlan（只调用不重写），
   *   叠加 stage 白名单 + 权重重排 + reason 标注(P1-b) + 情境感知(P1-c)。
   *   返回与引擎同构的 plan[]（p.kind/text/expression/meta 不变 + {reason, stage}），
   *   dispatchProactive 的 kind 落库分支（story/care/slot）零改动。
   * ════════════════════════════════════════════════════════════ */
  function planByRelationship(S, ctx) {
    try {
      S = safeState(S);
      var base = [];
      try {
        var E = resolveEngine();
        if (E && typeof E.proactivePlan === 'function') base = E.proactivePlan(S, ctx) || [];
      } catch (e) { base = []; }
      if (!base.length) return [];
      var rel = relationshipLevel(S);
      var lv = rel.lv;
      // stage kind 白名单（PRD §4.3 主动性边界）
      var whitelist = {
        0: ['story', 'slot'],
        1: ['story', 'slot', 'care', 'random'],
        2: ['story', 'slot', 'care', 'random', 'miss', 'moodshare', 'daylife'],
        3: null,   // 全量
      }[lv];
      var uePolar = (S.ue && typeof S.ue.polarity === 'number') ? S.ue.polarity : 0;
      var out = [];
      for (var i = 0; i < base.length; i++) {
        var p = base[i];
        if (whitelist && whitelist.indexOf(p.kind) < 0) continue;
        var np = {};
        for (var k in p) { if (Object.prototype.hasOwnProperty.call(p, k)) np[k] = p[k]; }
        np.reason = reasonFor(p, rel, S);     // P1-b 可解释理由
        np.stage = lv;
        // 情境感知（P1-c）：用户疲惫/难过(polarity<−0.4) → 关心优先、random 抑制
        if (uePolar < -0.4 && p.kind === 'random') continue;
        out.push(np);
      }
      out.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
      return out;
    } catch (e) { return []; }
  }

  function reasonFor(p, rel, S) {
    try {
      switch (p.kind) {
        case 'miss': return '想你了，关系越深越会主动想念';
        case 'care': return '记得你说过的事，想关心你';
        case 'story': return '我们的故事还在继续';
        case 'slot': return '该给你打个招呼啦';
        case 'moodshare': return '今天心情想跟你念叨';
        case 'daylife': return '想起我们一起的生活碎片';
        case 'random': return '就是想跟你说话';
        default: return '主动关心你';
      }
    } catch (e) { return '主动关心你'; }
  }

  /* ════════════════════════════════════════════════════════════
   * 5 · 不打扰守门（M5，五重门，返回 { ok, why }）
   *   ① ConsentStore.get('proactive') === false → 停（用户关停）
   *   ② 当日主动条数 ≥ stage 日上限 → 停
   *   ③ 距上次主动 < stage 间隔下限 → 停
   *   ④ 深夜：23:00–01:00 上限减半+间隔×1.5；01:00–06:00 静默（纪念日当日例外一次）
   *   ⑤ herBusy（app.js 经 window.__xnBusy 标记，仅 herReply 进行中）→ 停
   * ════════════════════════════════════════════════════════════ */
  function shouldProactive(S) {
    try {
      S = safeState(S);
      // ① 用户关停
      try {
        if (G && G.ConsentStore) {
          var cs = (typeof G.ConsentStore.getInstance === 'function') ? G.ConsentStore.getInstance() : G.ConsentStore;
          if (cs && typeof cs.get === 'function' && cs.get('proactive') === false) return { ok: false, why: 'user-disabled' };
        }
      } catch (e) {}
      var rel = relationshipLevel(S);
      var st = STAGES['L' + rel.lv] || STAGES.L0;
      var now = Date.now();
      var day = todayKey(now);
      var pro = (S.relationship && S.relationship.proact) || { day: day, count: 0, lastAt: 0 };
      if (pro.day !== day) { pro.day = day; pro.count = 0; }
      // ② 当日上限
      if (pro.count >= st.dailyMax) return { ok: false, why: 'daily-max' };
      // ③ 间隔下限
      if (pro.lastAt && (now - pro.lastAt) < st.minGapMin * 60000) return { ok: false, why: 'gap' };
      // 纪念日当日（供深夜例外）
      var isAnniversaryDay = false;
      try { if (G && G.BondMemory && G.BondMemory.anniversaryScan) isAnniversaryDay = !!G.BondMemory.anniversaryScan(S, now); } catch (e) {}
      var hour = new Date(now).getHours();
      if (hour >= 1 && hour < 6) {
        // 01:00–06:00 静默（纪念日当日例外一次：count===0 放行）
        if (!(isAnniversaryDay && pro.count === 0)) return { ok: false, why: 'night-silent' };
      } else if (hour >= 23 || hour < 1) {
        // 23:00–01:00 上限减半 + 间隔×1.5
        var max2 = Math.max(1, Math.floor(st.dailyMax / 2));
        if (pro.count >= max2) return { ok: false, why: 'night-half' };
        if (pro.lastAt && (now - pro.lastAt) < st.minGapMin * 1.5 * 60000) return { ok: false, why: 'night-gap' };
      }
      // ⑤ herBusy（仅 herReply 进行中；checkProactive/interval 路径不置位，避免误杀）
      try { if (typeof window !== 'undefined' && window.__xnBusy) return { ok: false, why: 'busy' }; } catch (e) {}
      return { ok: true, why: 'ok' };
    } catch (e) { return { ok: false, why: 'err' }; }
  }

  /* ════════════════════════════════════════════════════════════
   * 6 · 主动消息计数落库：day 换日清零、count++、lastAt 更新。
   *   （app.js dispatch 成功后调用）
   * ════════════════════════════════════════════════════════════ */
  function noteProactive(S, now) {
    try {
      S = safeState(S);
      now = now || Date.now();
      S.relationship = S.relationship || {};
      S.relationship.proact = S.relationship.proact || { day: '', count: 0, lastAt: 0 };
      var day = todayKey(now);
      var pro = S.relationship.proact;
      if (pro.day !== day) { pro.day = day; pro.count = 0; }
      pro.count = (pro.count || 0) + 1;
      pro.lastAt = now;
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   * 7 · 阶段神态/语调微调（P1-d）：返回 { warmthAdd, tts }，供 app.js 非持久化消费。
   * ════════════════════════════════════════════════════════════ */
  function stageTone(S) {
    try {
      var lv = relationshipLevel(S).lv;
      return { warmthAdd: 0.02 * lv, tts: { speed: 1 + lv * 0.01, pitch: 1 + lv * 0.01 } };
    } catch (e) { return { warmthAdd: 0, tts: { speed: 1, pitch: 1 } }; }
  }

  /* ════════════════════════════════════════════════════════════
   * 8 · 对外门面（Engine.use + window 双挂载）
   * ════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.3',
    STAGES: STAGES,
    relationshipLevel: relationshipLevel,
    applyRelationshipDelta: applyRelationshipDelta,
    planByRelationship: planByRelationship,
    shouldProactive: shouldProactive,
    noteProactive: noteProactive,
    stageTone: stageTone,
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('proactivityCore', api);
  } catch (e) {}

  if (G) {
    G.ProactivityCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
