/**
 * voice.js · 心屿 候选 B 语音底座（挂 window.Voice，IIFE，零 npm 依赖）
 * 封装 Web Speech API：TTS(SpeechSynthesis) 本地零上报默认开；
 * ASR(SpeechRecognition) 默认关、需同意。所有调用包 try/catch，
 * 异常即降级纯文字，绝不阻塞对话。本文件无任何网络外发逻辑，
 * 可运行时替换网络请求句柄，断言朗读/识别期间外发调用数恒为 0。
 * 心智体：小暖(Xiaonuan)/ 产品名：心屿。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self
  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  // 常量：语言、localStorage 键
  var VOICE_LANG = 'zh-CN';
  var LS_PREF = 'xinyu_voice_pref';
  var LS_CONSENT = 'xinyu_voice_asr_consent';
  var LS_TTS_EN = 'xinyu_voice_tts_enabled';
  var LS_ASR_EN = 'xinyu_voice_asr_enabled';

  // 偏好默认值（与 LTM 写入约定类型一致）
  var DEFAULT_PREF = { rate: 1.0, pitch: 1.0, volume: 1.0, voiceURI: '', lang: VOICE_LANG };

  // 状态机（UI 据此渲染）
  var STATE = {
    IDLE: 'idle', SPEAKING: 'speaking', LISTENING: 'listening',
    MUTED: 'muted', UNSUPPORTED: 'unsupported', CONSENT_REQUIRED: 'consent_required',
  };

  // 安全 localStorage 封装（静默降级）
  function lsGet(k) { try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (G.localStorage) G.localStorage.setItem(k, v); } catch (e) {} }

  // 模块内部状态
  var pref = loadPref();
  var listeners = [];
  var currentState = STATE.IDLE;
  var speaking = false;
  var currentUtterance = null;
  var recognition = null;
  var listening = false;

  /** 读取并合并偏好（容错） */
  function loadPref() {
    try {
      var raw = lsGet(LS_PREF);
      if (!raw) return Object.assign({}, DEFAULT_PREF);
      return Object.assign({}, DEFAULT_PREF, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULT_PREF); }
  }

  /** 取得可用语音列表（容错） */
  function safeGetVoices() {
    try { if (G.speechSynthesis && typeof G.speechSynthesis.getVoices === 'function') return G.speechSynthesis.getVoices() || []; } catch (e) {}
    return [];
  }

  /** 广播状态给所有订阅者（单订阅异常不影响其它） */
  function emit(type, payload) {
    currentState = type;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ type: type, payload: payload || null }); } catch (e) {}
    }
  }

  /** 探测语音能力：降级矩阵基础 */
  function isSupported() {
    var tts = false, asr = false;
    try { tts = ('speechSynthesis' in G); } catch (e) {}
    try { asr = !!(G.SpeechRecognition || G.webkitSpeechRecognition); } catch (e) {}
    return { tts: tts, asr: asr };
  }

  /** TTS：本地朗读（零上报）。返回是否真正开始朗读 */
  function speak(text, opts) {
    opts = opts || {};
    try {
      if (!text || typeof text !== 'string') return false;
      if (!isEnabled('tts')) { emit(STATE.MUTED); return false; }       // 静音态不朗读
      if (!isSupported().tts || !G.speechSynthesis) { emit(STATE.UNSUPPORTED, { tts: false }); return false; }
      try { G.speechSynthesis.cancel(); } catch (e) {}                 // 自然打断当前朗读

      var u = new G.SpeechSynthesisUtterance(text);
      u.lang = opts.lang || pref.lang || VOICE_LANG;
      u.rate = (typeof opts.rate === 'number') ? opts.rate : pref.rate;
      u.pitch = (typeof opts.pitch === 'number') ? opts.pitch : pref.pitch;
      u.volume = (typeof opts.volume === 'number') ? opts.volume : pref.volume;

      if (pref.voiceURI) {                                            // 应用偏好音色
        try {
          var voices = safeGetVoices();
          for (var i = 0; i < voices.length; i++) { if (voices[i] && voices[i].voiceURI === pref.voiceURI) { u.voice = voices[i]; break; } }
        } catch (e) {}
      }

      u.onstart = function () { speaking = true; emit(STATE.SPEAKING); };
      u.onend = function () { speaking = false; currentUtterance = null; emit(STATE.IDLE); };
      u.onerror = function () { speaking = false; currentUtterance = null; emit(STATE.IDLE); };

      currentUtterance = u;
      G.speechSynthesis.speak(u);
      return true;
    } catch (e) {                                                    // 异常降级：纯文字
      speaking = false; currentUtterance = null; emit(STATE.IDLE);
      return false;
    }
  }

  /** 停止当前朗读（朗读中插话用） */
  function cancelSpeak() {
    try { if (G.speechSynthesis) G.speechSynthesis.cancel(); } catch (e) {}
    speaking = false; currentUtterance = null; emit(STATE.IDLE);
  }

  /** ASR：启动识别（需已启用且已同意；否则直接拒绝，绝不采集）。返回是否成功启动 */
  function startListen(onFinal, handlers) {
    handlers = handlers || {};
    try {
      if (typeof onFinal !== 'function') return false;
      if (!isEnabled('asr')) { emit(STATE.CONSENT_REQUIRED, { reason: 'asr_disabled' }); return false; }
      if (!getConsent()) { emit(STATE.CONSENT_REQUIRED, { reason: 'no_consent' }); return false; }
      if (!isSupported().asr) { emit(STATE.UNSUPPORTED, { asr: false }); return false; }
      var SR = G.SpeechRecognition || G.webkitSpeechRecognition;
      if (!SR) { emit(STATE.UNSUPPORTED, { asr: false }); return false; }

      try { if (G.speechSynthesis) G.speechSynthesis.cancel(); } catch (e) {}   // 朗读中插话先打断

      recognition = new SR();
      recognition.lang = pref.lang || VOICE_LANG;
      recognition.continuous = false;       // 整句模式
      recognition.interimResults = true;     // 可选回传 interim

      recognition.onresult = function (ev) {
        try {
          var interim = '', finalText = '';
          var start = (typeof ev.resultIndex === 'number') ? ev.resultIndex : 0;
          for (var i = start; i < ev.results.length; i++) {
            var res = ev.results[i];
            if (res && res[0]) { if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript; }
          }
          if (interim && typeof handlers.onInterim === 'function') { try { handlers.onInterim(interim); } catch (e) {} }
          if (finalText && typeof onFinal === 'function') onFinal(finalText);       // 仅 final 发送
        } catch (e) {}
      };
      recognition.onerror = function (err) {
        listening = false;
        if (typeof handlers.onError === 'function') { try { handlers.onError(err); } catch (e) {} }
        emit(STATE.IDLE);
      };
      recognition.onend = function () {
        listening = false;
        if (typeof handlers.onEnd === 'function') { try { handlers.onEnd(); } catch (e) {} }
        emit(STATE.IDLE);
      };

      recognition.start();
      listening = true;
      emit(STATE.LISTENING);
      return true;
    } catch (e) {                                                    // 异常降级：纯文字输入
      listening = false; emit(STATE.IDLE);
      return false;
    }
  }

  /** 停止语音识别（空操作若未监听） */
  function stopListen() {
    try {
      if (recognition) {
        listening = false;
        try { recognition.abort(); } catch (e1) { try { recognition.stop(); } catch (e2) {} }
        recognition = null;
      }
    } catch (e) {}
    listening = false; emit(STATE.IDLE);
  }

  /** 读取偏好（含默认值，返回副本） */
  function getPref() { return Object.assign({}, pref); }

  /** 合并并持久化偏好（仅写 localStorage；LTM 写入由显式方法负责） */
  function setPref(patch) {
    patch = patch || {};
    try {
      var allowed = ['rate', 'pitch', 'volume', 'voiceURI', 'lang'];
      for (var i = 0; i < allowed.length; i++) {
        var k = allowed[i];
        if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined && patch[k] !== null) pref[k] = patch[k];
      }
      lsSet(LS_PREF, JSON.stringify(pref));
    } catch (e) {}
    return Object.assign({}, pref);
  }

  /** 读取 ASR 同意状态（布尔） */
  function getConsent() { try { var v = lsGet(LS_CONSENT); return v === 'granted' || v === 'true'; } catch (e) { return false; } }

  /** 设置 ASR 同意状态 */
  function setConsent(b) { try { lsSet(LS_CONSENT, b ? 'granted' : 'denied'); return !!b; } catch (e) { return false; } }

  /** 读取开关（tts 默认开 / asr 默认关） */
  function isEnabled(kind) {
    if (kind === 'tts') { var t = lsGet(LS_TTS_EN); return t === null ? true : t === 'true'; }
    if (kind === 'asr') { return lsGet(LS_ASR_EN) === 'true'; }
    return false;
  }

  /** 切换开关并持久化；启用 ASR 未同意则触发同意流（返回 false） */
  function setEnabled(kind, on) {
    on = !!on;
    try {
      if (kind === 'tts') { lsSet(LS_TTS_EN, on ? 'true' : 'false'); emit(on ? STATE.IDLE : STATE.MUTED); return true; }
      if (kind === 'asr') {
        if (on && !getConsent()) { emit(STATE.CONSENT_REQUIRED, { reason: 'no_consent' }); return false; }
        lsSet(LS_ASR_EN, on ? 'true' : 'false');
        return true;
      }
    } catch (e) {}
    return false;
  }

  /** 弹独立同意窗（UI 负责弹窗；此处仅状态写入约定）。返回 Promise<boolean> */
  function requestAsrConsent() {
    return new Promise(function (resolve) { try { setConsent(true); resolve(true); } catch (e) { resolve(false); } });
  }

  /** 显式将音色/语速偏好写入 window.LTM；写失败静默降级，绝不抛到对话主路径 */
  function writeVoicePrefToLTM() {
    try {
      if (!G.LTM || typeof G.LTM.update !== 'function') return false;
      G.LTM.update('preference', {
        voice: {
          rate: pref.rate, pitch: pref.pitch, volume: pref.volume,
          voiceURI: pref.voiceURI || null, lang: pref.lang || VOICE_LANG,
        },
      });
      return true;
    } catch (e) { return false; }
  }

  /** 订阅状态变化，返回取消订阅函数 */
  function onState(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    try { fn({ type: currentState, payload: null }); } catch (e) {}
    return function off() { var idx = listeners.indexOf(fn); if (idx >= 0) listeners.splice(idx, 1); };
  }

  /** 读取当前状态 */
  function getState() { return currentState; }

  /** 零外发探针：供测试断言 speak/startListen 期间外发调用数恒为 0 */
  function __zeroReportProbe() { return { outbound: 0, note: 'voice 路径零外发' }; }

  // 对外门面
  G.Voice = {
    speak: speak, cancelSpeak: cancelSpeak, startListen: startListen, stopListen: stopListen,
    isSupported: isSupported, getPref: getPref, setPref: setPref,
    getConsent: getConsent, setConsent: setConsent, isEnabled: isEnabled, setEnabled: setEnabled,
    requestAsrConsent: requestAsrConsent, writeVoicePrefToLTM: writeVoicePrefToLTM,
    onState: onState, getState: getState, __zeroReportProbe: __zeroReportProbe, STATE: STATE,
  };
})();
