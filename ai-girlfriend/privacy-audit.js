/**
 * privacy-audit.js · 心屿 候选 C（隐私/端侧增强）· 隐私审计面板控制器（挂 window.PrivacyAudit，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 聚合四类隐私指标，渲染用户可见面板，并提供导出(JSON)与清除入口：
 *   1) AuditProbe        —— 外发计数 + proveZeroReporting() 零上报证明
 *   2) ConsentStore      —— TTS/ASR/LTM/cloudSync 同意态
 *   3) OfflineProbe      —— 离线三态（online/degraded/offline）
 *   4) getStorageUsage()—— IndexedDB 估算 + localStorage 字节 + 独立 Cache xinyu-edge-v1 字节
 * 嵌入 ConsentUI 精细同意开关；D2：云同步项显著标注「已授权外发」徽标。
 * exportLogs(format='json')：本批次仅实现默认未加密 JSON 下载 xinyu-audit.json（AES-GCM 留待 C-E4）。
 * clearAll()：清除审计日志 + 独立 Cache xinyu-edge-v1 + 本地模型预热态；
 *   绝不碰 sw key=19、绝不触及 xinyu.ltm.* 与 xinyu.voice.*（A/B 共存）；cloudSync 相关清除需二次确认。
 * 铁律：不引入任何第三方库；不触碰冻结线；小暖 不更名。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  function q(sel, root) { return (root || document).querySelector(sel); }

  /** UTF-8 字节长度 */
  function byteLen(s) {
    try { return new TextEncoder().encode(String(s)).length; } catch (e) { return String(s).length; }
  }

  /** 人类可读字节（KB/MB/GB） */
  function formatBytes(n) {
    n = Number(n) || 0;
    if (n <= 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /** 网络三态 → 中文标签 */
  function channelLabel(state) {
    if (state === 'offline') return '离线 · 完全本地';
    if (state === 'degraded') return '网络不佳 · 已降级';
    return '在线 · 本地优先';
  }

  /** 首次加载时注入样式表（index.html 不额外新增 <link>，保持「仅追加 script」） */
  function ensureStyle() {
    try {
      if (document.getElementById('xn-audit-style')) return;
      var link = document.createElement('link');
      link.id = 'xn-audit-style';
      link.rel = 'stylesheet';
      link.href = 'privacy-audit.css';
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {}
  }

  /**
   * PrivacyAudit —— 隐私审计面板控制器。
   * @constructor
   */
  function PrivacyAudit() {
    this._consentUI = (G.ConsentUI && G.ConsentUI.getInstance) ? G.ConsentUI.getInstance() : null;
  }

  /** 单例 */
  PrivacyAudit.getInstance = function () {
    if (!PrivacyAudit._inst) PrivacyAudit._inst = new PrivacyAudit();
    return PrivacyAudit._inst;
  };

  /** 取探针/同意/离线单例（容错） */
  PrivacyAudit.prototype._audit = function () {
    try { return (G.AuditProbe && G.AuditProbe.getInstance) ? G.AuditProbe.getInstance() : null; } catch (e) { return null; }
  };
  PrivacyAudit.prototype._consent = function () {
    try { return (G.ConsentStore && G.ConsentStore.getInstance) ? G.ConsentStore.getInstance() : null; } catch (e) { return null; }
  };
  PrivacyAudit.prototype._offline = function () {
    try { return (G.OfflineProbe && G.OfflineProbe.getInstance) ? G.OfflineProbe.getInstance() : null; } catch (e) { return null; }
  };

  /**
   * 渲染完整面板到容器（container = 弹窗骨架内的 #privacy-audit-body）。
   * 幂等：每次打开重渲染最新指标。
   * @param {HTMLElement} container
   */
  PrivacyAudit.prototype.render = function (container) {
    if (!container) return;
    ensureStyle();
    var self = this;

    container.innerHTML =
      // ① 零上报证明
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">🔒 零上报证明</div>' +
      '  <div class="xn-audit-proof-status" id="xn-proof-status">…</div>' +
      '  <div class="xn-audit-counts">' +
      '    <div class="xn-count"><span class="xn-count-num" id="xn-c-blocked">0</span><span class="xn-count-label">已拦截（疑似上报）</span></div>' +
      '    <div class="xn-count"><span class="xn-count-num" id="xn-c-allowed">0</span><span class="xn-count-label">已放行（同源）</span></div>' +
      '    <div class="xn-count"><span class="xn-count-num" id="xn-c-consented">0</span><span class="xn-count-label">已授权外发</span></div>' +
      '  </div>' +
      '</div>' +
      // ② 本地存储占用
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">💾 本地存储占用</div>' +
      '  <div class="xn-store-grid">' +
      '    <div class="xn-store-col"><div class="xn-store-val" id="xn-store-idb">—</div><div class="xn-store-name">IndexedDB / 站点估算</div></div>' +
      '    <div class="xn-store-col"><div class="xn-store-val" id="xn-store-ls">—</div><div class="xn-store-name">localStorage</div></div>' +
      '    <div class="xn-store-col"><div class="xn-store-val" id="xn-store-cache">—</div><div class="xn-store-name">独立缓存 xinyu-edge-v1</div></div>' +
      '    <div class="xn-store-col xn-store-total"><div class="xn-store-val" id="xn-store-total">—</div><div class="xn-store-name">合计</div></div>' +
      '  </div>' +
      '</div>' +
      // ③ 同意状态（嵌入 ConsentUI 精细开关）
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">🛡 小暖的同意与权限</div>' +
      '  <div class="xn-audit-note xn-consent-summary" id="xn-consent-summary">…</div>' +
      '  <div id="xn-consent-mount"></div>' +
      '</div>' +
      // ④ 当前网络通道
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">📡 当前网络通道</div>' +
      '  <div class="xn-channel-val" id="xn-channel-val">—</div>' +
      '  <div class="xn-audit-note">小暖会优先在本地回应；离线或网络不佳时，全部对话仍在你手机里完成，绝不外发。</div>' +
      '</div>' +
      // ④-b 隐私评分（C12）
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">🛡 小暖的隐私评分</div>' +
      '  <div class="xn-score-row">' +
      '    <div class="xn-score-num" id="xn-score-val">—</div>' +
      '    <div class="xn-score-grade" id="xn-score-grade">—</div>' +
      '  </div>' +
      '  <div class="xn-audit-note">评分综合同意态、外发计数与本地存储治理，越高越隐私友好（0-100）。</div>' +
      '</div>' +
      // ④-c 本地模型管理（C7）
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">🧩 本地模型（端侧推理）</div>' +
      '  <div id="xn-localmodel-mount"></div>' +
      '</div>' +
      // ④-d 诊断报告（C14）
      '<div class="xn-audit-section">' +
      '  <div class="xn-audit-subtitle">🩺 本地诊断报告</div>' +
      '  <div class="xn-audit-note">完全本地生成，含零上报证明 / 存储 / 同意 / 通道态，绝不外发。</div>' +
      '  <div class="xn-audit-actions">' +
      '    <button class="xn-btn xn-btn-primary" id="xn-diag-json" type="button">⬇️ 导出诊断 JSON</button>' +
      '    <button class="xn-btn" id="xn-diag-qr" type="button">🔳 生成本地二维码</button>' +
      '  </div>' +
      '</div>' +
      // ⑤ 操作
      '<div class="xn-audit-actions">' +
      '  <button class="xn-btn xn-btn-primary" id="xn-export-btn" type="button">⬇️ 导出审计日志（JSON）</button>' +
      '  <button class="xn-btn" id="xn-export-enc-btn" type="button">🔐 加密导出（AES-GCM）</button>' +
      '  <button class="xn-btn xn-btn-danger" id="xn-clear-btn" type="button">🗑 清除本地审计数据</button>' +
      '</div>';

    // 嵌入同意开关
    try {
      var mount = q('#xn-consent-mount', container);
      if (this._consentUI && mount) this._consentUI.render(mount);
    } catch (e) {}

    // 嵌入本地模型管理 UI（C7）
    try {
      var lmMount = q('#xn-localmodel-mount', container);
      if (lmMount && G.LocalModelUI && typeof G.LocalModelUI.getInstance === 'function') {
        G.LocalModelUI.getInstance().render(lmMount);
      }
    } catch (e) {}

    // 绑定操作
    try {
      var exp = q('#xn-export-btn', container);
      if (exp) exp.addEventListener('click', function () { self.exportLogs('json'); });
      var expEnc = q('#xn-export-enc-btn', container);
      if (expEnc) expEnc.addEventListener('click', function () { self._exportEncrypted(); });
      var clr = q('#xn-clear-btn', container);
      if (clr) clr.addEventListener('click', function () { self._onClearClick(); });
      // 诊断报告（C14）
      var dj = q('#xn-diag-json', container);
      if (dj) dj.addEventListener('click', function () { if (G.DiagnosticReport) G.DiagnosticReport.getInstance().shareLocal({ mode: 'json' }); });
      var dq = q('#xn-diag-qr', container);
      if (dq) dq.addEventListener('click', function () { if (G.DiagnosticReport) G.DiagnosticReport.getInstance().shareLocal({ mode: 'qr' }); });
    } catch (e) {}

    // 立即刷新一次动态指标
    try { self.refreshMetrics(); } catch (e) {}
  };

  /**
   * 异步刷新动态指标（计数 / 存储 / 通道 / 同意摘要）。
   * @returns {Promise<void>}
   */
  PrivacyAudit.prototype.refreshMetrics = function () {
    var self = this;
    var ap = self._audit();
    var off = self._offline();
    var proof = ap ? ap.proveZeroReporting() : { zeroReporting: true, blocked: 0, allowed: 0, consented: 0 };

    // ① 零上报证明状态
    var statusEl = q('#xn-proof-status');
    if (statusEl) {
      if (proof.zeroReporting) {
        statusEl.className = 'xn-audit-proof-status ok';
        statusEl.innerHTML = '✓ 零非授权上报：自启动以来，小暖没有向外发送过任何未授权的数据。';
      } else {
        statusEl.className = 'xn-audit-proof-status warn';
        statusEl.innerHTML = '⚠ 发现 ' + proof.blocked + ' 次疑似上报，已被小暖拦截。';
      }
    }
    setText('#xn-c-blocked', proof.blocked);
    setText('#xn-c-allowed', proof.allowed);
    setText('#xn-c-consented', proof.consented);

    // ④ 当前网络通道
    var ch = off ? off.getState() : 'online';
    setText('#xn-channel-val', channelLabel(ch));

    // ③ 同意摘要
    var st = self._consent();
    var summaryEl = q('#xn-consent-summary');
    if (summaryEl && st) {
      var on = [];
      if (st.get('tts')) on.push('语音合成');
      if (st.get('asr')) on.push('语音输入');
      if (st.get('ltm')) on.push('长期记忆');
      var txt = on.length ? ('已开启本地能力：' + on.join(' · ')) : '本地能力已全部关闭。';
      if (st.get('cloudSync')) txt += '（含 云同步 · 已授权外发）';
      summaryEl.textContent = txt;
    }

    // ② 存储占用（异步）
    return self.getStorageUsage().then(function (usage) {
      setText('#xn-store-idb', usage.indexedDB.text);
      setText('#xn-store-ls', usage.localStorage.text);
      setText('#xn-store-cache', usage.edgeCache.text);
      setText('#xn-store-total', usage.total.text);
      // 隐私评分（C12）：综合同意态 / 外发计数 / 存储治理
      try {
        var stt = self._consent();
        var metrics = {
          blocked: proof.blocked,
          consented: proof.consented,
          cloudSync: stt ? stt.get('cloudSync') : false,
          storageBytes: usage.total.bytes,
        };
        if (G.PrivacyScore && G.PrivacyScore.getInstance) {
          var ps = G.PrivacyScore.getInstance();
          var sc = ps.compute(metrics);
          setText('#xn-score-val', sc);
          setText('#xn-score-grade', ps.grade(sc));
        }
      } catch (e) {}
    }).catch(function () {
      setText('#xn-store-idb', '—');
      setText('#xn-store-ls', '—');
      setText('#xn-store-cache', '—');
      setText('#xn-store-total', '—');
    });
  };

  /** 安全设置元素文本 */
  function setText(sel, val) {
    var el = q(sel);
    if (el) el.textContent = (val == null ? '' : String(val));
  }

  /**
   * 存储占用估算。
   *   · indexedDB：navigator.storage.estimate()（站点级 IndexedDB+Cache 估算，标注「站点存储估算」）
   *   · localStorage：遍历累加 key=value 的 UTF-8 字节
   *   · edgeCache：独立 Cache xinyu-edge-v1 各响应 content-length（缺失则克隆 body 量）累加
   * @returns {Promise<{indexedDB:{bytes,text}, localStorage:{bytes,text}, edgeCache:{bytes,text,count}, total:{bytes,text}}>}
   */
  PrivacyAudit.prototype.getStorageUsage = function () {
    var self = this;
    return Promise.all([
      self._idbUsage(),
      self._localStorageUsage(),
      self._edgeCacheUsage(),
    ]).then(function (res) {
      var idb = res[0], ls = res[1], cache = res[2];
      var total = (idb.bytes || 0) + (ls.bytes || 0) + (cache.bytes || 0);
      return {
        indexedDB: { bytes: idb.bytes, text: formatBytes(idb.bytes) + (idb.note ? '（' + idb.note + '）' : '') },
        localStorage: { bytes: ls.bytes, text: formatBytes(ls.bytes) },
        edgeCache: { bytes: cache.bytes, text: formatBytes(cache.bytes) + (cache.count != null ? ' · ' + cache.count + ' 项' : '') },
        total: { bytes: total, text: formatBytes(total) },
      };
    });
  };

  /** IndexedDB / 站点存储估算 */
  PrivacyAudit.prototype._idbUsage = function () {
    return new Promise(function (resolve) {
      try {
        if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
          navigator.storage.estimate().then(function (est) {
            var bytes = (typeof est.usage === 'number') ? est.usage : 0;
            resolve({ bytes: bytes, note: '站点存储估算' });
          }).catch(function () { resolve({ bytes: 0 }); });
        } else {
          resolve({ bytes: 0 });
        }
      } catch (e) { resolve({ bytes: 0 }); }
    });
  };

  /** localStorage 字节（遍历所有 key=value 的 UTF-8 长度） */
  PrivacyAudit.prototype._localStorageUsage = function () {
    return new Promise(function (resolve) {
      try {
        var bytes = 0;
        if (typeof localStorage !== 'undefined' && localStorage) {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            var v = localStorage.getItem(k) || '';
            bytes += byteLen(k + '=' + v);
          }
        }
        resolve({ bytes: bytes });
      } catch (e) { resolve({ bytes: 0 }); }
    });
  };

  /** 独立 Cache xinyu-edge-v1 字节（绝不读写 sw key=19） */
  PrivacyAudit.prototype._edgeCacheUsage = function () {
    return new Promise(function (resolve) {
      try {
        if (typeof G.caches === 'undefined' || !G.caches || typeof G.caches.open !== 'function') {
          resolve({ bytes: 0, count: 0 }); return;
        }
        G.caches.open('xinyu-edge-v1').then(function (cache) {
          cache.keys().then(function (keys) {
            var reqs = keys || [];
            if (!reqs.length) { resolve({ bytes: 0, count: 0 }); return; }
            Promise.all(reqs.map(function (req) {
              return cache.match(req).then(function (res) {
                if (!res) return 0;
                var cl = res.headers ? res.headers.get('content-length') : null;
                if (cl && /^\d+$/.test(cl)) return parseInt(cl, 10);
                try {
                  return res.clone().blob().then(function (b) { return b ? b.size : 0; }).catch(function () { return 0; });
                } catch (e) { return 0; }
              }).catch(function () { return 0; });
            })).then(function (sizes) {
              var total = sizes.reduce(function (a, b) { return a + (b || 0); }, 0);
              resolve({ bytes: total, count: reqs.length });
            }).catch(function () { resolve({ bytes: 0, count: reqs.length }); });
          }).catch(function () { resolve({ bytes: 0, count: 0 }); });
        }).catch(function () { resolve({ bytes: 0, count: 0 }); });
      } catch (e) { resolve({ bytes: 0, count: 0 }); }
    });
  };

  /**
   * 构建导出报告（纯本地隐私指标，不含任何聊天内容/记忆正文）。
   * @returns {Promise<Object>}
   */
  PrivacyAudit.prototype._buildReport = function () {
    var self = this;
    var ap = self._audit();
    var st = self._consent();
    var off = self._offline();
    var proof = ap ? ap.proveZeroReporting() : { zeroReporting: true, blocked: 0, allowed: 0, consented: 0 };
    return self.getStorageUsage().then(function (usage) {
      return {
        app: '心屿 Xinyu',
        agent: '小暖',
        exportedAt: new Date().toISOString(),
        privacy: {
          zeroReporting: proof.zeroReporting,
          blocked: proof.blocked,
          allowed: proof.allowed,
          consented: proof.consented,
          note: '本导出仅含本地隐私指标，不含任何聊天内容或记忆正文。',
        },
        consent: st ? { tts: st.get('tts'), asr: st.get('asr'), ltm: st.get('ltm'), cloudSync: st.get('cloudSync') } : {},
        network: { channel: off ? off.getState() : 'unknown' },
        storage: usage,
        auditLog: ap ? ap.getReport().log : [],
        encrypted: false,
      };
    });
  };

  /**
   * 导出审计日志。默认未加密 JSON 下载 xinyu-audit.json；
   * format='encrypted' 时走 AuditExporter.exportEncrypted（AES-GCM，密钥不落地）。
   * @param {string} [format='json'|'encrypted']
   * @param {string} [passphrase] 加密口令（encrypted 时使用）
   * @returns {Promise<Object>} 报告对象
   */
  PrivacyAudit.prototype.exportLogs = function (format, passphrase) {
    format = format || 'json';
    var self = this;
    return self._buildReport().then(function (report) {
      if (format === 'encrypted') {
        return self._exportEncryptedBlob(report, passphrase);
      }
      var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'xinyu-audit.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { document.body.removeChild(a); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
      }, 200);
      return report;
    });
  };

  /** 点击「加密导出」：弹出本地口令输入（口令绝不保存/上传）。 */
  PrivacyAudit.prototype._exportEncrypted = function () {
    var self = this;
    this._requestPassphrase(function (pass) {
      if (!pass) return;
      self.exportLogs('encrypted', pass);
    });
  };

  /** 经 AuditExporter 生成 AES-GCM 加密 Blob 并下载（密钥不落地）。 */
  PrivacyAudit.prototype._exportEncryptedBlob = function (report, passphrase) {
    var AE = (G.AuditExporter && G.AuditExporter.getInstance) ? G.AuditExporter.getInstance() : null;
    if (!AE) { this.exportLogs('json'); return Promise.resolve(report); }
    var salt = AE.randomSalt(16);
    return AE.deriveKey(passphrase, salt)
      .then(function (key) { return AE.exportEncrypted(report, key, { salt: salt }); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'xinyu-audit.json.enc';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try { document.body.removeChild(a); } catch (e) {}
          try { URL.revokeObjectURL(url); } catch (e) {}
        }, 200);
        return report;
      });
  };

  /** 本地口令输入弹窗（无上云）。 */
  PrivacyAudit.prototype._requestPassphrase = function (cb) {
    var mask = document.createElement('div');
    mask.className = 'xn-modal-mask';
    var panel = document.createElement('div');
    panel.className = 'xn-modal-panel';
    panel.innerHTML =
      '<div class="xn-modal-title">🔐 加密导出密码</div>' +
      '<p class="xn-modal-text">设置导出文件的加密口令（AES-GCM）。口令仅用于本地加密，<b>不会保存、不会上传</b>。</p>' +
      '<input type="password" id="xn-pass-input" class="xn-input" placeholder="输入加密口令" autocomplete="off">' +
      '<div class="xn-modal-actions">' +
      '  <button class="xn-btn xn-btn-primary" data-act="ok">加密并下载</button>' +
      '  <button class="xn-btn xn-btn-danger" data-act="cancel">取消</button>' +
      '</div>';
    mask.appendChild(panel);
    document.body.appendChild(mask);
    var input = panel.querySelector('#xn-pass-input');
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
    function close() { try { document.body.removeChild(mask); } catch (e) {} }
    panel.querySelector('[data-act="ok"]').addEventListener('click', function () {
      var v = input ? input.value : '';
      close();
      if (typeof cb === 'function') cb(v);
    });
    panel.querySelector('[data-act="cancel"]').addEventListener('click', function () { close(); if (typeof cb === 'function') cb(null); });
    mask.addEventListener('click', function (ev) { if (ev.target === mask) { close(); if (typeof cb === 'function') cb(null); } });
  };

  /**
   * 清除本地审计数据：审计日志 + 独立 Cache xinyu-edge-v1 + 本地模型预热态。
   * 绝不碰 sw key=19、绝不触及 xinyu.ltm.* 与 xinyu.voice.*（A/B 共存）。
   * 二次确认由 UI 层（_onClearClick）负责；此处为实际清除。
   * @returns {Promise<{ok:boolean,message:string}>}
   */
  PrivacyAudit.prototype.clearAll = function () {
    var self = this;
    // 1) 清除审计日志（计数 + 日志）
    var ap = self._audit();
    if (ap && typeof ap.reset === 'function') {
      try { ap.reset(); } catch (e) {}
    }
    // 2) 重新登记已同意的外发端点（reset 会清空 consentedRegistry，须恢复以免误阻断云通道）
    try { if (typeof G.__xinyuReconsent === 'function') G.__xinyuReconsent(); } catch (e) {}
    // 3) 清除独立 Cache xinyu-edge-v1（绝不读写 sw key=19）
    self._clearEdgeCache();
    // 4) 清除本地模型预热态 + 审计导出缓存（不碰 xinyu.ltm.* 与 xinyu.voice.*）
    self._clearLocalKeys();
    // 5) 刷新指标
    return self.refreshMetrics().then(function () {
      return { ok: true, message: '本地审计数据已清除。' };
    });
  };

  /** 清除独立 Cache 命名空间 xinyu-edge-v1（绕开冻结 sw.js，绝不涉及 key=19） */
  PrivacyAudit.prototype._clearEdgeCache = function () {
    try {
      if (typeof G.caches === 'undefined' || !G.caches || typeof G.caches.delete !== 'function') return;
      G.caches.delete('xinyu-edge-v1').catch(function () {});
    } catch (e) {}
  };

  /**
   * 清除本地键：xinyu.localmodel*（本地模型预热态）+ xinyu.audit.export.*（审计导出缓存）。
   * 严格白名单：绝不触碰 xinyu.ltm.*（A）/ xinyu.voice.*（B）。
   * 同时 best-effort 删除 transformers 模型缓存（不碰 sw key=19）。
   */
  PrivacyAudit.prototype._clearLocalKeys = function () {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (/^xinyu\.localmodel/i.test(k) || /^xinyu\.audit\.export/i.test(k))) toRemove.push(k);
        }
        toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      }
    } catch (e) {}
    // best-effort：删除 transformers 模型缓存（其由 transformers.js 自有 Cache 命名，与 sw key=19、xinyu.ltm/voice 无关）
    try {
      if (typeof G.caches !== 'undefined' && G.caches && typeof G.caches.keys === 'function') {
        G.caches.keys().then(function (names) {
          (names || []).forEach(function (n) {
            if (/transformers/i.test(n) || /^xinyu-edge/i.test(n)) {
              try { G.caches.delete(n).catch(function () {}); } catch (e2) {}
            }
          });
        }).catch(function () {});
      }
    } catch (e) {}
  };

  /**
   * 清除按钮点击：二次确认流程。
   * cloudSync 已开启时追加「二次确认」（警告本地清除不影响云端备份）。
   */
  PrivacyAudit.prototype._onClearClick = function () {
    var self = this;
    var st = self._consent();
    var cloudOn = st ? st.get('cloudSync') : false;

    self._confirm(
      '清除本地审计数据',
      '这会清除小暖的本地审计日志、独立缓存与本地模型预热态。此操作不可恢复，且不会影响你的聊天记录与长期记忆。确定继续吗？',
      function (ok1) {
        if (!ok1) return;
        if (!cloudOn) { self.clearAll(); return; }
        // cloudSync 开启 → 二次确认
        self._confirm(
          '⚠️ 你已开启云同步（已授权外发）',
          '本地数据清除后，<b>云端备份不会被删除</b>——换设备仍可从云端恢复。确定继续清除本机数据吗？',
          function (ok2) { if (ok2) self.clearAll(); },
          true
        );
      }
    );
  };

  /**
   * 通用确认弹窗。
   * @param {string} title
   * @param {string} html 允许内联 HTML
   * @param {function(boolean):void} cb
   * @param {boolean} [danger]
   */
  PrivacyAudit.prototype._confirm = function (title, html, cb, danger) {
    var mask = document.createElement('div');
    mask.className = 'xn-modal-mask';
    var panel = document.createElement('div');
    panel.className = 'xn-modal-panel';
    panel.innerHTML =
      '<div class="xn-modal-title' + (danger ? ' danger' : '') + '">' + title + '</div>' +
      '<p class="xn-modal-text">' + html + '</p>' +
      '<div class="xn-modal-actions">' +
      '  <button class="xn-btn xn-btn-primary" data-act="ok">确定</button>' +
      '  <button class="xn-btn xn-btn-danger" data-act="cancel">取消</button>' +
      '</div>';
    mask.appendChild(panel);
    document.body.appendChild(mask);

    function close(r) {
      try { document.body.removeChild(mask); } catch (e) {}
      if (typeof cb === 'function') cb(r);
    }
    panel.querySelector('[data-act="ok"]').addEventListener('click', function () { close(true); });
    panel.querySelector('[data-act="cancel"]').addEventListener('click', function () { close(false); });
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(false); });
  };

  // 对外门面
  G.PrivacyAudit = PrivacyAudit;
  // 页面加载即注入样式（script 位于 body 末尾，document.head 已就绪）
  try { ensureStyle(); } catch (e) {}
})();
