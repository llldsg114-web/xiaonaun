/**
 * offline-indicator.js · 心屿 候选 C（C-E4 · C11）· 离线三态指示灯（挂 window.OfflineIndicator，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 在顶栏挂载在线(绿)/降级(黄)/离线(灰) 三态指示灯，纯原生 CSS 动效，无外部依赖。
 * 由 app.js 订阅 OfflineProbe.onChange 驱动 setState()/animate()。
 * 铁律：不引入任何第三方库；不触碰冻结线。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var STATE_ONLINE = 'online';
  var STATE_DEGRADED = 'degraded';
  var STATE_OFFLINE = 'offline';

  var LABELS = {
    online: '在线 · 本地优先',
    degraded: '网络不佳 · 已降级',
    offline: '离线 · 完全本地',
  };

  /**
   * OfflineIndicator —— 三态指示灯。
   * @constructor
   */
  function OfflineIndicator() {
    this._el = null;
    this._state = null;
  }

  /** 单例 */
  OfflineIndicator.getInstance = function () {
    if (!OfflineIndicator._inst) OfflineIndicator._inst = new OfflineIndicator();
    return OfflineIndicator._inst;
  };

  /**
   * 在 anchor 容器内挂载指示灯（若 anchor 内已有 .xn-offline-led 则复用）。
   * @param {HTMLElement} anchor
   * @returns {OfflineIndicator}
   */
  OfflineIndicator.prototype.mount = function (anchor) {
    if (!anchor) return this;
    try {
      var el = anchor.querySelector('.xn-offline-led');
      if (!el) {
        el = document.createElement('span');
        el.className = 'xn-offline-led';
        anchor.appendChild(el);
      }
      this._el = el;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', '网络状态指示灯');
      var init = (G.OfflineProbe && G.OfflineProbe.getInstance)
        ? G.OfflineProbe.getInstance().getState() : STATE_ONLINE;
      this.setState(init || STATE_ONLINE);
    } catch (e) {}
    return this;
  };

  /**
   * 设置三态：online(绿)/degraded(黄)/offline(灰)。
   * @param {string} state
   * @returns {OfflineIndicator}
   */
  OfflineIndicator.prototype.setState = function (state) {
    if (state !== STATE_ONLINE && state !== STATE_DEGRADED && state !== STATE_OFFLINE) state = STATE_ONLINE;
    this._state = state;
    if (this._el) {
      this._el.setAttribute('data-state', state);
      this._el.setAttribute('title', LABELS[state] || state);
    }
    return this;
  };

  /**
   * 触发纯原生 CSS 动效（呼吸/脉冲）。通过移除-重排-添加类重启动画。
   * @returns {OfflineIndicator}
   */
  OfflineIndicator.prototype.animate = function () {
    if (!this._el) return this;
    var el = this._el;
    try {
      el.classList.remove('xn-led-anim');
      void el.offsetWidth; // 强制重排以重启 CSS 动画
      el.classList.add('xn-led-anim');
    } catch (e) {}
    return this;
  };

  /** 读取当前态 */
  OfflineIndicator.prototype.getState = function () { return this._state; };

  // 对外门面
  G.OfflineIndicator = OfflineIndicator;
  if (typeof module !== 'undefined' && module.exports) module.exports = OfflineIndicator;
})();
