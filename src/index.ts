/**
 * index.ts — 心屿心智引擎服务入口（传输层装配）。
 *
 * 装配：Express + StreamableHTTPServerTransport(MCP) + OAuth 2.1 Bearer 中间件。
 * 仅暴露 3 个 MCP 工具，所有安全边界由 Bridge / TokenMiddleware / mcpAuthMiddleware 保障。
 *
 * Route B：鉴权从 args.token 迁移到标准 Authorization: Bearer 头，
 * 由 createApp 内的 mcpAuthMiddleware 完成，再以闭包注入工具 handler。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import 'dotenv/config';
import { STORAGE_DIR, ENVELOPE_VERSION } from './config.js';
import { JsonlStore } from './storage/jsonlStore.js';
import { MemoryStore } from './storage/memoryStore.js';
import { IdempotencyStore } from './storage/idempotency.js';
import { StateMachine } from './state/stateMachine.js';
import { Bridge } from './mcp/bridge.js';
import { EnvelopeBuilder } from './mcp/envelope.js';
import { TokenMiddleware } from './auth/token.js';
import { AuditLog } from './observability/auditLog.js';
import { MindEngine } from './mcp/tools.js';
import { createApp } from './app.js';

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

  const engine = new MindEngine({ state, memory, idem, bridge, builder, audit, topK: 5, stateStore: store });
  engine.restoreState();

  const app = createApp(engine, auth);

  const mcpEndpoint = process.env.MCP_ENDPOINT ?? '/mcp';
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
