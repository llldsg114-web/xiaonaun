/**
 * local-model-ui.js · 心屿 候选 C（C-E4 · C7）· 本地模型管理 UI（挂 window.LocalModelUI，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 管理端侧推理权重的加载/卸载与状态展示。
 *   · render(container)         —— 展示本地模型状态(未加载/已加载)、操作按钮；
 *   · toggleModel()             —— 切换加载/卸载（加载前显式告知「将从 HuggingFace CDN 拉取权重，一次性本地缓存」）；
 *   · showWeights()             —— 展示权重信息（模型 id、本地缓存说明）。
 * 加载严格经 C-E2 的 window.loadLocalModelWithConsent() 同意门控（D1 合规）。
 * 铁律：不引入任何第三方库；不触碰冻结线；默认绝不自动下载外部模型。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  function lm() { return (G.LocalModel) || null; }

  /**
   * LocalModelUI —— 本地模型管理 UI。
   * @constructor
   */
  function LocalModelUI() {
    this._lastStatus = null;
  }

  /** 单例 */
  LocalModelUI.getInstance = function () {
    if (!LocalModelUI._inst) LocalModelUI._inst = new LocalModelUI();
    return LocalModelUI._inst;
  };

  /**
   * 渲染本地模型管理 UI 到 container。
   * @param {HTMLElement} container
   */
  LocalModelUI.prototype.render = function (container) {
    if (!container) return;
    var self = this;

    container.innerHTML =
      '<div class="xn-lm-head">' +
      '  <div class="xn-lm-title">本地模型（端侧推理 · 离线可用）</div>' +
      '  <div class="xn-lm-status" id="xn-lm-status">状态：检测中…</div>' +
      '</div>' +
      '<div class="xn-lm-desc">默认由 <b>小暖</b> 的本地启发式兜底，断网也能聊；' +
      '如想更强，可加载自导权重（一次性下载并本地缓存，用于离线端侧推理，<b>绝不上云</b>）。</div>' +
      '<div class="xn-lm-actions">' +
      '  <button class="xn-btn xn-btn-primary" id="xn-lm-load" type="button">加载自导权重</button>' +
      '  <button class="xn-btn xn-btn-danger" id="xn-lm-unload" type="button">卸载</button>' +
      '</div>' +
      '<div class="xn-lm-progress" id="xn-lm-progress"></div>' +
      '<div class="xn-lm-weights" id="xn-lm-weights"></div>';

    // 订阅进度（LocalModel.onProgress 在加载过程中回调）
    var m = lm();
    if (m && typeof m.onProgress === 'function') {
      try { m.onProgress(function (p) { self._renderProgress(p); }); } catch (e) {}
    }
    this._refreshStatus();
    this.showWeights();

    var loadBtn = container.querySelector('#xn-lm-load');
    var unloadBtn = container.querySelector('#xn-lm-unload');
    if (loadBtn) loadBtn.addEventListener('click', function () { self.toggleModel(); });
    if (unloadBtn) unloadBtn.addEventListener('click', function () { self._unload(); });
  };

  /** 刷新状态文案与按钮可用性。 */
  LocalModelUI.prototype._refreshStatus = function () {
    var m = lm();
    var el = document.getElementById('xn-lm-status');
    if (el) {
      var loaded = !!(m && typeof m.isLoaded === 'function' && m.isLoaded());
      el.textContent = loaded
        ? '状态：已加载（端侧推理就绪，可离线对话）'
        : '状态：未加载（使用本地启发式兜底）';
    }
    var u = document.getElementById('xn-lm-unload');
    if (u) u.disabled = !(m && typeof m.isLoaded === 'function' && m.isLoaded());
  };

  /** 渲染下载/加载进度条。 */
  LocalModelUI.prototype._renderProgress = function (p) {
    this._lastStatus = p;
    var el = document.getElementById('xn-lm-progress');
    if (!el || !p) return;
    var pct = (typeof p.progress === 'number') ? p.progress : 0;
    var txt = (p.text || (p.status || ''));
    el.innerHTML =
      '<div class="xn-lm-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="xn-lm-bar-txt">' + txt + ' (' + pct + '%)</div>';
    this._refreshStatus();
  };

  /**
   * 切换加载/卸载。
   * 加载前显式告知用户「将从 HuggingFace CDN 拉取权重，一次性本地缓存」，确认后
   * 才调用 C-E2 同意门控 window.loadLocalModelWithConsent()（D1 合规）。
   */
  LocalModelUI.prototype.toggleModel = function () {
    var m = lm();
    if (m && typeof m.isLoaded === 'function' && m.isLoaded()) { this._unload(); return; }
    var self = this;
    var ok = true;
    try {
      if (typeof window.confirm === 'function') {
        ok = window.confirm(
          '将从 HuggingFace CDN 拉取权重（约 0.5GB），仅一次性本地缓存，用于离线端侧推理，绝不上云。是否继续？'
        );
      }
    } catch (e) {}
    if (!ok) return;
    this._load();
  };

  /** 经同意门控加载权重。 */
  LocalModelUI.prototype._load = function () {
    var self = this;
    var gate = (typeof window.loadLocalModelWithConsent === 'function') ? window.loadLocalModelWithConsent : null;
    if (!gate) {
      this._renderProgress({ status: 'error', text: '本地模型门控不可用（需先启用本地模型）' });
      return;
    }
    this._renderProgress({ status: 'loading', progress: 1, text: '正在请求加载（需你已同意）…' });
    Promise.resolve()
      .then(function () { return gate(); })
      .then(function (ok) {
        if (ok) {
          self._renderProgress({ status: 'ready', progress: 100, text: '已加载，可以离线对话啦～' });
        } else {
          self._renderProgress({ status: 'error', text: '加载未完成（可能被拒绝或网络不可达）' });
        }
        self._refreshStatus();
        self.showWeights();
      })
      .catch(function () {
        self._renderProgress({ status: 'error', text: '加载失败' });
        self._refreshStatus();
      });
  };

  /** 卸载已加载权重（仅释放本地内存，不影响已缓存的浏览器缓存）。 */
  LocalModelUI.prototype._unload = function () {
    var m = lm();
    if (m && typeof m.unload === 'function') { try { m.unload(); } catch (e) {} }
    this._refreshStatus();
    var el = document.getElementById('xn-lm-progress');
    if (el) el.innerHTML = '';
    this.showWeights();
  };

  /**
   * 展示权重信息（模型 id 与本地缓存说明）。
   */
  LocalModelUI.prototype.showWeights = function () {
    var m = lm();
    var el = document.getElementById('xn-lm-weights');
    if (!el) return;
    var loaded = !!(m && typeof m.isLoaded === 'function' && m.isLoaded());
    var model = (m && m.DEFAULT_MODEL) ? m.DEFAULT_MODEL : 'onnx-community/Qwen2.5-0.5B-Instruct';
    if (!loaded) {
      el.innerHTML = '<div class="xn-lm-w-txt">尚未加载权重。点「加载自导权重」可一次性下载并本地缓存：<br><code>' +
        model + '</code></div>';
      return;
    }
    el.innerHTML = '<div class="xn-lm-w-txt">当前权重：<br><code>' + model +
      '</code><br>（已缓存于本地，仅供离线端侧推理，绝不上云）</div>';
  };

  // 对外门面
  G.LocalModelUI = LocalModelUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = LocalModelUI;
})();
