/**
 * mcpTokens.ts — 测试用 JWT 铸造 fixture（T04）。
 *
 * 用 auth.issueAccessToken 铸造：有效 / 越权（仅 read）/ 四类中的前两类；
 * 另用 jsonwebtoken 直接签一张过期令牌、以及一枚非法字符串，覆盖四类。
 *
 * 协议：MIT。100% 自研（jsonwebtoken 为既有依赖，非新增）。
 */

import jwt from 'jsonwebtoken';
import { TokenMiddleware } from '../../auth/token.js';

/** 四类测试令牌集合。 */
export interface McpTokenSet {
  auth: TokenMiddleware;
  /** 有效：read + write */
  valid: string;
  /** 过期令牌（exp 已过去） */
  expired: string;
  /** 越权：仅 read（调用 write 工具应被拒） */
  readOnly: string;
  /** 非法字符串（非 JWT） */
  invalid: string;
}

/** 铸造四类 JWT（可覆盖 secret / issuer）。 */
export function makeMcpTokens(secret = 'test-secret', issuer = 'test-issuer'): McpTokenSet {
  const auth = new TokenMiddleware(secret, issuer);
  const valid = auth.issueAccessToken('u', 'read write').access_token;
  const readOnly = auth.issueAccessToken('u', 'read').access_token;

  // issueAccessToken 固定 TTL（24h），无法直接过期为令牌；用同一 secret/issuer 直签一张过期 JWT。
  const now = Math.floor(Date.now() / 1000);
  const expired = jwt.sign(
    { sub: 'u', scope: 'read write', scopes: ['read', 'write'], iat: now - 100, exp: now - 10 },
    secret,
    { issuer },
  );

  const invalid = 'this.is.not.a.jwt';
  return { auth, valid, expired, readOnly, invalid };
}
