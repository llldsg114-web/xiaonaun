/**
 * consent.ts — ConsentPage：极简 HTML 同意页渲染（零依赖）。
 *
 * 展示客户端名称与申请的 scope，提供「允许」按钮；表单 POST 回 /authorize
 * 并携带原始参数 + decision=allow，由授权端点完成发码与 302 回跳。
 *
 * v1 支持自动同意策略（由调用方决定渲染或直接放行）。
 *
 * 协议：MIT。100% 自研。
 */

import type { ConsentView } from './types.js';

/**
 * 渲染极简同意页。返回完整 HTML 字符串（UTF-8）。
 */
export class ConsentPage {
  render(view: ConsentView): string {
    const esc = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const stateField = view.state ? `<input type="hidden" name="state" value="${esc(view.state)}" />` : '';
    const scopeList = view.scope
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => `<li><code>${esc(s)}</code></li>`)
      .join('');

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>心屿 · 授权确认</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0f1220; color: #e8eaf2; }
  .card { width: min(420px, 92vw); background: #171a2b; border: 1px solid #2a2f4a;
          border-radius: 16px; padding: 28px 26px; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .client { color: #9aa3c7; font-size: 14px; margin-bottom: 18px; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #7f88b0; }
  ul { list-style: none; padding: 0; margin: 8px 0 22px; display: flex; gap: 8px; flex-wrap: wrap; }
  li { background: #20243a; border: 1px solid #2f3556; padding: 6px 10px; border-radius: 999px; font-size: 13px; }
  .actions { display: flex; gap: 10px; }
  button { flex: 1; padding: 11px 14px; border-radius: 10px; border: 0; font-size: 15px; cursor: pointer; }
  .allow { background: #5b7cfa; color: #fff; }
  .allow:hover { background: #6d8bff; }
  .deny { background: #262b44; color: #c4c9e6; }
  .foot { margin-top: 16px; font-size: 12px; color: #6b73a0; }
</style>
</head>
<body>
  <div class="card">
    <h1>授权请求</h1>
    <div class="client">应用「${esc(view.clientName)}」希望访问你的心屿数据</div>
    <div class="label">申请的权限范围</div>
    <ul>${scopeList}</ul>
    <form method="post" action="/authorize">
      <input type="hidden" name="response_type" value="${esc(view.responseType)}" />
      <input type="hidden" name="client_id" value="${esc(view.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${esc(view.redirectUri)}" />
      <input type="hidden" name="scope" value="${esc(view.scope)}" />
      <input type="hidden" name="code_challenge" value="${esc(view.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${esc(view.codeChallengeMethod)}" />
      ${stateField}
      <input type="hidden" name="decision" value="allow" />
      <div class="actions">
        <button type="submit" name="choice" value="deny" class="deny">拒绝</button>
        <button type="submit" class="allow">允许</button>
      </div>
    </form>
    <div class="foot">心屿 · 自研 OAuth 2.1 授权服务器（MIT）</div>
  </div>
</body>
</html>`;
  }
}
