/**
 * persona-core.js · 心屿 v4.1（语言+情绪核心）· S6 人格一致性内核（雏形）
 * --------------------------------------------------------------------
 * 跨系统 voice 一致性校验雏形 + 复用 E.detectCrisis / PERSONA_BREAK_RE 的危机/破墙护栏。
 * 挂 Engine.use("personaCore", api)，并挂 window.PersonaCore 供宿主消费。
 *
 * 设计要点（架构 ARCH-xinyu-v4-systems.md §3.2 / §11）：
 *   · safetyGuard：复用既有危机/破墙护栏，绝不放行 break-wall / 危机误放行；
 *     返回 false → 宿主回退原句（herReply 内 try/catch 兜底，绝不白屏）。
 *   · validateVoice：跨会话语气一致性校验（v4.1 雏形返回 true；落全于 v4.3）。
 *   · 降级安全：Engine 缺席 / 护栏 API 异常 → 保守放行（true），避免误伤正常回复。
 *   · 零依赖、零外发：全文件不含 fetch/XHR/WebSocket/sendBeacon/import/URL/new URL/http(s)://。
 *
 * 铁律：不触碰冻结线 engine.js/sw.js/memory.js/test/baseline.js；小暖不更名（文案经护栏，不硬编码）。
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

  /* ════════════════════════════════════════════════════════════════════════
   * 1 · 危机/破墙护栏（复用 E.detectCrisis + PERSONA_BREAK_RE）
   *   对「小暖的回复文本」做护栏：命中破墙表 / 危机误放行 → 拦截（false）。
   * ════════════════════════════════════════════════════════════════════════ */
  function safetyGuard(text) {
    try {
      var Eng = resolveEngine();
      if (!Eng) return true;   // 引擎缺席 → 保守放行（降级安全，绝不误伤）
      var t = (typeof text === 'string') ? text : '';
      // ① 危机误放行拦截：若回复文本仍触发危机护栏，绝不放行
      if (typeof Eng.detectCrisis === 'function') {
        try {
          var c = Eng.detectCrisis(t);
          if (c && c.level && c.level !== 'none') return false;
        } catch (e) {}
      }
      // ② 破墙表拦截：归一化后命中 PERSONA_BREAK_RE → 绝不放行
      if (Eng.PERSONA_BREAK_RE && typeof Eng.PERSONA_BREAK_RE.test === 'function') {
        var norm = (typeof Eng.pnorm === 'function') ? Eng.pnorm(t) : String(t);
        try { if (Eng.PERSONA_BREAK_RE.test(norm)) return false; } catch (e) {}
      }
      return true;
    } catch (e) {
      return true;   // 任一异常 → 保守放行，绝不误伤正常回复
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 跨会话语气一致性校验（v4.1 雏形：返回 true；落全于 v4.3）
   * ════════════════════════════════════════════════════════════════════════ */
  function validateVoice(state) {
    try {
      // v4.1 雏形：仅做结构性存在性校验（S.persona.tone 存在即视为一致）。
      // v4.3 落全：跨会话语气/价值观漂移评分 ≥4.0（复用危机/破墙护栏 + 语气谱比对）。
      return !!(state && state.persona && state.persona.tone);
    } catch (e) { return true; }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 对外门面（Engine.use + window 双挂载）
   * ════════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.1',
    safetyGuard: safetyGuard,
    validateVoice: validateVoice,
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('personaCore', api);
  } catch (e) {}

  if (G) {
    G.PersonaCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
