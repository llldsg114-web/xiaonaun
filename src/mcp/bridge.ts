/**
 * Bridge — 安全边界过滤（领域层）。
 *
 * 铁律（P0-5）：dreams / longing / autonomous 三类内部态，任何代码路径都
 * 不得自动注入用户可见窗口。本类对 ContextEnvelope 做最终过滤，并作为单元
 * 可测接口，确保封锁通道绝不外泄。
 *
 * - isAllowedChannel(type)：仅放行 user_interaction / user_note / scheduled_interaction。
 * - filterForUser(envelope)：剥离任何封锁通道键（深度），并写入 safety_flag。
 * - redact(vector)：12 维状态向量本身不含内部通道，原样返回（防御性克隆）。
 */

import type { ContextEnvelope, DimensionKey, StateVector } from '../types/index.js';
import { ALLOWED_EVENT_TYPES, BRIDGE_BLOCKED_CHANNELS } from '../config.js';

export class Bridge {
  private readonly BLOCKED: readonly string[];

  constructor(blocked: readonly string[] = BRIDGE_BLOCKED_CHANNELS) {
    this.BLOCKED = blocked;
  }

  /** 该事件类型是否属于对外允许通道。 */
  isAllowedChannel(type: string): boolean {
    return (ALLOWED_EVENT_TYPES as readonly string[]).includes(type);
  }

  /** 12 维向量不含内部通道键，返回防御性克隆。 */
  redact(vector: StateVector): StateVector {
    const out = {} as Record<DimensionKey, number>;
    for (const k of Object.keys(vector) as DimensionKey[]) out[k] = vector[k];
    return {
      ...out,
      updatedAt: vector.updatedAt,
      round: vector.round,
    } as StateVector;
  }

  /**
   * 最终过滤：剥离信封中任何封锁通道键（含嵌套），并重写 safety_flag。
   * 即便上游误写入 blocked 通道，也在此被强制清除，绝不外泄。
   */
  filterForUser(envelope: ContextEnvelope): ContextEnvelope {
    const cleaned = this.stripBlocked(envelope) as ContextEnvelope;
    cleaned.safety_flag = {
      bridge_mode: 'enforced',
      blocked_channels: [...this.BLOCKED],
    };
    return cleaned;
  }

  /** 信封是否仍含任何封锁通道键（用于断言/测试）。 */
  containsBlocked(envelope: ContextEnvelope): boolean {
    return this.hasBlockedKey(envelope);
  }

  /** 递归剥离封锁通道键。 */
  private stripBlocked(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map((n) => this.stripBlocked(n));
    }
    if (node && typeof node === 'object') {
      const source = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        if (this.BLOCKED.includes(key)) continue; // 永不泄漏
        out[key] = this.stripBlocked(source[key]);
      }
      return out;
    }
    return node;
  }

  /** 递归检测封锁通道键。 */
  private hasBlockedKey(node: unknown): boolean {
    if (Array.isArray(node)) {
      return node.some((n) => this.hasBlockedKey(n));
    }
    if (node && typeof node === 'object') {
      const source = node as Record<string, unknown>;
      for (const key of Object.keys(source)) {
        if (this.BLOCKED.includes(key)) return true;
        if (this.hasBlockedKey(source[key])) return true;
      }
    }
    return false;
  }
}
