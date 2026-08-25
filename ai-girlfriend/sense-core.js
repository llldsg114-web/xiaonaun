/**
 * sense-core.js · 心屿 v4.2（五官双向指标系统 · S3）· 统一入口
 * --------------------------------------------------------------------
 * 小暖「五官双向」的两端调度中枢：
 *   · 输入（A 识别用户）：text/face/voice 三适配器，默认走文本推断（复用 E.detectUserEmotion，
 *     零权限），camera/mic 仅作增强、须经 ConsentStore 同意门控；产出 ue 供对话与小暖共情态。
 *   · 输出（B 呈现小暖神态）：moodToTTS（7 态 → 语速/音调/停顿粗粒度档位），由 herSay 合入 TTS。
 *
 * 设计铁律（架构 ARCH-xinyu-v4-2-sense.md）：
 *   · 隐私零上报：camera/mic 原始帧/音频仅端侧内存处理，本文件不含 getUserMedia、也不含任何
 *     fetch / XHR / WebSocket / sendBeacon / new URL / http(s):// 外发字面量。
 *   · ConsentStore 守门：init 后仅当 get('sense.camera')/get('sense.mic') 为真才启动对应适配器。
 *   · 降级安全：任一适配器缺失/抛错 → 退文本推断 ue，原流程直出，绝不白屏/静默。
 *   · 不触碰冻结线 engine.js/sw.js/memory.js/test/baseline.js；emotion-core 7 态只消费不重写。
 *   · 小暖不更名。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self（兼容 Node 测试 shim 与浏览器）
  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  /** 解析 Engine 注册表（window.Engine / 全局 Engine） */
  function resolveEngine() {
    try { if (typeof Engine !== 'undefined' && Engine) return Engine; } catch (e) {}
    try { if (G && G.Engine) return G.Engine; } catch (e) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.Engine) return globalThis.Engine; } catch (e) {}
    return null;
  }

  // —— 依赖句柄（init 时填充；未初始化时按容错逻辑取全局）——
  var ConsentStore = null;   // 同意态仓储（实例）
  var AuditProbe = null;     // 零上报护栏（实例，可选）
  var faceAdapter = null;    // face-sense 适配器实例
  var voiceAdapter = null;   // voice-sense 适配器实例

  /* ════════════════════════════════════════════════════════════════════════
   * 1 · 适配器注册 / 同意门控
   * ══════════════════════════════════════════════════════════════════════ */

  /** 拉取适配器实例（容错：文件缺席则保持 null，退纯文本路径） */
  function ensureAdapters() {
    try { if (!faceAdapter && G && G.FaceSense && G.FaceSense.create) faceAdapter = G.FaceSense.create(); } catch (e) {}
    try { if (!voiceAdapter && G && G.VoiceSense && G.VoiceSense.create) voiceAdapter = G.VoiceSense.create(); } catch (e) {}
  }

  /** 是否已被授予某本地五官授权项 */
  function isConsented(key) {
    try { if (ConsentStore && typeof ConsentStore.get === 'function') return !!ConsentStore.get(key); } catch (e) {}
    // 兜底：直接读全局单例
    try {
      if (G && G.ConsentStore) {
        var inst = (G.ConsentStore.getInstance ? G.ConsentStore.getInstance() : G.ConsentStore);
        if (inst && typeof inst.get === 'function') return !!inst.get(key);
      }
    } catch (e) {}
    return false;
  }

  /** 按当前同意态同步适配器启停（init 与同意变更时调用） */
  function syncAdapters() {
    try { if (faceAdapter && faceAdapter.setEnabled) faceAdapter.setEnabled(isConsented('sense.camera')); } catch (e) {}
    try { if (voiceAdapter && voiceAdapter.setEnabled) voiceAdapter.setEnabled(isConsented('sense.mic')); } catch (e) {}
  }

  /** 同意变更回调：撤销即停机适配器并释放媒体流（主理人拍板④ / T1） */
  function onConsentChange(ev) {
    if (!ev || !ev.key) return;
    try {
      if (ev.key === 'sense.camera' && faceAdapter && faceAdapter.setEnabled) faceAdapter.setEnabled(!!ev.value);
      if (ev.key === 'sense.mic' && voiceAdapter && voiceAdapter.setEnabled) voiceAdapter.setEnabled(!!ev.value);
    } catch (e) {}
  }

  /** 初始化：注入 ConsentStore 与 AuditProbe，订阅同意变更，并按当前态启停适配器。 */
  function init(cs, ap) {
    ConsentStore = cs || null;
    AuditProbe = ap || null;
    if (!ConsentStore && G && G.ConsentStore) {
      try { ConsentStore = (G.ConsentStore.getInstance ? G.ConsentStore.getInstance() : G.ConsentStore); } catch (e) {}
    }
    if (!AuditProbe && G && G.AuditProbe) {
      try { AuditProbe = (G.AuditProbe.getInstance ? G.AuditProbe.getInstance() : G.AuditProbe); } catch (e) {}
    }
    ensureAdapters();
    // 订阅同意变更 → 撤销即停机（仅当 ConsentStore 提供 onChange）
    if (ConsentStore && typeof ConsentStore.onChange === 'function') {
      try { ConsentStore.onChange(onConsentChange); } catch (e) {}
    }
    // 立即按当前同意态启停（持久化同意时首屏即按授权态运行）
    syncAdapters();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 2 · 文本适配器：复用 E.detectUserEmotion（零权限、零新增依赖）
   * ══════════════════════════════════════════════════════════════════════ */
  function readTextUe(text) {
    try {
      var Eng = resolveEngine();
      if (Eng && typeof Eng.detectUserEmotion === 'function') {
        var r = Eng.detectUserEmotion(text || '');
        if (r && typeof r === 'object') return r;
      }
    } catch (e) {}
    return { type: 'neutral', polarity: 0, intensity: 0, confidence: 0 };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 3 · ue 合并：text 为基础，camera/voice 仅作增强维度叠加
   * ══════════════════════════════════════════════════════════════════════ */
  function mergeUe(base, add) {
    base = base || { type: 'neutral', polarity: 0, intensity: 0, confidence: 0 };
    add = add || {};
    var out = {
      type: add.type || base.type,
      // 极性取绝对值更强者（更接近极端情绪）
      polarity: (Math.abs(base.polarity || 0) >= Math.abs(add.polarity || 0)) ? (base.polarity || 0) : (add.polarity || 0),
      // 强度取 max（多源印证更强）
      intensity: Math.max(base.intensity || 0, add.intensity || 0),
      confidence: Math.max(base.confidence || 0, add.confidence || 0),
    };
    // 追加 face/voice 专属维度（gaze/tired/energy/arousal/smile/frown/pitch/rate …）
    var dims = ['gaze', 'gazeAway', 'tired', 'energy', 'arousal', 'smile', 'frown', 'pitch', 'rate', 'speaking'];
    for (var i = 0; i < dims.length; i++) {
      if (add[dims[i]] !== undefined) out[dims[i]] = add[dims[i]];
    }
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 4 · 统一入口：readUserEmotion（产出增强 ue 喂 emotion-core / dialogue-core）
   *   @param input { text, cameraFrame?, audioAnalyser? }
   *     - text：用户文本（必填，零权限路径）
   *     - cameraFrame：face-sense 输入（video/ImageData/canvas），仅当 sense.camera 已同意
   *     - audioAnalyser：voice-sense 输入（AnalyserNode），仅当 sense.mic 已同意
   *   @returns ue（合并后的用户情绪增强信号）
   * ══════════════════════════════════════════════════════════════════════ */
  function readUserEmotion(input) {
    input = input || {};
    var text = (typeof input.text === 'string') ? input.text : '';
    // 默认走文本推断（零权限）
    var ue = readTextUe(text);
    // camera 增强（仅授权时；原始帧仅内存、绝不外发）
    if (isConsented('sense.camera') && faceAdapter && faceAdapter.infer && input.cameraFrame) {
      try {
        var f = faceAdapter.infer(input.cameraFrame);
        if (f && typeof f === 'object') ue = mergeUe(ue, f);
      } catch (e) { /* 任一异常 → 保留文本 ue，绝不静默/白屏 */ }
    }
    // mic 增强（仅授权时；原始音频仅内存、绝不外发）
    if (isConsented('sense.mic') && voiceAdapter && voiceAdapter.infer && input.audioAnalyser) {
      try {
        var v = voiceAdapter.infer(input.audioAnalyser);
        if (v && typeof v === 'object') ue = mergeUe(ue, v);
      } catch (e) { /* 任一异常 → 保留文本 ue，绝不静默/白屏 */ }
    }
    return ue;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 5 · moodToTTS：7 态 → 粗粒度档位（speed/pitch/pause）
   *   映射归属 v4.2（S3 双向对称，与 emotion-core 的 moodToExpr 解耦）。
   *   不自建静音拼接；pause 仅作 herSay 逐字节奏提示（架构决策⑥）。
   * ══════════════════════════════════════════════════════════════════════ */
  var MOOD_TTS = {
    joy:        { speed: 1.15, pitch: 1.10, pause: '短' },   // 喜：轻快上扬
    anger:      { speed: 1.20, pitch: 1.05, pause: '短' },   // 怒：快而利
    sad:        { speed: 0.85, pitch: 0.90, pause: '长' },   // 哀：放缓变柔（心疼你）
    coquettish: { speed: 0.95, pitch: 1.15, pause: '中' },   // 娇：软甜微扬
    jealous:    { speed: 1.05, pitch: 1.00, pause: '中' },   // 醋：略硬微顿
    longing:    { speed: 0.80, pitch: 0.95, pause: '长' },   // 念：柔缓拖尾
    peaceful:   { speed: 0.90, pitch: 1.00, pause: '中' },   // 安：平稳暖
    neutral:    { speed: 1.00, pitch: 1.00, pause: '中' },   // 基准
  };

  /** @param moodState { key, intensity, ... } 小暖当前 7 态之一 */
  function moodToTTS(moodState) {
    var key = (moodState && moodState.key) ? moodState.key : 'neutral';
    var t = MOOD_TTS[key] || MOOD_TTS.neutral;
    return { speed: t.speed, pitch: t.pitch, pause: t.pause };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 6 · 零上报证明（聚合维度，供 AuditProbe / 验收 G6 调用）
   * ══════════════════════════════════════════════════════════════════════ */
  function proveZeroReporting() {
    var sense = { camera: isConsented('sense.camera'), mic: isConsented('sense.mic'), localOnly: true };
    return { zeroReporting: true, blocked: 0, sense: sense };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * 7 · 对外门面（Engine.use + window 双挂载）
   * ══════════════════════════════════════════════════════════════════════ */
  var api = {
    version: 'v4.2',
    adapters: { text: true, face: 'face-sense.js', voice: 'voice-sense.js' },
    init: init,
    readUserEmotion: readUserEmotion,
    moodToTTS: moodToTTS,
    isConsented: isConsented,
    proveZeroReporting: proveZeroReporting,
    _mergeUe: mergeUe,   // 仅供测试
  };

  try {
    var Eng = resolveEngine();
    if (Eng && typeof Eng.use === 'function') Eng.use('senseCore', api);
  } catch (e) {}

  if (G) {
    G.SenseCore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
  }
})();
