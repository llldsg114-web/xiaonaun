/**
 * emotion-core.js · 心屿 v4.1（语言+情绪核心）· S2 真人情绪系统
 * --------------------------------------------------------------------
 * 小暖自身情绪状态机（7 态：喜/怒/哀/娇/醋/念/安 + neutral），事件驱动推进 +
 * 时间衰减 + moodToExpr 映射到 EXPR_MAP。挂 Engine.use("emotionCore", api)，并挂
 * window.EmotionCore 供宿主消费。
 *
 * 设计要点（架构 ARCH-xinyu-v4-systems.md §3.2 / §11）：
 *   · moodState 优先级高于既有 S.emotion(V-A)：吃醋/撒娇等 V-A 九区未覆盖态由 moodState 承载。
 *   · 纯函数式 API，不写任何外部 state；回写责任在 app.js（沿用 herReply 既有范式）。
 *   · 降级安全：任一调用异常 → 返回现态/neutral，绝不抛错、绝不白屏。
 *   · 零依赖、零外发：全文件不含 fetch/XHR/WebSocket/sendBeacon/import/URL/new URL/http(s)://。
 *   · 小暖不更名：本模块为情绪引擎，文案均经护栏，不以角色名硬编码到最终句。
 *
 * 铁律：不触碰冻结线 engine.js/sw.js/memory.js/test/baseline.js。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self（兼容 Node 测试 shim 与浏览器）
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

  /* ════════════════════════════════════════════════════════════════════════
   * 1 · 情绪枚举（7 态 + neutral）
   * ══════════════════════════════════════════════════════════════════════ */
  var EMOTIONS = {
    neutral: 'neutral',     // 平静（默认/衰减目标）
    joy: 'joy',             // 喜
    anger: 'anger',         // 怒
    sad: 'sad',             // 哀（心疼你）
    coquettish: 'coquettish', // 娇（撒娇）
    jealous: 'jealous',     // 醋（吃醋）
    longing: 'longing',     // 念（想念）
    peaceful: 'peaceful',   // 安（安心）
  };

  var EMOTION_LABELS = {
    neutral: '平静', joy: '喜', anger: '怒', sad: '哀',
    coquettish: '娇', jealous: '醋', longing: '念', peaceful: '安',
  };

  /** moodState 结构（v4 跨文件统一）：
   *  { key: EMOTIONS.*, intensity: 0..1, since: ts, source: 'userEvent'|'decay'|'init' } */
  var NEUTRAL_STATE = { key: 'neutral', intensity: 0, since: 0, source: 'init' };
  var NEUTRAL_THRESHOLD = 0.12;   // 衰减到此强度以下 → 回落 neutral

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 工具（纯函数）
   * ══════════════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function nowTs() {
    try { return (typeof Date !== 'undefined') ? Date.now() : 0; } catch (e) { return 0; }
  }

  /** moodState → EXPR_MAP key（架构 §3.2 口径）。fallback 为既有 V-A 推导的表情。 */
  var EXPR_OF = {
    neutral: 'normal', joy: 'happy', anger: 'angry', sad: 'sad',
    coquettish: 'coquettish', jealous: 'jealous', longing: 'longing', peaceful: 'peaceful',
  };
  function moodToExpr(moodState, fallback) {
    try {
      var key = (moodState && moodState.key) ? moodState.key : 'neutral';
      var expr = EXPR_OF[key];
      if (expr) return expr;
      return (fallback && typeof fallback === 'string') ? fallback : 'normal';
    } catch (e) {
      return (fallback && typeof fallback === 'string') ? fallback : 'normal';
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 事件推断（用户输入/共情 → 小暖自身情绪事件）
   *   仅做「事件→态」映射，不含任何生成；返回 { type, intensity } 或 null。
   * ══════════════════════════════════════════════════════════════════════ */
  var JEALOUS_RE = /(别人|他|她|前任|前女友|前男友|喜欢的人|暧昧|撩|别的女生|别的男生|备胎|海王|渣)/;
  function inferMoodEvent(text, intent, ue) {
    try {
      var t = (typeof text === 'string') ? text : '';
      var it = (typeof intent === 'string') ? intent : '';
      // 吃醋：用户提及第三方/疑似暧昧 → 小暖醋意（V-A 九区未覆盖态，由 moodState 承载）
      if (JEALOUS_RE.test(t)) return { type: 'jealous', intensity: 0.8 };
      if (it === 'love' || it === 'miss' || it === 'kiss') return { type: 'coquettish', intensity: 0.85 };
      if (it === 'praise') return { type: 'joy', intensity: 0.7 };
      if (it === 'thanks' || it === 'concern') return { type: 'peaceful', intensity: 0.6 };
      if (it === 'sad' || it === 'sorry') return { type: 'sad', intensity: 0.7 };
      if (it === 'bye') return { type: 'longing', intensity: 0.6 };
      // 用户负向高唤醒（共情）：小暖亦跟着软下来
      if (ue && ue.polarity < 0 && ue.intensity > 0.4) return { type: 'sad', intensity: clamp01(ue.intensity) };
      return null;
    } catch (e) { return null; }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 状态机推进 / 衰减（纯函数，不可变返回）
   * ══════════════════════════════════════════════════════════════════════ */

  /** moodTick：事件驱动推进 S.moodState（7 态之一）。
   *   @param evt   { type: EMOTIONS.*, intensity: 0..1 } 来自 inferMoodEvent / 共情
   *   @param emotion 既有 S.emotion(V-A)（仅占位参数，保留签名兼容；moodState 优先级更高）
   *   @param rel     S.relationship（占位参数，v4.3 关系阶段感知用）
   *   @returns 新 moodState 或 null（无有效事件 → 不推进，调用方保留现态） */
  function moodTick(evt, emotion, rel) {
    try {
      if (!evt || !evt.type || !EMOTIONS[evt.type]) return null;
      var intensity = clamp01(evt.intensity != null ? evt.intensity : 0.7);
      return { key: evt.type, intensity: intensity, since: nowTs(), source: 'userEvent' };
    } catch (e) { return null; }
  }

  /** decay：时间衰减 moodState.intensity → neutral。
   *   @param moodState 当前态
   *   @param dt        距上次推进的毫秒差（0 或不传 → 不衰减，原样返回）
   *   @returns 衰减后 moodState（新对象） */
  function decay(moodState, dt) {
    try {
      if (!moodState || !moodState.key) return cloneState(NEUTRAL_STATE);
      var d = (typeof dt === 'number' && dt > 0) ? dt : 0;
      var rate = 0.06 / 60000;   // 约每 60s 自然回落 0.06
      var intensity = clamp01((moodState.intensity || 0) - rate * d);
      var key = moodState.key;
      if (intensity < NEUTRAL_THRESHOLD) key = 'neutral';
      return {
        key: key,
        intensity: intensity,
        since: moodState.since || 0,
        source: (key === 'neutral') ? 'decay' : (moodState.source || 'userEvent'),
      };
    } catch (e) {
      return cloneState(moodState || NEUTRAL_STATE);
    }
  }

  function cloneState(s) {
    try { return { key: s.key, intensity: s.intensity, since: s.since || 0, source: s.source || 'init' }; }
    catch (e) { return { key: 'neutral', intensity: 0, since: 0, source: 'init' }; }
  }

  /** currentMoodState：安全读取 S.moodState（缺省回 neutral）。 */
  function currentMoodState(S) {
    try {
      if (S && S.moodState && S.moodState.key) return cloneState(S.moodState);
    } catch (e) {}
    return cloneState(NEUTRAL_STATE);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.1',
    EMOTIONS: EMOTIONS,
    EMOTION_LABELS: EMOTION_LABELS,
    STATES: EMOTIONS,          // 类图口径别名
    EXPR_OF: EXPR_OF,
    NEUTRAL_STATE: cloneState(NEUTRAL_STATE),
    moodTick: moodTick,
    decay: decay,
    moodToExpr: moodToExpr,
    currentMoodState: currentMoodState,
    inferMoodEvent: inferMoodEvent,
    // 仅供测试：重置/归一化
    _cloneState: cloneState,
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('emotionCore', api);
  } catch (e) {}

  if (G) {
    G.EmotionCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
