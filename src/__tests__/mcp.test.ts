/**
 * mcp.test.ts — P0-3（xinchao_context 只读信封）/ P0-4（xinchao_event 写入+幂等）
 * / P1（xinchao_handoff_note）工具契约单测。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MindEngine } from '../mcp/tools.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import { StateMachine } from '../state/stateMachine.js';
import { Bridge } from '../mcp/bridge.js';
import { EnvelopeBuilder } from '../mcp/envelope.js';
import { TokenMiddleware } from '../auth/token.js';
import { AuditLog } from '../observability/auditLog.js';
import {
  BRIDGE_BLOCKED_CHANNELS,
  ENVELOPE_SOFT_TOKEN_CAP,
  ENVELOPE_VERSION,
  ERROR_CODES,
  HANDOFF_MAX_CHARS,
  HANDOFF_TTL_SECONDS,
} from '../config.js';

interface Harness {
  engine: MindEngine;
  memory: MemoryStore;
  state: StateMachine;
  auth: TokenMiddleware;
  dir: string;
}

function makeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'xinyu-test-'));
  const store = new JsonlStore(dir);
  const auth = new TokenMiddleware('test-secret', 'test-issuer');
  const engine = new MindEngine({
    state: new StateMachine(),
    memory: new MemoryStore(store),
    idem: new IdempotencyStore(store),
    bridge: new Bridge(),
    builder: new EnvelopeBuilder(),
    auth,
    audit: new AuditLog(store),
    topK: 5,
  });
  return { engine, memory: new MemoryStore(store), state: new StateMachine(), auth, dir };
}

describe('P0-3 xinchao_context（只读信封）', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => rmSync(h.dir, { recursive: true, force: true }));

  it('缺少/无效令牌时拒绝（E1101）', () => {
    expect(() => h.engine.handleXinchaoContext({ session_id: 's1', token: '' })).toThrow();
    expect(() =>
      h.engine.handleXinchaoContext({ session_id: 's1', token: 'bad.token.here' }),
    ).toThrow();
  });

  it('持有 read 令牌时返回信封，且不含任何封锁通道', () => {
    const token = h.auth.issue('u', ['read']);
    const env = h.engine.handleXinchaoContext({ session_id: 's1', token });
    expect(env.envelope_version).toBe(ENVELOPE_VERSION);
    expect(env.safety_flag.bridge_mode).toBe('enforced');
    expect(env.safety_flag.blocked_channels).toEqual([...BRIDGE_BLOCKED_CHANNELS]);
    const json = JSON.stringify(env);
    // 仅禁止「以封锁通道为键」的字段（blocked_channels 中列出名称属元数据，允许）。
    expect(json).not.toMatch(/"(dreams|longing|autonomous)":/);
  });

  it('信封 token 估算不超过软上限', () => {
    // 写入若干长记忆，验证 trimMemories 保底不超包
    const token = h.auth.issue('u', ['read', 'write']);
    const longContent = '小暖在回忆里笑了，'.repeat(300); // 约 1800 字
    for (let i = 0; i < 6; i++) {
      h.engine.handleXinchaoEvent({
        event_id: `seed-${i}`,
        session_id: 's1',
        type: 'user_note',
        token,
        payload: { content: longContent, intensity: 0.5, tags: ['reflect'] },
      });
    }
    const env = h.engine.handleXinchaoContext({ session_id: 's1', token });
    expect(env.token_estimate).toBeLessThanOrEqual(ENVELOPE_SOFT_TOKEN_CAP);
  });
});

describe('P0-4 xinchao_event（写入 + 幂等）', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => rmSync(h.dir, { recursive: true, force: true }));

  it('缺少 event_id 被拒绝（E1001）', () => {
    const token = h.auth.issue('u', ['write']);
    const r = h.engine.handleXinchaoEvent({
      event_id: '',
      session_id: 's1',
      type: 'user_interaction',
      token,
      payload: { content: 'hi', intensity: 0.5, tags: [] },
    });
    expect(r.accepted).toBe(false);
    expect(r.code).toBe(ERROR_CODES.E1001);
  });

  it('非法事件类型被拒绝（E1002）', () => {
    const token = h.auth.issue('u', ['write']);
    const r = h.engine.handleXinchaoEvent({
      event_id: 'e-x',
      session_id: 's1',
      type: 'dreams' as never,
      token,
      payload: { content: 'hi', intensity: 0.5, tags: [] },
    });
    expect(r.accepted).toBe(false);
    expect(r.code).toBe(ERROR_CODES.E1002);
  });

  it('合法事件被接受并推动状态', () => {
    const token = h.auth.issue('u', ['write']);
    const r = h.engine.handleXinchaoEvent({
      event_id: 'e-1',
      session_id: 's1',
      type: 'user_interaction',
      token,
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    expect(r.accepted).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(r.envelope_version).toBe(ENVELOPE_VERSION);
    expect((r.applied_state_delta as { changed: string[] }).changed.length).toBeGreaterThan(0);
  });

  it('同一 event_id 重复提交幂等返回（idempotent=true, delta 为空）', () => {
    const token = h.auth.issue('u', ['write']);
    const first = h.engine.handleXinchaoEvent({
      event_id: 'e-dup',
      session_id: 's1',
      type: 'user_interaction',
      token,
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    expect(first.idempotent).toBe(false);
    const second = h.engine.handleXinchaoEvent({
      event_id: 'e-dup',
      session_id: 's1',
      type: 'user_interaction',
      token,
      payload: { content: '想你', intensity: 1, tags: ['miss'] },
    });
    expect(second.accepted).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.applied_state_delta).toEqual({});
  });

  it('合法事件写入长期记忆并可由 retrieve 命中', () => {
    const token = h.auth.issue('u', ['write']);
    h.engine.handleXinchaoEvent({
      event_id: 'e-mem',
      session_id: 's1',
      type: 'user_note',
      token,
      payload: { content: '我们一起看过的海', intensity: 0.6, tags: ['reflect', 'share'] },
    });
    const mem = h.memory.retrieve('s1', h.state.getState(), 5);
    expect(mem.length).toBeGreaterThanOrEqual(1);
    expect(mem.some((m) => m.content === '我们一起看过的海')).toBe(true);
  });
});

describe('P1 xinchao_handoff_note（≤1200 字符 / 72h TTL）', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => rmSync(h.dir, { recursive: true, force: true }));

  it('超长便签被拒绝（E1003）', () => {
    const token = h.auth.issue('u', ['write']);
    const tooLong = '小暖'.repeat(HANDOFF_MAX_CHARS + 10);
    const r = h.engine.handleHandoffNote({ content: tooLong, token });
    expect(r.stored).toBe(false);
    expect(r.code).toBe(ERROR_CODES.E1003);
    expect(r.chars).toBeGreaterThan(HANDOFF_MAX_CHARS);
  });

  it('合法便签被存储（默认 72h TTL）', () => {
    const token = h.auth.issue('u', ['write']);
    const r = h.engine.handleHandoffNote({
      content: '请把小暖的睡前仪式交给下一班',
      from: 'agent-a',
      to: 'agent-b',
      token,
    });
    expect(r.stored).toBe(true);
    expect(r.ttl_seconds).toBe(HANDOFF_TTL_SECONDS);
    expect(r.chars).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(r.expires_at.length).toBeGreaterThan(0);
  });

  it('便签字符数按 Unicode 码点正确计算（含 emoji/代理对）', () => {
    const token = h.auth.issue('u', ['write']);
    const content = '🥰'.repeat(50); // 每个 emoji 2 个 UTF-16 码元，但 1 个码点
    const r = h.engine.handleHandoffNote({ content, token });
    expect(r.stored).toBe(true);
    expect(r.chars).toBe(50);
  });
});
