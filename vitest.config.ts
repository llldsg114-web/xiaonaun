import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
    // 既有 oauth.test.ts 的 PKCE 流程依赖 auto-consent（v1 默认 true）。
    // v2 生产默认改为 false（per-account 同意页），但为保持既有 43 测试绿，
    // 在测试环境显式置 true（对应 v2-design §9.4「测试 server 局部传 true」）。
    // ② 的 oauth-sso.test.ts（T03）将显式覆盖此行为验证 consent 必现。
    env: {
      OAUTH_AUTO_CONSENT: 'true',
    },
  },
});
