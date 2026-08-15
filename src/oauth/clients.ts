/**
 * clients.ts — ClientStore：客户端注册与 redirect_uri 白名单。
 *
 * v1 仅内存预置（无 RFC7591 动态注册端点，动态注册列为 P2 预留）。
 * 预置 xinyu-web（public client，token_endpoint_auth_method=none）。
 *
 * 协议：MIT。100% 自研。
 */

import type { OAuthClient } from './types.js';

/** v1 预置客户端配置（多客户端可在此扩展数组）。 */
const PRESET_CLIENTS: OAuthClient[] = [
  {
    client_id: 'xinyu-web',
    client_secret: null,
    redirect_uris: ['http://localhost:3000/'],
    token_endpoint_auth_method: 'none',
    name: '心屿 Web 前端',
    allowed_scopes: ['read', 'write'],
  },
];

/**
 * 客户端注册表。以 client_id 为 key 的只读友好存储。
 */
export class ClientStore {
  private readonly clients = new Map<string, OAuthClient>();

  constructor(presets: OAuthClient[] = PRESET_CLIENTS) {
    for (const c of presets) this.register(c);
  }

  /** 注册（或覆盖）一个客户端。 */
  register(client: OAuthClient): void {
    this.clients.set(client.client_id, client);
  }

  /** 按 client_id 取客户端（不存在返回 undefined）。 */
  get(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  /** 判断 uri 是否在该客户端的 redirect_uri 严格白名单内。 */
  isValidRedirectUri(client: OAuthClient, uri: string): boolean {
    return client.redirect_uris.includes(uri);
  }

  /** 是否为 public client（无 secret，token_endpoint_auth_method=none）。 */
  isPublic(clientId: string): boolean {
    const c = this.clients.get(clientId);
    return !!c && c.token_endpoint_auth_method === 'none';
  }
}
