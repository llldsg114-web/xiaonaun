/**
 * session.ts — v2 ② 登录会话（内存表，sid ↔ username）。
 *
 * sid 用 crypto.randomUUID()；TTL 由 SESSION_TTL_SECONDS 控制。
 * 内存表（v1 够用；可选 JSONL 持久化留待后续）。cookie 名由
 * SESSION_COOKIE_NAME 定义（httpOnly / Path=/ / SameSite=Lax）。
 *
 * 协议：MIT。100% 自研。
 */

import { randomUUID } from 'node:crypto';
import type { SessionRecord } from '../types/index.js';
import { SESSION_TTL_SECONDS } from '../config.js';

/**
 * SessionStore — 登录会话存储（内存表）。
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  /** 创建登录会话，返回 sid。 */
  create(username: string): string {
    const sid = randomUUID();
    const now = Date.now();
    const record: SessionRecord = {
      sid,
      username,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    };
    this.sessions.set(sid, record);
    return sid;
  }

  /** 取会话记录（过期自动清理并返回 null）。 */
  get(sid: string): SessionRecord | null {
    const record = this.sessions.get(sid);
    if (!record) return null;
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(sid);
      return null;
    }
    return record;
  }

  /** 取会话关联的用户名（无/过期返回 null）。 */
  usernameOf(sid: string): string | null {
    return this.get(sid)?.username ?? null;
  }

  /** 销毁会话。 */
  destroy(sid: string): void {
    this.sessions.delete(sid);
  }
}
