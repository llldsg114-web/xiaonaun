/**
 * audit-probe.js · 心屿 候选 C（隐私/端侧增强）· 零上报统一拦截探针（挂 window.AuditProbe，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 统一外发拦截探针（C1）。在 app.js 最早期 install()，对下列通道做包装 / 钩子：
 *   fetch / XMLHttpRequest / WebSocket / navigator.sendBeacon / EventSource
 *   以及 img / script / link / iframe / audio / video / source 等资源标签（createElement 钩子）。
 * 三类处置：
 *   1) allowlist：同源 / blob: / data:（及 about:/javascript: 等非网络 scheme）→ 放行，allowedCount++
 *   2) consentedRegistry：由 app.js 注册的用户显式端点（S.cloud base / syncBase / pushBase 的 host，
 *      仅当对应功能开启时注册）→ 放行并 consentedCount++，审计面板可见
 *   3) 其余（疑似上报 / 第三方追踪）→ 阻断，blockedCount++，进入审计日志
 * proveZeroReporting() 返回 { zeroReporting, blocked, allowed, consented, logs }，断言 blocked==0。
 * getInstance() 单例，A/B/C 与测试共用同一实例。运行时计数持久化到 xinyu.audit。
 * 铁律：不引入任何第三方库；不触碰冻结线；不改写 B 逻辑。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var AUDIT_KEY = 'xinyu.audit';
  var MAX_LOG = 500;

  /** 安全 localStorage 读取（静默降级） */
  function safeLsGet(k) {
    try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; }
  }
  /** 安全 localStorage 写入（静默降级） */
  function safeLsSet(k, v) {
    try { if (G.localStorage) G.localStorage.setItem(k, v); } catch (e) {}
  }

  /**
   * 解析 URL 的 origin（含相对路径 / scheme-relative / 绝对 URL）。
   * 失败时回退到正则抽取 scheme://host 前缀。
   * @param {string} url
   * @returns {string|null}
   */
  function resolveOrigin(url) {
    var u = String(url || '');
    if (!u) return null;
    try {
      var base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/';
      var parsed = new URL(u, base);
      return parsed.origin;
    } catch (e) {
      var m = /^([a-z][a-z0-9+.\-]*:\/\/[^\/]+)/i.exec(u);
      return m ? m[1] : null;
    }
  }

  /**
   * AuditProbe —— 零上报统一拦截探针。
   * @constructor
   */
  function AuditProbe() {
    this.blockedCount = 0;
    this.allowedCount = 0;
    this.consentedCount = 0;
    this.probeLog = [];
    // allowlist：非网络 scheme 默认放行；同源 origin 在 classify 时动态补全
    this.allowlist = new Set(['blob:', 'data:', 'about:', 'javascript:']);
    if (typeof location !== 'undefined' && location.origin) this.allowlist.add(location.origin);
    // consentedRegistry：由 app.js 注册的用户显式端点（host / 完整 URL）
    this.consentedRegistry = new Set();
    this._installed = false;
    this._maxLog = MAX_LOG;
    this._restore();
  }

  /** 单例（A/B/C 与测试共用） */
  AuditProbe.getInstance = function () {
    if (!AuditProbe._inst) AuditProbe._inst = new AuditProbe();
    return AuditProbe._inst;
  };

  /** 静态安装入口：确保单例并安装全部拦截器（app.js 最早期调用） */
  AuditProbe.install = function () {
    return AuditProbe.getInstance().install();
  };

  /**
   * 安装全部外发拦截器（幂等）。
   * @returns {AuditProbe}
   */
  AuditProbe.prototype.install = function () {
    if (this._installed) return this;
    try { this.wrapFetch(); } catch (e) {}
    try { this.wrapXHR(); } catch (e) {}
    try { this.wrapWebSocket(); } catch (e) {}
    try { this.wrapSendBeacon(); } catch (e) {}
    try { this.wrapEventSource(); } catch (e) {}
    try { this.hookResourceTags(); } catch (e) {}
    this._installed = true;
    return this;
  };

  /**
   * 包装 window.fetch：所有 fetch 经 record() 拦截；
   * 非 allowlist / 非 consented 的第三方请求 → 阻断（reject）。
   */
  AuditProbe.prototype.wrapFetch = function () {
    if (typeof G.fetch !== 'function') return;
    if (G.__audit_fetch_wrapped) return;
    var self = this;
    var nativeFetch = G.fetch.bind(G);
    G.fetch = function (input, init) {
      var url = '';
      try {
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
        else if (input && typeof input.toString === 'function') url = input.toString();
      } catch (e) {}
      var action = self._classify(url);
      self.record('fetch', url, action);
      if (action === 'blocked') {
        return Promise.reject(new TypeError('Blocked by Xinyu privacy audit: ' + url));
      }
      return nativeFetch(input, init);
    };
    G.__audit_fetch_wrapped = true;
  };

  /**
   * 包装 XMLHttpRequest.open/send：记录并阻断可疑外发。
   */
  AuditProbe.prototype.wrapXHR = function () {
    if (typeof G.XMLHttpRequest !== 'function') return;
    if (G.__audit_xhr_wrapped) return;
    var self = this;
    var NativeXHR = G.XMLHttpRequest;
    var nativeOpen = NativeXHR.prototype.open;
    NativeXHR.prototype.open = function (method, url) {
      var action = self._classify(url);
      self.record('xhr', url, action);
      this.__auditBlocked = (action === 'blocked');
      return nativeOpen.apply(this, arguments);
    };
    var nativeSend = NativeXHR.prototype.send;
    NativeXHR.prototype.send = function (body) {
      if (this.__auditBlocked) {
        // 注：blocked 计数已由 open() 的 record('xhr', url, action) 完成（单次外发仅计 1 次）。
        // 此处不再重复计数，仅执行拦截（触发 onerror / dispatchEvent('error') 并提前返回）。
        var xhr = this;
        if (typeof setTimeout === 'function') {
          setTimeout(function () {
            try { if (typeof xhr.onerror === 'function') xhr.onerror({ type: 'error' }); } catch (e) {}
            try { if (typeof Event !== 'undefined') xhr.dispatchEvent(new Event('error')); } catch (e2) {}
          }, 0);
        }
        return;
      }
      return nativeSend.apply(this, arguments);
    };
    G.__audit_xhr_wrapped = true;
  };

  /**
   * 包装 WebSocket 构造器：可疑端点直接抛错阻断。
   */
  AuditProbe.prototype.wrapWebSocket = function () {
    if (typeof G.WebSocket !== 'function') return;
    if (G.__audit_ws_wrapped) return;
    var self = this;
    var NativeWS = G.WebSocket;
    function WS(url, protocols) {
      var action = self._classify(url);
      self.record('ws', url, action);
      if (action === 'blocked') throw new Error('Blocked by Xinyu privacy audit: ' + url);
      return new NativeWS(url, protocols);
    }
    WS.prototype = NativeWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { WS[k] = NativeWS[k]; });
    G.WebSocket = WS;
    G.__audit_ws_wrapped = true;
  };

  /**
   * 包装 navigator.sendBeacon：可疑端点阻断（返回 false）。
   */
  AuditProbe.prototype.wrapSendBeacon = function () {
    if (typeof navigator === 'undefined' || !navigator || typeof navigator.sendBeacon !== 'function') return;
    if (G.__audit_beacon_wrapped) return;
    var self = this;
    var nativeBeacon;
    try { nativeBeacon = navigator.sendBeacon.bind(navigator); } catch (e) { return; }
    try {
      navigator.sendBeacon = function (url, data) {
        var action = self._classify(url);
        self.record('beacon', url, action);
        if (action === 'blocked') return false;
        return nativeBeacon(url, data);
      };
      G.__audit_beacon_wrapped = true;
    } catch (e) { /* navigator.sendBeacon 只读则跳过 */ }
  };

  /**
   * 包装 EventSource 构造器：可疑端点直接抛错阻断。
   */
  AuditProbe.prototype.wrapEventSource = function () {
    if (typeof G.EventSource !== 'function') return;
    if (G.__audit_es_wrapped) return;
    var self = this;
    var NativeES = G.EventSource;
    function ES(url, cfg) {
      var action = self._classify(url);
      self.record('eventsource', url, action);
      if (action === 'blocked') throw new Error('Blocked by Xinyu privacy audit: ' + url);
      return new NativeES(url, cfg);
    }
    ES.prototype = NativeES.prototype;
    ['CONNECTING', 'OPEN', 'CLOSED'].forEach(function (k) { ES[k] = NativeES[k]; });
    G.EventSource = ES;
    G.__audit_es_wrapped = true;
  };

  /**
   * 钩子 document.createElement：对资源标签（img/script/link/iframe/...）
   * 拦截 src / href 的 setAttribute 与属性赋值，可疑资源不真正加载。
   */
  AuditProbe.prototype.hookResourceTags = function () {
    if (typeof document === 'undefined' || !document.createElement) return;
    if (G.__audit_res_wrapped) return;
    var self = this;
    var RES = { IMG: 1, SCRIPT: 1, LINK: 1, IFRAME: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, TRACK: 1 };
    var nativeCreate = document.createElement;
    document.createElement = function (tagName) {
      var el;
      try { el = nativeCreate.call(document, tagName); } catch (e) { return nativeCreate.call(document, tagName); }
      var tn = (tagName || '').toUpperCase();
      if (RES[tn]) {
        try { self._interceptResourceEl(el); } catch (e2) {}
      }
      return el;
    };
    G.__audit_res_wrapped = true;
  };

  /**
   * 对单个资源元素挂接 src/href 拦截（放行同源、阻断可疑第三方）。
   * @param {Element} el
   */
  AuditProbe.prototype._interceptResourceEl = function (el) {
    var self = this;
    // 拦截 setAttribute('src'|'href', ...)
    if (typeof el.setAttribute === 'function') {
      var nativeSetAttr = el.setAttribute.bind(el);
      el.setAttribute = function (name, value) {
        if ((name === 'src' || name === 'href') && typeof value === 'string' && value) {
          var action = self._classify(value);
          self.record('resource', value, action);
          if (action === 'blocked') return; // 阻断可疑资源加载
        }
        return nativeSetAttr(name, value);
      };
    }
    // 拦截属性赋值 el.src = ... / el.href = ...
    ['src', 'href'].forEach(function (prop) {
      try {
        var proto = Object.getPrototypeOf(el);
        var desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || !desc.set) return;
        var nativeSet = desc.set;
        Object.defineProperty(el, prop, {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (v) {
            if (typeof v === 'string' && v && (prop === 'src' || prop === 'href')) {
              var action = self._classify(v);
              self.record('resource', v, action);
              if (action === 'blocked') return; // 阻断可疑资源加载
            }
            return nativeSet.call(this, v);
          },
        });
      } catch (e) {}
    });
  };

  /**
   * 分类一个 URL 的处置。
   * @param {string} url
   * @returns {'allowed'|'consented'|'blocked'}
   */
  AuditProbe.prototype._classify = function (url) {
    var u = String(url || '');
    if (!u) return 'allowed'; // 空 URL 视为无外发
    // 非网络 scheme 直接放行
    if (/^(blob|data|about|javascript):/i.test(u)) return 'allowed';
    var origin = resolveOrigin(u);
    // 同源放行（并把 origin 补进 allowlist，便于审计展示）
    if (origin && typeof location !== 'undefined' && location.origin && origin === location.origin) {
      this.allowlist.add(origin);
      return 'allowed';
    }
    // 用户显式同意的端点 → consented
    if (this._isConsented(u, origin)) return 'consented';
    // 其余疑似上报 / 第三方追踪 → 阻断
    return 'blocked';
  };

  /**
   * 判断 URL / origin 是否落在 consentedRegistry。
   * @param {string} url
   * @param {string|null} origin
   * @returns {boolean}
   */
  AuditProbe.prototype._isConsented = function (url, origin) {
    if (!this.consentedRegistry || !this.consentedRegistry.size) return false;
    if (this.consentedRegistry.has(url)) return true;
    if (origin && this.consentedRegistry.has(origin)) return true;
    return false;
  };

  /**
   * 注册用户显式同意的外发端点（host / 完整 URL）。
   * app.js 在对应功能开启时调用（S.cloud base / syncBase / pushBase）。
   * @param {string} pattern 端点 URL 或 host
   */
  AuditProbe.prototype.registerConsented = function (pattern) {
    if (!pattern) return;
    var p = String(pattern).trim();
    if (!p) return;
    if (!this.consentedRegistry) this.consentedRegistry = new Set();
    this.consentedRegistry.add(p);
    var o = resolveOrigin(p);
    if (o) this.consentedRegistry.add(o);
  };

  /**
   * 统一记录一次外发尝试（由各包装器调用）。
   * @param {string} channel 'fetch'|'xhr'|'ws'|'beacon'|'eventsource'|'resource'
   * @param {string} url 目标地址
   * @param {'allowed'|'consented'|'blocked'} action 处置
   */
  AuditProbe.prototype.record = function (channel, url, action) {
    try {
      if (action !== 'allowed' && action !== 'consented' && action !== 'blocked') action = 'allowed';
      this.probeLog.push({
        t: Date.now(),
        channel: channel,
        url: (typeof url === 'string' && url.length > 512) ? url.slice(0, 512) : url,
        action: action,
      });
      if (this.probeLog.length > this._maxLog) this.probeLog = this.probeLog.slice(-this._maxLog);
      if (action === 'blocked') this.blockedCount++;
      else if (action === 'consented') this.consentedCount++;
      else this.allowedCount++;
      this._persist();
    } catch (e) {}
  };

  /**
   * 证明零非授权上报：blocked(疑似上报)==0 即为通过。
   * 先对 voice.js / longterm-memory.js 跑（二者零外部调用，必过），再覆盖全应用。
   * @returns {{zeroReporting:boolean, blocked:number, allowed:number, consented:number, logs:Array}}
   */
  AuditProbe.prototype.proveZeroReporting = function () {
    var blocked = this.blockedCount || 0;
    return {
      zeroReporting: blocked === 0,
      blocked: blocked,
      allowed: this.allowedCount || 0,
      consented: this.consentedCount || 0,
      logs: this.probeLog.slice(-50),
    };
  };

  /**
   * 完整审计报告（供后续隐私面板使用）。
   * @returns {Object}
   */
  AuditProbe.prototype.getReport = function () {
    return {
      blocked: this.blockedCount || 0,
      allowed: this.allowedCount || 0,
      consented: this.consentedCount || 0,
      total: (this.blockedCount || 0) + (this.allowedCount || 0) + (this.consentedCount || 0),
      installed: !!this._installed,
      log: this.probeLog.slice(-200),
      allowlist: this.allowlist ? Array.from(this.allowlist) : [],
      consentedRegistry: this.consentedRegistry ? Array.from(this.consentedRegistry) : [],
    };
  };

  /**
   * 复位计数器与日志（consentedRegistry 一并清空）。
   */
  AuditProbe.prototype.reset = function () {
    this.blockedCount = 0;
    this.allowedCount = 0;
    this.consentedCount = 0;
    this.probeLog = [];
    if (this.consentedRegistry) this.consentedRegistry = new Set();
    this._persist();
  };

  /** 持久化运行计数到 xinyu.audit（容错） */
  AuditProbe.prototype._persist = function () {
    try {
      var data = {
        blocked: this.blockedCount,
        allowed: this.allowedCount,
        consented: this.consentedCount,
        log: this.probeLog.slice(-50),
      };
      safeLsSet(AUDIT_KEY, JSON.stringify(data));
    } catch (e) {}
  };

  /** 从 xinyu.audit 恢复运行计数（容错） */
  AuditProbe.prototype._restore = function () {
    try {
      var raw = safeLsGet(AUDIT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      this.blockedCount = d.blocked | 0;
      this.allowedCount = d.allowed | 0;
      this.consentedCount = d.consented | 0;
      if (Array.isArray(d.log)) this.probeLog = d.log;
    } catch (e) {}
  };

  // 对外门面
  G.AuditProbe = AuditProbe;
  if (typeof module !== 'undefined' && module.exports) module.exports = AuditProbe;
})();
