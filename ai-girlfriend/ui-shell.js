/**
 * ui-shell.js · 心屿 候选 D（UI 多界面布局重构）· 统一导航壳
 * 挂 window.UiShell，IIFE，**零依赖零外发**：全文件不含任何网络 API、不含任何模块导入语句，
 * 只碰 DOM 与 localStorage。可用 /网络外发字面/ 正则对本文件做静态扫描，结果恒为 0 命中。
 *
 * ── 本文件只做四件事，多一件都不做 ────────────────────────────────────────────
 *   ① 搭壳：#shell-topbar / #shell-sidebar 骨架已由 index.html **声明式**提供，
 *          本文件只往里填内容 + 渲染 6 个侧栏导航项。
 *   ② 搬家：把既有**全局态** DOM 节点（#nav-offline-led / 头像 / 名称 / 状态 / 心情 /
 *          📞 🔊 🔍 / ⚙）用 appendChild/insertBefore **移动**进壳层 —— 移动而非重建，
 *          故 OfflineIndicator 单例、已绑监听器、外部持有的元素引用**全部继续有效**（INV-3）。
 *   ③ 转发：壳层导航点击经 document 级**事件委托**（ADR-4）转发给 .tabbar 原生节点的 .click()，
 *          复用 app.js 既有 bindTabs()。壳层**不自造**任何切屏逻辑（INV-1 / 契约 C3）。
 *   ④ 挂钩：进入 #page-privacy 时对**唯一** root 调 PrivacyAudit 渲染（PRD R1 / INV-2）。
 *
 * ── 硬约束（违反即回到架构文档重新裁决，不得就地打补丁）─────────────────────────
 *   · app.js **零改动**（架构 §4.2）：切屏真源恒为 bindTabs()，本文件只转发。
 *   · 冻结四文件（engine.js / sw.js / memory.js / test/baseline.js）**零触碰**。
 *   · 零上报（铁律 2）：全文件无任何网络 API；只读 localStorage 记住上次所在屏。
 *   · 小暖不更名（铁律 1）：所有角色名出现处一律用 data-xn / data-xn-prefix 占位（INV-8），
 *     由 app.js 的 applyCharIdentity() 统一改写，本文件不硬编码任何角色名到最终文案。
 *   · z-index 一律 < 30（INV-9）：顶栏 5 / 侧栏 6，绝不遮挡 .search-panel(30) 及以上浮层。
 *   · 绝不调用 OfflineProbe.start()（ADR-7 / NEW-6）：app.js:4536 已 start(30000)，
 *     二次 start 会让探测频率翻倍。本文件只 onChange + getState **只读订阅**。
 *   · 绝不调用 OfflineIndicator.mount() 第二次（INV-3）：侧栏底部只是一段订阅同源数据的**文字镜像**，
 *     不是第二个指示灯实例；#nav-offline-led 全文档恒为 1。
 *
 * ── 两阶段提交（R12：绝不出现「弹窗已拆、屏未建成」）────────────────────────────
 *   P1 纯增量、全可逆：建壳 / 校验 / 搬家 / ⚙ 换绑 / 侧栏 / 委托 / 路由 / 钩子。
 *      任一步抛异常 → rollback()：把搬走的节点原位放回、移除自建节点、解绑全部监听器，
 *      退回既有单屏形态。.page / .page.active 显隐机制完全不依赖壳层 ⇒ **绝不白屏**。
 *   P2 唯一破坏性步骤、仅在 P1 全绿后执行：退役弹窗渲染宿主 #privacy-audit-body
 *      （改 id + data-xn-deprecated + 清空），保证全文档 #xn-* id 唯一。
 *
 * @see docs/DESIGN-xinyu-v3-ui.md      （PRD：§3.5 LED 落位 / §3.6 ⚙ 落位 / §4.5 去模态化 / §4.6 语音与本地模型）
 * @see docs/DESIGN-xinyu-v3-ui-arch.md （架构：§4.3 data-page 契约 / §4.4 屏注册表 / §6.2 时序 / §6.5 降级 / ADR-1~7）
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);
  if (!G || typeof document === 'undefined') return;

  var VERSION = 'd1';
  var LS_LAST = 'xinyu.ui.lastScreen';   // 仅本地：记住上次所在屏，绝不外发

  /* ══════════════════════════════════════════════════════════════════════════
   * 1 · 屏注册表（SCREENS）—— 壳层内**唯一**的屏真源定义（架构 §4.4）
   *
   *   · `page` 取自既有 data-page 契约，**不得自造**、**不得新增第 7 项**（契约 C1 / C4）。
   *   · `ltm-manage` 的 data-page 与容器 id 一律不改名（契约 C5：改名要动 app.js:2992 特判），
   *     对外用 hash 别名 `#/memory` 消化命名不一致；`me` 同理用 `#/settings`。
   *   · `xnName: true` 表示该项标题/标签是角色名 ⇒ 必须用 data-xn="name" 占位（INV-8）。
   * ════════════════════════════════════════════════════════════════════════ */
  var SCREENS = [
    { page: 'chat',       id: 'page-chat',   icon: '💬', label: '对话', hash: 'chat',     ctx: true },
    { page: 'her',        id: 'page-her',    icon: '👧', label: '',     hash: 'her',      xnName: true },
    { page: 'story',      id: 'page-story',  icon: '📖', label: '故事', hash: 'story' },
    { page: 'ltm-manage', id: 'ltm-manage',  icon: '🧠', label: '记忆', hash: 'memory' },
    { page: 'privacy',    id: 'page-privacy',icon: '🔒', label: '隐私', hash: 'privacy' },
    { page: 'me',         id: 'page-me',     icon: '⚙️', label: '设置', hash: 'settings' }
  ];

  var BY_PAGE = {};
  var BY_HASH = {};
  (function indexScreens() {
    for (var i = 0; i < SCREENS.length; i++) {
      var s = SCREENS[i];
      BY_PAGE[s.page] = s;
      BY_HASH[s.hash] = s;      // 别名优先：memory / settings
      BY_HASH[s.page] = s;      // 原名兜底：ltm-manage / me 也能直达
    }
  })();

  /* 离线三态的**文字**镜像文案（PRD §3.5）。offline 态含角色名 ⇒ 走 data-xn-prefix 占位。 */
  var NET_TEXT = {
    online:   { plain: '在线' },
    degraded: { plain: '网络不佳' },
    offline:  { prefix: '离线 · ', suffix: '仍在你手机里' }
  };

  /* ══════════════════════════════════════════════════════════════════════════
   * 2 · 状态与回滚账本
   *
   *   state.current **不是真源** —— 真源永远是 DOM 上的 .page.active / .tab.active。
   *   它只是镜像缓存，供标题 / data-screen / hash 同步用，避免「双真源不一致」缺陷。
   * ════════════════════════════════════════════════════════════════════════ */
  var state = {
    current: null,
    prev: null,
    screens: SCREENS.map(function (s) { return s.page; }),
    mounted: false,
    warnings: []
  };

  var moved = [];        // 搬家账本：{ node, parent, next } —— rollback 按原位放回
  var created = [];      // 自建节点账本：rollback 直接 remove
  var gearSwap = null;   // ⚙ 换绑账本：{ fresh, old, parent, next }
  var retired = null;    // P2 退役账本：{ node, oldId, html }
  var unsubProbe = null; // OfflineProbe 只读订阅的取消函数
  var docClickRef = null;
  var hashRef = null;
  var suppressHash = false;  // 防「写 hash → 触发 hashchange → 再切屏」自激环

  function warn(code, detail) {
    try { state.warnings.push(detail ? (code + ': ' + detail) : code); } catch (e) {}
  }

  /* ── 极简 DOM 工具（全部原生，零依赖、全程 try/catch 不外抛）───────────────── */
  function q(sel, root) {
    try { return (root || document).querySelector(sel); } catch (e) { return null; }
  }
  function qa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; }
  }
  function byId(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }
  function mk(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /**
   * 读取当前角色名（铁律 1：不硬编码）。
   * 优先读 app.js 的 applyCharIdentity() 已改写过的 [data-xn="name"] 节点，
   * 全都读不到时才退回字面「小暖」—— 这是产品默认角色名，不是改名。
   */
  function currentName() {
    var el = q('[data-xn="name"]');
    var t = el && el.textContent ? el.textContent.trim() : '';
    return t || '小暖';
  }

  /**
   * 把节点**移动**进 host（记账以便回滚）。
   * 关键：appendChild / insertBefore 移动节点会保留其事件监听与外部引用 ⇒
   * app.js 持有的 __led 实例、onChange 闭包、id 选择器全部继续有效（INV-3）。
   */
  function moveInto(node, host, prepend) {
    if (!node || !host || node === host) return false;
    try {
      moved.push({ node: node, parent: node.parentNode, next: node.nextSibling });
      if (prepend && host.firstChild) host.insertBefore(node, host.firstChild);
      else host.appendChild(node);
      return true;
    } catch (e) {
      warn('MOVE_FAIL', node.id || node.className);
      return false;
    }
  }

  /** 在 .tabbar 内按 data-page 找原生 tab —— 逐个比对 dataset，不拼选择器字符串（免注入）。 */
  function nativeTab(page) {
    var tabs = qa('.tabbar .tab[data-page]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-page') === page) return tabs[i];
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 3 · P1-2 · 前置校验（廉价、且**早于**任何破坏性操作）
   *
   *   ADR-2 让 #page-privacy 由 index.html 声明式提供，正是为了让这步能在
   *   「搬家 / 退役弹窗」之前一次性判死：屏不存在就干脆不挂载，保持既有 4+1 Tab + 弹窗形态。
   * ════════════════════════════════════════════════════════════════════════ */
  function preflight() {
    var topbar = byId('shell-topbar');
    var sidebar = byId('shell-sidebar');
    var nav = byId('shell-nav');
    var privacy = byId('page-privacy');
    var host = byId('privacy-audit-body-page');
    if (!topbar || !sidebar || !nav) return { ok: false, why: '壳层骨架缺失（index.html 未更新）' };
    if (!byId('shell-lead') || !byId('shell-ctx-actions') || !byId('shell-tail')) {
      return { ok: false, why: '顶栏契约容器缺失（shell-lead / shell-ctx-actions / shell-tail）' };
    }
    if (!privacy) return { ok: false, why: '#page-privacy 不存在（index.html 未更新）' };
    if (!host) return { ok: false, why: '#privacy-audit-body-page 不存在（唯一渲染宿主缺失）' };
    if (!q('.tabbar')) return { ok: false, why: '.tabbar 不存在（无转发落点，切屏真源不可达）' };
    return { ok: true, topbar: topbar, sidebar: sidebar, nav: nav, host: host };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 4 · P1-3 · 搬家：把全局态节点迁入顶栏（移动，不重建）
   *
   *   为什么这些节点是「全局态」而非「对话屏局部」：
   *     · #nav-offline-led  网络三态 —— 任何屏都该看得见（F8：切屏后指示灯消失）
   *     · 头像/名称/#nav-status 角色在线态 —— 跨屏的「她在」感知
   *     · #nav-mood 今日心情 / 📞 🔊 🔍 —— 对话上下文操作，随 data-screen 由 CSS 决定可见性
   *   迁移后 app.js 的 querySelector("#nav-offline-led")、refreshNavStatus() 的 #nav-status、
   *   renderAvatarAll() 的 #nav-avatar 全是**无根 id 查询** ⇒ 换了父节点照样命中。
   * ════════════════════════════════════════════════════════════════════════ */
  function adoptGlobals(ui) {
    var lead = byId('shell-lead');
    var ctx = byId('shell-ctx-actions');
    var chatNav = q('#page-chat .nav');

    /* LED 放最左（PRD §3.5 线框）。不存在则跳过：app.js:4530 已有 `|| #page-chat .nav` 兜底，不会抛错。 */
    var led = byId('nav-offline-led');
    if (led) moveInto(led, lead); else warn('NO_LED', '#nav-offline-led 缺失，LED 留在原处');

    /* 头像 + 名称/状态：.nav-info 是「名称 + #nav-status」的既有包裹层，
     * 整体搬一次即同时搬走 .nav-name（含 data-xn="name" 占位）与 #nav-status —— 比逐个搬更少扰动。 */
    var avatar = byId('nav-avatar');
    if (avatar) moveInto(avatar, lead);
    var info = chatNav ? q('.nav-info', chatNav) : null;
    if (info) moveInto(info, lead);

    /* 上下文操作：心情 + 通话 + 朗读 + 搜索。仅对话屏可见（CSS 依 data-screen 判定，零 JS 测量）。 */
    var mood = byId('nav-mood');
    if (mood) moveInto(mood, ctx);
    var ids = ['btn-call', 'btn-tts', 'btn-search'];
    for (var i = 0; i < ids.length; i++) {
      var b = byId(ids[i]);
      if (b) moveInto(b, ctx); else warn('NO_CTX_BTN', ids[i]);
    }

    /* 对话屏原顶栏被搬空后只剩 padding + 粉色渐变 ⇒ 会残留一条空色带。
     * 打标记交给 CSS 收起（style.css 内 `#page-chat .nav[data-xn-migrated]{display:none}`），
     * 不写行内样式：rollback 只需删属性即可完全复原，零残留。 */
    if (chatNav) chatNav.setAttribute('data-xn-migrated', '1');
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 5 · P1-4 · ⚙ 换绑（ADR-5：cloneNode 断连，不做事件拦截）
   *
   *   app.js:4691 绑的 openPrivacyAudit 是模块内部闭包，壳层**拿不到函数引用**，
   *   无法 removeEventListener。cloneNode(true) 定义上**不复制监听器** ⇒ 彻底断连，
   *   旧监听器随旧节点被 GC，无残留可触发路径。
   *   原节点被 replaceWith 同时移除 ⇒ 克隆体继承 id="btn-privacy-audit" 也**不产生重复 id**。
   *   换绑后 ⚙ 从「开弹窗」变为「路由到隐私屏」：打上 tab + data-page + data-xn-nav 三件套，
   *   点击由 §6 的委托统一转发（不在此处 addEventListener，免得多一处可回滚对象）。
   * ════════════════════════════════════════════════════════════════════════ */
  function adoptGear() {
    var old = byId('btn-privacy-audit');
    if (!old) return false;
    var tail = byId('shell-tail');
    if (!tail) return false;
    try {
      var fresh = old.cloneNode(true);
      gearSwap = { fresh: fresh, old: old, parent: old.parentNode, next: old.nextSibling };
      old.replaceWith(fresh);
      /* 保留既有 .nav-audit（privacy-audit.css:138 的视觉），叠加契约要求的 .tab；
       * .tab 的 flex:1/column 由 style.css 的 `#shell-tail .tab` 就地中和。 */
      fresh.className = 'nav-audit tab shell-gear';
      fresh.setAttribute('data-page', 'privacy');
      fresh.setAttribute('data-xn-nav', 'shell');
      fresh.setAttribute('type', 'button');
      fresh.title = '隐私审计';
      tail.appendChild(fresh);
      return true;
    } catch (e) {
      gearSwap = null;
      warn('GEAR_SWAP_FAIL', e && e.message);
      return false;
    }
  }

  /**
   * ⚙ 由 app.js:4682 在 bindPrivacyAudit() 里**运行时创建**。本文件是最末 script、
   * 在 init() 之后执行，正常情况下节点已存在；仅为极端时序做有限次 rAF 重试（≤10）。
   * 按架构 §6.5：超时只**跳过该步并记录**，绝不因此中止整体挂载 ——
   * 隐私屏仍可由底部 Tab / 侧栏「🔒 隐私」进入，入口不丢。
   */
  function adoptGearWithRetry(tries, done) {
    if (adoptGear()) { done(true); return; }
    if (tries <= 0) {
      warn('NO_GEAR', '#btn-privacy-audit 未就绪，⚙ 迁移跳过（隐私屏仍可由导航进入）');
      done(false);
      return;
    }
    var raf = G.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    try { raf(function () { adoptGearWithRetry(tries - 1, done); }); }
    catch (e) { done(false); }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 6 · P1-5 · 侧栏 6 项导航 + 底部状态镜像
   *
   *   契约遵从（架构 §4.3）：
   *     C1 每项必须带 class="tab" + data-page="<P>"，<P> 取自 SCREENS，不自造；
   *     C2 每项必须额外带 data-xn-nav="shell"，供委托 handler 区分「壳层节点（要转发）」
   *        与「.tabbar 原生节点（已被 bindTabs 绑定）」；
   *     C3 不复制任何切屏逻辑；C4 不新增第 7 项。
   *   「小暖」项的标签用 data-xn="name" 占位（INV-8）并以当前名字**播种**——
   *   因为 applyCharIdentity() 在 init 期已跑完，本节点是之后创建的，需自行取一次当前值；
   *   占位属性保留则**下一次**性别切换/角色刷新时会被 app.js 自动改写，长期一致。
   * ════════════════════════════════════════════════════════════════════════ */
  function renderSidebar(nav) {
    var name = currentName();
    for (var i = 0; i < SCREENS.length; i++) {
      var s = SCREENS[i];
      var item = mk('button', 'tab shell-nav-item');
      item.type = 'button';
      item.setAttribute('data-page', s.page);
      item.setAttribute('data-xn-nav', 'shell');   // C2

      var ico = mk('span', 'shell-nav-ico');
      ico.textContent = s.icon;
      item.appendChild(ico);

      var lab = mk('span', 'shell-nav-label');
      if (s.xnName) { lab.setAttribute('data-xn', 'name'); lab.textContent = name; }
      else lab.textContent = s.label;
      item.appendChild(lab);

      /* 未读小红点镜像：#chat-dot 归 app.js 所有（bindTabs 会隐藏它），此处只做只读镜像，
       * 不反向写 #chat-dot，避免出现第二个未读态真源。 */
      if (s.page === 'chat') {
        var dot = mk('span', 'shell-nav-dot hidden');
        item.appendChild(dot);
      }
      nav.appendChild(item);
      created.push(item);
    }
    renderSideFoot();
  }

  /**
   * 侧栏底部：网络三态**文字**镜像 + 相识天数镜像（PRD §3.4 线框左下角）。
   * 桌面用户距屏幕更远、纯色点可读性不足，故补一份文字态。
   * ADR-7：只 onChange + getState **只读订阅**同一个 OfflineProbe，
   * 绝不 start()（会让探测频率翻倍）、绝不 mount() 第二个 OfflineIndicator 实例。
   */
  function renderSideFoot() {
    var foot = byId('shell-side-foot');
    if (!foot) return;

    var net = mk('div', 'shell-net');
    var dot = mk('span', 'shell-net-dot');
    var txt = mk('span', 'shell-net-txt');
    net.appendChild(dot);
    net.appendChild(txt);
    foot.appendChild(net);
    created.push(net);

    var days = mk('div', 'shell-days');
    foot.appendChild(days);
    created.push(days);

    function paint(st) {
      try {
        var key = NET_TEXT[st] ? st : 'online';
        dot.setAttribute('data-state', key);
        txt.textContent = '';
        var cfg = NET_TEXT[key];
        if (cfg.plain) { txt.textContent = cfg.plain; return; }
        /* offline 态含角色名 ⇒ 用 data-xn-prefix 占位（INV-8），applyCharIdentity() 会改写它 */
        var s1 = mk('span');
        s1.setAttribute('data-xn-prefix', cfg.prefix);
        s1.textContent = cfg.prefix + currentName();
        var s2 = mk('span');
        s2.textContent = ' ' + cfg.suffix;
        txt.appendChild(s1);
        txt.appendChild(s2);
      } catch (e) {}
    }

    try {
      var P = G.OfflineProbe;
      if (P && typeof P.getInstance === 'function') {
        var inst = P.getInstance();
        paint(typeof inst.getState === 'function' ? inst.getState() : 'online');
        if (typeof inst.onChange === 'function') unsubProbe = inst.onChange(paint);
      } else {
        paint('online');
      }
    } catch (e) { paint('online'); }

    syncDays();
  }

  /** 相识天数镜像：读 #her-days 文本。随每次切屏刷新，无需 MutationObserver / 定时器。 */
  function syncDays() {
    try {
      var src = byId('her-days');
      var dst = q('#shell-side-foot .shell-days');
      if (src && dst) dst.textContent = src.textContent || '';
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 7 · P1-6 · document 级事件委托与转发（ADR-4）
   *
   *   NEW-4 已证明 bindTabs()（app.js:4505）**必然**早于壳层创建的侧栏项与 clone 后的 ⚙
   *   ⇒ 这些节点身上没有 bindTabs 的直接监听器。解法不是「重新调 bindTabs」（要改 app.js），
   *   而是在 document 上挂**一个**冒泡阶段委托：
   *     · 壳层节点（data-xn-nav="shell"）→ 找 .tabbar 同 data-page 的原生节点 .click() 转发后**立即 return**；
   *     · 原生节点（含被转发产生的合成点击）→ 这是**唯一**的钩子执行点。
   *   于是：不切屏（×）、钩子跑两次（×）、无限转发（×，原生节点无 shell 标记）、
   *   与 bindTabs 时序竞态（×，委托与节点创建时机完全解耦）全部消解。
   *   钩子执行顺序也有保证：DOM 事件传播中**目标节点的监听器先于祖先** ⇒
   *   钩子运行时 .page.active 已由 bindTabs 切换完毕，可安全渲染隐私屏。
   * ════════════════════════════════════════════════════════════════════════ */
  function onDocClick(ev) {
    try {
      var t = ev && ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var el = t.closest('.tab[data-page]');
      if (!el) {
        if (t.closest('.search-hit')) resyncFromDom();   // 见 resyncFromDom() 注释
        return;
      }
      var page = el.getAttribute('data-page');
      if (el.getAttribute('data-xn-nav') === 'shell') {
        var peer = nativeTab(page);
        if (peer) peer.click();          // 复用 bindTabs()：INV-1 不破
        else warn('NO_PEER', page);
        return;                           // 立即返回：钩子只在原生节点分支跑一次
      }
      runShellHooks(page);
    } catch (e) { warn('DELEGATE_FAIL', e && e.message); }
  }

  /**
   * 全仓库唯一一处**绕开 .tab 点击**的程序化切屏：app.js:4373-4377 —— 点搜索结果跳回对话屏时
   * 直接 `querySelectorAll(".tab").forEach(remove active)` + 给 chat tab 加 active。
   * 它不经过 bindTabs()，因此壳层的 data-screen / 标题 / 侧栏高亮 / hash 都不会被通知，
   * 会出现「屏已经切到对话，壳层还显示上一屏」的不一致。
   * 在同一个 document 委托里补一条**纯外观**重同步（架构 §6.4 允许壳层做的第二件事），
   * 冒泡阶段必然晚于 app.js 绑在 .search-hit 上的处理器 ⇒ 读到的已是切换后的 DOM。
   * 注意：这里**不**复制任何切屏逻辑，只把壳层外观对齐 DOM 真源。
   */
  function resyncFromDom() {
    try {
      var at = q('.tabbar .tab.active');
      var page = at ? at.getAttribute('data-page') : null;
      /* 4374 的 forEach 会顺手清掉侧栏项的 .active（它们也带 class="tab"）⇒
       * 即便屏没变也要重刷一次高亮镜像。 */
      if (page && BY_PAGE[page]) runShellHooks(page);
      else syncNavActive();
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 8 · 壳层进入钩子 —— 只允许做两件事：渲染隐私屏 + 更新壳层自身外观（架构 §6.4）
   *
   *   明令禁止复制的既有副作用（一律由被转发的 .click() 触发 bindTabs 完成）：
   *     清/加 .active、#chat-dot 隐藏 + scrollBottom()、refreshStoryUI()、refreshRecentUI()、
   *     LTMUI.renderManagePage() + bindToggle()、ltmDistill() 蒸馏钩子。
   * ════════════════════════════════════════════════════════════════════════ */
  function runShellHooks(page) {
    var s = BY_PAGE[page];
    if (!s) return;
    if (state.current !== page) { state.prev = state.current; state.current = page; }

    try {
      var topbar = byId('shell-topbar');
      if (topbar) topbar.setAttribute('data-screen', page);   // CSS 依此决定上下文操作可见性
      var title = byId('shell-title');
      if (title) {
        if (s.xnName) { title.setAttribute('data-xn', 'name'); title.textContent = currentName(); }
        else { title.removeAttribute('data-xn'); title.textContent = s.label; }
      }
    } catch (e) {}

    syncNavActive();
    syncDays();
    syncHash(s.hash);
    try { G.localStorage.setItem(LS_LAST, page); } catch (e) {}   // 纯本地偏好，零外发

    if (page === 'privacy') renderPrivacy();
  }

  /** 侧栏高亮镜像：真源是 .tabbar 上的 .tab.active（不另立真源）。同步未读点镜像。 */
  function syncNavActive() {
    try {
      var activeTab = q('.tabbar .tab.active');
      var active = activeTab ? activeTab.getAttribute('data-page') : state.current;
      var items = qa('#shell-nav .shell-nav-item');
      for (var i = 0; i < items.length; i++) {
        var on = items[i].getAttribute('data-page') === active;
        if (on) { items[i].classList.add('active'); items[i].setAttribute('aria-current', 'page'); }
        else { items[i].classList.remove('active'); items[i].removeAttribute('aria-current'); }
      }
      var src = byId('chat-dot');
      var dot = q('#shell-nav .shell-nav-dot');
      if (src && dot) dot.classList[src.classList.contains('hidden') ? 'add' : 'remove']('hidden');
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 9 · P1-7 · hash 路由（对外语义清晰，对内保留历史 id 不改名）
   *   #/chat #/her #/story #/memory(别名 → ltm-manage) #/privacy #/settings(别名 → me)
   *   优先级：hash > localStorage 上次所在屏 > chat
   * ════════════════════════════════════════════════════════════════════════ */
  function parseHash() {
    try {
      var h = String(G.location && G.location.hash || '').replace(/^#\/?/, '').trim();
      if (!h) return null;
      var s = BY_HASH[h.split(/[?/]/)[0]];
      return s ? s.page : null;
    } catch (e) { return null; }
  }

  function syncHash(hash) {
    try {
      var want = '#/' + hash;
      if (G.location.hash === want) return;
      suppressHash = true;
      G.location.hash = want;
      /* hashchange 是异步派发的，用 rAF/微延时把抑制标志放到它之后再清 */
      var raf = G.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); };
      raf(function () { suppressHash = false; });
    } catch (e) { suppressHash = false; }
  }

  function onHashChange() {
    if (suppressHash) return;
    var page = parseHash();
    if (page && page !== state.current) go(page);
  }

  /** 对外导航 API：**只转发**给原生 tab，绝不自行改 .active（契约 C3 / INV-1）。 */
  function go(page) {
    var s = BY_PAGE[page];
    if (!s) return false;
    var peer = nativeTab(page);
    if (!peer) return false;
    try { peer.click(); return true; } catch (e) { return false; }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 10 · P1-8 · 隐私屏渲染（PRD R1 / INV-2 / ADR-6）
   *
   *   privacy-audit.js 只导出构造函数与 getInstance()，**没有** PrivacyAudit.render 静态门面
   *   （app.js:4711 的 `typeof window.PrivacyAudit.render === "function"` 恒为 false，
   *    这也说明旧弹窗宿主从未被真正渲染过 ⇒ P2 退役它不损失任何既有功能）。
   *   故必须走 getInstance().render()。
   *   「首次 render + 之后每次 refreshMetrics」（ADR-6）：
   *     · render() 末尾自己就会调 refreshMetrics()，语义等价；
   *     · 首次之后改走 refresh 可避免 LocalModelUI 的 #xn-lm-progress 下载进度被 innerHTML 清空，
   *       也避免用户已展开/滚动的状态被重置。
   *   两者都**只对唯一 root** 调用 —— refreshMetrics() 内部大量以省略 root 的
   *   document.querySelector 写 #xn-* 节点，一旦存在第二个宿主就必然写错节点。
   * ════════════════════════════════════════════════════════════════════════ */
  function renderPrivacy() {
    try {
      var host = byId('privacy-audit-body-page');
      if (!host) return;
      var PA = G.PrivacyAudit;
      if (!PA || typeof PA.getInstance !== 'function') return;
      var inst = PA.getInstance();
      if (host.childElementCount === 0) {
        if (typeof inst.render === 'function') inst.render(host);
        return;
      }
      if (typeof inst.refreshMetrics === 'function') {
        var p = inst.refreshMetrics();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { warn('PRIVACY_RENDER_FAIL', e && e.message); }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 11 · P2 · 退役弹窗渲染宿主（**唯一**破坏性步骤，仅在 P1 全绿后执行）
   *
   *   目的是 INV-2 的结构性保证：全文档 #xn-* id 恒唯一。
   *   不 remove 整个 #privacy-audit-modal —— 保留弹窗外壳可维持 INV-4 的降级路径，
   *   且 app.js:4695-4703 绑在 #privacy-audit-close / modal 上的监听器不会指向已摘节点。
   *   只做三件可逆的事：改 id、打废弃标记、清空内容。
   * ════════════════════════════════════════════════════════════════════════ */
  function retireModalHost() {
    var body = byId('privacy-audit-body');
    if (!body) return true;                     // 已不存在：视作已满足
    try {
      retired = { node: body, oldId: body.id, html: body.innerHTML };
      body.id = 'privacy-audit-body-retired';
      body.setAttribute('data-xn-deprecated', '1');
      body.innerHTML = '';
      return true;
    } catch (e) {
      /* P2 抛异常：把 id 改回去，恢复弹窗可用（INV-4 不破） */
      try { if (retired) { retired.node.id = retired.oldId; retired.node.removeAttribute('data-xn-deprecated'); } } catch (e2) {}
      retired = null;
      warn('P2_FAIL', e && e.message);
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 12 · 降级回滚（架构 §6.5）：退回既有单屏形态，绝不白屏、绝不影响和小暖聊天
   *
   *   可回滚对象刻意压到最少（这正是 ADR-3 不重父 .page、ADR-2 屏骨架声明式的收益）：
   *     搬走的节点 / 自建的侧栏节点 / ⚙ 换绑 / 两个监听器 / 一个只读订阅 / P2 的 id 改动。
   *   .page / .page.active 显隐机制完全不依赖壳层，对话屏 #chat-body 与输入栏从不被触碰。
   * ════════════════════════════════════════════════════════════════════════ */
  function rollback() {
    /* 1) 解绑监听与订阅 */
    try { if (docClickRef) document.removeEventListener('click', docClickRef, false); } catch (e) {}
    docClickRef = null;
    try { if (hashRef && G.removeEventListener) G.removeEventListener('hashchange', hashRef, false); } catch (e) {}
    hashRef = null;
    try { if (typeof unsubProbe === 'function') unsubProbe(); } catch (e) {}
    unsubProbe = null;

    /* 2) P2 复原（若已执行）：id 改回 + 内容还原 */
    try {
      if (retired) {
        retired.node.id = retired.oldId;
        retired.node.removeAttribute('data-xn-deprecated');
        retired.node.innerHTML = retired.html;
      }
    } catch (e) {}
    retired = null;

    /* 3) ⚙ 换绑复原：把克隆体摘掉、原节点放回原位（连同它的 openPrivacyAudit 监听器） */
    try {
      if (gearSwap) {
        if (gearSwap.fresh && gearSwap.fresh.parentNode) gearSwap.fresh.parentNode.removeChild(gearSwap.fresh);
        if (gearSwap.parent) gearSwap.parent.insertBefore(gearSwap.old, gearSwap.next || null);
      }
    } catch (e) {}
    gearSwap = null;

    /* 4) 移除自建节点（侧栏 6 项 + 底部镜像） */
    for (var i = created.length - 1; i >= 0; i--) {
      try { if (created[i].parentNode) created[i].parentNode.removeChild(created[i]); } catch (e) {}
    }
    created.length = 0;

    /* 5) 搬家复原：逆序按原 parent/next 放回，顺序与父子关系逐一还原 */
    for (var j = moved.length - 1; j >= 0; j--) {
      try {
        var m = moved[j];
        if (m.parent) m.parent.insertBefore(m.node, m.next || null);
      } catch (e) {}
    }
    moved.length = 0;

    /* 6) 清壳层标记：对话屏原顶栏重新显示，#app 退回 flex 单屏（CSS 全部以标记为条件） */
    try { var cn = q('#page-chat .nav'); if (cn) cn.removeAttribute('data-xn-migrated'); } catch (e) {}
    try { var app = byId('app'); if (app) app.removeAttribute('data-xn-shell'); } catch (e) {}
    try { var tb = byId('shell-topbar'); if (tb) tb.removeAttribute('data-screen'); } catch (e) {}

    state.mounted = false;
    state.current = null;
    mounting = false;   // 允许人工再试一次（QA / 排障用），不留死锁态
    return G.UiShell;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 13 · mount()：两阶段提交
   * ════════════════════════════════════════════════════════════════════════ */
  var mounting = false;
  function mount() {
    /* 双重幂等：state.mounted 只在 P2 之后才置真，中间还有 ⚙ 的异步等待窗口，
     * 故另设 mounting 闸，避免窗口期内被二次调用而把 P1 跑两遍。 */
    if (state.mounted || mounting) return G.UiShell;
    mounting = true;
    var ui;
    try {
      /* —— P1-2 前置校验：不合格就干脆不挂载，保持既有形态（零副作用） —— */
      ui = preflight();
      if (!ui.ok) { warn('PREFLIGHT', ui.why); mounting = false; return G.UiShell; }

      /* —— P1-3 搬家 —— */
      adoptGlobals(ui);

      /* —— P1-5 侧栏 —— */
      renderSidebar(ui.nav);

      /* —— P1-6 委托 —— */
      docClickRef = onDocClick;
      document.addEventListener('click', docClickRef, false);

      /* —— P1-7 路由监听 —— */
      hashRef = onHashChange;
      if (G.addEventListener) G.addEventListener('hashchange', hashRef, false);
    } catch (e) {
      warn('P1_FAIL', e && e.message);
      rollback();
      return G.UiShell;
    }

    /* —— P1-4 ⚙ 换绑：唯一需要等节点就绪的一步，失败只记录不中止（架构 §6.5） —— */
    adoptGearWithRetry(10, function () {
      try {
        /* —— 安全点：P1 已全绿 → 进入 P2（唯一破坏性步骤） —— */
        retireModalHost();

        state.mounted = true;
        var app = byId('app');
        if (app) app.setAttribute('data-xn-shell', '1');   // CSS 与 QA 的唯一形态判据

        /* —— 初始屏：hash > 上次所在屏 > 当前 .tab.active > chat —— */
        var initial = parseHash();
        if (!initial) { try { initial = G.localStorage.getItem(LS_LAST); } catch (e) {} }
        if (!initial || !BY_PAGE[initial]) {
          var at = q('.tabbar .tab.active');
          initial = (at && at.getAttribute('data-page')) || 'chat';
        }
        /* 已经停在该屏就只同步壳层外观（不空点一次，免得白跑一遍 bindTabs 副作用）；
         * 否则转发一次点击，由 bindTabs 完成真正的切屏。 */
        var at2 = q('.tabbar .tab.active');
        var now = at2 ? at2.getAttribute('data-page') : null;
        if (initial === now) runShellHooks(initial);
        else if (!go(initial)) runShellHooks(now || 'chat');
        mounting = false;
      } catch (e) {
        warn('P2_FAIL', e && e.message);
        rollback();
      }
    });

    return G.UiShell;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 14 · 对外门面
   * ════════════════════════════════════════════════════════════════════════ */
  G.UiShell = {
    version: VERSION,
    state: state,
    SCREENS: SCREENS,
    mount: mount,
    go: go,
    syncNavActive: syncNavActive,
    rollback: rollback
  };

  /* 本文件是 index.html 的**最末** script：app.js:4719 已先注册 DOMContentLoaded → init，
   * 同类监听器按注册顺序执行 ⇒ 本回调必然在 init() 之后跑（壳层「后到」的机制保证）。
   * 若脚本被延迟到 DOM 已就绪之后才执行（defer / 动态注入），readyState 兜底立即挂载。 */
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { mount(); });
    } else {
      mount();
    }
  } catch (e) {}
})();
