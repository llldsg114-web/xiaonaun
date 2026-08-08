/* 小暖 PWA Service Worker —— 缓存应用外壳，支持离线打开 + 触发"安装到主屏幕" */
const CACHE = "xiaonuan-v18";   // v18 T5b：新增 contingency.js。同 v17 的道理——只要 index.html 的 script 清单变了就必须整体换缓存键，否则老用户拿到旧 index.html（无该 script 标签）配新 engine.js，模块恒缺席
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
