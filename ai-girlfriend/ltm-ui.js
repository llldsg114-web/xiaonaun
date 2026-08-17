/**
 * ltm-ui.js —— 心屿 · 长期记忆 视图层（挂 window.LTMUI）。
 * 职责：① 记忆管理页（T4）② 对话唤起 UI（T5）。仅依赖 window.LTM，不碰 app.js/engine.js。
 * 所有调用包 try/catch 降级安全，绝不阻塞主对话。小暖(Xiaonuan) 固定人名不更名。
 * @author 寇豆码（Kou）· 心屿团队
 */
(function (root) {
  'use strict';

  var LTM_MAX = 200;            // 单 subject 上限，对齐 longterm-memory.js
  var CONSENT_KEY = 'xinyu_ltm_consent'; // 首次开启隐私同意标记
  var TYPE_META = { fact: { label: '事实', icon: '📌' }, preference: { label: '偏好', icon: '💗' }, agreement: { label: '约定', icon: '🤝' } };
  var FILTERS = [{ key: 'all', label: '全部' }, { key: 'fact', label: '事实' }, { key: 'preference', label: '偏好' }, { key: 'agreement', label: '约定' }];

  var STATE = { subject: null, currentFilter: 'all', container: null, lastSidenote: null };

  /* 基础工具 */
  function ltm() { try { return (root.LTM && typeof root.LTM.list === 'function') ? root.LTM : null; } catch (e) { return null; } }
  function lsGet(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) {} }
  function el(tag, cls, text) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtTime(ts) {
    if (!ts) return '—';
    try { var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
    catch (e) { return '—'; }
  }
  function shortSession(s) { return s && s.indexOf('_') >= 0 ? s.slice(s.indexOf('_') + 1) : (s || '未知'); }
  function toast(msg) {
    try {
      var t = root.document.getElementById('ltm-toast');
      if (!t) { t = el('div', 'ltm-toast'); t.id = 'ltm-toast'; root.document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('show');
      root.clearTimeout(t._timer); t._timer = root.setTimeout(function () { t.classList.remove('show'); }, 1800);
    } catch (e) {}
  }
  function callLtm(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try { var L = ltm(); if (!L || typeof L[method] !== 'function') return Promise.reject(new Error('LTM 未就绪'));
      return Promise.resolve(L[method].apply(L, args)); } catch (e) { return Promise.reject(e); }
  }
  function resolveSubject() {
    if (STATE.subject) return STATE.subject;
    try { if (root.__xinyuSubject) return String(root.__xinyuSubject); } catch (e) {}
    return lsGet('xinyu_device_id') || 'default';
  }
  function setSubject(s) { if (s) STATE.subject = String(s); }

  /* 一、记忆管理页（T4） */

  /** 渲染记忆管理页到容器。container=#ltm-manage-body；subject 可选覆盖。 */
  function renderManagePage(container, subject) {
    try {
      if (!container) return;
      if (subject) STATE.subject = String(subject);
      STATE.container = container;
      container.innerHTML = ''; container.className = 'ltm-body';

      var head = el('div', 'ltm-header');
      head.appendChild(el('div', 'ltm-title', '心屿 · 我的长期记忆'));
      var toggle = el('label', 'ltm-toggle');
      var tInput = el('input'); tInput.type = 'checkbox'; tInput.id = 'ltm-switch';
      toggle.appendChild(tInput); toggle.appendChild(el('span', 'ltm-toggle-slider')); toggle.appendChild(el('span', 'ltm-toggle-text', '长期记忆'));
      head.appendChild(toggle); container.appendChild(head);

      var cap = el('div', 'ltm-capacity');
      var capBar = el('div', 'ltm-cap-bar');
      var capFill = el('div', 'ltm-cap-fill'); capFill.id = 'ltm-cap-fill'; capBar.appendChild(capFill);
      var capText = el('div', 'ltm-cap-text', '0 / ' + LTM_MAX + ' 条'); capText.id = 'ltm-cap-text';
      cap.appendChild(capBar); cap.appendChild(capText); container.appendChild(cap);

      var filterBar = el('div', 'ltm-filters'); filterBar.id = 'ltm-filters';
      FILTERS.forEach(function (f) {
        var chip = el('button', 'ltm-chip' + (f.key === STATE.currentFilter ? ' active' : ''), f.label);
        chip.dataset.filter = f.key;
        chip.addEventListener('click', function () { STATE.currentFilter = f.key; refreshFilterUI(filterBar); loadList(); });
        filterBar.appendChild(chip);
      });
      container.appendChild(filterBar);

      var list = el('div', 'ltm-list'); list.id = 'ltm-list'; container.appendChild(list);

      var danger = el('div', 'ltm-danger');
      var clearSubj = el('button', 'me-save danger', '清除当前分组记忆');
      clearSubj.addEventListener('click', function () { confirmWipe('subject'); });
      var clearAll = el('button', 'me-save danger', '彻底清除全部记忆');
      clearAll.addEventListener('click', function () { confirmWipe('all'); });
      danger.appendChild(clearSubj); danger.appendChild(clearAll); container.appendChild(danger);

      bindToggle();
      initPage(); // 依据 LTM.isEnabled() 设定开关 + 列表显隐/停用提示
      if (!lsGet(CONSENT_KEY)) maybeShowConsent(); // 首次进入先告知隐私边界（关闭后停在正确的停用态）
    } catch (e) {
      try { if (container) { container.innerHTML = ''; container.appendChild(el('div', 'ltm-empty', '记忆页面暂时打不开，不影响和小暖聊天～')); } } catch (e2) {}
    }
  }

  function initPage() {
    try { var on = !!(ltm() && ltm().isEnabled()); var input = root.document.getElementById('ltm-switch'); if (input) input.checked = on; applyEnabledUI(on); }
    catch (e) { applyEnabledUI(false); }
  }

  function applyEnabledUI(on) {
    try {
      var list = root.document.getElementById('ltm-list');
      var danger = root.document.querySelector('.ltm-danger');
      var filters = root.document.getElementById('ltm-filters');
      var cap = root.document.querySelector('.ltm-capacity');
      var head = root.document.querySelector('.ltm-header');
      var tip = root.document.getElementById('ltm-off-tip');
      if (on) {
        if (list) list.classList.remove('hidden');
        if (danger) danger.classList.remove('hidden');
        if (filters) filters.classList.remove('hidden');
        if (cap) cap.classList.remove('hidden');
        if (tip) tip.remove();
        loadList();
      } else {
        if (list) list.classList.add('hidden');
        if (danger) danger.classList.add('hidden');
        if (filters) filters.classList.add('hidden');
        if (cap) cap.classList.add('hidden');
        if (head && !tip) { var t = el('div', 'ltm-off-tip', '长期记忆已停用'); t.id = 'ltm-off-tip'; head.appendChild(t); }
      }
    } catch (e) {}
  }

  function refreshFilterUI(bar) {
    try { var chips = bar.querySelectorAll('.ltm-chip'); for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i].dataset.filter === STATE.currentFilter); } catch (e) {}
  }

  function loadList() {
    var list = root.document.getElementById('ltm-list');
    if (!list) return;
    try {
      callLtm('list', resolveSubject()).then(function (all) {
        var items = Array.isArray(all) ? all : [];
        updateCapacity(items.length);
        var shown = STATE.currentFilter === 'all' ? items : items.filter(function (it) { return it && it.type === STATE.currentFilter; });
        renderList(shown);
      }).catch(function () { list.innerHTML = ''; list.appendChild(el('div', 'ltm-empty', '读取记忆失败，稍后再试～')); });
    } catch (e) { list.innerHTML = ''; list.appendChild(el('div', 'ltm-empty', '读取记忆失败，稍后再试～')); }
  }

  function updateCapacity(count) {
    try {
      var fill = root.document.getElementById('ltm-cap-fill');
      var text = root.document.getElementById('ltm-cap-text');
      if (fill) fill.style.width = Math.min(100, Math.round((count / LTM_MAX) * 100)) + '%';
      if (text) text.textContent = count + ' / ' + LTM_MAX + ' 条';
    } catch (e) {}
  }

  function renderList(items) {
    var list = root.document.getElementById('ltm-list');
    if (!list) return;
    list.innerHTML = '';
    if (!items || !items.length) { list.appendChild(el('div', 'ltm-empty', '还没有长期记忆～ 和小暖多聊聊天，她会慢慢记住你 💕')); return; }
    items.forEach(function (it) { list.appendChild(buildItem(it)); });
  }

  function buildItem(it) {
    var meta = TYPE_META[it.type] || { label: '记忆', icon: '💡' };
    var row = el('div', 'ltm-item'); row.dataset.id = it.id;
    row.appendChild(el('div', 'ltm-item-icon', meta.icon));
    var body = el('div', 'ltm-item-body');
    body.appendChild(el('div', 'ltm-item-content', it.content || ''));
    body.appendChild(el('div', 'ltm-item-meta', meta.label + ' · 来源 ' + shortSession(it.source_session) + ' · ' + fmtTime(it.created_at)));
    var actions = el('div', 'ltm-item-actions');
    var bView = el('button', 'ltm-link', '查看'), bEdit = el('button', 'ltm-link', '编辑'), bDel = el('button', 'ltm-link danger', '删除');
    actions.appendChild(bView); actions.appendChild(bEdit); actions.appendChild(bDel); body.appendChild(actions);
    var detail = el('div', 'ltm-item-detail hidden'); body.appendChild(detail);
    row.appendChild(body);
    bView.addEventListener('click', function () { toggleDetail(row, it, detail, 'view'); });
    bEdit.addEventListener('click', function () { toggleDetail(row, it, detail, 'edit'); });
    bDel.addEventListener('click', function () { inlineConfirmDelete(row, it); });
    return row;
  }

  function toggleDetail(row, it, detail, mode) {
    try {
      if (!detail.classList.contains('hidden') && detail.dataset.mode === mode) { detail.classList.add('hidden'); detail.innerHTML = ''; return; }
      detail.dataset.mode = mode; detail.innerHTML = '';
      if (mode === 'view') {
        var block = el('div', 'ltm-detail-block');
        block.appendChild(el('div', 'ltm-detail-row', '内容：' + (it.content || '')));
        block.appendChild(el('div', 'ltm-detail-row', '标签：' + (Array.isArray(it.tags) && it.tags.length ? it.tags.join('、') : '无')));
        block.appendChild(el('div', 'ltm-detail-row', '来源会话：' + (it.source_session || '未知')));
        block.appendChild(el('div', 'ltm-detail-row', '创建：' + fmtTime(it.created_at)));
        block.appendChild(el('div', 'ltm-detail-row', '更新：' + fmtTime(it.updated_at)));
        detail.appendChild(block);
      } else {
        var ta = el('textarea', 'ltm-edit'); ta.value = it.content || '';
        var save = el('button', 'me-save', '保存'), cancel = el('button', 'ltm-link', '取消');
        save.addEventListener('click', function () { var v = ta.value.trim(); if (!v) { toast('内容不能为空'); return; } updateItem(it.id, v); });
        cancel.addEventListener('click', function () { detail.classList.add('hidden'); detail.innerHTML = ''; });
        detail.appendChild(ta);
        var btns = el('div', 'ltm-edit-btns'); btns.appendChild(save); btns.appendChild(cancel); detail.appendChild(btns);
      }
      detail.classList.remove('hidden');
    } catch (e) {}
  }

  function updateItem(id, content) {
    callLtm('update', id, content).then(function () { toast('已保存'); loadList(); }).catch(function () { toast('保存失败，请稍后再试'); });
  }

  function inlineConfirmDelete(row, it) {
    try {
      if (row.querySelector('.ltm-inline-confirm')) return;
      var box = el('div', 'ltm-inline-confirm');
      box.appendChild(el('span', 'ltm-inline-text', '删除这条？'));
      var cancel = el('button', 'ltm-link', '取消'), ok = el('button', 'ltm-link danger', '删除');
      cancel.addEventListener('click', function () { box.remove(); });
      ok.addEventListener('click', function () {
        callLtm('remove', it.id).then(function () {
          if (row && row.parentNode) row.parentNode.removeChild(row);
          var t = root.document.getElementById('ltm-cap-text');
          if (t) { var m = /(\d+)\s*\/\s*\d+/.exec(t.textContent); if (m) updateCapacity(Math.max(0, parseInt(m[1], 10) - 1)); }
          toast('已删除');
        }).catch(function () { toast('删除失败'); box.remove(); });
      });
      box.appendChild(cancel); box.appendChild(ok); row.appendChild(box);
    } catch (e) {}
  }

  /* 二、总开关 / 筛选 / 清除 绑定（幂等） */

  function bindToggle() {
    try {
      var input = root.document.getElementById('ltm-switch');
      if (!input || input.dataset.bound) return;
      input.dataset.bound = '1';
      input.addEventListener('change', function () {
        var wantOn = input.checked;
        if (wantOn && !lsGet(CONSENT_KEY)) {
          input.checked = false;
          maybeShowConsent(function () { try { if (ltm()) ltm().setEnabled(true); input.checked = true; applyEnabledUI(true); } catch (e) { applyEnabledUI(false); } });
          return;
        }
        try { if (ltm()) ltm().setEnabled(wantOn); applyEnabledUI(wantOn); }
        catch (e) { applyEnabledUI(!wantOn); input.checked = !wantOn; }
      });
    } catch (e) {}
  }

  /* 三、二次确认弹窗 */

  function confirmWipe(scope) {
    try {
      var isAll = scope === 'all';
      openModal(
        isAll ? '彻底清除全部记忆' : '清除当前分组记忆',
        isAll ? '将删除全部长期记忆且不可恢复，确定吗？' : '将删除当前分组的全部长期记忆且不可恢复，确定吗？',
        '确认清除',
        function () {
          var p = isAll ? callLtm('clearAll') : callLtm('clearSubject', resolveSubject());
          Promise.resolve(p).then(function () { toast(isAll ? '已全部清除' : '当前分组已清除'); if (STATE.container) loadList(); }).catch(function () { toast('清除失败，请稍后再试'); });
        }
      );
    } catch (e) {}
  }

  function openModal(title, desc, okText, onOk) {
    try {
      closeModal();
      var overlay = el('div', 'ltm-modal'); overlay.id = 'ltm-modal';
      var panel = el('div', 'ltm-modal-panel');
      panel.appendChild(el('div', 'ltm-modal-title', title));
      panel.appendChild(el('div', 'ltm-modal-desc', desc));
      var btns = el('div', 'ltm-modal-btns');
      var cancel = el('button', 'me-save', '取消'); cancel.style.background = 'linear-gradient(135deg,#b0a0aa,#8d7a84)';
      var ok = el('button', 'me-save danger', okText || '确认');
      cancel.addEventListener('click', closeModal);
      ok.addEventListener('click', function () { closeModal(); try { onOk && onOk(); } catch (e) {} });
      btns.appendChild(cancel); btns.appendChild(ok); panel.appendChild(btns);
      overlay.appendChild(panel); root.document.body.appendChild(overlay);
    } catch (e) {}
  }
  function closeModal() { try { var m = root.document.getElementById('ltm-modal'); if (m && m.parentNode) m.parentNode.removeChild(m); } catch (e) {} }

  /* 四、首次开启隐私同意 */

  function maybeShowConsent(onAgree) {
    try {
      if (lsGet(CONSENT_KEY)) { try { onAgree && onAgree(); } catch (e) {} return; }
      var overlay = el('div', 'ltm-modal'); overlay.id = 'ltm-modal';
      var panel = el('div', 'ltm-modal-panel');
      panel.appendChild(el('div', 'ltm-modal-title', '关于「长期记忆」'));
      var desc = el('div', 'ltm-modal-desc');
      desc.appendChild(el('p', null, '小暖会把你们聊到的「事实、偏好、约定」记在「你这台设备本地」，只用来更好地陪你。'));
      desc.appendChild(el('p', null, '✅ 100% 本地存储，零上报、零训练；随时可在「我的长期记忆」里查看或彻底清除。'));
      desc.appendChild(el('p', 'ltm-priv-hard', '🚫 绝不记录：密码 / 支付 / 身份核验 / 短信验证码等硬隐私。'));
      desc.appendChild(el('p', 'ltm-priv-soft', '⚠️ 默认不记：手机号 / 邮箱 / 住址等（软隐私）。'));
      panel.appendChild(desc);
      var btns = el('div', 'ltm-modal-btns');
      var cancel = el('button', 'me-save', '暂不开启'); cancel.style.background = 'linear-gradient(135deg,#b0a0aa,#8d7a84)';
      var ok = el('button', 'me-save danger', '我同意，开启');
      cancel.addEventListener('click', closeModal);
      ok.addEventListener('click', function () {
        try {
          lsSet(CONSENT_KEY, '1');
          if (ltm()) ltm().setEnabled(true);
          closeModal();
          var input = root.document.getElementById('ltm-switch');
          if (input) input.checked = true;
          applyEnabledUI(true);
          try { onAgree && onAgree(); } catch (e) {}
        } catch (e) { closeModal(); }
      });
      btns.appendChild(cancel); btns.appendChild(ok); panel.appendChild(btns);
      overlay.appendChild(panel); root.document.body.appendChild(overlay);
    } catch (e) {}
  }

  /* 五、对话唤起 UI（T5） */

  /** 渲染「小暖唤起记忆」提示：自然气泡 + 右下角「⌐ 记忆」角标（可展开侧注）。 */
  function renderRecallBubble(items, anchor) {
    try {
      if (!items || !items.length) return;
      var target = anchor || root.document.getElementById('chat-body');
      if (!target) return;
      var wrap = el('div', 'ltm-bubble');
      var n = items.length;
      wrap.appendChild(el('div', 'ltm-bubble-text', n === 1 ? '刚才聊的，我记得哦～' : '刚才聊的，我都记在心里啦（' + n + ' 件）～'));
      var badge = el('button', 'ltm-corner-inline', '⌐ 记忆'); wrap.appendChild(badge);
      var note = el('div', 'ltm-sidenote hidden'); note.id = 'ltm-sidenote';
      items.slice(0, 6).forEach(function (it) {
        var meta = TYPE_META[it.type] || { icon: '💡' };
        var line = el('div', 'ltm-sidenote-item');
        line.appendChild(el('span', 'ltm-sidenote-icon', meta.icon));
        var txt = el('span', 'ltm-sidenote-text');
        txt.appendChild(el('span', 'ltm-sidenote-content', it.content || ''));
        txt.appendChild(el('span', 'ltm-sidenote-meta', '· 来源 ' + shortSession(it.source_session) + ' · ' + fmtTime(it.created_at)));
        line.appendChild(txt); note.appendChild(line);
      });
      wrap.appendChild(note);
      badge.addEventListener('click', function (e) { e.stopPropagation(); note.classList.toggle('hidden'); });
      root.setTimeout(function () { root.document.addEventListener('click', function () { note.classList.add('hidden'); }, { once: true }); }, 0);
      target.appendChild(wrap);
      renderCornerBadge(n);
      STATE.lastSidenote = note;
    } catch (e) {}
  }

  /** 更新角标数字（独立入口，供 app.js 刷新 #ltm-corner）。 */
  function renderCornerBadge(count) {
    try {
      var badge = root.document.getElementById('ltm-corner');
      if (!badge) return;
      if (count > 0) {
        badge.textContent = '⌐ 记忆 · ' + count; badge.classList.remove('hidden');
        badge.onclick = function () { if (STATE.lastSidenote) STATE.lastSidenote.classList.toggle('hidden'); };
      } else { badge.classList.add('hidden'); }
    } catch (e) {}
  }

  /* 对外暴露 LTMUI 门面 */
  root.LTMUI = {
    renderManagePage: renderManagePage,
    renderRecallBubble: renderRecallBubble,
    renderCornerBadge: renderCornerBadge,
    bindToggle: bindToggle,
    confirmWipe: confirmWipe,
    maybeShowConsent: maybeShowConsent,
    setSubject: setSubject,
    _resolveSubject: resolveSubject
  };
})(typeof window !== 'undefined' ? window : this);
