/**
 * dialogue-core.js · 心屿 v4.1（语言+情绪核心）· S1 语言交流系统
 * --------------------------------------------------------------------
 * 恋人语气一致性护栏 + 不机械去重（复用候选 F LRU 范式）+ 情境呼应占位。
 * 挂 Engine.use("dialogueCore", api)，并挂 window.DialogueCore 供宿主消费。
 *
 * 设计要点（架构 ARCH-xinyu-v4-systems.md §3.2 / §11）：
 *   · dialogueWeave：进程内近 N 条同池去重（LRU，不写 S）；命中近 N 条 verbatim 复读 →
 *     轻变体破复读（前置柔接，不重写语义），直接压低 G1 复读率。
 *   · 情境呼应：v4.1 用空 bond-memory 占位（返回空）+ 候选 F recallV2 兜底；真实呼应留 v4.3。
 *   · consistencyGuard：跨会话语气/价值观漂移检测雏形（v4.1 返回 true，落全于 v4.3）。
 *   · 降级安全：任一异常 → 原句直出，绝不静默、绝不白屏。
 *   · 零依赖、零外发：全文件不含 fetch/XHR/WebSocket/sendBeacon/import/URL/new URL/http(s)://。
 *
 * 铁律：不触碰冻结线 engine.js/sw.js/memory.js/test/baseline.js。
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
   * 1 · 进程内去重 LRU（复用候选 F 思路：不写 S，仅本模块内存）
   * ══════════════════════════════════════════════════════════════════════ */
  var RECENT_MAX = 12;        // 近 12 条同池去重窗口
  var recentPool = [];        // 归一化回复 LRU

  // 轻变体柔接词（破 verbatim 复读，不重写语义，不引入角色名硬编码）
  var VARIANTS = ['嗯，', '其实呀，', '说真的，', '欸，', '就是嘛，', '你猜呢，', '我在想，', '刚才呀，'];

  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function norm(s) {
    return ('' + (s || '')).replace(/[\s，。！？、~～…,.!?；;：:"'""'()（）\[\]【】]/g, '').trim();
  }
  function isRepeat(s) {
    var n = norm(s);
    if (!n) return false;
    return recentPool.indexOf(n) >= 0;
  }
  function pushRecent(s) {
    var n = norm(s);
    if (!n) return;
    recentPool.push(n);
    if (recentPool.length > RECENT_MAX) recentPool.shift();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 情境呼应占位（v4.1：空 bond-memory → 返回空；v4.3 接真实呼应）
   * ══════════════════════════════════════════════════════════════════════ */
  function situationRecall(state, mem) {
    try {
      // v4.1 占位：bond-memory 未落地 → 无真实呼应碎片。候选 F recallV2 由引擎侧兜底，
      // 本层不重复引用，避免与引擎/ReplyTexture 双加工。真实情境呼应留 v4.3 bond-memory.js。
      if (mem && Array.isArray(mem.shards) && mem.shards.length) {
        // 预留：v4.3 关系级记忆碎片克制引用（≤1 条/轮），此处先返回空占位。
        return '';
      }
      return '';
    } catch (e) { return ''; }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 主入口：dialogueWeave（去重 + 呼应占位 + 语气一致性）
   *   @param text  候选回复
   *   @param ctx   { ue, moodState, bondMem, S }（只读来源，绝不写回）
   *   @returns 编织后文本（去重变体 / 原句 / 原句直出）
   * ════════════════════════════════════════════════════════════════════════ */
  function dialogueWeave(text, ctx) {
    try {
      if (typeof text !== 'string' || !text.trim()) return text;
      ctx = ctx || {};
      // ① 不机械去重（复用候选 F LRU 范式）：命中近 N 条同池 verbatim 复读 → 轻变体破复读
      if (isRepeat(text)) {
        var v = VARIANTS[hashStr(text) % VARIANTS.length];
        text = v + text;   // 前置柔接：破 verbatim 复读，不重写语义、不破坏破墙表
      }
      // ② 情境呼应占位（v4.1 返回空；v4.3 接 bond-memory 后在此克制拼接 ≤1 条/轮）
      //    此处不主动拼接，避免与引擎/ReplyTexture 的 recall 双加工。
      // ③ 维护 LRU（仅本模块内存，不落 S）
      pushRecent(text);
      return text;
    } catch (e) {
      return text;   // 任一异常 → 原句直出，绝不静默 / 白屏
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 跨会话语气/价值观一致性护栏（v4.1 雏形：返回 true；落全于 v4.3）
   * ════════════════════════════════════════════════════════════════════════ */
  function consistencyGuard(state) {
    try {
      // v4.1 雏形：仅做结构性存在性校验（S.persona 存在即视为一致）。
      // v4.3 落全：跨会话语气/价值观漂移评分 ≥4.0（复用 E.detectCrisis / PERSONA_BREAK_RE 护栏）。
      return !!(state && state.persona);
    } catch (e) { return true; }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 对外门面（Engine.use + window 双挂载）
   * ════════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.1',
    RECENT_MAX: RECENT_MAX,
    VARIANTS: VARIANTS.slice(),
    dialogueWeave: dialogueWeave,
    situationRecall: situationRecall,
    consistencyGuard: consistencyGuard,
    // 仅供测试：重置 LRU
    resetDedup: function () { recentPool = []; },
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('dialogueCore', api);
  } catch (e) {}

  if (G) {
    G.DialogueCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
