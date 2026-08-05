/* 小暖 PWA Service Worker —— 缓存应用外壳，支持离线打开 + 触发"安装到主屏幕" */
const CACHE = "xiaonuan-v4";
const ASSETS = [
  "/", "/index.html", "/style.css", "/engine.js", "/app.js", "/localmodel.js",
  "/manifest.json", "/icon-192.png", "/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
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
