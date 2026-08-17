/**
 * cache-warmer.js · 心屿 候选 C（隐私/端侧增强）· 独立 Cache 预热（挂 window.CacheWarmer，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 使用独立 Cache 命名空间 xinyu-edge-v1 预热关键同源静态资源（JS/CSS/图标/字体），
 * 提供离线就绪度（%）。绕开冻结的 sw.js（v14, key=19）：
 *   - 绝不读写 sw 的缓存键（key=19）；
 *   - 仅操作独立的 'xinyu-edge-v1' 命名空间。
 * 铁律：不引入任何第三方库；不触碰冻结线。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  // 独立 Cache 命名空间：严禁与 sw.js 的 key=19 冲突
  var CACHE_NAME = 'xinyu-edge-v1';

  // 关键同源静态资源清单（相对当前文档解析为绝对 URL）
  var CRITICAL_REL = [
    'index.html',
    'style.css',
    'manifest.json',
    'engine.js',
    'memory.js',
    'presence.js',
    'texture.js',
    'contingency.js',
    'localmodel.js',
    'caption.js',
    'longterm-memory.js',
    'ltm-ui.js',
    'voice.js',
    'app.js',
    'consent-store.js',
    'audit-probe.js',
    'offline-probe.js',
    'cache-warmer.js',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
  ];

  /** 是否支持 Cache API */
  function hasCaches() {
    try { return (typeof G.caches !== 'undefined') && !!G.caches && typeof G.caches.open === 'function'; } catch (e) { return false; }
  }

  /**
   * 构建关键资源绝对 URL 列表。
   * @returns {Array<string>}
   */
  function buildCriticalList() {
    var base = (typeof location !== 'undefined' && location.href) ? location.href : 'http://localhost/';
    return CRITICAL_REL.map(function (r) {
      try { return new URL(r, base).href; } catch (e) { return r; }
    });
  }

  /**
   * CacheWarmer —— 独立 Cache 预热。
   * @constructor
   */
  function CacheWarmer() {
    this.cacheName = CACHE_NAME;
    this._readiness = 0; // 0~100
  }

  /** 单例（A/B/C 与测试共用） */
  CacheWarmer.getInstance = function () {
    if (!CacheWarmer._inst) CacheWarmer._inst = new CacheWarmer();
    return CacheWarmer._inst;
  };

  /**
   * 预热给定资源列表（同源静态资源）。逐个 fetch 并写入独立 Cache。
   * @param {Array<string|{url:string}>} list
   * @returns {Promise<number>} 预热后的就绪度 %
   */
  CacheWarmer.prototype.warm = function (list) {
    var self = this;
    if (!hasCaches()) return Promise.resolve(0);
    var urls = (list || []).map(function (x) {
      return (typeof x === 'string') ? x : (x && x.url);
    }).filter(Boolean);
    if (!urls.length) return self.getReadiness();

    return G.caches.open(self.cacheName).then(function (cache) {
      return Promise.all(urls.map(function (u) {
        try {
          return G.fetch(u, { cache: 'no-store' }).then(function (res) {
            if (res && res.ok) { try { return cache.put(u, res.clone()); } catch (e2) {} }
          }).catch(function () { /* 单资源失败不阻断其它 */ });
        } catch (e) { return Promise.resolve(); }
      }));
    }).then(function () {
      return self.getReadiness();
    }).catch(function () {
      return 0;
    });
  };

  /**
   * 预热关键同源静态资源（JS/CSS/图标/字体）。
   * @returns {Promise<number>} 就绪度 %
   */
  CacheWarmer.prototype.preloadCritical = function () {
    return this.warm(buildCriticalList());
  };

  /**
   * 报告离线就绪度（已缓存关键资源数 / 关键资源总数）。
   * @returns {Promise<number>} 0~100
   */
  CacheWarmer.prototype.getReadiness = function () {
    var self = this;
    if (!hasCaches()) { this._readiness = 0; return Promise.resolve(0); }
    return G.caches.open(self.cacheName).then(function (cache) {
      return cache.keys();
    }).then(function (keys) {
      var total = CRITICAL_REL.length;
      var pct = total > 0 ? Math.min(100, Math.round((keys.length / total) * 100)) : 0;
      self._readiness = pct;
      return pct;
    }).catch(function () {
      self._readiness = 0;
      return 0;
    });
  };

  // 对外门面
  G.CacheWarmer = CacheWarmer;
  if (typeof module !== 'undefined' && module.exports) module.exports = CacheWarmer;
})();
