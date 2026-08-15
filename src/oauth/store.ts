/**
 * store.ts — 内存存储：CodeStore / RefreshStore / RevocationStore。
 *
 * v1 使用进程内内存（单实例部署最佳）。预留 `persist()` 接口以便 v2 切换
 * 至 JSONL 落盘（沿用现有 jsonlStore 基础设施）。所有操作同步、无锁，
 * 适用于单进程心屿心智引擎。
 *
 * 协议：MIT。100% 自研。
 */

import type { AuthCodeRecord, RefreshTokenRecord } from './types.js';

/**
 * 一次性授权码存储。以 code 字符串为 key。
 * consume 为原子「取 + 标记 used + 过期检查」。
 */
export class CodeStore {
  private readonly codes = new Map<string, AuthCodeRecord>();

  /** 保存授权码记录。 */
  save(rec: AuthCodeRecord): void {
    this.codes.set(rec.code, rec);
  }

  /**
   * 原子消费授权码：取出并标记 used；若已用 / 过期 / 不存在返回 null。
   * 单次可用语义由此保证（重复消费返回 null → /token 判 invalid_grant）。
   */
  consume(code: string): AuthCodeRecord | null {
    const rec = this.codes.get(code);
    if (!rec) return null;
    if (rec.used) return null;
    if (rec.expires_at < Date.now()) {
      this.codes.delete(code);
      return null;
    }
    rec.used = true;
    return rec;
  }

  /** 主动吊销（如用户拒绝授权）。 */
  revoke(code: string): void {
    const rec = this.codes.get(code);
    if (rec) rec.used = true;
  }

  /** 清理过期授权码（由定时器调用）。 */
  sweep(): void {
    const now = Date.now();
    for (const [code, rec] of this.codes) {
      if (rec.used || rec.expires_at < now) this.codes.delete(code);
    }
  }

  /** 当前存储条目数（测试 / 可观测）。 */
  get size(): number {
    return this.codes.size;
  }
}

/**
 * refresh_token 存储。以 refresh_token 字符串为 key。
 * 支持吊销、按 jti 级联吊销、P1 用即废轮换。
 */
export class RefreshStore {
  private readonly tokens = new Map<string, RefreshTokenRecord>();

  /** 保存 refresh_token 记录。 */
  save(rec: RefreshTokenRecord): void {
    this.tokens.set(rec.refresh_token, rec);
  }

  /**
   * 取出记录（不修改状态）；调用方需自行检查 revoked / 过期。
   * 不存在返回 undefined。
   */
  get(token: string): RefreshTokenRecord | undefined {
    const rec = this.tokens.get(token);
    if (!rec) return undefined;
    if (rec.revoked || rec.expires_at < Date.now()) return undefined;
    return rec;
  }

  /**
   * 取出原始记录（不检查 revoked / 过期），用于吊销时读取 jti 做级联。
   */
  peek(token: string): RefreshTokenRecord | undefined {
    return this.tokens.get(token);
  }

  /** 吊销指定 refresh_token。 */
  revoke(token: string): void {
    const rec = this.tokens.get(token);
    if (rec) rec.revoked = true;
  }

  /** 按关联 access 的 jti 级联标记所有关联 refresh 为已吊销。 */
  revokeByJti(jti: string): void {
    for (const rec of this.tokens.values()) {
      if (rec.jti === jti) rec.revoked = true;
    }
  }

  /**
   * P1 轮换：吊销旧 refresh，签发新 refresh（用即废）。
   * @returns 新的 RefreshTokenRecord（调用方负责持久化存储）
   */
  rotate(old: RefreshTokenRecord, ttlSeconds: number, randomToken: () => string): RefreshTokenRecord {
    this.revoke(old.refresh_token);
    const now = Date.now();
    const fresh: RefreshTokenRecord = {
      refresh_token: randomToken(),
      client_id: old.client_id,
      subject: old.subject,
      scope: old.scope,
      jti: old.jti,
      created_at: now,
      expires_at: now + ttlSeconds * 1000,
      revoked: false,
    };
    this.save(fresh);
    return fresh;
  }

  /** 清理过期 / 已吊销记录。 */
  sweep(): void {
    const now = Date.now();
    for (const [token, rec] of this.tokens) {
      if (rec.revoked || rec.expires_at < now) this.tokens.delete(token);
    }
  }

  /** 当前存储条目数。 */
  get size(): number {
    return this.tokens.size;
  }
}

/**
 * RevocationStore — access_token jti 黑名单（最佳努力）。
 * 仅影响 /introspect；MCP 路径的 verify 不查此表（v1 零改动设计）。
 */
export class RevocationStore {
  private readonly denylist = new Set<string>();

  /** 将 jti 加入黑名单。 */
  add(jti: string): void {
    this.denylist.add(jti);
  }

  /** 是否已吊销。 */
  isRevoked(jti: string): boolean {
    return this.denylist.has(jti);
  }

  /** 黑名单大小。 */
  get size(): number {
    return this.denylist.size;
  }
}
