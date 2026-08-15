/**
 * tools/context.ts — xinchao_context（只读）工具注册。
 *
 * handler 闭包捕获 requestAuth：先 requireScope(read)，再调用
 * engine.handleXinchaoContext(args, requestAuth)。业务错误（EngineError）
 * 转为 isError 内容；鉴权失败由 requireScope 抛 MCP 错误（SDK 收为 isError）。
 *
 * 协议：MIT。100% 自研。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EngineError, type MindEngine } from '../tools.js';
import type { RequestAuth } from '../../types/index.js';
import { getRequiredScope, requireScope } from '../auth.js';

/** 注册 xinchao_context（只读）工具。 */
export function registerContextTool(
  server: McpServer,
  engine: MindEngine,
  requestAuth: RequestAuth | null,
): void {
  server.tool(
    'xinchao_context',
    '读取 12 维态 + 叙事摘要的上下文信封（只读，约 2200 token）。',
    { session_id: z.string().min(1) },
    async (args) => {
      requireScope(requestAuth, getRequiredScope('xinchao_context'));
      try {
        const env = engine.handleXinchaoContext(args, requestAuth as RequestAuth);
        return { content: [{ type: 'text', text: JSON.stringify(env) }] };
      } catch (e) {
        const code = e instanceof EngineError ? e.code : 'ERR_INTERNAL';
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: code }) }],
          isError: true,
        };
      }
    },
  );
}
