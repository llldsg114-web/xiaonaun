/**
 * 心屿心智引擎 — 共享类型定义。
 *
 * 跨文件一致约定：维度键名、状态结构、错误码、信封结构均以此为准。
 * 本文件不依赖任何运行时模块（仅类型），避免循环依赖。
 */

/** 12 维心理驱动维度键名。 */
export type DimensionKey =
  | 'possess'
  | 'monitor'
  | 'crave'
  | 'share'
  | 'libido'
  | 'curiosity'
  | 'boredom'
  | 'social'
  | 'duty'
  | 'reflection'
  | 'grieve'
  | 'anger';

/**
 * 12 维状态向量。各维 ∈ [0,1]，缺失维度默认 BASELINE(0.20)。
 * 附带 updatedAt(ISO8601 UTC) 与 round(结算轮次)。
 */
export type StateVector = Record<DimensionKey, number> & {
  updatedAt: string;
  round: number;
};

/** 对外仅接受的三类事件类型。 */
export type EventType = 'user_interaction' | 'user_note' | 'scheduled_interaction';

/** 事件载荷。 */
export interface EventPayload {
  content: string;
  /** 强度，范围 [0,1]。 */
  intensity: number;
  tags: string[];
}

/** 对话事件（MCP 写入输入）。 */
export interface ConversationEvent {
  event_id: string;
  session_id: string;
  type: EventType;
  payload: EventPayload;
  timestamp: string;
}

/** 状态结算增量（幂等键由上层保障）。 */
export interface StateDelta {
  changed: DimensionKey[];
  before: StateVector;
  after: StateVector;
}

/** 命中长期记忆片段（信封输出）。 */
export interface MemorySnippet {
  id: string;
  content: string;
  tags: string[];
  score: number;
}

/** 安全标志位。 */
export interface SafetyFlag {
  bridge_mode: 'enforced';
  blocked_channels: string[];
}

/** 上下文信封（xinchao_context 输出）。 */
export interface ContextEnvelope {
  envelope_version: string;
  session_id: string;
  generated_at: string;
  state_vector: StateVector;
  narrative: string;
  memory_snippets: MemorySnippet[];
  safety_flag: SafetyFlag;
  token_estimate: number;
}

/** xinchao_event 返回结果。 */
export interface EventResult {
  accepted: boolean;
  idempotent: boolean;
  applied_state_delta: StateDelta | Record<string, never>;
  envelope_version: string;
  code?: string;
}

/** xinchao_handoff_note 返回结果。 */
export interface HandoffResult {
  stored: boolean;
  ttl_seconds: number;
  expires_at: string;
  chars: number;
  code?: string;
}

/** 长期情感记忆（存储层）。 */
export interface EmotionalMemory {
  id: string;
  session_id: string;
  content: string;
  tags: string[];
  linkedVector: StateVector;
  createdAt: string;
  expiresAt: string;
}

/** 交接便签（存储层）。 */
export interface HandoffNote {
  note_id: string;
  content: string;
  from: string;
  to: string;
  ttl_seconds: number;
  expires_at: string;
  chars: number;
}

/** 幂等记录（存储层）。 */
export interface IdempotencyRecord {
  event_id: string;
  result: EventResult;
  created_at: string;
}

/** 审计日志条目（可观测）。 */
export interface AuditEntry {
  ts: string;
  action: string;
  scope: string;
  subject?: string;
  ok: boolean;
  code?: string;
  detail?: string;
}

/** 鉴权结果（TokenMiddleware.verify 产出，供 OAuth 端点等他用）。 */
export interface AuthResult {
  ok: boolean;
  subject?: string;
  scopes?: string[];
  code?: string;
}

/**
 * 请求级鉴权上下文（Route B 闭包注入工具 handler）。
 * 由 HTTP Bearer 中间件解析后挂到 req.mcpAuth，再传入 registerMcpTools。
 */
export interface RequestAuth {
  /** = JWT sub */
  subject: string;
  /** 归一化后的 scope 数组（优先取 claims.scopes，回退 claims.scope 拆分）。 */
  scopes: string[];
}

/** authenticate 返回结果：仅验令牌（签名+exp+iss），不校验 scope。 */
export type AuthOutcome =
  | { ok: true; subject: string; scopes: string[] }
  | { ok: false; error: string };
