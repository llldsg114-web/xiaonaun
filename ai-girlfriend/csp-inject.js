/**
 * csp-inject.js · 心屿 候选 C（C-E4 · C6）· CSP Report-Only 注入（挂 window.CspInjector，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 注入 Content-Security-Policy-Report-Only 的 <meta>，并以 document 的
 * securitypolicyviolation 事件在**本地**捕获违规——绝不设置 report-uri，绝不外发。
 * 违规仅写入本地审计日志（CspInjector._violations），并可选本地登记到 AuditProbe，
 * 不影响「零上报证明」的 blocked 计数（report-only 不拦截任何实际外发）。
 * 铁律：不引入任何第三方库；不触碰冻结线；绝不上云。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  var META_ID = 'xn-csp-report-only';

  // 仅本地策略：同源 + blob/data（本地推理/资源），不含任何外部 report-uri。
  var POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  /**
   * CspInjector —— CSP Report-Only 注入与本地捕获。
   * @constructor
   */
  function CspInjector() {
    this._installed = false;
    this._violations = [];
  }

  /** 单例 */
  CspInjector.getInstance = function () {
    if (!CspInjector._inst) CspInjector._inst = new CspInjector();
    return CspInjector._inst;
  };

  /**
   * 注入 CSP report-only meta（幂等）。违规仅靠本地 securitypolicyviolation 事件捕获，
   * 绝不连接外部 report-uri（铁律：零上报）。
   * @returns {CspInjector}
   */
  CspInjector.prototype.injectReportOnly = function () {
    try {
      if (this._installed) return this;
      if (typeof document === 'undefined' || !document.head) return this;
      var existing = document.getElementById(META_ID);
      if (!existing) {
        var meta = document.createElement('meta');
        meta.id = META_ID;
        meta.setAttribute('http-equiv', 'Content-Security-Policy-Report-Only');
        meta.content = POLICY;
        document.head.appendChild(meta);
      }
      this._installed = true;
      this._bind();
    } catch (e) {}
    return this;
  };

  /** 绑定 securitypolicyviolation 事件（仅一次）。 */
  CspInjector.prototype._bind = function () {
    try {
      if (typeof document === 'undefined' || document.__xn_csp_bound) return;
      var self = this;
      document.addEventListener('securitypolicyviolation', function (e) {
        try { self.handleReport(e); } catch (err) {}
      });
      document.__xn_csp_bound = true;
    } catch (e) {}
  };

  /**
   * 本地处理一次违规事件：写入本地审计日志，绝不外发。
   * 注：report-only 仅报告不拦截，此类事件不属于「外发」，
   * 故只存于本地 _violations（即本设计允许的「本地审计日志」替代方案），
   * 不写入 AuditProbe 的 blocked/allowed 计数，以保护零上报证明(blocked==0)语义。
   * @param {SecurityPolicyViolationEvent} e
   */
  CspInjector.prototype.handleReport = function (e) {
    try {
      var info = {
        t: Date.now(),
        blockedURI: (e && e.blockedURI) || '',
        violatedDirective: (e && e.violatedDirective) || '',
        originalPolicy: (e && e.originalPolicy) || '',
        sourceFile: (e && e.sourceFile) || '',
        lineNumber: (e && e.lineNumber) || 0,
        columnNumber: (e && e.columnNumber) || 0,
      };
      this._violations.push(info);
    } catch (err) {}
  };

  /** 返回已捕获的违规（本地日志副本）。 */
  CspInjector.prototype.getViolations = function () {
    return this._violations.slice();
  };

  // 对外门面
  G.CspInjector = CspInjector;
  if (typeof module !== 'undefined' && module.exports) module.exports = CspInjector;
})();
