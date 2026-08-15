/**
 * login.ts — GET /login（渲染极简登录页）+ POST /login（校验凭证、建会话、设 cookie）。
 *
 * v2 ② 本地账户 SSO 的登录闸门入口：
 *   GET  /login?redirect=<url>  → 200 HTML 登录表单（含隐藏 redirect 字段）
 *   POST /login { username, password, redirect? }
 *        → 成功：sessions.create(username) → Set-Cookie: xinyu_sid=...; HttpOnly; Path=/; SameSite=Lax
 *                → 302 <redirect 或 '/'>
 *        → 失败：200 带错误提示（保留 redirect 字段，便于重试）
 *
 * 零依赖（仅 express 类型 + node 配置常量）。协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AccountStore } from './accounts.js';
import type { SessionStore } from './session.js';
import { SESSION_COOKIE_NAME } from '../config.js';

/** 取字段为字符串（兼容 string | string[] | undefined）。 */
function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** HTML 转义（防 XSS）。 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 渲染极简登录页。
 * @param redirect  登录成功后回跳地址（默认 '/'）。
 * @param error     可选的错误提示文案。
 */
function renderLoginPage(redirect: string, error?: string): string {
  const redirectField = `<input type="hidden" name="redirect" value="${esc(redirect)}" />`;
  const errorHtml = error
    ? `<div class="error" role="alert">${esc(error)}</div>`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>心屿 · 登录</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0f1220; color: #e8eaf2; }
  .card { width: min(380px, 92vw); background: #171a2b; border: 1px solid #2a2f4a;
          border-radius: 16px; padding: 28px 26px; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
  h1 { font-size: 18px; margin: 0 0 18px; }
  label { display: block; font-size: 13px; color: #9aa3c7; margin: 0 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px;
          border: 1px solid #2f3556; background: #0f1220; color: #e8eaf2; font-size: 15px; }
  input:focus { outline: none; border-color: #5b7cfa; }
  .row { margin-bottom: 14px; }
  button { width: 100%; padding: 12px 14px; border-radius: 10px; border: 0; font-size: 15px;
           background: #5b7cfa; color: #fff; cursor: pointer; }
  button:hover { background: #6d8bff; }
  .error { background: #3a1f24; border: 1px solid #6b2b34; color: #ffb3bd; padding: 10px 12px;
           border-radius: 10px; font-size: 13px; margin-bottom: 14px; }
  .foot { margin-top: 16px; font-size: 12px; color: #6b73a0; }
</style>
</head>
<body>
  <div class="card">
    <h1>心屿 · 登录</h1>
    ${errorHtml}
    <form method="post" action="/login">
      <div class="row">
        <label for="username">用户名</label>
        <input id="username" name="username" type="text" autocomplete="username" required />
      </div>
      <div class="row">
        <label for="password">口令</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
      </div>
      ${redirectField}
      <button type="submit">登录</button>
    </form>
    <div class="foot">心屿 · 自研 OAuth 2.1 授权服务器（MIT）</div>
  </div>
</body>
</html>`;
}

export interface LoginOptions {
  accounts: AccountStore;
  sessions: SessionStore;
}

/**
 * 构造 /login 处理函数（GET 渲染 / POST 校验，同一处理器）。
 */
export function createLoginHandler(opts: LoginOptions): RequestHandler {
  const { accounts, sessions } = opts;

  return (req: Request, res: Response, _next: NextFunction): void => {
    const isPost = req.method === 'POST';

    if (!isPost) {
      // GET：渲染登录页；redirect 来自 query（来自登录闸门的跳转）。
      const q = req.query as Record<string, unknown>;
      const redirect = first(q.redirect) ?? '/';
      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderLoginPage(redirect));
      return;
    }

    // POST：校验凭证。
    const b = (req.body ?? {}) as Record<string, unknown>;
    const username = first(b.username);
    const password = first(b.password);
    const redirect = first(b.redirect) ?? '/';

    if (!username || !password || !accounts.verify(username, password)) {
      // 失败：200 带错误提示（保留 redirect 字段，便于重试）。
      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderLoginPage(redirect, '用户名或口令错误'));
      return;
    }

    // 成功：建会话 → 设 httpOnly cookie → 302 回跳。
    const sid = sessions.create(username);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${sid}; HttpOnly; Path=/; SameSite=Lax`,
    );
    res.redirect(redirect);
  };
}
