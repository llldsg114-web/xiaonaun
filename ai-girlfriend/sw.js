/* 小暖 PWA Service Worker —— 缓存应用外壳，支持离线打开 + 触发"安装到主屏幕" */
const CACHE = "xiaonuan-v37";   // v37 对话气泡+心 重设计（图标四资产：icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。方向＝对话气泡包裹一颗渐变心，象征 AI 陪伴对话；温暖多彩、贴合「心屿」品牌。气泡用柔和白→粉渐变(#ffffff→#ffe3f0)，心用粉→珊瑚粉→紫温暖渐变(#ffd9ec→#ff8fb1→#a98bff)，背景用粉桃→柔粉→天蓝轻盈渐变(#ffd9c2→#ffc6e0→#bfe9ff)，角落暖黄星光 sparkle(#fff6c8→#ffe08a) 不喧宾夺主。全程无黑无暗无人物无文字，完全符号化品牌标记。cairosvg 2.8.2 约束：仅 linearGradient，禁 filter/radialGradient/mask/clip-path。本轮仅图标四资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v35 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。   // v35 绚丽多彩重制（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。用户否决 v34 仍判「太粉彩/洗白/不够彩」，要求「色彩绚丽丰富点，符合品牌名(心屿)，不要太过黑暗」。本轮改为 VIVID+RICH+COLORFUL 但全程 BRIGHT（无深暗调）：背景彩色三色渐变（#ffc2dd 艳粉→#ffe0a8 暖桃→#bfe9ff 亮天蓝，rx=0 不透明）+ 软艳粉心形（#ffe3ee→#ffc6dd，描边 #ffb3d1）+ 心形内多彩「屿」小场景（艳金太阳 #ffd54a→#ffb300 / 亮青水波 #7fe0db→#46c9c4 / 草绿屿丘 #a6e072→#6cc04a / 小白云 / 珊瑚粉 sparkle #ff7ea3）+ 上中 6 色亮彩小彩虹（红#ff8a8a 橙#ffb86b 黄#ffe07a 绿#9be08a 蓝#8fcfff 紫#c9a8ff）。全程仅亮色描边，无黑无暗无人物无文字。cairosvg 2.8.2 约束：仅 linearGradient，禁 filter/radialGradient/mask/clip-path。本轮仅图标四资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v34 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v33 暖色化 / 色彩丰富重制（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。用户否决 v32 判定「太黑/太冷/不温馨」，根因＝冷蓝紫＋冷描边读感暗冷；本轮改用暖亮多彩调色板：背景暖三色渐变（#ffd9a8 杏→#ffb3c6 柔玫瑰→#fff0c2 奶油，rx=0 不透明）+ 居中暖白心形（#ffffff→#fff3f6，暖描边 #ffd9e2）+ 心形内含多彩「屿」小场景（暖黄太阳 #ffe27a→#ffcf4d / 清新 aqua 水波 #aee6e0→#84d3cc / 友好绿丘 #bfe39a→#8fc96e / 小白云 / 珊瑚粉 sparkle #ff9eb5）。全程仅浅色友好描边，无黑无冷。cairosvg 2.8.2 约束：仅 linearGradient，禁 filter/radialGradient/mask/clip-path。本轮仅图标四资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v32 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v32 几何心屿品牌标记全量重制（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。用户反复否决 v1–v5 全部「小暖」人物头像（银发/兔耳/黑蝴蝶结等），明确只要手机桌面级应用图标——符号化品牌标而非人物肖像。本轮彻底重写为几何「心屿」：不透明品牌渐变底（#ffd9e8→#e7dcf6→#cfe6ff）+ 居中白色心形（含上左高光）+ 心形下半部蓝紫「屿」小岛场景（水波 #bfe0ff→#9cc6f7 / 紫丘 #c9b6ea→#a98fd6 / 暖色星 #fff7c2），无人物无文字。cairosvg 2.8.2 约束：仅 linearGradient，禁 filter/radialGradient/mask/clip-path。本轮仅图标四资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v31 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v31 U-13：按参考图改银发双马尾+兔耳+黑蝴蝶结萌系风（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。v4（v30）长直发+黑蝴蝶结+忧郁被用户判「吓人/不满意」，根因：矢量复刻不了参考图手绘柔光且造型辨识度不够。本轮改用户参考图 1 的高辨识度萌系造型：银白双马尾（头顶中分刘海 + 两侧各一条垂下的马尾，发尾用小蝴蝶结束住）+ 兔耳发箍（白色外/内耳淡粉 #ffd0d8，架在头顶，本轮最关键辨识度元素）+ 右上黑色蝴蝶结（#2f2f2f→#242424，与兔耳并存），表情改为柔和偏甜+一点点梦幻（极淡微笑 + 眼神温柔看向上方），眼睛比 v4 略圆润可爱（双柔高光 + 细睫毛），发色沿用 v4 同色系（#f7f4f2→#ede8e2→#ddd5cc）保持去暖去甜，背景近纯白极淡灰（#fbfbfb→#f2f1ef），左刘海保留 tiny 淡粉心形发夹（#ffaeb9 半透明）作品牌符号极度弱化。本轮仅图标四个资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v30 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v30 U-12：按参考图改极淡银白忧郁梦幻风 + 去暖色/去天使元素（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）。前三版被用户反馈"吓人"，根因为：v1/v2 高饱和深 plum 发色 + 死黑硬描边 + 夸张大眼 + 天使元素（光环/翅膀/四角星）；v3 已去天使但仍偏暖偏甜（浅暖金发 + 粉白蓝底 + 死黑眼线），用户判"矢量扁平"。本轮以用户提供的三张抖音/二次元动漫头像为参考彻底重画：发色改为极淡银白/浅白金/浅灰棕（#f7f4f2 → #ede8e2 → #ddd5cc），背景改为近纯白极淡灰（#fafafa → #f5f5f5），画风改为细腻动漫线稿 + 大量细发丝 path 模拟手绘感，表情改为忧郁淡然（垂眼型 + 视线偏上 + 微八字眉 + 极小抿嘴），配饰改为右上黑色蝴蝶结主导 + 极度弱化的淡粉心形发夹，描边全部用与肤发同族的极淡暖灰（#d4c4b8 / #c9bdb2），禁用暖金/粉蓝底/死黑硬边。本轮仅图标四个资产变更，engine/memory/presence/texture/contingency 五模块零改动。旧键 xiaonuan-v29 的 C0-b 责任：所有老用户必须丢弃旧缓存拉新图。 // v27 U-9：项目头像资产变更（icon-xinyu.svg / icon-192.png / icon-512.png / apple-touch-icon.png）—— 由原占位手绘风重制为卡通动漫（二次元）风格头像（可爱少女 / 大眼 / 爱心发夹 #ff5b8a / 粉→蓝渐变底）；本轮仅图标四个资产变更，engine/memory/presence/texture/contingency 五模块继续零改动，PR 体积 = 三张新 PNG + 1 SVG。 // v25 v22 收线：本次升版覆盖**两笔**资产变更 —— ① engine.js（:1307 PERSONA_BREAK_RE 人称绑定组的连接词枚举追加「从?本质上讲?|归根结底|说白了」，+41B，闭合 H13 的三类自曝句式；H13 是 0% 一票否决项，护栏口径收紧了却不下发＝等于没修）；② contingency.js（:33 sfType() 增加 repair 分支，方案 E 含当日冲突门 O(s.negGate).count>0，+38B）。memory/presence/texture 三模块本轮源码零改动 —— 它们只回让**配额** 13/13/14B 予 engine，diff=0 硬闸继续生效。★ 升键判据（DESIGN-v22 §4.3 C0-b 形式化）：升键 ⇔ 资产内容变更 ∧ 当前键已发布。条件① 成立；条件② **不可判定**（manifest.released 仍锚 xiaonuan-v23，字面表明 v24 未移入受控基线；但 v21 收线 commit 已 push，若部署面直接服务仓库内容则 v24 事实上已发布）。在 ② 不可判定时取**保守分支**：漏升＝C0-b 事故第四犯（v13 原始事故 / v20 欠账 / v21 同族事故已三犯），多升只是老用户一次无感的缓存重建 —— 误判代价严重不对称，在 H13 资产已变的前提下不接受任何形态的赌博。★ manifest.released 块本轮**逐字不动**（C-2：released 只在真正发版时移动，需三方会签且必须独立提交；顺手推进它会把守卫的反逃逸参照系抬到当前值，永久洗白 v20/v21 两笔历史逃逸）// v24 v21 收线：本次升版一次性覆盖**两笔**资产变更 —— ① 补还 v20 欠账：v20 已改 contingency.js（R-S2 四型各 3→6 条）却未升键，老用户 fetch 仍命中 xiaonuan-v23 里的旧语料，属 C0-b 同族事故（改了被缓存文件却不换缓存键＝加固/上新等于没上线）；② v21 本轮 contingency.js 再次改动（SFT 追加第 5 语料型 repair，+356B）。engine.js 与 memory/presence/texture 三模块本轮零改动。★ 自 v24 起，「资产内容 ↔ 缓存键」不再靠人工自觉：test/sw-assets-manifest.json 持有每个 ASSETS 成员的 sha256，test/qa-v21-sw-guard.js 在 CI 现算比对，内容变而键未升即转红（DESIGN-v21 §1.3 三层缺口 / §7）。sw.js 不计入 engine+四模块体积口径，升版不消耗四锁预算 // v23 v18 收线：engine.js（:1310 pnorm 归一化真源追加 seg2 零宽黑名单剥离 /[\u200B\u200C\u200D\uFEFF]/g，+42B，段序 NFKC→零宽→\s+→折叠）是本轮唯一改动的被缓存文件 —— memory/presence/texture/contingency 四模块源码全程冻结（DESIGN-v18 §1.4，各仅余 32B 缓冲）。破墙判定口径收紧了就必须换键，否则老用户 fetch 命中旧缓存＝加固等于没上线（v13 C0-b 事故成因） // v22 v17 收线：engine.js（S-1b pnorm 归一化真源 :1310 + :1322 收口 + R2-A5b 回避型终止语 :1350 + 归一化接线 ×6 + Q-P2-D11 selfTick 防重放 :3613/:3636/:3637 + pnorm 导出 :3993）、memory.js（删 JOBX，taint/weave 走 E.pnorm）、presence.js（:22）、texture.js（:59）、contingency.js（L5 走 E.pnorm + R-S2 四型自我表达）五个被缓存文件全部改动，破墙护栏口径变了必须让旧缓存失效 // v21 v16 收线：ASSETS 清单未变，但 engine.js（V16-2 破墙表 :1307 四轴扩展，H13 升级为六维全组合闭环）与 app.js（V16-1 R2-B4 affHistory 改 dayIndex 比较器）两个被缓存文件已改动（memory.js 本期零改动：A2-i 的 tgf key 派生早已在源码中，本轮只摘 todo）。缓存键不换＝老用户 fetch 命中旧缓存，新旧模块混装（护栏改了却不下发，等于没上线）—— 这正是 v13 C0-b 事故的成因，故只要任一被缓存文件的内容变了就升版，不只是清单变了才升 // v20 v15 收线：engine.js（NOTE-2「模型」裸词分层 :1307）与 contingency.js（R-C5 c4 好奇追问 / c5 共同回忆）已改动
const ASSETS = [
  "/", "/index.html", "/style.css", "/engine.js", "/app.js", "/localmodel.js",
  // v13 三模块：与 engine.files.json 的 order 对齐（WR-13 交叉校验）
  "/memory.js", "/presence.js", "/texture.js",
  // v4.2 S3 六模块进 ASSETS（WR-13 校验）
  "/dialogue-core.js", "/emotion-core.js", "/persona-core.js",
  "/sense-core.js", "/face-sense.js", "/voice-sense.js",
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
