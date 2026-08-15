/**
 * errors.ts — OAuth 2.1 / RFC7662 / RFC7009 标准错误码与响应构造。
 *
 * 与内部 E11xx 错误码区分：本模块输出的是 OAuth 标准 `error` 字段
 * （invalid_request / invalid_grant / invalid_scope ...），供 /authorize /
 * /token / /introspect / /revoke 端点返回。
 *
 * 协议：MIT。100% 自研。
 */

import type { Response } from 'express';
import type { OAuthError } from './types.js';

/** RFC6749 / RFC7662 / RFC7009 标准错误码。 */
export const OAuthErrorCodes = {
  invalid_request: 'invalid_request',
  unauthorized_client: 'unauthorized_client',
  access_denied: 'access_denied',
  unsupported_response_type: 'unsupported_response_type',
  invalid_scope: 'invalid_scope',
  invalid_grant: 'invalid_grant',
  unsupported_grant_type: 'unsupported_grant_type',
  invalid_client: 'invalid_client',
} as const;

export type OAuthErrorCode = (typeof OAuthErrorCodes)[keyof typeof OAuthErrorCodes];

/** error 字段 → 推荐 HTTP 状态码。 */
const STATUS_MAP: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  unauthorized_client: 401,
  access_denied: 403,
  unsupported_response_type: 400,
  invalid_scope: 400,
  invalid_grant: 400,
  unsupported_grant_type: 400,
  invalid_client: 401,
};

/**
 * 构造标准 OAuth 错误响应。
 * @param res        Express 响应对象
 * @param error      错误码
 * @param description 可选人类可读描述
 * @param state       透传的 state（如有）
 */
export function sendOAuthError(
  res: Response,
  error: OAuthErrorCode,
  description?: string,
  state?: string,
): void {
  const status = STATUS_MAP[error] ?? 400;
  const body: OAuthError = { error };
  if (description) body.error_description = description;
  if (state) body.state = state;
  res.status(status).json(body);
}
