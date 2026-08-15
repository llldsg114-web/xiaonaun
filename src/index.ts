/**
 * index.ts — 心屿心智引擎服务入口（传输层装配）。
 *
 * 装配：Express + StreamableHTTPServerTransport(MCP) + OAuth 2.1 Bearer 中间件。
 * 仅暴露 3 个 MCP 工具，所有安全边界由 Bridge / TokenMiddleware 保障。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { STORAGE_DIR, ENVELOPE_VERSION } from './config.js';
import { JsonlStore } from './storage/jsonlStore.js';
import { MemoryStore } from './storage/memoryStore.js';
import { IdempotencyStore } from './storage/idempotency.js';
import { StateMachine } from './state/stateMachine.js';
import { Bridge } from './mcp/bridge.js';
import { EnvelopeBuilder } from './mcp/envelope.js';
import { TokenMiddleware } from './auth/token.js';
import { OAuthServer } from './oauth/index.js';
import { AuditLog } from './observability/auditLog.js';
import { MindEngine, registerMcpTools } from './mcp/tools.js';

async function bootstrap(): Promise<void> {
  const storageDir = STORAGE_DIR;
  const store = new JsonlStore(storageDir);
  const memory = new MemoryStore(store);
  const idem = new IdempotencyStore(store);
  const state = new StateMachine();
  const bridge = new Bridge();
  const builder = new EnvelopeBuilder();
  const auth = new TokenMiddleware();
  const audit = new AuditLog(store);

  const engine = new MindEngine({ state, memory, idem, bridge, builder, auth, audit, topK: 5, stateStore: store });
  engine.restoreState();

  const app = express();
  app.use(express.json());

  // 标准 OAuth 2.1 授权服务器（/authorize /token /introspect /revoke）。
  // 复用既有 TokenMiddleware 实例，保证 JWT_SECRET / issuer 单一来源。
  const oauth = new OAuthServer(auth);
  oauth.register(app);

  // 注：旧的非标准 dev /token（裸 body 签发）已移除，统一由 OAuthServer 接管，
  // 避免双签发导致密钥/claim 分叉；3 个 MCP 工具的 verify 调用点保持不变。

  app.get('/health', (_req, res) => {
    res.json({ ok: true, engine: 'xinyu-mind-engine', envelope_version: ENVELOPE_VERSION });
  });

  // MCP Streamable HTTP 传输（无状态：不生成 sessionId）。
  //
  // 关键修复：无状态模式下，SDK 要求【每个请求】都新建一个
  // StreamableHTTPServerTransport（及对应的 McpServer）并调用 handleRequest。
  // 旧实现只创建单个 transport/server 实例并对所有请求复用，导致第二次
  // initialize 抛错并返回 500（引擎无日志）。
  //
  // engine 为单例（bootstrap 内唯一实例），多个请求各自的 McpServer 通过
  // registerMcpTools 共享同一 engine，从而保证状态（状态机/记忆/幂等）连续。
  const mcpEndpoint = process.env.MCP_ENDPOINT ?? '/mcp';

  /**
   * 为每个 /mcp 请求创建「全新」的 McpServer + transport，注册工具（共享 engine
   * 单例），connect 后处理请求；响应关闭时关闭 transport 与 server 释放资源。
   */
  const handleMcpRequest = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const server = new McpServer({ name: 'xinyu-mind-engine', version: ENVELOPE_VERSION });
    registerMcpTools(server, engine);

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

  app.post(mcpEndpoint, (req, res) => {
    void handleMcpRequest(req, res);
  });
  app.get(mcpEndpoint, (req, res) => {
    void handleMcpRequest(req, res);
  });
  app.delete(mcpEndpoint, (req, res) => {
    void handleMcpRequest(req, res);
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`[心屿] 心智引擎 MCP 服务已启动: http://localhost:${port}${mcpEndpoint}`);
    console.log(`[心屿] 存储目录: ${storageDir} ｜ 信封版本: ${ENVELOPE_VERSION}`);
  });
}

bootstrap().catch((err) => {
  console.error('[心屿] 启动失败:', err);
  process.exit(1);
});
