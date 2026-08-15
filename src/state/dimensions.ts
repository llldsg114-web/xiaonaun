/**
 * dimensions — 12 维定义与默认状态向量构建。
 *
 * 维度键名顺序固定（见 config.DIMENSION_KEYS），序列化/反序列化必须一致。
 */

import type { DimensionKey, StateVector } from '../types/index.js';
import { BASELINE, DIMENSION_KEYS, DIMENSION_LABELS } from '../config.js';

export { DIMENSION_KEYS, DIMENSION_LABELS };

/** 维度数量（固定 12）。 */
export const DIMENSION_COUNT = DIMENSION_KEYS.length;

/** 克隆一个状态向量（深拷贝 12 维 + 元字段）。 */
export function cloneVector(v: StateVector): StateVector {
  const out = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) out[k] = v[k];
  return { ...out, updatedAt: v.updatedAt, round: v.round } as StateVector;
}

/**
 * 构建默认状态向量：所有 12 维归基线，round=0。
 * @param baseline 基线值（默认取 config.BASELINE）。
 * @param now 时间戳来源（测试可注入）。
 */
export function defaultStateVector(
  baseline: number = BASELINE,
  now: Date = new Date(),
): StateVector {
  const out = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) out[k] = baseline;
  return { ...out, updatedAt: now.toISOString(), round: 0 } as StateVector;
}

/**
 * 从可能缺失的 Partial 输入构造完整状态向量，缺失维度补基线。
 * @param partial 部分状态（可能为 undefined）。
 * @param baseline 基线值。
 * @param now 时间戳来源。
 */
export function buildStateVector(
  partial: Partial<StateVector> | undefined,
  baseline: number = BASELINE,
  now: Date = new Date(),
): StateVector {
  const out = {} as Record<DimensionKey, number>;
  for (const k of DIMENSION_KEYS) out[k] = partial?.[k] ?? baseline;
  return {
    ...out,
    updatedAt: partial?.updatedAt ?? now.toISOString(),
    round: partial?.round ?? 0,
  } as StateVector;
}
