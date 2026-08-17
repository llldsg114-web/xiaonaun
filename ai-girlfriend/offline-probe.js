/**
 * offline-probe.js · 心屿 候选 C（隐私/端侧增强）· 离线三态探测（挂 window.OfflineProbe，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 探测在线 / 降级 / 离线三态：
 *   online    —— navigator.onLine 且能触达同源资源；
 *   degraded  —— navigator.onLine 但同源探测失败（网络在但服务不可达）；
 *   offline   —— navigator.onLine === false（无任何网络）。
 * 绕开冻结的 sw.js（v14, key=19）：仅用 navigator.onLine + 同源 HEAD 探测，
 * 不读写任何 sw 缓存。最近态缓存到 xinyu.offline。
 * 铁律：不引入任何第三方库；不触碰冻结线。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var OFFLINE_KEY = 'xinyu.offline';
  var STATE_ONLINE = 'online';
  var STATE_DEGRADED = 'degraded';
  var STATE_OFFLINE = 'offline';

  /** 安全 localStorage 读取（静默降级） */
  function safeLsGet(k) {
    try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; }
  }
  /** 安全 localStorage 写入（静默降级） */
  function safeLsSet(k, v) {
    try { if (G.localStorage) G.localStorage.setItem(k, v); } catch (e) {}
  }

  /**
   * OfflineProbe —— 离线三态探测。
   * @constructor
   */
  function OfflineProbe() {
    this.state = (typeof navigator !== 'undefined' && navigator.onLine === false)
      ? STATE_OFFLINE : STATE_ONLINE;
    this.lastCheck = 0;
    this.cacheName = 'xinyu-edge-v1'; // 仅用于语义标识，不实际读写该 Cache
    this.checkInterval = 30000;
    this._callbacks = [];
    this._timer = null;
    // 同源探测地址：当前页面（HEAD，廉价且稳定存在）
    this._probeUrl = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/';
  }

  /** 单例（A/B/C 与测试共用） */
  OfflineProbe.getInstance = function () {
    if (!OfflineProbe._inst) OfflineProbe._inst = new OfflineProbe();
    return OfflineProbe._inst;
  };

  /**
   * 启动周期探测：立即探测一次，并监听 online/offline 事件 + 周期轮询。
   * @param {number} [interval] 轮询间隔（ms），默认 30000
   */
  OfflineProbe.prototype.start = function (interval) {
    if (typeof interval === 'number' && interval > 0) this.checkInterval = interval;
    var self = this;
    // 初次探测
    this.checkConnectivity();
    // 浏览器原生网络事件
    if (typeof G.addEventListener === 'function') {
      G.addEventListener('online', function () { self.checkConnectivity(); });
      G.addEventListener('offline', function () { self._setState(STATE_OFFLINE); });
    }
    // 周期轮询
    if (this._timer) { try { clearInterval(this._timer); } catch (e) {} }
    this._timer = setInterval(function () { self.checkConnectivity(); }, this.checkInterval);
  };

  /**
   * 执行一次连通性探测（若 navigator.onLine=false 直接判离线）。
   * @returns {Promise<string>} 三态之一
   */
  OfflineProbe.prototype.checkConnectivity = function () {
    var self = this;
    return new Promise(function (resolve) {
      // 无网络：直接离线
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        self._setState(STATE_OFFLINE);
        return resolve(STATE_OFFLINE);
      }
      // 无法探测（无 fetch）：信任 navigator.onLine
      if (typeof G.fetch !== 'function') {
        var fallback = (typeof navigator !== 'undefined' && navigator.onLine === false) ? STATE_OFFLINE : STATE_ONLINE;
        self._setState(fallback);
        return resolve(fallback);
      }
      // 同源 HEAD 探测
      G.fetch(self._probeUrl, { method: 'HEAD', cache: 'no-store' })
        .then(function () { self._setState(STATE_ONLINE); resolve(STATE_ONLINE); })
        .catch(function () { self._setState(STATE_DEGRADED); resolve(STATE_DEGRADED); });
    });
  };

  /**
   * 设置并广播状态（仅变化时通知）。
   * @param {string} state
   */
  OfflineProbe.prototype._setState = function (state) {
    this.lastCheck = Date.now();
    var changed = (this.state !== state);
    this.state = state;
    this._persist();
    if (changed) {
      for (var i = 0; i < this._callbacks.length; i++) {
        try { this._callbacks[i](state); } catch (e) {}
      }
    }
  };

  /**
   * 读取当前离线态。
   * @returns {string}
   */
  OfflineProbe.prototype.getState = function () {
    return this.state;
  };

  /**
   * 注册状态变化回调。
   * @param {function(string):void} cb
   * @returns {function():void} 取消订阅函数
   */
  OfflineProbe.prototype.onChange = function (cb) {
    if (typeof cb !== 'function') return function () {};
    this._callbacks.push(cb);
    return function off() {
      var idx = this._callbacks.indexOf(cb);
      if (idx >= 0) this._callbacks.splice(idx, 1);
    }.bind(this);
  };

  /** 持久化最近态到 xinyu.offline */
  OfflineProbe.prototype._persist = function () {
    try {
      safeLsSet(OFFLINE_KEY, JSON.stringify({ state: this.state, lastCheck: this.lastCheck }));
    } catch (e) {}
  };

  // 对外门面
  G.OfflineProbe = OfflineProbe;
  if (typeof module !== 'undefined' && module.exports) module.exports = OfflineProbe;
})();
