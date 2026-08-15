/**
 * MemoryStore — 长期情感记忆 + 交接便签（基础设施层，基于 JsonlStore）。
 *
 * - writeMemory：写入长期情感记忆（关联 12 维状态向量）。
 * - writeHandoff：写入交接便签（72h TTL，超期由 gcHandoff 清理）。
 * - retrieve：按 session + 状态向量启发式相关度检索 topK（A7：不引外部 embedding）。
 */

import { randomUUID } from 'node:crypto';
import type { EmotionalMemory, HandoffNote, StateVector } from '../types/index.js';
import { DIMENSION_KEYS, HANDOFF_FILE, MEMORY_FILE } from '../config.js';
import { JsonlStore } from './jsonlStore.js';

/** 启发式相关度：状态向量余弦近似 + tag 命中微加权。范围 [0,1]。 */
export function relevanceScore(m: EmotionalMemory, v: StateVector): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of DIMENSION_KEYS) {
    const a = m.linkedVector?.[k] ?? 0;
    const b = v[k] ?? 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  const cosine = mag > 0 ? dot / mag : 0;
  const tagBonus = Array.isArray(m.tags) && m.tags.length > 0 ? 0.05 : 0;
  return Math.max(0, Math.min(1, cosine * 0.95 + tagBonus));
}

export class MemoryStore {
  private readonly store: JsonlStore;

  constructor(store: JsonlStore) {
    this.store = store;
  }

  /** 写入一条长期情感记忆。 */
  writeMemory(m: EmotionalMemory): void {
    this.store.append(MEMORY_FILE, m);
  }

  /** 写入一条交接便签（TTL 由调用方保证）。 */
  writeHandoff(n: HandoffNote): void {
    this.store.append(HANDOFF_FILE, n);
  }

  /** 构造并写入一条情感记忆（便捷方法）。 */
  addMemory(input: {
    session_id: string;
    content: string;
    tags: string[];
    linkedVector: StateVector;
    ttl_seconds?: number;
  }): EmotionalMemory {
    const now = new Date();
    const ttl = input.ttl_seconds ?? 365 * 24 * 3600;
    const memory: EmotionalMemory = {
      id: randomUUID(),
      session_id: input.session_id,
      content: input.content,
      tags: input.tags,
      linkedVector: input.linkedVector,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    };
    this.writeMemory(memory);
    return memory;
  }

  /**
   * 检索某会话下与当前状态最相关的 topK 记忆（按相关度降序）。
   * @param sessionId 会话 ID（由对话层传入）。
   * @param vector 当前状态向量。
   * @param topK 返回条数上限。
   */
  retrieve(sessionId: string, vector: StateVector, topK: number): EmotionalMemory[] {
    const all = this.store.readAll(MEMORY_FILE) as EmotionalMemory[];
    return all
      .filter((m) => m.session_id === sessionId)
      .map((m) => ({ m, score: relevanceScore(m, vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK))
      .map((s) => s.m);
  }

  /** 清理过期交接便签。 */
  gcHandoff(now: Date = new Date()): number {
    return this.store.gcExpired(HANDOFF_FILE, now);
  }

  /** 清理过期长期记忆。 */
  gcMemory(now: Date = new Date()): number {
    return this.store.gcExpired(MEMORY_FILE, now);
  }
}
