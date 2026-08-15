/**
 * revoke.ts — POST /revoke（RFC7009 令牌吊销）。
 *
 * - access_token：jti 加入 RevocationStore 黑名单（影响 /introspect）。
 * - refresh_token：RefreshStore.revoke + 按 jti 级联标记关联 access。
 * - RFC7009：无论结果如何均返回 200（最佳努力）。
 *
 * 注意：v1 已签发的 access_token 对 MCP 工具路径仍可用（verify 不查黑名单，
 * 由短 TTL + refresh 吊销 + 重启清内存兜底），符合「零改动 3 工具」铁律。
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TokenMiddleware } from '../auth/token.js';
import type { RefreshStore, RevocationStore } from './store.js';

/** 取字段为字符串。 */
function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

export interface RevokeOptions {
  auth: TokenMiddleware;
  refresh: RefreshStore;
  revocation: RevocationStore;
}

/**
 * 构造 /revoke 处理函数。
 */
export function createRevokeHandler(opts: RevokeOptions): RequestHandler {
  const { auth, refresh, revocation } = opts;

  return (req: Request, res: Response, _next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = first(body.token);
    const hint = first(body.token_type_hint);

    if (!token) {
      // RFC7009：空令牌也视为成功（200）
      res.status(200).end();
      return;
    }

    // 尝试按 refresh_token 处理（除非明确提示为 access_token）
    if (hint !== 'access_token') {
      const rec = refresh.peek(token);
      if (rec) {
        refresh.revoke(token);
        refresh.revokeByJti(rec.jti);
      }
    }

    // 尝试按 access_token 处理（JWT → 取 jti 入黑名单）
    if (hint !== 'refresh_token') {
      const claims = auth.introspectToken(token) as { jti?: string } | null;
      const jti = claims?.jti;
      if (jti) revocation.add(jti);
    }

    // RFC7009 总是 200
    res.status(200).end();
  };
}
