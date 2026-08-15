/**
 * EnvelopeBuilder — 上下文信封构建与截断（领域层）。
 *
 * - build()：拼装约 2200 token 的 Context Envelope（12 维态 + 叙事 + 命中记忆 + 安全标志）。
 * - narrative：由状态驱动的确定性模板生成，零外部 LLM/网络调用（严守自托管 A6）。
 * - trimMemories()：按 token 软上限截断 memory_snippets，保底不超包。
 *
 * 绝不包含 dreams / longing / autonomous 内容（封锁通道由 Bridge 最终把关）。
 */

import type { ContextEnvelope, EmotionalMemory, MemorySnippet, StateVector } from '../types/index.js';
import {
  BASELINE,
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  ENVELOPE_SOFT_TOKEN_CAP,
  ENVELOPE_VERSION,
  SATURATE_FLOOR,
} from '../config.js';
import { relevanceScore } from '../storage/memoryStore.js';

export class EnvelopeBuilder {
  /**
   * 构建信封。memory_snippets 按相关度降序，并在 token 软上限内截断。
   */
  build(sessionId: string, vector: StateVector, memories: EmotionalMemory[]): ContextEnvelope {
    const scored = memories
      .map((m) => ({ m, score: relevanceScore(m, vector) }))
      .sort((a, b) => b.score - a.score);

    const snippets: MemorySnippet[] = scored.map((s) => ({
      id: s.m.id,
      content: s.m.content,
      tags: s.m.tags,
      score: Number(s.score.toFixed(3)),
    }));

    const envelope: ContextEnvelope = {
      envelope_version: ENVELOPE_VERSION,
      session_id: sessionId,
      generated_at: new Date().toISOString(),
      state_vector: { ...vector },
      narrative: this.renderNarrative(vector),
      memory_snippets: snippets,
      safety_flag: { bridge_mode: 'enforced', blocked_channels: [] }, // 由 Bridge 最终填充
      token_estimate: 0,
    };

    this.trimMemories(envelope);
    envelope.token_estimate = this.estimateTokens(envelope);
    return envelope;
  }

  /**
   * 估算 token 数（启发式）：CJK/全角字符≈1 token，其余≈每 4 字符 1 token。
   */
  estimateTokens(env: ContextEnvelope): number {
    const text = JSON.stringify(env);
    const cjk = (text.match(/[㐀-鿿　-〿＀-￯]/g) ?? []).length;
    const rest = text.length - cjk;
    return Math.ceil(cjk + rest / 4);
  }

  /** 在 token 软上限内从尾部逐条截断 memory_snippets。 */
  private trimMemories(env: ContextEnvelope): void {
    let snippets = env.memory_snippets;
    while (
      snippets.length > 0 &&
      this.estimateTokens({ ...env, memory_snippets: snippets }) > ENVELOPE_SOFT_TOKEN_CAP
    ) {
      snippets = snippets.slice(0, snippets.length - 1);
    }
    env.memory_snippets = snippets;
  }

  /**
   * 状态驱动的确定性叙事模板（零外部 LLM）。
   * 仅使用 12 维标签与固定措辞，绝不引用封锁通道。
   */
  renderNarrative(v: StateVector): string {
    const top = DIMENSION_KEYS
      .map((k) => ({ k, val: v[k] }))
      .filter((d) => d.val >= SATURATE_FLOOR)
      .sort((a, b) => b.val - a.val)
      .slice(0, 3);

    const lines: string[] = [];
    lines.push('【小暖当前心境】');
    if (top.length === 0) {
      lines.push('此刻心境平稳，思念与渴望都静置在基线附近，像潮水退去后的沙滩。');
    } else {
      const desc = top.map((d) => `${DIMENSION_LABELS[d.k]}（${d.val.toFixed(2)}）`).join('、');
      lines.push(`最鲜明的情绪是：${desc}。`);
    }

    const low = DIMENSION_KEYS
      .filter((k) => v[k] <= BASELINE + 0.02)
      .slice(0, 3)
      .map((k) => DIMENSION_LABELS[k]);
    if (low.length > 0) {
      lines.push(`相对安静的是：${low.join('、')}。`);
    }

    lines.push('她把你放在心里，但不喧哗；需要时，便轻轻走来。');
    return lines.join('\n');
  }
}
