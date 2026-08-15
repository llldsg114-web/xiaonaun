/**
 * session.test.ts — v2 ① 多会话隔离（回归 + 新增断言）。
 *
 * 验证 SessionRegistry 按 (subject, session_id) 隔离：
 * - 同用户两会话状态/记忆互不污染；
 * - 两用户（sub 维度）独立落盘；
 * - 跨请求同键复用缓存（状态连续）；
 * - 重启后从 state-<sub>-<sid>.jsonl 恢复末态。
 *
 * 全部使用 mkdtemp 临时目录，避免污染 .data/；测试后清理。
 *
 * 协议：MIT。100% 自研。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MindEngine } from '../mcp/tools.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { Bridge } from '../mcp/bridge.js';
import { EnvelopeBuilder } from '../mcp/envelope.js';
import { AuditLog } from '../observability/auditLog.js';
import type { RequestAuth } from '../types/index.js';
import { BASELINE } from '../config.js';

/** 构造无默认包的引擎（每个键都走命名空间隔离），落盘到临时目录。 */
function makeEngine(): { engine: MindEngine; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xinyu-sess-'));
  const store = new JsonlStore(dir);
  const engine = new MindEngine({
    bridge: new Bridge(),
    builder: new EnvelopeBuilder(),
    audit: new AuditLog(store),
    topK: 5,
    stateStore: store,
  });
  return { engine, dir };
}

const FULL = (subject: string): RequestAuth => ({ subject, scopes: ['read', 'write'] });

describe('① 多会话隔离（SessionRegistry）', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('同用户两会话独立（状态 + 记忆互不串）', () => {
    const { engine, dir } = makeEngine();
    dirs.push(dir);
    const auth = FULL('alice');

    // A 收到 miss 事件（抬升 possess）；B 收到 happy 事件（压低 anger）。
    engine.handleXinchaoEvent(
      { event_id: 'eA', session_id: 'A', type: 'user_interaction', payload: { content: '想你', intensity: 1, tags: ['miss'] } },
      auth,
    );
    engine.handleXinchaoEvent(
      { event_id: 'eB', session_id: 'B', type: 'user_note', payload: { content: '今天很开心', intensity: 1, tags: ['happy'] } },
      auth,
    );

    const sA = engine.getSession('alice', 'A').state.getState();
    const sB = engine.getSession('alice', 'B').state.getState();

    expect(sA.possess).toBeGreaterThan(BASELINE);
    expect(sB.anger).toBeLessThan(BASELINE);

    const memA = engine.getSession('alice', 'A').memory.retrieve('A', sA, 5);
    const memB = engine.getSession('alice', 'B').memory.retrieve('B', sB, 5);
    expect(memA.some((m) => m.content === '想你')).toBe(true);
    expect(memB.some((m) => m.content === '今天很开心')).toBe(true);
    expect(memA.some((m) => m.content === '今天很开心')).toBe(false);
    expect(memB.some((m) => m.content === '想你')).toBe(false);
  });

  it('两用户独立（sub 维度落差分文件）', () => {
    const { engine, dir } = makeEngine();
    dirs.push(dir);

    engine.handleXinchaoEvent(
      { event_id: 'ea', session_id: 'x', type: 'user_interaction', payload: { content: 'a想你', intensity: 1, tags: ['miss'] } },
      FULL('alice'),
    );
    engine.handleXinchaoEvent(
      { event_id: 'eb', session_id: 'x', type: 'user_interaction', payload: { content: 'b想你', intensity: 1, tags: ['miss'] } },
      FULL('bob'),
    );

    const sAlice = engine.getSession('alice', 'x').state.getState();
    const sBob = engine.getSession('bob', 'x').state.getState();
    expect(sAlice.possess).toBeGreaterThan(BASELINE);
    expect(sBob.possess).toBeGreaterThan(BASELINE);

    const memAlice = engine.getSession('alice', 'x').memory.retrieve('x', sAlice, 5);
    const memBob = engine.getSession('bob', 'x').memory.retrieve('x', sBob, 5);
    expect(memAlice.some((m) => m.content === 'a想你')).toBe(true);
    expect(memBob.some((m) => m.content === 'b想你')).toBe(true);
    expect(memAlice.some((m) => m.content === 'b想你')).toBe(false);
    expect(memBob.some((m) => m.content === 'a想你')).toBe(false);
  });

  it('跨请求同键复用缓存（状态连续）', () => {
    const { engine, dir } = makeEngine();
    dirs.push(dir);
    const auth = FULL('alice');

    const b1 = engine.getSession('alice', 'A');
    const b2 = engine.getSession('alice', 'A');
    expect(b1).toBe(b2); // 同一引用 → 缓存命中

    engine.handleXinchaoEvent(
      { event_id: 'e1', session_id: 'A', type: 'user_interaction', payload: { content: 'a', intensity: 1, tags: ['miss'] } },
      auth,
    );
    const after1 = engine.getSession('alice', 'A').state.getState();
    engine.handleXinchaoEvent(
      { event_id: 'e2', session_id: 'A', type: 'user_interaction', payload: { content: 'a', intensity: 1, tags: ['miss'] } },
      auth,
    );
    const after2 = engine.getSession('alice', 'A').state.getState();

    // 连续两次事件落在同一状态机，round 严格递增（状态连续）。
    expect(after2.round).toBeGreaterThan(after1.round);
  });

  it('重启后从 state-<sub>-<sid>.jsonl 恢复末态', () => {
    const { engine, dir } = makeEngine();
    dirs.push(dir);

    engine.handleXinchaoEvent(
      { event_id: 'e1', session_id: 'A', type: 'user_interaction', payload: { content: 'a', intensity: 1, tags: ['miss'] } },
      FULL('alice'),
    );
    const before = engine.getSession('alice', 'A').state.getState();
    expect(before.possess).toBeGreaterThan(BASELINE);

    // 模拟重启：全新引擎，复用同一存储目录。
    const store2 = new JsonlStore(dir);
    const engine2 = new MindEngine({
      bridge: new Bridge(),
      builder: new EnvelopeBuilder(),
      audit: new AuditLog(store2),
      topK: 5,
      stateStore: store2,
    });
    const after = engine2.getSession('alice', 'A').state.getState();
    expect(after.possess).toBeGreaterThan(BASELINE);
    expect(after.possess).toBe(before.possess);
  });
});
