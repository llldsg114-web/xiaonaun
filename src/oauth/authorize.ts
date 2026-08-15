/**
 * authorize.ts — GET/POST /authorize（P0-1 授权码 + PKCE S256 / P0-6 同意页）。
 *
 * 流程：
 *   GET  /authorize?response_type=code&client_id=...&redirect_uri=...&scope=...
 *       &state=...&code_challenge=...&code_challenge_method=S256
 *     → 校验 client / redirect 白名单 / PKCE 齐全 → 渲染极简同意页（200 HTML）
 *       （若 OAUTH_AUTO_CONSENT=true，则直接放行发码）
 *   POST /authorize（表单，含 decision=allow 或 choice=allow）
 *     → 校验通过后签发一次性 auth code 并 302 回 redirect_uri?code=&state=
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_CODE_TTL_SECONDS, LOCAL_SUBJECT, OAUTH_AUTO_CONSENT } from '../config.js';
import { sendOAuthError } from './errors.js';
import type { ClientStore } from './clients.js';
import type { CodeStore } from './store.js';
import type { PkceUtil } from './pkce.js';
import type { ConsentPage } from './consent.js';
import type { AuthorizeParams, OAuthClient } from './types.js';

/** 取查询/表单字段为字符串（兼容 string | string[] | undefined）。 */
function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

export interface AuthorizeOptions {
  clients: ClientStore;
  code: CodeStore;
  pkce: PkceUtil;
  consent: ConsentPage;
  autoConsent?: boolean;
}

/**
 * 构造 /authorize 处理函数（GET 渲染 / POST 一键允许发码，同一处理器）。
 */
export function createAuthorizeHandler(opts: AuthorizeOptions): RequestHandler {
  const { clients, code, pkce, consent } = opts;
  const autoConsent = opts.autoConsent ?? OAUTH_AUTO_CONSENT;

  return (req: Request, res: Response, _next: NextFunction): void => {
    // 合并 GET 查询与 POST 表单（表单优先）。
    const q = req.query as Record<string, unknown>;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p: AuthorizeParams = {
      response_type: first(b.response_type) ?? first(q.response_type),
      client_id: first(b.client_id) ?? first(q.client_id),
      redirect_uri: first(b.redirect_uri) ?? first(q.redirect_uri),
      scope: first(b.scope) ?? first(q.scope),
      state: first(b.state) ?? first(q.state),
      code_challenge: first(b.code_challenge) ?? first(q.code_challenge),
      code_challenge_method: first(b.code_challenge_method) ?? first(q.code_challenge_method),
      decision: first(b.decision) ?? first(b.choice) ?? first(q.decision),
    };

    // 1) response_type 必须为 code
    if (p.response_type !== 'code') {
      sendOAuthError(res, 'unsupported_response_type', '仅支持 response_type=code');
      return;
    }

    // 2) client 注册校验
    if (!p.client_id) {
      sendOAuthError(res, 'invalid_request', '缺少 client_id');
      return;
    }
    const client: OAuthClient | undefined = clients.get(p.client_id);
    if (!client) {
      sendOAuthError(res, 'invalid_client', '客户端未注册');
      return;
    }

    // 3) redirect_uri 白名单校验
    if (!p.redirect_uri || !clients.isValidRedirectUri(client, p.redirect_uri)) {
      sendOAuthError(res, 'invalid_request', 'redirect_uri 不在白名单');
      return;
    }

    // 4) PKCE(S256) 强制校验
    if (!p.code_challenge || p.code_challenge_method !== 'S256') {
      sendOAuthError(res, 'invalid_request', '必须提供 code_challenge 且 method=S256');
      return;
    }

    // 5) scope 校验（缺失则默认客户端上界；越权拒绝）
    const requested = (p.scope ?? client.allowed_scopes.join(' ')).trim();
    const requestedScopes = requested.length > 0 ? requested.split(/\s+/).filter(Boolean) : [];
    const allowed = new Set(client.allowed_scopes);
    const outOfBound = requestedScopes.filter((s) => !allowed.has(s));
    if (outOfBound.length > 0) {
      sendOAuthError(res, 'invalid_scope', `不允许的 scope: ${outOfBound.join(',')}`);
      return;
    }

    // 6) 决策：拒绝 / 允许 / 待同意渲染
    const decision = p.decision;
    if (decision === 'deny') {
      const url = new URL(p.redirect_uri);
      url.searchParams.set('error', 'access_denied');
      if (p.state) url.searchParams.set('state', p.state);
      res.redirect(url.toString());
      return;
    }

    if (decision !== 'allow' && !autoConsent) {
      // 渲染极简同意页
      const html = consent.render({
        clientName: client.name,
        clientId: client.client_id,
        scope: requested,
        state: p.state,
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        codeChallengeMethod: p.code_challenge_method ?? 'S256',
        responseType: 'code',
      });
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
      return;
    }

    // 7) 签发一次性授权码并 302 回跳
    const ac = pkce.randomToken(32);
    const now = Date.now();
    code.save({
      code: ac,
      client_id: client.client_id,
      redirect_uri: p.redirect_uri,
      scope: requested,
      code_challenge: p.code_challenge,
      code_challenge_method: 'S256',
      subject: LOCAL_SUBJECT,
      created_at: now,
      expires_at: now + AUTH_CODE_TTL_SECONDS * 1000,
      used: false,
    });

    const url = new URL(p.redirect_uri);
    url.searchParams.set('code', ac);
    if (p.state) url.searchParams.set('state', p.state);
    res.redirect(url.toString());
  };
}
