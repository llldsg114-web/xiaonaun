/**
 * tools.ts — MCP 工具注册与核心编排（应用层）。
 *
 * 对外仅暴露 3 个工具：
 * - xinchao_context（只读）：输出约 2200 token 信封（经 Bridge 过滤）。
 * - xinchao_event（写入）：event_id 幂等键；仅接受三类事件类型。
 * - xinchao_handoff_note（写入）：≤1200 字符，72h TTL。
 *
 * MindEngine 持有全部协作者，handler 逻辑与 HTTP 解耦，便于单元测试。
 */

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ContextEnvelope,
  ConversationEvent,
  EmotionalMemory,
  EventResult,
  HandoffResult,
  StateVector,
} from '../types/index.js';
import {
  ALLOWED_EVENT_TYPES,
  ENVELOPE_VERSION,
  ERROR_CODES,
  HANDOFF_MAX_CHARS,
  HANDOFF_TTL_SECONDS,
  SCOPE_READ,
  SCOPE_WRITE,
  STATE_FILE,
} from '../config.js';
import { StateMachine } from '../state/stateMachine.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { Bridge } from './bridge.js';
import { EnvelopeBuilder } from './envelope.js';
import { TokenMiddleware } from '../auth/token.js';
import { AuditLog } from '../observability/auditLog.js';

/** 引擎错误（用于需抛出的鉴权失败等）。 */
export class EngineError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}

/** 协作者依赖。 */
export interface EngineDeps {
  state: StateMachine;
  memory: MemoryStore;
  idem: IdempotencyStore;
  bridge: Bridge;
  builder: EnvelopeBuilder;
  auth: TokenMiddleware;
  audit: AuditLog;
  /** 信封记忆检索条数，默认 5。 */
  topK?: number;
  /** 可选：状态向量 JSONL 落盘（state.jsonl），用于重启后恢复。 */
  stateStore?: JsonlStore;
}

const nowIso = (): string => new Date().toISOString();

/** 计算 Unicode 码点字符数（避免代理对导致的长度误判）。 */
function codePointLength(s: string): number {
  return [...s].length;
}

export class MindEngine {
  private readonly state: StateMachine;
  private readonly memory: MemoryStore;
  private readonly idem: IdempotencyStore;
  private readonly bridge: Bridge;
  private readonly builder: EnvelopeBuilder;
  private readonly auth: TokenMiddleware;
  private readonly audit: AuditLog;
  private readonly topK: number;
  private readonly stateStore?: JsonlStore;

  constructor(deps: EngineDeps) {
    this.state = deps.state;
    this.memory = deps.memory;
    this.idem = deps.idem;
    this.bridge = deps.bridge;
    this.builder = deps.builder;
    this.auth = deps.auth;
    this.audit = deps.audit;
    this.topK = deps.topK ?? 5;
    this.stateStore = deps.stateStore;
  }

  /** 将当前状态向量追加落盘（state.jsonl）。无 stateStore 时跳过。 */
  private persistState(): void {
    if (!this.stateStore) return;
    this.stateStore.append(STATE_FILE, { ...this.state.getState(), kind: 'state' });
  }

  /** 从 state.jsonl 恢复最近一次状态（重启后）。无记录时保持默认。 */
  restoreState(): void {
    if (!this.stateStore) return;
    const records = this.stateStore.readAll(STATE_FILE) as Array<{ kind?: string } & StateVector>;
    const states = records.filter((r) => r.kind === 'state');
    if (states.length > 0) {
      this.state.loadState(states[states.length - 1] as StateVector);
    }
  }

  // ---- xinchao_context（只读） ----

  handleXinchaoContext(args: { session_id: string; token: string }): ContextEnvelope {
    const auth = this.auth.verify(args.token, SCOPE_READ);
    if (!auth.ok) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_context',
        scope: SCOPE_READ,
        ok: false,
        code: auth.code,
        subject: auth.subject,
      });
      throw new EngineError(auth.code ?? ERROR_CODES.E1101, 'unauthorized read');
    }

    const vector = this.state.getState();
    const memories = this.memory.retrieve(args.session_id, vector, this.topK) as EmotionalMemory[];
    const envelope = this.builder.build(args.session_id, vector, memories);
    const safe = this.bridge.filterForUser(envelope);

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_context',
      scope: SCOPE_READ,
      ok: true,
      subject: auth.subject,
    });
    return safe;
  }

  // ---- xinchao_event（写入 + 幂等） ----

  handleXinchaoEvent(args: {
    event_id: string;
    session_id: string;
    type: string;
    token: string;
    payload: { content: string; intensity: number; tags: string[] };
    timestamp?: string;
  }): EventResult {
    const auth = this.auth.verify(args.token, SCOPE_WRITE);
    if (!auth.ok) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: false,
        code: auth.code,
        subject: auth.subject,
      });
      return {
        accepted: false,
        idempotent: false,
        applied_state_delta: {},
        envelope_version: ENVELOPE_VERSION,
        code: auth.code,
      };
    }

    // 校验 event_id
    if (!args.event_id || args.event_id.trim() === '') {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: false,
        code: ERROR_CODES.E1001,
        subject: auth.subject,
      });
      return {
        accepted: false,
        idempotent: false,
        applied_state_delta: {},
        envelope_version: ENVELOPE_VERSION,
        code: ERROR_CODES.E1001,
      };
    }

    // 校验事件类型（仅三类）
    if (!(ALLOWED_EVENT_TYPES as readonly string[]).includes(args.type)) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: false,
        code: ERROR_CODES.E1002,
        subject: auth.subject,
        detail: args.type,
      });
      return {
        accepted: false,
        idempotent: false,
        applied_state_delta: {},
        envelope_version: ENVELOPE_VERSION,
        code: ERROR_CODES.E1002,
      };
    }

    // 幂等命中：返回历史结果，不二次改写
    const existing = this.idem.get(args.event_id);
    if (existing) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: true,
        subject: auth.subject,
        detail: 'idempotent',
      });
      return { ...existing, idempotent: true, applied_state_delta: {} };
    }

    // 新事件：结算状态 + 落盘记忆 + 标记幂等
    const event: ConversationEvent = {
      event_id: args.event_id,
      session_id: args.session_id,
      type: args.type as ConversationEvent['type'],
      payload: {
        content: args.payload.content,
        intensity: args.payload.intensity,
        tags: args.payload.tags,
      },
      timestamp: args.timestamp ?? nowIso(),
    };

    const delta = this.state.applyConversationEvent(event);
    this.memory.addMemory({
      session_id: args.session_id,
      content: args.payload.content,
      tags: args.payload.tags,
      linkedVector: this.state.getState() as StateVector,
    });

    const result: EventResult = {
      accepted: true,
      idempotent: false,
      applied_state_delta: delta,
      envelope_version: ENVELOPE_VERSION,
    };
    this.idem.mark(args.event_id, result);
    this.persistState();

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_event',
      scope: SCOPE_WRITE,
      ok: true,
      subject: auth.subject,
    });
    return result;
  }

  // ---- xinchao_handoff_note（写入，≤1200 字符 / 72h TTL） ----

  handleHandoffNote(args: {
    note_id?: string;
    content: string;
    from?: string;
    to?: string;
    ttl_seconds?: number;
    token: string;
  }): HandoffResult {
    const auth = this.auth.verify(args.token, SCOPE_WRITE);
    if (!auth.ok) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_handoff_note',
        scope: SCOPE_WRITE,
        ok: false,
        code: auth.code,
        subject: auth.subject,
      });
      return {
        stored: false,
        ttl_seconds: HANDOFF_TTL_SECONDS,
        expires_at: '',
        chars: codePointLength(args.content ?? ''),
        code: auth.code,
      };
    }

    const chars = codePointLength(args.content ?? '');
    if (chars > HANDOFF_MAX_CHARS) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_handoff_note',
        scope: SCOPE_WRITE,
        ok: false,
        code: ERROR_CODES.E1003,
        subject: auth.subject,
      });
      return {
        stored: false,
        ttl_seconds: HANDOFF_TTL_SECONDS,
        expires_at: '',
        chars,
        code: ERROR_CODES.E1003,
      };
    }

    const ttl = args.ttl_seconds ?? HANDOFF_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const note = {
      note_id: args.note_id ?? randomUUID(),
      content: args.content,
      from: args.from ?? 'agent',
      to: args.to ?? 'agent',
      ttl_seconds: ttl,
      expires_at: expiresAt,
      chars,
    };
    this.memory.writeHandoff(note);

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_handoff_note',
      scope: SCOPE_WRITE,
      ok: true,
      subject: auth.subject,
    });
    return { stored: true, ttl_seconds: ttl, expires_at: expiresAt, chars };
  }
}

/** xinchao_context 入参 schema。 */
const contextSchema = {
  session_id: z.string().min(1),
  token: z.string().min(1),
};

/** xinchao_event 入参 schema。 */
const eventSchema = {
  event_id: z.string().min(1),
  session_id: z.string().min(1),
  type: z.enum(['user_interaction', 'user_note', 'scheduled_interaction']),
  token: z.string().min(1),
  payload: z.object({
    content: z.string(),
    intensity: z.number().min(0).max(1),
    tags: z.array(z.string()),
  }),
  timestamp: z.string().optional(),
};

/** xinchao_handoff_note 入参 schema。 */
const handoffSchema = {
  note_id: z.string().optional(),
  content: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  ttl_seconds: z.number().int().positive().optional(),
  token: z.string().min(1),
};

/**
 * 将 3 个工具注册到 McpServer。handler 内部捕获 EngineError 并转为 MCP 错误内容。
 */
export function registerMcpTools(server: McpServer, engine: MindEngine): void {
  server.tool(
    'xinchao_context',
    '读取 12 维态 + 叙事摘要的上下文信封（只读，约 2200 token）。',
    contextSchema,
    async (args) => {
      try {
        const env = engine.handleXinchaoContext(args);
        return { content: [{ type: 'text', text: JSON.stringify(env) }] };
      } catch (e) {
        const code = e instanceof EngineError ? e.code : 'ERR_INTERNAL';
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: code }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'xinchao_event',
    '写入一次对话事件（event_id 幂等；仅接受 user_interaction / user_note / scheduled_interaction）。',
    eventSchema,
    async (args) => {
      const result = engine.handleXinchaoEvent(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'xinchao_handoff_note',
    '写入交接便签（≤1200 字符，默认 72h TTL，到期自动清理）。',
    handoffSchema,
    async (args) => {
      const result = engine.handleHandoffNote(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
