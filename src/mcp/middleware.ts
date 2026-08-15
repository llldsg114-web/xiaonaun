/**
 * middleware.ts — MCP Bearer 鉴权中间件（Route B）。
 *
 * 在 handleMcpRequest 之前完成 Bearer 校验：
 *   extractBearer → authenticate → 挂到 req.mcpAuth（RequestAuth | null）。
 *
 * 仅对 method=tools/call 且缺少/非法令牌的请求返回 HTTP 401；
 * initialize / tools/list / GET(SSE) / DELETE 无令牌亦放行（不破坏 MCP 契约）。
 *
 * 协议：MIT。100% 自研。
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TokenMiddleware } from '../auth/token.js';
import type { RequestAuth } from '../types/index.js';

// 扩展 Express Request，挂接 mcpAuth（请求级鉴权上下文）。
declare module 'express-serve-static-core' {
  interface Request {
    mcpAuth?: RequestAuth | null;
  }
}

/** 从请求解析 requestAuth（Bearer → authenticate）。无效/缺失返回 null。 */
export function resolveRequestAuth(req: Request, auth: TokenMiddleware): RequestAuth | null {
  const bearer = auth.extractBearer(req.headers.authorization);
  if (!bearer) return null;
  const outcome = auth.authenticate(bearer);
  if (!outcome.ok) return null;
  return { subject: outcome.subject, scopes: outcome.scopes };
}

/** 发送 HTTP 401（JSON-RPC 错误体，-32001）。 */
export function sendUnauthorized(res: Response, id: unknown): void {
  res.status(401).json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32001,
      message: 'Unauthorized: missing or invalid Bearer token',
    },
  });
}

/**
 * Express 中间件工厂：为 /mcp 装配 Bearer 鉴权。
 * - OPTIONS 预检：直接放行（204 + CORS 头，含 Authorization）。
 * - 其他请求：解析 requestAuth 挂到 req.mcpAuth。
 * - POST 且 body.method=tools/call 且无令牌 → 401（JSON-RPC 错误体）。
 */
export function mcpAuthMiddleware(auth: TokenMiddleware): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 预检：放行并补 CORS 头。
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.sendStatus(204);
      return;
    }

    const requestAuth = resolveRequestAuth(req, auth);
    req.mcpAuth = requestAuth;

    const body = (req.body ?? null) as { method?: string; id?: unknown } | null;
    if (req.method === 'POST' && body?.method === 'tools/call' && !requestAuth) {
      sendUnauthorized(res, body?.id);
      return;
    }

    next();
  };
}
