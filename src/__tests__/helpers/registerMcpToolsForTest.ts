/**
 * registerMcpToolsForTest.ts — 一行式测试 helper（T04）。
 *
 * 构建 McpServer、以给定 requestAuth 注册 3 个工具、连接内存传输，
 * 返回可直接 callTool 的已连接 Client。测试【不再传 token】。
 *
 * 协议：MIT。100% 自研。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MindEngine, registerMcpTools } from '../../mcp/tools.js';
import { createLinkedClient } from './mcpTestClient.js';
import type { RequestAuth } from '../../types/index.js';

/** 以给定 requestAuth 注册工具并返回已连接的 MCP Client。 */
export async function registerMcpToolsForTest(
  engine: MindEngine,
  requestAuth: RequestAuth | null,
): Promise<Client> {
  const server = new McpServer({ name: 'xinyu-mind-engine', version: '1.0.0' });
  registerMcpTools(server, engine, requestAuth);
  return createLinkedClient(server);
}
