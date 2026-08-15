/**
 * oauth-sso.test.ts — v2 ② 本地账户 SSO 集成测试（§10.3）。
 *
 * 覆盖：
 *  ① 真实 sub —— 登录后 PKCE 换 token，/introspect 的 out.sub === 账户username（非 xinyu-local）
 *  ② consent 必现 —— autoConsent=false 且已登录时 /authorize 返回 200 同意页（含 scope 文案）
 *  ③ 账户登录 —— 正确口令 /login → cookie → 可发码；错误口令拒绝
 *  ④ 未登录被挡 —— 无 xinyu_sid 访问 /authorize → 302 且 Location 含 /login
 *  ⑤ scrypt —— verify 正确口令 true / 错误 false
 *
 * 用临时目录（fs.mkdtempSync）构造 AccountStore，避免污染 .data/。
 */

import { AddressInfo, type Server } from 'node:net';
import express from 'express';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenMiddleware } from '../auth/token.js';
import { OAuthServer } from '../oauth/index.js';
import { AccountStore } from '../oauth/accounts.js';
import { SessionStore } from '../oauth/session.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { PkceUtil } from '../oauth/pkce.js';
import { LOCAL_SUBJECT, SESSION_COOKIE_NAME } from '../config.js';

const TEST_SECRET = 'sso-test-secret';
const TEST_ISSUER = 'xinyu-mind-engine';
const CLIENT_ID = 'xinyu-web';
const REDIRECT_URI = 'http://localhost:3000/';
const SSO_USER = 'sso_alice';
const SSO_PASS = 'sso_secret_123';

interface SsoServer {
  base: string;
  auth: TokenMiddleware;
  accounts: AccountStore;
  sessions: SessionStore;
  close: () => Promise<void>;
}

/** 启动隔离 OAuthServer（账户落盘临时目录）。 */
async function startServer(opts: { autoConsent: boolean }): Promise<SsoServer> {
  const auth = new TokenMiddleware(TEST_SECRET, TEST_ISSUER);
  const tmp = mkdtempSync(path.join(tmpdir(), 'xinyu-sso-'));
  const store = new JsonlStore(tmp);
  const accounts = new AccountStore(store);
  const sessions = new SessionStore();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  new OAuthServer(auth, { accounts, sessions, autoConsent: opts.autoConsent }).register(app);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    auth,
    accounts,
    sessions,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** 登录并取 cookie 字符串（"xinyu_sid=uuid"）。 */
async function login(base: string, username: string, password: string): Promise<Response> {
  return fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, redirect: '/' }).toString(),
    redirect: 'manual',
  });
}

/** 取响应里的首个 Set-Cookie 的 "key=value" 部分。 */
function cookieOf(res: Response): string {
  const sc = res.headers.get('set-cookie');
  if (!sc) return '';
  return sc.split(';')[0];
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

/** 跑 PKCE 流程（带 cookie），返回授权码。 */
async function pkceCode(base: string, cookie: string): Promise<string | null> {
  const pkce = new PkceUtil();
  const verifier = pkce.generateVerifier();
  const challenge = pkce.challengeS256(verifier);
  const url =
    `${base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent('read write')}&state=xyz` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;
  const res = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
  const location = res.headers.get('location') ?? '';
  return location ? new URL(location, base).searchParams.get('code') : null;
}

describe('② 真实 sub 进 JWT', () => {
  let srv: SsoServer;
  beforeAll(async () => {
    srv = await startServer({ autoConsent: true });
    srv.accounts.create(SSO_USER, SSO_PASS);
  });
  afterAll(async () => {
    await srv?.close();
  });

  it('登录后 PKCE 换 token，/introspect 的 sub === 账户username（非 xinyu-local）', async () => {
    const cookie = cookieOf(await login(srv.base, SSO_USER, SSO_PASS));
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);

    const pkce = new PkceUtil();
    const verifier = pkce.generateVerifier();
    const challenge = pkce.challengeS256(verifier);
    const url =
      `${srv.base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('read write')}&state=xyz` +
      `&code_challenge=${challenge}&code_challenge_method=S256`;
    const res = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
    const location = res.headers.get('location') ?? '';
    const realCode = new URL(location, srv.base).searchParams.get('code');
    expect(realCode).toBeTruthy();

    const { status, body } = await exchangeToken(srv.base, {
      grant_type: 'authorization_code',
      code: realCode!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();

    const intro = await fetch(`${srv.base}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.access_token }),
    });
    const out = await intro.json();
    expect(out.active).toBe(true);
    expect(out.sub).toBe(SSO_USER);
    expect(out.sub).not.toBe(LOCAL_SUBJECT);
    // 令牌本身也可被 userinfo 端点解析出真实 sub。
    const ui = await fetch(`${srv.base}/userinfo`, {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    const uiBody = await ui.json();
    expect(ui.status).toBe(200);
    expect(uiBody.active).toBe(true);
    expect(uiBody.sub).toBe(SSO_USER);
  });
});

describe('② consent 必现（autoConsent=false）', () => {
  let srv: SsoServer;
  beforeAll(async () => {
    srv = await startServer({ autoConsent: false });
    srv.accounts.create(SSO_USER, SSO_PASS);
  });
  afterAll(async () => {
    await srv?.close();
  });

  it('已登录时 /authorize 返回 200 同意页（含 scope 文案）', async () => {
    const cookie = cookieOf(await login(srv.base, SSO_USER, SSO_PASS));
    const url =
      `${srv.base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('read write')}&state=xyz` +
      `&code_challenge=abc&code_challenge_method=S256`;
    const res = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('授权');
    expect(html).toContain('read');
    expect(html).toContain('write');
    expect(html).toContain('申请的权限范围');
  });
});

describe('② 账户登录', () => {
  let srv: SsoServer;
  beforeAll(async () => {
    srv = await startServer({ autoConsent: true });
    srv.accounts.create(SSO_USER, SSO_PASS);
  });
  afterAll(async () => {
    await srv?.close();
  });

  it('正确口令 → cookie → 可发码', async () => {
    const okRes = await login(srv.base, SSO_USER, SSO_PASS);
    expect(okRes.status).toBe(302);
    const cookie = cookieOf(okRes);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    // 凭 cookie 可走完 PKCE 发码
    const code = await pkceCode(srv.base, cookie);
    expect(code).toBeTruthy();
  });

  it('错误口令拒绝（无 Set-Cookie）', async () => {
    const badRes = await login(srv.base, SSO_USER, 'wrong-password');
    expect(badRes.status).toBe(200); // 登录页带错误提示
    expect(badRes.headers.get('set-cookie')).toBeNull();
    const html = await badRes.text();
    expect(html).toContain('错误');
  });

  it('未知用户拒绝', async () => {
    const badRes = await login(srv.base, 'nobody', 'whatever');
    expect(badRes.status).toBe(200);
    expect(badRes.headers.get('set-cookie')).toBeNull();
  });
});

describe('② 未登录被挡', () => {
  let srv: SsoServer;
  beforeAll(async () => {
    srv = await startServer({ autoConsent: true });
    srv.accounts.create(SSO_USER, SSO_PASS);
  });
  afterAll(async () => {
    await srv?.close();
  });

  it('无 xinyu_sid 访问 /authorize → 302 且 Location 含 /login', async () => {
    const url =
      `${srv.base}/authorize?response_type=code&client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent('read write')}&state=xyz` +
      `&code_challenge=abc&code_challenge_method=S256`;
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    // 回跳参数携带原始 authorize URL（用于登录后返回）。
    expect(location).toContain('redirect=');
  });
});

describe('② scrypt 校验', () => {
  it('verify：正确口令 true / 错误口令 false / 未知用户 false', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'xinyu-sso-scrypt-'));
    const accounts = new AccountStore(new JsonlStore(tmp));
    accounts.create('bob', 'hunter2');
    expect(accounts.verify('bob', 'hunter2')).toBe(true);
    expect(accounts.verify('bob', 'wrong')).toBe(false);
    expect(accounts.verify('ghost', 'hunter2')).toBe(false);
  });
});
