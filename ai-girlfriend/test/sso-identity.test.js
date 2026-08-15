"use strict";
/**
 * sso-identity.test.js · v2 T05 前端身份接线回归（设计 §3.1 + §9.1）
 *
 * 运行：  node --test test/sso-identity.test.js
 *   或随整体：node --test test/*.test.js
 *
 * 覆盖（任务 C · 3 用例）：
 *   T05-1 · identity() 带有效 Bearer 时，从 /userinfo 取真实 sub（并写入缓存，二次命中不联网）
 *   T05-2 · /userinfo 失败（401 / 网络异常 / 无令牌）降级为稳定设备 id（绝不抛）
 *   T05-3 · sessionId 恒为 'conv-' + deviceId（设计 §9.1：单设备单主对话）
 *
 * 纯增量，零新依赖：node 原生 fetch / localStorage（Map mock）/ crypto.randomUUID。
 */

const test = require("node:test");
const assert = require("node:assert");

/* node 下补齐浏览器全局（与 engine-mindprofile.test.js 同款 Map 实现） */
globalThis.localStorage = globalThis.localStorage || {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); },
};

/* 动态加载 ESM 的 mcp-client / token-store，规避 CJS/ESM 混用限制 */
async function getMcpClient() {
  const mod = await import("../mcp-client.js");
  return mod.McpClient;
}
async function getTokenStore() {
  const mod = await import("../token-store.js");
  return mod.TokenStore;
}

/* 安装 /userinfo 的 fetch mock；返回 { restore }，restore 必须被调用以还原全局 fetch */
function mockUserInfo(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts || {});
  return { restore() { globalThis.fetch = real; } };
}

/* 构造一个 200 OK 的 /userinfo 响应 */
function userInfoOk(sub) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ sub }),
  };
}
function userInfoFail(status) {
  return {
    ok: false,
    status: status || 401,
    headers: { get: () => "application/json" },
    json: async () => ({}),
  };
}

test("T05-1 · identity() 带有效 Bearer 时从 /userinfo 取真实 sub（并缓存，二次命中不联网）", async () => {
  const McpClient = await getMcpClient();
  const TokenStore = await getTokenStore();
  localStorage.clear();

  const client = new McpClient({ proxyUrl: "/api/mcp", asBase: "http://localhost:3100" });
  const store = new TokenStore();
  client._store = store;
  store.setTokens({
    access_token: "at-real",
    refresh_token: "rt",
    expires_at: Date.now() + 3600_000,
    token_type: "Bearer",
  });

  let calls = 0;
  const m = mockUserInfo((url, opts) => {
    calls++;
    // 必须只请求 /userinfo（asBase 去掉末尾斜杠后拼接）
    assert.ok(url.replace(/\/+$/, "").endsWith("/userinfo"),
      "/userinfo 是唯一应被请求的端点，实测: " + url);
    assert.strictEqual(opts.method, "GET", "/userinfo 须用 GET");
    assert.strictEqual(opts.headers && opts.headers.Authorization, "Bearer at-real",
      "/userinfo 须带 Authorization: Bearer <access_token>");
    return userInfoOk("user-sso-42");
  });
  try {
    const id = await client.identity();
    assert.strictEqual(id.subject, "user-sso-42", "subject 须为 /userinfo 返回的真实 sub");
    assert.strictEqual(calls, 1, "/userinfo 首次调用恰好一次");
    // 真实 sub 必须写入缓存
    assert.strictEqual(store.getSubjectReal(), "user-sso-42", "真实 sub 须经 setSubjectReal 缓存");
    // 二次调用命中缓存，不再联网
    const id2 = await client.identity();
    assert.strictEqual(id2.subject, "user-sso-42", "缓存命中后 subject 不变");
    assert.strictEqual(calls, 1, "缓存命中后不应再次请求 /userinfo");
  } finally {
    m.restore();
  }
});

test("T05-2 · /userinfo 失败（401 / 网络异常 / 无令牌）降级为稳定设备 id（绝不抛）", async () => {
  const McpClient = await getMcpClient();
  const TokenStore = await getTokenStore();
  localStorage.clear();

  const client = new McpClient({ proxyUrl: "/api/mcp", asBase: "http://localhost:3100" });
  const store = new TokenStore();
  client._store = store;
  store.setTokens({
    access_token: "at-bad",
    refresh_token: "rt",
    expires_at: Date.now() + 3600_000,
    token_type: "Bearer",
  });
  const deviceId = store.getDeviceId();

  // 分支①：401 未授权
  let m = mockUserInfo((url) => {
    assert.ok(url.replace(/\/+$/, "").endsWith("/userinfo"));
    return userInfoFail(401);
  });
  try {
    const id = await client.identity();
    assert.strictEqual(id.subject, deviceId,
      "401 时 subject 须降级为稳定设备 id（不抛）");
    assert.strictEqual(store.getSubjectReal(), null,
      "401 失败不应写入缓存");
  } finally { m.restore(); }

  // 分支②：网络异常（fetch 抛错）—— 必须被吞掉，降级且不抛
  m = mockUserInfo(() => { throw new Error("network down"); });
  try {
    const id = await client.identity();
    assert.strictEqual(id.subject, deviceId,
      "网络异常时 subject 须降级为设备 id（fetch 异常不向上抛）");
  } finally { m.restore(); }

  // 分支③：无令牌（更无身份可拉）→ 仍返回稳定设备 id
  store.clear();
  const idNoTok = await client.identity();
  assert.strictEqual(idNoTok.subject, deviceId,
    "无令牌时 subject 仍为稳定设备 id（getSubjectReal 命中前也无 token）");
  assert.ok(idNoTok.sessionId.startsWith("conv-"),
    "无令牌降级路径 sessionId 仍为 conv- 前缀");
});

test("T05-3 · sessionId 恒为 'conv-' + deviceId（设计 §9.1：单设备单主对话）", async () => {
  const McpClient = await getMcpClient();
  const TokenStore = await getTokenStore();
  localStorage.clear();

  const client = new McpClient({ proxyUrl: "/api/mcp", asBase: "http://localhost:3100" });
  const store = new TokenStore();
  client._store = store;
  const deviceId = store.getDeviceId();
  const expected = "conv-" + deviceId;

  // 真实 sub 路径：sessionId 须为 conv-<deviceId>
  let m = mockUserInfo((url) => url.replace(/\/+$/, "").endsWith("/userinfo")
    ? userInfoOk("u9")
    : userInfoFail(500));
  try {
    const id = await client.identity();
    assert.strictEqual(id.sessionId, expected,
      "sessionId 须严格等于 conv-<deviceId>（真实 sub 路径）");
    assert.strictEqual(id.sessionId, "conv-" + store.getDeviceId(),
      "sessionId 与 store.getDeviceId() 推导一致");
  } finally { m.restore(); }

  // 降级路径：sessionId 同样须为 conv-<deviceId>
  store.clearSubjectReal();
  const id2 = await client.identity();
  assert.strictEqual(id2.sessionId, expected,
    "sessionId 须严格等于 conv-<deviceId>（降级路径）");
});
