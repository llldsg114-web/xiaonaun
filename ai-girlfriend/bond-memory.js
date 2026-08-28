/**
 * bond-memory.js · 心屿 v4.3（记忆深化 S4）· 关系记忆内核
 * --------------------------------------------------------------------
 * 小暖与用户的关系记忆层：共同回忆碎片 / 关系里程碑 / 情感锚点 / 线性衰减 /
 * 关系演进图谱 / 纪念日扫描。纯本地（随 S 落 localStorage xiaonuan_save_v1），
 * 绝不外发、绝不触碰冻结线（engine.js / sw.js / memory.js / test/baseline.js）。
 *
 * 铁律：
 *   · 只读消费 memory.js 接口（retrieveFacts / recallV2 / listFacts），绝不 applyPatch，
 *     bond-memory 是 memory.js 上层关系记忆层，绝不折回改写事实库。
 *   · 遗忘曲线 = 简单线性衰减（45 天）：eff = clamp01(importance − dt天/45)。
 *   · 记忆载体 = localStorage 的 S.bond.* 命名空间，无独立键、无 IndexedDB、无外发。
 *   · 全文件零外发字面量（无 fetch/XHR/WebSocket/sendBeacon/new URL/http(s):///import）。
 *   · 小暖不更名（`小暖`文案不硬编码进最终句，关系呼应用「我们/咱们」）。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self（兼容 Node 测试 shim）
  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  /** 解析 Engine（注册表）。Node 测试侧会把引擎挂到 globalThis.Engine。 */
  function resolveEngine() {
    try { if (typeof Engine !== 'undefined' && Engine) return Engine; } catch (e) {}
    try { if (G && G.Engine) return G.Engine; } catch (e) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.Engine) return globalThis.Engine; } catch (e) {}
    return null;
  }

  /* ════════════════════════════════════════════════════════════
   * 1 · 工具（纯函数）
   * ════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function safeState(S) { return (S && typeof S === 'object') ? S : {}; }
  function hashStr(s) {
    var h = 2166136261 >>> 0; s = '' + s;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function todayKey(ts) {
    var d = new Date(typeof ts === 'number' ? ts : Date.now());
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // 只读消费 memory.js 的 retrieveFacts（绝不写 memory.js 字节）
  function memoryMod() {
    try {
      var E = resolveEngine();
      if (E && typeof E.mod === 'function') return E.mod('memory');
    } catch (e) {}
    return null;
  }

  // 关系记忆默认结构（与 app.js defaultState 对齐，老档由 app.js load 兜底）
  function ensureBond(S) {
    S.bond = S.bond || {};
    if (!Array.isArray(S.bond.shards)) S.bond.shards = [];
    if (!Array.isArray(S.bond.milestones)) S.bond.milestones = [];
    if (typeof S.bond.warmth !== 'number') S.bond.warmth = 0;
    if (!S.bond.lastChatAt) S.bond.lastChatAt = 0;
    if (!S.bond.streak) S.bond.streak = 0;
    return S.bond;
  }

  // 线性衰减：读时派生，不回写 importance 基线（用一次记一次更牢）
  function effImportance(shard, now) {
    try {
      var base = (shard && typeof shard.importance === 'number') ? shard.importance : 0;
      var anchor = Math.max((shard.at || now), (shard.lastUsedAt || 0));
      var dtDays = (now - anchor) / 86400000;
      if (dtDays < 0) dtDays = 0;
      return clamp01(base - dtDays / 45);   // 45 天线性衰减至 0
    } catch (e) { return 0; }
  }

  // 呼应模板池（内置，克制；经 app.js safetyGuard 出口护栏）
  var ECHO_SHARP = [
    '对了，{topic}后来怎么样啦？我一直惦记着呢',
    '说到这个，我们之前聊过{topic}，你还记得不～',
    '诶，想起{topic}那件事，心里暖暖的'
  ];
  var ECHO_VAGUE = [
    '最近总想起咱们聊过的一些事，心里暖暖的',
    '有些一起说过的话，我偷偷记着呢',
    '跟你聊过的那些小事，我都放在心上了'
  ];
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ════════════════════════════════════════════════════════════
   * 2 · 关系级记忆碎片召回（M1）
   *   ctx: { text, ue, intent }（本轮用户输入）
   *   ① 概率门控 p=[0.06,0.14,0.24,0.34][stage]（呼应频率随关系等级）
   *   ② shards 取 effImportance×新鲜度 top，剔除 lastUsedAt 距今 <72h
   *   ③ retrieveFacts 只读二次确认（不写 memory.js）
   *   ④ vague 判定 → 选模板 → echo；命中即刷新 lastUsedAt（衰减时钟重置）
   *   返回 null 或 { id, topic, gist, vague, echo, usedFactId }
   * ════════════════════════════════════════════════════════════ */
  function bondRecall(S, ctx) {
    try {
      S = safeState(S);
      if (!S.firstMeet) return null;          // 未相遇不回忆
      var bond = ensureBond(S);
      var lv = relationLevelOf(S);
      var p = [0.06, 0.14, 0.24, 0.34][lv] || 0.06;
      if (Math.random() >= p) return null;     // 概率门控（克制引用）
      var shards = bond.shards || [];
      if (!shards.length) return null;
      var now = Date.now();
      var cands = [];
      for (var i = 0; i < shards.length; i++) {
        var s = shards[i];
        var eff = effImportance(s, now);
        if (eff <= 0) continue;
        if (s.lastUsedAt && (now - s.lastUsedAt) < 72 * 3600 * 1000) continue; // 72h 防重复
        var ageDays = (now - (s.at || now)) / 86400000;
        var fresh = 1 / (1 + ageDays / 30);    // 近 30 天权重高
        cands.push({ s: s, score: eff * 0.7 + fresh * 0.3 });
      }
      if (!cands.length) return null;
      cands.sort(function (a, b) { return b.score - a.score; });
      var best = cands[0].s;
      // 只读二次召回确认（仅提升置信，不写、不阻断）
      try {
        ctx = ctx || {};
        if (ctx.text) {
          var Mem = memoryMod();
          if (Mem && typeof Mem.retrieveFacts === 'function') {
            Mem.retrieveFacts(ctx.text, S, 2);  // 只读调用；结果用于潜在置信加权（此处不强制）
          }
        }
      } catch (e) {}
      var vague = effImportance(best, now) < 0.3;   // 模糊记忆：不逐字回填
      var echo = pick(vague ? ECHO_VAGUE : ECHO_SHARP).replace('{topic}', best.topic || '我们聊过的事');
      best.lastUsedAt = now;   // 惰性衰减时钟重置（用一次记一次更牢）
      return {
        id: best.id, topic: best.topic, gist: best.gist,
        vague: vague, echo: echo, usedFactId: null
      };
    } catch (e) { return null; }
  }

  /* ════════════════════════════════════════════════════════════
   * 3 · 共同回忆碎片写入（M1）
   *   turn: { text, gist, topic, intent, delta, now }
   *   里程碑 intent(love/confess/kiss) → kind:'milestone' importance 0.8
   *   高质量轮(delta≥4 或 深度) → kind:'chat' importance 0.5+
   *   幂等（id 去重）、上限 40 淘汰。刷新 lastChatAt / streak。
   * ════════════════════════════════════════════════════════════ */
  function bondWrite(S, turn) {
    try {
      S = safeState(S);
      var bond = ensureBond(S);
      turn = turn || {};
      var now = Date.now();
      var intent = turn.intent || '';
      var kind = 'chat', importance = 0.5;
      if (intent === 'love' || intent === 'confess' || intent === 'kiss') { kind = 'milestone'; importance = 0.8; }
      else if (intent === 'miss' || intent === 'concern' || intent === 'thanks' || intent === 'praise') { importance = 0.6; }
      if (typeof turn.delta === 'number' && turn.delta >= 4) importance = Math.max(importance, 0.6);
      var gist = turn.gist || (turn.text ? String(turn.text).slice(0, 40) : '');
      var topic = turn.topic || (gist ? gist.slice(0, 12) : '');
      if (!gist) return;   // 无内容不沉淀
      var id = 'b_' + hashStr((topic || 'we') + '|' + gist);
      var shards = bond.shards;
      var exist = null;
      for (var i = 0; i < shards.length; i++) { if (shards[i].id === id) { exist = shards[i]; break; } }
      if (exist) {
        exist.importance = Math.max(exist.importance || 0, importance);
        exist.lastUsedAt = now; exist.gist = gist; exist.topic = topic;
      } else {
        shards.push({ id: id, topic: topic, gist: gist, kind: kind, at: now, importance: importance, lastUsedAt: now, decayedAt: null });
      }
      // 上限 40，超容按有效重要度淘汰
      if (shards.length > 40) {
        shards.sort(function (a, b) { return effImportance(a, now) - effImportance(b, now); });
        bond.shards = shards.slice(shards.length - 40);
      }
      // 刷新 lastChatAt / streak（频次升温输入）
      if (!bond.lastChatAt) bond.lastChatAt = now;
      else {
        var dayDiff = Math.floor((now - bond.lastChatAt) / 86400000);
        if (dayDiff >= 1) bond.streak = (dayDiff === 1) ? (bond.streak || 0) + 1 : 1;
        bond.lastChatAt = now;
      }
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   * 4 · 余温深化（P1-a）：每日 dailyNotes → 自动沉淀为 kind:'warmth' shard，
   *   并给 S.bond.warmth +0.004（微增量）。幂等（同日同 key 只加一次）。
   * ════════════════════════════════════════════════════════════ */
  function warmthDeepen(S, note) {
    try {
      S = safeState(S);
      var bond = ensureBond(S);
      var now = Date.now();
      var gist = (note && note.text) ? String(note.text).slice(0, 40) : '今天我们聊了一会儿';
      var key = (note && note.key) ? note.key : ('day-' + todayKey(now));
      var id = 'b_' + hashStr('warmth|' + key);
      var shards = bond.shards;
      var exist = null;
      for (var i = 0; i < shards.length; i++) { if (shards[i].id === id) { exist = shards[i]; break; } }
      if (!exist) {
        shards.push({ id: id, topic: '我们的日常', gist: gist, kind: 'warmth', at: now, importance: 0.65, lastUsedAt: now, decayedAt: null });
        if (shards.length > 40) { shards.sort(function (a, b) { return effImportance(a, now) - effImportance(b, now); }); bond.shards = shards.slice(-40); }
      }
      bond.warmth = clamp01((bond.warmth || 0) + 0.004);
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   * 5 · 线性衰减巡检（M2）：遍历 shards 计算 effImportance，首次跌破 0.3 记 decayedAt。
   *   惰性计算、纯读派生，不建定时器。init() 调用一次。
   * ════════════════════════════════════════════════════════════ */
  function decayShards(S, now) {
    try {
      S = safeState(S);
      var bond = ensureBond(S);
      now = now || Date.now();
      var shards = bond.shards || [];
      for (var i = 0; i < shards.length; i++) {
        var s = shards[i];
        var eff = effImportance(s, now);
        if (eff < 0.3 && !s.decayedAt) s.decayedAt = now;
      }
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   * 6 · 关系演进图谱（M1/P2-a 数据源）：派生自 S.firstMeet / S.dating.since /
   *   S.datingAnnis / S.bond.milestones / S.story，不重复存储。
   *   返回 { nodes:[{type,label,at}], daysTogether, daysDating, stage }
   * ════════════════════════════════════════════════════════════ */
  function relationshipGraph(S) {
    try {
      S = safeState(S);
      var now = Date.now();
      var daysTogether = S.firstMeet ? Math.max(1, Math.floor((now - S.firstMeet) / 86400000) + 1) : 1;
      var daysDating = (S.dating && S.dating.since) ? Math.max(1, Math.floor((now - S.dating.since) / 86400000) + 1) : 0;
      var nodes = [];
      if (S.firstMeet) nodes.push({ type: 'meet', label: '初次相遇', at: S.firstMeet });
      if (S.dating && S.dating.since) nodes.push({ type: 'dating', label: '在一起', at: S.dating.since });
      // 在一起纪念日（1/7/30/100/180/365）
      if (daysDating) {
        var ms = [1, 7, 30, 100, 180, 365];
        for (var k = 0; k < ms.length; k++) { if (daysDating >= ms[k]) nodes.push({ type: 'anniversary', label: '在一起 ' + ms[k] + ' 天', at: (S.dating.since + (ms[k] - 1) * 86400000) }); }
      }
      var bond = ensureBond(S);
      if (bond.milestones) bond.milestones.forEach(function (m) { nodes.push({ type: m.type, label: m.label, at: m.at }); });
      var lv = relationLevelOf(S);
      return { nodes: nodes, daysTogether: daysTogether, daysDating: daysDating, stage: lv };
    } catch (e) { return { nodes: [], daysTogether: 1, daysDating: 0, stage: 0 }; }
  }

  /* ════════════════════════════════════════════════════════════
   * 7 · 纪念日临近扫描（M7）：在一起纪念日（1/7/30/100/180/365 天）临近 ≤3 天
   *   → 返回 { type:'longing', intensity:0.6 }，由 app.js 喂 EmotionCore.moodTick；否则 null。
   * ════════════════════════════════════════════════════════════ */
  function anniversaryScan(S, now) {
    try {
      S = safeState(S);
      now = now || Date.now();
      if (!S.dating || !S.dating.since) return null;
      var dDays = Math.max(1, Math.floor((now - S.dating.since) / 86400000) + 1);
      var targets = [1, 7, 30, 100, 180, 365];
      for (var i = 0; i < targets.length; i++) {
        var diff = targets[i] - dDays;
        if (diff >= 0 && diff <= 3) return { type: 'longing', intensity: 0.6, label: '在一起' + targets[i] + '天纪念日临近' };
      }
      return null;
    } catch (e) { return null; }
  }

  /* ════════════════════════════════════════════════════════════
   * 8 · 里程碑登记：由 proactivity-core 在阶段跃迁时调用（写责任收敛于 bond-memory）。
   * ════════════════════════════════════════════════════════════ */
  function noteMilestone(S, m) {
    try {
      S = safeState(S);
      var bond = ensureBond(S);
      bond.milestones = bond.milestones || [];
      m = m || {};
      bond.milestones.push({ type: m.type || 'stage', label: m.label || '', at: Date.now() });
      if (bond.milestones.length > 60) bond.milestones = bond.milestones.slice(-60);
    } catch (e) {}
  }

  /* ════════════════════════════════════════════════════════════
   * 9 · 清除关系记忆（PRD §7.4）：S.bond 归零重建，清除即不残留。
   * ════════════════════════════════════════════════════════════ */
  function reset(S) {
    try {
      S = safeState(S);
      S.bond = { warmth: 0, shards: [], milestones: [], lastChatAt: 0, streak: 0 };
    } catch (e) {}
  }

  // 内部：关系等级（复用 proactivity-core 的派生口径；模块缺席时本地降级计算，避免硬耦合）
  function relationLevelOf(S) {
    try {
      if (G && G.ProactivityCore && typeof G.ProactivityCore.relationshipLevel === 'function') {
        return G.ProactivityCore.relationshipLevel(S).lv || 0;
      }
    } catch (e) {}
    // 降级：仅按好感度粗分（保证 bondRecall 门控永不崩）
    var aff = Number(safeState(S).affection) || 0;
    var lv = Math.min(3, Math.floor(aff / 250));
    return lv < 0 ? 0 : lv;
  }

  /* ════════════════════════════════════════════════════════════
   * 10 · 对外门面（Engine.use + window 双挂载）
   * ════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.3',
    bondRecall: bondRecall,
    bondWrite: bondWrite,
    warmthDeepen: warmthDeepen,
    decayShards: decayShards,
    relationshipGraph: relationshipGraph,
    anniversaryScan: anniversaryScan,
    noteMilestone: noteMilestone,
    reset: reset,
    effImportance: effImportance,   // 仅供测试观测
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('bondMemory', api);
  } catch (e) {}

  if (G) {
    G.BondMemory = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
