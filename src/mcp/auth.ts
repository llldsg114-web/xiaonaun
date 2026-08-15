/**
 * auth.ts — MCP 工具层 scope 校验辅助（Route B）。
 *
 * 工具 handler 在闭包中读取 requestAuth 后，以 requireScope 做 scope 校验，
 * 以 getRequiredScope 解析工具名 → 所需 scope。鉴权失败抛 MCP 错误
 * （在正常 200 响应内以 JSON-RPC error 返回，不破坏 MCP 契约）。
 *
 * 协议：MIT。100% 自研。
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { SCOPE_READ, SCOPE_WRITE } from '../config.js';
import type { RequestAuth } from '../types/index.js';

export type { RequestAuth };

/** 工具名 → 所需 scope 映射。 */
export function getRequiredScope(toolName: string): string {
  switch (toolName) {
    case 'xinchao_context':
      return SCOPE_READ;
    case 'xinchao_event':
    case 'xinchao_handoff_note':
      return SCOPE_WRITE;
    default:
      return SCOPE_WRITE;
  }
}

/**
 * 校验 requestAuth 是否具备所需 scope。
 * - requestAuth 为 null → 抛 McpError(-32001, 'unauthorized')。
 * - 缺少 scope → 抛 McpError(-32602, 'insufficient scope: needs <scope>')。
 */
export function requireScope(auth: RequestAuth | null, scope: string): void {
  if (!auth) {
    throw new McpError(-32001, 'unauthorized');
  }
  if (!auth.scopes.includes(scope)) {
    throw new McpError(-32602, `insufficient scope: needs ${scope}`);
  }
}
