/**
 * mcp-client.js · 心屿前端零依赖 MCP 客户端（门面 + 传输 + 编排）
 *
 * 职责（合并架构设计中的 McpClient + McpAdapter）：
 *   - ensureReady()      自动 PKCE（回跳交换 / 缺失令牌触发跳转，AS 不可达则降级）
 *   - getMindContext()   经 /api/mcp 代理拉取 xinchao_context 信封
 *   - sendInteractionEvent() / fireUserEvent()  发送 xinchao_event（失败静默）
 *   - buildFragment()    把信封摘要为自然语言片段（注入 system prompt）
 *   - doPkceFlow()       封装 PKCE 全流程（跳转 AS → 回跳拿 code → 换 token → 存 token-store）
 *
 * 传输：JSON-RPC tools/call over Streamable HTTP（经 server.js 同源 /api/mcp 代理）。
 * token 置于 arguments.token（不放 Authorization header）。
 * 100% 自研 MIT；仅用浏览器原生 fetch + Web Crypto + localStorage。
 * 无任何第三方依赖 / 无构建工具。
 */

import { PkceFlow } from "./pkce.js";
import { TokenStore } from "./token-store.js";

/* ===================== 常量 ===================== */

/** 授权服务器基址 = 心智引擎地址（与代理目标一致） */
const AS_BASE = "http://localhost:3100";
/** 公共客户端 id */
const CLIENT_ID = "xinyu-web";
/** scope */
const SCOPE = "read write";
/** 回跳地址（回跳到应用自身首页） */
const REDIRECT_URI =
  (typeof window !== "undefined" && window.location) ? window.location.origin + "/" : "";
/** JSON-RPC 调用超时（ms） */
const RPC_TIMEOUT = 8000;

/* ===================== 纯函数（可在 node 下断言） ===================== */

/** CRC32 查表（IEEE 802.3 多项式） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * CRC32（UTF-8 字节级，确定性）。
 * @param {string} str
 * @returns {number} 无符号 32 位整数
 */
export function crc32(str) {
  const bytes = new TextEncoder().encode(str || "");
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ===================== McpClient ===================== */

/**
 * 心智引擎 MCP 客户端（前端门面）。
 */
export class McpClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.proxyUrl="/api/mcp"] 经 server.js 代理的地址（同源，规避 CORS/端口）
   * @param {string} [opts.asBase=AS_BASE] 授权服务器基址
   */
  constructor(opts = {}) {
    this.proxyUrl = opts.proxyUrl || "/api/mcp";
    this.asBase = opts.asBase || AS_BASE;
    this._store = new TokenStore();
    this._pkce = new PkceFlow({
      asBase: this.asBase,
      clientId: CLIENT_ID,
      scope: SCOPE,
      redirectUri: REDIRECT_URI,
    });
    this._id = 0;
  }

  /**
   * 设备级身份（v1：subject = session_id = 设备 id，无登录）。
   * @returns {{subject:string, sessionId:string}}
   */
  identity() {
    const deviceId = this._store.getDeviceId();
    return { subject: deviceId, sessionId: deviceId };
  }

  /**
   * 引导就绪：处理回跳交换 → 已有有效令牌则直接就绪 → 否则尝试自动 PKCE。
   * 失败静默降级（返回 false，绝不抛错阻断 App）。
   * @returns {Promise<boolean>} true=可用，false=降级不可用
   */
  async ensureReady() {
    // ① 回跳场景：URL 含 ?code=&state= → 完成交换
    if (typeof window !== "undefined" && window.location) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      if (code && state) {
        try {
          const tokens = await this._pkce.complete(code, state);
          this._store.setTokens(tokens);
          if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (e) {
          console.warn("[xinyu-mcp] PKCE 回调交换失败（降级）:", e && e.message);
        }
        return true;
      }
    }
    // ② 已有有效令牌
    if (this._store.getAccessToken() && !this._store.isExpired()) return true;
    // ③ 缺失令牌：AS 可达才跳转（不可达则降级，不阻断 App）
    if (await this._asReachable()) {
      this._pkce.begin(); // 跳转 AS，页面将离开；回来后走 ①
      return false;        // 实际不会到达
    }
    console.warn("[xinyu-mcp] 授权服务器不可达，心智引擎降级不可用。");
    return false;
  }

  /**
   * 封装 PKCE 全流程（mcp-client 对外暴露的便捷方法）。
   * 若 URL 带回调参数 → 完成交换并存储；否则跳转 AS 发起授权。
   * @returns {Promise<object|null>} 令牌对象（回跳场景）或 null（已跳转离开）
   */
  async doPkceFlow() {
    if (typeof window !== "undefined" && window.location) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      if (code && state) {
        const tokens = await this._pkce.complete(code, state);
        this._store.setTokens(tokens);
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        return tokens;
      }
    }
    this._pkce.begin(); // 跳转 AS
    return null;
  }

  /**
   * 拉取当前心智上下文信封（xinchao_context）。
   * @returns {Promise<object|null>} 信封对象；无令牌/失败 → null（静默降级）
   */
  async getMindContext() {
    const tok = this._store.getAccessToken();
    if (!tok) return null;
    const { subject, sessionId } = this.identity();
    try {
      return await this._call("xinchao_context", {
        token: tok, subject, session_id: sessionId,
      });
    } catch (e) {
      console.warn("[xinyu-mcp] 拉取心智上下文失败（降级）:", e && e.message);
      return null;
    }
  }

  /**
   * 发送交互事件（xinchao_event）。
   * @param {{content:string, intensity?:number, tags?:string[], event_id?:string}} evt
   * @returns {Promise<void>} 失败静默（仅 console.warn）
   */
  async sendInteractionEvent(evt) {
    const tok = this._store.getAccessToken();
    if (!tok) return;
    const { subject, sessionId } = this.identity();
    const content = evt && evt.content != null ? String(evt.content) : "";
    const intensity = (evt && typeof evt.intensity === "number") ? evt.intensity : 0.5;
    const tags = (evt && Array.isArray(evt.tags)) ? evt.tags : [];
    const eventId = evt && evt.event_id
      ? evt.event_id
      : this._stableEventId(content, sessionId);
    try {
      await this._call("xinchao_event", {
        token: tok,
        type: "user_interaction",
        payload: { content, intensity, tags },
        subject, session_id: sessionId, event_id: eventId,
      });
    } catch (e) {
      console.warn("[xinyu-mcp] 交互事件发送失败（静默）:", e && e.message);
    }
  }

  /**
   * 供 app.js 调用的便捷门面（不 await，异步 fire）。
   * @param {string} text
   * @param {{intensity?:number, tags?:string[]}} [opts]
   * @returns {Promise<void>}
   */
  fireUserEvent(text, opts = {}) {
    return this.sendInteractionEvent({
      content: text,
      intensity: opts.intensity != null ? opts.intensity : 0.5,
      tags: opts.tags || [],
    });
  }

  /**
   * 把心智信封摘要为自然语言片段（追加进 system prompt）。
   * @param {object} envelope
   * @returns {string}
   */
  buildFragment(envelope) {
    return this.summarize(envelope);
  }

  /**
   * 摘要式提取：最强 2–3 维 + narrative（字段缺失安全跳过）。
   * 不塞全量 12 维原始结构，仅给大模型一段可读的心智状态。
   * @param {object} envelope
   * @returns {string}
   */
  summarize(envelope) {
    if (!envelope || typeof envelope !== "object") return "";
    const parts = [];
    const dims = envelope.dimensions || envelope.dims || null;
    if (Array.isArray(dims) && dims.length) {
      const top = dims
        .slice()
        .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))
        .slice(0, 3);
      for (const d of top) {
        const name = d && (d.name || d.key) ? (d.name || d.key) : "?";
        const v = (d && typeof d.value === "number") ? d.value.toFixed(2) : String(d && d.value);
        parts.push(`${name}: ${v}`);
      }
    }
    if (typeof envelope.narrative === "string" && envelope.narrative.trim()) {
      parts.push(envelope.narrative.trim());
    }
    return parts.join("\n");
  }

  /**
   * 稳定 event_id：xinyu-${sessionId}-${time36}-${crc32(content)36}
   * 同一发送幂等、不重发即不重复；存于发送闭包内，不跨发送复用。
   * @param {string} content
   * @param {string} sessionId
   * @returns {string}
   * @private
   */
  _stableEventId(content, sessionId) {
    const s = String(content || "");
    return `xinyu-${sessionId}-${Date.now().toString(36)}-${crc32(s).toString(36)}`;
  }

  /** @returns {number} 自增 JSON-RPC id @private */
  _nextId() { return ++this._id; }

  /**
   * JSON-RPC tools/call 传输（经 /api/mcp 代理）。
   * 兼容 application/json 与 text/event-stream(SSE) 两种响应形态。
   * @param {string} tool 工具名（xinchao_context / xinchao_event）
   * @param {object} args 参数（含 token）
   * @returns {Promise<object>} 结构化结果（text 为 JSON 则解析，否则返回原始 result）
   * @private
   */
  async _call(tool, args) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: this._nextId(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT);
    try {
      const res = await fetch(this.proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 官方 MCP SDK StreamableHTTP 要求：POST 必须声明可接收 json 与 SSE
          "Accept": "application/json, text/event-stream",
        },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("MCP HTTP " + res.status);
      const ct = res.headers.get("content-type") || "";
      let data;
      if (ct.includes("text/event-stream")) {
        const text = await res.text();
        const lines = text.split("\n").filter((l) => l.startsWith("data:"));
        const last = lines[lines.length - 1];
        data = last ? JSON.parse(last.slice(5).trim()) : null;
      } else {
        data = await res.json();
      }
      if (!data) throw new Error("MCP empty response");
      if (data.error) throw new Error("MCP error: " + JSON.stringify(data.error));
      const result = data.result || {};
      // tools/call 返回 { content:[{type:"text", text:"..."}] }
      if (Array.isArray(result.content)) {
        const txt = result.content.map((c) => (c && c.text) || "").join("");
        try { return JSON.parse(txt); } catch (_) { return result; }
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 探测授权服务器是否可达（no-cors，仅判断能否建立连接，不依赖 CORS 头）。
   * @returns {Promise<boolean>}
   * @private
   */
  async _asReachable() {
    try {
      await fetch(this.asBase.replace(/\/+$/, "") + "/mcp", {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
      });
      return true;
    } catch (_) {
      return false;
    }
  }
}
