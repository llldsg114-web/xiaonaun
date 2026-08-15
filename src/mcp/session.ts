/**
 * session.ts — v2 ① 多会话隔离：会话键 / 文件名命名空间 / 注册表。
 *
 * - sessionKey：复合内部键（subject + NUL + sessionId），零歧义。
 * - safeSegment：文件系统/URL 安全段（清洗控制字符、截断 64）。
 * - sessionFileName：命名空间文件名（collection-subject-sessionId.jsonl）。
 * - SessionRegistry：按 (subject, sessionId) 缓存每会话的
 *   StateMachine + MemoryStore + IdempotencyStore 包，共享 JsonlStore 以
 *   命名空间文件名落盘（真实文件接线由 T02 注入可选 file 参数完成）。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import { StateMachine } from '../state/stateMachine.js';
import { MemoryStore } from '../storage/memoryStore.js';
import { IdempotencyStore } from '../storage/idempotency.js';
import type { JsonlStore } from '../storage/jsonlStore.js';
import type { AuditLog } from '../observability/auditLog.js';

/** 默认会话 id（无显式线程时）。 */
export const DEFAULT_SESSION_ID = 'default';

/** 复合会话键分隔符（NUL，确保 subject/sessionId 任意取值不歧义）。 */
const KEY_SEP = String.fromCharCode(0);

/**
 * 生成复合会话键 subject + NUL + sessionId。
 * 内部 Map 键，零歧义（任意 subject/sessionId 取值都不会碰撞）。
 */
export function sessionKey(subject: string, sessionId: string): string {
  return subject + KEY_SEP + sessionId;
}

/**
 * 文件系统/URL 安全段：非 [a-zA-Z0-9_-] 一律转 '_'，连续 '_' 合并，
 * 长度截断 64；空结果回退为 '_'（避免产生空段文件名）。
 */
export function safeSegment(s: string): string {
  const seg = String(s)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64);
  return seg.length > 0 ? seg : '_';
}

/**
 * 命名空间文件名：collection-subject-sessionId.jsonl。
 * collection ∈ {state, memory, idempotency, handoff}。
 * 例：state-alice-threadA.jsonl / memory-bob-threadB.jsonl。
 */
export function sessionFileName(collection: string, subject: string, sessionId: string): string {
  return `${collection}-${safeSegment(subject)}-${safeSegment(sessionId)}.jsonl`;
}

/** 每会话命名空间文件名集合。 */
export interface SessionFiles {
  state: string;
  memory: string;
  idem: string;
  handoff: string;
}

/** 单会话包：独立状态机 + 记忆 + 幂等。 */
export interface SessionBundle {
  state: StateMachine;
  memory: MemoryStore;
  idem: IdempotencyStore;
  /** 命名空间文件名（T02 将注入 MemoryStore/IdempotencyStore 可选 file 参数）。 */
  files: SessionFiles;
}

/** SessionRegistry 依赖（共享基础设施）。 */
export interface SessionRegistryDeps {
  jsonlStore: JsonlStore;
  audit?: AuditLog;
}

  /**
   * 多会话注册表：按复合键缓存每会话包，跨用户/线程隔离。
   * 真实文件落盘命名空间（state/memory/idempotency/handoff jsonl）由
   * sessionFileName 计算，并在 resolve 时注入 MemoryStore/IdempotencyStore
   * 的可选 file 参数（T02）。
   */
  export class SessionRegistry {
    private readonly sessions = new Map<string, SessionBundle>();

    /** 取或建单会话包（命中缓存即返回）。 */
    resolve(subject: string, sessionId: string, deps: SessionRegistryDeps): SessionBundle {
      const key = sessionKey(subject, sessionId);
      const existing = this.sessions.get(key);
      if (existing) return existing;

      const files: SessionFiles = {
        state: sessionFileName('state', subject, sessionId),
        memory: sessionFileName('memory', subject, sessionId),
        idem: sessionFileName('idempotency', subject, sessionId),
        handoff: sessionFileName('handoff', subject, sessionId),
      };

      const bundle: SessionBundle = {
        state: new StateMachine(),
        memory: new MemoryStore(deps.jsonlStore, { memory: files.memory, handoff: files.handoff }),
        idem: new IdempotencyStore(deps.jsonlStore, files.idem),
        files,
      };
      this.sessions.set(key, bundle);
      return bundle;
    }

    /** 读取缓存的会话包（未命中返回 undefined）。 */
    peek(subject: string, sessionId: string): SessionBundle | undefined {
      return this.sessions.get(sessionKey(subject, sessionId));
    }

    /** 注册一个预构建的会话包（供 MindEngine 注入「默认会话包」）。 */
    register(subject: string, sessionId: string, bundle: SessionBundle): void {
      this.sessions.set(sessionKey(subject, sessionId), bundle);
    }

    /** 驱逐单会话。 */
    evict(subject: string, sessionId: string): void {
      this.sessions.delete(sessionKey(subject, sessionId));
    }

    /** 驱逐全部会话。 */
    evictAll(): void {
      this.sessions.clear();
    }
  }
