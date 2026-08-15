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

import { STORAGE_DIR, ENVELOPE_VERSION, SCOPE_READ, SCOPE_WRITE } from './config.js';
import { JsonlStore } from './storage/jsonlStore.js';
import { MemoryStore } from './storage/memoryStore.js';
import { IdempotencyStore } from './storage/idempotency.js';
import { StateMachine } from './state/stateMachine.js';
import { Bridge } from './mcp/bridge.js';
import { EnvelopeBuilder } from './mcp/envelope.js';
import { TokenMiddleware } from './auth/token.js';
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

  // 开发用令牌签发端点（生产可接标准授权服务器）。
  app.post('/token', (req, res) => {
    const body = (req.body ?? {}) as { subject?: string; scopes?: string[] };
    const subject = body.subject ?? 'user';
    const scopes = body.scopes ?? [SCOPE_READ, SCOPE_WRITE];
    const token = auth.issue(subject, scopes);
    res.json({ access_token: token, token_type: 'Bearer', scopes });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, engine: 'xinyu-mind-engine', envelope_version: ENVELOPE_VERSION });
  });

  // MCP Streamable HTTP 传输（无状态：不生成 sessionId）。
  const mcpServer = new McpServer({ name: 'xinyu-mind-engine', version: ENVELOPE_VERSION });
  registerMcpTools(mcpServer, engine);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);

  const mcpEndpoint = process.env.MCP_ENDPOINT ?? '/mcp';
  app.post(mcpEndpoint, (req, res) => transport.handleRequest(req, res, req.body));
  app.get(mcpEndpoint, (req, res) => transport.handleRequest(req, res));
  app.delete(mcpEndpoint, (req, res) => transport.handleRequest(req, res));

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
