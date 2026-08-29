/**
 * empathy-front.js · 心屿 v4.4（Affect-Voice）· 共情前置
 * --------------------------------------------------------------------
 * 用户处于负向情绪时，把回复的**首句**替换为一句共情，再跟信息。
 * 分档键为**引擎真实 7 类 ue.type × 关系阶段 L0–L3**（★ F4 修正：
 * ReplyTexture 的 MIRROR 键集是 {sad,tired,lonely,anxious,happy,excited}，
 * 与引擎 engine.js:1179 的 7 类真实枚举只对上 3 类，happy/excited/lonely 永不出现；
 * 本模块内置 UE_POL 只读副本并以 7 类为键，杜绝同类错配向下蔓延）。
 *
 * 触发判据（架构 §8.1）：
 *   ue 存在 ∧（ue.polarity < −0.4 ∨ UE_POL[ue.type] < −0.4）
 *          ∧ ue.intensity ≥ 0.35 ∧ !hasBondEcho ∧ turnIdx === 0 ∧ 首句尚未含共情词
 *
 * 分层句池：sad / angry / anxious 三类 × L0(6) +L1(3) +L2(3) +L3(3) = 每类 15 条，
 *   可用池 = 累积到当前 stage 且**优先从最深层取样**（越亲密越敢说 → G3）。
 *   （tired / affection / joy / neutral 不触发：疲惫不是崩溃，由 peaceful 文风承接。）
 * STABILIZE 托底档：ue.polarity ≤ −0.7 ∧ intensity ≥ 0.7 时**强制**使用托底句池
 *   （不抽样、不降级），保 AC-5② 的托底句式命中 ≥ 0.60。
 *
 * 铁律：零依赖、零外发；模块内 LRU 仅存于内存（不写 S，与 dialogue-core 同范式）；
 *       任一异常 → 原句直出；小暖不更名（句池均为通用情绪表达，不含角色名）。
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
    TRIGGER_POL: -0.4,     // 触发共情的极性门（与 PRD 特征 3 的 ue.polarity < −0.4 同值）
    MIN_INTENSITY: 0.35,   // 触发共情的强度门（弱情绪不打扰）
    LRU_MAX: 12,           // 模块内复读抑制窗口（近 12 条不复用，不写 S）
    DEEP_PREF: 0.65,       // 优先从最深层句池取样的概率（G3：越亲密越敢说）
    DEEP_TRY: 5,           // 前 N 次尝试走深层，之后回落全池
    MAX_TRY: 8,            // 避开 LRU 的最大尝试次数

    /* ── STABILIZE 托底门（与 affect-state 的 STABILIZE_* 同门，双模块各持一份只读副本）── */
    STABILIZE_POL: -0.7,
    STABILIZE_INT: 0.7,

    /* ── ue.type 极性（engine.js:1179 UE_POLARITY 的只读副本，7 类真实枚举）── */
    UE_POL: { joy: 1, affection: 0.9, neutral: 0, tired: -0.35, anxious: -0.65, sad: -0.85, angry: -0.9 },

    STAGE_ORDER: ['L0', 'L1', 'L2', 'L3'],
    DEFAULT_TYPE: 'sad',     // 未落在三类负向池中时的兜底（理论上不可达：其余类型不触发）

    /* ── STABILIZE 托底句池（每条均含「我在 / 慢慢来 / 不怕 / 陪你 / 我听 / 我接」托底标记）── */
    STABILIZE_POOL: {
      L0: ['我在。', '没事，慢慢来。', '不怕，先喘口气。', '我听着呢，不急。', '我在，慢慢说。', '不怕，我在。'],
      L1: ['别急，我在。', '慢慢来，我们不赶。', '我陪着你，先坐一会儿。'],
      L2: ['我在这儿，不急。', '慢慢来，我陪着你。', '不怕，说不出来也没关系。'],
      L3: ['我在这儿，哪儿也不去。', '不怕，我陪着你。', '慢慢来，我接着你，塌不下去。'],
    },
  };

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 分层共情句池（3 类 × 4 档，累积可用：L0=6 / L1=9 / L2=12 / L3=15）
   * ══════════════════════════════════════════════════════════════════════ */
  var EMPATHY_POOL = {
    /* ── 哀（心疼你）：克制旁听 → 轻接 → 明确心疼 → 深切在场 ── */
    sad: {
      L0: [
        '听起来挺难受的。',
        '嗯，我听着。',
        '这事儿确实让人不好受。',
        '嗯，我知道了。',
        '辛苦你了。',
        '听你这么说，我心里也沉了一下。',
      ],
      L1: [
        '听起来你今天真的很累。',
        '要是难受就说出来，我在这儿。',
        '这事儿搁谁身上都不好受。',
      ],
      L2: [
        '心疼你，怎么会遇到这种事。',
        '你先缓一缓，我不催你。',
        '我懂那种闷着疼的感觉。',
      ],
      L3: [
        '我在这儿，慢点说，我听着。',
        '别一个人扛着，我陪你一起。',
        '想哭就哭，我不走。',
      ],
    },
    /* ── 怒：稳住不拱火 → 顺一口气 → 站他这边 → 陪他一起不平 ── */
    angry: {
      L0: [
        '听得出来你很生气。',
        '嗯，这事儿确实让人上火。',
        '先别气坏了自己。',
        '我听着，你说。',
        '换我大概也会生气。',
        '先喘口气，慢慢说。',
      ],
      L1: [
        '这种事确实没道理。',
        '气归气，别拿别人的错罚自己。',
        '你说，我听着，不插嘴。',
      ],
      L2: [
        '这事儿是你占理。',
        '换我我也不服。',
        '别憋着，跟我发火没关系。',
      ],
      L3: [
        '我也替你生气，这说不过去。',
        '他这样做真的不对，我站你这边。',
        '要不咱先把这口气顺下去，我陪你。',
      ],
    },
    /* ── 焦虑：轻安抚 → 稳节奏 → 拆解焦虑 → 持稳托底 ── */
    anxious: {
      L0: [
        '听得出你有点慌。',
        '别急，一件一件来。',
        '嗯，这事确实让人悬着心。',
        '先深呼吸一下。',
        '我在，慢慢说。',
        '想太多的时候最容易乱。',
      ],
      L1: [
        '先把最要紧的那件说出来。',
        '不急，我们一起理一理。',
        '慌的时候先别做决定。',
      ],
      L2: [
        '你担心的是哪一步？我们拆开看。',
        '最坏的情况，其实也没那么糟。',
        '你不是没准备好，只是它来得太近了。',
      ],
      L3: [
        '别怕，不管结果怎样我都在。',
        '你先稳住，剩下的我们一步步来。',
        '焦虑归焦虑，它不代表你会搞砸。',
      ],
    },
  };

  /* 首句共情词的固定前缀（幂等判据的一部分） */
  var EMPATHY_PREFIX_RE = /^(我在|我在这儿|别怕|不怕|慢慢|不急|别急|我听|听着|心疼|我陪|我懂|我明白|听起来|听得出|听得出来|我接着|别一个人|想哭|先喘|先深呼吸|先坐|先缓|辛苦|没事，)/;
  /* 从句池提取的 2 字前缀集合（构造期一次算好，运行期零开销）。
   * ★ 只收「共情起首字」开头的条目：像『你先…』『他这…』这类以人称代词起首的句池成员
   *   若也纳入前缀集，会把大量普通回复（"你先别想太多"）误判为"已含共情"而跳过前置，
   *   直接把 AC-5② / AC-4① 的命中率打到 0。嗯/唔/诶 等通用语气词同样不纳入。 */
  var PREFIX_FIRST_OK = '我听别不慢心辛想先没这换气要最焦';
  var PREFIX_SET = {};

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 工具（纯函数）
   * ══════════════════════════════════════════════════════════════════════ */
  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  function safeRng(rng) { return (typeof rng === 'function') ? rng : Math.random; }
  function normalizeStage(stage) {
    return (typeof stage === 'string' && /^L[0-3]$/.test(stage)) ? stage : 'L0';
  }
  /** 用户情绪极性的双判据取值：显式 polarity 缺失时用内置 UE_POL 副本。 */
  function uePolarity(ue) {
    var type = (ue && typeof ue.type === 'string') ? ue.type : 'neutral';
    var base = CONST.UE_POL[type];
    if (base === undefined) base = 0;
    if (ue && isFinite(ue.polarity)) return Number(ue.polarity);
    return base * (0.5 + 0.5 * clamp01(ue && ue.intensity));
  }

  /* ── LRU（模块内，仅内存；绝不写 S，重启即空，符合"不持久化会话态"的既有范式）── */
  var _lru = [];
  function lruSeen(s) {
    for (var i = 0; i < _lru.length; i++) if (_lru[i] === s) return true;
    return false;
  }
  function lruPush(s) {
    if (!s) return;
    _lru.push(s);
    while (_lru.length > CONST.LRU_MAX) _lru.shift();
  }
  function lruReset() { _lru = []; }

  /* ── 句池取样 ── */
  function layerIndex(stage) {
    var i = CONST.STAGE_ORDER.indexOf(normalizeStage(stage));
    return i < 0 ? 0 : i;
  }
  /** 累积到当前 stage 的全池（浅 → 深）。 */
  function cumulative(pool, stage) {
    var upto = layerIndex(stage);
    var all = [];
    for (var i = 0; i <= upto; i++) {
      var arr = pool[CONST.STAGE_ORDER[i]] || [];
      for (var j = 0; j < arr.length; j++) all.push(arr[j]);
    }
    return all;
  }
  /** 最深一层（G3：越亲密越敢说 → 优先取最深层）。 */
  function deepest(pool, stage) {
    return (pool[CONST.STAGE_ORDER[layerIndex(stage)]] || []).slice(0);
  }
  /** 取一条：优先深层、避开 LRU；全池都 recent 时允许回落（绝不返回空）。 */
  function pickLine(pool, stage, rng) {
    var all = cumulative(pool, stage);
    if (!all.length) return null;
    var deep = deepest(pool, stage);
    var rnd = safeRng(rng);
    var fallback = null;
    for (var t = 0; t < CONST.MAX_TRY; t++) {
      var arr = (t < CONST.DEEP_TRY && deep.length && rnd() < CONST.DEEP_PREF) ? deep : all;
      var i = Math.floor(clamp01(rnd()) * arr.length);
      if (i >= arr.length) i = arr.length - 1;
      var s = arr[i];
      if (!s) continue;
      if (!lruSeen(s)) return s;
      if (!fallback) fallback = s;
    }
    return fallback || all[Math.floor(clamp01(rnd()) * all.length)];
  }

  /* ── 幂等：首句已含共情词则跳过（防双共情）── */
  function hasEmpathyPrefix(text) {
    var t = (typeof text === 'string') ? text : '';
    if (!t) return false;
    if (EMPATHY_PREFIX_RE.test(t)) return true;
    for (var p in PREFIX_SET) {
      if (Object.prototype.hasOwnProperty.call(PREFIX_SET, p) && t.indexOf(p) === 0) return true;
    }
    return false;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 对外 API
   * ══════════════════════════════════════════════════════════════════════ */
  /** 是否应该前置共情句。 */
  function shouldFront(ctx) {
    try {
      var c = (ctx && typeof ctx === 'object') ? ctx : {};
      var ue = c.ue;
      if (!ue || typeof ue !== 'object') return false;
      var type = (typeof ue.type === 'string') ? ue.type : 'neutral';
      var pol = uePolarity(ue);
      var polBase = (CONST.UE_POL[type] === undefined) ? 0 : CONST.UE_POL[type];
      // 双判据：显式 polarity 缺失时，内置 UE_POL 副本兜底
      if (!(pol < CONST.TRIGGER_POL) && !(polBase < CONST.TRIGGER_POL)) return false;
      if (clamp01(ue.intensity) < CONST.MIN_INTENSITY) return false;
      if (c.hasBondEcho) return false;                 // 与 bondFrag 互斥（AC-4③）
      if ((typeof c.turnIdx === 'number' ? c.turnIdx : 0) !== 0) return false;  // 只前置在首条气泡
      if (hasEmpathyPrefix(c.text)) return false;       // 幂等
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 前置共情句。
   * @returns { text: string, used: string|null }  used 为命中的共情句（未命中则 null）
   */
  function front(text, ctx, rng) {
    var src = (typeof text === 'string') ? text : '';
    try {
      var c = (ctx && typeof ctx === 'object') ? ctx : {};
      var ue = (c.ue && typeof c.ue === 'object') ? c.ue : null;
      if (!ue) return { text: src, used: null };
      var check = {
        ue: ue, hasBondEcho: c.hasBondEcho, turnIdx: c.turnIdx,
        stabilize: c.stabilize, text: src,
      };
      if (!shouldFront(check)) return { text: src, used: null };

      var stage = normalizeStage(c.stage);
      var pol = uePolarity(ue);
      // STABILIZE 托底门：与 affect-state 同门（ue.polarity ≤ −0.7 ∧ intensity ≥ 0.7）
      var stabilize = !!c.stabilize
        || (pol <= CONST.STABILIZE_POL && clamp01(ue.intensity) >= CONST.STABILIZE_INT);
      var type = (typeof ue.type === 'string') ? ue.type : CONST.DEFAULT_TYPE;
      var pool = stabilize ? CONST.STABILIZE_POOL : (EMPATHY_POOL[type] || EMPATHY_POOL[CONST.DEFAULT_TYPE]);

      var line = pickLine(pool, stage, rng);
      if (!line) return { text: src, used: null };
      lruPush(line);
      // 拼接：句池成员若已带句末标点则直接接，否则补逗号
      var sep = /[。！？…～]$/.test(line) ? '' : '，';
      var out = src ? (line + sep + src) : line;
      return { text: out, used: line };
    } catch (e) {
      return { text: src, used: null };
    }
  }

  /* ── 构造期：从句池提取 2 字前缀，供幂等判据使用 ── */
  (function buildPrefixSet() {
    function collect(pool) {
      var layers = CONST.STAGE_ORDER;
      for (var i = 0; i < layers.length; i++) {
        var arr = pool[layers[i]] || [];
        for (var j = 0; j < arr.length; j++) {
          if (!arr[j] || arr[j].length < 2) continue;
          if (PREFIX_FIRST_OK.indexOf(arr[j].charAt(0)) < 0) continue;   // 只收共情起首字
          PREFIX_SET[arr[j].slice(0, 2)] = 1;
        }
      }
    }
    try {
      collect(CONST.STABILIZE_POOL);
      collect(EMPATHY_POOL.sad);
      collect(EMPATHY_POOL.angry);
      collect(EMPATHY_POOL.anxious);
    } catch (e) {}
  })();

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.4',
    CONST: CONST,
    EMPATHY_POOL: EMPATHY_POOL,
    shouldFront: shouldFront,
    front: front,
    hasEmpathyPrefix: hasEmpathyPrefix,
    uePolarity: uePolarity,
    reset: lruReset,       // 仅供测试：清空复读抑制窗口
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('empathyFront', api);
  } catch (e) {}

  if (G) {
    G.EmpathyFront = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
