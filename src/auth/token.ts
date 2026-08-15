/**
 * TokenMiddleware — OAuth 2.1 Bearer 令牌签发/验签（自托管、轻量）。
 *
 * - issue(subject, scopes)：签发 JWT（HS256）。
 * - verify(token, scope)：验签并校验 scope 权限。
 * - extractBearer(header)：从 Authorization 头提取 Bearer 令牌。
 *
 * 依赖：jsonwebtoken(MIT) + Node crypto。后续可替换为标准授权服务器。
 */

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_TTL_SECONDS, ERROR_CODES, SCOPE_READ, SCOPE_WRITE } from '../config.js';
import type { AuthOutcome, AuthResult } from '../types/index.js';

/** JWT 内载荷。 */
export interface TokenClaims {
  sub: string;
  /** 兼容桥：数组形式，供既有 verify 读取（3 个 MCP 工具 v1 零改动）。 */
  scopes: string[];
  iss: string;
  iat?: number;
  exp?: number;
  /** OAuth 标准 scope（空格分隔字符串，供 /introspect 回带）。 */
  scope?: string;
  /** JWT 唯一标识，供 /revoke 级联吊销 access。 */
  jti?: string;
  /** 令牌类型（Bearer）。 */
  token_type?: string;
  /** 签发客户端（可选，便于 /introspect 回带）。 */
  client_id?: string;
}

/** issueAccessToken 返回的 access_token 签发结果。 */
export interface IssuedAccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  jti: string;
}

export class TokenMiddleware {
  private readonly secret: string;
  private readonly issuer: string;

  constructor(secret?: string, issuer?: string) {
    const envSecret = process.env.JWT_SECRET;
    const isProd = process.env.NODE_ENV === 'production';

    // 安全铁律：生产环境必须显式配置密钥，禁止静默回退到公开硬编码弱密钥。
    if (isProd && !secret && !envSecret) {
      throw new Error('JWT_SECRET 必须在生产环境显式配置');
    }

    const resolved = secret ?? envSecret;
    if (resolved) {
      this.secret = resolved;
    } else {
      // 仅非生产环境才会落到此处；显式告警避免静默使用默认弱密钥。
      this.secret = 'dev-insecure-secret';
      console.error('[SECURITY] 生产环境禁止使用默认弱密钥，请配置 JWT_SECRET');
    }

    this.issuer = issuer ?? process.env.TOKEN_ISSUER ?? 'xinyu-mind-engine';
  }

  /** 签发一个携带 scopes 的 Bearer 令牌。 */
  issue(subject: string, scopes: string[]): string {
    return jwt.sign({ sub: subject, scopes }, this.secret, {
      issuer: this.issuer,
      expiresIn: '24h',
    });
  }

  /**
   * 验签令牌并校验所需 scope。
   * @param token Bearer 令牌（不含 "Bearer " 前缀）。
   * @param scope 所需权限：context→read；event/handoff→write。
   */
  /**
   * 验签令牌并校验所需 scope。复用 authenticate 仅做 scope 包含判断，
   * 保持 AuthResult 形状不变（供 /introspect 等他用，不破坏既有测试）。
   * @param token Bearer 令牌（不含 "Bearer " 前缀）。
   * @param scope 所需权限：context→read；event/handoff→write。
   */
  verify(token: string, scope: typeof SCOPE_READ | typeof SCOPE_WRITE): AuthResult {
    const outcome = this.authenticate(token);
    if (!outcome.ok) {
      return { ok: false, code: ERROR_CODES.E1101 };
    }
    if (!outcome.scopes.includes(scope)) {
      return { ok: false, code: ERROR_CODES.E1102, subject: outcome.subject };
    }
    return { ok: true, subject: outcome.subject, scopes: outcome.scopes };
  }

  /**
   * 仅验令牌（签名+exp+iss），不校验 scope，并归一化 scopes。
   * 供 MCP Bearer 中间件在 handler 前解析身份：优先取 claims.scopes（数组），
   * 回退 claims.scope（空格分隔字符串拆分）。
   */
  authenticate(token: string): AuthOutcome {
    if (!token || token.length === 0) {
      return { ok: false, error: 'missing token' };
    }
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
      }) as TokenClaims;
      const scopes: string[] = Array.isArray(decoded.scopes)
        ? decoded.scopes
        : typeof decoded.scope === 'string' && decoded.scope.length > 0
          ? decoded.scope.split(/\s+/).filter(Boolean)
          : [];
      return { ok: true, subject: decoded.sub, scopes };
    } catch {
      return { ok: false, error: 'invalid token' };
    }
  }

  /** 从 HTTP Authorization 头提取 Bearer 令牌（不含前缀）。 */
  extractBearer(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const matched = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    return matched ? matched[1] : null;
  }

  /**
   * 签发标准 OAuth 2.1 access_token（HS256 JWT）。
   *
   * ★ 关键兼容桥：claim 同时携带 `scope`（字符串，OAuth 标准）与
   * `scopes`（数组，既有 verify 读取字段），保证 3 个 MCP 工具 v1 零改动。
   *
   * @param subject 资源所有者（本地固定身份 xinyu-local）
   * @param scope   空格分隔的 scope 字符串（如 "read write"）
   * @returns 含 access_token(JWT) / token_type / expires_in / scope / jti
   */
  issueAccessToken(subject: string, scope: string): IssuedAccessToken {
    const scopes = scope.split(/\s+/).filter(Boolean);
    const jti = randomUUID();
    const access_token = jwt.sign(
      {
        sub: subject,
        scope,
        scopes,
        token_type: 'Bearer',
        jti,
      },
      this.secret,
      {
        issuer: this.issuer,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope,
      jti,
    };
  }

  /**
   * 验签 access_token 并返回载荷（失效 / 签名不符返回 null）。
   * 供 /introspect 与 /revoke 复用同一 secret / issuer，杜绝密钥分叉。
   */
  introspectToken(token: string): TokenClaims | null {
    if (!token) return null;
    try {
      return jwt.verify(token, this.secret, { issuer: this.issuer }) as TokenClaims;
    } catch {
      return null;
    }
  }
}
