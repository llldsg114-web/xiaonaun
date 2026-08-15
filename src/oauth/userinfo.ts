/**
 * userinfo.ts — GET/POST /userinfo（OIDC 轻量子集，v2 ②）。
 *
 * 取 `Authorization: Bearer <jwt>` → TokenMiddleware.introspectToken(token)
 * → 返回 JSON `{ active:true, sub, scope, iss }`（供前端拿真实 subject）。
 * 无效/缺失令牌 → 401 JSON（OAuth 标准 error 字段）。
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TokenMiddleware } from '../auth/token.js';

export interface UserinfoOptions {
  auth: TokenMiddleware;
}

/**
 * 构造 /userinfo 处理函数。
 */
export function createUserinfoHandler(opts: UserinfoOptions): RequestHandler {
  const { auth } = opts;

  return (req: Request, res: Response, _next: NextFunction): void => {
    const token = auth.extractBearer(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: '缺少 Bearer 令牌',
      });
      return;
    }

    const claims = auth.introspectToken(token);
    if (!claims) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: '令牌无效或已过期',
      });
      return;
    }

    const scope =
      claims.scope ??
      (Array.isArray(claims.scopes) ? claims.scopes.join(' ') : '');

    res.json({
      active: true,
      sub: claims.sub,
      scope,
      iss: claims.iss,
      token_type: 'Bearer',
    });
  };
}
