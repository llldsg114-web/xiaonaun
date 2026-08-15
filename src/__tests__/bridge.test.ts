/**
 * bridge.test.ts — P0-5 Bridge 安全边界单测。
 *
 * 覆盖：封锁通道（dreams/longing/autonomous）绝不外泄；仅三类通道被放行；
 * redact 不篡改状态向量；safety_flag 正确写入。
 */

import { describe, it, expect } from 'vitest';
import { Bridge } from '../mcp/bridge.js';
import { BRIDGE_BLOCKED_CHANNELS, DIMENSION_KEYS, BASELINE } from '../config.js';
import type { ContextEnvelope, StateVector } from '../types/index.js';

function makeEnvelope(extra?: Record<string, unknown>): ContextEnvelope {
  const v: Record<string, number> = {};
  for (const k of DIMENSION_KEYS) v[k] = BASELINE;
  const vector = { ...v, updatedAt: new Date().toISOString(), round: 1 } as StateVector;
  return {
    envelope_version: '1.0.0',
    session_id: 's1',
    generated_at: new Date().toISOString(),
    state_vector: vector,
    narrative: 'narrative-ok',
    memory_snippets: [],
    safety_flag: { bridge_mode: 'enforced', blocked_channels: [] },
    token_estimate: 10,
    ...extra,
  };
}

describe('P0-5 Bridge 安全边界', () => {
  it('isAllowedChannel 仅放行三类外部通道', () => {
    const bridge = new Bridge();
    for (const t of ['user_interaction', 'user_note', 'scheduled_interaction']) {
      expect(bridge.isAllowedChannel(t)).toBe(true);
    }
    for (const blocked of BRIDGE_BLOCKED_CHANNELS) {
      expect(bridge.isAllowedChannel(blocked)).toBe(false);
    }
    expect(bridge.isAllowedChannel('something_else')).toBe(false);
  });

  it('filterForUser 剥离顶层封锁通道键', () => {
    const bridge = new Bridge();
    const env = makeEnvelope({ dreams: { x: 1 }, longing: 'leak', autonomous: true });
    const out = bridge.filterForUser(env);
    expect(bridge.containsBlocked(out)).toBe(false);
    expect((out as Record<string, unknown>).dreams).toBeUndefined();
    expect((out as Record<string, unknown>).longing).toBeUndefined();
    expect((out as Record<string, unknown>).autonomous).toBeUndefined();
  });

  it('filterForUser 剥离嵌套封锁通道键', () => {
    const bridge = new Bridge();
    const env = makeEnvelope({
      memory_snippets: [{ id: 'm1', content: 'ok', tags: [], score: 0.5, dreams: 'nested-leak' }],
      meta: { autonomous: { deeper: 'x' } },
    });
    const out = bridge.filterForUser(env);
    expect(bridge.containsBlocked(out)).toBe(false);
  });

  it('filterForUser 始终写入 safety_flag（enforced + 封锁通道清单）', () => {
    const bridge = new Bridge();
    const out = bridge.filterForUser(makeEnvelope());
    expect(out.safety_flag.bridge_mode).toBe('enforced');
    expect(out.safety_flag.blocked_channels).toEqual([...BRIDGE_BLOCKED_CHANNELS]);
  });

  it('redact 不篡改 12 维状态向量', () => {
    const bridge = new Bridge();
    const v: Record<string, number> = {};
    for (const k of DIMENSION_KEYS) v[k] = 0.42;
    const vector = { ...v, updatedAt: new Date().toISOString(), round: 7 } as StateVector;
    const out = bridge.redact(vector);
    for (const k of DIMENSION_KEYS) expect(out[k]).toBeCloseTo(0.42, 6);
    expect(out.round).toBe(7);
  });

  it('即便上游误写入全部三类封锁通道，过滤后信封不含任何封锁键', () => {
    const bridge = new Bridge();
    const env = makeEnvelope({
      dreams: 1,
      longing: 2,
      autonomous: 3,
      nested: { dreams: 'a', longing: 'b', autonomous: 'c' },
    });
    const out = bridge.filterForUser(env);
    expect(out).not.toHaveProperty('dreams');
    expect(out).not.toHaveProperty('longing');
    expect(out).not.toHaveProperty('autonomous');
    // 仅禁止「以封锁通道为键」的字段；blocked_channels 数组中的名称是元数据，允许出现。
    expect(JSON.stringify(out)).not.toMatch(/"(dreams|longing|autonomous)":/);
  });
});
