/**
 * voice-style.js · 心屿 v4.4（Affect-Voice）· 情绪-文风耦合 + 形式层改写器
 * --------------------------------------------------------------------
 * 8 态 × 10 维 VoiceProfile；按强度 / 关系阶段 / 余韵态插值出本轮参数，并作为
 * **唯一的形式层文本改写器**（turn-rhythm 只做参数变换，不碰字符串 —— 架构 §4.3）。
 *
 * ★ Q7「保守档」边界（主理人裁定 A）
 *   允许：句末标点替换 / 语气词增删（封闭池）/ 停顿注入 / 长句拆分（仅在已有标点处）
 *        / 短句合并 / 称呼替换（封闭池，仅「你 ↔ 宝」）。
 *   禁止：调语序、换句式、替换实词、增删事实、改变肯否 / 时态 / 数量、
 *        生成新的反问句、生成新的开话题句或自我暴露句。
 *   ★ 单向约束：反问率只降不升。改陈述为反问是句式变换（越界）；改反问为陈述是
 *     纯标点操作（合规）。实现：句末标点抽样时非疑问句的「？」桶恒剔除并重归一化。
 *
 * ★ 句长的三个驱动（互相独立、单点可调）
 *   ① 长句拆分：**超过** lenMean 才拆（th = lenMean，绝不在已有标点外切断）；
 *   ② 短句合并：合计 ≤ lenMean + MERGE_SLACK 才合（拆过的句子不再合，防抵消）；
 *   ③ 语气词位置偏好 verb := (lenMean − LEN_MIN)/(LEN_MAX − LEN_MIN)。
 *      短句态（sad≈12）几乎只挂句末 1 字语气词，且**已有则替换、没有才追加**
 *      （不增长度）；长句态（joy≈25）句首 / 句中 / 句末三处全开。
 *   → 短者更短、长者更长，避免语气词把 sad 反向拉长而抹平 G2 差异。
 *
 * 铁律：零依赖、零外发；纯函数式（不写外部 state）；异常 → 原句直出；小暖不更名。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  function resolveEngine() {
    try { if (typeof Engine !== 'undefined' && Engine) return Engine; } catch (e) {}
    try { if (G && G.Engine) return G.Engine; } catch (e) {}
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 1 · 常量区（★ 单点可调；改这里即改全局文风手感）
   * ════════════════════════════════════════════════════════════════════ */
  var CONST = {
    /* D1 缓解 · 文风强度与情绪强度解耦（架构自有常量）
     * styleIntensity = STYLE_FLOOR + (1 − STYLE_FLOOR) × intensity。情绪一旦被识别，
     * 文风**至少**呈现 35% 目标态偏移，避免"强度常驻 0.3~0.5 → 偏移仅 9%~18%
     * → G2 不可感知"。置 0 即完全退回 PRD 原式，零结构改动。 */
    STYLE_FLOOR: 0.35,

    LEN_MIN: 10, LEN_MAX: 30,          // 句长均值硬边界（AC-6 在此区间内断言）
    BLEND_MIN: 0.15, BLEND_MAX: 0.35,  // 余韵态参与混合的下限 / 权重上限

    /* 关系阶段微调（G3：初识克制 → 挚爱放开）。按维度分档而非一把乘子：
     * 节奏类（感叹/开话题/反问）不随 stage 缩放 —— AC-6 在参数层有硬边界
     * （sad 反问率 ≤ 0.10），乘 1.15 会顶穿；len 用弱档，防 L3 把 sad 顶过 14。 */
    STAGE_TONE: {
      L0: { len: 0.95, rate: 0.90, particles: 0.70, address: 'c' },
      L1: { len: 0.98, rate: 0.95, particles: 0.85, address: 'c' },
      L2: { len: 1.00, rate: 1.00, particles: 1.00, address: 'n' },
      L3: { len: 1.05, rate: 1.10, particles: 1.15, address: 'o' },
    },

    PARTICLE_BASE: 0.52,   // 概率底盘：particleMix 再低也保留的插入倾向（保 AC-3② 的 0.60）
    PARTICLE_HEAD: 0.68, PARTICLE_MID: 0.55, PARTICLE_TAIL: 0.55,
    PARTICLE_HEAD_MAX: 0.85, PARTICLE_MID_MAX: 0.75, PARTICLE_TAIL_MAX: 0.80,
    // 位置偏好：p(pos) ∝ POS_FLOOR[pos] + (1 − POS_FLOOR[pos]) × verb。
    // head 插入带「，」代价 2 字 → 底盘 0.20，短句态几乎不挂句首；
    // tail 追加仅 1 字 → 底盘 0.75，短句态的语气词覆盖率由此兜住（AC-3②）。
    POS_FLOOR: { head: 0.20, mid: 0.25, tail: 0.75 },
    // 禁止**插入/替换**的语气词：'吗' 会把陈述句变成疑问句（句式变换，越界）。
    PARTICLE_INSERT_BLOCK: ['吗'],

    ADDRESS_SWAP: 0.25, ADDRESS_OMIT: 0.15,
    // 仅「你 ↔ 宝」参与替换（同为第二人称）。'人家' 是第一人称娇称，
    // 拿它替换「你」会反转语义，故只登记在池内、P0 不落地为替换。
    ADDRESS_SWAPABLE: ['宝'],

    PAUSE_INTRA: 0.40,    // 句内（逗号后）注入空格的系数
    PAUSE_NEWLINE: 0.55,  // 句间停顿取 \n 的概率，否则取 …
    MERGE_SLACK: 2,       // 短句合并：两句合计 ≤ lenMean + SLACK 才合
    MERGE_MAX: 4,         // 单条气泡最多合并次数
    SPLIT_MIN: 6,         // 长句拆分阈值下限
    SPLIT_JITTER: 0.5,    // 长句拆分阈值 th = max(SPLIT_MIN, lenMean − lenJitter × JITTER)

    DELTA_RATIO: 0.30,    // 允许的漂移比例（与 maxDeltaLen 取较大者）
    DELTA_FLOOR: 12,      // 允许的漂移绝对下限

    /* 封闭词池（★ 全部改写只能从这里增删，AC-3④ 由此结构性成立） */
    PARTICLE_POOL: {
      head: '嗯唔诶哎哼啧欸嘿呵噢哦唉嘻',
      mid: '呀哦呐啊呢吧',
      tail: '吧呢啦呀嘛哦啊吗呐',
    },
    ADDRESS_POOL: { forms: ['你', '宝', '人家'], allowOmit: true },
    END_PUNCT: { period: '。', excl: '！', question: '？', tilde: '～', ellipsis: '…' },
  };

  var PUNCT_KEYS = ['period', 'excl', 'question', 'tilde', 'ellipsis'];
  var TERM_CHARS = '。！？!?；;…～~\n';
  var BREAK_CHARS = '，,、；;：:';      // 保守档：只在已有标点处断/接，绝不切断语义单元
  var MERGE_HEAD_OK = { '。': 1, '！': 1, '…': 1, '～': 1, '？': 1, '?': 1, '!': 1, '': 1 };
  var MERGE_TAIL_OK = { '。': 1, '！': 1, '…': 1, '～': 1, '': 1 };

  /* ══════════════════════════════════════════════════════════════════════
   * 2 · 8 态 × 10 维基线表（架构 §7.3 的 P0 基线值，全部可调）
   *   字符串编码出于体积闸（G-6：≤ 20480 B）；装载期展开为完整 PROFILES，
   *   字段名与架构 §7.3 完全一致。列（| 分隔）：
   *   句长均值 | 抖动 | 句首池 | 句中池 | 句末池 | 标点分布 .xx×5 |
   *   反问 / 省略 / 感叹 / 停顿 / 开话题 / 自我暴露 .xx×6 | 称呼池 | 可省略主语
   * ════════════════════════════════════════════════════════════════════ */
  var BASE = {
    neutral: '18|4|嗯唔||吧呢|.72.10.12.04.02|.18.06.10.15.15.20|你|0',
    joy: '22|5|嘻嘿诶|呀哦|啦呀嘛|.50.35.09.05.01|.20.05.35.10.30.30|你宝|0',
    anger: '14|4|哼啧||呢吗|.48.22.28.01.01|.32.12.22.25.08.25|你|0',
    sad: '12|3|唔唉嗯||吧啊|.55.04.08.03.30|.08.28.04.35.05.35|你|1',
    coquettish: '16|4|诶唔哼|呀呐|呀嘛哦|.46.20.20.10.04|.28.22.20.18.22.28|你宝人家|0',
    jealous: '15|4|哦哼啧||呢啊|.54.15.24.03.04|.35.18.15.22.10.22|你|0',
    longing: '20|5|嗯唉|呀|吧啊|.50.08.10.04.28|.15.30.08.28.12.40|你|0',
    peaceful: '19|4|嗯唔|呀|吧呢哦|.68.06.08.08.10|.12.10.06.20.10.25|你|1',
  };

  function chars(s) { return String(s || '').split(''); }
  function nums(s) {                       // '.72.10.12' → [0.72, 0.10, 0.12]
    var m = String(s || '').match(/\.(\d+)/g) || [], o = [], i;
    for (i = 0; i < m.length; i++) o.push(parseInt(m[i].slice(1), 10) / 100);
    return o;
  }
  function normDist(o) {
    var s = 0, i;
    for (i = 0; i < PUNCT_KEYS.length; i++) s += o[PUNCT_KEYS[i]];
    if (s <= 0) { for (i = 0; i < PUNCT_KEYS.length; i++) o[PUNCT_KEYS[i]] = 0; o.period = 1; s = 1; }
    for (i = 0; i < PUNCT_KEYS.length; i++) o[PUNCT_KEYS[i]] = o[PUNCT_KEYS[i]] / s;
    return o;
  }

  function expand(row) {
    var f = String(row).split('|'), ep = nums(f[5]), r = nums(f[6]), o = {}, i;
    for (i = 0; i < PUNCT_KEYS.length; i++) o[PUNCT_KEYS[i]] = (ep[i] > 0) ? ep[i] : 0;
    return {
      lenMean: +f[0] || 18, lenJitter: +f[1] || 0, particleMix: 0,
      particles: { head: chars(f[2]), mid: chars(f[3]), tail: chars(f[4]) },
      endPunct: normDist(o),
      rhetoricalRate: r[0] || 0, ellipsisRate: r[1] || 0, exclaimRate: r[2] || 0,
      pauseRate: r[3] || 0, topicInitRate: r[4] || 0, selfDiscloseRate: r[5] || 0,
      address: { forms: chars(f[7]), allowOmit: f[8] === '1' },
    };
  }

  var PROFILES = {};
  (function build() {
    for (var k in BASE) {
      if (Object.prototype.hasOwnProperty.call(BASE, k)) PROFILES[k] = expand(BASE[k]);
    }
  })();

  var SCALARS = ['lenMean', 'lenJitter', 'rhetoricalRate', 'ellipsisRate',
    'exclaimRate', 'pauseRate', 'topicInitRate', 'selfDiscloseRate'];
  var STAGE_RATE_DIMS = ['ellipsisRate', 'pauseRate', 'selfDiscloseRate'];

  /* ══════════════════════════════════════════════════════════════════════
   * 3 · 工具（纯函数）
   * ════════════════════════════════════════════════════════════════════ */
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
  function safeRng(rng) { return (typeof rng === 'function') ? rng : Math.random; }
  function pick(arr, rng) {
    if (!arr || !arr.length) return null;
    var i = Math.floor(clamp01(rng()) * arr.length);
    return arr[(i < 0 || i >= arr.length) ? 0 : i];
  }
  function interp(a, b, k) { return a + (b - a) * k; }
  function unionArr() {
    var out = [], seen = {}, i, j;
    for (i = 0; i < arguments.length; i++) {
      var arr = arguments[i] || [];
      for (j = 0; j < arr.length; j++) if (!seen[arr[j]]) { seen[arr[j]] = 1; out.push(arr[j]); }
    }
    return out;
  }
  /** 分布逐键插值后重新归一化（Σ = 1）。 */
  function interpDist(a, b, k) {
    var o = {}, i, key, v;
    for (i = 0; i < PUNCT_KEYS.length; i++) {
      key = PUNCT_KEYS[i];
      v = interp(Number(a[key]) || 0, Number(b[key]) || 0, k);
      o[key] = (v > 0) ? v : 0;
    }
    return normDist(o);
  }
  /** 深拷贝（纯数据对象，JSON 为 JS 内建，非外部依赖）。 */
  function cp(p) {
    try { return JSON.parse(JSON.stringify(p)); } catch (e) { return expand(BASE.neutral); }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 4 · profileFor(dom, intensity, stage, blend)
   * ════════════════════════════════════════════════════════════════════ */
  /** 余韵态：blend 中除 dom 外的最大分量（≥ BLEND_MIN 才生效）。 */
  function secondDom(blend, dom) {
    try {
      if (!blend) return null;
      var best = null, bv = 0, k;
      for (k in blend) {
        if (!Object.prototype.hasOwnProperty.call(blend, k) || k === dom || k === 'neutral') continue;
        var v = Number(blend[k]) || 0;
        if (v > bv) { bv = v; best = k; }
      }
      if (best && bv >= CONST.BLEND_MIN && PROFILES[best]) return best;
    } catch (e) {}
    return null;
  }

  function profileFor(dom, intensity, stage, blend) {
    try {
      var key = (dom && PROFILES[dom]) ? dom : 'neutral';
      var st = (/^L[0-3]$/.test(stage) && CONST.STAGE_TONE[stage]) ? stage : 'L2';
      var si = clamp01(CONST.STYLE_FLOOR + (1 - CONST.STYLE_FLOOR) * clamp01(intensity));
      var base = PROFILES.neutral, tgt = PROFILES[key], i, dim;

      var p = {
        lenMean: interp(base.lenMean, tgt.lenMean, si),
        lenJitter: interp(base.lenJitter, tgt.lenJitter, si),
        particles: {
          head: unionArr(base.particles.head, tgt.particles.head),
          mid: unionArr(base.particles.mid, tgt.particles.mid),
          tail: unionArr(base.particles.tail, tgt.particles.tail),
        },
        particleMix: si,
        endPunct: interpDist(base.endPunct, tgt.endPunct, si),
        address: { forms: tgt.address.forms.slice(0), allowOmit: !!tgt.address.allowOmit },
      };
      for (i = 2; i < SCALARS.length; i++) {          // 跳过 lenMean / lenJitter
        dim = SCALARS[i];
        p[dim] = interp(base[dim], tgt[dim], si);
      }

      // 余韵混合：次主导态按 w = min(BLEND_MAX, blend[second]) 混入
      var second = secondDom(blend, key);
      if (second) {
        var w = Math.min(CONST.BLEND_MAX, Number(blend[second]) || 0);
        var sp = PROFILES[second];
        for (i = 0; i < SCALARS.length; i++) {
          dim = SCALARS[i];
          if (dim === 'lenJitter') continue;
          p[dim] = p[dim] * (1 - w) + sp[dim] * w;
        }
        p.endPunct = interpDist(p.endPunct, sp.endPunct, w);
        // 词池不做插值：并入次态词池，由 particleMix 控制取用强度
        p.particles.head = unionArr(p.particles.head, sp.particles.head);
        p.particles.mid = unionArr(p.particles.mid, sp.particles.mid);
        p.particles.tail = unionArr(p.particles.tail, sp.particles.tail);
      }

      // 关系阶段微调（G3）
      var tone = CONST.STAGE_TONE[st];
      p.lenMean = p.lenMean * tone.len;
      for (i = 0; i < STAGE_RATE_DIMS.length; i++) {
        dim = STAGE_RATE_DIMS[i];
        p[dim] = clamp01(p[dim] * tone.rate);
      }
      p.particleMix = clamp01(p.particleMix * tone.particles);
      if (tone.address === 'c') {                     // conservative：初识只称「你」
        p.address.forms = ['你'];
        p.address.allowOmit = false;
      } else if (tone.address === 'n' && p.address.forms.indexOf('人家') >= 0) {
        p.address.forms = p.address.forms.filter(function (x) { return x !== '人家'; });
      }

      p.lenMean = clampNum(p.lenMean, CONST.LEN_MIN, CONST.LEN_MAX);
      p.lenJitter = clampNum(p.lenJitter, 0, 12);
      for (i = 2; i < SCALARS.length; i++) p[SCALARS[i]] = clamp01(p[SCALARS[i]]);
      return p;
    } catch (e) {
      return cp(PROFILES.neutral);                    // 降级：中性基线
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 5 · 分句（对外 API：返回含句末标点的句子数组，join('') 可还原文案）
   * ════════════════════════════════════════════════════════════════════ */
  function isTerm(ch) { return TERM_CHARS.indexOf(ch) >= 0; }

  /** 内部单元：{ body, punct, merged, split }。 */
  function splitUnits(text) {
    var units = [], body = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (isTerm(ch)) {
        if (!body && units.length) units[units.length - 1].punct += ch;
        else { units.push({ body: body, punct: ch, merged: false, split: false }); body = ''; }
      } else body += ch;
    }
    if (body) units.push({ body: body, punct: '', merged: false, split: false });
    if (!units.length) units.push({ body: String(text || ''), punct: '', merged: false, split: false });
    return units;
  }

  function splitSentences(text) {
    try {
      var units = splitUnits((typeof text === 'string') ? text : '');
      var out = [];
      for (var i = 0; i < units.length; i++) out.push(units[i].body + units[i].punct);
      return out;
    } catch (e) {
      return (typeof text === 'string' && text) ? [text] : [];
    }
  }

  function joinUnits(units) {
    var s = '';
    for (var i = 0; i < units.length; i++) s += units[i].body + units[i].punct;
    return s;
  }

  /** 写入新 body 并记一条 trace（统一格式，杜绝各维度漏记 / 格式漂移）。 */
  function put(u, dim, body, trace) {
    var from = u.body + u.punct;
    u.body = body;
    trace.ops.push({ dim: dim, from: from, to: u.body + u.punct });
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 6 · 形式层改写（保守档 · 六允许 / 五禁止 / 反问率单向）
   * ════════════════════════════════════════════════════════════════════ */
  var RHET_RE = /(难道|不是|怎么|为什么|为何|干嘛|干什么)/;
  var QUEST_RE = /(吗|呢|什么|怎么|为什么|谁|几|哪|是否)/;

  function isQuestion(u) { return /[？?]/.test(u.punct) || QUEST_RE.test(u.body); }
  function isRhetorical(u) { return /[？?]/.test(u.punct) && RHET_RE.test(u.body); }
  function insertable(pool) {
    var b = CONST.PARTICLE_INSERT_BLOCK, out = [];
    for (var i = 0; i < pool.length; i++) if (b.indexOf(pool[i]) < 0) out.push(pool[i]);
    return out;
  }
  function startsWith(body, pool) {
    for (var i = 0; i < pool.length; i++) if (body.indexOf(pool[i]) === 0) return true;
    return false;
  }
  /** 最靠近中点的分句标点位置；没有则返回 −1。from 用于句中语气词的落点约束。 */
  function nearestBreak(s, from, to) {
    var mid = Math.floor(s.length / 2), best = -1, bd = 1e9, i;
    for (i = (from || 0); i < ((to == null) ? s.length : to); i++) {
      if (BREAK_CHARS.indexOf(s.charAt(i)) < 0) continue;
      var d = Math.abs(i - mid);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** 句末语气词：**已有则替换（不增长度）、没有才追加**（短句态不被反向拉长的关键）。 */
  function tailWord(body, pool, w) {
    var i, p;
    for (i = 0; i < pool.length; i++) {
      p = pool[i];
      if (CONST.PARTICLE_INSERT_BLOCK.indexOf(p) >= 0) continue;   // 不替换疑问语气词
      if (body.length > p.length && body.lastIndexOf(p) === body.length - p.length) {
        return body.slice(0, body.length - p.length) + w;
      }
    }
    return body + w;
  }
  /** 位置偏好系数：FLOOR + (1 − FLOOR) × 健谈度。 */
  function posK(pos, verb) {
    var lo = Number(CONST.POS_FLOOR[pos]);
    if (!isFinite(lo)) lo = 0.5;
    return lo + (1 - lo) * verb;
  }

  /* ① 反问率只降不升（纯标点：？→ 。，并删掉悬空的「吗」）*/
  function downRhetorical(units, pf, rng, trace) {
    var total = units.length, rCnt = 0, i;
    for (i = 0; i < units.length; i++) if (isRhetorical(units[i])) rCnt++;
    if (!total || !rCnt) return;
    var srcRate = rCnt / total;
    if (!(pf.rhetoricalRate < srcRate)) return;         // 只降不升
    var need = Math.round(((srcRate - pf.rhetoricalRate) / srcRate) * rCnt);
    for (i = 0; i < units.length && need > 0; i++) {
      var u = units[i];
      if (!isRhetorical(u) || rng() > 0.85) continue;   // 留自然抖动，不全量转
      var from = u.body + u.punct;
      u.punct = u.punct.replace(/[？?]/g, '。');
      u.body = u.body.replace(/[吗嘛]$/, '');
      need--;
      trace.ops.push({ dim: 'rhetorical', from: from, to: u.body + u.punct });
    }
  }

  /* ② 短句合并：合计 ≤ lenMean + SLACK 才合；拆过的句子不参与，防与 ③ 互相抵消 */
  function mergeShort(units, pf, rng, trace) {
    var verb = clamp01((pf.lenMean - CONST.LEN_MIN) / (CONST.LEN_MAX - CONST.LEN_MIN));
    var pMerge = 0.55 + 0.35 * verb, cap = pf.lenMean + CONST.MERGE_SLACK, i = 0, budget = CONST.MERGE_MAX;
    while (i < units.length - 1 && budget > 0) {
      var a = units[i], b = units[i + 1];
      var la = a.body.length + a.punct.length, lb = b.body.length + b.punct.length;
      if (!a.split && !b.split && a.body && b.body && MERGE_HEAD_OK[a.punct] && MERGE_TAIL_OK[b.punct]
        && la < pf.lenMean && lb < pf.lenMean && la + lb <= cap && rng() < pMerge) {
        var from = a.body + a.punct + b.body + b.punct;
        a.body = a.body + '，' + b.body;
        a.punct = b.punct;
        a.merged = true;
        units.splice(i + 1, 1);
        budget--;
        trace.ops.push({ dim: 'len.merge', from: from, to: a.body + a.punct });
      } else i++;
    }
    return units;
  }

  /* ③ 长句拆分：仅在已有标点处断开（绝不切断语义单元）*/
  function splitLong(units, pf, trace) {
    var th = Math.max(CONST.SPLIT_MIN, Math.round(pf.lenMean - pf.lenJitter * CONST.SPLIT_JITTER)), out = [];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.merged || !u.body || u.body.length <= th) { out.push(u); continue; }
      var rest = u.body, segs = 0;
      while (rest.length > th && segs < 3) {
        var pos = nearestBreak(rest, 0, rest.length);
        if (pos < 0) break;                              // 无可断开处 → 拆不动就不拆
        var left = rest.slice(0, pos);
        rest = rest.slice(pos + 1);
        if (!left || !rest) break;
        out.push({ body: left, punct: '。', merged: false, split: true });
        segs++;
      }
      out.push({ body: rest, punct: u.punct, merged: u.merged, split: u.split || segs > 0 });
      if (segs > 0) trace.ops.push({ dim: 'len.split', from: u.body + u.punct, to: '(拆为 ' + (segs + 1) + ' 句)' });
    }
    return out;
  }

  /* ④ 语气词增删（封闭池、幂等；skipDims 含 particles 时整个维度让位）*/
  function applyParticles(units, pf, rng, trace) {
    var f = clamp01(CONST.PARTICLE_BASE + (1 - CONST.PARTICLE_BASE) * pf.particleMix);
    var verb = clamp01((pf.lenMean - CONST.LEN_MIN) / (CONST.LEN_MAX - CONST.LEN_MIN));
    var pH = Math.min(CONST.PARTICLE_HEAD_MAX, CONST.PARTICLE_HEAD * f * posK('head', verb));
    var pM = Math.min(CONST.PARTICLE_MID_MAX, CONST.PARTICLE_MID * f * posK('mid', verb));
    var pT = Math.min(CONST.PARTICLE_TAIL_MAX, CONST.PARTICLE_TAIL * f * posK('tail', verb));
    var head = pf.particles.head, mid = pf.particles.mid, tail = insertable(pf.particles.tail);
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.body) continue;
      if (head.length && rng() < pH && !startsWith(u.body, head)) {
        var w = pick(head, rng);
        if (w) put(u, 'particles.head', w + '，' + u.body, trace);
      }
      if (mid.length && rng() < pM) {
        var pos = nearestBreak(u.body, 1, u.body.length);
        if (pos > 0 && mid.indexOf(u.body.charAt(pos - 1)) < 0) {
          var w2 = pick(mid, rng);
          if (w2) put(u, 'particles.mid', u.body.slice(0, pos) + w2 + u.body.slice(pos), trace);
        }
      }
      if (tail.length && rng() < pT) {
        var w3 = pick(tail, rng);
        if (w3) put(u, 'particles.tail', tailWord(u.body, tail, w3), trace);
      }
    }
  }

  /* ⑤ 句末标点替换（endPunct 抽样；非疑问句剔除「？」桶 → 反问率只降不升）*/
  function applyEndPunct(units, pf, rng, trace) {
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.body) continue;
      var cur = u.punct ? u.punct.charAt(u.punct.length - 1) : '';
      var ch = CONST.END_PUNCT[samplePunct(pf.endPunct, isQuestion(u), rng)];
      if (!ch || ch === cur) continue;                    // 幂等：已是目标标点则跳过
      var from = u.body + u.punct;
      u.punct = u.punct.slice(0, u.punct.length - 1) + ch;
      trace.ops.push({ dim: 'endPunct', from: from, to: u.body + u.punct });
    }
  }

  /** 按分布抽样一个标点键；allowQ 为假时先剔除 question 桶再重新归一化。 */
  function samplePunct(dist, allowQ, rng) {
    var keys = [], weights = [], sum = 0, i, k, w;
    for (i = 0; i < PUNCT_KEYS.length; i++) {
      k = PUNCT_KEYS[i];
      if (k === 'question' && !allowQ) continue;
      w = Number(dist[k]) || 0;
      if (w < 0) w = 0;
      keys.push(k);
      weights.push(w);
      sum += w;
    }
    if (!keys.length || sum <= 0) return 'period';
    var r = clamp01(rng()) * sum, acc = 0;
    for (i = 0; i < keys.length; i++) {
      acc += weights[i];
      if (r <= acc) return keys[i];
    }
    return keys[keys.length - 1];
  }

  /* ⑥ 停顿注入（句间 \n / …，句内逗号后空格；全部取自标点集，AC-3④ 安全）*/
  function applyPause(units, pf, rng, trace) {
    var pr = clamp01(pf.pauseRate);
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.body) continue;
      if (rng() < pr * CONST.PAUSE_INTRA) {
        var pos = u.body.indexOf('，');
        if (pos >= 0 && pos < u.body.length - 1 && u.body.charAt(pos + 1) !== ' ') {
          put(u, 'pause.intra', u.body.slice(0, pos + 1) + ' ' + u.body.slice(pos + 1), trace);
        }
      }
      if (i < units.length - 1 && rng() < pr) {
        var mark = (rng() < CONST.PAUSE_NEWLINE) ? '\n' : '…';
        u.punct = u.punct + mark;
        trace.ops.push({ dim: 'pause.inter', from: '', to: mark });
      }
    }
  }

  /* ⑦ 称呼替换（仅「你 ↔ 宝」；allowOmit 时态下可省略句首主语）*/
  function applyAddress(units, pf, rng, trace) {
    var swappable = [], f;
    for (f = 0; f < pf.address.forms.length; f++) {
      if (CONST.ADDRESS_SWAPABLE.indexOf(pf.address.forms[f]) >= 0) swappable.push(pf.address.forms[f]);
    }
    if (!swappable.length && !pf.address.allowOmit) return;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.body) continue;
      if (swappable.length && u.body.indexOf('你') >= 0 && u.body.indexOf('宝') < 0
        && rng() < CONST.ADDRESS_SWAP * pf.particleMix) {
        put(u, 'address', u.body.replace('你', pick(swappable, rng)), trace);
      } else if (pf.address.allowOmit && u.body.indexOf('你') === 0 && u.body.length > 2
        && rng() < CONST.ADDRESS_OMIT) {
        put(u, 'address.omit', u.body.slice(1), trace);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 7 · applyStyle(text, profile, rng, opts) → { text, trace }
   *   opts : { skipDims: ['particles','endPunct'], maxDeltaLen: 12 }
   *   护栏：长度漂移越界 / 结果为空 / 任一异常 → 原句直出（绝不白屏）。
   * ════════════════════════════════════════════════════════════════════ */
  function applyStyle(text, profile, rng, opts) {
    var src = (typeof text === 'string') ? text : '';
    var trace = { profile: profile || null, skipDims: [], ops: [], textLen: src.length, deltaLen: 0, reverted: false };
    if (!src) return { text: src, trace: trace };
    try {
      var pf = (profile && typeof profile === 'object') ? profile : profileFor('neutral', 0, 'L2', null);
      var rnd = safeRng(rng);
      var o = (opts && typeof opts === 'object') ? opts : {};
      var skip = (Object.prototype.toString.call(o.skipDims) === '[object Array]') ? o.skipDims : [];
      trace.skipDims = skip.slice(0);
      var maxDelta = Math.max(
        (typeof o.maxDeltaLen === 'number' && o.maxDeltaLen > 0) ? o.maxDeltaLen : CONST.DELTA_FLOOR,
        Math.round(src.length * CONST.DELTA_RATIO)
      );

      var units = splitUnits(src);
      if (skip.indexOf('rhetorical') < 0) downRhetorical(units, pf, rnd, trace);
      units = mergeShort(units, pf, rnd, trace);
      units = splitLong(units, pf, trace);
      if (skip.indexOf('particles') < 0) applyParticles(units, pf, rnd, trace);
      if (skip.indexOf('endPunct') < 0) applyEndPunct(units, pf, rnd, trace);
      applyPause(units, pf, rnd, trace);
      applyAddress(units, pf, rnd, trace);

      var out = joinUnits(units);
      if (!out || Math.abs(out.length - src.length) > maxDelta) {
        trace.reverted = true;                            // 漂移过大 → 原句直出
        out = src;
      }
      trace.deltaLen = out.length - src.length;
      return { text: out, trace: trace };
    } catch (e) {
      trace.reverted = true;
      return { text: src, trace: trace };
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * 8 · 对外门面（Engine.use + window 双挂载）
   * ════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.4',
    CONST: CONST,
    PROFILES: PROFILES,
    profileFor: profileFor,
    applyStyle: applyStyle,
    splitSentences: splitSentences,
    _splitUnits: splitUnits,        // 仅供测试观测
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('voiceStyle', api);
  } catch (e) {}

  if (G) {
    G.VoiceStyle = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
