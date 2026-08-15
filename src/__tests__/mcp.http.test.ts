/**
 * mcp.http.test.ts — MCP HTTP Bearer 门禁端到端验证（Route B，零额外依赖）。
 *
 * 用 Node >=18 自带 fetch 打 createApp 起的临时端口（listen(0)）：
 * - OPTIONS /mcp → 204 且 Access-Control-Allow-Headers 含 Authorization。
 * - POST /mcp tools/call 无 Authorization → 401（JSON-RPC error code -32001）。
 * - POST /mcp tools/call 带有效 Bearer → 200（JSON-RPC result）。
 * - GET /mcp 无令牌 → 非 401（放行，无状态每请求模型）。
 *
 * 不引入 supertest；STORAGE_DIR 指向 mkdtemp 临时目录，测试后清理。
 *
 * 协议：MIT。100% 自研。
 */

import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenMiddleware } from '../auth/token.js';
import { MindEngine } from '../mcp/tools.js';
import { createApp } from '../app.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import { StateMachine } from '../state/stateMachine.js';
import { Bridge } from '../mcp/bridge.js';
import { EnvelopeBuilder } from '../mcp/envelope.js';
import { AuditLog } from '../observability/auditLog.js';
import { makeMcpTokens } from './fixtures/mcpTokens.js';

const MCP_ENDPOINT = '/mcp';

describe('MCP HTTP Bearer gate (Route B)', () => {
  let server: Server;
  let baseUrl: string;
  let tokens: ReturnType<typeof makeMcpTokens>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xinyu-http-'));
    process.env.STORAGE_DIR = dir;

    const store = new JsonlStore(dir);
    const auth = new TokenMiddleware('test-secret', 'test-issuer');
    const engine = new MindEngine({
      state: new StateMachine(),
      memory: new MemoryStore(store),
      idem: new IdempotencyStore(store),
      bridge: new Bridge(),
      builder: new EnvelopeBuilder(),
      audit: new AuditLog(store),
      topK: 5,
    });
    tokens = makeMcpTokens('test-secret', 'test-issuer');

    const app = createApp(engine, auth);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}${MCP_ENDPOINT}`;
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.STORAGE_DIR;
  });

  it('OPTIONS /mcp 返回 204 且 CORS 头含 Authorization', async () => {
    const res = await fetch(baseUrl, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders.toLowerCase()).toContain('authorization');
  });

  it('POST /mcp tools/call 无 Authorization → 401（JSON-RPC error -32001）', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'xinchao_context', arguments: { session_id: 's1' } },
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      jsonrpc: string;
      id: unknown;
      error: { code: number; message: string };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toContain('Unauthorized');
  });

  it('POST /mcp tools/call 带有效 Bearer → 200（JSON-RPC result）', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${tokens.valid}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'xinchao_context', arguments: { session_id: 's1' } },
      }),
    });
    expect(res.status).toBe(200);
    // StreamableHTTP 可能以 application/json 或 text/event-stream(SSE) 响应，
    // 统一从响应体提取 JSON-RPC 负载（兼容两种形态）。
    const raw = await res.text();
    const dataLines = raw
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    const jsonText = dataLines.length > 0 ? dataLines[0] : raw;
    const body = JSON.parse(jsonText) as { jsonrpc: string; id: unknown; result?: unknown };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(2);
    expect(body.result).toBeDefined();
  });

  it('GET /mcp 无令牌不被 401 拦截（无状态每请求模型放行）', async () => {
    const res = await fetch(baseUrl, { method: 'GET' });
    expect(res.status).not.toBe(401);
    // 释放可能打开的 SSE 流，避免 afterAll 关闭端口时挂起。
    await res.body?.cancel?.().catch(() => undefined);
  });
});
