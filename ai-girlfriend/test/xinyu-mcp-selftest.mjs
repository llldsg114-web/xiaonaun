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
  // summarize：提取最强 2-3 维 + narrative
  const env = {
    dimensions: [
      { name: "affection", value: 0.91 },
      { name: "calm", value: -0.42 },
      { name: "curiosity", value: 0.13 },
      { name: "jealousy", value: 0.02 },
    ],
    narrative: "她今天整体很黏你，但有点小醋意。",
  };
  const frag = mc.summarize(env);
  ok("summarize 含最强维 affection", frag.includes("affection: 0.91"));
  ok("summarize 含次强维 calm", frag.includes("calm: -0.42"));
  ok("summarize 不含最弱维 jealousy", !frag.includes("jealousy"));
  ok("summarize 含 narrative", frag.includes("她今天整体很黏你"));
  eq("buildFragment 等价 summarize", mc.buildFragment(env), frag);
  eq("summarize 空信封返回空串", mc.summarize(null), "");

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("自测异常：", e); process.exit(1); });
