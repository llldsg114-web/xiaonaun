/**
 * privacy-score.js · 心屿 候选 C（C-E4 · C12）· 本地隐私评分（挂 window.PrivacyScore，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 基于「同意态 / 外发计数 / 存储治理」计算 0-100 本地隐私评分，并给出等级。
 * 评分完全在本地进行，不采集、不共享、不上云。
 * 铁律：不引入任何第三方库；不触碰冻结线。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  /**
   * PrivacyScore —— 本地隐私评分。
   * @constructor
   */
  function PrivacyScore() {}

  /** 单例 */
  PrivacyScore.getInstance = function () {
    if (!PrivacyScore._inst) PrivacyScore._inst = new PrivacyScore();
    return PrivacyScore._inst;
  };

  /**
   * 计算本地隐私评分（0-100，越高越隐私友好）。
   * 口径（设计 §7 共享知识 + C12）：
   *   · 默认零上报=满分基线 100；
   *   · 疑似上报被拦截(blocked)：每次 -15，封顶 -50；
   *   · 已授权外发(consented) 每类 -2，封顶 -10；
   *   · 云同步(唯一显式外发通道 cloudSync)：-25；
   *   · 存储治理：本地存储过大表示治理不足，>50MB -10，>200MB -20。
   * @param {Object} metrics { blocked, consented, cloudSync, storageBytes }
   * @returns {number} 0-100
   */
  PrivacyScore.prototype.compute = function (metrics) {
    metrics = metrics || {};
    var score = 100;
    var blocked = Number(metrics.blocked) || 0;
    var consented = Number(metrics.consented) || 0;

    // 疑似上报（被拦截的第三方）：每次 -15，封顶 -50
    score -= Math.min(blocked * 15, 50);
    // 已授权外发：每类 -2（含云同步外的 consented 端点），封顶 -10
    score -= Math.min(consented * 2, 10);
    // 云同步（唯一显式外发通道）：-25
    if (metrics.cloudSync) score -= 25;
    // 存储治理：本地存储过大表示治理不足
    var total = Number(metrics.storageBytes) || 0;
    if (total > 200 * 1024 * 1024) score -= 20;
    else if (total > 50 * 1024 * 1024) score -= 10;

    if (score < 0) score = 0;
    if (score > 100) score = 100;
    return Math.round(score);
  };

  /**
   * 评分等级。
   * @param {number} score
   * @returns {'优'|'良'|'中'|'待改进'}
   */
  PrivacyScore.prototype.grade = function (score) {
    score = Number(score) || 0;
    if (score >= 90) return '优';
    if (score >= 75) return '良';
    if (score >= 50) return '中';
    return '待改进';
  };

  // 对外门面
  G.PrivacyScore = PrivacyScore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PrivacyScore;
})();
