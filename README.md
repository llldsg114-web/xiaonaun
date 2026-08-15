# 心屿心智引擎（路线④ · 完全自研）

> 产品名：**心屿** ｜ 伴侣名：**小暖**（不可改名）
> 协议：**MIT** ｜ 代码 100% 自有，完全从零实现，不依赖/不 fork 任何第三方「心潮（xinchao）」项目，不使用 `ombre-brain`。

## 这是什么

心屿自研心智引擎是一套 **Node.js + TypeScript** 服务，对外仅暴露 3 个 MCP（Model Context Protocol）工具，承载 12 维心理驱动状态机、Bridge 安全边界与上下文信封。全部逻辑自托管，零外部 LLM / 网络调用。

## 技术栈（仅 MIT / 宽松协议）

| 用途 | 选型 | 协议 |
|------|------|------|
| MCP 传输 | `@modelcontextprotocol/sdk`（Streamable HTTP） | MIT |
| HTTP 路由 | `express` | MIT |
| 入参校验 | `zod` | MIT |
| 鉴权 | `jsonwebtoken` + Node `crypto` | MIT |
| 配置 | `dotenv` | BSD-2-Clause |
| 存储 | 自研 JSONL（零依赖） | MIT（自有） |
| 测试 | `vitest` | MIT |

## 目录结构

```
src/
├── index.ts              # MCP Streamable HTTP 服务入口
├── config.ts             # 全部常量/维度键/安全通道集中定义
├── types/index.ts        # 共享类型与错误码
├── auth/token.ts         # OAuth 2.1 Bearer 签发/验签
├── state/                # 12 维状态机 + 衰减—饱和
├── storage/              # 自研 JSONL 存储（记忆/幂等/便签）
├── mcp/                  # 工具注册 + Bridge 安全边界 + 信封
├── observability/        # 审计日志
└── __tests__/            # 单元测试（bridge / state / mcp）
```

## 安装与启动

```bash
npm install
cp .env.example .env        # 按需修改（务必替换 JWT_SECRET）
npm run dev                 # tsx 热重载启动（开发）
# 或生产构建
npm run build && npm start
```

服务默认监听 `http://localhost:3000/mcp`（端点路径见 `MCP_ENDPOINT`）。

### 获取令牌（开发）

```bash
npm run token            # 输出一个 read,write 范围的 Bearer 令牌
# 或 POST /token {"subject":"user","scopes":["read","write"]}
```

### 健康检查

```bash
curl http://localhost:3000/health
```

## 三个 MCP 工具

1. **xinchao_context**（scope=read）：输出约 2200 token 的 Context Envelope（12 维态 + 叙事摘要 + 命中记忆 + 安全标志）。**绝不**包含 dreams/longing/autonomous 内容。
2. **xinchao_event**（scope=write）：`event_id` 幂等键；仅接受 `user_interaction` / `user_note` / `scheduled_interaction` 三类；非法类型或缺失 `event_id` 即拒绝。
3. **xinchao_handoff_note**（scope=write）：≤1200 字符，默认 72h（259200s）TTL，到期自动清理。

> 调用约定（v1）：Bearer 令牌通过工具参数 `token` 传入（OAuth 2.1 Bearer 语义在应用层落地）；生产可改为标准授权服务器 + 请求头透传。

## 安全边界（Bridge）

`dreams / longing / autonomous` 三类内部态为封锁通道，**任何代码路径都不得自动注入用户可见窗口**。Bridge 对信封做最终过滤（深度剥离封锁键），并有单元测试 `src/__tests__/bridge.test.ts` 强制覆盖（P0-5）。

## 测试

```bash
npm test                 # vitest run
npm run test:watch       # 监听
```

测试覆盖：P0-1（12 维定义）、P0-2（衰减—饱和结算与幂等接口）、P0-3（context 信封）、P0-4（event 写入+幂等）、P0-5（Bridge 不越界）、P1（handoff 便签）。

## 架构假设（摘要）

A1 Node+TS+官方 MCP SDK；A2 v1 本地 JSONL（预留 SQLite+向量）；A3 饱和带 [0.65,0.80]、基线 0.20、半衰期 8 轮；A4 单用户单会话；A5 轻量 Bearer + read/write scope；A6 信封叙事由状态驱动模板生成（零外部 LLM）；A7 记忆检索用启发式相关度（不引外部 embedding）。
