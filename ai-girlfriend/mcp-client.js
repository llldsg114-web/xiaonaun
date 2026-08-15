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
 * 鉴权走标准 Authorization: Bearer <jwt> 头（由 _call 注入；token 不再进入 arguments）。
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

/**
 * 12 维键 → 小暖内心独白中文标签（固定映射，绝不自创）。
 * 引擎信封字段：ContextEnvelope.state_vector: Record<DimensionKey, number>（12 个键）。
 */
const DIMENSION_LABELS = {
  possess: "想她占有",
  monitor: "惦记她",
  crave: "馋她黏着",
  share: "想和她分享",
  libido: "性欲",
  curiosity: "好奇",
  boredom: "无聊",
  social: "社交欲",
  duty: "责任感",
  reflection: "自省",
  grieve: "委屈/失落",
  anger: "生气",
};

/** 12 维固定顺序键（归一化遍历用；与 src/types/index.ts DimensionKey 严格一一对应）。 */
const DIMENSION_KEYS = [
  "possess", "monitor", "crave", "share", "libido", "curiosity",
  "boredom", "social", "duty", "reflection", "grieve", "anger",
];

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

/**
 * 把任意数值夹到 [0,1]（v2 ③ MindProfile 各派生信号都走它）。
 * 非有限数 → 0；<0 → 0；>1 → 1；其余原样。
 * @param {number} x
 * @returns {number}
 */
export function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
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
   * 身份（v2 ① 真实 SSO 身份接线，设计 §3.1 + §9.1）。
   * subject 优先级：① 已缓存真实 sub（getSubjectReal，命中直接返回不联网）
   *   → ② 缺失则拉取 /userinfo（带并发锁，失败降级）→ ③ 稳定设备 id（匿名/未登录）。
   * sessionId = 'conv-' + deviceId（设计 §9.1：单设备单主对话 → conv-<deviceId>；
   *   预留多对话各自独立 id，未来多会话可用 conv-<deviceId>-<convId>）。
   * @returns {Promise<{subject:string, sessionId:string}>}
   */
  async identity() {
    const deviceId = this._store.getDeviceId();
    const sessionId = "conv-" + deviceId;
    // ① 已缓存真实 sub → 直接返回，不联网
    const cached = this._store.getSubjectReal();
    if (cached) return { subject: cached, sessionId };
    // ② 缺失 → 拉取 /userinfo（失败降级，绝不抛）
    const sub = await this.fetchUserInfo();
    if (sub) return { subject: sub, sessionId };
    // ③ 降级：设备 id（匿名/未登录场景）
    return { subject: deviceId, sessionId };
  }

  /**
   * 拉取真实用户身份（SSO 登录后的 sub）。
   * 若 access_token 有效，向 `${asBase}/userinfo` 发 GET（带 Authorization: Bearer），
   * 解析 { sub }；成功则写入 store.setSubjectReal(sub) 并返回 sub；
   * 网络/401/解析失败 → 返回 null（降级，不抛，绝不阻断调用方）。
   * 并发安全：内部用 _userInfoPending 复用同一 in-flight promise，避免并发重复请求 /userinfo。
   * @returns {Promise<string|null>}
   * @private
   */
  async fetchUserInfo() {
    const at = this._store.getAccessToken();
    if (!at) return null;                 // 无令牌 → 无身份可拉，降级
    // 复用 in-flight 请求，避免并发重复拉取 /userinfo
    if (this._userInfoPending) return this._userInfoPending;
    const run = (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT);
        let res;
        try {
          res = await fetch(this.asBase.replace(/\/+$/, "") + "/userinfo", {
            method: "GET",
            headers: { "Authorization": "Bearer " + at },
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) return null;          // 401/其它 → 降级（不抛）
        const data = await res.json();
        const sub = data && data.sub;
        if (!sub) return null;
        this._store.setSubjectReal(sub);   // 缓存真实 sub，下次 identity() 命中直接返回
        return sub;
      } catch (_) {
        return null;                        // 网络异常 → 降级，不抛
      }
    })();
    this._userInfoPending = run;
    try {
      return await run;
    } finally {
      this._userInfoPending = null;
    }
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
          // 预热真实身份缓存（不阻塞就绪判定）
          void this.fetchUserInfo().catch(() => {});
        } catch (e) {
          console.warn("[xinyu-mcp] PKCE 回调交换失败（降级）:", e && e.message);
        }
        return true;
      }
    }
    // ② 已有有效令牌
    if (this._store.getAccessToken() && !this._store.isExpired()) {
      // 预热真实身份缓存（不阻塞就绪判定）
      void this.fetchUserInfo().catch(() => {});
      return true;
    }
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
    try { await this.ensureValidToken(); } catch (_) {}
    const tok = this._store.getAccessToken();
    if (!tok) return null;
    const { subject, sessionId } = await this.identity();
    try {
      // token 不再塞进 arguments，由 _call 经 Authorization: Bearer 头传递
      return await this._call("xinchao_context", {
        subject, session_id: sessionId,
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
    try { await this.ensureValidToken(); } catch (_) {}
    const tok = this._store.getAccessToken();
    if (!tok) return;
    const { subject, sessionId } = await this.identity();
    const content = evt && evt.content != null ? String(evt.content) : "";
    const intensity = (evt && typeof evt.intensity === "number") ? evt.intensity : 0.5;
    const tags = (evt && Array.isArray(evt.tags)) ? evt.tags : [];
    const eventId = evt && evt.event_id
      ? evt.event_id
      : this._stableEventId(content, sessionId);
    try {
      // token 不再塞进 arguments，由 _call 经 Authorization: Bearer 头传递
      await this._call("xinchao_event", {
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
   * 调用前确保 access_token 有效（临近过期/缺失则用 refresh_token 续期一次）。
   * 失败静默：返回 false（由调用方降级，不抛错阻断对话）。
   * @returns {Promise<boolean>} true=已有有效令牌（或续期成功），false=无令牌且无法续期
   */
  async ensureValidToken() {
    const store = this._store;
    const hasRefresh = !!store.getRefreshToken();
    // 已有 access 且未临近过期（token-store 自带 30s 余量）→ 直接可用
    if (store.getAccessToken() && !store.isExpired()) return true;
    // 无 refresh_token → 无法续期
    if (!hasRefresh) return false;
    // 调 AS /token 续期
    try {
      await this._refreshToken();
      return !!store.getAccessToken();
    } catch (e) {
      console.warn("[xinyu-mcp] refresh_token 续期失败（降级）:", e && e.message);
      return false;
    }
  }

  /**
   * 用 refresh_token 向 AS /token 换取新 access（含新 refresh）。
   * @returns {Promise<void>} 失败抛错（由 ensureValidToken / _call 401 分支捕获后静默）
   * @private
   */
  async _refreshToken() {
    const store = this._store;
    const rt = store.getRefreshToken();
    if (!rt) throw new Error("无 refresh_token");
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", CLIENT_ID);
    body.set("refresh_token", rt);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT);
    let res;
    try {
      res = await fetch(this.asBase.replace(/\/+$/, "") + "/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error("refresh HTTP " + res.status);
    const data = await res.json();
    const at = data && data.access_token;
    if (!at) throw new Error("refresh 响应缺少 access_token");
    const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600;
    store.refresh({
      access_token: at,
      refresh_token: data.refresh_token || rt,
      expires_in: expiresIn,
      token_type: data.token_type || "Bearer",
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
   * 把 12 维心智信封归一化为紧凑 MindProfile（v2 ③ 本地引擎消费）。
   * 纯函数式：只读 envelope.state_vector，不做任何网络/IO；信封无效时返回 null。
   * 缺失维度按 v2-design §8 默认 BASELINE(0.20) 补齐，保证 12 维齐全。
   * 形状严格对齐 src/types/index.ts 的 MindProfile（前后端共享真相源）。
   * @param {object} envelope 含 state_vector 的信封（同 buildFragment 输入）
   * @returns {object|null} MindProfile（v2-design §8 形状）
   */
  normalizeProfile(envelope) {
    if (!envelope || typeof envelope !== "object") return null;
    const vec = this._resolveVector(envelope);
    if (!vec) return null;   // 无可用 12 维容器（既无 state_vector 也无 dimensions/dims 回退）→ 信封无效
    // 缺失维度补齐到 BASELINE(0.20)；越界值夹到 [0,1]
    const raw = {};
    for (const k of DIMENSION_KEYS) {
      const v = vec[k];
      raw[k] = (typeof v === "number" && Number.isFinite(v)) ? clamp01(v) : 0.20;
    }
    const vals = DIMENSION_KEYS.map((k) => ({ key: k, value: raw[k], label: DIMENSION_LABELS[k] || k }));
    const sorted = vals.slice().sort((a, b) => b.value - a.value);
    // 最强 3 维（降序）
    const top = sorted.slice(0, 3).map((d) => ({ key: d.key, value: d.value, label: d.label }));
    const dominant = sorted.length ? sorted[0].key : null;
    const dominantValue = sorted.length ? sorted[0].value : 0;
    // 派生信号（§8）
    const possessive = clamp01((raw.possess + raw.monitor + raw.crave) / 3);
    const libido = raw.libido;
    const curiosity = raw.curiosity;
    const social = raw.social;
    const duty = raw.duty;
    const reflection = raw.reflection;
    const negative = clamp01((raw.anger + raw.grieve) / 2);   // 负向强度代理
    const boredom = raw.boredom;
    const arousal = clamp01((raw.libido + raw.crave + raw.social) / 3); // 唤醒度代理
    const maxV = sorted.length ? sorted[0].value : 0;
    const minV = sorted.length ? sorted[sorted.length - 1].value : 0;
    const coherence = clamp01(1 - (maxV - minV));             // 集中度（越高越聚焦单一心绪）
    return {
      top, dominant, dominantValue,
      possessive, libido, curiosity, social, duty, reflection,
      negative, boredom, arousal, coherence,
      state_vector: envelope.state_vector || undefined,
    };
  }

  /**
   * 摘要式提取：从信封 state_vector（Record<DimensionKey, number>，12 维）取最强 2–3 维，
   * 结合 narrative 生成自然语言片段（字段缺失安全跳过；空 state_vector 仅返回 narrative，不报错）。
   * 保留对旧字段 dimensions / dims（数组形态）的兼容回退。
   * 注：外层注入锚点（app.js callCloud / est）已自带「【当前心智状态】」前缀，本方法只产出片段正文。
   * @param {object} envelope
   * @returns {string}
   */
  summarize(envelope) {
    if (!envelope || typeof envelope !== "object") return "";
    const vector = this._resolveVector(envelope);
    const top = this._topDimensions(vector, 3);
    const narrative = (typeof envelope.narrative === "string" && envelope.narrative.trim())
      ? envelope.narrative.trim()
      : "";
    // 空 state_vector（且无 narrative）→ 返回空串，不报错
    if (!top.length && !narrative) return "";
    // 仅 narrative（无维度）→ 直接返回 narrative
    if (!top.length) return narrative;
    const dimsText = top.map((d) => `${d.label}(${d.value.toFixed(2)})`).join("、");
    // narrative + 维度 → 「<narrative>。她此刻最强烈的心绪是：<d1>、<d2>…。」（避免与自带句号的 narrative 重复标点）
    if (narrative) {
      const sep = narrative.endsWith("。") ? "她此刻最强烈的心绪是：" : "。她此刻最强烈的心绪是：";
      return `${narrative}${sep}${dimsText}。`;
    }
    // 仅维度（无 narrative）
    return `她此刻最强烈的心绪是：${dimsText}。`;
  }

  /**
   * 解析信封中的维度容器：优先 state_vector（12 维 Record），回退 dimensions / dims（数组）。
   * @param {object} envelope
   * @returns {object|null} Record<key, number> 或 null
   * @private
   */
  _resolveVector(envelope) {
    if (envelope && typeof envelope.state_vector === "object" && envelope.state_vector) {
      return envelope.state_vector;
    }
    if (Array.isArray(envelope.dimensions) && envelope.dimensions.length) {
      const rec = {};
      for (const d of envelope.dimensions) {
        const k = d && (d.key || d.name);
        const v = d && Number(d.value);
        if (k != null && Number.isFinite(v)) rec[String(k)] = v;
      }
      return rec;
    }
    if (Array.isArray(envelope.dims) && envelope.dims.length) {
      const rec = {};
      for (const d of envelope.dims) {
        const k = d && (d.key || d.name);
        const v = d && Number(d.value);
        if (k != null && Number.isFinite(v)) rec[String(k)] = v;
      }
      return rec;
    }
    return null;
  }

  /**
   * 从维度容器取最强（数值最大）的 k 维，附中文标签映射。
   * @param {object|null} vector Record<key, number>
   * @param {number} k 最多取几维
   * @returns {Array<{key:string, label:string, value:number}>}
   * @private
   */
  _topDimensions(vector, k) {
    if (!vector || typeof vector !== "object") return [];
    const arr = [];
    for (const key of Object.keys(vector)) {
      const v = Number(vector[key]);
      if (!Number.isFinite(v)) continue;
      arr.push({ key, label: DIMENSION_LABELS[key] || key, value: v });
    }
    arr.sort((a, b) => b.value - a.value);
    return arr.slice(0, Math.max(1, k | 0));
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
   * 鉴权：Bearer 令牌经标准 Authorization 头传递（不进 arguments）。
   * @param {string} tool 工具名（xinchao_context / xinchao_event）
   * @param {object} args 参数（不含 token；token 由 _bearer 经 Authorization 头传递）
   * @param {boolean} [_retry=false] 内部重试标志（防止 401 无限重试）
   * @param {string} [_bearer] 显式 Bearer 令牌；缺省读取 this._store.getAccessToken()
   * @returns {Promise<object>} 结构化结果（text 为 JSON 则解析，否则返回原始 result）
   * @private
   */
  async _call(tool, args, _retry = false, _bearer = this._store.getAccessToken()) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: this._nextId(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    });
    // 组装请求头：Authorization 走标准 Bearer 头；仅有令牌时才携带（无令牌则不发该头）
    const headers = {
      "Content-Type": "application/json",
      // 官方 MCP SDK StreamableHTTP 要求：POST 必须声明可接收 json 与 SSE
      "Accept": "application/json, text/event-stream",
    };
    if (_bearer) headers["Authorization"] = "Bearer " + _bearer;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT);
    try {
      const res = await fetch(this.proxyUrl, {
        method: "POST",
        headers,
        body,
        signal: ctrl.signal,
      });
      // 401：Bearer 失效 → 清 access、用 refresh 换新，再以新 Bearer 头重试一次；仍失败则向上抛（调用方静默）
      if (res.status === 401 && !_retry) {
        try {
          this._store.clearAccessToken();
          await this._refreshToken();
        } catch (e) {
          throw new Error("MCP HTTP 401（token 失效且续期失败）");
        }
        // 重试携带刷新后的 Bearer（从 store 读取最新 access_token），arguments 不含 token
        return this._call(tool, args, true, this._store.getAccessToken());
      }
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
