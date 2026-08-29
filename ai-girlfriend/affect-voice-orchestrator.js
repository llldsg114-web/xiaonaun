/**
 * affect-voice-orchestrator.js · 心屿 v4.4（Affect-Voice）· 统一编排门面
 * --------------------------------------------------------------------
 * ★ 唯一对 app.js 暴露的入口（F0 / F3 收口）。五步管道，单向数据流、无回环：
 *
 *     ① VoiceStyle.profileFor(dom, intensity, stage, blend)      → profile0（参数）
 *     ② TurnRhythm.modulate(profile0, ctx)                       → profile1（纯参数变换）
 *     ③ EmpathyFront.front(text, ctx, rng)                       → text'（首句共情）
 *     ④ skipDims := (textured ∧ hasMicroBehavior) ? 让位 : 不让位 → F5 双条件
 *     ⑤ VoiceStyle.applyStyle(text', profile1, rng, opts)        → text''（唯一改写器）
 *     ⑥ guard + describe(trace)
 *
 * ★ F5 修正（本模块的核心防呆）：本地引擎分支（app.js:1445）**无条件**置 textured = true，
 *   而 texture.js 的 textureAllow() 有 6 道门（lv ≥ 2 / 非首日 / 非危机 / 非负向高唤醒 /
 *   日配额 < 6 / 总开关），任一不满足时 texture 一字未改 —— 若照候选 F 的口径无条件让位，
 *   lv0–lv1 新用户的文风耦合会 100% 失效（他们恰恰最需要真人感）。
 *   故判据必须是**双条件**：分支标记 textured ∧ 文本级 hasMicroBehavior()。
 *
 * ★ 降级铁律：任一模块缺席 / 抛错 → 该步跳过，其余步骤继续执行；全失败 → 原句直出。
 *   setConfig({ enabled: false }) → 首行原样返回（AC-8③）。绝不白屏、绝不静默。
 *
 * 铁律：零依赖、零外发、零网络字面量；零 DOM、零 localStorage、零定时器（S 由 app.js 传入）；
 *       小暖不更名；不触碰冻结线四文件；emotion-core.js / reply-texture-orchestrator.js 零改动。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self（兼容 Node 测试 shim 与浏览器）
  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  /** 解析 Engine（注册表）。 */
  function resolveEngine() {
    try { if (typeof Engine !== 'undefined' && Engine) return Engine; } catch (e) {}
    try { if (G && G.Engine) return G.Engine; } catch (e) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.Engine) return globalThis.Engine; } catch (e) {}
    return null;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 1 · 配置（总开关 / 维度开关；仅内存，绝不落盘）
   * ══════════════════════════════════════════════════════════════════════ */
  var CFG = {
    enabled: true,      // 总开关：置 false → orchestrate 首行原样返回（AC-8③）
    empathy: true,      // ③ 共情前置
    rhythm: true,       // ② 话轮节奏（参数层）
    style: true,        // ⑤ 文风改写（文本层）
    maxDeltaLen: 0,     // 0 → 由 applyStyle 按文本长度自算（voice-style CONST.DELTA_*）
  };
  var DEFAULT_CFG = { enabled: true, empathy: true, rhythm: true, style: true, maxDeltaLen: 0 };

  /* 8 态键（与 emotion-core / sense-core 逐一同名）；VoiceStyle 缺席时的本地兜底 */
  var DOM_KEYS = ['neutral', 'joy', 'anger', 'sad', 'coquettish', 'jealous', 'longing', 'peaceful'];
  /* 8 态 moodState.key 的本地兜底校验（与 VoiceStyle.PROFILES 一致） */

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 工具
   * ══════════════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function nowMs() {
    try { return (typeof performance !== 'undefined' && performance && performance.now) ? performance.now() : Date.now(); }
    catch (e) { return Date.now(); }
  }
  function safeRng(rng) { return (typeof rng === 'function') ? rng : Math.random; }
  function normalizeStage(raw) {
    if (typeof raw === 'string' && /^L[0-3]$/.test(raw)) return raw;
    return 'L0';
  }

  /** 模块解析：window 全局优先（index.html 顺序装载），回落 Engine 注册表。 */
  function resolveMod(globalName, engineName) {
    try {
      if (G && G[globalName]) return G[globalName];
    } catch (e) {}
    try {
      var Eng = resolveEngine();
      if (Eng && typeof Eng.mod === 'function') return Eng.mod(engineName) || null;
    } catch (e) {}
    return null;
  }

  /** 用户情绪兜底（云端分支不产 ue，app.js:1394）。 */
  function safeUe(ue) {
    var u = (ue && typeof ue === 'object') ? ue : {};
    var pol = isFinite(u.polarity) ? Number(u.polarity) : 0;
    return {
      type: (typeof u.type === 'string') ? u.type : 'neutral',
      polarity: pol,
      intensity: clamp01(u.intensity),
      confidence: clamp01(u.confidence != null ? u.confidence : 1),
    };
  }

  /**
   * ★ F5 双条件判据的右半：文本级微行为探测。
   * 吸收并扩展 reply-texture-orchestrator.js 的 hasMicro()（增加 texture 的 HES 前缀词）。
   * 命中 → 说明本地引擎分支**确实**加工过文本，此时语气词/标点维度让位（防双加工）；
   * 未命中 → textured 只是分支标记（lv0–lv1 新用户 / 负向高唤醒 / 配额用尽），不让位。
   */
  function hasMicroBehavior(text) {
    var t = (typeof text === 'string') ? text : '';
    if (!t) return false;
    return /^[嗯唔诶哎哼欸嘿呵噢哦]/.test(t)             // 句首犹豫词（texture.tic / HES）
      || /[～~]/.test(t)                                  // texture 的波浪号
      || /…|‥/.test(t)                                    // texture 的 hes
      || /^(那个|其实|怎么说呢|就是|好像|唔)/.test(t)      // texture 的 HES 前缀
      || /^(看你|听你|你难过|辛苦啦|别慌|不怕)/.test(t);   // 已含共情回声
  }

  /** 主导态合法性校验：非 8 态之一 → neutral（绝不把脏 key 传进 profileFor）。 */
  function validDom(key, VS) {
    if (typeof key !== 'string' || !key) return 'neutral';
    try {
      if (VS && VS.PROFILES && VS.PROFILES[key]) return key;
    } catch (e) {}
    for (var i = 0; i < DOM_KEYS.length; i++) if (DOM_KEYS[i] === key) return key;
    return 'neutral';
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 五步管道 orchestrate(text, opts) → string
   *   opts : { state, ctx, rng }
   *     state : 只读 S（读 S.moodState / S.affect / S.relationship）
   *     ctx   : { ue, mood, intent, textured, moodState, stage,
   *               turnIdx, totalTurns, hasBondEcho, stabilize }
   * ══════════════════════════════════════════════════════════════════════ */
  var _lastTrace = null;

  function orchestrate(text, opts) {
    var src = (typeof text === 'string') ? text : '';
    var trace = {
      enabled: !!CFG.enabled, steps: [], dom: 'neutral', intensity: 0, stage: 'L0',
      profile0: null, profile1: null, skipDims: [], empathy: null,
      ops: [], textLen: src.length, deltaLen: 0, ms: 0, reverted: false, error: null,
    };
    _lastTrace = trace;
    if (!CFG.enabled || !src) return src;

    var t0 = nowMs();
    var out = src;
    try {
      var o = (opts && typeof opts === 'object') ? opts : {};
      var state = (o.state && typeof o.state === 'object') ? o.state : {};
      var c = (o.ctx && typeof o.ctx === 'object') ? o.ctx : {};
      var rng = safeRng(o.rng);

      var VS = resolveMod('VoiceStyle', 'voiceStyle');
      var TR = resolveMod('TurnRhythm', 'turnRhythm');
      var EF = resolveMod('EmpathyFront', 'empathyFront');
      var AFS = resolveMod('AffectState', 'affectState');

      /* ── 情绪读数：ctx.moodState > state.moodState > state.affect（经 toMoodState）── */
      var ms = null;
      if (c.moodState && typeof c.moodState.key === 'string') ms = c.moodState;
      else if (state.moodState && typeof state.moodState.key === 'string') ms = state.moodState;
      else if (AFS && state.affect && typeof AFS.toMoodState === 'function') {
        try { ms = AFS.toMoodState(state.affect); } catch (e) { ms = null; }
      }
      if (!ms) ms = { key: 'neutral', intensity: 0, since: 0, source: 'init', blend: null };

      var dom = validDom(ms.key, VS);
      var intensity = clamp01(ms.intensity);
      var stage = normalizeStage(c.stage || (state.relationship && state.relationship.stage));
      var blend = (ms.blend && typeof ms.blend === 'object') ? ms.blend : null;
      trace.dom = dom;
      trace.intensity = +intensity.toFixed(3);
      trace.stage = stage;

      var ue = safeUe(c.ue);
      var uePol = ue.polarity;
      var total = (typeof c.totalTurns === 'number' && c.totalTurns > 0) ? c.totalTurns : 1;
      var idx = (typeof c.turnIdx === 'number' && c.turnIdx >= 0) ? c.turnIdx : 0;
      // STABILIZE 门（与 affect-state / empathy-front 同门；三者各持一份只读副本）
      var stabilize = !!c.stabilize || (uePol <= -0.7 && ue.intensity >= 0.7);

      /* ── ① profile ── */
      var profile0 = null;
      if (VS && typeof VS.profileFor === 'function') {
        try {
          profile0 = VS.profileFor(dom, intensity, stage, blend);
          trace.steps.push('profile');
        } catch (e) { profile0 = null; trace.error = 'profile:' + (e && e.message); }
      }
      trace.profile0 = profile0;

      /* ── ② rhythm（纯参数变换）── */
      var profile1 = profile0;
      if (profile1 && TR && CFG.rhythm && typeof TR.modulate === 'function') {
        try {
          profile1 = TR.modulate(profile1, {
            dom: dom, intensity: intensity, stage: stage,
            turnIdx: idx, totalTurns: total, uePolarity: uePol,
          }) || profile1;
          trace.steps.push('rhythm');
        } catch (e) { profile1 = profile0; trace.error = 'rhythm:' + (e && e.message); }
      }
      trace.profile1 = profile1;

      /* ── ③ empathy（首句共情前置；与 bondFrag 经 hasBondEcho 互斥）── */
      if (EF && CFG.empathy && typeof EF.front === 'function') {
        try {
          var ectx = {
            ue: c.ue || null, stage: stage, hasBondEcho: !!c.hasBondEcho,
            textured: !!c.textured, turnIdx: idx, totalTurns: total,
            stabilize: stabilize, text: out,
          };
          var fr = EF.front(out, ectx, rng);
          if (fr && typeof fr.text === 'string' && fr.text) {
            out = fr.text;
            trace.empathy = fr.used || null;
            trace.steps.push('empathy');
          }
        } catch (e) { trace.error = 'empathy:' + (e && e.message); }
      }

      /* ── ④ 防双加工：分支标记 ∧ 文本级微行为（双条件，F5 修正）── */
      var skipDims = (!!c.textured && hasMicroBehavior(out)) ? ['particles', 'endPunct'] : [];
      trace.skipDims = skipDims.slice(0);

      /* ── ⑤ style（唯一的形式层改写器）── */
      if (VS && CFG.style && profile1 && typeof VS.applyStyle === 'function') {
        try {
          var sopts = {
            skipDims: skipDims,
            textured: !!c.textured,
            maxDeltaLen: (typeof o.maxDeltaLen === 'number' && o.maxDeltaLen > 0)
              ? o.maxDeltaLen : CFG.maxDeltaLen,
          };
          var res = VS.applyStyle(out, profile1, rng, sopts);
          if (res && typeof res.text === 'string' && res.text) {
            out = res.text;
            trace.ops = (res.trace && res.trace.ops) ? res.trace.ops : [];
            trace.reverted = !!(res.trace && res.trace.reverted);
            trace.steps.push('style');
          }
        } catch (e) { trace.error = 'style:' + (e && e.message); }
      }

      /* ── ⑥ guard：结果合法性兜底（护栏 PersonaCore.safetyGuard 在本管线之后，
       *     由 app.js 保证；这里只做"绝不返回空串/非字符串"的最后一道）── */
      if (!out || typeof out !== 'string') out = src;
    } catch (e) {
      trace.error = 'fatal:' + ((e && e.message) || e);
      out = src;   // 全失败 → 原句直出（逐字等同 v4.3）
    }

    trace.deltaLen = out.length - src.length;
    trace.ms = +(nowMs() - t0).toFixed(3);
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 配置与观测
   * ══════════════════════════════════════════════════════════════════════ */
  /** 合并式配置：只认已知键，未知键忽略（防误关总开关）。 */
  function setConfig(c) {
    try {
      var src2 = (c && typeof c === 'object') ? c : {};
      for (var k in DEFAULT_CFG) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_CFG, k)) continue;
        if (src2[k] === undefined) continue;
        if (k === 'maxDeltaLen') {
          CFG[k] = (typeof src2[k] === 'number' && src2[k] >= 0) ? src2[k] : DEFAULT_CFG[k];
        } else {
          CFG[k] = !!src2[k];
        }
      }
    } catch (e) {}
    return getConfig();
  }
  function getConfig() {
    return {
      enabled: CFG.enabled, empathy: CFG.empathy, rhythm: CFG.rhythm,
      style: CFG.style, maxDeltaLen: CFG.maxDeltaLen,
    };
  }
  function getLastTrace() { return _lastTrace; }

  /**
   * 人类可读的改写取证串（供 P1 R22 调试面板与 AC-11 盲评取证）。
   * @param trace 缺省为最近一次 orchestrate 的 trace
   */
  function describe(trace) {
    var t = trace || _lastTrace;
    if (!t) return '(v4.4 · 无 trace)';
    var parts = [];
    parts.push('enabled=' + (t.enabled ? '1' : '0'));
    parts.push('dom=' + t.dom + ' i=' + t.intensity + ' stage=' + t.stage);
    parts.push('steps=' + (t.steps.length ? t.steps.join('>') : '-'));
    var p = t.profile1 || t.profile0;
    if (p) {
      parts.push('len=' + (Number(p.lenMean) || 0).toFixed(1)
        + ' pause=' + (Number(p.pauseRate) || 0).toFixed(2)
        + ' excl=' + (Number(p.exclaimRate) || 0).toFixed(2)
        + ' ell=' + (Number(p.ellipsisRate) || 0).toFixed(2)
        + ' rhet=' + (Number(p.rhetoricalRate) || 0).toFixed(2));
    }
    parts.push('skip=' + (t.skipDims.length ? t.skipDims.join('+') : '-'));
    parts.push('empathy=' + (t.empathy || '-'));
    parts.push('ops=' + ((t.ops && t.ops.length) || 0));
    parts.push('delta=' + t.deltaLen + (t.reverted ? ' (reverted)' : ''));
    parts.push('ms=' + t.ms);
    if (t.error) parts.push('err=' + t.error);
    return parts.join(' | ');
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.4',
    orchestrate: orchestrate,
    setConfig: setConfig,
    getConfig: getConfig,
    describe: describe,
    getLastTrace: getLastTrace,
    // 供单测与调试观测（F5 双条件判据的右半，必须可独立断言）
    hasMicroBehavior: hasMicroBehavior,
    DOM_KEYS: DOM_KEYS.slice(0),
    _reset: function () { _lastTrace = null; setConfig(DEFAULT_CFG); },
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('affectVoice', api);
  } catch (e) {}

  if (G) {
    G.AffectVoice = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
