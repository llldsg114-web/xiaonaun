/**
 * pkce.js · 心屿前端零依赖 PKCE(S256) 工具 + 授权码流
 *
 * 职责：
 *   - 纯函数：sha256 / base64url / randomVerifier / deriveChallenge（可在 node 下断言）
 *   - PkceFlow 类：Authorization Code + PKCE(S256) 全流程
 *       · createChallenge() 生成 code_verifier / code_challenge
 *       · begin()         跳转 AS /authorize（离开当前页）
 *       · complete()      回跳后校验 state + POST /token 换令牌
 *       · refreshToken()  refresh_token 续期（P1 预留）
 *
 * 100% 自研 MIT；仅用浏览器原生 Web Crypto(crypto.subtle) + fetch + URL。
 * 无任何第三方依赖 / 无构建工具。
 */

/* ===================== 常量 ===================== */

/** 授权服务器基址 = 心智引擎地址（可经 env 覆盖，前端通过 McpClient 注入） */
const AS_BASE_DEFAULT = "http://localhost:3100";
/** 公共客户端 id（无密钥，PKCE 必备） */
const CLIENT_ID_DEFAULT = "xinyu-web";
/** scope 字符串 */
const SCOPE_DEFAULT = "read write";
/** sessionStorage 键：防 CSRF 的 state */
const STATE_KEY = "xinyu_pkce_state";
/** sessionStorage 键：换 token 用的 code_verifier */
const VERIFIER_KEY = "xinyu_pkce_verifier";

/* ===================== 纯函数（可在 node 下断言） ===================== */

/**
 * SHA-256 摘要。
 * @param {string|ArrayBuffer|Uint8Array} input 输入（字符串自动 UTF-8 编码）
 * @returns {Promise<ArrayBuffer>} 32 字节摘要
 */
export async function sha256(input) {
  const data = (typeof input === "string") ? new TextEncoder().encode(input) : input;
  return crypto.subtle.digest("SHA-256", data);
}

/**
 * ArrayBuffer / Uint8Array → base64url（RFC 7636：无填充、+→-、/→_）。
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string}
 */
export function base64url(buf) {
  const bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 生成随机 code_verifier（RFC 7636：43–128 字符，unreserved 字符集）。
 * @param {number} [len=64]
 * @returns {string}
 */
export function randomVerifier(len = 64) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const n = len || 64;
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < n; i++) out += charset[buf[i] % charset.length];
  return out;
}

/**
 * 由 code_verifier 派生 S256 code_challenge。
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function deriveChallenge(verifier) {
  const digest = await sha256(verifier);
  return base64url(digest);
}

/* ===================== PkceFlow ===================== */

/**
 * Authorization Code + PKCE(S256) 授权流封装。
 *
 * 典型时序：
 *   1) createChallenge() → { verifier, challenge }
 *   2) begin()           → 存 verifier/state 到 sessionStorage，跳转 AS（页面离开）
 *   3) 用户在 AS 授权 → 302 回跳 redirect_uri?code=C&state=S
 *   4) complete(code, state) → 校验 state + 用 verifier 换 access/refresh
 */
export class PkceFlow {
  /**
   * @param {object} [opts]
   * @param {string} [opts.asBase=AS_BASE_DEFAULT] 授权服务器基址
   * @param {string} [opts.clientId=CLIENT_ID_DEFAULT]
   * @param {string} [opts.scope=SCOPE_DEFAULT]
   * @param {string} [opts.redirectUri] 回跳地址，默认 location.origin + "/"
   */
  constructor(opts = {}) {
    this.asBase = opts.asBase || AS_BASE_DEFAULT;
    this.clientId = opts.clientId || CLIENT_ID_DEFAULT;
    this.scope = opts.scope || SCOPE_DEFAULT;
    this.redirectUri =
      opts.redirectUri ||
      (typeof window !== "undefined" && window.location ? window.location.origin + "/" : "");
  }

  /**
   * 生成 code_verifier / code_challenge 对。
   * @returns {Promise<{verifier:string, challenge:string}>}
   */
  async createChallenge() {
    const verifier = randomVerifier(64);
    const challenge = await deriveChallenge(verifier);
    return { verifier, challenge };
  }

  /**
   * 发起授权：存 verifier/state，跳转 AS /authorize（此调用后页面会离开）。
   * @returns {Promise<void>}
   */
  async begin() {
    const { verifier, challenge } = await this.createChallenge();
    const state = randomVerifier(16);
    try {
      sessionStorage.setItem(VERIFIER_KEY, verifier);
      sessionStorage.setItem(STATE_KEY, state);
    } catch (_) { /* 隐私模式可能不可写，回调阶段会失败并降级 */ }

    const u = new URL(this.asBase.replace(/\/+$/, "") + "/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.clientId);
    u.searchParams.set("redirect_uri", this.redirectUri);
    u.searchParams.set("scope", this.scope);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");

    if (typeof window !== "undefined" && window.location) {
      window.location.href = u.toString();
    }
  }

  /**
   * 回跳后完成令牌交换：校验 state（防 CSRF）+ 用 verifier 换令牌。
   * @param {string} code
   * @param {string} state
   * @returns {Promise<{access_token:string, refresh_token:?string, expires_at:number, token_type:string}>}
   */
  async complete(code, state) {
    const savedState = safeSessionGet(STATE_KEY);
    const verifier = safeSessionGet(VERIFIER_KEY);
    if (!savedState || savedState !== state) throw new Error("state_mismatch(CSRF)");
    if (!verifier) throw new Error("missing_verifier");
    safeSessionDel(STATE_KEY);
    safeSessionDel(VERIFIER_KEY);
    return this._exchange(code, verifier);
  }

  /**
   * refresh_token 续期（P1 预留；AS 需支持 refresh_token grant）。
   * @param {string} refreshToken
   * @returns {Promise<{access_token:string, refresh_token:?string, expires_at:number, token_type:string}>}
   */
  async refreshToken(refreshToken) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    const res = await fetch(this.asBase.replace(/\/+$/, "") + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error("token_refresh HTTP " + res.status);
    const data = await res.json();
    return normalizeTokens(data);
  }

  /**
   * 用授权码 + verifier 向 AS /token 交换令牌。
   * @param {string} code
   * @param {string} verifier
   * @returns {Promise<{access_token:string, refresh_token:?string, expires_at:number, token_type:string}>}
   * @private
   */
  async _exchange(code, verifier) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
    });
    const res = await fetch(this.asBase.replace(/\/+$/, "") + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error("token HTTP " + res.status);
    const data = await res.json();
    return normalizeTokens(data);
  }
}

/* ===================== 内部工具 ===================== */

/**
 * 把 AS 返回的令牌规整为统一存储形态。
 * @param {object} data AS /token 响应
 * @returns {{access_token:string, refresh_token:?string, expires_at:number, token_type:string}}
 */
function normalizeTokens(data) {
  const expiresIn = (typeof data.expires_in === "number") ? data.expires_in : 0;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : 0,
    token_type: data.token_type || "Bearer",
  };
}

function safeSessionGet(k) {
  try { return sessionStorage.getItem(k); } catch (_) { return null; }
}
function safeSessionDel(k) {
  try { sessionStorage.removeItem(k); } catch (_) {}
}
