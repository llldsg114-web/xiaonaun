/**
 * introspect.ts — POST /introspect（RFC7662 令牌自检）。
 *
 * - access_token：经 TokenMiddleware.introspectToken 验签；若 jti 在吊销黑名单
 *   则视为不活跃。返回 {active:true, scope, sub, exp, iss, client_id, token_type}。
 * - refresh_token：查 RefreshStore（存活且未吊销则活跃）。
 * - 未知 / 吊销 / 过期 → {active:false}（RFC7662 推荐 200）。
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TokenMiddleware } from '../auth/token.js';
import type { RefreshStore, RevocationStore } from './store.js';
import type { IntrospectResponse } from './types.js';

/** 取字段为字符串。 */
function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

export interface IntrospectOptions {
  auth: TokenMiddleware;
  refresh: RefreshStore;
  revocation: RevocationStore;
  accessMeta: Map<string, { client_id: string }>;
}

/**
 * 构造 /introspect 处理函数。
 */
export function createIntrospectHandler(opts: IntrospectOptions): RequestHandler {
  const { auth, refresh, revocation, accessMeta } = opts;

  return (req: Request, res: Response, _next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = first(body.token);
    const hint = first(body.token_type_hint);

    if (!token) {
      res.json({ active: false } as IntrospectResponse);
      return;
    }

    // refresh_token 提示优先查 refresh store
    if (hint === 'refresh_token') {
      const rec = refresh.get(token);
      if (rec) {
        res.json({
          active: true,
          scope: rec.scope,
          sub: rec.subject,
          client_id: rec.client_id,
          token_type: 'refresh_token',
        } as IntrospectResponse);
        return;
      }
      res.json({ active: false } as IntrospectResponse);
      return;
    }

    // 默认按 access_token 处理（JWT）
    const claims = auth.introspectToken(token);
    if (!claims) {
      res.json({ active: false } as IntrospectResponse);
      return;
    }
    const jti = (claims as { jti?: string }).jti;
    if (jti && revocation.isRevoked(jti)) {
      res.json({ active: false } as IntrospectResponse);
      return;
    }
    res.json({
      active: true,
      scope: (claims as { scope?: string }).scope ?? (Array.isArray(claims.scopes) ? claims.scopes.join(' ') : undefined),
      sub: claims.sub,
      exp: claims.exp,
      iss: claims.iss,
      client_id: jti ? accessMeta.get(jti)?.client_id : undefined,
      token_type: 'Bearer',
    } as IntrospectResponse);
  };
}
