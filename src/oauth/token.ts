/**
 * token.ts — POST /token（P0-2 authorization_code + refresh_token / P1 轮换 + CORS）。
 *
 * authorization_code 流程：
 *   - 校验 code（consume 一次性）+ code_verifier(PKCE S256)+ client
 *   - 复用 TokenMiddleware.issueAccessToken 签发 HS256 JWT（同一 JWT_SECRET / issuer）
 *   - 生成并存储 refresh_token（内存，可吊销）
 * refresh_token 流程（P1）：
 *   - 校验 refresh → 换新 access；用即废轮换（refresh 旧令牌吊销，发新 refresh）
 *
 * CORS 由 OAuthServer 在路由层统一挂载，本处理器只关心业务逻辑。
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../config.js';
import type { TokenMiddleware } from '../auth/token.js';
import { sendOAuthError } from './errors.js';
import type { ClientStore } from './clients.js';
import type { CodeStore, RefreshStore } from './store.js';
import type { PkceUtil } from './pkce.js';
import type { OAuthClient, TokenRequestParams } from './types.js';

/** 取字段为字符串（兼容 string | string[] | undefined）。 */
function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

export interface TokenOptions {
  clients: ClientStore;
  code: CodeStore;
  refresh: RefreshStore;
  pkce: PkceUtil;
  auth: TokenMiddleware;
  /** jti → client_id 映射，供 /introspect 回带 client_id。 */
  accessMeta: Map<string, { client_id: string }>;
}

/**
 * 构造 /token 处理函数。
 */
export function createTokenHandler(opts: TokenOptions): RequestHandler {
  const { clients, code, refresh, pkce, auth, accessMeta } = opts;

  return (req: Request, res: Response, _next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const p: TokenRequestParams = {
      grant_type: first(body.grant_type),
      code: first(body.code),
      redirect_uri: first(body.redirect_uri),
      client_id: first(body.client_id),
      code_verifier: first(body.code_verifier),
      refresh_token: first(body.refresh_token),
      scope: first(body.scope),
    };

    const grant = p.grant_type;
    if (grant !== 'authorization_code' && grant !== 'refresh_token') {
      sendOAuthError(res, 'unsupported_grant_type', '仅支持 authorization_code / refresh_token');
      return;
    }

    // 客户端校验（public client 无 secret）
    if (!p.client_id) {
      sendOAuthError(res, 'invalid_client', '缺少 client_id');
      return;
    }
    const client: OAuthClient | undefined = clients.get(p.client_id);
    if (!client) {
      sendOAuthError(res, 'invalid_client', '客户端未注册');
      return;
    }
    if (client.token_endpoint_auth_method !== 'none') {
      const provided = first(body.client_secret) ?? extractBasicSecret(req);
      if (!provided || provided !== client.client_secret) {
        sendOAuthError(res, 'invalid_client', 'client_secret 校验失败');
        return;
      }
    }

    if (grant === 'authorization_code') {
      handleAuthorizationCode(p, res, client);
      return;
    }
    handleRefreshToken(p, res);
  };

  /** authorization_code grant：校验 code + PKCE + client → 签发。 */
  function handleAuthorizationCode(p: TokenRequestParams, res: Response, client: OAuthClient): void {
    if (!p.code || !p.redirect_uri || !p.code_verifier) {
      sendOAuthError(res, 'invalid_request', '缺少 code / redirect_uri / code_verifier');
      return;
    }
    // 一次性消费：已用 / 过期 / 未知 → invalid_grant
    const rec = code.consume(p.code);
    if (!rec) {
      sendOAuthError(res, 'invalid_grant', '授权码无效或已使用');
      return;
    }
    if (rec.client_id !== p.client_id || rec.redirect_uri !== p.redirect_uri) {
      sendOAuthError(res, 'invalid_grant', 'client / redirect_uri 不匹配');
      return;
    }
    if (!pkce.verify(p.code_verifier, rec.code_challenge)) {
      sendOAuthError(res, 'invalid_grant', 'PKCE 校验失败');
      return;
    }
    // 越权二次校验（scope 在授权时已限制，此处兜底）
    const allowed = new Set(client.allowed_scopes);
    const requested = (rec.scope ?? '').split(/\s+/).filter(Boolean);
    if (requested.some((s) => !allowed.has(s))) {
      sendOAuthError(res, 'invalid_scope', 'scope 超出客户端权限');
      return;
    }
    issueTokens(rec.subject, rec.scope, rec.client_id, p.redirect_uri ?? '', res);
  }

  /** refresh_token grant：校验 refresh → 换新 access（P1 用即废轮换）。 */
  function handleRefreshToken(p: TokenRequestParams, res: Response): void {
    if (!p.refresh_token) {
      sendOAuthError(res, 'invalid_request', '缺少 refresh_token');
      return;
    }
    const rec = refresh.get(p.refresh_token);
    if (!rec) {
      sendOAuthError(res, 'invalid_grant', 'refresh_token 无效');
      return;
    }
    if (rec.client_id !== p.client_id) {
      sendOAuthError(res, 'invalid_grant', 'client 不匹配');
      return;
    }
    // 轮换：吊销旧 refresh，签发新 refresh（用即废）
    const rotated = refresh.rotate(rec, REFRESH_TOKEN_TTL_SECONDS, () => pkce.randomToken(32));
    issueTokens(rotated.subject, rotated.scope, rotated.client_id, '', res, rotated.refresh_token);
  }

  /**
   * 签发 access_token（HS256 JWT）+ refresh_token，返回 TokenResponse。
   * @param existingRefresh 若为 refresh grant 轮换，传入已存好的新 refresh
   */
  function issueTokens(
    subject: string,
    scope: string,
    clientId: string,
    _redirectUri: string,
    res: Response,
    existingRefresh?: string,
  ): void {
    const issued = auth.issueAccessToken(subject, scope);
    const refreshToken = existingRefresh ?? pkce.randomToken(32);
    if (!existingRefresh) {
      refresh.save({
        refresh_token: refreshToken,
        client_id: clientId,
        subject,
        scope,
        jti: issued.jti,
        created_at: Date.now(),
        expires_at: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
        revoked: false,
      });
    }
    // 记录 jti → client_id（供 /introspect 回带）
    accessMeta.set(issued.jti, { client_id: clientId });

    res.json({
      access_token: issued.access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: issued.scope,
    });
  }
}

/** 从 Basic Authorization 头解析 client_secret（password 部分）。 */
function extractBasicSecret(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return undefined;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    return idx >= 0 ? decoded.slice(idx + 1) : decoded;
  } catch {
    return undefined;
  }
}
