/**
 * app.ts — 可复用 Express 应用装配（Route B）。
 *
 * 抽出 createApp(engine, auth)，供 index.ts 启动与测试复用：
 * 装配 OAuth + /health + /mcp（POST/GET/DELETE + OPTIONS 预检），
 * 在 /mcp 串接 mcpAuthMiddleware，由 handleMcpRequest 保持每请求
 * 新建 McpServer+transport 的无状态模型（修复二次 initialize 500）。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import express, { type Express, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ENVELOPE_VERSION } from './config.js';
import { OAuthServer } from './oauth/index.js';
import type { AccountStore } from './oauth/accounts.js';
import type { SessionStore } from './oauth/session.js';
import { MindEngine, registerMcpTools } from './mcp/tools.js';
import { mcpAuthMiddleware } from './mcp/middleware.js';
import type { TokenMiddleware } from './auth/token.js';

/** 构建心屿心智引擎的 Express 应用。 */
export function createApp(
  engine: MindEngine,
  auth: TokenMiddleware,
  accounts?: AccountStore,
  sessions?: SessionStore,
): Express {
  const app = express();
  app.use(express.json());

  // 标准 OAuth 2.1 授权服务器（/login /authorize /token /introspect /revoke /userinfo）。
  // 复用既有 TokenMiddleware 实例，保证 JWT_SECRET / issuer 单一来源。
  // accounts / sessions 可空：OAuthServer 内部兜底，向后兼容既有 createApp(engine, auth)。
  const oauth = new OAuthServer(auth, { accounts, sessions });
  oauth.register(app);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, engine: 'xinyu-mind-engine', envelope_version: ENVELOPE_VERSION });
  });

  // MCP Streamable HTTP 传输（无状态：不生成 sessionId）。
  //
  // 关键修复：无状态模式下，SDK 要求【每个请求】都新建一个
  // StreamableHTTPServerTransport（及对应的 McpServer）并调用 handleRequest。
  // engine 为单例（createApp 调用方唯一实例），多个请求各自的 McpServer
  // 通过 registerMcpTools 共享同一 engine，保证状态连续。
  const mcpEndpoint = process.env.MCP_ENDPOINT ?? '/mcp';

  /**
   * 为每个 /mcp 请求创建「全新」的 McpServer + transport，注册工具（共享 engine
   * 单例，并注入本请求的 requestAuth），connect 后处理请求；响应关闭时释放资源。
   */
  const handleMcpRequest = async (req: Request, res: Response): Promise<void> => {
    const requestAuth = req.mcpAuth ?? null;
    const server = new McpServer({ name: 'xinyu-mind-engine', version: ENVELOPE_VERSION });
    registerMcpTools(server, engine, requestAuth);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    // 响应关闭时释放本请求独占的 transport 与 server（无状态：不保留会话）。
    const cleanup = (): void => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    };
    res.on('close', cleanup);
    res.on('finish', cleanup);

    // POST 携带 JSON-RPC body；GET/DELETE 无 body。
    if (req.method === 'POST') {
      await transport.handleRequest(req, res, req.body);
    } else {
      await transport.handleRequest(req, res);
    }
  };

  const guard = mcpAuthMiddleware(auth);
  app.options(mcpEndpoint, guard);
  app.post(mcpEndpoint, guard, (req, res) => {
    void handleMcpRequest(req, res);
  });
  app.get(mcpEndpoint, guard, (req, res) => {
    void handleMcpRequest(req, res);
  });
  app.delete(mcpEndpoint, guard, (req, res) => {
    void handleMcpRequest(req, res);
  });

  return app;
}
