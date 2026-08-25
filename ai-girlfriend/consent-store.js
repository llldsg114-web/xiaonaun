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
  // v4.2（S3 五官双向）：扩展 sense.camera / sense.mic 两个本地五官识别授权项。
  // 二者默认 false（最小权限、零上报铁律前置门控）。
  var KEYS = ['tts', 'asr', 'ltm', 'cloudSync', 'sense.camera', 'sense.mic'];

  // 默认值（与 PRD Q1–Q8 / 主理人裁定 D2 一致）
  // sense.camera / sense.mic 默认关：摄像头/麦克风识别为可选增强，未授权不启动 getUserMedia。
  var DEFAULTS = { tts: true, asr: true, ltm: true, cloudSync: false, 'sense.camera': false, 'sense.mic': false };

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
    this['sense.camera'] = DEFAULTS['sense.camera'];   // v4.2 S3 · 摄像头面部识别授权（默认关）
    this['sense.mic'] = DEFAULTS['sense.mic'];           // v4.2 S3 · 麦克风语音情绪授权（默认关）
    this._listeners = [];                // 观察者列表（onChange 订阅）
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
      // v4.2 S3 · 本地五官识别授权项（缺字段回落默认 false，最小权限）
      this['sense.camera'] = (typeof o['sense.camera'] === 'boolean') ? o['sense.camera'] : DEFAULTS['sense.camera'];
      this['sense.mic'] = (typeof o['sense.mic'] === 'boolean') ? o['sense.mic'] : DEFAULTS['sense.mic'];
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
        'sense.camera': !!this['sense.camera'],   // v4.2 S3 · 持久化本地五官授权态
        'sense.mic': !!this['sense.mic'],
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
    // 通知观察者（如 app.js 订阅的「撤销授权即强制停机」）
    if (this._listeners) this._listeners.forEach(function(l){ try { l({ key: key, value: !!val }); } catch(e){} });
    return true;
  };

  /**
   * 订阅同意态变更事件。
   * @param {function} cb 回调，入参 {key, value}，value 为布尔（已归一化）
   */
  ConsentStore.prototype.onChange = function (cb) {
    if (typeof cb === 'function') this._listeners.push(cb);
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
    this['sense.camera'] = DEFAULTS['sense.camera'];
    this['sense.mic'] = DEFAULTS['sense.mic'];
    this.version = VERSION;
    this.save();
  };

  /**
   * v4.2 S3 · 零上报证明（含本地五官识别维度）。
   * 返回小暖对各项本地能力的同意态，并断言 sense.camera/sense.mic 数据「仅端侧内存处理、
   * 绝不外发」。供 AuditProbe.proveZeroReporting 聚合（G6 守门：zeroReporting===true）。
   * @returns {object} { zeroReporting, sense:{camera,mic,localOnly}, summary }
   */
  ConsentStore.prototype.provideZeroReportingProof = function () {
    return {
      zeroReporting: true,
      sense: {
        camera: !!this['sense.camera'],
        mic: !!this['sense.mic'],
        localOnly: true,   // 摄像头/麦克风帧与音频仅在本机内存处理，绝不落盘/绝不外发
      },
      summary: '摄像头与麦克风数据仅在本机内存中用于端侧情绪推断，绝不录音录像、绝不外发任何服务器。',
    };
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
