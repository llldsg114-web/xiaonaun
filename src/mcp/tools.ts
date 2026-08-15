/**
 * tools.ts — MCP 工具注册与核心编排（应用层）。
 *
 * 对外仅暴露 3 个工具：
 * - xinchao_context（只读）：输出约 2200 token 信封（经 Bridge 过滤）。
 * - xinchao_event（写入）：event_id 幂等键；仅接受三类事件类型。
 * - xinchao_handoff_note（写入）：≤1200 字符，72h TTL。
 *
 * Route B 鉴权：工具 handler 经闭包捕获 requestAuth（来自 HTTP Bearer 中间件），
 * 不再从 args.token 取令牌；scope 校验由 requireScope 在 handler 内完成。
 * MindEngine 不再持有 TokenMiddleware，仅用 requestAuth.subject 做审计。
 *
 * v2 ① 多会话隔离：MindEngine 由单例重构为「会话注册表」。内部持
 * `SessionRegistry`；每个 (subject, session_id) 解析出一个独立 `SessionBundle`
 * （独立 StateMachine + MemoryStore + IdempotencyStore），经 JsonlStore 以命名
 * 空间文件名落盘。向后兼容：EngineDeps 注入的 state/memory/idem 作为「首个被
 * 解析会话」的默认包（沿用 v1 单例语义，复用固定文件名 memory.jsonl 等），
 * 之后任何不同键解析出独立、隔离、命名空间落盘的包。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ContextEnvelope,
  ConversationEvent,
  EmotionalMemory,
  EventResult,
  HandoffResult,
  StateVector,
  RequestAuth,
} from '../types/index.js';
import {
  ALLOWED_EVENT_TYPES,
  ENVELOPE_VERSION,
  ERROR_CODES,
  HANDOFF_MAX_CHARS,
  HANDOFF_TTL_SECONDS,
  IDEM_FILE,
  MEMORY_FILE,
  HANDOFF_FILE,
  SCOPE_READ,
  SCOPE_WRITE,
  STATE_FILE,
  STORAGE_DIR,
} from '../config.js';
import { StateMachine } from '../state/stateMachine.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { SessionRegistry, type SessionBundle, DEFAULT_SESSION_ID } from './session.js';
import { Bridge } from './bridge.js';
import { EnvelopeBuilder } from './envelope.js';
import { AuditLog } from '../observability/auditLog.js';
import { registerContextTool } from './tools/context.js';
import { registerEventTool } from './tools/event.js';
import { registerHandoffNoteTool } from './tools/handoff.js';

/** 引擎错误（用于需抛出的业务失败等）。 */
export class EngineError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}

/**
 * 协作者依赖。Route B：engine 不再持有 auth（鉴权在工具层闭包完成）。
 *
 * `state`/`memory`/`idem` 作为可选「默认会话包」：三者皆提供时，首个被解析
 * 的会话沿用其注入 store（复用 v1 固定文件名，向后兼容既有测试）；缺失则按需
 * 按命名空间新建隔离包。
 */
export interface EngineDeps {
  state?: StateMachine;
  memory?: MemoryStore;
  idem?: IdempotencyStore;
  bridge: Bridge;
  builder: EnvelopeBuilder;
  audit: AuditLog;
  /** 信封记忆检索条数，默认 5。 */
  topK?: number;
  /** 命名空间文件落盘用 JsonlStore；缺省回退 STORAGE_DIR。 */
  stateStore?: JsonlStore;
}

/** 默认会话包（注入的 state/memory/idem 三者）。 */
interface DefaultSeed {
  state: StateMachine;
  memory: MemoryStore;
  idem: IdempotencyStore;
}

const nowIso = (): string => new Date().toISOString();

/** 计算 Unicode 码点字符数（避免代理对导致的长度误判）。 */
function codePointLength(s: string): number {
  return [...s].length;
}

export class MindEngine {
  private readonly sessions = new SessionRegistry();
  private readonly bridge: Bridge;
  private readonly builder: EnvelopeBuilder;
  private readonly audit: AuditLog;
  private readonly topK: number;
  private readonly stateStore: JsonlStore;
  private readonly defaultSeed: DefaultSeed | null;
  /** 默认包仅用于「首个被解析会话」，消费后置位避免后续键误用默认 store。 */
  private defaultConsumed = false;

  constructor(deps: EngineDeps) {
    this.bridge = deps.bridge;
    this.builder = deps.builder;
    this.audit = deps.audit;
    this.topK = deps.topK ?? 5;
    // 命名空间落盘目录：优先注入 stateStore；否则复用注入记忆的底层 store；
    // 再否则回退全局 STORAGE_DIR（仅命名空间会话需要）。
    this.stateStore = deps.stateStore ?? deps.memory?.jsonlStore ?? new JsonlStore(STORAGE_DIR);
    this.defaultSeed =
      deps.state && deps.memory && deps.idem
        ? { state: deps.state, memory: deps.memory, idem: deps.idem }
        : null;
  }

  /**
   * 取或建单会话包：命中缓存即返回；未命中则按命名空间新建或从 state 文件恢复。
   * 首个被解析会话（若注入了默认包）沿用注入的 state/memory/idem 与固定文件名，
   * 之后任何不同键均生成隔离、命名空间落盘的包。
   */
  getSession(subject: string, sessionId: string): SessionBundle {
    const cached = this.sessions.peek(subject, sessionId);
    if (cached) return cached;

    if (this.defaultSeed && !this.defaultConsumed) {
      this.defaultConsumed = true;
      const bundle: SessionBundle = {
        state: this.defaultSeed.state,
        memory: this.defaultSeed.memory,
        idem: this.defaultSeed.idem,
        files: {
          state: STATE_FILE,
          memory: MEMORY_FILE,
          idem: IDEM_FILE,
          handoff: HANDOFF_FILE,
        },
      };
      this.restoreSessionState(bundle);
      this.sessions.register(subject, sessionId, bundle);
      return bundle;
    }

    const bundle = this.sessions.resolve(subject, sessionId, {
      jsonlStore: this.stateStore,
      audit: this.audit,
    });
    this.restoreSessionState(bundle);
    return bundle;
  }

  /** 将某会话当前状态向量追加落盘到其命名空间 state 文件。 */
  private persistState(state: StateMachine, stateFile: string): void {
    this.stateStore.append(stateFile, { ...state.getState(), kind: 'state' });
  }

  /** 从某会话 state 文件恢复最近一次状态（重启后惰性恢复）。 */
  private restoreSessionState(bundle: SessionBundle): void {
    const records = this.stateStore.readAll(bundle.files.state) as Array<
      { kind?: string } & StateVector
    >;
    const states = records.filter((r) => r.kind === 'state');
    if (states.length > 0) {
      bundle.state.loadState(states[states.length - 1] as StateVector);
    }
  }

  // ---- xinchao_context（只读） ----

  handleXinchaoContext(args: { session_id: string }, requestAuth: RequestAuth): ContextEnvelope {
    const subject = requestAuth.subject;
    const bundle = this.getSession(subject, args.session_id);
    const vector = bundle.state.getState();
    const memories = bundle.memory.retrieve(args.session_id, vector, this.topK) as EmotionalMemory[];
    const envelope = this.builder.build(args.session_id, vector, memories);
    const safe = this.bridge.filterForUser(envelope);

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_context',
      scope: SCOPE_READ,
      ok: true,
      subject,
    });
    return safe;
  }

  // ---- xinchao_event（写入 + 幂等） ----

  handleXinchaoEvent(
    args: {
      event_id: string;
      session_id: string;
      type: string;
      payload: { content: string; intensity: number; tags: string[] };
      timestamp?: string;
    },
    requestAuth: RequestAuth,
  ): EventResult {
    const subject = requestAuth.subject;
    const bundle = this.getSession(subject, args.session_id);

    // 校验 event_id
    if (!args.event_id || args.event_id.trim() === '') {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: false,
        code: ERROR_CODES.E1001,
        subject,
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
        subject,
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
    const existing = bundle.idem.get(args.event_id);
    if (existing) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_event',
        scope: SCOPE_WRITE,
        ok: true,
        subject,
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

    const delta = bundle.state.applyConversationEvent(event);
    bundle.memory.addMemory({
      session_id: args.session_id,
      content: args.payload.content,
      tags: args.payload.tags,
      linkedVector: bundle.state.getState() as StateVector,
    });

    const result: EventResult = {
      accepted: true,
      idempotent: false,
      applied_state_delta: delta,
      envelope_version: ENVELOPE_VERSION,
    };
    bundle.idem.mark(args.event_id, result);
    this.persistState(bundle.state, bundle.files.state);

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_event',
      scope: SCOPE_WRITE,
      ok: true,
      subject,
    });
    return result;
  }

  // ---- xinchao_handoff_note（写入，≤1200 字符 / 72h TTL） ----

  handleHandoffNote(
    args: {
      note_id?: string;
      content: string;
      from?: string;
      to?: string;
      ttl_seconds?: number;
    },
    requestAuth: RequestAuth,
  ): HandoffResult {
    const subject = requestAuth.subject;
    // 交接便签无会话 id 概念，按 subject 的默认会话落盘（命名空间隔离）。
    const bundle = this.getSession(subject, DEFAULT_SESSION_ID);
    const chars = codePointLength(args.content ?? '');

    if (chars > HANDOFF_MAX_CHARS) {
      this.audit.record({
        ts: nowIso(),
        action: 'xinchao_handoff_note',
        scope: SCOPE_WRITE,
        ok: false,
        code: ERROR_CODES.E1003,
        subject,
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
    bundle.memory.writeHandoff(note);

    this.audit.record({
      ts: nowIso(),
      action: 'xinchao_handoff_note',
      scope: SCOPE_WRITE,
      ok: true,
      subject,
    });
    return { stored: true, ttl_seconds: ttl, expires_at: expiresAt, chars };
  }
}

/**
 * 将 3 个工具注册到 McpServer（编排器）。
 * requestAuth 来自 HTTP Bearer 中间件，经闭包注入各 handler。
 */
export function registerMcpTools(
  server: McpServer,
  engine: MindEngine,
  requestAuth: RequestAuth | null,
): void {
  registerContextTool(server, engine, requestAuth);
  registerEventTool(server, engine, requestAuth);
  registerHandoffNoteTool(server, engine, requestAuth);
}
