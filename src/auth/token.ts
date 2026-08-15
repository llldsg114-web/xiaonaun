/**
 * TokenMiddleware — OAuth 2.1 Bearer 令牌签发/验签（自托管、轻量）。
 *
 * - issue(subject, scopes)：签发 JWT（HS256）。
 * - verify(token, scope)：验签并校验 scope 权限。
 * - extractBearer(header)：从 Authorization 头提取 Bearer 令牌。
 *
 * 依赖：jsonwebtoken(MIT) + Node crypto。后续可替换为标准授权服务器。
 */

import jwt from 'jsonwebtoken';
import { ERROR_CODES, SCOPE_READ, SCOPE_WRITE } from '../config.js';
import type { AuthResult } from '../types/index.js';

/** JWT 内载荷。 */
export interface TokenClaims {
  sub: string;
  scopes: string[];
  iss: string;
  iat?: number;
  exp?: number;
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
  verify(token: string, scope: typeof SCOPE_READ | typeof SCOPE_WRITE): AuthResult {
    if (!token || token.length === 0) {
      return { ok: false, code: ERROR_CODES.E1101 };
    }
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
      }) as TokenClaims;
      const scopes: string[] = Array.isArray(decoded.scopes) ? decoded.scopes : [];
      if (!scopes.includes(scope)) {
        return { ok: false, code: ERROR_CODES.E1102, subject: decoded.sub };
      }
      return { ok: true, subject: decoded.sub, scopes };
    } catch {
      return { ok: false, code: ERROR_CODES.E1101 };
    }
  }

  /** 从 HTTP Authorization 头提取 Bearer 令牌（不含前缀）。 */
  extractBearer(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const matched = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    return matched ? matched[1] : null;
  }
}
