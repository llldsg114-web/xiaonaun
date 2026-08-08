/* 小暖 PWA Service Worker —— 缓存应用外壳，支持离线打开 + 触发"安装到主屏幕" */
const CACHE = "xiaonuan-v22";   // v22 v17 收线：engine.js（S-1b pnorm 归一化真源 :1310 + :1322 收口 + R2-A5b 回避型终止语 :1350 + 归一化接线 ×6 + Q-P2-D11 selfTick 防重放 :3613/:3636/:3637 + pnorm 导出 :3993）、memory.js（删 JOBX，taint/weave 走 E.pnorm）、presence.js（:22）、texture.js（:59）、contingency.js（L5 走 E.pnorm + R-S2 四型自我表达）五个被缓存文件全部改动，破墙护栏口径变了必须让旧缓存失效 // v21 v16 收线：ASSETS 清单未变，但 engine.js（V16-2 破墙表 :1307 四轴扩展，H13 升级为六维全组合闭环）与 app.js（V16-1 R2-B4 affHistory 改 dayIndex 比较器）两个被缓存文件已改动（memory.js 本期零改动：A2-i 的 tgf key 派生早已在源码中，本轮只摘 todo）。缓存键不换＝老用户 fetch 命中旧缓存，新旧模块混装（护栏改了却不下发，等于没上线）—— 这正是 v13 C0-b 事故的成因，故只要任一被缓存文件的内容变了就升版，不只是清单变了才升 // v20 v15 收线：engine.js（NOTE-2「模型」裸词分层 :1307）与 contingency.js（R-C5 c4 好奇追问 / c5 共同回忆）已改动
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
