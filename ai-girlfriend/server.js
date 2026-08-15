/**
 * 小暖 · 服务网关（零依赖，Node 原生 http）
 *
 * 职责：
 *   1) 托管小暖 PWA 静态文件（同端口，免跨域）
 *   2) /api/sync/*    端到端加密的存档同步
 *   3) /api/notify/*  多通道推送配置与排期（小暖主动找你）
 *   4) /v1/*          OpenAI 兼容接口（给 OpenClaw 接微信用）
 *
 * 隐私原则（按接口区分，别搞混）：
 *   sync   —— 只存客户端加密好的密文，服务端没有口令，解不开也不想解
 *   notify —— 存推送凭证 + 未来几条明文短文案（要发进微信，本来就藏不住）
 *   /v1    —— 微信这条线的对话，服务端能看到明文；介意的话把这份代码
 *             跑在你自己机器上，一模一样能用
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const notify = require("./notify");
const schedule = require("./schedule");
const openclaw = require("./openclaw");
const wecomCrypto = require("./wecom_crypto");

const ROOT = __dirname;
const DATA_DIR = process.env.XN_DATA || path.join(ROOT, ".data");
const PORT = parseInt(process.env.PORT || "3000", 10);

// 心智引擎 MCP 代理目标（自研引擎，默认 :3100/mcp；可用 MCP_ENGINE_URL / MCP_TARGET 覆盖）
const MCP_TARGET = process.env.MCP_ENGINE_URL || process.env.MCP_TARGET || "http://localhost:3100/mcp";

const MAX_BLOB = 6 * 1024 * 1024;  // 单份存档密文上限 6MB
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/* ---------------- 工具 ---------------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

// 不对外暴露的文件/目录（服务端源码不能被当静态资源下走）
// 注意 engine.js 不在名单里 —— 前端要用它，必须能下载
const DENY = new Set([
  "server.js", "notify.js", "schedule.js", "openclaw.js", "wecom_crypto.js",
  "package.json", "package-lock.json", "node_modules",
]);

const tokenPath = (token) => {
  const h = crypto.createHash("sha256").update("xn|" + token).digest("hex");
  return path.join(DATA_DIR, h + ".json");
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, Object.assign({
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
  }, headers));
  res.end(buf);
}
const sendJSON = (res, code, obj) =>
  send(res, code, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });

function readBody(req, limit = MAX_BLOB + 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("PAYLOAD_TOO_LARGE")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 从 Authorization: Bearer xxx 里取接入密钥 */
function apiKeyOf(req) {
  const h = String(req.headers["authorization"] || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return String(req.headers["x-api-key"] || "").trim();
}

/* ---------------- 简易限流（每 IP 每分钟） ---------------- */
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function rateLimited(ip) {
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > 240;
}

/* ---------------- 同步接口 ---------------- */

async function loadRecord(token) {
  try {
    return JSON.parse(await fsp.readFile(tokenPath(token), "utf8"));
  } catch {
    return null;
  }
}

async function saveRecord(token, rec) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const p = tokenPath(token);
  // 留一份上一版备份，防止误覆盖
  try { await fsp.copyFile(p, p + ".bak"); } catch {}
  const tmp = p + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(rec));
  await fsp.rename(tmp, p);
}

async function handleApi(req, res, url) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress || "?";
  if (rateLimited(ip)) return sendJSON(res, 429, { ok: false, error: "RATE_LIMITED" });

  const p = url.pathname;

  if (p === "/api/health") {
    return sendJSON(res, 200, {
      ok: true, service: "xiaonuan", v: 10, time: Date.now(),
      features: ["sync", "notify", "openclaw"],
    });
  }

  /* ---- 可用的推送通道清单（前端渲染表单用） ---- */
  if (p === "/api/notify/channels" && req.method === "GET") {
    return sendJSON(res, 200, {
      ok: true,
      channels: Object.entries(notify.CHANNELS).map(([k, v]) => ({
        key: k, name: v.name, fields: v.fields,
      })),
    });
  }

  /* ---- 推送：保存配置 ---- */
  if (p === "/api/notify/config" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req, 64 * 1024)); }
    catch { return sendJSON(res, 400, { ok: false, error: "BAD_JSON" }); }

    const token = String((body && body.token) || "");
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });

    try {
      await schedule.setConfig(token, {
        channel: body.channel,
        cfg: body.cfg,
        enabled: body.enabled,
        twoWay: body.twoWay,
        quietFrom: body.quietFrom,
        quietTo: body.quietTo,
        tz: body.tz,
      });
    } catch (e) {
      if (e && e.message === "BAD_CHANNEL") return sendJSON(res, 400, { ok: false, error: "BAD_CHANNEL" });
      throw e;
    }
    return sendJSON(res, 200, await schedule.stat(token));
  }

  /* ---- 推送：提交未来几天的排期 ---- */
  if (p === "/api/notify/schedule" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req, 256 * 1024)); }
    catch { return sendJSON(res, 400, { ok: false, error: "BAD_JSON" }); }

    const token = String((body && body.token) || "");
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });

    await schedule.setSchedule(token, body.items, body.tz);
    return sendJSON(res, 200, await schedule.stat(token));
  }

  /* ---- 推送：立刻测试一条 ---- */
  if (p === "/api/notify/test" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req, 16 * 1024)); }
    catch { return sendJSON(res, 400, { ok: false, error: "BAD_JSON" }); }

    const token = String((body && body.token) || "");
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });

    const r = await schedule.sendNow(token, {
      title: "小暖",
      content: String((body && body.text) || "在的呀，我一直都在～这是一条测试消息 🌸"),
    });
    return sendJSON(res, r.ok ? 200 : 400, { ok: r.ok, msg: r.msg });
  }

  /* ---- 推送：状态 ---- */
  if (p === "/api/notify/stat" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    return sendJSON(res, 200, await schedule.stat(token));
  }

  /* ---- 推送：整个删掉 ---- */
  if (p === "/api/notify" && req.method === "DELETE") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    return sendJSON(res, 200, await schedule.remove(token));
  }

  /* ---- 企业微信双向：收消息回调（URL 验证 + 收消息 + 被动回话） ---- */
  if (p === "/api/notify/wecom/callback") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return send(res, 403, "forbidden");

    const conf = await schedule.getConfig(token);
    if (!conf || conf.channel !== "wecom_app" || !conf.twoWay) {
      return send(res, 200, "success");   // 没开双向就当没这回事，避免企业微信报错
    }
    const cfg = conf.cfg || {};
    if (!cfg.corpid || !cfg.secret || !cfg.agentid || !cfg.token || !cfg.aeskey) {
      return send(res, 200, "success");
    }

    let crypt;
    try { crypt = new wecomCrypto.WXBizMsgCrypt(cfg.token, cfg.aeskey, cfg.corpid); }
    catch { return send(res, 500, "bad crypto config"); }

    const msgSig = url.searchParams.get("msg_signature") || "";
    const timestamp = url.searchParams.get("timestamp") || String(Math.floor(Date.now() / 1000));
    const nonce = url.searchParams.get("nonce") || "0";

    // GET：URL 验证握手（企业微信后台保存回调 URL 时触发）
    if (req.method === "GET") {
      const echostr = url.searchParams.get("echostr") || "";
      try {
        return send(res, 200, crypt.verifyURL(msgSig, timestamp, nonce, echostr),
          { "Content-Type": "text/plain; charset=utf-8" });
      } catch (e) { return send(res, 403, "verify failed: " + e.message); }
    }

    // POST：收到用户在微信里发的话 → 解密 → 小暖回话 → 加密被动回复
    let xml;
    try { xml = await readBody(req, 64 * 1024); }
    catch { return send(res, 400, "bad body"); }

    try {
      const inner = crypt.decryptMsg(msgSig, timestamp, nonce, xml);
      const fromUser = (inner.match(/<FromUserName>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/FromUserName>/) || [])[1] || "";
      const content = (inner.match(/<Content>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Content>/) || [])[1] || "";
      if (!content.trim()) return send(res, 200, "success");   // 图片/语音等不处理

      const st = await openclaw.getBrainState(token);
      const out = openclaw.think(content.slice(0, 1000), st);
      openclaw.markDirty(token);
      const reply = (out && out.text ? out.text : "……").slice(0, 1900);

      const replyXml =
        "<xml>" +
        `<ToUserName><![CDATA[${fromUser}]]></ToUserName>` +
        `<FromUserName><![CDATA[${cfg.corpid}]]></FromUserName>` +
        `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>` +
        `<MsgType><![CDATA[text]]></MsgType>` +
        `<Content><![CDATA[${reply}]]></Content>` +
        `<MsgId>${Date.now()}</MsgId>` +
        `<AgentID>${cfg.agentid}</AgentID>` +
        "</xml>";

      const body = crypt.encryptReply(replyXml, timestamp, nonce);
      return send(res, 200, body, { "Content-Type": "text/xml; charset=utf-8" });
    } catch (e) {
      console.error("[xiaonuan/wecom] 处理回调出错", e && e.message);
      return send(res, 200, "success");   // 出错也回 success，别让企业微信重试轰炸
    }
  }

  /* ---- 企业微信双向：上传脑快照（让小暖在微信里也是"她"） ---- */
  if (p === "/api/notify/wecom/state" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req, 256 * 1024)); }
    catch { return sendJSON(res, 400, { ok: false, error: "BAD_JSON" }); }
    const token = String((body && body.token) || "");
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    openclaw.seedBrain(token, body.brain || {});
    return sendJSON(res, 200, { ok: true, seeded: true });
  }

  /* ---- 拉取 ---- */
  if (p === "/api/sync/pull" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
    const rec = await loadRecord(token);
    if (!rec) return sendJSON(res, 200, { ok: true, empty: true, rev: 0 });
    if (rec.rev <= since) return sendJSON(res, 200, { ok: true, unchanged: true, rev: rec.rev });
    return sendJSON(res, 200, {
      ok: true, rev: rec.rev, blob: rec.blob,
      updatedAt: rec.updatedAt, device: rec.device || "",
    });
  }

  /* ---- 推送 ---- */
  if (p === "/api/sync/push" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (e) {
      const tooBig = e && e.message === "PAYLOAD_TOO_LARGE";
      return sendJSON(res, tooBig ? 413 : 400, { ok: false, error: tooBig ? "TOO_LARGE" : "BAD_JSON" });
    }
    const { token, rev, blob, device, force } = body || {};
    if (!TOKEN_RE.test(token || "")) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    if (typeof blob !== "string" || !blob) return sendJSON(res, 400, { ok: false, error: "BAD_BLOB" });
    if (blob.length > MAX_BLOB) return sendJSON(res, 413, { ok: false, error: "TOO_LARGE" });

    const cur = await loadRecord(token);
    const curRev = cur ? cur.rev : 0;
    const want = parseInt(rev, 10) || 0;

    // 版本冲突：别的设备先传了新版本
    if (!force && want !== curRev + 1) {
      return sendJSON(res, 409, {
        ok: false, error: "CONFLICT", rev: curRev,
        updatedAt: cur ? cur.updatedAt : 0, device: cur ? cur.device || "" : "",
      });
    }

    const nextRev = force ? curRev + 1 : want;
    await saveRecord(token, {
      rev: nextRev, blob, updatedAt: Date.now(),
      device: String(device || "").slice(0, 40), size: blob.length,
    });
    return sendJSON(res, 200, { ok: true, rev: nextRev });
  }

  /* ---- 查询状态（不取密文） ---- */
  if (p === "/api/sync/stat" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    const rec = await loadRecord(token);
    return sendJSON(res, 200, rec
      ? { ok: true, rev: rec.rev, updatedAt: rec.updatedAt, size: rec.size || 0, device: rec.device || "" }
      : { ok: true, empty: true, rev: 0 });
  }

  /* ---- 删除云端存档 ---- */
  if (p === "/api/sync" && req.method === "DELETE") {
    const token = url.searchParams.get("token") || "";
    if (!TOKEN_RE.test(token)) return sendJSON(res, 400, { ok: false, error: "BAD_TOKEN" });
    try { await fsp.unlink(tokenPath(token)); } catch {}
    try { await fsp.unlink(tokenPath(token) + ".bak"); } catch {}
    return sendJSON(res, 200, { ok: true, deleted: true });
  }

  return sendJSON(res, 404, { ok: false, error: "NOT_FOUND" });
}

/* ---------------- 静态托管 ---------------- */

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";

  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return send(res, 403, "Forbidden");

  const first = path.relative(ROOT, abs).split(path.sep)[0];
  if (!first || first.startsWith(".") || DENY.has(first)) return send(res, 404, "Not Found");

  let stat;
  try { stat = await fsp.stat(abs); } catch { return send(res, 404, "Not Found"); }
  if (stat.isDirectory()) return send(res, 404, "Not Found");

  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  const data = await fsp.readFile(abs);
  const headers = {
    "Content-Type": type,
    ETag: etag,
    // sw.js 与 index.html 不许强缓存，否则更新推不动
    "Cache-Control": /(^\/sw\.js$|\.html$|^\/$)/.test(rel) ? "no-cache" : "public, max-age=3600",
  };

  const ae = String(req.headers["accept-encoding"] || "");
  if (/gzip/.test(ae) && /^(text|application\/(javascript|json|manifest))/.test(type) && data.length > 1024) {
    const gz = zlib.gzipSync(data);
    headers["Content-Encoding"] = "gzip";
    headers.Vary = "Accept-Encoding";
    return send(res, 200, gz, headers);
  }
  return send(res, 200, data, headers);
}

/* ---------------- 心智引擎 MCP 代理 ---------------- */

/**
 * 零依赖将 /api/mcp 请求转发到心智引擎（默认 :3100/mcp）。
 * 透传 method / body / 必要头；兼容 application/json 与 text/event-stream(SSE)。
 * 复用 server.js 全局 CORS *（OPTIONS 预检已在 createServer 顶部统一处理）。
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {URL} url
 */
function handleMcp(req, res, url) {
  const target = new URL(MCP_TARGET);
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + (target.search || ""),
    method: req.method,
    // JSON-RPC over StreamableHTTP：声明可接收 json 与 SSE（官方 MCP SDK 强制要求）
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
  };
  // 透传少量必要头（不含 host/content-length，由 http 重新生成）；accept 已显式固定，不覆盖
  for (const h of ["authorization", "x-request-id"]) {
    if (req.headers[h]) options.headers[h] = req.headers[h];
  }

  const upstream = http.request(options, (up) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const ct = up.headers["content-type"];
    if (ct) res.setHeader("Content-Type", ct);
    if (up.headers["content-encoding"]) res.setHeader("Content-Encoding", up.headers["content-encoding"]);
    res.statusCode = up.statusCode || 200;
    up.pipe(res); // SSE/JSON 均直接流式透传
  });

  upstream.on("error", (e) => {
    console.warn("[xinyu-mcp] 代理到心智引擎失败:", e && e.message);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      sendJSON(res, 502, { ok: false, error: "MCP_UPSTREAM_UNREACHABLE", message: e && e.message });
    } else {
      res.end();
    }
  });

  // 转发请求体（GET/DELETE 无 body）
  if (req.method === "POST" || req.method === "PUT") {
    readBody(req, 8 * 1024 * 1024)
      .then((b) => { upstream.write(b); upstream.end(); })
      .catch((e) => upstream.destroy(e));
  } else {
    upstream.end();
  }
}

/* ---------------- 服务 ---------------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

    if (req.method === "OPTIONS") {
      return send(res, 204, "", {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Max-Age": "86400",
      });
    }

    // OpenAI 兼容接口（OpenClaw 走这里）
    if (url.pathname.startsWith("/v1/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const handled = await openclaw.handle(req, res, url, { sendJSON, readBody, apiKeyOf });
      if (handled) return;
    }

    if (url.pathname.startsWith("/api/mcp")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return handleMcp(req, res, url);
    }

    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error("[xiaonuan]", e);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, error: "SERVER_ERROR" });
  }
});

schedule.start(DATA_DIR);   // 推送闹钟
openclaw.start(DATA_DIR);   // OpenAI 兼容层（预热引擎）

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[xiaonuan] 小暖服务网关已启动 → http://0.0.0.0:${PORT}`);
  console.log(`[xiaonuan] 数据目录：${DATA_DIR}`);
  console.log(`[xiaonuan]   · 存档同步  /api/sync/*     （只存密文）`);
  console.log(`[xiaonuan]   · 主动推送  /api/notify/*   （多通道）`);
  console.log(`[xiaonuan]   · OpenClaw  /v1/chat/completions`);
});

// 收到停止信号先把内存里的状态落盘，别丢了刚聊的几句
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n[xiaonuan] 收到 ${sig}，正在保存…`);
    schedule.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
