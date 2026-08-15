/**
 * mcpTestClient.ts — 零依赖 MCP 工具层测试客户端封装（T03 产出，T04 复用）。
 *
 * 用 SDK 内置 InMemoryTransport.createLinkedPair() 链接一对传输，
 * 分别 connect 到 McpServer 与高层的 Client，返回已连接的 Client，
 * 供测试经工具层 call 工具（无需 supertest / 真实 HTTP）。
 *
 * 协议：MIT。100% 自研。
 */

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** 连接一个 McpServer 到内存传输，返回已初始化的 MCP Client。 */
export async function createLinkedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'xinyu-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}
