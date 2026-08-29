/**
 * affect-state.js · 心屿 v4.4（Affect-Voice）· 情绪动力学内核
 * --------------------------------------------------------------------
 * 小暖自身情绪的动力学层：8 维向量（simplex，Σ=1）+ 主导态 + 动量；阻尼插值推进、
 * L1 步长闸、强事件突破通道、镜像阻尼、STABILIZE 门控、跨话轮极性冲突过渡、
 * 时间衰减，并向下兼容输出 v4.1 的 moodState 结构。
 *
 * ★ 单一真源声明（Q5 / R23）：v4.4 起「情绪推进」由本模块承载。emotion-core.js
 *   的 inferMoodEvent 仍是**事件推断**的单一真源（零字节改动，本模块只消费其输出）；
 *   em.moodTick / em.decay 降级为**兼容路径**——仅在 AffectState 缺席 / 抛错 /
 *   老档尚无 S.affect 时启用。新代码请勿再调用 em.moodTick。
 *   （Q6=A：本说明只写在这里，emotion-core.js 逐字不动。）
 *
 * 铁律：零依赖、零外发；纯函数式（不原地改入参、不写外部 state，回写在 app.js）；
 *   降级安全（任一异常 → 返回上一态或 NEUTRAL，绝不抛、绝不静默、绝不白屏）；
 *   小暖不更名；不触碰冻结线 engine.js / sw.js / memory.js / test/baseline.js。
 *
 * ★ 主理人裁定落点（不可翻转）：
 *   · α（阻尼系数）= 0.45（Q3）；强事件阈值 0.80、滚动 24h ≤ 2 次（Q4）。
 *   · 惯性只作用于**强度与残量**；主导态在强事件下**必须允许当轮切换**
 *     （qa-v4-1-acceptance.test.js:100-101 的 G2 硬约束）。
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
   * 1 · 常量区（★ 单点可调；改这里即改全局手感）
   * ══════════════════════════════════════════════════════════════════════ */
  var CONST = {
    ALPHA: 0.45,            // ★ Q3 裁定：基础阻尼系数（每轮向目标向量逼近 45%）
    ALPHA_STRONG: 0.75,     // 强事件突破 / STABILIZE 时提速（PRD R2）
    ALPHA_TONE: {},         // P1 R19 tone 分化预留 {gentle:0.40,playful:0.55,tsundere:0.35,clingy:0.60}；
                            // 空表 → 一律回落 ALPHA，v4.4 无行为差异

    L1_MAX: 0.35,           // AC-2①：相邻两轮向量 L1 距离上限（常规轮）
    L1_MAX_STRONG: 0.60,    // AC-2②：强突破轮 L1 上限
    MAX_STEP: 0.25,         // AC-1①：单轮 |Δintensity| 上限（冗余保险，正常永不触发）
    MAX_STEP_STRONG: 0.45,  // AC-1②：强事件轮 |Δintensity| 上限（同为冗余保险）

    STRONG_THRESHOLD: 0.80, // ★ Q4 裁定：强事件阈值
    STRONG_MAX_24H: 2,      // ★ Q4 裁定：滚动 24h 强突破上限；第 3 次起降级为常规插值

    MIRROR_GAIN: 0.45,      // 特征 5：用户情绪冲量增益
    STAGE_GAIN: { L0: 0.6, L1: 0.8, L2: 1.0, L3: 1.15 },  // 镜像强度随关系深浅递进（G3）

    STABILIZE_POL: -0.7,    // STABILIZE 门：ue.polarity ≤ −0.7 ∧ intensity ≥ 0.7
    STABILIZE_INT: 0.7,
    STABILIZE_CAP: 0.40,    // 稳住时的目标强度上限（保 AC-5① 的 intensity ≤ 0.50）
    STABILIZE_ABSORB_POL: -0.85,  // 崩溃场景下被 STABILIZE 吸收的强事件极性界（见 §4-A）

    DECAY_PER_MIN: 0.06,    // 与 emotion-core.js:132 同速率（每 60s 回落 0.06）
    DOM_EPS: 0.08,          // intensity < 0.08 → 主导态判为 neutral

    /* D1 缓解 · 平静起跳加速（架构自有常量；置 0 即完全退回 PRD 线性口径）
     * 语义：START_BOOST 是**阈值**不是增量 —— 当前 intensity ≤ START_BOOST（处于平静）
     * 且本轮有明确事件时，本轮 α 提至 START_BOOST_ALPHA，把"0 → 0.6"由 ~9 轮压到 ~4 轮。
     * 真人语义：平静时被戳一下反应快，正在难过时被逗反应慢。 */
    START_BOOST: 0.25,
    START_BOOST_ALPHA: 0.70,

    // 8 维：与 emotion-core.js:36 EMOTIONS 逐一同名，保证 moodToExpr / moodToTTS 零改动
    DIMS: ['neutral', 'joy', 'anger', 'sad', 'coquettish', 'jealous', 'longing', 'peaceful'],
    ACTIVE_DIMS: ['joy', 'anger', 'sad', 'coquettish', 'jealous', 'longing', 'peaceful'],
    // 引擎 engine.js:1179 UE_POLARITY 的只读副本（F4 修正：7 类真实枚举）
    UE_POL: { joy: 1, affection: 0.9, neutral: 0, tired: -0.35, anxious: -0.65, sad: -0.85, angry: -0.9 },
    // 用户情绪类型 → 小暖自身维度（镜像映射）
    UE_MAP: {
      joy: 'joy', affection: 'peaceful', neutral: 'neutral',
      tired: 'peaceful', anxious: 'peaceful', sad: 'sad', angry: 'anger',
    },
    // 自身情绪极性：跨话轮冲突检测用（AC-2④）
    POLARITY: {
      joy: 1, coquettish: 0.6, peaceful: 0.2, neutral: 0,
      longing: -0.4, jealous: -0.5, anger: -0.9, sad: -1,
    },
  };

  var DIMS = CONST.DIMS;
  var ACTIVE = CONST.ACTIVE_DIMS;
  var DAY_MS = 86400000;

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
  /** 本地日键 'YYYY-M-D'（与项目既有口径一致）。 */
  function dayKey(ts) {
    try {
      var d = new Date(typeof ts === 'number' ? ts : nowTs());
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    } catch (e) { return ''; }
  }
  /** 用户情绪兜底：云端分支不产 ue（app.js:1394），一律走这里，绝不读空。 */
  function safeUe(ue) {
    var u = (ue && typeof ue === 'object') ? ue : {};
    var type = (typeof u.type === 'string' && CONST.UE_POL.hasOwnProperty(u.type)) ? u.type : 'neutral';
    return {
      type: type,
      polarity: isFinite(u.polarity) ? Number(u.polarity) : (CONST.UE_POL[type] || 0),
      intensity: clamp01(u.intensity),
      confidence: clamp01(u.confidence != null ? u.confidence : 1),
    };
  }
  function zeroVec() {
    var v = {};
    for (var i = 0; i < DIMS.length; i++) v[DIMS[i]] = 0;
    return v;
  }
  /** one-hot 与 neutral 的凸组合：{neutral: 1−I, [k]: I}，Σ ≡ 1。 */
  function oneHot(k, I) {
    var v = zeroVec();
    v.neutral = 1;
    if (k && v.hasOwnProperty(k) && k !== 'neutral') {
      var i = clamp01(I);
      v.neutral = 1 - i;
      v[k] = i;
    }
    return v;
  }
  /** 归一化到 simplex：非负截断 + Σ = 1（任何脏输入都能救回来）。 */
  function normalize(v) {
    var out = zeroVec(), sum = 0, i, k, x;
    for (i = 0; i < DIMS.length; i++) {
      k = DIMS[i];
      x = Number(v ? v[k] : 0);
      if (!isFinite(x) || x < 0) x = 0;
      out[k] = x;
      sum += x;
    }
    if (sum <= 0) { out.neutral = 1; return out; }
    for (i = 0; i < DIMS.length; i++) out[DIMS[i]] = out[DIMS[i]] / sum;
    return out;
  }
  /** 主导态：7 个非 neutral 分量中的 argmax；intensity < DOM_EPS → neutral。 */
  function argmaxDom(vec, intensity) {
    if (!(intensity >= CONST.DOM_EPS)) return 'neutral';
    var best = 'neutral', bv = -1;
    for (var i = 0; i < ACTIVE.length; i++) {
      var x = Number(vec[ACTIVE[i]]) || 0;
      if (x > bv) { bv = x; best = ACTIVE[i]; }
    }
    return best;
  }
  function cloneVec(v) {
    var out = zeroVec();
    for (var i = 0; i < DIMS.length; i++) out[DIMS[i]] = Number(v[DIMS[i]]) || 0;
    return out;
  }
  /** 8 维向量 L1 距离（供单测与闸断言）。 */
  function l1(a, b) {
    var s = 0;
    for (var i = 0; i < DIMS.length; i++) {
      s += Math.abs((Number(a && a[DIMS[i]]) || 0) - (Number(b && b[DIMS[i]]) || 0));
    }
    return s;
  }
  /** 滚动 24h 窗口裁剪。 */
  function pruneStrong(arr, now) {
    var out = [];
    var src = (arr && Object.prototype.toString.call(arr) === '[object Array]') ? arr : [];
    for (var i = 0; i < src.length; i++) {
      var ts = Number(src[i]);
      if (isFinite(ts) && (now - ts) < DAY_MS) out.push(ts);
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 状态构造 / 读取（老档兼容）
   * ══════════════════════════════════════════════════════════════════════ */
  function freshNeutral(now) {
    var t = (typeof now === 'number' && isFinite(now)) ? now : 0;
    return {
      vec: oneHot(null, 0), dom: 'neutral', intensity: 0, momentum: 0,
      since: t, source: 'init', strongAt: [], day: t ? dayKey(t) : '',
      _prevDom: 'neutral', _transition: null,
    };
  }
  function cloneAffect(a) {
    if (!a || typeof a !== 'object') return freshNeutral(0);
    var tr = a._transition;
    return {
      vec: cloneVec(a.vec || oneHot(null, 0)),
      dom: (typeof a.dom === 'string' && a.dom) ? a.dom : 'neutral',
      intensity: clamp01(a.intensity),
      momentum: isFinite(a.momentum) ? Number(a.momentum) : 0,
      since: isFinite(a.since) ? Number(a.since) : 0,
      source: (typeof a.source === 'string' && a.source) ? a.source : 'init',
      strongAt: (Object.prototype.toString.call(a.strongAt) === '[object Array]') ? a.strongAt.slice(0) : [],
      day: (typeof a.day === 'string') ? a.day : '',
      _prevDom: (typeof a._prevDom === 'string' && a._prevDom) ? a._prevDom : 'neutral',
      _transition: (tr && typeof tr === 'object' && tr.to) ? { to: tr.to } : null,
    };
  }

  /** 关系阶段归一化（Q10）：'stranger' / undefined / '' / 未知值 → 'L0'；'L0'..'L3' 原值返回。
   *  ★ 只做**读入**归一化，绝不改 app.js:412 的默认值。 */
  function normalizeStage(S) {
    try {
      var raw = (S && S.relationship && S.relationship.stage) || '';
      if (/^L[0-3]$/.test(raw)) return raw;
    } catch (e) {}
    return 'L0';
  }
  function normalizeStageValue(raw) {
    if (typeof raw === 'string' && /^L[0-3]$/.test(raw)) return raw;
    return normalizeStage({ relationship: { stage: raw } });
  }

  /** 安全读取 S.affect：老档无该字段 / 字段损坏 → 兜底 NEUTRAL，绝不白屏。 */
  function readState(S) {
    try {
      var a = (S && typeof S === 'object') ? S.affect : null;
      if (!a || typeof a !== 'object') return freshNeutral(0);
      var st = cloneAffect(a);
      st.vec = normalize(st.vec);
      st.intensity = clamp01(1 - st.vec.neutral);
      if (typeof st.dom !== 'string' || !st.dom) st.dom = argmaxDom(st.vec, st.intensity);
      return st;
    } catch (e) {
      return freshNeutral(0);
    }
  }

  /** 向下兼容输出 v4.1 契约的 moodState（blend / prev 为扩展字段，既有消费者零感知）。 */
  function toMoodState(affect) {
    try {
      var a = readState({ affect: affect });
      var blend = {}, I = a.intensity;
      for (var i = 0; i < ACTIVE.length; i++) {
        blend[ACTIVE[i]] = (I > 0) ? clamp01((Number(a.vec[ACTIVE[i]]) || 0) / I) : 0;
      }
      return {
        key: a.dom, intensity: +a.intensity.toFixed(3), since: a.since, source: a.source,
        blend: blend,          // 供 voice-style 做余韵混合
        prev: a._prevDom,      // 供 guard 做极性冲突检测
      };
    } catch (e) {
      return { key: 'neutral', intensity: 0, since: 0, source: 'init', blend: {}, prev: 'neutral' };
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 目标向量：onehot(evt) ⊕ 用户情绪冲量（镜像阻尼），Σ = 1
   * ══════════════════════════════════════════════════════════════════════ */
  function buildTarget(evtType, evtI, ue, stage) {
    var t = oneHot(evtType, evtI);
    var mType = CONST.UE_MAP[ue.type];
    if (mType && mType !== 'neutral' && ue.intensity > 0) {
      var g = CONST.MIRROR_GAIN * (CONST.STAGE_GAIN[stage] || 1);
      var k = clamp01(ue.intensity * ue.confidence);
      if (g > 0 && k > 0) {
        var raw = cloneVec(t);
        raw[mType] = (raw[mType] || 0) + g * k;
        t = normalize(raw);                    // 混入后重新归一化，绝不越出 simplex
      }
    }
    return normalize(t);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 核心推进 advance(prev, evt, ctx)
   *
   * ★ L1 蕴含证明（只需一把闸的理由）：设 v、t 为 Σ=1 的非负向量，d = s·(t − v)。
   *   因 Σ(t − v) = 0，有 d[neutral] = −Σ_{k≠neutral} d[k]，于是
   *   L1(d) = |d[neutral]| + Σ_{k≠neutral}|d[k]| ≥ 2·|d[neutral]|
   *   ⇒ |Δintensity| = |d[neutral]| ≤ L1(d)/2。故 L1 ≤ 0.35 ⇒ |Δi| ≤ 0.175 ≤ 0.25（AC-1①）；
   *     L1 ≤ 0.60 ⇒ |Δi| ≤ 0.30 ≤ 0.45（AC-1② / AC-2②）自动成立。
   *   MAX_STEP 保留为第二道冗余保险：触发即说明上游公式被改坏。
   * ══════════════════════════════════════════════════════════════════════ */
  function advance(prev, evt, ctx) {
    var p = readState({ affect: prev });
    try {
      var c = (ctx && typeof ctx === 'object') ? ctx : {};
      var now = (typeof c.now === 'number' && isFinite(c.now)) ? c.now : nowTs();
      var stage = (typeof c.stage === 'string' && /^L[0-3]$/.test(c.stage)) ? c.stage : normalizeStage(c.S);
      var ue = safeUe(c.ue);
      var prevIntensity = p.intensity, prevDom = p.dom;

      // ① 事件解析
      var evtType = null;
      if (evt && typeof evt.type === 'string' && ACTIVE.indexOf(evt.type) >= 0) evtType = evt.type;
      var evtI = clamp01(evt && evt.intensity);

      // ② STABILIZE 门控（US-3）：用户处于崩溃边缘 → 小暖稳住，不跟着崩
      var stabilize = !!(ue.polarity <= CONST.STABILIZE_POL && ue.intensity >= CONST.STABILIZE_INT);

      // ③ 强事件判定 + 滚动 24h 配额
      var isStrong = !!(evtType && evtI >= CONST.STRONG_THRESHOLD);
      var strongAt = pruneStrong(p.strongAt, now);
      var quotaOk = !!(isStrong && strongAt.length < CONST.STRONG_MAX_24H);

      /* §4-A · STABILIZE 与强事件突破的**唯一**交集处置（架构 §6.2 与 §6.6 未裁决）：
       * 用户已在崩溃门内、且本轮强事件属**负向共振态**（POLARITY ≤ −0.85，即 sad / anger）时，
       * 由 STABILIZE 吸收该强事件（不走突破通道、不消耗配额、不强制切 dom）——否则
       * 「崩溃 → inferMoodEvent 产 sad 0.8+ → 当轮 dom = sad」会让 AC-5① 的
       * "sad 占比 ≤ 0.40" 直接失守。其余强事件（醋/娇/喜/念）不受影响，仍当轮切换 → G2 完整保住。 */
      if (stabilize && isStrong && (CONST.POLARITY[evtType] || 0) <= CONST.STABILIZE_ABSORB_POL) {
        isStrong = false;
        quotaOk = false;
      }

      // ④ 目标向量 / α / 闸位 / source
      var target, alpha, l1Cap, maxStep, source;
      if (stabilize) {
        target = oneHot('peaceful', CONST.STABILIZE_CAP);   // 反向收敛，强度上限保 AC-5①
        alpha = CONST.ALPHA_STRONG;
        l1Cap = CONST.L1_MAX_STRONG;
        maxStep = CONST.MAX_STEP_STRONG;
        source = 'stabilize';
      } else {
        target = buildTarget(evtType, evtI, ue, stage);
        var tone = '';
        try { tone = (c.S && c.S.persona && c.S.persona.tone) || ''; } catch (e) { tone = ''; }
        alpha = (tone && isFinite(CONST.ALPHA_TONE[tone])) ? CONST.ALPHA_TONE[tone] : CONST.ALPHA;
        l1Cap = CONST.L1_MAX;
        maxStep = CONST.MAX_STEP;
        source = evtType ? 'userEvent' : 'decay';
      }

      // ⑤ 跨话轮极性冲突 → 强制 peaceful 过渡（AC-2④；强事件优先，跳过本闸）
      var targetDom = argmaxDom(target, clamp01(1 - target.neutral));
      var conflict = false, transition = p._transition;
      if (!isStrong && prevDom && targetDom && prevDom !== targetDom) {
        var pp = CONST.POLARITY[prevDom], tp = CONST.POLARITY[targetDom];
        if (typeof pp === 'number' && typeof tp === 'number' && (pp * tp) < 0) {
          conflict = true;
          target = oneHot('peaceful', 0.5);
          source = 'transition';
          transition = { to: targetDom };      // 到达 peaceful / neutral 后清除
        }
      }

      // ⑥ 强事件突破通道（Q4）：提速 + 放宽闸位（dom 的当轮强制切换在 ⑨ 执行）
      if (isStrong && quotaOk) {
        alpha = CONST.ALPHA_STRONG;
        l1Cap = CONST.L1_MAX_STRONG;
        maxStep = CONST.MAX_STEP_STRONG;
        source = 'userEvent';
      }

      // ⑦ 平静起跳加速（D1 缓解）：处于平静且有明确事件 → 本轮提速
      if (!stabilize && !conflict && evtType && prevIntensity <= CONST.START_BOOST
        && alpha < CONST.START_BOOST_ALPHA) {
        alpha = CONST.START_BOOST_ALPHA;
      }

      // ⑧ 阻尼插值 + L1 步长闸 + MAX_STEP 冗余保险
      var d = zeroVec(), L1d = 0, i, k;
      for (i = 0; i < DIMS.length; i++) {
        k = DIMS[i];
        d[k] = ((target[k] || 0) - (p.vec[k] || 0)) * alpha;
        L1d += Math.abs(d[k]);
      }
      if (L1d > l1Cap && L1d > 0) {
        var s1 = l1Cap / L1d;
        for (i = 0; i < DIMS.length; i++) d[DIMS[i]] = d[DIMS[i]] * s1;
      }
      var di = -d.neutral;                     // Δintensity
      if (Math.abs(di) > maxStep && Math.abs(di) > 0) {
        var s2 = maxStep / Math.abs(di);
        for (i = 0; i < DIMS.length; i++) d[DIMS[i]] = d[DIMS[i]] * s2;
      }
      var raw = zeroVec();
      for (i = 0; i < DIMS.length; i++) {
        k = DIMS[i];
        raw[k] = (p.vec[k] || 0) + d[k];
        if (raw[k] < 0) raw[k] = 0;
      }
      var vec = normalize(raw);
      var intensity = clamp01(1 - vec.neutral);

      /* ⑨ 主导态裁定：DOM_EPS 优先（近乎平静时无主导情绪）→ 强事件当轮强制切换
       * （G2 硬约束）→ STABILIZE 对 sad 的保护性强制切换 → 其余按 argmax 自然浮现。 */
      var dom;
      if (intensity < CONST.DOM_EPS) dom = 'neutral';
      else if (isStrong && quotaOk) dom = evtType;
      else if (stabilize && prevDom === 'sad') dom = 'peaceful';
      else dom = argmaxDom(vec, intensity);
      if (transition && (dom === 'peaceful' || dom === 'neutral')) transition = null;

      // ⑩ 组装新状态（绝不原地改 prev）
      return {
        vec: vec,
        dom: dom,
        intensity: intensity,
        momentum: +(intensity - prevIntensity).toFixed(6),
        since: (dom !== prevDom) ? now : (p.since || now),
        source: source,
        strongAt: quotaOk ? strongAt.concat([now]).slice(-CONST.STRONG_MAX_24H) : strongAt,
        day: dayKey(now),
        _prevDom: prevDom,
        _transition: transition,
      };
    } catch (e) {
      return p;   // 降级：返回上一态（首次调用则为平静态）
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 6 · 时间衰减 decay(state, dt)
   *   drop = min(intensity, dt/60000 × DECAY_PER_MIN)；非 neutral 分量按
   *   (1 − drop/intensity) 等比收缩，缩回的分量还给 neutral。
   * ══════════════════════════════════════════════════════════════════════ */
  function decay(state, dt) {
    var p = readState({ affect: state });
    try {
      var ms = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;
      if (ms <= 0) return cloneAffect(p);
      var drop = Math.min(p.intensity, (ms / 60000) * CONST.DECAY_PER_MIN);
      if (!(drop > 0)) return cloneAffect(p);

      var factor = (p.intensity - drop) / p.intensity;    // ∈ [0, 1)
      var raw = zeroVec(), i, k;
      for (i = 0; i < DIMS.length; i++) {
        k = DIMS[i];
        raw[k] = (k === 'neutral') ? (p.vec.neutral + drop) : ((p.vec[k] || 0) * factor);
        if (raw[k] < 0) raw[k] = 0;
      }
      var vec = normalize(raw);
      var intensity = clamp01(1 - vec.neutral);
      return {
        vec: vec,
        dom: argmaxDom(vec, intensity),
        intensity: intensity,
        momentum: +(intensity - p.intensity).toFixed(6),
        since: p.since,
        source: 'decay',
        strongAt: p.strongAt.slice(0),
        day: p.day,
        _prevDom: p._prevDom,
        _transition: p._transition,
      };
    } catch (e) {
      return cloneAffect(p);
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 7 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.4',
    CONST: CONST,
    DIMS: DIMS.slice(0),
    ACTIVE_DIMS: ACTIVE.slice(0),
    // 平静态工厂：调用得新对象（NEUTRAL_AFFECT()）；也可直接当只读常量读字段
    // （NEUTRAL_AFFECT.vec / .dom …），两种用法都成立，供宿主与测试各取所需。
    NEUTRAL_AFFECT: NEUTRAL_AFFECT,
    advance: advance,
    decay: decay,
    toMoodState: toMoodState,
    readState: readState,
    normalizeStage: normalizeStage,
    normalizeStageValue: normalizeStageValue,
    safeUe: safeUe,
    l1: l1,
  };

  function NEUTRAL_AFFECT(now) { return freshNeutral(now); }
  try {
    var _n = freshNeutral(0);
    for (var _k in _n) {
      if (Object.prototype.hasOwnProperty.call(_n, _k)) NEUTRAL_AFFECT[_k] = _n[_k];
    }
  } catch (e) {}

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('affectState', api);
  } catch (e) {}

  if (G) {
    G.AffectState = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
