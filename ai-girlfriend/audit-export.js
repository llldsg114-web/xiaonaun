/**
 * audit-export.js · 心屿 候选 C（C-E4 · C10）· 审计日志导出（挂 window.AuditExporter，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 审计日志导出能力：
 *   · exportJSON(report)        → 未加密 JSON Blob（默认）
 *   · deriveKey(passphrase, salt) → Web Crypto PBKDF2(SHA-256) 派生 AES-GCM 密钥（extractable:false，密钥不落地）
 *   · exportEncrypted(report, key[, opts]) → AES-GCM 加密 Blob（二进制 = salt|iv|ciphertext，自包含）
 * 全程本地，绝不外发、绝不连接任何服务器。
 * 风格与 A 的 longterm-memory.js 加密（Web Crypto）保持一致：无外部依赖、密钥不落盘。
 * 铁律：不引入任何第三方库；不触碰冻结线。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  /** 安全获取 Web Crypto（浏览器 / Node shim 兼容） */
  function getCrypto() {
    try {
      if (typeof G.crypto !== 'undefined' && G.crypto && G.crypto.subtle) return G.crypto;
      if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    } catch (e) {}
    return null;
  }

  /**
   * AuditExporter —— 审计导出（JSON / AES-GCM）。
   * @constructor
   */
  function AuditExporter() {}

  /** 单例 */
  AuditExporter.getInstance = function () {
    if (!AuditExporter._inst) AuditExporter._inst = new AuditExporter();
    return AuditExporter._inst;
  };

  /**
   * 导出未加密 JSON Blob。
   * @param {Object} report
   * @returns {Blob}
   */
  AuditExporter.prototype.exportJSON = function (report) {
    var json = JSON.stringify(report, null, 2);
    return new Blob([json], { type: 'application/json' });
  };

  /**
   * 从口令派生 AES-GCM 密钥（PBKDF2 SHA-256，extractable:false → 密钥绝不导出/落盘）。
   * @param {string} passphrase
   * @param {Uint8Array} salt 16 字节随机盐
   * @returns {Promise<CryptoKey>}
   */
  AuditExporter.prototype.deriveKey = function (passphrase, salt) {
    var c = getCrypto();
    if (!c) return Promise.reject(new Error('Web Crypto 不可用'));
    var enc = new TextEncoder();
    var passBytes = enc.encode(String(passphrase == null ? '' : passphrase));
    return c.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveKey']).then(function (keyMaterial) {
      return c.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false, // extractable: false —— 密钥不落地
        ['encrypt']
      );
    });
  };

  /**
   * AES-GCM 加密导出：二进制 Blob = salt(16) | iv(12) | ciphertext（自包含，解密时从文件读回 salt/iv）。
   * 密钥不落地（deriveKey 已 extractable:false）。
   * @param {Object} report
   * @param {CryptoKey} key 由 deriveKey 派生的 AES-GCM 密钥
   * @param {Object} [opts] { salt?: Uint8Array } 用于把盐嵌入文件（默认随机生成）
   * @returns {Promise<Blob>}
   */
  AuditExporter.prototype.exportEncrypted = function (report, key, opts) {
    opts = opts || {};
    var c = getCrypto();
    if (!c) return Promise.reject(new Error('Web Crypto 不可用'));
    var enc = new TextEncoder();
    var data = enc.encode(JSON.stringify(report, null, 2));
    var iv = c.getRandomValues(new Uint8Array(12));
    var salt = (opts.salt && opts.salt instanceof Uint8Array) ? opts.salt : c.getRandomValues(new Uint8Array(16));
    return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ctBuf) {
      var ct = new Uint8Array(ctBuf);
      var out = new Uint8Array(salt.length + iv.length + ct.length);
      out.set(salt, 0);
      out.set(iv, salt.length);
      out.set(ct, salt.length + iv.length);
      return new Blob([out], { type: 'application/octet-stream' });
    });
  };

  /** 生成随机盐（供调用方派生密钥并随导出嵌入）。 */
  AuditExporter.prototype.randomSalt = function (len) {
    var c = getCrypto();
    var n = (typeof len === 'number' && len > 0) ? len : 16;
    if (!c) {
      var a = new Uint8Array(n);
      for (var i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
      return a;
    }
    return c.getRandomValues(new Uint8Array(n));
  };

  // 对外门面
  G.AuditExporter = AuditExporter;
  if (typeof module !== 'undefined' && module.exports) module.exports = AuditExporter;
})();
