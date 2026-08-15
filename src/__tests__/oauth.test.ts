/**
 * oauth.test.ts — 心屿标准 OAuth 2.1 授权服务器集成测试。
 *
 * 覆盖：
 *  - PKCE 全流程（授权码 + 正确 verifier 换 token 成功 / 错误 verifier 失败 / code 复用失败）
 *  - /introspect（活跃 active:true / 未知 active:false / 吊销后 active:false）
 *  - /revoke 生效
 *  - scope 越权拒绝 / client 未注册拒绝
 *  - 生产 NODE_ENV=production 无 JWT_SECRET 启动抛错
 *
 * 通过真实 HTTP（监听 127.0.0.1:0 + fetch）做端到端验证，确保与 3 个 MCP
 * 工具的 verify 兼容桥（scopes 数组）可用。
 */

import { AddressInfo, type Server } from 'node:net';
import express from 'express';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenMiddleware } from '../auth/token.js';
import { OAuthServer } from '../oauth/index.js';
import { PkceUtil } from '../oauth/pkce.js';
import { AccountStore } from '../oauth/accounts.js';
import { SessionStore } from '../oauth/session.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { LOCAL_SUBJECT } from '../config.js';

const TEST_SECRET = 'oauth-test-secret';
const TEST_ISSUER = 'xinyu-mind-engine';
const CLIENT_ID = 'xinyu-web';
const REDIRECT_URI = 'http://localhost:3000/';
const TEST_USER = 'oauth_test_user';
const TEST_PASS = 'oauth_test_pass';

interface TestServer {
  base: string;
  auth: TokenMiddleware;
  close: () => Promise<void>;
}

let srv: TestServer;
/** 已登录会话 cookie（登录闸门通过后随 /authorize 请求携带）。 */
let authCookie: string;

/** 启动一个隔离的 OAuthServer（绑定随机端口，账户落盘临时目录避免污染 .data）。 */
async function startServer(): Promise<TestServer> {
  const auth = new TokenMiddleware(TEST_SECRET, TEST_ISSUER);
  const tmp = mkdtempSync(path.join(tmpdir(), 'xinyu-oauth-'));
  const store = new JsonlStore(tmp);
  const accounts = new AccountStore(store);
  const sessions = new SessionStore();
  // 建一个确定口令的测试账户（避免首跑随机口令不可知）。
  if (!accounts.exists(TEST_USER)) accounts.create(TEST_USER, TEST_PASS);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  new OAuthServer(auth, { accounts, sessions }).register(app);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    auth,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** 用测试账户登录 /login，返回 `xinyu_sid=...` Cookie 字符串。 */
async function loginAndGetCookie(base: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: TEST_USER,
      password: TEST_PASS,
      redirect: '/',
    }).toString(),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('登录未返回 Set-Cookie');
  return setCookie.split(';')[0]; // "xinyu_sid=uuid"
}

/** 跑完整 PKCE 授权码流程（自动携带已登录 cookie），返回授权码与参数。 */
async function runPkceFlow(
  base: string,
  opts: { scope?: string; verifier?: string; cookie?: string } = {},
): Promise<{ code: string | null; verifier: string; location: string }> {
  const pkce = new PkceUtil();
  const verifier = opts.verifier ?? pkce.generateVerifier();
  const challenge = pkce.challengeS256(verifier);
  const scope = opts.scope ?? 'read write';
  const state = 'xyz';
  const url =
    `${base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scope)}&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;

  const headers: Record<string, string> = {};
  if (opts.cookie ?? authCookie) headers['Cookie'] = opts.cookie ?? authCookie;

  const res = await fetch(url, { redirect: 'manual', headers });
  const location = res.headers.get('location') ?? '';
  const code = location ? new URL(location, base).searchParams.get('code') : null;
  return { code, verifier, location };
}

/** 用授权码 + verifier 向 /token 换 access_token。 */
async function exchangeToken(
  base: string,
  params: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

beforeAll(async () => {
  srv = await startServer();
  authCookie = await loginAndGetCookie(srv.base);
});

afterAll(async () => {
  await srv?.close();
});

describe('P0-1/P0-2 PKCE 授权码全流程', () => {
  it('正确 verifier 换 token 成功，且兼容 verify(scopes 数组)', async () => {
    const { code, verifier } = await runPkceFlow(srv.base);
    expect(code).toBeTruthy();

    const { status, body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });

    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(86400);
    expect(body.refresh_token).toBeTruthy();
    expect(body.scope).toBe('read write');

    // 兼容桥：既有 verify 读 decoded.scopes 数组，3 个 MCP 工具 v1 零改动。
    expect(srv.auth.verify(body.access_token, 'read').ok).toBe(true);
    expect(srv.auth.verify(body.access_token, 'write').ok).toBe(true);
    expect(srv.auth.verify(body.access_token, 'admin').ok).toBe(false);
  });

  it('错误 verifier 换 token 失败（invalid_grant）', async () => {
    const { code } = await runPkceFlow(srv.base);
    const wrongVerifier = new PkceUtil().generateVerifier();
    const { status, body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: wrongVerifier,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_grant');
  });

  it('授权码复用失败（一次性，invalid_grant）', async () => {
    const { code, verifier } = await runPkceFlow(srv.base);
    const first = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    expect(first.status).toBe(200);

    const second = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
  });
});

describe('P0-3 /introspect（RFC7662）', () => {
  it('活跃 access_token 返回 active:true（含 scope/sub/iss）', async () => {
    const { code, verifier } = await runPkceFlow(srv.base);
    const { body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });

    const res = await fetch(`${srv.base}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.access_token }),
    });
    const out = await res.json();
    expect(out.active).toBe(true);
    expect(out.scope).toBe('read write');
    // v2 ②：sub 为真实登录账户名（非降级兜底 LOCAL_SUBJECT）。
    expect(out.sub).toBe(TEST_USER);
    expect(out.sub).not.toBe(LOCAL_SUBJECT);
    expect(out.iss).toBe(TEST_ISSUER);
    expect(out.token_type).toBe('Bearer');
  });

  it('未知 token 返回 active:false', async () => {
    const res = await fetch(`${srv.base}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-jwt' }),
    });
    const out = await res.json();
    expect(out.active).toBe(false);
  });

  it('吊销后 active:false', async () => {
    const { code, verifier } = await runPkceFlow(srv.base);
    const { body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });

    // 吊销前活跃
    const before = await fetch(`${srv.base}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.access_token }),
    }).then((r) => r.json());
    expect(before.active).toBe(true);

    // 吊销
    const rev = await fetch(`${srv.base}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.access_token }),
    });
    expect(rev.status).toBe(200);

    // 吊销后不活跃
    const after = await fetch(`${srv.base}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.access_token }),
    }).then((r) => r.json());
    expect(after.active).toBe(false);
  });
});

describe('P0-4 /revoke（RFC7009）', () => {
  it('吊销 refresh_token 后无法再用其换新', async () => {
    const { code, verifier } = await runPkceFlow(srv.base);
    const { body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    const refresh = body.refresh_token;
    expect(refresh).toBeTruthy();

    // 用 refresh 换新成功（P1 轮换）
    const rotate = await exchangeToken(srv.base, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
    });
    expect(rotate.status).toBe(200);
    expect(rotate.body.access_token).toBeTruthy();

    // 吊销旧 refresh
    const rev = await fetch(`${srv.base}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: refresh, token_type_hint: 'refresh_token' }),
    });
    expect(rev.status).toBe(200);

    // 旧 refresh 已吊销，无法再换
    const reuse = await exchangeToken(srv.base, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });
});

describe('P0-5/P0-1 安全与注册校验', () => {
  it('scope 越权被拒绝（invalid_scope）', async () => {
    const res = await fetch(
      `${srv.base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=admin&code_challenge=abc&code_challenge_method=S256`,
      { redirect: 'manual', headers: { Cookie: authCookie } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_scope');
  });

  it('未注册 client 被拒绝（invalid_client）', async () => {
    const res = await fetch(
      `${srv.base}/authorize?response_type=code&client_id=unknown-client` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=read&code_challenge=abc&code_challenge_method=S256`,
      { redirect: 'manual', headers: { Cookie: authCookie } },
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });
});

describe('P0-7 生产安全护栏', () => {
  it('生产 NODE_ENV=production 无 JWT_SECRET 启动抛错', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevSecret = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      expect(() => new TokenMiddleware()).toThrow();
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    }
  });
});
