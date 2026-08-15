/**
 * index.ts — OAuthServer 组合根（P0-4 / P1 接线）。
 *
 * 聚合全部领域服务（ClientStore / CodeStore / RefreshStore / RevocationStore /
 * PkceUtil / ConsentPage）与既有 TokenMiddleware（单一密钥来源），通过
 * register(app) 挂载 4 条标准路由：/authorize /token /introspect /revoke。
 *
 * 安全收尾：/token /introspect /revoke 启用 CORS（v1 仅放行配置来源）；
 * 启动定时清理过期授权码 / refresh。不触碰 /mcp 与 3 个 MCP 工具。
 *
 * 协议：MIT。100% 自研。
 */

import express, { type Express, type NextFunction, type Request, type Response, type RequestHandler } from 'express';
import { CORS_ALLOWED_ORIGINS, OAUTH_AUTO_CONSENT } from '../config.js';
import type { TokenMiddleware } from '../auth/token.js';
import { ClientStore } from './clients.js';
import { CodeStore, RefreshStore, RevocationStore } from './store.js';
import { PkceUtil } from './pkce.js';
import { ConsentPage } from './consent.js';
import { createAuthorizeHandler } from './authorize.js';
import { createTokenHandler } from './token.js';
import { createIntrospectHandler } from './introspect.js';
import { createRevokeHandler } from './revoke.js';

/**
 * CORS 中间件工厂：仅放行配置的 origins；处理 OPTIONS 预检。
 * 不返回 '*'（避免与凭据冲突），而是反射具体来源。
 */
function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * 心屿标准 OAuth 2.1 授权服务器。
 */
export class OAuthServer {
  private readonly clientStore: ClientStore;
  private readonly codeStore: CodeStore;
  private readonly refreshStore: RefreshStore;
  private readonly revocationStore: RevocationStore;
  private readonly pkce: PkceUtil;
  private readonly consent: ConsentPage;
  private readonly auth: TokenMiddleware;
  /** jti → client_id 映射（供 /introspect 回带）。 */
  private readonly accessMeta = new Map<string, { client_id: string }>();

  constructor(auth: TokenMiddleware) {
    this.auth = auth;
    this.clientStore = new ClientStore();
    this.codeStore = new CodeStore();
    this.refreshStore = new RefreshStore();
    this.revocationStore = new RevocationStore();
    this.pkce = new PkceUtil();
    this.consent = new ConsentPage();

    // 定时清理过期授权码 / refresh（不阻塞进程退出）。
    const timer = setInterval(() => {
      this.codeStore.sweep();
      this.refreshStore.sweep();
    }, 60_000);
    timer.unref();
  }

  /** 将 4 条标准 OAuth 路由挂载到 Express app。 */
  register(app: Express): void {
    const json = express.json();
    const urlencoded = express.urlencoded({ extended: false });
    const cors = corsMiddleware(CORS_ALLOWED_ORIGINS);

    const authorizeHandler = createAuthorizeHandler({
      clients: this.clientStore,
      code: this.codeStore,
      pkce: this.pkce,
      consent: this.consent,
      autoConsent: OAUTH_AUTO_CONSENT,
    });
    const tokenHandler = createTokenHandler({
      clients: this.clientStore,
      code: this.codeStore,
      refresh: this.refreshStore,
      pkce: this.pkce,
      auth: this.auth,
      accessMeta: this.accessMeta,
    });
    const introspectHandler = createIntrospectHandler({
      auth: this.auth,
      refresh: this.refreshStore,
      revocation: this.revocationStore,
      accessMeta: this.accessMeta,
    });
    const revokeHandler = createRevokeHandler({
      auth: this.auth,
      refresh: this.refreshStore,
      revocation: this.revocationStore,
    });

    // 授权端点：GET 渲染 / POST 一键允许（表单需 urlencoded）
    app.use('/authorize', urlencoded);
    app.get('/authorize', authorizeHandler);
    app.post('/authorize', authorizeHandler);

    // 令牌端点：JSON + 表单 + CORS（前端 localhost:3000 跨域）
    app.use('/token', json);
    app.use('/token', urlencoded);
    app.use('/token', cors);
    app.post('/token', tokenHandler);

    // 自检端点：CORS
    app.use('/introspect', json);
    app.use('/introspect', urlencoded);
    app.use('/introspect', cors);
    app.post('/introspect', introspectHandler);

    // 吊销端点：CORS
    app.use('/revoke', json);
    app.use('/revoke', urlencoded);
    app.use('/revoke', cors);
    app.post('/revoke', revokeHandler);
  }
}
