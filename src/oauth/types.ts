/**
 * types.ts — 心屿标准 OAuth 2.1 授权服务器共享类型与接口契约。
 *
 * 集中定义跨文件一致的数据结构（OAuthClient / AuthCodeRecord /
 * RefreshTokenRecord / TokenResponse / IntrospectResponse / OAuthError /
 * ConsentView）。本文件仅含类型与极少量常量辅助，不依赖任何运行时模块，
 * 避免循环依赖。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

/** 客户端 token 端点鉴权方式（OAuth 2.1 推荐 public client 用 none）。 */
export type TokenEndpointAuthMethod =
  | 'none'
  | 'client_secret_post'
  | 'client_secret_basic';

/**
 * 已注册的 OAuth 客户端。
 * public client（如 xinyu-web）的 client_secret 为 null。
 */
export interface OAuthClient {
  client_id: string;
  client_secret: string | null;
  /** 严格 redirect_uri 白名单。 */
  redirect_uris: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  name: string;
  /** 该 client 可申请的 scope 上界（越权会被拒绝）。 */
  allowed_scopes: string[];
}

/**
 * 一次性授权码记录。绑定 client / redirect_uri / scope / code_challenge，
 * 单次可用，TTL≤5min。
 */
export interface AuthCodeRecord {
  code: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  subject: string;
  created_at: number;
  expires_at: number;
  used: boolean;
}

/**
 * refresh_token 记录（服务端存储，可吊销 / 轮换）。
 * jti 关联到其签发的 access_token，用于级联吊销。
 */
export interface RefreshTokenRecord {
  refresh_token: string;
  client_id: string;
  subject: string;
  scope: string;
  jti: string;
  created_at: number;
  expires_at: number;
  revoked: boolean;
}

/** /token 成功响应（RFC6749）。 */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

/** /introspect 成功响应（RFC7662 active:true 部分）。 */
export interface IntrospectResponse {
  active: boolean;
  scope?: string;
  sub?: string;
  exp?: number;
  iss?: string;
  client_id?: string;
  token_type?: string;
}

/** OAuth 端点错误响应体（与内部 E11xx 区分）。 */
export interface OAuthError {
  error: string;
  error_description?: string;
  state?: string;
}

/** 同意页渲染所需视图数据。 */
export interface ConsentView {
  clientName: string;
  clientId: string;
  scope: string;
  state?: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  responseType: string;
}

/** 授权端点入参（GET 查询 / POST 表单合并）。 */
export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  decision?: string;
}

/** /token 入参。 */
export interface TokenRequestParams {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
}
