/**
 * reply-router.js · 心屿 候选 C（隐私/端侧增强）· 本地模型热切换路由（挂 window.ReplyRouter，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * C2（绕开 engine.js）：持有 provider 优先级数组 [cloud → local → heuristic]，
 * 按序尝试；承担弹性降级：8s 超时 / 连续 2 次失败 / 401 立即降级 到下一 provider；
 * 最终兜底为 LocalHeuristic（保证 小暖 永不静默）。
 *
 * 统一 ReplyProvider 契约（§7.3）：
 *   generate(prompt, ctx) -> Promise<string>
 *   isAvailable()         -> boolean
 * 实现者：
 *   - CloudChatProvider  包装 app.js 的 S.cloud fetch（由 app.js 注入 generate 实现，保留 mindCtx / 鉴权头 / 错误处理；8s 超时真正生效）
 *   - LocalModelAdapter  包装既有 window.LocalModel（仅当 LocalModel.isLoaded() 时 isAvailable()=true；默认未加载 → 跳过 → 落到 heuristic）
 *   - LocalHeuristic     原生启发式（定义在 local-heuristic.js，零外部依赖）
 *
 * 降级判定（路由层维护，不写入 engine.js）：
 *   - 8s 超时：CloudChatProvider 内部用 AbortController 真正中断 fetch，reject 带 __timeout，路由立即降级；
 *   - 连续 2 次失败：跨 route() 调用持久计数（_fails），达阈值即跳过该 provider（降级到下一）；
 *   - 401 立即降级：reject 带 httpStatus=401，路由标记该 provider 为「鉴权致死」并永久跳过，落下一 provider。
 *
 * 铁律：不引入任何第三方库；不触碰冻结线 engine.js；不改写 B 逻辑；小暖 不更名。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  /** 构造带元信息的错误，便于路由层判定 401 / 超时。 */
  function mkErr(msg, httpStatus, kind) {
    var e = new Error(msg);
    if (httpStatus != null) e.httpStatus = httpStatus;
    if (kind) e.__kind = kind;
    return e;
  }

  /** 把 provider 抛出的错误规范化为路由可识别的 {httpStatus, __timeout}。 */
  function normalizeErr(err, ctrl) {
    if (!err) return mkErr('unknown error', null, null);
    var out = err;
    if (!(out instanceof Error)) out = mkErr(String(out), null, null);
    // 401：从消息 "HTTP 401" 提取，或沿用既有 httpStatus
    if (out.httpStatus == null) {
      var m = (typeof out.message === 'string') ? /^HTTP\s+(\d+)/i.exec(out.message) : null;
      if (m) out.httpStatus = Number(m[1]);
    }
    // 超时：AbortController 中断，或显式 __timeout
    if (out.__timeout == null) {
      if (ctrl && out.name === 'AbortError') out.__timeout = true;
      if (err && err.__timeout) out.__timeout = true;
    }
    return out;
  }

  /* ===================== CloudChatProvider ===================== */
  /**
   * 包装 app.js 的 S.cloud fetch。app.js 在构造时注入 generate 实现（即既有 callCloud），
   * 本类负责：8s 超时真正生效（AbortController + race）、401 / 超时识别、错误归一化。
   * @param {Object} opts { generate, timeoutMs }
   * @constructor
   */
  function CloudChatProvider(opts) {
    opts = opts || {};
    this.name = 'cloud';
    this._impl = (typeof opts.generate === 'function') ? opts.generate : null; // app.js 注入：callCloud
    this.timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 8000; // PRD Q1：8s 超时
    this._available = false; // 由 app.js 依据 S.cloud.enabled && base && key 设置
  }
  CloudChatProvider.prototype.setAvailable = function (v) { this._available = !!v; };
  CloudChatProvider.prototype.isAvailable = function () {
    return this._available && typeof this._impl === 'function';
  };
  /**
   * 真正发起云端补全；8s 超时经 AbortController 中断底层 fetch。
   * app.js 的 callCloud 支持接收 { signal }（兼容第三参）以承接本中断信号。
   * @param {string} prompt
   * @param {Object} ctx 透传给 callCloud（含 ltmFragment 等）
   * @returns {Promise<string>}
   */
  CloudChatProvider.prototype.generate = function (prompt, ctx) {
    if (typeof this._impl !== 'function') return Promise.reject(mkErr('CloudChatProvider 未配置 generate 实现', null, null));
    var self = this;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var signal = ctrl ? ctrl.signal : null;
    var ctx2 = {};
    if (ctx && typeof ctx === 'object') { for (var k in ctx) { if (Object.prototype.hasOwnProperty.call(ctx, k)) ctx2[k] = ctx[k]; } }
    if (signal) ctx2.signal = signal;
    var timer = (typeof setTimeout !== 'undefined')
      ? setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, this.timeoutMs)
      : null;
    return Promise.resolve()
      .then(function () { return self._impl(prompt, ctx2); })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        // 兼容 app.js 既有 {replies,delta,expression} 结构 与 纯字符串
        if (res && typeof res === 'object') {
          if (Array.isArray(res.replies) && res.replies.length && typeof res.replies[0] === 'string' && res.replies[0].trim())
            return res.replies[0];
          if (typeof res.text === 'string' && res.text.trim()) return res.text;
          return Promise.reject(mkErr('云端返回空', null, null));
        }
        if (typeof res === 'string' && res.trim()) return res;
        return Promise.reject(mkErr('云端返回空', null, null));
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw normalizeErr(err, ctrl);
      });
  };

  /* ===================== LocalModelAdapter ===================== */
  /**
   * 包装既有 window.LocalModel（端侧推理）。仅当 LocalModel.isLoaded() 时 isAvailable()=true；
   * 默认未加载 → false → 路由跳过 → 落到 LocalHeuristic（满足「默认不触发外部下载」「小暖 永不静默」）。
   * @param {Object} opts { generate, localModel }
   * @constructor
   */
  function LocalModelAdapter(opts) {
    opts = opts || {};
    this.name = 'local';
    this._impl = (typeof opts.generate === 'function') ? opts.generate : null; // app.js 注入：localThink
    this._lm = opts.localModel || (G && G.LocalModel) || null; // 复用既有 localmodel.js 作 adapter 基座
  }
  LocalModelAdapter.prototype.setLocalModel = function (lm) { this._lm = lm || (G && G.LocalModel) || null; };
  LocalModelAdapter.prototype.setGenerate = function (fn) { if (typeof fn === 'function') this._impl = fn; };
  /** 仅在 LocalModel 已 loaded 时可用（默认 false）。 */
  LocalModelAdapter.prototype.isAvailable = function () {
    return !!(this._lm && typeof this._lm.isLoaded === 'function' && this._lm.isLoaded());
  };
  /** 触发权重加载（transformers 路径）：须经用户显式同意（由 app.js 的 loadLocalModelWithConsent 门控），本方法仅透传。 */
  LocalModelAdapter.prototype.ensureLoaded = function () {
    if (this._lm && typeof this._lm.load === 'function') return this._lm.load();
    return Promise.reject(mkErr('LocalModel 不可用', null, null));
  };
  /**
   * 端侧推理；未加载或返回空 → reject（回落路由下一 provider）。
   * @param {string} prompt
   * @param {Object} ctx 透传给 localThink（含 ltmFragment 等）
   * @returns {Promise<string>}
   */
  LocalModelAdapter.prototype.generate = function (prompt, ctx) {
    if (!this.isAvailable()) return Promise.reject(mkErr('LocalModel 未加载（默认不触发外部下载）', null, null));
    if (typeof this._impl !== 'function') return Promise.reject(mkErr('LocalModelAdapter 未配置 generate 实现', null, null));
    var ctx2 = {};
    if (ctx && typeof ctx === 'object') { for (var k in ctx) { if (Object.prototype.hasOwnProperty.call(ctx, k)) ctx2[k] = ctx[k]; } }
    return Promise.resolve(this._impl(prompt, ctx2)).then(function (res) {
      if (res && typeof res === 'object') {
        if (Array.isArray(res.replies) && res.replies.length && typeof res.replies[0] === 'string' && res.replies[0].trim())
          return res.replies[0];
        if (typeof res.text === 'string' && res.text.trim()) return res.text;
        return Promise.reject(mkErr('LocalModel 返回空', null, null));
      }
      if (typeof res === 'string' && res.trim()) return res;
      return Promise.reject(mkErr('LocalModel 返回空', null, null));
    });
  };

  /* ===================== ReplyRouter ===================== */
  /**
   * 本地模型热切换路由：持有 provider 优先级数组，按序尝试并弹性降级。
   * @param {Object} [opts] { timeoutMs }
   * @constructor
   */
  function ReplyRouter(opts) {
    opts = opts || {};
    this.providers = [];
    this._degradeCbs = [];
    this._fails = new Map();     // provider -> 连续失败计数（跨 route() 持久）
    this._authDead = new Map();  // provider -> 401 致死（永久跳过）
    this._timeoutMs = (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) ? opts.timeoutMs : 8000;
    this.lastVia = null;         // 最近一次成功 provider 名（观测用）
    this.lastDegrade = null;     // 最近一次降级事件
  }

  /** 单例（C-E5 测试与 app.js 共用，可选） */
  ReplyRouter.getInstance = function () {
    if (!ReplyRouter._inst) ReplyRouter._inst = new ReplyRouter();
    return ReplyRouter._inst;
  };

  /** 注册优先级 provider 列表（cloud → local → heuristic）；列表变更即复位计数。 */
  ReplyRouter.prototype.registerProviders = function (list) {
    this.providers = Array.isArray(list) ? list.slice() : [];
    this._fails = new Map();
    this._authDead = new Map();
    this.lastVia = null;
    this.lastDegrade = null;
    return this;
  };

  /** 订阅降级事件：onDegrade(({from, to, reason}) => {}) */
  ReplyRouter.prototype.onDegrade = function (cb) {
    if (typeof cb === 'function') this._degradeCbs.push(cb);
    return this;
  };

  ReplyRouter.prototype._notifyDegrade = function (fromP, toP, reason) {
    var ev = {
      from: fromP ? (fromP.name || fromP) : null,
      to: toP ? (toP.name || toP) : null,
      reason: reason,
      t: (typeof Date !== 'undefined') ? Date.now() : 0,
    };
    this.lastDegrade = ev;
    for (var i = 0; i < this._degradeCbs.length; i++) {
      try { this._degradeCbs[i](ev); } catch (e) {}
    }
  };

  /**
   * 按优先级路由，返回首个可用 provider 的非空回复字符串。
   * 降级判定：8s 超时 / 连续 2 次失败 / 401 立即降级 到下一 provider；
   * 最终兜底 LocalHeuristic 永远可用，保证 小暖 永不静默。
   * @param {string} prompt
   * @param {Object} [ctx]
   * @returns {Promise<string>}
   */
  ReplyRouter.prototype.route = function (prompt, ctx) {
    var self = this;
    var ctxObj = (ctx && typeof ctx === 'object') ? ctx : {};
    var lastErr = null;
    // 同步遍历（provider 内部已各自管控异步）；用 Promise 链保证顺序尝试
    function step(i) {
      if (i >= self.providers.length) {
        return Promise.reject(lastErr || mkErr('ReplyRouter：所有 provider 均不可用', null, null));
      }
      var p = self.providers[i];
      if (!p || typeof p.isAvailable !== 'function' || !p.isAvailable()) {
        return step(i + 1); // 不可用（含 LocalModel 未加载）→ 直接跳下一
      }
      // 401 致死 → 永久跳过
      if (self._authDead.get(p)) {
        self._notifyDegrade(p, self.providers[i + 1], '401-dead');
        return step(i + 1);
      }
      // 连续 2 次失败已达阈值 → 本次跳过（已降级到后续 provider）
      if ((self._fails.get(p) || 0) >= 2) {
        self._notifyDegrade(p, self.providers[i + 1], 'consecutive_failures');
        return step(i + 1);
      }
      return Promise.resolve()
        .then(function () { return p.generate(prompt, ctxObj); })
        .then(function (text) {
          if (typeof text === 'string' && text.trim()) {
            self._fails.set(p, 0);            // 成功复位连续失败计数
            self.lastVia = (p.name || ('p' + i));
            return text;
          }
          // 空回复视为一次失败
          var fc2 = (self._fails.get(p) || 0) + 1;
          self._fails.set(p, fc2);
          lastErr = mkErr('provider 返回空回复', null, null);
          if (fc2 >= 2) self._notifyDegrade(p, self.providers[i + 1], 'consecutive_failures');
          return step(i + 1);
        }, function (err) {
          lastErr = err;
          var status = (err && (err.httpStatus != null ? err.httpStatus : err.status)) || null;
          if (status === 401) {
            self._authDead.set(p, true);      // 401 立即降级且致死
            self._fails.set(p, 0);
            self._notifyDegrade(p, self.providers[i + 1], '401');
            return step(i + 1);
          }
          var isTimeout = !!(err && err.__timeout);
          var fc = (self._fails.get(p) || 0) + 1;
          self._fails.set(p, fc);
          if (isTimeout) {
            self._notifyDegrade(p, self.providers[i + 1], 'timeout'); // 8s 超时立即降级
          } else if (fc >= 2) {
            self._notifyDegrade(p, self.providers[i + 1], 'consecutive_failures'); // 连续 2 次失败降级
          }
          return step(i + 1);
        });
    }
    return step(0);
  };

  // 对外门面
  G.ReplyRouter = ReplyRouter;
  G.CloudChatProvider = CloudChatProvider;
  G.LocalModelAdapter = LocalModelAdapter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReplyRouter: ReplyRouter, CloudChatProvider: CloudChatProvider, LocalModelAdapter: LocalModelAdapter };
  }
})();
