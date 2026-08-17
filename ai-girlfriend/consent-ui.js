/**
 * consent-ui.js · 心屿 候选 C（隐私/端侧增强）· 精细同意开关 UI（挂 window.ConsentUI，IIFE，零 npm 依赖）
 * --------------------------------------------------------------------
 * 精细同意开关 UI：TTS / ASR / LTM / cloudSync。
 *   · TTS / ASR / LTM 默认开（本地能力，隐私优先但功能可用）；
 *   · cloudSync 默认关，且开启需「二次确认」弹窗（解决 C-E1 遗留风险：
 *     ConsentStore.set('cloudSync',true) 必须经二次确认才生效，杜绝误触外发）。
 * 依赖 window.ConsentStore（xinyu.consent）读取/写入同意态。
 * D2：云同步（唯一外发通道）开启后，显著标注「已授权外发」徽标。
 * 铁律：不引入任何第三方库；不触碰冻结线；小暖 不更名；A/B 不退化。
 * 心智体：小暖(Xiaonuan) / 产品名：心屿。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : this);

  /**
   * 同意项配置。external=true 表示「对外发送通道」，需二次确认 + 「已授权外发」徽标。
   */
  var ITEMS = [
    { key: 'tts', label: '🔊 语音合成（小暖开口说话）', desc: '本地浏览器合成，不联网、零上报，纯设备内完成。', def: true },
    { key: 'asr', label: '🎤 语音输入（麦克风）', desc: '仅本地听写，音频与转写绝不留存、绝不外发。', def: true },
    { key: 'ltm', label: '🧠 长期记忆', desc: '记忆只存在你手机里，绝不传上云端。', def: true },
    { key: 'cloudSync', label: '☁️ 云同步（唯一外发通道）', desc: '开启后记忆会先在本机加密，再上传云端备份。这是小暖唯一会对外发送数据的通道。', def: false, external: true },
  ];

  /**
   * ConsentUI —— 精细同意开关控制器。
   * @constructor
   */
  function ConsentUI() {}

  /** 单例 */
  ConsentUI.getInstance = function () {
    if (!ConsentUI._inst) ConsentUI._inst = new ConsentUI();
    return ConsentUI._inst;
  };

  /** 取得 ConsentStore 单例（容错） */
  ConsentUI.prototype._store = function () {
    try {
      if (G.ConsentStore && typeof G.ConsentStore.getInstance === 'function') return G.ConsentStore.getInstance();
    } catch (e) {}
    return null;
  };

  /**
   * 渲染全部同意开关到容器。
   * @param {HTMLElement} container
   */
  ConsentUI.prototype.render = function (container) {
    if (!container) return;
    var self = this;
    var store = self._store();
    container.innerHTML = '';

    ITEMS.forEach(function (it) {
      var granted = store ? store.get(it.key) : it.def;

      var row = document.createElement('div');
      row.className = 'xn-consent-row';
      row.setAttribute('data-key', it.key);

      // 左侧：标题 + 说明
      var info = document.createElement('div');
      info.className = 'xn-consent-info';
      var title = document.createElement('div');
      title.className = 'xn-consent-title';
      title.textContent = it.label;
      var sub = document.createElement('div');
      sub.className = 'xn-consent-desc';
      sub.textContent = it.desc;
      info.appendChild(title);
      info.appendChild(sub);

      // 右侧：徽标（仅 external 通道）+ 开关
      var right = document.createElement('div');
      right.className = 'xn-consent-right';

      if (it.external) {
        var badge = document.createElement('span');
        badge.className = 'xn-consent-badge';
        badge.textContent = '已授权外发';
        badge.style.display = granted ? '' : 'none';
        right.appendChild(badge);
      }

      var sw = document.createElement('label');
      sw.className = 'xn-consent-switch';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'xn-consent-check';
      input.setAttribute('data-key', it.key);
      input.checked = !!granted;
      var slider = document.createElement('span');
      slider.className = 'xn-consent-slider';
      sw.appendChild(input);
      sw.appendChild(slider);
      right.appendChild(sw);

      row.appendChild(info);
      row.appendChild(right);
      container.appendChild(row);

      // 绑定单个开关
      self.bindSwitch(it.key, input);
    });
  };

  /**
   * 绑定单个开关元素。
   * cloudSync 开启走「二次确认」门控：先还原勾选，弹窗确认后才写入 ConsentStore。
   * @param {string} key
   * @param {HTMLInputElement} el
   */
  ConsentUI.prototype.bindSwitch = function (key, el) {
    if (!el) return;
    var self = this;
    el.addEventListener('change', function () {
      var checked = el.checked;
      if (key === 'cloudSync' && checked) {
        // 二次确认门控：还原勾选，待用户确认后再落盘
        el.checked = false;
        self._confirmCloudSync(function (ok) {
          var st = self._store();
          var row = el.closest ? el.closest('.xn-consent-row') : null;
          var badge = row ? row.querySelector('.xn-consent-badge') : null;
          if (ok) {
            if (st) st.set('cloudSync', true);
            el.checked = true;
            if (badge) badge.style.display = '';
          } else {
            if (st) st.set('cloudSync', false);
            el.checked = false;
            if (badge) badge.style.display = 'none';
          }
        });
      } else {
        var st = self._store();
        if (st) st.set(key, checked);
        if (key === 'cloudSync') {
          var row = el.closest ? el.closest('.xn-consent-row') : null;
          var badge = row ? row.querySelector('.xn-consent-badge') : null;
          if (badge) badge.style.display = checked ? '' : 'none';
        }
      }
    });
  };

  /**
   * 云同步开启的二次确认弹窗。
   * @param {function(boolean):void} cb
   */
  ConsentUI.prototype._confirmCloudSync = function (cb) {
    var mask = document.createElement('div');
    mask.className = 'xn-modal-mask';
    var panel = document.createElement('div');
    panel.className = 'xn-modal-panel';
    panel.innerHTML =
      '<div class="xn-modal-title">☁️ 开启云同步（已授权外发）</div>' +
      '<p class="xn-modal-text">这是小暖<b>唯一会对外发送数据</b>的通道。开启后，你的记忆会先在你的设备里加密，再上传到云端备份。<br>' +
      '小暖默认不开启它——只有你点「同意并开启」，她才会发送。确定要开启吗？</p>' +
      '<div class="xn-modal-actions">' +
      '  <button class="xn-btn xn-btn-primary" data-act="ok">同意并开启</button>' +
      '  <button class="xn-btn xn-btn-danger" data-act="cancel">暂不开启</button>' +
      '</div>';
    mask.appendChild(panel);
    document.body.appendChild(mask);

    function close(result) {
      try { document.body.removeChild(mask); } catch (e) {}
      if (typeof cb === 'function') cb(result);
    }
    panel.querySelector('[data-act="ok"]').addEventListener('click', function () { close(true); });
    panel.querySelector('[data-act="cancel"]').addEventListener('click', function () { close(false); });
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(false); });
  };

  // 对外门面
  G.ConsentUI = ConsentUI;
})();
