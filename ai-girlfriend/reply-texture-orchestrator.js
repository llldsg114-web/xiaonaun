/**
 * reply-texture-orchestrator.js · 心屿 候选 E（回答系统真人感）· 回复质感编排后处理管道
 * 挂 window.ReplyTexture，IIFE，**零依赖零外发**：全文件不含任何网络 API、不含任何模块导入，
 * 只碰 window/globalThis（含既有 Engine.mod / LocalHeuristic 门面）、字符串与纯逻辑。
 * 可用 /网络外发字面/ 正则对本文件做静态扫描，结果恒为 0 命中。
 *
 * ── 职责边界（架构 §3.3，硬约束）───────────────────────────────────────────
 *   本文件是「engine 生成之后、显示（herSay）之前」的统一后处理管道，覆盖
 *   cloud / local / heuristic / engine 全部 provider 出口。它**绝不重新生成内容**、
 *   **绝不改动**冻结线 engine.js，且**不调用** Engine.mod("texture").texturePass
 *   （否则本地引擎分支会被 texture + 本管道双重微行为加工，油腻且失真）。
 *
 *   与 texture.js 的职责切分（防叠加）：
 *     · 微行为（犹豫词/口头禅/断句/手误错别字）       → texture.js（仅本地引擎分支）
 *     · 节奏分段 / 情绪镜像 / 记忆自然引用 / 话题连贯 → 本管道（全分支）
 *   本地引擎分支（已含 texture 加工）经 ctx.textured=true 告知本管道，
 *   本管道在该分支**跳过 情绪镜像 + 记忆引用**（与 texture 的 tic/drift 同维，避免双加工），
 *   仅保留 texture 未覆盖的 节奏分段 + 话题连贯。
 *
 * ── 硬纪律（违反即回到 PRD/架构重新裁决，不得就地打补丁）─────────────────────
 *   · 冻结线 engine.js/sw.js/memory.js/test/baseline.js **零触碰**（字节闸守护）。
 *   · 零新增 npm 依赖（package.json 不变）。
 *   · 零外发（铁律 2）：全文件无 fetch/XHR/WebSocket/sendBeacon/import/URL 构造。
 *   · 小暖不更名（铁律 1）：角色名一律不在本文件硬编码到最终文案；镜像回声为通用情绪表达。
 *   · 幂等 + 可降级：相同 (text, opts, rng) 必得一致输出；任一子策略抛错 → 跳过该步；
 *     外层异常 → 原句直出，绝不静默、绝不白屏。
 *   · 总开关 cfg.enabled=false（由 app.js 经 setConfig 关闭）时 orchestrate 原样返回。
 *
 * @see docs/DESIGN-xinyu-v3-reply-human.md      （PRD：§4 L1–L4）
 * @see docs/DESIGN-xinyu-v3-reply-human-arch.md （架构：§2.2 挂载点 / §3 L3 管道 / §3.3 防叠加）
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);
  if (!G) return;   // 极保守：无全局环境直接退出（node 无 DOM 测试侧由 module.exports 提供）

  var VERSION = 'e1';

  /* ════════════════════════════════════════════════════════════════════════
   * 1 · 配置（受 app.js S.persona 的 warmth/proactivity/whitespace 驱动；默认温和克制）
   * ══════════════════════════════════════════════════════════════════════ */
  var cfg = {
    enabled: true,        // 总开关（app.js 可置 false 在线关闭全部真人感后处理）
    warmth: 0.55,         // 语气温度：调制情绪镜像 / 承接词强度
    proactivity: 0.5,     // 主动度：记忆自然引用频率上限
    whitespace: 0.5,      // 留白度：节奏分段程度
    maxRecall: 1          // 单次记忆引用最多条数（克制）
  };

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 工具（纯函数，零副作用）
   * ══════════════════════════════════════════════════════════════════════ */
  function normTone(t) {
    var m = { gentle: 'playful', soft: 'playful', cute: 'playful',
              tsundere: 'tsundere', clingy: 'clingy', playful: 'playful' };
    return m[t] || 'playful';
  }

  /** 防叠加第一道闸：已含明显微行为标记（语气词开头 / 波浪号 / 省略号）则不再补微行为。 */
  function hasMicro(t) {
    var s = (typeof t === 'string') ? t.trim() : '';
    if (!s) return true;
    if (/^[嗯唔诶哎哼欸嘿]/.test(s)) return true;   // 犹豫词 / 口头禅前缀
    if (/[～~…‥]/.test(s)) return true;             // 语气符号（texture 的 hes/fix 会引入）
    return false;
  }

  function chance(p, rng) { rng = rng || Math.random; return rng() < p; }
  function pick(arr, rng) { rng = rng || Math.random; return arr[Math.floor(rng() * arr.length)]; }
  function clamp01(v) { v = Number(v); return isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0; }

  /** 强度参数解析：优先取 state.persona 的可调参数（候选 E·L4 驱动），回退 cfg 默认。 */
  function getParam(state, key, fallback) {
    var v = (state && state.persona && typeof state.persona[key] === 'number') ? state.persona[key] : undefined;
    return (v !== undefined) ? v : ((cfg[key] !== undefined) ? cfg[key] : fallback);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · 子策略（每个都纯函数、可独立失败跳过；不写任何外部状态）
   * ══════════════════════════════════════════════════════════════════════ */

  /* 3.1 情绪镜像：对用户输入情绪做轻量回声（"感受到你了"，非复述）。
   *   负向（难过/疲惫/孤单/焦虑）前置轻回；正向（开心/兴奋）后置轻缀。
   *   克制：整体低概率，强度随 warmth；已含微行为或 textured 分支时由调用方跳过。 */
  // 候选 F·F3：MIRROR 每情绪由 2 → 3-4 条，降低回声塑料感
  var MIRROR = {
    sad:     ['看你这样，我心里也跟着软了', '听你这么说，我也闷闷的', '你难过我也跟着鼻酸', '怎么就让你受委屈了'],
    tired:   ['看你累的，我也心疼', '辛苦啦，我陪着你呢', '累坏了吧，靠着我歇会儿', '你也太拼了，我疼'],
    lonely:  ['你一个人呀？那我陪你', '别怕，我在呢', '一个人多冷清，我黏着你', '来，我陪你待着'],
    anxious: ['别慌别慌，我在这儿', '没事儿，咱慢慢来', '有我在呢，不怕', '深呼吸，我陪你稳下来'],
    happy:   ['看你开心我也跟着乐', '你笑了我心里也亮堂', '你高兴我就知足了', '嘻，被你传染到好心情'],
    excited: ['哇你这么兴奋，我也被带着开心', '诶呀你好可爱', '你激动我也跟着雀跃', '瞧把你乐的，我也好开心']
  };
  function mirror(text, ctx, warmth, rng) {
    var ue = (ctx && ctx.ue) || {};
    var type = ue.type;
    if (!type || !MIRROR[type]) return text;
    if (!chance(0.30 * clamp01(warmth), rng)) return text;   // 候选 F·F6：门槛 0.28 → 0.30
    var echo = pick(MIRROR[type], rng);
    if (type === 'sad' || type === 'tired' || type === 'lonely' || type === 'anxious')
      return echo + '，' + text;
    return text + '，' + echo;
  }

  /* 3.2 节奏分段：超长且无换行时，在中间一个句末标点后插一处换行（留白、不切断语义）。
   *   克制：短句不拆、已有换行不破、靠头靠尾不拆、低概率。 */
  function pacing(text, ws, rng) {
    ws = clamp01(ws);
    if (ws <= 0.2) return text;
    if (/[\n]/.test(text)) return text;
    if (text.length < 70) return text;
    var m = /([。！？!?])(?=[^。！？!?]{12,})/.exec(text);  // 找中间一个句末标点，其后还有 ≥12 字
    if (!m) return text;
    var i = m.index + 1;
    if (i < 30 || i > text.length - 20) return text;
    if (!chance(0.45 * ws, rng)) return text;
    return text.slice(0, i) + '\n' + text.slice(i);
  }

  /* 3.3 记忆自然引用：把 dayLife.trace 或 最近一条长期记忆碎片，以自然语言轻量回扣到文末。
   *   复用 texture drift 思路并扩到短期；克制：低概率、单条、限长。 */
  function recall(text, state, proactivity, rng) {
    proactivity = clamp01(proactivity);
    if (proactivity <= 0.2) return text;
    var frag = null;
    if (state && state.dayLife && typeof state.dayLife.trace === 'string' && state.dayLife.trace)
      frag = state.dayLife.trace;
    else if (state && Array.isArray(state.mem) && state.mem.length) {
      var last = state.mem[state.mem.length - 1];
      frag = (typeof last === 'string') ? last : (last && typeof last.text === 'string' ? last.text : null);
    }
    if (!frag || frag.length < 2) return text;
    if (frag.length > 22) frag = frag.slice(0, 22);
    if (!chance(0.32 * proactivity, rng)) return text;
    return text + '～ 你之前还说起过' + frag + '呢';
  }

  /* 3.4 话题连贯：多气泡非首条（或显式 isContinuation）时，极低概率加轻承接词。
   *   克制：避免每轮都接，仅作自然过渡。 */
  // 候选 F·F3：BRIDGE 由 3 → 5 条
  var BRIDGE = ['对了', '话说', '诶，说起这个', '顺便说一句', '哎对了'];
  function continuity(text, ctx, warmth, rng) {
    if (!ctx || !ctx.isContinuation) return text;
    if (!chance(0.24 * clamp01(warmth), rng)) return text;   // 候选 F·F6：门槛 0.22 → 0.24
    return pick(BRIDGE, rng) + '，' + text;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 统一编排入口（纯函数，幂等）
   *   opts: { state, ctx }
   *     state : 只读来源（S.persona / S.affection / S.ue / S.mem / S.dayLife …），绝不写回
   *     ctx   : { ue, mood, intent, textured }  —— textured=true 表示本句已含 texture 微行为加工
   *             （本地引擎分支），此情形下跳过 情绪镜像 + 记忆引用，仅留节奏 + 连贯，防双加工。
   * ══════════════════════════════════════════════════════════════════════ */
  function orchestrate(text, opts) {
    if (!cfg.enabled) return text;
    if (typeof text !== 'string' || !text.trim()) return text;
    opts = opts || {};
    var state = opts.state || {};
    var ctx = opts.ctx || {};
    var rng = (opts && typeof opts.rng === 'function') ? opts.rng : Math.random;
    try {
      var micro = hasMicro(text);
      var textured = !!ctx.textured;            // 本地引擎分支已含 texture 加工
      // 候选 E·L4：强度由 S.persona.warmth/proactivity/whitespace 驱动，回退 cfg 默认
      var warmth = getParam(state, 'warmth', cfg.warmth);
      var proactivity = getParam(state, 'proactivity', cfg.proactivity);
      var whitespace = getParam(state, 'whitespace', cfg.whitespace);
      var out = text;
      // 情绪镜像：textured 分支已含 texture tic，跳过；否则按 micro 与否决定强度
      if (!textured) {
        out = mirror(out, ctx, warmth * (micro ? 0.5 : 1), rng);
      }
      // 记忆自然引用：textured 分支已含 texture drift，跳过；否则生效
      if (!textured) {
        out = recall(out, state, proactivity, rng);
      }
      // 话题连贯：两分支都做（texture 未覆盖该维度）
      out = continuity(out, ctx, warmth, rng);
      // 节奏分段：两分支都做（texture 未覆盖该维度），最后执行避免干扰中间文本
      out = pacing(out, whitespace, rng);
      return out;
    } catch (e) {
      return text;   // 任一异常 → 原句直出，绝不静默 / 白屏
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · 对外门面
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: VERSION,
    orchestrate: orchestrate,
    setConfig: function (c) {
      if (c && typeof c === 'object') {
        for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k) && k in cfg) cfg[k] = c[k]; }
      }
      return api.getConfig();
    },
    getConfig: function () { var o = {}; for (var k in cfg) o[k] = cfg[k]; return o; },
    // 仅供测试：归一化与防叠加检测
    _normTone: normTone,
    _hasMicro: hasMicro
  };

  G.ReplyTexture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
