/**
 * StateMachine — 12 维状态机与结算逻辑（领域层）。
 *
 * 提供：
 * - getState()：读取当前状态向量（克隆）。
 * - settleState()：每轮/定时衰减—饱和结算。
 * - applyConversationEvent(event)：按事件强度/标签推动相关维度，单事件增量封顶，裁剪 [0,1]。
 *
 * 幂等由上层 IdempotencyStore 保障（同一 event_id 重复调用不二次改写）。
 *
 * 设计假设 A4：v1 单用户单会话；预留多会话聚合接口（getState(sessionId) 后续扩展）。
 */

import type { ConversationEvent, DimensionKey, EventType, StateDelta, StateVector } from '../types/index.js';
import {
  BASELINE,
  DIMENSION_KEYS,
  HALF_LIFE_ROUNDS,
  MAX_DELTA_PER_EVENT,
  SATURATE_FLOOR,
} from '../config.js';
import { DecayCurve } from './decay.js';
import { buildStateVector, cloneVector } from './dimensions.js';

/** 事件类型 → 默认维度刺激映射（强度系数，正=提升，负=降低）。 */
const TYPE_BASE: Record<EventType, Partial<Record<DimensionKey, number>>> = {
  user_interaction: {
    possess: 0.3,
    monitor: 0.3,
    crave: 0.25,
    share: 0.2,
    curiosity: 0.15,
    social: 0.15,
    boredom: -0.3,
    anger: -0.2,
    grieve: -0.2,
  },
  user_note: {
    monitor: 0.3,
    share: 0.25,
    reflection: 0.2,
    curiosity: 0.1,
  },
  scheduled_interaction: {
    possess: 0.2,
    monitor: 0.25,
    crave: 0.2,
    share: 0.15,
  },
};

/** 标签 → 维度刺激映射（sign=±1）。 */
const TAG_MAP: Record<string, Array<{ dim: DimensionKey; sign: 1 | -1 }>> = {
  possessive: [{ dim: 'possess', sign: 1 }, { dim: 'monitor', sign: 1 }],
  miss: [{ dim: 'possess', sign: 1 }, { dim: 'monitor', sign: 1 }, { dim: 'crave', sign: 1 }],
  intimate: [{ dim: 'libido', sign: 1 }, { dim: 'crave', sign: 1 }],
  clingy: [{ dim: 'crave', sign: 1 }, { dim: 'share', sign: 1 }],
  share: [{ dim: 'share', sign: 1 }],
  curious: [{ dim: 'curiosity', sign: 1 }],
  playful: [{ dim: 'social', sign: 1 }, { dim: 'boredom', sign: -1 }],
  responsible: [{ dim: 'duty', sign: 1 }],
  reflect: [{ dim: 'reflection', sign: 1 }],
  sad: [{ dim: 'grieve', sign: 1 }],
  lonely: [{ dim: 'boredom', sign: 1 }],
  annoyed: [{ dim: 'anger', sign: 1 }],
  conflict: [{ dim: 'anger', sign: 1 }, { dim: 'grieve', sign: 1 }],
  happy: [{ dim: 'anger', sign: -1 }, { dim: 'grieve', sign: -1 }, { dim: 'boredom', sign: -1 }],
  comfort: [{ dim: 'anger', sign: -1 }, { dim: 'grieve', sign: -1 }, { dim: 'boredom', sign: -1 }],
};

/** 计算单维度对某事件的刺激量（已含强度加权，符号表示升降）。 */
function computeStim(key: DimensionKey, event: ConversationEvent): number {
  const intensity = clamp01(event.payload.intensity);
  let stim = 0;
  const typeBase = TYPE_BASE[event.type];
  if (typeBase[key] !== undefined) stim += (typeBase[key] as number) * intensity;
  for (const tag of event.payload.tags) {
    const maps = TAG_MAP[tag];
    if (!maps) continue;
    for (const m of maps) {
      if (m.dim === key) stim += m.sign * intensity;
    }
  }
  return stim;
}

/** 将数值裁剪到 [0,1]。 */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export interface StateMachineOptions {
  /** 初始状态（缺失维度补基线）。 */
  initial?: Partial<StateVector>;
  /** 基线值覆盖。 */
  baseline?: number;
  /** 半衰期覆盖。 */
  halfLife?: number;
  /** 时间戳来源（测试注入）。 */
  now?: Date;
}

export class StateMachine {
  private vector: StateVector;
  private readonly decay: DecayCurve;
  private readonly baseline: number;
  private readonly halfLife: number;

  constructor(opts: StateMachineOptions = {}) {
    this.decay = new DecayCurve();
    this.baseline = opts.baseline ?? BASELINE;
    this.halfLife = opts.halfLife ?? HALF_LIFE_ROUNDS;
    this.vector = buildStateVector(opts.initial, this.baseline, opts.now);
  }

  /** 读取当前状态向量（返回克隆，防止外部篡改）。 */
  getState(): StateVector {
    return cloneVector(this.vector);
  }

  /** 注入外部恢复的状态向量（用于从 state.jsonl 加载）。 */
  loadState(vector: StateVector): void {
    this.vector = cloneVector(vector);
  }

  /** 裁剪到 [0,1]。 */
  private clamp(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  /**
   * 结算一轮：未受刺激的维度向基线指数衰减；已饱和（>舒适带下限）维度
   * 在 [SATURATE_FLOOR, SATURATE_CEIL] 舒适带内缓降。
   */
  settleState(): StateVector {
    const next = {} as Record<DimensionKey, number>;
    for (const k of DIMENSION_KEYS) {
      const current = this.vector[k];
      let value: number;
      if (current >= SATURATE_FLOOR) {
        // 已饱和（含恰好等于下限的情形）：向舒适带下限缓降，避免边界突跌
        const factor = 1 - Math.pow(2, -1 / this.halfLife);
        value = current - (current - SATURATE_FLOOR) * factor;
      } else {
        // 未饱和：向基线衰减
        value = this.decay.decayStep(current, this.baseline, this.halfLife);
      }
      next[k] = this.clamp(value);
    }
    this.vector = {
      ...next,
      updatedAt: new Date().toISOString(),
      round: this.vector.round + 1,
    } as StateVector;
    return cloneVector(this.vector);
  }

  /**
   * 应用一次对话事件：仅推动受刺激维度，单事件单维度增量 ≤ MAX_DELTA_PER_EVENT，
   * 目标经 saturate() 锁入舒适带，结果裁剪 [0,1]。幂等由上层 IdempotencyStore 保障。
   */
  applyConversationEvent(event: ConversationEvent): StateDelta {
    const before = cloneVector(this.vector);
    const changed: DimensionKey[] = [];
    const next = {} as Record<DimensionKey, number>;

    for (const k of DIMENSION_KEYS) {
      const current = this.vector[k];
      const stim = computeStim(k, event);
      if (stim === 0) {
        // 未受刺激：保持（衰减由 settleState 负责）
        next[k] = current;
        continue;
      }
      const target = clamp01(this.baseline + stim);
      let value = current;
      if (target > current) {
        const delta = Math.min(MAX_DELTA_PER_EVENT, this.decay.saturate(target) - current);
        value = this.clamp(current + Math.max(0, delta));
      } else {
        const delta = Math.min(MAX_DELTA_PER_EVENT, current - target);
        value = this.clamp(current - Math.max(0, delta));
      }
      next[k] = value;
      if (Math.abs(value - current) > 1e-9) changed.push(k);
    }

    this.vector = {
      ...next,
      updatedAt: new Date().toISOString(),
      round: this.vector.round + 1,
    } as StateVector;

    return { changed, before, after: cloneVector(this.vector) };
  }
}
