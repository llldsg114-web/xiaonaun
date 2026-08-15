/**
 * tools/event.ts — xinchao_event（写入 + 幂等）工具注册。
 *
 * handler 闭包捕获 requestAuth：先 requireScope(write)，再调用
 * engine.handleXinchaoEvent(args, requestAuth)。业务结果（含 E1001/E1002/
 * 幂等）由引擎以正常结果返回；鉴权失败由 requireScope 抛 MCP 错误。
 *
 * 协议：MIT。100% 自研。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MindEngine } from '../tools.js';
import type { RequestAuth } from '../../types/index.js';
import { getRequiredScope, requireScope } from '../auth.js';

/** 注册 xinchao_event（写入）工具。 */
export function registerEventTool(
  server: McpServer,
  engine: MindEngine,
  requestAuth: RequestAuth | null,
): void {
  server.tool(
    'xinchao_event',
    '写入一次对话事件（event_id 幂等；仅接受 user_interaction / user_note / scheduled_interaction）。',
    {
      // 注：event_id / type 仅做基本形状校验，语义校验（E1001 空 event_id、
      // E1002 非法类型）交由 MindEngine 的业务逻辑完成，以便经工具层返回
      // 一致的 JSON-RPC 业务错误体（而非 zod 输入校验错误）。
      event_id: z.string(),
      session_id: z.string().min(1),
      type: z.string(),
      payload: z.object({
        content: z.string(),
        intensity: z.number().min(0).max(1),
        tags: z.array(z.string()),
      }),
      timestamp: z.string().optional(),
    },
    async (args) => {
      requireScope(requestAuth, getRequiredScope('xinchao_event'));
      const result = engine.handleXinchaoEvent(args, requestAuth as RequestAuth);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
