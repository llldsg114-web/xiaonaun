/**
 * consent-store.js · 心屿 候选 C（隐私/端侧增强）· 同意状态存储（挂 window.ConsentStore，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 统一存储用户对各项「显式外发 / 本地能力」的同意态。
 * 字段：tts / asr / ltm / cloudSync。
 *   默认 TTS / ASR / LTM = true（隐私优先但功能可用）；
 *   cloudSync（云同步，唯一外发通道）= false，开启需二次确认（由后续面板 UI 强制）。
 * localStorage key：xinyu.consent。
 * 铁律：不引入任何第三方库；不触碰冻结线；不写入 xinyu.ltm.* / xinyu.voice.*。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  // 全局解析：优先 window，回退 globalThis / self / this（兼容 Node 测试 shim）
  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var KEY = 'xinyu.consent';
  var VERSION = '1';

  // 受控字段白名单（仅这些 key 可被 get/set/isGranted 访问）
  var KEYS = ['tts', 'asr', 'ltm', 'cloudSync'];

  // 默认值（与 PRD Q1–Q8 / 主理人裁定 D2 一致）
  var DEFAULTS = { tts: true, asr: true, ltm: true, cloudSync: false };

  /** 安全 localStorage 读取（静默降级） */
  function safeLsGet(k) {
    try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; }
  }

  /** 安全 localStorage 写入（静默降级） */
  function safeLsSet(k, v) {
    try { if (G.localStorage) G.localStorage.setItem(k, v); } catch (e) {}
  }

  /**
   * ConsentStore —— 同意态仓储。
   * 构造即 load()；之后可静态 getInstance() 取单例。
   * @constructor
   */
  function ConsentStore() {
    this.tts = DEFAULTS.tts;
    this.asr = DEFAULTS.asr;
    this.ltm = DEFAULTS.ltm;
    this.cloudSync = DEFAULTS.cloudSync;
    this.version = VERSION;
    this.load();
  }

  /** 从 localStorage 读取并合并（容错，缺字段回落默认） */
  ConsentStore.prototype.load = function () {
    try {
      var raw = safeLsGet(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return;
      this.tts = (typeof o.tts === 'boolean') ? o.tts : DEFAULTS.tts;
      this.asr = (typeof o.asr === 'boolean') ? o.asr : DEFAULTS.asr;
      this.ltm = (typeof o.ltm === 'boolean') ? o.ltm : DEFAULTS.ltm;
      this.cloudSync = (typeof o.cloudSync === 'boolean') ? o.cloudSync : DEFAULTS.cloudSync;
      this.version = (typeof o.version === 'string') ? o.version : VERSION;
    } catch (e) { /* 损坏数据回落默认 */ }
  };

  /** 持久化当前同意态到 localStorage */
  ConsentStore.prototype.save = function () {
    try {
      var payload = {
        version: this.version,
        tts: !!this.tts,
        asr: !!this.asr,
        ltm: !!this.ltm,
        cloudSync: !!this.cloudSync,
      };
      safeLsSet(KEY, JSON.stringify(payload));
    } catch (e) {}
  };

  /**
   * 读取某字段同意态（布尔）。仅白名单内字段有效，其余返回 false。
   * @param {string} key 字段名（tts/asr/ltm/cloudSync）
   * @returns {boolean}
   */
  ConsentStore.prototype.get = function (key) {
    if (KEYS.indexOf(key) === -1) return false;
    return !!this[key];
  };

  /**
   * 设置某字段同意态并持久化。
   * 注意：cloudSync 开启的「二次确认」由后续面板 UI 负责拦截，
   * 本层仅做存储；本批次不实现 UI，故直接落盘（调用方需自行确保已二次确认）。
   * @param {string} key 字段名
   * @param {boolean} val 是否同意
   * @returns {boolean} 是否成功写入（非白名单字段返回 false）
   */
  ConsentStore.prototype.set = function (key, val) {
    if (KEYS.indexOf(key) === -1) return false;
    this[key] = !!val;
    this.save();
    return true;
  };

  /**
   * 是否已被授予某权限（同 get）。
   * @param {string} key 字段名
   * @returns {boolean}
   */
  ConsentStore.prototype.isGranted = function (key) {
    return this.get(key);
  };

  /**
   * 重置为默认值（TTS/ASR/LTM=true，cloudSync=false）并持久化。
   */
  ConsentStore.prototype.reset = function () {
    this.tts = DEFAULTS.tts;
    this.asr = DEFAULTS.asr;
    this.ltm = DEFAULTS.ltm;
    this.cloudSync = DEFAULTS.cloudSync;
    this.version = VERSION;
    this.save();
  };

  /** 单例（A/B/C 与测试共用同一份同意态） */
  ConsentStore.getInstance = function () {
    if (!ConsentStore._inst) ConsentStore._inst = new ConsentStore();
    return ConsentStore._inst;
  };

  // 对外门面
  G.ConsentStore = ConsentStore;
  if (typeof module !== 'undefined' && module.exports) module.exports = ConsentStore;
})();
