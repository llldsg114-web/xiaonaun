/**
 * state.test.ts — P0-1（12 维定义）/ P0-2（结算与幂等接口）单测。
 */

import { describe, it, expect } from 'vitest';
import { StateMachine } from '../state/stateMachine.js';
import { DecayCurve } from '../state/decay.js';
import {
  DIMENSION_KEYS,
  BASELINE,
  MAX_DELTA_PER_EVENT,
  SATURATE_CEIL,
  SATURATE_FLOOR,
  HALF_LIFE_ROUNDS,
} from '../config.js';
import type { ConversationEvent } from '../types/index.js';

describe('P0-1 12 维定义', () => {
  it('维度键名为固定 12 个且顺序一致', () => {
    expect(DIMENSION_KEYS).toHaveLength(12);
    expect(DIMENSION_KEYS).toEqual([
      'possess',
      'monitor',
      'crave',
      'share',
      'libido',
      'curiosity',
      'boredom',
      'social',
      'duty',
      'reflection',
      'grieve',
      'anger',
    ]);
  });

  it('默认状态向量所有 12 维 ∈ [0,1] 且为基线', () => {
    const sm = new StateMachine();
    const v = sm.getState();
    for (const k of DIMENSION_KEYS) {
      expect(v[k]).toBeGreaterThanOrEqual(0);
      expect(v[k]).toBeLessThanOrEqual(1);
      expect(v[k]).toBeCloseTo(BASELINE, 6);
    }
    expect(v.round).toBe(0);
  });
});

describe('P0-2 衰减—饱和结算', () => {
  it('settleState 使高维向舒适带下限缓降且不破带', () => {
    // 人工注入一个高于舒适带的维度
    const sm = new StateMachine({
      initial: { possess: 0.95 } as never,
    });
    let v = sm.getState();
    expect(v.possess).toBeCloseTo(0.95, 6);
    for (let i = 0; i < 3; i++) v = sm.settleState();
    expect(v.possess).toBeLessThan(0.95);
    expect(v.possess).toBeGreaterThanOrEqual(SATURATE_FLOOR - 1e-9);
  });

  it('settleState 使低维（高于基线以下）向基线衰减但不超过基线', () => {
    const sm = new StateMachine({ initial: { anger: 0.05 } as never });
    const v = sm.settleState();
    expect(v.anger).toBeGreaterThan(0.05);
    expect(v.anger).toBeLessThanOrEqual(BASELINE + 1e-9);
  });

  it('applyConversationEvent 仅推动受刺激维度', () => {
    const sm = new StateMachine();
    const event: ConversationEvent = {
      event_id: 'e1',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: 'hi', intensity: 1, tags: ['miss'] },
      timestamp: new Date().toISOString(),
    };
    const delta = sm.applyConversationEvent(event);
    // miss 影响 possess/monitor/crave；user_interaction 还影响 share 等
    expect(delta.changed.length).toBeGreaterThan(0);
    // boredom/anger/grieve 应被降低（在 changed 中）
    expect(delta.changed).toContain('possess');
    expect(delta.changed).toContain('boredom');
  });

  it('applyConversationEvent 单维度增量 ≤ MAX_DELTA_PER_EVENT 且裁剪 [0,1]', () => {
    const sm = new StateMachine();
    const event: ConversationEvent = {
      event_id: 'e2',
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: 'hi', intensity: 1, tags: ['miss', 'intimate', 'clingy', 'playful'] },
      timestamp: new Date().toISOString(),
    };
    const delta = sm.applyConversationEvent(event);
    for (const k of delta.changed) {
      const diff = Math.abs(delta.after[k] - delta.before[k]);
      expect(diff).toBeLessThanOrEqual(MAX_DELTA_PER_EVENT + 1e-9);
      expect(delta.after[k]).toBeGreaterThanOrEqual(0);
      expect(delta.after[k]).toBeLessThanOrEqual(1);
    }
  });

  it('饱和裁剪：仅封顶 SATURATE_CEIL，不再钳制下限', () => {
    const curve = new DecayCurve();
    // 高于舒适带 → 封顶 SATURATE_CEIL
    expect(curve.saturate(1)).toBeCloseTo(SATURATE_CEIL, 6);
    expect(curve.saturate(0.9)).toBeCloseTo(SATURATE_CEIL, 6);
    // 低于舒适带 → 保持原值（不再被强制抬到 SATURATE_FLOOR），弱刺激自然过渡
    expect(curve.saturate(0.5)).toBeCloseTo(0.5, 6);
    expect(curve.saturate(0.3)).toBeCloseTo(0.3, 6);
  });

  it('衰减步进：单步按半衰期因子向基线移动', () => {
    const curve = new DecayCurve();
    const factor = 1 - Math.pow(2, -1 / HALF_LIFE_ROUNDS);
    const next = curve.decayStep(1, BASELINE, HALF_LIFE_ROUNDS);
    // next = current + (baseline - current) * factor
    expect(next).toBeCloseTo(1 + (BASELINE - 1) * factor, 6);
    expect(next).toBeGreaterThan(BASELINE);
    expect(next).toBeLessThan(1);
  });

  it('重复 applyConversationEvent 随时间累积（幂等由上层 IdempotencyStore 保障）', () => {
    const sm = new StateMachine();
    const mk = (id: string): ConversationEvent => ({
      event_id: id,
      session_id: 's1',
      type: 'user_interaction',
      payload: { content: 'hi', intensity: 1, tags: ['miss'] },
      timestamp: new Date().toISOString(),
    });
    const d1 = sm.applyConversationEvent(mk('e-a'));
    const d2 = sm.applyConversationEvent(mk('e-b'));
    // 两次事件使 possess 持续上升（未达上限前）
    expect(d2.after.possess).toBeGreaterThan(d1.after.possess);
  });

  it('#2 强度生效：低 intensity 推动结果值 < 高 intensity 推动结果值', () => {
    // user_note 的 curiosity 基系数 0.1 且无标签时仅由该系数驱动，
    // 其正向增量（0.02~0.1）恒小于 MAX_DELTA_PER_EVENT，可隔离观察 intensity 的驱动效果。
    const mk = (intensity: number): ConversationEvent => ({
      event_id: `int-${intensity}`,
      session_id: 's1',
      type: 'user_note',
      payload: { content: '在想什么', intensity, tags: [] },
      timestamp: new Date().toISOString(),
    });
    const low = new StateMachine();
    const high = new StateMachine();
    const dLow = low.applyConversationEvent(mk(0.2));
    const dHigh = high.applyConversationEvent(mk(1));
    // 强度真正生效：弱刺激结果值应低于强刺激，而非两者均被强制抬到同一下限
    expect(dLow.after.curiosity).toBeLessThan(dHigh.after.curiosity);
  });

  it('#3 边界：settleState 当前值恰等于 SATURATE_FLOOR 时稳于带内不突跌', () => {
    const sm = new StateMachine({ initial: { possess: SATURATE_FLOOR } as never });
    const before = sm.getState().possess;
    expect(before).toBeCloseTo(SATURATE_FLOOR, 6);
    const after = sm.settleState().possess;
    // 恰好等于下限应走「已饱和维缓降」分支稳住，不向基线衰减（>= 而非 >）
    expect(after).toBeCloseTo(SATURATE_FLOOR, 6);
  });
});
