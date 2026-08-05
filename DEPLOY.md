# 小暖 · 部署指南

小暖是纯静态前端（HTML/CSS/JS + Service Worker PWA），无需后端、无需构建，
直接丢到任意静态托管即可。代码在 `ai-girlfriend/` 子目录。

> 前置：先把代码推到 GitHub（见 `push_to_github.sh`）。下面假设你已登录 GitHub 且仓库名
> `xiaonaun`，地址 `https://github.com/llldsg114-web/xiaonaun.git`。

---

## 方式一：Vercel（最省事，推荐）

1. 打开 https://vercel.com → 用 GitHub 登录 → **Add New → Project** → 选 `xiaonaun` 仓库。
2. 配置（关键三项）：
   - Framework Preset：**Other**
   - Build Command：**留空**（纯静态，不用构建）
   - Output Directory：**`ai-girlfriend`**
3. 点 **Deploy**。几十秒后拿到 `https://xiaonaun.vercel.app`，可自定义域名。

手机访问即 PWA，可"添加到主屏幕"。

---

## 方式二：Netlify

- **方案 A（拖拽）**：打开 https://app.netlify.com/drop ，直接把本地 `ai-girlfriend/` 文件夹拖进去。
- **方案 B（连仓库）**：New site from Git → 选 `xiaonaun` → Build command 留空，
  **Publish directory 填 `ai-girlfriend`** → Deploy。

---

## 方式三：GitHub Pages（用仓库自带的 Actions）

仓库已带 `.github/workflows/pages.yml`，会把 `ai-girlfriend/` 作为站点根部署。

1. 仓库 **Settings → Pages → Build and deployment → Source 选 "GitHub Actions"**。
2. 推送 `main` 分支（或手动在 Actions 页点 Run）即自动部署。
3. 几分钟后站点在 `https://llldsg114-web.github.io/xiaonaun/`。

> 注意：GitHub Pages 默认只认根目录或 `/docs`，不能直接认 `ai-girlfriend/` 子目录，
> 所以这个工作流显式指定 `path: ai-girlfriend`。**不要**在 Settings 里选 "Deploy from a branch"，
> 否则会 404——保持选 "GitHub Actions"。

---

## 方式四：本机跑起来看效果（不部署也能测）

```bash
cd ai-girlfriend
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

或任意静态服务器（npx serve / live-server）。Service Worker 需 http(s) 环境，
直接 `file://` 双击打开会少掉 PWA/离线能力，但聊天功能正常。

---

## 上线后建议

- **HTTPS**：Vercel/Netlify/Pages 都默认给 HTTPS，立绘、麦克风、PWA 安装都依赖安全上下文。
- **云端模型**：聊天默认走端侧兜底；要换成真·大模型，在「我的」页填 Base URL + Key
  （`bindCloudSave` 已接）。Key 只存在你浏览器 localStorage，不会上传。
- **头像/图标**：`icon-192.png` `icon-512.png` `apple-touch-icon.png` `manifest.json` 已就位。
- **隐私**：照片只在本地转 dataURL，不出设备；日记/记忆都在你浏览器本地存储。
