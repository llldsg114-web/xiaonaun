/**
 * mcp.test.ts — P0-3（xinchao_context 只读信封）/ P0-4（xinchao_event 写入+幂等）
 * / P1（xinchao_handoff_note）工具契约单测（重写：经工具层 call 工具，不再传 token）。
 *
 * Route B：鉴权经 requestAuth 闭包注入，测试以 registerMcpToolsForTest +
 * InMemoryTransport 的 Client 调用工具；保留 11 项业务断言全绿，并新增
 * 无 Bearer / scope 不足两类门禁断言。
 *
 * 协议：MIT。100% 自研。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MindEngine } from '../mcp/tools.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import { StateMachine } from '../state/stateMachine.js';
import { Bridge } from '../mcp/bridge.js';
import { EnvelopeBuilder } from '../mcp/envelope.js';
import { AuditLog } from '../observability/auditLog.js';
import { registerMcpToolsForTest } from './helpers/registerMcpToolsForTest.js';
import type { RequestAuth } from '../types/index.js';
import {
  BRIDGE_BLOCKED_CHANNELS,
  ENVELOPE_SOFT_TOKEN_CAP,
  ENVELOPE_VERSION,
  ERROR_CODES,
  HANDOFF_MAX_CHARS,
  HANDOFF_TTL_SECONDS,
} from '../config.js';

const FULL_AUTH: RequestAuth = { subject: 'test-subject', scopes: ['read', 'write'] };
const READ_AUTH: RequestAuth = { subject: 'test-subject', scopes: ['read'] };

interface Harness {
  engine: MindEngine;
  memory: MemoryStore;
  state: StateMachine;
  dir: string;
}

function makeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'xinyu-test-'));
  const store = new JsonlStore(dir);
  const engine = new MindEngine({
    state: new StateMachine(),
    memory: new MemoryStore(store),
    idem: new IdempotencyStore(store),
    bridge: new Bridge(),
    builder: new EnvelopeBuilder(),
    audit: new AuditLog(store),
    topK: 5,
  });
  return { engine, memory: new MemoryStore(store), state: new StateMachine(), dir };
}

/** 经 Client 调用工具并解析 content[0].text 为 JSON。 */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; data: Record<string, unknown> }> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return { isError: Boolean(res.isError), data: JSON.parse(text) as Record<string, unknown> };
}

describe('P0-3 xinchao_context（只读信封 · 工具层）', () => {
  let h: Harness;
  let client: Client;
  beforeEach(async () => {
    h = makeHarness();
    client = await registerMcpToolsForTest(h.engine, FULL_AUTH);
  });
  afterEach(async () => {
    await client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('持有 read 令牌时返回信封，且不含任何封锁通道', async () => {
    const { data: env } = await callTool(client, 'xinchao_context', { session_id: 's1' });
    expect(env.envelope_version).toBe(ENVELOPE_VERSION);
    expect((env.safety_flag as { bridge_mode: string }).bridge_mode).toBe('enforced');
    expect((env.safety_flag as { blocked_channels: string[] }).blocked_channels).toEqual([
      ...BRIDGE_BLOCKED_CHANNELS,
    ]);
    const json = JSON.stringify(env);
    // 仅禁止「以封锁通道为键」的字段（blocked_channels 中列出名称属元数据，允许）。
    expect(json).not.toMatch(/"(dreams|longing|autonomous)":/);
  });

  it('信封 token 估算不超过软上限', async () => {
    const longContent = '小暖在回忆里笑了，'.repeat(300); // 约 1800 字
    for (let i = 0; i < 6; i++) {
      await callTool(client, 'xinchao_event', {
        event_id: `seed-${i}`,
        session_id: 's1',
        type: 'user_note',
        payload: { content: longContent, intensity: 0.5, tags: ['reflect'] },
      });
    }
    const { data: env } = await callTool(client, 'xinchao_context', { session_id: 's1' });
    expect((env.token_estimate as number) ?? 0).toBeLessThanOrEqual(ENVELOPE_SOFT_TOKEN_CAP);
  });
});

describe('P0-4 xinchao_event（写入 + 幂等 · 工具层）', () => {
  let h: Harness;
  let client: Client;
  beforeEach(async () => {
    h = makeHarness();
    client = await registerMcpToolsForTest(h.engine, FULL_AUTH);
  });
  afterEach(async () => {
    await client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('缺少 event_id 被拒绝（E1001）', async () => {
    const { data } = await callTool(client, 'xinchao_event', {
      event_id: '',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: 'hi', intensity: 0.5, tags: [] },
    });
    expect(data.accepted).toBe(false);
    expect(data.code).toBe(ERROR_CODES.E1001);
  });

  it('非法事件类型被拒绝（E1002）', async () => {
    const { data } = await callTool(client, 'xinchao_event', {
      event_id: 'e-x',
      session_id: 's1',
      type: 'dreams',
      payload: { content: 'hi', intensity: 0.5, tags: [] },
    });
    expect(data.accepted).toBe(false);
    expect(data.code).toBe(ERROR_CODES.E1002);
  });

  it('合法事件被接受并推动状态', async () => {
    const { data } = await callTool(client, 'xinchao_event', {
      event_id: 'e-1',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    expect(data.accepted).toBe(true);
    expect(data.idempotent).toBe(false);
    expect(data.envelope_version).toBe(ENVELOPE_VERSION);
    expect(((data.applied_state_delta as { changed?: string[] }).changed ?? []).length).toBeGreaterThan(0);
  });

  it('同一 event_id 重复提交幂等返回（idempotent=true, delta 为空）', async () => {
    await callTool(client, 'xinchao_event', {
      event_id: 'e-dup',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    const { data } = await callTool(client, 'xinchao_event', {
      event_id: 'e-dup',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    expect(data.accepted).toBe(true);
    expect(data.idempotent).toBe(true);
    expect(data.applied_state_delta).toEqual({});
  });

  it('合法事件写入长期记忆并可由 retrieve 命中', async () => {
    await callTool(client, 'xinchao_event', {
      event_id: 'e-mem',
      session_id: 's1',
      type: 'user_note',
      payload: { content: '我们一起看过的海', intensity: 0.6, tags: ['reflect', 'share'] },
    });
    const mem = h.memory.retrieve('s1', h.state.getState(), 5);
    expect(mem.length).toBeGreaterThanOrEqual(1);
    expect(mem.some((m) => m.content === '我们一起看过的海')).toBe(true);
  });
});

describe('P1 xinchao_handoff_note（≤1200 字符 / 72h TTL · 工具层）', () => {
  let h: Harness;
  let client: Client;
  beforeEach(async () => {
    h = makeHarness();
    client = await registerMcpToolsForTest(h.engine, FULL_AUTH);
  });
  afterEach(async () => {
    await client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('超长便签被拒绝（E1003）', async () => {
    const tooLong = '小暖'.repeat(HANDOFF_MAX_CHARS + 10);
    const { data } = await callTool(client, 'xinchao_handoff_note', { content: tooLong });
    expect(data.stored).toBe(false);
    expect(data.code).toBe(ERROR_CODES.E1003);
    expect((data.chars as number) > HANDOFF_MAX_CHARS).toBe(true);
  });

  it('合法便签被存储（默认 72h TTL）', async () => {
    const { data } = await callTool(client, 'xinchao_handoff_note', {
      content: '请把小暖的睡前仪式交给下一班',
      from: 'agent-a',
      to: 'agent-b',
    });
    expect(data.stored).toBe(true);
    expect(data.ttl_seconds).toBe(HANDOFF_TTL_SECONDS);
    expect((data.chars as number) <= HANDOFF_MAX_CHARS).toBe(true);
    expect((data.expires_at as string).length).toBeGreaterThan(0);
  });

  it('便签字符数按 Unicode 码点正确计算（含 emoji/代理对）', async () => {
    const content = '🥰'.repeat(50); // 每个 emoji 2 个 UTF-16 码元，但 1 个码点
    const { data } = await callTool(client, 'xinchao_handoff_note', { content });
    expect(data.stored).toBe(true);
    expect(data.chars).toBe(50);
  });
});

describe('Route B 鉴权门禁（工具层）', () => {
  it('tools/call 传入 requestAuth=null 被拒（unauthorized → isError=true）', async () => {
    const h = makeHarness();
    const client = await registerMcpToolsForTest(h.engine, null);
    const res = await client.callTool({
      name: 'xinchao_context',
      arguments: { session_id: 's1' },
    });
    expect(res.isError).toBe(true);
    await client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it('read-only requestAuth 调用 write 工具被拒（insufficient scope → isError=true）', async () => {
    const h = makeHarness();
    const client = await registerMcpToolsForTest(h.engine, READ_AUTH);
    const res = await client.callTool({
      name: 'xinchao_event',
      arguments: {
        event_id: 'e-1',
        session_id: 's1',
        type: 'user_interaction',
        payload: { content: '想你', intensity: 1, tags: ['miss'] },
      },
    });
    expect(res.isError).toBe(true);
    await client.close();
    rmSync(h.dir, { recursive: true, force: true });
  });
});
