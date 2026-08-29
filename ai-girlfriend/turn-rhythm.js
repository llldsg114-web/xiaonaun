/**
 * turn-rhythm.js · 心屿 v4.4（Affect-Voice）· 话轮节奏调制
 * --------------------------------------------------------------------
 * ★ 本模块是**纯参数变换器**，不是文本改写器（架构 §4.3 的一处边界重定义）：
 *   输入 profile0 → 输出 profile1，**不碰任何字符串、不产生任何随机**。
 *   理由：若此处直接改文本（拆长句 / 注入换行），voice-style.applyStyle 又改一次，
 *   则同一文本被两遍分句、两遍改写，且两者顺序不可交换 → 不可复现、不可证明。
 *   改为参数层后，全链路只有 applyStyle 一个改写器，顺序唯一；且 AC-6 可以在
 *   参数层做**确定性**断言（无需统计 30 条样本）。文本层的停顿注入与长句拆分
 *   并未消失，只是归属 applyStyle，由 profile.pauseRate / profile.lenMean 驱动。
 *
 * 规则（架构 §9.1）：
 *   低情绪（sad / longing，intensity ≥ 0.5）→ 短句、多停顿、反问率下调、不开话题；
 *   高情绪（joy / coquettish，intensity ≥ 0.5）→ 长句、感叹率上调、主动开话题率上调；
 *   用户负向时不感叹（共情场景的礼貌约束）；
 *   多气泡场景按 turnIdx / totalTurns 做节奏分配（吸收 ReplyTexture.continuity，
 *   改用显式可测的 turnIdx —— F6 修正：ctx.isContinuation 在 app.js 从未传入，恒死）。
 *
 * 铁律：零依赖、零外发；纯函数（绝不原地改入参）；异常 → 原样返回入参；小暖不更名。
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
   * 1 · 常量区（★ 单点可调）
   * ══════════════════════════════════════════════════════════════════════ */
  var CONST = {
    RAMP_MIN: 0.50,          // 强度 < 0.5 不做情绪节奏调制（RAMP = 0）
    LOW_SET: ['sad', 'longing'],      // 低情绪态
    HIGH_SET: ['joy', 'coquettish'],  // 高情绪态

    LEN_SCALE: 0.25,         // 低/高情绪对句长的缩放幅度
    LEN_MIN: 10,             // 句长均值硬下限
    LEN_MAX: 30,             // 句长均值硬上限

    PAUSE_DELTA: 0.15,       // 低情绪停顿率增量
    PAUSE_MAX: 0.60,         // 停顿率上限
    PAUSE_SHRINK: 0.30,      // 高情绪停顿率收缩系数

    RHET_CUT: 0.50,          // 低情绪反问率下调系数（反问率只降不升，与保守档同向）

    TOPIC_CUT: 0.10,         // 低情绪主动开话题率下调量
    TOPIC_MIN: 0.05,         // 主动开话题率下限
    TOPIC_ADD: 0.10,         // 高情绪主动开话题率增量
    TOPIC_MAX: 0.50,         // 主动开话题率上限

    EXCLAIM_CUT: 0.60,       // 低情绪感叹率下调系数
    EXCLAIM_ADD: 0.15,       // 高情绪感叹率增量
    EXCLAIM_MAX: 0.60,       // 感叹率上限

    ELLIPSIS_ADD: 0.10,      // 低情绪省略号率增量
    ELLIPSIS_MAX: 0.55,      // 省略号率上限
    ELLIPSIS_SHRINK: 0.40,   // 高情绪省略号率收缩系数

    UE_NEG_POL: -0.40,       // 用户负向极性门（与 empathy-front 的 TRIGGER_POL 同值）
    EXCLAIM_UE_NEG: 0.30,    // 用户负向时感叹率乘子（共情场景不欢呼，礼貌约束）

    TURN_FIRST: 1.10,        // 多气泡：首条承载主体
    TURN_MID: 0.80,          // 多气泡：中段短句
    TURN_LAST: 0.85,         // 多气泡：末条收束
  };

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 工具（纯函数）
   * ══════════════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function clampNum(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function inSet(set, k) {
    for (var i = 0; i < set.length; i++) if (set[i] === k) return true;
    return false;
  }
  /** 强度斜坡：intensity < RAMP_MIN → 0；(1 − RAMP_MIN) 处线性升到 1。 */
  function ramp(intensity) {
    var i = clamp01(intensity);
    if (i <= CONST.RAMP_MIN) return 0;
    return clamp01((i - CONST.RAMP_MIN) / (1 - CONST.RAMP_MIN));
  }
  /** 深拷贝 profile（绝不原地改入参）。 */
  function cloneProfile(p) {
    var out = {};
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
      var v = p[k];
      if (v && typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Array]') {
        out[k] = cloneProfile(v);
      } else if (Object.prototype.toString.call(v) === '[object Array]') {
        out[k] = v.slice(0);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · modulate(profile, ctx) → profile1（纯参数变换，无随机、无字符串操作）
   *   ctx : { dom, intensity, stage, turnIdx, totalTurns, uePolarity }
   * ══════════════════════════════════════════════════════════════════════ */
  function modulate(profile, ctx) {
    try {
      if (!profile || typeof profile !== 'object') return profile;
      var c = (ctx && typeof ctx === 'object') ? ctx : {};
      var p = cloneProfile(profile);
      var dom = (typeof c.dom === 'string') ? c.dom : 'neutral';
      var intensity = clamp01(c.intensity);
      var R = ramp(intensity);

      // ── ① 低情绪：短句 / 多停顿 / 少反问 / 不开话题 / 少感叹 / 多省略 ──
      if (inSet(CONST.LOW_SET, dom) && R > 0) {
        p.lenMean = Math.max(CONST.LEN_MIN, p.lenMean * (1 - CONST.LEN_SCALE * R));
        p.pauseRate = Math.min(CONST.PAUSE_MAX, p.pauseRate + CONST.PAUSE_DELTA * R);
        p.rhetoricalRate = clamp01(p.rhetoricalRate * (1 - CONST.RHET_CUT * R));
        p.topicInitRate = Math.max(CONST.TOPIC_MIN, p.topicInitRate - CONST.TOPIC_CUT * R);
        p.exclaimRate = clamp01(p.exclaimRate * (1 - CONST.EXCLAIM_CUT * R));
        p.ellipsisRate = Math.min(CONST.ELLIPSIS_MAX, p.ellipsisRate + CONST.ELLIPSIS_ADD * R);
      }
      // ── ② 高情绪：长句 / 多感叹 / 主动开话题 / 少停顿 / 少省略 ──
      if (inSet(CONST.HIGH_SET, dom) && R > 0) {
        p.lenMean = Math.min(CONST.LEN_MAX, p.lenMean * (1 + CONST.LEN_SCALE * R));
        p.exclaimRate = Math.min(CONST.EXCLAIM_MAX, p.exclaimRate + CONST.EXCLAIM_ADD * R);
        p.pauseRate = clamp01(p.pauseRate * (1 - CONST.PAUSE_SHRINK * R));
        p.topicInitRate = Math.min(CONST.TOPIC_MAX, p.topicInitRate + CONST.TOPIC_ADD * R);
        p.ellipsisRate = clamp01(p.ellipsisRate * (1 - CONST.ELLIPSIS_SHRINK * R));
      }
      // ── ③ 用户负向时不感叹（共情场景的礼貌约束）──
      var uePol = isFinite(c.uePolarity) ? Number(c.uePolarity) : 0;
      if (uePol < CONST.UE_NEG_POL) p.exclaimRate = clamp01(p.exclaimRate * CONST.EXCLAIM_UE_NEG);

      // ── ④ 多气泡节奏分配（F6 修正：改用显式 turnIdx / totalTurns）──
      var total = (typeof c.totalTurns === 'number' && isFinite(c.totalTurns)) ? c.totalTurns : 1;
      var idx = (typeof c.turnIdx === 'number' && isFinite(c.turnIdx)) ? c.turnIdx : 0;
      if (total > 1) {
        if (idx <= 0) p.lenMean = p.lenMean * CONST.TURN_FIRST;
        else if (idx >= total - 1) p.lenMean = p.lenMean * CONST.TURN_LAST;
        else p.lenMean = p.lenMean * CONST.TURN_MID;
      }

      // ── ⑤ 数值兜底 ──
      p.lenMean = clampNum(p.lenMean, CONST.LEN_MIN, CONST.LEN_MAX);
      p.pauseRate = clamp01(p.pauseRate);
      p.rhetoricalRate = clamp01(p.rhetoricalRate);
      p.topicInitRate = clamp01(p.topicInitRate);
      p.exclaimRate = clamp01(p.exclaimRate);
      p.ellipsisRate = clamp01(p.ellipsisRate);
      p.selfDiscloseRate = clamp01(p.selfDiscloseRate);
      return p;
    } catch (e) {
      return profile;   // 降级：异常 → 原样返回入参
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.4',
    CONST: CONST,
    modulate: modulate,
    // 仅供测试与调试观测
    _ramp: ramp,
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('turnRhythm', api);
  } catch (e) {}

  if (G) {
    G.TurnRhythm = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
