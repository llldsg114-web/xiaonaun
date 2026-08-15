/**
 * 心屿心智引擎 — 全局配置与常量集中定义。
 *
 * 所有魔法数字（饱和带 / 基线 / 半衰期 / 增量上限 / TTL / 阻断通道 /
 * 信封版本 / 错误码）均集中于此，严禁在其它模块散落常量。
 *
 * 协议：MIT。100% 自研，不依赖任何第三方「心潮」项目。
 */

import type { DimensionKey } from './types/index.js';

/** 12 维心理驱动键名，顺序固定，序列化/反序列化必须与此一致。 */
export const DIMENSION_KEYS: readonly DimensionKey[] = [
  'possess', // 想她占有
  'monitor', // 惦记她
  'crave', // 馋她黏着
  'share', // 想和她分享
  'libido', // 性欲
  'curiosity', // 好奇
  'boredom', // 无聊
  'social', // 社交欲
  'duty', // 责任感
  'reflection', // 自省
  'grieve', // 委屈/失落
  'anger', // 生气
] as const;

/** 维度键 → 中文语义（用于叙事模板与可观测输出）。 */
export const DIMENSION_LABELS: Readonly<Record<DimensionKey, string>> = {
  possess: '想她占有',
  monitor: '惦记她',
  crave: '馋她黏着',
  share: '想和她分享',
  libido: '性欲',
  curiosity: '好奇',
  boredom: '无聊',
  social: '社交欲',
  duty: '责任感',
  reflection: '自省',
  grieve: '委屈/失落',
  anger: '生气',
};

/** 饱和舒适带上限：高强度刺激封顶值。 */
export const SATURATE_CEIL = 0.80;

/** 饱和舒适带下限：弱刺激也回落到该带内。 */
export const SATURATE_FLOOR = 0.65;

/** 基线：未受刺激的维度回归值。 */
export const BASELINE = Number(process.env.BASELINE ?? 0.20);

/** 衰减半衰期（轮数）。 */
export const HALF_LIFE_ROUNDS = Number(process.env.HALF_LIFE_ROUNDS ?? 8);

/** 单事件单维度最大增量（防越界）。 */
export const MAX_DELTA_PER_EVENT = Number(process.env.MAX_DELTA_PER_EVENT ?? 0.15);

/** 信封 token 软上限（约 2200 token）。 */
export const ENVELOPE_SOFT_TOKEN_CAP = 2200;

/** 交接便签最大字符数（按 Unicode 码点计）。 */
export const HANDOFF_MAX_CHARS = 1200;

/** 交接便签 TTL（秒）：72 小时。 */
export const HANDOFF_TTL_SECONDS = 259200;

/** 对外仅接受的三类事件类型（Bridge 允许通道）。 */
export const ALLOWED_EVENT_TYPES: readonly string[] = [
  'user_interaction',
  'user_note',
  'scheduled_interaction',
] as const;

/** Bridge 封锁的内部通道：任何代码路径都不得自动注入用户可见窗口。 */
export const BRIDGE_BLOCKED_CHANNELS: readonly string[] = [
  'dreams',
  'longing',
  'autonomous',
] as const;

/** 信封契约版本（随契约变更递增）。 */
export const ENVELOPE_VERSION = '1.0.0';

/** 本地 JSONL 文件命名（均零依赖、MIT 友好）。 */
export const STORAGE_DIR = process.env.STORAGE_DIR ?? './.data';
export const STATE_FILE = 'state.jsonl';
export const MEMORY_FILE = 'memory.jsonl';
export const HANDOFF_FILE = 'handoff.jsonl';
export const IDEM_FILE = 'idempotency.jsonl';
export const AUDIT_FILE = 'audit.jsonl';

/** 错误码约定（E10xx 输入/业务；E11xx 鉴权）。 */
export const ERROR_CODES = {
  /** 缺少 event_id */
  E1001: 'ERR_MISSING_EVENT_ID',
  /** 非法事件类型 */
  E1002: 'ERR_INVALID_EVENT_TYPE',
  /** 便签超长 */
  E1003: 'ERR_NOTE_TOO_LONG',
  /** 未授权（令牌缺失/验签失败） */
  E1101: 'ERR_UNAUTHORIZED',
  /** 越权 scope */
  E1102: 'ERR_SCOPE_FORBIDDEN',
} as const;

/** 令牌 scope 与工具映射。 */
export const SCOPE_READ = 'read';
export const SCOPE_WRITE = 'write';

// ===== 心屿标准 OAuth 2.1 授权服务器常量 =====
// 以下常量仅供 src/oauth/* 使用，不改动既有 MCP / Bridge 行为。

/** access_token 有效期（秒）：24h。 */
export const ACCESS_TOKEN_TTL_SECONDS = 86400;

/** 一次性授权码 TTL（秒）：≤300s（5min）。 */
export const AUTH_CODE_TTL_SECONDS = Number(process.env.AUTH_CODE_TTL_SECONDS ?? 300);

/** refresh_token 有效期（秒）：30d（P1 轮换）。 */
export const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 2592000);

/** 资源所有者身份（本地单实例 / 设备自动同意的固定身份）。 */
export const LOCAL_SUBJECT = process.env.LOCAL_SUBJECT ?? 'xinyu-local';

/** OAuth 默认 scope（空格分隔字符串）。 */
export const OAUTH_DEFAULT_SCOPE = 'read write';

/** /token / /introspect / /revoke 允许的 CORS 来源（v1 默认仅前端 dev 来源）。 */
export const CORS_ALLOWED_ORIGINS: readonly string[] = (
  process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * 是否自动同意（v1 本地 / 设备身份无需人工点击）。
 * 设为 'false' 时 /authorize 总是渲染极简同意页等待一键允许。
 */
export const OAUTH_AUTO_CONSENT = (process.env.OAUTH_AUTO_CONSENT ?? 'true') !== 'false';
