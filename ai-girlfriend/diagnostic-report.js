/**
 * diagnostic-report.js · 心屿 候选 C（C-E4 · C14）· 本地诊断报告（挂 window.DiagnosticReport，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 *   · build()        —— 聚合零上报证明 / 存储 / 同意 / 通道态，返回本地诊断对象；
 *   · shareLocal()   —— 仅本地分享：导出 JSON 或渲染本地二维码（自包含 QR 生成器，无任何上云路径）。
 * 代码中不存在任何 fetch/XHR/WebSocket/sendBeacon/EventSource 上云调用。
 * 铁律：不引入任何第三方库；不触碰冻结线；小暖 不更名。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  /** UTF-8 字节长度 */
  function byteLen(s) {
    try { return new TextEncoder().encode(String(s)).length; } catch (e) { return String(s).length; }
  }

  /**
   * DiagnosticReport —— 本地诊断报告。
   * @constructor
   */
  function DiagnosticReport() {}

  /** 单例 */
  DiagnosticReport.getInstance = function () {
    if (!DiagnosticReport._inst) DiagnosticReport._inst = new DiagnosticReport();
    return DiagnosticReport._inst;
  };

  /**
   * 聚合本地诊断信息（零上报证明 / 存储 / 同意 / 通道态）。
   * 完全本地，不含任何聊天内容或记忆正文。
   * @returns {Object}
   */
  DiagnosticReport.prototype.build = function () {
    var ap = (G.AuditProbe && G.AuditProbe.getInstance) ? G.AuditProbe.getInstance() : null;
    var cs = (G.ConsentStore && G.ConsentStore.getInstance) ? G.ConsentStore.getInstance() : null;
    var off = (G.OfflineProbe && G.OfflineProbe.getInstance) ? G.OfflineProbe.getInstance() : null;

    var proof = ap ? ap.proveZeroReporting() : { zeroReporting: true, blocked: 0, allowed: 0, consented: 0 };
    var consent = cs ? { tts: cs.get('tts'), asr: cs.get('asr'), ltm: cs.get('ltm'), cloudSync: cs.get('cloudSync') } : {};
    var channel = off ? off.getState() : 'unknown';

    var report = {
      app: '心屿 Xinyu',
      agent: '小暖',
      generatedAt: new Date().toISOString(),
      zeroReporting: proof.zeroReporting,
      outgoing: { blocked: proof.blocked, allowed: proof.allowed, consented: proof.consented },
      consent: consent,
      channel: channel,
      note: '本诊断报告完全在本地生成，不含任何聊天内容或记忆正文，代码中无任何上云路径。',
    };

    // 隐私评分（C12，本地）
    if (G.PrivacyScore && G.PrivacyScore.getInstance) {
      var ps = G.PrivacyScore.getInstance();
      try {
        report.score = ps.compute({
          blocked: proof.blocked,
          consented: proof.consented,
          cloudSync: consent.cloudSync,
        });
        report.grade = ps.grade(report.score);
      } catch (e) {}
    }

    // 存储估算（仅 localStorage 同步估算，IndexedDB/独立Cache 为异步，详见审计面板）
    var lsBytes = 0;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          var v = localStorage.getItem(k) || '';
          lsBytes += byteLen(k + '=' + v);
        }
      }
    } catch (e) {}
    report.storage = {
      localStorageBytes: lsBytes,
      note: '仅含 localStorage 同步估算；IndexedDB/独立Cache 为异步，详见隐私审计面板。',
    };

    return report;
  };

  /**
   * 仅本地分享诊断报告。
   *   mode='json'（默认）：下载 JSON 文件；
   *   mode='qr'  ：在本地弹层用 canvas 渲染二维码（自包含 QR 生成器，绝不上云）；
   *               若内容过大无法编码或任何异常，自动回退到 JSON 下载。
   * @param {Object} [opts] { mode?: 'json'|'qr', container?: HTMLElement }
   * @returns {Object} 报告对象
   */
  DiagnosticReport.prototype.shareLocal = function (opts) {
    opts = opts || {};
    var mode = opts.mode || 'json';
    var report = this.build();

    if (mode === 'qr') {
      try { this._renderQR(report, opts.container); return report; }
      catch (e) { mode = 'json'; }
    }

    // 默认 / 回退：本地 JSON 下载（无任何上云路径）
    var json = JSON.stringify(report, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'xinyu-diagnostic.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 200);
    return report;
  };

  /** 构建紧凑分享令牌（用于二维码，足够小以适配低版本 QR）。 */
  DiagnosticReport.prototype._token = function (report) {
    return JSON.stringify({
      a: 'xinyu',
      g: 'xiaonuan',
      z: report.zeroReporting ? 1 : 0,
      s: (typeof report.score === 'number') ? report.score : null,
      c: report.channel,
      t: report.generatedAt,
    });
  };

  /** 渲染本地二维码（自包含生成器，画到临时弹层 canvas，绝不上云）。 */
  DiagnosticReport.prototype._renderQR = function (report, container) {
    var token = this._token(report);
    var bytes = new TextEncoder().encode(token);
    if (bytes.length > 271) throw new Error('diagnostic token too large for local QR; falling back to JSON');
    var mat = QRGen.encode(token);
    var size = mat.size;

    var host = container && container.appendChild ? container : document.body;
    var mask = document.createElement('div');
    mask.className = 'xn-modal-mask';
    var panel = document.createElement('div');
    panel.className = 'xn-modal-panel';
    panel.innerHTML =
      '<div class="xn-modal-title">📡 本地诊断二维码</div>' +
      '<p class="xn-modal-text">此二维码由 <b>小暖</b> 在本地生成，仅含验证摘要，<b>绝不上云</b>。可截图自行留存核验。</p>' +
      '<div style="display:flex;justify-content:center"><canvas id="xn-qr-canvas" width="' + (size * 6) + '" height="' + (size * 6) + '"></canvas></div>' +
      '<div class="xn-modal-actions">' +
      '  <button class="xn-btn xn-btn-primary" data-act="ok">关闭</button>' +
      '  <button class="xn-btn xn-btn-danger" data-act="json">改用 JSON 下载</button>' +
      '</div>';
    mask.appendChild(panel);
    host.appendChild(mask);

    var canvas = panel.querySelector('#xn-qr-canvas');
    var ctx = canvas.getContext('2d');
    var scale = 6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size * scale, size * scale);
    ctx.fillStyle = '#2a1c24';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (mat.modules[y][x]) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    function close() { try { host.removeChild(mask); } catch (e) {} }
    panel.querySelector('[data-act="ok"]').addEventListener('click', close);
    panel.querySelector('[data-act="json"]').addEventListener('click', function () {
      close();
      try { this.shareLocal({ mode: 'json' }); } catch (e) {}
    }.bind(this));
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
  };

  /* ======================================================================
   * QRGen —— 自包含 QR Code 生成器（字节模式，EC 等级 L，版本 1-10）
   * 基于公有领域算法（Nayuki 结构简化移植），零外部依赖。仅用于本地渲染。
   * 输出：{ size, modules: boolean[][] }（true=深色模块）。
   * ==================================================================== */
  var QRGen = (function () {
    // ---- GF(256) 表（本原多项式 0x11d）----
    var EXP = new Array(256), LOG = new Array(256);
    (function () {
      var x = 1;
      for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
      EXP[255] = EXP[0];
    })();
    function gmul(a, b) { if (a === 0 || b === 0) return 0; return EXP[(LOG[a] + LOG[b]) % 255]; }

    // ---- Reed-Solomon 生成多项式 ----
    function rsGen(ecLen) {
      var g = [1];
      for (var i = 0; i < ecLen; i++) {
        var ng = new Array(g.length + 1); for (var z = 0; z < ng.length; z++) ng[z] = 0;
        for (var j = 0; j < g.length; j++) {
          ng[j + 1] ^= g[j];
          ng[j] ^= gmul(g[j], EXP[i]);
        }
        g = ng;
      }
      return g;
    }
    // 系统码 RS 编码（返回 ecLen 个纠错码字）
    function rsEnc(data, ecLen) {
      var gen = rsGen(ecLen);
      var res = new Array(ecLen); for (var z = 0; z < ecLen; z++) res[z] = 0;
      for (var i = 0; i < data.length; i++) {
        var coef = data[i] ^ res[0];
        for (var j = 0; j < ecLen - 1; j++) res[j] = res[j + 1];
        res[ecLen - 1] = 0;
        if (coef !== 0) for (var k = 0; k < ecLen; k++) res[k] ^= gmul(gen[k], coef);
      }
      return res;
    }

    // ---- 版本表（EC 等级 L，版本 1-10）----
    // { size, data(总数据码字数), ec(每块纠错码字数), blocks(块数) }
    var V = [
      null,
      { size: 21, data: 19, ec: 7, blocks: 1 },
      { size: 25, data: 34, ec: 10, blocks: 1 },
      { size: 29, data: 55, ec: 15, blocks: 1 },
      { size: 33, data: 80, ec: 20, blocks: 1 },
      { size: 37, data: 108, ec: 26, blocks: 1 },
      { size: 41, data: 136, ec: 18, blocks: 2 },
      { size: 45, data: 156, ec: 22, blocks: 2 },
      { size: 49, data: 194, ec: 22, blocks: 2 },
      { size: 53, data: 232, ec: 24, blocks: 2 },
      { size: 57, data: 274, ec: 24, blocks: 2 },
    ];
    // 对齐图案中心坐标（版本 1-10）
    var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

    function capacity(v) { return V[v].data - (v <= 9 ? 2 : 3); } // 字节模式可用字节数（扣除模式+长度开销）

    function chooseVersion(len) {
      for (var v = 1; v <= 10; v++) if (capacity(v) >= len) return v;
      return 0;
    }

    // ---- 构造比特流并转为码字 ----
    function buildCodewords(text, v) {
      var info = V[v];
      var enc = new TextEncoder();
      var bytes = Array.from(enc.encode(text));
      var bits = [];
      function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
      put(0x4, 4);                                   // 字节模式
      if (v <= 9) put(bytes.length, 8); else put(bytes.length, 16);
      for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
      var cap = info.data * 8;
      var term = Math.min(4, cap - bits.length);
      put(0, term);                                  // 终止符
      while (bits.length % 8 !== 0) bits.push(0);    // 补齐到字节
      var pad = [0xEC, 0x11], pi = 0;
      while (bits.length < cap) { put(pad[pi % 2], 8); pi++; }
      var cw = [];
      for (var b = 0; b < bits.length; b += 8) {
        var x = 0; for (var j = 0; j < 8; j++) x = (x << 1) | bits[b + j];
        cw.push(x);
      }
      return cw;
    }

    // ---- RS + 块交织 ----
    function ecInterleave(cw, v) {
      var info = V[v];
      var dpb = info.data / info.blocks;
      var groups = [];
      for (var b = 0; b < info.blocks; b++) {
        var g = cw.slice(b * dpb, (b + 1) * dpb);
        groups.push({ d: g, e: rsEnc(g, info.ec) });
      }
      var out = [];
      for (var i = 0; i < dpb; i++) for (var b2 = 0; b2 < info.blocks; b2++) out.push(groups[b2].d[i]);
      for (var e = 0; e < info.ec; e++) for (var b3 = 0; b3 < info.blocks; b3++) out.push(groups[b3].e[e]);
      return out;
    }

    // ---- 构造矩阵（函数图案 + 数据放置 + 掩码选择）----
    function maskBit(mask, y, x) {
      switch (mask) {
        case 0: return (y + x) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (y + x) % 3 === 0;
        case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
        case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
        case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
        case 7: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
      }
      return false;
    }

    function getBCHDigit(d) { var n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
    // 格式信息 BCH(15,5)：data=5bit(ecLevel<<3 | mask)，G15=0x537，掩码=0x5412
    function getFormatBits(data) {
      var G15 = 0x537, G15_MASK = 0x5412;
      var rem = data << 10;
      while (getBCHDigit(rem) - getBCHDigit(G15) >= 0) rem ^= (G15 << (getBCHDigit(rem) - getBCHDigit(G15)));
      return ((data << 10) | rem) ^ G15_MASK;
    }

    function buildMatrix(text, v) {
      var info = V[v];
      var size = info.size;
      var mods = [], res = [];
      for (var r = 0; r < size; r++) { mods.push(new Array(size).fill(false)); res.push(new Array(size).fill(false)); }
      function setF(rr, cc, val) { if (rr < 0 || cc < 0 || rr >= size || cc >= size) return; mods[rr][cc] = val; res[rr][cc] = true; }

      // 定位图案（三个角）
      function finder(r0, c0) {
        for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
          var rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = (r === 0 || r === 6 || c === 0 || c === 6) ? true : (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          if (r === -1 || c === -1 || r === 7 || c === 7) on = false; // 分隔白边
          setF(rr, cc, on);
        }
      }
      finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

      // 定时图案
      for (var i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }

      // 对齐图案
      var pos = ALIGN[v];
      if (pos && pos.length) {
        for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
          var r = pos[a], c = pos[b];
          if ((r === pos[0] && c === pos[0]) || (r === pos[0] && c === pos[pos.length - 1]) || (r === pos[pos.length - 1] && c === pos[0])) continue;
          for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
            var on = (dr === 0 && dc === 0) || (Math.abs(dr) === 2 && Math.abs(dc) === 2);
            setF(r + dr, c + dc, on);
          }
        }
      }

      // 深色模块（固定）
      setF(size - 8, 8, true);

      // 数据码字 → 比特流
      var cw = ecInterleave(buildCodewords(text, v), v);
      var allBits = [];
      for (var ci = 0; ci < cw.length; ci++) for (var bit = 7; bit >= 0; bit--) allBits.push((cw[ci] >> bit) & 1);
      var totalCap = info.data + info.ec * info.blocks;
      while (allBits.length < totalCap * 8) allBits.push(false);

      // 数据放置（之字形，跳过函数模块）
      var bi = 0;
      for (var right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (var vert = 0; vert < size; vert++) {
          for (var j = 0; j < 2; j++) {
            var x = right - j;
            var upward = ((right + 1) & 2) === 0;
            var y = upward ? size - 1 - vert : vert;
            if (res[y][x]) continue; // 函数模块，跳过（不消耗数据位）
            var bitVal = bi < allBits.length ? allBits[bi] : false;
            bi++;
            mods[y][x] = bitVal;
          }
        }
      }

      // 选择最佳掩码（最低惩罚）
      var bestMask = 0, bestPenalty = Infinity, bestMods = null;
      for (var m = 0; m < 8; m++) {
        var trial = mods.map(function (row) { return row.slice(); });
        applyMask(trial, res, m, size);
        drawFormat(trial, res, m, size);
        var pen = penalty(trial, size);
        if (pen < bestPenalty) { bestPenalty = pen; bestMask = m; bestMods = trial; }
      }
      return { size: size, modules: bestMods };
    }

    function applyMask(mods, res, mask, size) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        if (res[y][x]) continue; // 函数模块不掩码
        if (maskBit(mask, y, x)) mods[y][x] = !mods[y][x];
      }
    }

    function drawFormat(mods, res, mask, size) {
      var ecBits = 0x1; // L = 01
      var fmt = getFormatBits((ecBits << 3) | mask);
      function set(r, c, val) { if (r < 0 || c < 0 || r >= size || c >= size) return; mods[r][c] = val; res[r][c] = true; }
      for (var i = 0; i <= 5; i++) set(8, i, ((fmt >> i) & 1) === 1);
      set(8, 7, ((fmt >> 6) & 1) === 1);
      set(8, 8, ((fmt >> 7) & 1) === 1);
      set(7, 8, ((fmt >> 8) & 1) === 1);
      for (var i2 = 9; i2 < 15; i2++) set(14 - i2, 8, ((fmt >> i2) & 1) === 1);
      for (var k = 0; k < 8; k++) set(size - 1 - k, 8, ((fmt >> k) & 1) === 1);
      for (var k2 = 8; k2 < 15; k2++) set(8, size - 15 + k2, ((fmt >> k2) & 1) === 1);
      set(size - 8, 8, true); // 深色模块
    }

    function penalty(mods, size) {
      var result = 0, N1 = 3, N2 = 3, N3 = 40, N4 = 10;
      // 规则1：行/列连续同色
      for (var y = 0; y < size; y++) {
        var runColor = false, run = 0;
        for (var x = 0; x < size; x++) {
          var color = mods[y][x];
          if (color === runColor) { run++; if (run === 5) result += N1; else if (run > 5) result++; }
          else { runColor = color; run = 1; }
        }
      }
      for (var x2 = 0; x2 < size; x2++) {
        var runColor2 = false, run2 = 0;
        for (var y2 = 0; y2 < size; y2++) {
          var color2 = mods[y2][x2];
          if (color2 === runColor2) { run2++; if (run2 === 5) result += N1; else if (run2 > 5) result++; }
          else { runColor2 = color2; run2 = 1; }
        }
      }
      // 规则2：2x2 同色块
      for (var yy = 0; yy < size - 1; yy++) for (var xx = 0; xx < size - 1; xx++) {
        var c = mods[yy][xx];
        if (c === mods[yy][xx + 1] && c === mods[yy + 1][xx] && c === mods[yy + 1][xx + 1]) result += N2;
      }
      // 规则3：定位类图案 1011101 0000 / 0000 1011101
      for (var ry = 0; ry < size; ry++) for (var rx = 0; rx < size; rx++) {
        if (rx + 6 < size && mods[ry][rx] && !mods[ry][rx + 1] && mods[ry][rx + 2] && mods[ry][rx + 3] && mods[ry][rx + 4] && !mods[ry][rx + 5] && mods[ry][rx + 6]) result += N3;
        if (ry + 6 < size && mods[rx][ry] && !mods[rx + 1][ry] && mods[rx + 2][ry] && mods[rx + 3][ry] && mods[rx + 4][ry] && !mods[rx + 5][ry] && mods[rx + 6][ry]) result += N3;
      }
      // 规则4：明暗平衡
      var dark = 0;
      for (var dy = 0; dy < size; dy++) for (var dx = 0; dx < size; dx++) if (mods[dy][dx]) dark++;
      var total = size * size;
      var k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
      result += k * N4;
      return result;
    }

    /** 编码文本为 QR 矩阵；超出版本 1-10 容量则抛错。 */
    function encode(text) {
      var bytes = new TextEncoder().encode(text);
      var v = chooseVersion(bytes.length);
      if (v === 0) throw new Error('内容过大，超出本地 QR 支持范围');
      return buildMatrix(text, v);
    }

    return { encode: encode };
  })();

  // 对外门面
  G.DiagnosticReport = DiagnosticReport;
  if (typeof module !== 'undefined' && module.exports) module.exports = DiagnosticReport;
})();
