/**
 * xinyu-mcp-selftest.mjs · 心屿 MCP 前端纯函数自测（零框架，node 直接跑）
 *
 * 运行：node test/xinyu-mcp-selftest.mjs
 * 覆盖：pkce(sha256/base64url/randomVerifier/deriveChallenge)、
 *       token-store(round-trip/过期/设备id)、
 *       mcp-client(crc32/event_id/summarize)。
 */

import { createHash } from "node:crypto";
import { sha256, base64url, randomVerifier, deriveChallenge } from "../pkce.js";
import { TokenStore } from "../token-store.js";
import { McpClient, crc32 } from "../mcp-client.js";

/* node 下补齐浏览器全局，便于 token-store 自测 */
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}
function eq(name, a, b) {
  ok(name + "  (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")", a === b);
}

async function main() {
  console.log("\n[pkce] SHA-256 / base64url / PKCE");
  // sha256 确定性
  const a = await sha256("hello");
  const b = await sha256("hello");
  ok("sha256 确定性（同输入同输出）", a.byteLength === 32 && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
  // sha256 与 node 独立实现一致
  const expected = createHash("sha256").update("hello").digest();
  ok("sha256 与 node 实现一致", Buffer.compare(Buffer.from(a), expected) === 0);
  // base64url：无填充、无 +/、URL 安全
  const bu = base64url(a);
  ok("base64url 无 '+'/'\/'/'='", !/[+/=]/.test(bu));
  // deriveChallenge = base64url(sha256(verifier))，与独立实现一致
  const v = randomVerifier(64);
  const ch = await deriveChallenge(v);
  const nodeCh = createHash("sha256").update(v).digest()
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  eq("deriveChallenge = S256(verifier)", ch, nodeCh);
  // randomVerifier：长度 64、字符集合规、两次不同
  ok("randomVerifier 长度 64", v.length === 64);
  ok("randomVerifier 字符集合规", /^[A-Za-z0-9\-._~]+$/.test(v));
  ok("randomVerifier 两次不同", randomVerifier(64) !== randomVerifier(64));

  console.log("\n[token-store] 存取 / 过期 / 设备身份");
  const store = new TokenStore();
  store.setTokens({ access_token: "at-1", refresh_token: "rt-1", expires_at: Date.now() + 3600_000, token_type: "Bearer" });
  eq("load 往返一致", store.getAccessToken(), "at-1");
  ok("未过期 isExpired=false", store.isExpired() === false);
  store.setTokens({ access_token: "at-2", expires_at: Date.now() - 1000 });
  ok("已过期 isExpired=true", store.isExpired() === true);
  const d1 = store.getDeviceId();
  const d2 = store.getDeviceId();
  ok("设备 id 稳定（两次相同）", d1 === d2 && typeof d1 === "string" && d1.length > 0);
  eq("subject = 设备 id", store.getSubject(), d1);
  store.clear();
  eq("clear 后无令牌", store.getAccessToken(), "");
  // 续期相关（P1-2）：refresh_token 读取 / 清除 access / 续期写回
  store.setTokens({ access_token: "at-r", refresh_token: "rt-r", expires_at: Date.now() + 3600_000, token_type: "Bearer" });
  eq("getRefreshToken 读取", store.getRefreshToken(), "rt-r");
  store.clearAccessToken();
  eq("clearAccessToken 后无 access", store.getAccessToken(), "");
  ok("clearAccessToken 保留 refresh", store.getRefreshToken() === "rt-r");
  store.refresh({ access_token: "at-r2", refresh_token: "rt-r2", expires_in: 3600 });
  eq("refresh 写回新 access", store.getAccessToken(), "at-r2");
  ok("refresh 由 expires_in 推导 expires_at", typeof store.load().expires_at === "number" && store.load().expires_at > Date.now());

  console.log("\n[mcp-client] crc32 / event_id / summarize");
  eq("crc32 标准校验值 (123456789)", crc32("123456789"), 0xcbf43926 >>> 0);
  const mc = new McpClient({ proxyUrl: "/api/mcp", asBase: "http://localhost:3100" });
  const sid = "dev-test-session";
  // event_id = xinyu-${sessionId}-${Date.now().toString(36)}-${crc32(content)}
  // 设计含时间分量，故冻结时钟验证「同毫秒同内容稳定」契约，避免跨毫秒偶发抖动（非源码缺陷）。
  const _now = Date.now;
  Date.now = () => 1700000000000;
  const eid1 = mc._stableEventId("你好", sid);
  const eid2 = mc._stableEventId("你好", sid);
  Date.now = _now;
  ok("event_id 格式合规", /^xinyu-[\w-]+-[0-9a-z]+-[0-9a-z]+$/.test(eid1));
  ok("同内容同会话 event_id 稳定（冻结时钟）", eid1 === eid2);
  ok("不同内容 event_id 不同", mc._stableEventId("不同", sid) !== eid1);
  // summarize：从 state_vector 取最强 2-3 维 + narrative（D3 信封字段对齐）
  const env = {
    state_vector: {
      possess: 0.78, monitor: 0.71, crave: 0.63, share: 0.55, libido: 0.10,
      curiosity: 0.40, boredom: 0.05, social: 0.20, duty: 0.30,
      reflection: 0.12, grieve: 0.08, anger: 0.02,
    },
    narrative: "她今天整体很黏你，但有点小醋意。",
  };
  const frag = mc.summarize(env);
  // 最强 3 维：possess .78 / monitor .71 / crave .63（share .55 为第 4 强，不入 top3）
  ok("summarize 含最强维 想她占有(0.78)", frag.includes("想她占有(0.78)"));
  ok("summarize 含 惦记她(0.71)", frag.includes("惦记她(0.71)"));
  ok("summarize 含 馋她黏着(0.63)", frag.includes("馋她黏着(0.63)"));
  ok("summarize 不含第4强 想和她分享", !frag.includes("想和她分享"));
  ok("summarize 标签映射正确（非原始键名）", !frag.includes("possess") && !frag.includes("monitor"));
  ok("summarize 含 narrative 正文", frag.includes("她今天整体很黏你，但有点小醋意"));
  ok("summarize 结构 = narrative。她此刻最强烈的心绪是：<d1>、<d2>、<d3>。",
    frag === "她今天整体很黏你，但有点小醋意。她此刻最强烈的心绪是：想她占有(0.78)、惦记她(0.71)、馋她黏着(0.63)。");
  eq("buildFragment 等价 summarize", mc.buildFragment(env), frag);
  // 空 state_vector → 仅 narrative（不报错）
  const envEmptyVec = { narrative: "她只是安静地陪着你。" };
  eq("空 state_vector 仅 narrative", mc.summarize(envEmptyVec), "她只是安静地陪着你。");
  // 无 narrative 仅维度 → 输出「她此刻最强烈的心绪是：…」
  const envNoNarr = { state_vector: { anger: 0.90, calmx: 0.10 } };
  ok("仅维度时输出 她此刻最强烈的心绪是：", mc.summarize(envNoNarr).startsWith("她此刻最强烈的心绪是："));
  // 兼容旧 dimensions 数组回退（不影响新契约）
  const envLegacy = { dimensions: [{ name: "affection", value: 0.91 }, { name: "calm", value: -0.42 }], narrative: "n" };
  ok("兼容 dimensions 数组回退", mc.summarize(envLegacy).includes("affection(0.91)"));
  eq("summarize 空信封返回空串", mc.summarize(null), "");

  console.log("\n[mcp-client] P1-2 续期 / 401 重试");
  // ensureValidToken：access 即将过期 + 有 refresh → 调 AS /token 换新并写回
  const rstore = new TokenStore();
  rstore.setTokens({ access_token: "old-at", refresh_token: "rt-x", expires_at: Date.now() - 1000, token_type: "Bearer" });
  const mcR = new McpClient({ proxyUrl: "/api/mcp", asBase: "http://localhost:3100" });
  mcR._store = rstore;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const headers = { get: () => "application/json" };
    if (u.includes("/token")) return { ok: true, status: 200, headers, json: async () => ({ access_token: "new-at", refresh_token: "rt-x2", expires_in: 3600, token_type: "Bearer" }) };
    return { ok: true, status: 200, headers, json: async () => ({ result: { content: [] } }) };
  };
  try {
    const ready = await mcR.ensureValidToken();
    ok("ensureValidToken 续期后返回 true", ready === true);
    eq("ensureValidToken 写回新 access", rstore.getAccessToken(), "new-at");
    ok("ensureValidToken 写回新 refresh", rstore.getRefreshToken() === "rt-x2");
  } finally { globalThis.fetch = realFetch; }
  // _call 收到 401 → 清 access + refresh，以刷新后的 Bearer 头重试一次（重试用新 token）
  const fstore = new TokenStore();
  fstore.setTokens({ access_token: "expired-at", refresh_token: "rt-y", expires_at: Date.now() + 999999, token_type: "Bearer" });
  const mcF = new McpClient({ proxyUrl: "/x", asBase: "http://localhost:3100" });
  mcF._store = fstore;
  let callCount = 0;
  const capturedAuth = [];  // 每次 MCP 请求的 Authorization 头（验证 Bearer 而非 arguments.token）
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const headers = { get: () => "application/json" };
    if (u.includes("/token")) return { ok: true, status: 200, headers, json: async () => ({ access_token: "refreshed-at", refresh_token: "rt-y", expires_in: 3600, token_type: "Bearer" }) };
    callCount++;
    const authHeader = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || null;
    capturedAuth.push(authHeader);
    if (callCount === 1) return { ok: false, status: 401, headers, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    // 重试用刷新后的 Bearer 头；arguments 不再含 token
    return { ok: true, status: 200, headers, json: async () => ({ result: { content: [{ type: "text", text: JSON.stringify({ ok: true, received: body.params.arguments }) }] } }) };
  };
  try {
    const out = await mcF._call("xinchao_context", { subject: "s", session_id: "s" });
    ok("_call 401 后重试成功", out && out.ok === true);
    ok("_call 401 首次请求携带过期 Bearer 头", capturedAuth[0] === "Bearer expired-at");
    ok("_call 401 重试用刷新后的 Bearer 头", capturedAuth[1] === "Bearer refreshed-at");
    ok("_call 401 重试请求不含 arguments.token", !out.received || !("token" in out.received));
    ok("_call 401 仅重试一次（共 2 次调用）", callCount === 2);
  } finally { globalThis.fetch = realFetch; }

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("自测异常：", e); process.exit(1); });
