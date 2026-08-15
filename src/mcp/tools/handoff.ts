/**
 * tools/handoff.ts — xinchao_handoff_note（写入，≤1200 字符 / 72h TTL）工具注册。
 *
 * handler 闭包捕获 requestAuth：先 requireScope(write)，再调用
 * engine.handleHandoffNote(args, requestAuth)。业务结果（含 E1003）由引擎
 * 以正常结果返回；鉴权失败由 requireScope 抛 MCP 错误。
 *
 * 协议：MIT。100% 自研。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MindEngine } from '../tools.js';
import type { RequestAuth } from '../../types/index.js';
import { getRequiredScope, requireScope } from '../auth.js';

/** 注册 xinchao_handoff_note（写入）工具。 */
export function registerHandoffNoteTool(
  server: McpServer,
  engine: MindEngine,
  requestAuth: RequestAuth | null,
): void {
  server.tool(
    'xinchao_handoff_note',
    '写入交接便签（≤1200 字符，默认 72h TTL，到期自动清理）。',
    {
      note_id: z.string().optional(),
      content: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      ttl_seconds: z.number().int().positive().optional(),
    },
    async (args) => {
      requireScope(requestAuth, getRequiredScope('xinchao_handoff_note'));
      const result = engine.handleHandoffNote(args, requestAuth as RequestAuth);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
