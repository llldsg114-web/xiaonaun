/**
 * DecayCurve — 衰减步进与饱和裁剪。
 *
 * 设计要点（架构假设 A3 / 4.1）：
 * - 未受刺激的维度按指数半衰期向基线衰减。
 * - saturate(target)：仅封顶，将目标值限制不超过 SATURATE_CEIL。
 *   注意：不再做下限钳制（原 SATURATE_FLOOR=0.65 仅用于 settleState 的「已饱和维缓降」分支），
 *   以便弱刺激自然落在 BASELINE~SATURATE_FLOOR 之间，使 intensity 真实驱动正向幅度。
 */

import { SATURATE_CEIL } from '../config.js';

export class DecayCurve {
  /**
   * 单步衰减：current 向 baseline 移动一个半衰期步长。
   * factor = 1 - 2^(-1/halfLife)，故 halfLife 轮后衰减至约一半。
   */
  decayStep(current: number, baseline: number, halfLife: number): number {
    if (halfLife <= 0) return baseline;
    const factor = 1 - Math.pow(2, -1 / halfLife);
    return current + (baseline - current) * factor;
  }

  /**
   * 饱和裁剪：仅封顶，将目标值限制不超过 SATURATE_CEIL(0.80)。
   * 不做下限钳制，使弱刺激自然落在 BASELINE~SATURATE_FLOOR 之间，
   * 让 `target = baseline + stim`（stim 已含 intensity）直接驱动正向幅度。
   */
  saturate(target: number): number {
    return Math.min(target, SATURATE_CEIL);
  }
}
