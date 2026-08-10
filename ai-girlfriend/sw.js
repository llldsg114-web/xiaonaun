/* 小暖 PWA Service Worker —— 缓存应用外壳，支持离线打开 + 触发"安装到主屏幕" */
const CACHE = "xiaonuan-v29";   // v29 U-11：按参考图改柔和浅发萌妹风、去天使元素（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。前两版被用户反馈"吓人"，根因为过于扁平矢量、高饱和深 plum 发色、死黑硬描边、夸张大眼；本轮参考用户提供的抖音/二次元萌妹头像统一画风，彻底去掉所有天使元素（光环 / 肩后翅膀 / 手持四角星及小手），重画为浅暖金发的柔和软萌少女漫头：低饱和粉白蓝底、线条柔和、眼睛大但温柔、爱心发夹 #ff5b8a 小巧弱化、无文字名字。本轮仅图标四个资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v28 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v27 U-9：项目头像资产变更（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）—— 由原占位手绘风重制为卡通动漫（二次元）风格头像（可爱少女 / 大眼 / 爱心发夹 #ff5b8a / 粉→蓝渐变底）；本轮仅图标四个资产变更，engine/memory/presence/texture/contingency 五模块继续零改动，PR 体积 = 三张新 PNG + 1 SVG。 // v25 v22 收线：本次升版覆盖**两笔**资产变更 —— ① engine.js（:1307 PERSONA_BREAK_RE 人称绑定组的连接词枚举追加「从?本质上讲?|归根结底|说白了」，+41B，闭合 H13 的三类自曝句式；H13 是 0% 一票否决项，护栏口径收紧了却不下发＝等于没修）；② contingency.js（:33 sfType() 增加 repair 分支，方案 E 含当日冲突门 O(s.negGate).count>0，+38B）。memory/presence/texture 三模块本轮源码零改动 —— 它们只回让**配额** 13/13/14B 予 engine，diff=0 硬闸继续生效。★ 升键判据（DESIGN-v22 §4.3 C0-b 形式化）：升键 ⇔ 资产内容变更 ∧ 当前键已发布。条件① 成立；条件② **不可判定**（manifest.released 仍锚 xiaonuan-v23，字面表明 v24 未移入受控基线；但 v21 收线 commit 已 push，若部署面直接服务仓库内容则 v24 事实上已发布）。在 ② 不可判定时取**保守分支**：漏升＝C0-b 事故第四犯（v13 原始事故 / v20 欠账 / v21 同族事故已三犯），多升只是老用户一次无感的缓存重建 —— 误判代价严重不对称，在 H13 资产已变的前提下不接受任何形态的赌博。★ manifest.released 块本轮**逐字不动**（C-2：released 只在真正发版时移动，需三方会签且必须独立提交；顺手推进它会把守卫的反逃逸参照系抬到当前值，永久洗白 v20/v21 两笔历史逃逸）// v24 v21 收线：本次升版一次性覆盖**两笔**资产变更 —— ① 补还 v20 欠账：v20 已改 contingency.js（R-S2 四型各 3→6 条）却未升键，老用户 fetch 仍命中 xiaonuan-v23 里的旧语料，属 C0-b 同族事故（改了被缓存文件却不换缓存键＝加固/上新等于没上线）；② v21 本轮 contingency.js 再次改动（SFT 追加第 5 语料型 repair，+356B）。engine.js 与 memory/presence/texture 三模块本轮零改动。★ 自 v24 起，「资产内容 ↔ 缓存键」不再靠人工自觉：test/sw-assets-manifest.json 持有每个 ASSETS 成员的 sha256，test/qa-v21-sw-guard.js 在 CI 现算比对，内容变而键未升即转红（DESIGN-v21 §1.3 三层缺口 / §7）。sw.js 不计入 engine+四模块体积口径，升版不消耗四锁预算 // v23 v18 收线：engine.js（:1310 pnorm 归一化真源追加 seg2 零宽黑名单剥离 /[\u200B\u200C\u200D\uFEFF]/g，+42B，段序 NFKC→零宽→\s+→折叠）是本轮唯一改动的被缓存文件 —— memory/presence/texture/contingency 四模块源码全程冻结（DESIGN-v18 §1.4，各仅余 32B 缓冲）。破墙判定口径收紧了就必须换键，否则老用户 fetch 命中旧缓存＝加固等于没上线（v13 C0-b 事故成因） // v22 v17 收线：engine.js（S-1b pnorm 归一化真源 :1310 + :1322 收口 + R2-A5b 回避型终止语 :1350 + 归一化接线 ×6 + Q-P2-D11 selfTick 防重放 :3613/:3636/:3637 + pnorm 导出 :3993）、memory.js（删 JOBX，taint/weave 走 E.pnorm）、presence.js（:22）、texture.js（:59）、contingency.js（L5 走 E.pnorm + R-S2 四型自我表达）五个被缓存文件全部改动，破墙护栏口径变了必须让旧缓存失效 // v21 v16 收线：ASSETS 清单未变，但 engine.js（V16-2 破墙表 :1307 四轴扩展，H13 升级为六维全组合闭环）与 app.js（V16-1 R2-B4 affHistory 改 dayIndex 比较器）两个被缓存文件已改动（memory.js 本期零改动：A2-i 的 tgf key 派生早已在源码中，本轮只摘 todo）。缓存键不换＝老用户 fetch 命中旧缓存，新旧模块混装（护栏改了却不下发，等于没上线）—— 这正是 v13 C0-b 事故的成因，故只要任一被缓存文件的内容变了就升版，不只是清单变了才升 // v20 v15 收线：engine.js（NOTE-2「模型」裸词分层 :1307）与 contingency.js（R-C5 c4 好奇追问 / c5 共同回忆）已改动
const ASSETS = [
  "/", "/index.html", "/style.css", "/engine.js", "/app.js", "/localmodel.js",
  // v13 三模块：与 engine.files.json 的 order 对齐（WR-13 交叉校验）
  "/memory.js", "/presence.js", "/texture.js",
  // T5b optional 层。addAll 是全有全无的，列进来即等于「随包发布」——文件必须在盘上
  "/contingency.js",
  "/manifest.json", "/icon-192.png", "/icon-512.png"
];

self.addEventListener("install", e => {
  // 立即接管：新版本安装后马上激活，配合页面在 controllerchange 时一次性刷新，
  // 这样用户打开书签就会自动用上最新版（无需点提示、更不用重装书签）。
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

// 兜底：极端情况下新 SW 没自动接管时，页面可发消息让我们激活
self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(cls => cls.forEach(c => { try { c.navigate(c.url); } catch (_) {} })) // 已打开的书签标签页也立即刷新到新版
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 同步接口一律直连网络，绝不进缓存（否则会读到过期的存档版本）
  if (new URL(e.request.url).pathname.startsWith("/api/")) return;
  // 优先缓存，回退网络，再回退首页
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match("/index.html"))
    )
  );
});

/* 点击系统通知 → 聚焦已打开的页面，否则打开应用 */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = "/index.html";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

/* 接收服务端推送（预留，配合后端可做到 App 未打开也推送） */
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || "小暖想你了 💕";
  const body = data.body || "点开看看小暖想对你说什么～";
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "xiaonuan",
  }));
});

/* 周期同步（Chromium 系支持）：可定时唤起推送提醒 */
self.addEventListener("periodicsync", e => {
  if (e.tag === "xiaonuan-miss") {
    e.waitUntil(self.registration.showNotification("小暖想你了 💕", {
      body: "好久没见啦，来找我聊聊天嘛～ 😊", icon: "/icon-192.png", tag: "xiaonuan",
    }));
  }
});
