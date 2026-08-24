/* ============================================================
 * 小暖 · AI 女友 —— 应用主逻辑
 * ============================================================ */
(() => {
"use strict";

/* ================= 候选 C（隐私/端侧增强）共存叠加层 =================
 * 最早安装零上报探针（须早于 voice.js / longterm-memory.js 的任意运行时外发）。
 * 本批次仅叠加：初始化 ConsentStore，供后续隐私面板使用；不改动 B 已合入逻辑。
 * 铁律：不触碰冻结线；不引入第三方库；小暖 不更名。
 */
let __auditProbe = null;     // AuditProbe 单例（零上报探针）
let __consentStore = null;   // ConsentStore 单例（同意态）
let __offlineProbe = null;   // OfflineProbe 单例（离线三态）
let __cacheWarmer = null;    // CacheWarmer 单例（独立 Cache 预热）
/* 候选 C（C2 本地模型热切换）：路由层共存状态 */
let __replyRouter = null;        // ReplyRouter 单例（优先级 cloud→local→heuristic）
let __cloudProvider = null;      // CloudChatProvider（包装 S.cloud fetch）
let __localModelAdapter = null;  // LocalModelAdapter（包装 window.LocalModel）
let __localHeuristic = null;     // LocalHeuristic（原生启发式兜底，零外部依赖）
try {
  if (window.AuditProbe && typeof window.AuditProbe.install === "function") {
    window.AuditProbe.install();                 // 包装 fetch/XHR/WS/beacon/EventSource + 资源标签钩子
    __auditProbe = window.AuditProbe.getInstance();
  }
} catch (e) {}
// 候选 C（C-E4 · C6）：最早注入 CSP Report-Only meta，违规仅在本地 securitypolicyviolation 捕获，绝不连接外部 report-uri
try {
  if (window.CspInjector && typeof window.CspInjector.injectReportOnly === "function") {
    window.CspInjector.injectReportOnly();
  }
} catch (e) {}
try {
  if (window.ConsentStore && typeof window.ConsentStore.getInstance === "function") {
    __consentStore = window.ConsentStore.getInstance();
  }
} catch (e) {}

/* 注册用户显式同意的外发端点（仅当对应功能开启）。
 * 同源（syncBase/pushBase 默认 = location.origin）已被 allowlist 放行；
 * 仅当配置了自定义 endpoint（SC.endpoint）或开启了云端大脑（S.cloud.base）时，
 * 才作为 consented 登记，确保唯一外发通道在审计面板可见且不被误阻断。 */
function registerConsentedEndpoints() {
  try {
    const ap = (window.AuditProbe && window.AuditProbe.getInstance) ? window.AuditProbe.getInstance() : null;
    if (!ap || typeof ap.registerConsented !== "function") return;
    // 云端大脑：仅当开启且有 base
    if (S && S.cloud && S.cloud.enabled && S.cloud.base) {
      ap.registerConsented(S.cloud.base.trim());
    }
    // 云同步 / 主动推送：仅当设置了自定义 endpoint（空 = 同源，allowlist 已放行）
    if (typeof SC !== "undefined" && SC && SC.enabled && SC.endpoint) {
      ap.registerConsented(SC.endpoint.trim());
    }
    if (typeof SC !== "undefined" && SC && SC.endpoint && typeof PC !== "undefined" && PC && PC.enabled) {
      ap.registerConsented(SC.endpoint.trim());
    }
  } catch (e) {}
}

/* ================= 候选 C（C2 本地模型热切换）共存叠加层 =================
 * 在 app.js 内把既有 S.cloud fetch（callCloud）/ 端侧推理（localThink）包装为统一 ReplyProvider，
 * 由 ReplyRouter 持有优先级 [cloud → local → heuristic] 并弹性降级：
 *   8s 超时 / 连续 2 次失败 / 401 立即降级。最终兜底 LocalHeuristic（零外部依赖，小暖 永不静默）。
 * engine.js 全程零改动；云端对话边界仍在 S.cloud fetch（callCloud），由 CloudChatProvider 包装。
 * 铁律：默认不触发任何外部下载（LocalModelAdapter 未 loaded → isAvailable()=false → 跳过 → 落 heuristic）；
 *       仅用户显式同意加载本地权重时，经 AuditProbe.registerConsented(CDN host) + 审计标注「用户自导权重」。 */
function initReplyRouter() {
  try {
    if (!window.ReplyRouter) return; // 路由模块未就绪则共存安全网（herReply 回退原 callCloud）
    __replyRouter = (window.ReplyRouter.getInstance) ? window.ReplyRouter.getInstance() : new window.ReplyRouter();
    // CloudChatProvider：注入既有 callCloud 作 generate 实现（保留 mindCtx / 鉴权头 / 错误处理，8s 超时在其内部生效）
    // 适配器将 ReplyProvider 的 ctx 映射回 callCloud(userText, ltmFragment, { signal }) 签名（向后兼容）。
    __cloudProvider = new window.CloudChatProvider({
      generate: (prompt, ctx) => callCloud(
        prompt,
        (ctx && ctx.ltmFragment) || null,
        (ctx && ctx.signal) ? { signal: ctx.signal } : {}
      ),
    });
    // LocalModelAdapter：注入既有 localThink 作 generate 实现；仅当 window.LocalModel.isLoaded() 才可用
    __localModelAdapter = new window.LocalModelAdapter({ generate: localThink, localModel: (window.LocalModel || null) });
    // LocalHeuristic：原生启发式兜底（local-heuristic.js，零外部依赖）
    __localHeuristic = (window.LocalHeuristic) ? new window.LocalHeuristic() : null;
    // 注册优先级 [cloud → local → heuristic]（heuristic 永远可用，保证 小暖 永不静默）
    __replyRouter.registerProviders([__cloudProvider, __localModelAdapter, __localHeuristic]);
    refreshCloudAvailability();
  } catch (e) {
    __replyRouter = null; // 异常则回退原 callCloud（共存安全网）
  }
}

/* 依据 S.cloud 配置同步 CloudChatProvider 可用性，并登记 consented 端点（仅开启时）。 */
function refreshCloudAvailability() {
  try {
    if (__cloudProvider) __cloudProvider.setAvailable(!!(S && S.cloud && S.cloud.enabled && S.cloud.base && S.cloud.key));
    // LocalModelAdapter 的可用性由 window.LocalModel.isLoaded() 实时决定，无需在此设置
    if (__localModelAdapter && window.LocalModel) __localModelAdapter.setLocalModel(window.LocalModel);
  } catch (e) {}
  try { registerConsentedEndpoints(); } catch (e) {}
}

/* D1 合规：本地权重（transformers 路径 / HuggingFace CDN）仅用户显式同意下加载。
 * 加载前将 CDN host 登记为 consented，并在审计探针标注「用户自导权重」，确保零上报面板可见且不被误阻断。 */
function registerLocalModelConsent() {
  try {
    if (!window.AuditProbe || !window.AuditProbe.getInstance) return;
    var ap = window.AuditProbe.getInstance();
    var CDN = (window.LocalModel && window.LocalModel.DEFAULT_MODEL)
      ? "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0"
      : "https://cdn.jsdelivr.net";
    ap.registerConsented(CDN);                       // 登记 consented 端点（host）
    if (typeof ap.record === "function") {
      ap.record("resource", CDN, "consented");       // 审计日志标注「用户自导权重」
    }
    if (typeof ap.tagConsented === "function") ap.tagConsented(CDN, "用户自导权重");
  } catch (e) {}
}

/* 用户显式同意门控的本地权重加载（默认绝不自动触发，满足「默认零上报 / 不下载外部模型」）。 */
async function loadLocalModelWithConsent() {
  try {
    if (!window.LocalModel || typeof window.LocalModel.load !== "function") return false;
    registerLocalModelConsent();                     // D1：先登记 consented + 审计标注
    await window.LocalModel.load(S.localModel.model || window.LocalModel.DEFAULT_MODEL);
    refreshCloudAvailability();                      // 同步 adapter 可用性
    return true;
  } catch (e) {
    return false;
  }
}
// 候选 C（C-E2→C-E4 接缝）：暴露为全局钩子，供 local-model-ui.js 调用（默认绝不自动触发，满足 D1 合规）。
window.loadLocalModelWithConsent = loadLocalModelWithConsent;

/* ================= 状态与持久化 ================= */
const SAVE_KEY = "xiaonuan_save_v1";

/* 心屿 MCP：模块级心智上下文缓存（per-reply 生命周期）与 MCP 客户端实例（动态 import 引导） */
let mindCtx = null;
let MCP = null;

/* ================= 候选 A · 长期记忆（LTM）集成 =================
 * 把 window.LTM（核心模块）与 window.LTMUI（视图层）接进真实对话流程。
 * 铁律：隐私优先、零上报、可清除；任何 LTM 调用异常必须降级，绝不阻塞主对话回复。
 * 冻结线（engine.js 等）不消费 longTermMemories；唤起经 UI 气泡 + 模型分支注入 buildMemoryFragment。
 */
let __ltmIdentity = null;     // 缓存 { subject, sessionId }，避免每轮重复解析身份
let __ltmRecallItems = null;  // 本轮检索到的长期记忆条目（per-turn 缓冲，供 herReply 注入 est）
let __ltmTurns = [];          // 本会话累计的 turns 缓冲（user/assistant 文本），用于蒸馏

/** 解析当前会话身份 { subject, sessionId }（优先 MCP.identity，回退设备 id）。降级安全。 */
async function ltmIdentity() {
  try {
    if (__ltmIdentity) return __ltmIdentity;
    let subject = null, sessionId = null;
    if (MCP && typeof MCP.identity === "function") {
      try { const r = await MCP.identity(); subject = r && r.subject; sessionId = r && r.sessionId; } catch (e) {}
    }
    if (!subject || !sessionId) {
      // 回退：用 localStorage 里的设备 id 作为 subject/sessionId（与 mcp-client 同源）
      let dev = null;
      try { if (window.localStorage) dev = window.localStorage.getItem("xinyu_device_id"); } catch (e) {}
      if (!dev) dev = "default";
      subject = subject || dev;
      sessionId = sessionId || ("conv-" + dev);
    }
    __ltmIdentity = { subject: String(subject), sessionId: String(sessionId) };
    try { window.__xinyuSubject = __ltmIdentity.subject; } catch (e) {}
    return __ltmIdentity;
  } catch (e) {
    return { subject: "default", sessionId: "conv-default" };
  }
}

/** 用户消息发送前：召回相关长期记忆，渲染唤起气泡与角标（降级安全，绝不阻塞）。 */
async function ltmRetrieve(userText) {
  try {
    if (!window.LTM || typeof window.LTM.retrieveForSession !== "function") return;
    const id = await ltmIdentity();
    const items = await window.LTM.retrieveForSession(id.subject, userText);
    if (items && items.length) {
      __ltmRecallItems = items;
      try { if (window.LTMUI) { window.LTMUI.renderRecallBubble(items); window.LTMUI.renderCornerBadge(items.length); } } catch (e2) {}
    } else {
      __ltmRecallItems = null;
    }
  } catch (e) {
    __ltmRecallItems = null; // 降级：忽略检索异常，绝不阻塞对话
  }
}

/** 轻量缓冲：收集本会话的 user/assistant 文本，供会话结束/切换时蒸馏。 */
function ltmPushTurn(role, text) {
  try {
    if (!text) return;
    __ltmTurns.push({ role: role, text: String(text) });
    if (__ltmTurns.length > 200) __ltmTurns = __ltmTurns.slice(-200); // 轻量上限，避免无限增长
  } catch (e) {}
}

/** 会话/回合结束钩子：把累计 turns 蒸馏进长期记忆并清空缓冲（降级安全）。 */
async function ltmDistill() {
  try {
    if (!window.LTM || typeof window.LTM.distillFromTurns !== "function") return;
    if (!__ltmTurns.length) return;
    const turns = __ltmTurns.slice();
    __ltmTurns = []; // 蒸馏后清空，避免重复落库
    const id = await ltmIdentity();
    await window.LTM.distillFromTurns(turns, id.subject, id.sessionId);
  } catch (e) {
    // 降级：忽略，绝不阻塞
  }
}

/* 主题色预设 —— 切换时同步 CSS 变量，立绘衣服/UI 一起换色 */
const THEMES = {
  sakura: { pink: "#ff7b9c", deep: "#f25c82", me1: "#ff8fab", me2: "#ff6b95", soft: "#ffd6e2" },
  orange: { pink: "#ff9a62", deep: "#f2722c", me1: "#ffb07a", me2: "#ff8a4c", soft: "#ffe0c9" },
  purple: { pink: "#b388ff", deep: "#8a5cf0", me1: "#b79bff", me2: "#9b6bff", soft: "#e3d6ff" },
  mint:   { pink: "#36c6a8", deep: "#1fa98a", me1: "#5fdcbf", me2: "#33c2a2", soft: "#cdeee6" },
  blue:   { pink: "#5aa9ff", deep: "#2d7ef0", me1: "#7cbfff", me2: "#4f9bff", soft: "#d4e8ff" },
};

function applyTheme(key) {
  const t = THEMES[key] || THEMES.sakura;
  const r = document.documentElement.style;
  r.setProperty("--pink", t.pink);
  r.setProperty("--pink-deep", t.deep);
  r.setProperty("--pink-soft", t.soft);
  r.setProperty("--bubble-me", `linear-gradient(135deg, ${t.me1}, ${t.me2})`);
}

/* 换装预设：衣服 + 头发配色（整体协调） */
const OUTFITS = {
  default: { body: "#ff8fab", body2: "#ff7b9c", hair: "#7a5442", back: "#6b4634", name: "日常" },
  school:  { body: "#8fb6ff", body2: "#6f9bff", hair: "#5b4636", back: "#4a3a2c", name: "学院" },
  home:    { body: "#ffd28a", body2: "#ffbf66", hair: "#8a5a44", back: "#6f4a38", name: "居家" },
  kimono:  { body: "#ff9ecb", body2: "#b388ff", hair: "#6b4634", back: "#553a2e", name: "和风" },
  gala:    { body: "#3a3550", body2: "#ff5c8a", hair: "#3a2a2a", back: "#241f30", name: "晚礼" },
};

function applyOutfit(key) {
  const o = OUTFITS[key] || OUTFITS.default;
  const set = (id, c) => { const el = document.getElementById(id); if (el) el.style.fill = c; };
  set("outfit-body", o.body);
  set("outfit-body2", o.body2);
  set("hair-main", o.hair);
  set("hair-back1", o.back);
  set("hair-back2", o.back);
}

/* 服务商预设：选完自动填好 Base/模型，用户只粘 Key */
const PROVIDERS = {
  deepseek: { base: "https://api.deepseek.com", model: "deepseek-chat" },
  openai:   { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  custom:   { base: "", model: "" },
};

/* ================= 语音合成（小暖开口说话） ================= */
let ttsVoices = [];
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  ttsVoices = speechSynthesis.getVoices() || [];
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

/* 音色预设：不同 voiceName 对应不同音高/语速；即使没有可用中文 voice 也能听出区别 */
const VOICE_PROFILES = {
  auto:   { label: "自动", rate: 1.05, pitch: 1.18 },
  sweet:  { label: "甜心", rate: 1.03, pitch: 1.30 },
  sister: { label: "御姐", rate: 0.98, pitch: 0.85 },
  cute:   { label: "软萌", rate: 0.95, pitch: 1.12 },
  boy:    { label: "少年", rate: 1.10, pitch: 0.72 },
};

/* 根据设置挑一个 voice + 音高语速；voiceName 形如 "__v:名字" 表示直接指定真实音色 */
function pickTts() {
  const zh = ttsVoices.find(v => /zh|cmn|Chinese/i.test(v.lang) || /(中文|普通话|国语)/.test(v.name)) || null;
  const name = S.voiceName || "auto";
  if (name.startsWith("__v:")) {
    const key = name.slice(4);
    const v = ttsVoices.find(x => (x.voiceURI || x.name) === key) || zh;
    return { voice: v, rate: 1.05, pitch: 1.18, lang: v ? v.lang : "zh-CN" };
  }
  const p = VOICE_PROFILES[name] || VOICE_PROFILES.auto;
  return { voice: zh, rate: p.rate, pitch: p.pitch, lang: zh ? zh.lang : "zh-CN" };
}

function speak(text) {
  // 去掉 emoji / 控制符，避免部分合成器报错
  const clean = (text || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  // 候选 B：优先经 window.Voice 本地零上报朗读（叠加层，不破坏文字对话）。
  // Voice 作为朗读的唯一管理者；接管后不再回落既有 speechSynthesis 路径，避免重复朗读。
  if (window.Voice && typeof Voice.isSupported === "function" && typeof Voice.isEnabled === "function") {
    if (Voice.isSupported().tts && Voice.isEnabled("tts") && S.tts) {
      try { Voice.speak(clean); } catch (e) {}   // 失败静默降级，绝不阻塞对话
      return;
    }
    // Voice 已加载但 TTS 关闭 / 不支持 → 纯文字降级（不动既有 speechSynthesis）
    return;
  }
  // 兜底：voice.js 未就绪（极端加载顺序问题），沿用既有 speechSynthesis 实现
  if (!S.tts || !("speechSynthesis" in window)) return;
  try {
    const cfg = pickTts();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.voice = cfg.voice || null;
    u.lang = cfg.lang;
    u.rate = cfg.rate; u.pitch = cfg.pitch; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ================= OS 系统通知（跨会话主动推送） ================= */
function notifyOS(title, body) {
  if (!S.notify) return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  try {
    const opt = { body, icon: "/icon-192.png", badge: "/icon-192.png", tag: "xiaonuan", dir: "auto" };
    const fallback = () => { try { new Notification(title, opt); } catch (e) {} };
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration("/").then(reg => {
        if (reg && reg.showNotification) {
          // SW 自身的通知权限独立于页面，失败时回落到页面级 Notification
          return reg.showNotification(title, opt).catch(fallback);
        }
        fallback();
      }).catch(fallback);
    } else {
      fallback();
    }
    return true;
  } catch (e) { return false; }
}

const defaultState = () => ({
  affection: 0,
  nick: "",
  firstMeet: null,
  lastVisit: null,
  dating: null,            // 确定关系：{ since }
  datingAnnis: [],         // 已庆祝过的在一起纪念日天数
  messages: [],           // {from:'me'|'her', text, t}
  moodDate: "",
  moodKey: "happy",
  stats: { msgs: 0 },
  cloud: { enabled: false, base: "", key: "", model: "", provider: "", embedEnabled: false, embedModel: "text-embedding-3-small" },
  memory: {}, // {userName, likes, events, summary}
  dailyNotes: {}, // 跨会话记忆回写「余温」：{ "YYYY-M-D": { text, t } }
  persona: { gender: "female", tone: "playful", theme: "sakura", card: "xiaonuan",
             warmth: 0.55, proactivity: 0.5, whitespace: 0.5 },  // 候选 E·L4：tone 对齐三态 + 真人感可调参数
  wardrobe: { outfit: "default", hair: "brown" },
  tts: false,
  voiceName: "auto",       // 音色：auto/sweet/sister/cute/boy 或 "__v:真实音色名"
  notify: false,           // 跨会话系统通知开关
  localModel: { enabled: false, model: "onnx-community/Qwen2.5-0.5B-Instruct" }, // 端侧模型（离线 AI）
  caredTopics: [],
  greetedDate: "",
  greetedSlots: [],
  anniversaries: [],
  story: [],               // 我们的故事时间线
  affHistory: {},          // 情感曲线：{ "YYYY-M-D": 当日好感 }
  emotion: { v: 0.22, a: 0.08 },  // 连续情绪坐标 Valence×Arousal
  emotionLog: {},          // 情绪晴雨表：{ "YYYY-M-D": [{v,a}...] }
  diaryEntries: {},        // AI 日记：{ "YYYY-M-D": { text, t, mood } }
  lastDiaryPrompt: "",     // 上次问日记的日期，防重复
  weeklySummary: {},       // 周小结：{ "YYYY-W##": { text, t } }
  lastSummaryWeek: "",     // 上次生成周小结的周标识，防重复
  games: { rps: { wins: 0, played: 0 }, truth: 0 },
  patToday: { date: "", count: 0 },
  // —— v11 对话人格系统（T01 定义 schema，这里只是把默认值并进来）——
  ...(typeof Engine !== "undefined" && Engine.defaults ? Engine.defaults() : {}),
});

/* v11 老存档迁移：引擎的 defaults() 是唯一真相，缺哪个补哪个，已有值一律不动。
 * 幂等 —— 重复调用不会覆盖用户数据。 */
function migrateState(s) {
  if (!s || typeof s !== "object") return s;
  try {
    const def = (typeof Engine !== "undefined" && Engine.defaults) ? Engine.defaults() : null;
    if (!def) return s;
    for (const k of Object.keys(def)) {
      if (s[k] === undefined || s[k] === null) { s[k] = def[k]; continue; }
      // 嵌套对象（flags / safety）逐键兜底，避免老存档只有半套开关
      if (def[k] && typeof def[k] === "object" && !Array.isArray(def[k])
        && s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) {
        s[k] = Object.assign({}, def[k], s[k]);
      }
    }
    if (!Array.isArray(s.recentReplies)) s.recentReplies = [];
    if (typeof s.storyTurns !== "number" || !isFinite(s.storyTurns)) s.storyTurns = 0;
    if (typeof s.storylines !== "object" || Array.isArray(s.storylines)) s.storylines = {};
    if (typeof s.usedProactive !== "object" || Array.isArray(s.usedProactive)) s.usedProactive = {};
  } catch (e) {}
  return s;
}

let S = load();
let mood = null; // 今日心情对象
let currentExpr = "normal";
let herBusy = false;
let pendingMemStores = []; // 待回复生成后落库的记忆回调（避免刚说的事被当场召回）

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = Object.assign(defaultState(), JSON.parse(raw));
      // 嵌套字段兜底（兼容旧存档）
      s.wardrobe = Object.assign({ outfit: "default", hair: "brown" }, s.wardrobe || {});
      s.persona = Object.assign({ gender: "female", tone: "playful", theme: "sakura", card: "xiaonuan", warmth: 0.55, proactivity: 0.5, whitespace: 0.5 }, s.persona || {});  // 候选 E·L4
      s.datingAnnis = s.datingAnnis || [];
      s.games = Object.assign({ rps: { wins: 0, played: 0 }, truth: 0 }, s.games || {});
      s.games.rps = Object.assign({ wins: 0, played: 0 }, s.games.rps || {});
      s.story = s.story || [];
      s.affHistory = s.affHistory || {};
      s.emotion = Object.assign({ v: 0.22, a: 0.08 }, s.emotion || {});
      s.emotionLog = s.emotionLog || {};
      s.diaryEntries = s.diaryEntries || {};
      s.weeklySummary = s.weeklySummary || {};
      s.lastDiaryPrompt = s.lastDiaryPrompt || "";
      s.lastSummaryWeek = s.lastSummaryWeek || "";
      s.localModel = Object.assign({ enabled: false, model: "onnx-community/Qwen2.5-0.5B-Instruct" }, s.localModel || {});
      return migrateState(s);
    }
  } catch (e) {}
  return migrateState(defaultState());
}
function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  // 开了云同步就在空闲 60 秒后静默上传一次（离开页面时另有 1.2 秒的快推）
  // 注意：syncPush 内部也会 save()，用 syncBusy 挡住，避免自我触发死循环
  try { if (!syncBusy) scheduleSyncPush(60000); } catch (e) {}
}

/* D1：日期串全项目统一为零填充 "YYYY-MM-DD"，与 Engine.dayKey 同一实现（直接委托，
 * 杜绝"两处各写一遍、有一天改岔"）。Engine 缺失时才回落本地实现（保证 app 不因此崩）。 */
const todayStr = () => {
  const d = new Date();
  if (typeof Engine !== "undefined" && Engine && typeof Engine.dayKey === "function") return Engine.dayKey(d);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysTogether = () =>
  S.firstMeet ? Math.max(1, Math.floor((Date.now() - S.firstMeet) / 86400000) + 1) : 1;

/* ================= SVG 立绘 ================= */
/* 当前角色性别（男版=阿言 / 女版=小暖），贯穿立绘与文本 */
const currentGender = () => (typeof S !== "undefined" && S.persona && S.persona.gender) || "female";
const currentChar = () => (typeof Engine !== "undefined" ? Engine.getChar(S.persona) : { name: "小暖" });
function avatarSVG(expr = "normal", gender = currentGender()) {
  // 头像：只取头部
  return `<svg viewBox="60 30 180 190" xmlns="http://www.w3.org/2000/svg">${headParts(expr, false, gender)}</svg>`;
}

function fullSVG(gender = currentGender()) {
  const isMale = gender === "male";
  const bodyFill = isMale ? "#5b8fd6" : "#ff8fab";
  const bodyFill2 = isMale ? "#4a7ec4" : "#ff7b9c";
  const backHair = isMale ? "" : `
  <!-- 后发 -->
  <path id="hair-back1" d="M78 118 Q58 200 72 292 Q86 300 92 288 Q80 210 92 150 Z" fill="#6b4634"/>
  <path id="hair-back2" d="M222 118 Q242 200 228 292 Q214 300 208 288 Q220 210 208 150 Z" fill="#6b4634"/>`;
  const collar = isMale ? '<path d="M138 240 L150 256 L162 240" stroke="#ffffff" stroke-width="3" fill="none" stroke-linecap="round"/>' : "";
  return `<svg viewBox="0 0 300 340" xmlns="http://www.w3.org/2000/svg" id="her-svg">
  <!-- 身体 -->
  <path id="outfit-body" d="M102 340 L102 292 Q102 242 150 240 Q198 242 198 292 L198 340 Z" fill="${bodyFill}"/>
  <path id="outfit-body2" d="M102 300 Q150 316 198 300 L198 340 L102 340 Z" fill="${bodyFill2}"/>
  <path d="M134 244 Q150 258 166 244 L150 236 Z" fill="#ffffff"/>
  <circle cx="150" cy="272" r="3.5" fill="#fff"/>
  <circle cx="150" cy="290" r="3.5" fill="#fff"/>
  ${collar}
  ${backHair}
  ${headParts("normal", true, gender)}
</svg>`;
}

function headParts(expr, full = false, gender = currentGender()) {
  const isMale = gender === "male";
  const hair = isMale ? `
  <!-- 短发 -->
  <path id="hair-main" d="M84 142 Q72 66 150 60 Q228 66 216 142 Q208 100 150 96 Q92 100 84 142 Z" fill="#3a2a22"/>
  <path d="M150 62 Q158 42 176 40 Q162 52 160 64 Z" fill="#3a2a22"/>
  <path d="M98 78 Q120 62 150 60 Q118 70 104 86 Z" fill="#4a342a" opacity=".7"/>` : `
  <!-- 头顶发 -->
  <path id="hair-main" d="M80 138 Q66 46 150 44 Q234 46 220 138 Q214 100 196 96 Q206 120 196 128 Q182 92 152 90 Q162 112 152 120 Q132 92 106 98 Q116 118 106 128 Q88 108 80 138 Z" fill="#7a5442"/>
  <path d="M150 48 Q156 26 172 24 Q160 36 159 50 Z" fill="#7a5442"/>
  <path d="M100 70 Q120 54 150 52 Q118 62 104 78 Z" fill="#8f6a55" opacity=".7"/>
  <!-- 蝴蝶结 -->
  <g transform="translate(206,68)">
    <path d="M0 0 L-20 -13 Q-24 0 -20 13 Z" fill="#ff5c7a"/>
    <path d="M0 0 L20 -13 Q24 0 20 13 Z" fill="#ff5c7a"/>
    <circle r="6" fill="#e04468"/>
  </g>`;
  return `
  <!-- 耳朵 -->
  <ellipse cx="82" cy="152" rx="9" ry="13" fill="#ffe4d3"/>
  <ellipse cx="218" cy="152" rx="9" ry="13" fill="#ffe4d3"/>
  <!-- 脸 -->
  <ellipse cx="150" cy="146" rx="68" ry="66" fill="#ffe9db"/>
  ${hair}
  <!-- 腮红 -->
  <g id="blush-normal">
    <ellipse cx="106" cy="172" rx="10" ry="5.5" fill="#ffb3c0" opacity=".55"/>
    <ellipse cx="194" cy="172" rx="10" ry="5.5" fill="#ffb3c0" opacity=".55"/>
  </g>
  <g id="blush-shy" style="display:none">
    <ellipse cx="104" cy="170" rx="13" ry="8" fill="#ff9eb0" opacity=".95"/>
    <ellipse cx="196" cy="170" rx="13" ry="8" fill="#ff9eb0" opacity=".95"/>
  </g>
  <!-- 眉毛 -->
  <g id="brows-normal" stroke="#8a5f4b" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path d="M108 126 Q122 120 136 126"/><path d="M164 126 Q178 120 192 126"/>
  </g>
  <g id="brows-angry" style="display:none" stroke="#8a5f4b" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path d="M108 120 L136 129"/><path d="M192 120 L164 129"/>
  </g>
  <g id="brows-sad" style="display:none" stroke="#8a5f4b" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path d="M108 128 Q122 118 136 124"/><path d="M164 124 Q178 118 192 128"/>
  </g>
  <!-- 睁眼 -->
  <g id="eyes-open" class="blinkable">
    <ellipse cx="122" cy="150" rx="11" ry="13" fill="#fff"/>
    <ellipse cx="178" cy="150" rx="11" ry="13" fill="#fff"/>
    <ellipse cx="122" cy="152" rx="7.5" ry="10" fill="#5a3230"/>
    <ellipse cx="178" cy="152" rx="7.5" ry="10" fill="#5a3230"/>
    <circle cx="119" cy="147" r="3" fill="#fff"/>
    <circle cx="175" cy="147" r="3" fill="#fff"/>
    <circle cx="125" cy="157" r="1.4" fill="#ffb3c7"/>
    <circle cx="181" cy="157" r="1.4" fill="#ffb3c7"/>
    <path d="M110 140 Q122 134 134 140" stroke="#4a2825" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M166 140 Q178 134 190 140" stroke="#4a2825" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  </g>
  <!-- 开心眯眯眼 -->
  <g id="eyes-happy" style="display:none" stroke="#4a2825" stroke-width="4" fill="none" stroke-linecap="round">
    <path d="M110 152 Q122 140 134 152"/><path d="M166 152 Q178 140 190 152"/>
  </g>
  <!-- 闭眼 -->
  <g id="eyes-closed" style="display:none" stroke="#4a2825" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path d="M111 150 Q122 157 133 150"/><path d="M167 150 Q178 157 189 150"/>
  </g>
  <!-- 嘴 -->
  <path id="mouth-smile" d="M138 184 Q150 193 162 184" stroke="#c96a5e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <path id="mouth-happy" style="display:none" d="M134 182 Q150 202 166 182 Q150 190 134 182 Z" fill="#e06a5e"/>
  <ellipse id="mouth-shy" style="display:none" cx="150" cy="186" rx="4.5" ry="5.5" fill="#e06a5e"/>
  <path id="mouth-angry" style="display:none" d="M140 191 Q150 185 160 191" stroke="#c96a5e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <path id="mouth-sad" style="display:none" d="M139 190 Q150 183 161 190" stroke="#c96a5e" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <ellipse id="mouth-sleepy" style="display:none" cx="150" cy="187" rx="6" ry="4" fill="#e06a5e" opacity=".8"/>

  <!-- 哭 -->
  <g id="eyes-cry" style="display:none">
    <path d="M110 150 Q122 161 134 150 Q122 156 110 150 Z" fill="#5a3230"/>
    <path d="M166 150 Q178 161 190 150 Q178 156 166 150 Z" fill="#5a3230"/>
    <circle cx="122" cy="150" r="2.6" fill="#7fbfff"/><circle cx="178" cy="150" r="2.6" fill="#7fbfff"/>
    <path d="M122 159 q-2 9 -1 15" stroke="#7fbfff" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M178 159 q2 9 1 15" stroke="#7fbfff" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <path id="mouth-cry" style="display:none" d="M138 184 Q150 176 162 184 Q150 197 138 184 Z" fill="#b06a6a"/>
  <!-- 思考 -->
  <g id="eyes-think" style="display:none" stroke="#4a2825" stroke-width="3.5" fill="none" stroke-linecap="round">
    <path d="M110 149 Q122 142 134 151"/><path d="M166 149 Q178 142 190 151"/>
  </g>
  <ellipse id="mouth-think" style="display:none" cx="150" cy="186" rx="3.4" ry="4.6" fill="#c96a5e"/>
  <!-- 飞吻 -->
  <path id="mouth-kiss" style="display:none" d="M145 185 Q150 193 155 185 Q150 189 145 185 Z" fill="#e06a5e"/>
  <!-- 眨眼（单眼） -->
  <g id="eyes-wink" style="display:none">
    <ellipse cx="122" cy="150" rx="11" ry="13" fill="#fff"/>
    <ellipse cx="122" cy="152" rx="7.5" ry="10" fill="#5a3230"/>
    <circle cx="119" cy="147" r="3" fill="#fff"/>
    <path d="M166 150 Q178 158 190 150" stroke="#4a2825" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  </g>
  `;
}

const EXPR_MAP = {
  normal: { eyes: "eyes-open", brows: "brows-normal", mouth: "mouth-smile", blush: "blush-normal" },
  happy:  { eyes: "eyes-happy", brows: "brows-normal", mouth: "mouth-happy", blush: "blush-normal" },
  shy:    { eyes: "eyes-open", brows: "brows-normal", mouth: "mouth-shy", blush: "blush-shy" },
  angry:  { eyes: "eyes-open", brows: "brows-angry", mouth: "mouth-angry", blush: "blush-normal" },
  sad:    { eyes: "eyes-open", brows: "brows-sad", mouth: "mouth-sad", blush: "blush-normal" },
  sleepy: { eyes: "eyes-closed", brows: "brows-normal", mouth: "mouth-sleepy", blush: "blush-normal" },
  cry:    { eyes: "eyes-cry", brows: "brows-sad", mouth: "mouth-cry", blush: "blush-normal" },
  think:  { eyes: "eyes-think", brows: "brows-normal", mouth: "mouth-think", blush: "blush-normal" },
  kiss:   { eyes: "eyes-happy", brows: "brows-normal", mouth: "mouth-kiss", blush: "blush-shy" },
  wink:   { eyes: "eyes-wink", brows: "brows-normal", mouth: "mouth-smile", blush: "blush-normal" },
};
const FACE_PARTS = ["eyes-open","eyes-happy","eyes-closed","eyes-cry","eyes-think","eyes-wink",
  "brows-normal","brows-angry","brows-sad",
  "mouth-smile","mouth-happy","mouth-shy","mouth-angry","mouth-sad","mouth-sleepy","mouth-cry","mouth-think","mouth-kiss",
  "blush-normal","blush-shy"];

function setExpression(name, holdMs = 0) {
  const cfg = EXPR_MAP[name] || EXPR_MAP.normal;
  currentExpr = name;
  const svg = document.getElementById("her-svg");
  if (!svg) return;
  FACE_PARTS.forEach(id => {
    const el = svg.querySelector("#" + CSS.escape(id));
    if (el) el.style.display = "none";
  });
  [cfg.eyes, cfg.brows, cfg.mouth, cfg.blush].forEach(id => {
    const el = svg.querySelector("#" + CSS.escape(id));
    if (el) el.style.display = "";
  });
  if (holdMs > 0) setTimeout(() => setExpression(mood.key === "sleepy" ? "sleepy" : "normal"), holdMs);
}

/* 眨眼循环 */
setInterval(() => {
  if (!["normal", "shy", "angry", "sad"].includes(currentExpr)) return;
  const svg = document.getElementById("her-svg");
  if (!svg) return;
  const open = svg.querySelector("#eyes-open");
  const closed = svg.querySelector("#eyes-closed");
  if (!open || !closed) return;
  open.style.display = "none"; closed.style.display = "";
  setTimeout(() => {
    if (["normal", "shy", "angry", "sad"].includes(currentExpr)) {
      closed.style.display = "none"; open.style.display = "";
    }
  }, 160);
}, 3400);

/* 连续情绪光晕：颜色随 valence、强度随 arousal 实时变化（小火人只有脚本表情，小暖有真·V-A 情绪引擎） */
function updateAura() {
  const el = document.getElementById("emotion-aura");
  if (!el || !S.emotion) return;
  const v = Math.max(-1, Math.min(1, S.emotion.v || 0));
  const a = Math.max(-1, Math.min(1, S.emotion.a || 0));
  const t = (v + 1) / 2;                      // 0(低落) .. 1(开心)
  let hue = Math.round(200 + t * 140);        // 200 蓝 → 340 粉
  let sat = 80;
  let light = 60 + a * 6;
  let intensity = 0.34 + Math.abs(a) * 0.5;   // 0.34 .. 0.84
  const scale = 1 + Math.abs(a) * 0.28;
  // v11 · 共情态视觉反馈（PRD 5.1③）：识别到用户高强度负面情绪时不弹任何提示条，
  // 只把光晕往冷色推、降饱和、收敛亮度——用户只应"感觉到她变了"，不该"看到系统提示"。
  const ue = S.ue;
  if (ue && ue.polarity < 0 && ue.intensity > 0.35) {
    const k = Math.min(1, (ue.intensity - 0.35) / 0.5);   // 0 .. 1
    hue = Math.round(hue - k * 40);                        // 往蓝紫方向转冷
    sat = Math.round(sat - k * 34);                        // 降饱和
    light = light - k * 4;
    intensity = Math.max(0.2, intensity - k * 0.1);
  }
  el.style.background = `radial-gradient(circle at 50% 50%, hsla(${hue}, ${sat}%, ${light}%, .95) 0%, hsla(${hue}, ${sat}%, ${light - 6}%, .45) 38%, transparent 66%)`;
  el.style.opacity = intensity.toFixed(2);
  el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
}

/* 空闲时情绪缓慢回归基线，光晕温柔回落，让立绘"活"着 */
let _auraTick = 0;
function tickEmotion() {
  if (!S.emotion) return;
  const BASE = { v: 0.22, a: 0.08 };
  S.emotion.v += (BASE.v - S.emotion.v) * 0.06;
  S.emotion.a += (BASE.a - S.emotion.a) * 0.06;
  updateAura();
  if (++_auraTick % 6 === 0) save(); // 每 ~60s 落盘一次，避免频繁写盘
}

/* ================= 工具 ================= */
const $ = sel => document.querySelector(sel);
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const scrollBottom = () => { const b = $("#chat-body"); b.scrollTop = b.scrollHeight; };

/* v11 · 顶栏状态位的第三态（PRD 5.1①）：话题状态机连续追踪同一话题（turns≥2）时
 * 显示「在聊「加班」· 第 3 句」，话题收束后自动恢复「在线」。复用 #nav-status，零新增元素。 */
function navIdleText() {
  try {
    const tp = S.topic;
    if (tp && tp.key && tp.turns >= 2 && !Engine.topicExpired(tp, Date.now())) {
      return `在聊「${tp.label || tp.key}」· 第 ${tp.turns} 句`;
    }
  } catch (e) {}
  return "在线";
}
function refreshNavStatus() {
  const el = $("#nav-status");
  if (!el || el.classList.contains("typing")) return;
  const txt = navIdleText();
  el.textContent = txt;
  el.classList.toggle("on-topic", txt !== "在线");
}

/* ================= 好感度 ================= */
function addAffection(delta) {
  if (!delta) return;
  const before = Engine.getLevel(S.affection);
  S.affection = Math.max(0, S.affection + delta);
  recordAff(S.affection);
  const after = Engine.getLevel(S.affection);
  save();
  refreshAffectionUI();
  if (after.lv > before.lv) {
    pushStory("levelup", "💗", `好感度升到 Lv.${after.lv}「${after.name}」`);
    const toast = document.createElement("div");
    toast.className = "levelup-toast";
    toast.innerHTML = `💗 好感度提升 💗<br>Lv.${after.lv}「${after.name}」`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
    setExpression("happy");
    const msg = Engine.proactive("levelup", S);
    // 用对应等级的升级台词
    const line = {2:"感觉我们越来越熟了呢……以后请多关照啦 😊",3:"奇怪……最近只要看到你的消息，心跳就会加速。这算什么呀 😳",4:"我好像……有点喜欢你了。就、就告诉你一个人哦！💕",5:"我们现在算是在热恋了吧？嘿嘿，我好幸福呀 🥰",6:"这辈子遇见你真好。以后的路，让我一直陪你走下去吧 💍"}[after.lv];
    if (line) setTimeout(() => herSay(line, "shy"), 1600);
  }
}

function refreshAffectionUI() {
  const lv = Engine.getLevel(S.affection);
  $("#her-level").textContent = `Lv.${lv.lv} ${lv.name}`;
  const pct = Math.round(lv.progress * 100);
  $("#affection-fill").style.width = pct + "%";
  $("#affection-text").textContent = lv.nextMin ? `${S.affection} / ${lv.nextMin}` : `${S.affection} · 已满级`;
  $("#her-next-tip").textContent = lv.nextMin
    ? `距离「${Engine.LEVELS[lv.lv].name}」还差 ${lv.nextMin - S.affection} 点好感`
    : "你们的感情已经满级啦 💍";
  $("#her-days").textContent = `相识第 ${daysTogether()} 天`;
  $("#me-days").textContent = `${daysTogether()} 天`;
  $("#me-msgs").textContent = `${S.stats.msgs} 条`;
  $("#me-affection").textContent = `${S.affection}（Lv.${lv.lv} ${lv.name}）`;
  refreshRelationshipUI();
  // 今日心情：优先显示连续情绪区（更实时），回落每日 mood
  const z = Engine.Emotion.zone(S.emotion || { v: 0.22, a: 0.08 });
  $("#nav-mood").textContent = z.ico;
  $("#nav-mood").title = `${currentChar().name}此刻：${z.label}`;
  $("#her-mood").textContent = `${z.ico} ${z.label}`;
  refreshMemoryUI();
}

/* 记忆可视化：把小暖记住的关于你的事显示成卡片 */
function refreshMemoryUI() {
  const box = $("#memory-list");
  if (!box) return;
  const mem = S.memory || {};
  const items = [];
  if (mem.userName) items.push({ ico: "👤", text: "你叫 " + mem.userName });
  if (mem.likes && mem.likes.length) items.push({ ico: "💝", text: "你喜欢：" + mem.likes.slice(0, 5).join("、") });
  if (mem.events && mem.events.length) {
    mem.events.slice(-3).forEach(e => items.push({ ico: "📌", text: e.topic }));
  }
  if (!items.length) {
    box.innerHTML = `<div class="memory-empty">还没有记住什么…多陪${currentChar().name}聊聊，${currentChar().name}会把你放在心上 💕</div>`;
    return;
  }
  box.innerHTML = items.map(i => `<div class="memory-item"><span>${i.ico}</span><span>${esc(i.text)}</span></div>`).join("");
}

/* v11 · 她页「💬 我们最近」（PRD 5.2④）：当前话题 + 进行中的剧情线节点进度。
 * 两者都没有时整张卡隐藏，不留空壳。 */
function refreshRecentUI() {
  const card = $("#recent-card");
  if (!card) return;
  const tRow = $("#recent-topic-row"), aRow = $("#recent-arc-row");
  let any = false;

  // 在聊：话题状态机的当前快照
  let topicTxt = "";
  try {
    const tp = S.topic;
    if (tp && tp.key && !Engine.topicExpired(tp, Date.now())) {
      topicTxt = `${tp.label || tp.key}　· 已聊 ${tp.turns || 1} 句`;
    }
  } catch (e) {}
  if (topicTxt) { $("#recent-topic").textContent = topicTxt; tRow.classList.remove("hidden"); any = true; }
  else tRow.classList.add("hidden");

  // 正在发生：优先展示已开线且未完结的那条
  let arcHtml = "";
  try {
    const list = Engine.Story.progress(S) || [];
    const running = list.filter(l => l.started && !l.done).sort((a, b) => b.stage - a.stage)[0]
      || list.filter(l => l.started).sort((a, b) => b.stage - a.stage)[0];
    if (running) {
      arcHtml = `${running.icon} ${esc(running.label)}　<span class="arc-dots">${dotBar(running.stage, running.total)}</span> ${running.stage}/${running.total} ›`;
    }
  } catch (e) {}
  if (arcHtml) { $("#recent-arc").innerHTML = arcHtml; aRow.classList.remove("hidden"); any = true; }
  else aRow.classList.add("hidden");

  card.classList.toggle("hidden", !any);
}

/* 节点进度点：●●●○ */
function dotBar(done, total) {
  let s = "";
  for (let i = 0; i < total; i++) s += i < done ? "●" : "○";
  return s;
}

/* 通用云端补全（用于生成余温/摘要等，不污染主对话历史） */
async function cloudComplete(systemPrompt, userText, opts = {}) {
  if (!(S.cloud.enabled && S.cloud.base && S.cloud.key)) return null;
  try {
    const base = S.cloud.base.trim().replace(/\/+$/, "");
    const url = /\/chat\/completions$/.test(base) ? base
      : (base.endsWith("/v1") ? base + "/chat/completions" : base + "/v1/chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
      body: JSON.stringify({
        model: S.cloud.model || "deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 120,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || "").trim() || null;
  } catch (e) { return null; }
}

/* 跨会话记忆回写「余温」（借鉴 coread）：睡前把今天的感受写成一句小结，下次自然接起 */
async function generateDailyNote() {
  const today = todayStr();
  if (S.dailyNotes[today]) return;
  const myToday = S.messages.filter(m => m.from === "me" && todayStr(m.t) === today).map(m => m.text);
  const topics = (S.memory.events || []).filter(e => todayStr(e.at) === today).map(e => e.topic);
  const mood = (S.emotionLog[today] || []).slice(-1)[0];
  let note = null;
  if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
    const sys = `你是${currentChar().name}的回忆整理小助手。用第一人称、一句 20~40 字、温暖口语化，总结"今天和${S.memory.userName || "他"}聊了什么、他状态如何"。只输出这一句，不要引号、不要解释。`;
    const usr = `今天他说了这些：${(myToday.slice(-15).join(" / ") || "（没说什么）")}。提到的主题：${topics.join("、") || "生活点滴"}。`;
    note = await cloudComplete(sys, usr, { temperature: 0.8, max_tokens: 80 });
    note = note ? cleanLocalReply(note) : null;
  }
  if (!note) {
    const t = topics.length ? ("你提到了" + topics.join("、")) : "你们聊了生活里的点点滴滴";
    note = `今天和你说了${myToday.length}句话，${t}，我都悄悄记在心里啦。`;
  }
  S.dailyNotes[today] = { text: note, t: Date.now() };
  save();
}

/* 记忆摘要（借鉴 chatnest-ui 的 memory summary）：把零散喜好/事件压成常驻档案 */
async function generateMemorySummary() {
  const likes = S.memory.likes || [];
  const events = (S.memory.events || []).slice(-5).map(e => e.topic);
  let summary = null;
  if (S.cloud.enabled && S.cloud.base && S.cloud.key && (likes.length || events.length)) {
    const sys = `你是${currentChar().name}的记忆整理助手。用一句 30~60 字、口语化，概括"他是谁、喜欢什么、最近在忙什么"。只输出这一句。`;
    const usr = `名字：${S.memory.userName || "未知"}；喜欢：${likes.join("、") || "未知"}；最近：${events.join("、") || "未知"}。`;
    summary = await cloudComplete(sys, usr, { temperature: 0.6, max_tokens: 90 });
    summary = summary ? cleanLocalReply(summary) : null;
  }
  if (!summary && (likes.length || events.length || S.memory.userName)) {
    const parts = [];
    if (S.memory.userName) parts.push(`他叫${S.memory.userName}`);
    if (likes.length) parts.push(`喜欢${likes.slice(0, 5).join("、")}`);
    if (events.length) parts.push(`最近在${[...new Set(events)].slice(0, 4).join("、")}`);
    summary = parts.join("，") + "。";
  }
  if (summary) { S.memory.summary = summary; save(); }
}

/* 离线整理（Sleep-time Compute）：每天至多一次，做结构性合并 */
async function maybeConsolidate() {
  const today = todayStr();
  if (S.memory.lastConsolidatedDay === today) return;
  const changed = Engine.consolidateMemory(S);
  S.memory.lastConsolidatedDay = today;
  save();
  if (changed) {
    pushStory("memory", "🌙", `${currentChar().name}在夜里悄悄整理了今天的回忆`);
    refreshMemoryUI();
    refreshStoryUI();
  }
}

/* 余温 + 记忆摘要：随聊天增量生成（不局限于每日整理，避免"初始化时记忆还空就写好"） */
let _reflectTimer = null;
function scheduleReflection() {
  if (_reflectTimer) clearTimeout(_reflectTimer);
  _reflectTimer = setTimeout(() => {
    _reflectTimer = null;
    generateDailyNote().catch(() => {});
    generateMemorySummary().catch(() => {});
  }, 4000);
}

/* ================= 我们的故事时间线 & 情感曲线 ================= */
function daysDating() {
  return S.dating ? Math.max(1, Math.floor((Date.now() - S.dating.since) / 86400000) + 1) : 0;
}

function pushStory(type, icon, text) {
  S.story = S.story || [];
  S.story.push({ type, icon, text, t: Date.now() });
  if (S.story.length > 200) S.story = S.story.slice(-200);
  save();
  if (typeof refreshStoryUI === "function") refreshStoryUI();
}

function recordAff(aff) {
  S.affHistory = S.affHistory || {};
  S.affHistory[todayStr()] = Math.max(S.affHistory[todayStr()] || 0, aff);
  save();
}

/* ================= 聊天渲染 ================= */
function renderMessage(m, animate = true) {
  const body = $("#chat-body");
  // 时间分隔（与上一条间隔 > 5 分钟）
  const last = S.messages[S.messages.indexOf(m) - 1];
  if (!last || m.t - last.t > 5 * 60 * 1000) {
    const div = document.createElement("div");
    div.className = "time-divider";
    div.textContent = fmtTime(m.t);
    body.appendChild(div);
  }
  const wrap = document.createElement("div");
  wrap.className = `msg ${m.from}`;
  wrap.dataset.idx = S.messages.indexOf(m);
  if (!animate) wrap.style.animation = "none";
  // 工具卡片（预留给未来接外部工具：查天气/日历等）——借鉴 chatnest-ui 的 tool card
  if (m.tool) {
    wrap.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
      <div class="bubble-wrap"><div class="tool-card">
        <span class="tool-ico">${m.tool.icon}</span>
        <span class="tool-label">${esc(m.tool.label)}</span>
        <span class="tool-status">${esc(m.tool.status || "完成")}</span>
      </div><div class="msg-meta">${fmtTime(m.t)}</div></div>`;
    body.appendChild(wrap);
    scrollBottom();
    return;
  }
  // 图片消息：气泡里只放图（+可选文字说明）
  const imgHtml = m.img ? `<img class="bubble-img" src="${m.img}" alt="图片">` : "";
  const txtHtml = m.text ? esc(m.text) : "";
  const inner = imgHtml + (imgHtml && txtHtml ? `<div class="bubble-cap">${txtHtml}</div>` : txtHtml);
  if (m.from === "her") {
    // v11 · 剧情气泡：重新进入页面时按落库标记还原竖条 + 图标 + 尾注
    if (m.story) wrap.className += " story-bubble";
    const foot = m.story ? storyFootHTML(m.story) : "";
    wrap.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
      <div class="bubble-wrap"><div class="bubble">${inner}</div>${foot}
      <div class="msg-meta">${fmtTime(m.t)}</div></div>`;
  } else {
    wrap.innerHTML = `<div class="bubble-wrap"><div class="bubble">${inner}</div>
      <div class="msg-meta">${fmtTime(m.t)} <span class="read">${m.read ? "已读" : "送达"}</span></div></div>`;
  }
  body.appendChild(wrap);
  scrollBottom();
}

/* 工具卡片消息（如"查了下时间"），为未来接外部工具铺路 */
function pushToolCard(icon, label, status) {
  const m = { from: "her", tool: { icon, label, status }, t: Date.now(), read: true };
  S.messages.push(m);
  if (S.messages.length > 300) S.messages = S.messages.slice(-300);
  save();
  renderMessage(m);
  return m;
}

/* 思考气泡（借鉴"思考链"手感）：回复前闪一下"她在斟酌"，更像真人在想 */
function showThinking() {
  const body = $("#chat-body");
  if (body.querySelector(".thinking-wrap")) return null;
  const wrap = document.createElement("div");
  wrap.className = "msg her thinking-wrap";
  wrap.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
    <div class="bubble-wrap"><div class="bubble thinking"><i></i><i></i><i></i></div></div>`;
  body.appendChild(wrap); scrollBottom();
  return wrap;
}
function removeThinking() {
  document.querySelectorAll(".thinking-wrap").forEach(e => e.remove());
}

function renderAllMessages() {
  $("#chat-body").innerHTML = "";
  S.messages.slice(-200).forEach((m, i) => renderMessage(m, false));
  scrollBottom();
}

function pushMessage(from, text, img) {
  const m = { from, text, t: Date.now(), read: from === "her" };
  if (img) m.img = img;
  S.messages.push(m);
  if (S.messages.length > 300) S.messages = S.messages.slice(-300);
  save();
  renderMessage(m);
  return m;
}

function markAllRead() {
  S.messages.forEach(m => { if (m.from === "me") m.read = true; });
  save();
  document.querySelectorAll(".msg.me .read").forEach(el => el.textContent = "已读");
}

/* ================= 她说话（流式打字机渲染） =================
 * 借鉴竞品的"流式输出"手感：先显示"正在输入"气泡，再把回复逐字渲染出来，
 * 像真人一边想一边打字。纯前端效果，不依赖大模型是否支持流式接口。
 * 打字完成后才把完整文本交给 TTS，避免朗读被打断。 */
async function herSay(text, expr = null, opts = null) {
  removeThinking(); // 真实回复开始，收掉思考气泡
  // 显示"正在输入"
  $("#nav-status").textContent = "正在输入…";
  $("#nav-status").classList.add("typing");
  const body = $("#chat-body");
  const tip = document.createElement("div");
  // v11 · 剧情气泡（PRD 5.1②）：仍是聊天气泡形态，只在左侧加淡色竖条 + 图标 + 尾注
  const story = opts && opts.story ? opts.story : null;
  tip.className = "msg her" + (story ? " story-bubble" : "");
  const meta = `<div class="msg-meta">${fmtTime(Date.now())}</div>`;
  tip.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
    <div class="bubble-wrap"><div class="bubble typing-bubble"><i></i><i></i><i></i></div>${meta}</div>`;
  body.appendChild(tip); scrollBottom();

  // 思考停顿：短消息更快开打，长消息略多酝酿
  await new Promise(r => setTimeout(r, 350 + Math.min(900, text.length * 12)));
  $("#nav-status").classList.remove("typing");
  $("#nav-status").textContent = navIdleText();

  // 把"正在输入"气泡换成真实气泡，逐字渲染（流式打字机效果）
  const wrap = tip.querySelector(".bubble-wrap");
  const foot = story ? storyFootHTML(story) : "";
  wrap.innerHTML = `<div class="bubble her-bubble-stream"></div>${foot}${meta}`;
  const bubble = wrap.querySelector(".bubble");

  const chars = Array.from(text);
  // 自适应速度：长句更快，整体不超过 ~2.6s；标点处稍作停顿更像真人
  const per = Math.max(10, Math.min(42, Math.floor(2600 / Math.max(1, chars.length))));
  let shown = "";
  for (let i = 0; i < chars.length; i++) {
    shown += chars[i];
    bubble.textContent = shown;
    scrollBottom();
    const c = chars[i];
    const pause = /[。！？!?，,、…\n]/.test(c) ? per * 3 : 0;
    await new Promise(r => setTimeout(r, per + pause));
  }
  bubble.classList.remove("her-bubble-stream");
  if (expr) { setExpression(expr, 2600); }

  // 落库：把这条回复记进消息流（DOM 已由上面的气泡呈现，不再重复渲染）
  const m = { from: "her", text, t: Date.now(), read: true };
  if (story) m.story = { lineId: story.lineId, label: story.label, icon: story.icon };
  S.messages.push(m);
  if (S.messages.length > 300) S.messages = S.messages.slice(-300);
  save();

  // 页面不可见时（切到后台/其他 App），把想念/回复转成系统通知，实现跨会话推送
  if (document.hidden && S.notify) {
    notifyOS(currentChar().name + "想你了 💕", text);
  } else {
    speak(text);
  }
  // 不在聊天页时亮红点
  if (!$("#page-chat").classList.contains("active")) $("#chat-dot").classList.remove("hidden");
}

/* 剧情气泡尾注：「我们的经历 · 楼下的小橘 ›」，点击跳故事页对应剧情线 */
function storyFootHTML(story) {
  return `<div class="story-foot" data-line="${esc(story.lineId)}">${story.icon || "🌱"} 我们的经历 · ${esc(story.label || "")} ›</div>`;
}

/* ================= v11 · 危机帮助卡（PRD Q4 / 主理人裁定） =================
 * 硬性口径，逐条对齐裁定：
 *   · 聊天流内的卡片，不是 modal、不是 toast、不阻断输入
 *   · 只陈述不承诺疗效、不诊断、不说教，保持恋人陪伴的口吻
 *   · 用户可手动关闭
 *   · 绝不做任何数据上报（本函数内没有任何 fetch / 网络调用，也不写入消息历史）
 *   · 同一会话 24 小时内不重复弹（冷却由 Engine.CRISIS_CARD_COOLDOWN 定义）
 * 只把冷却时间戳落盘，危机文本本身不留痕。 */
function renderSafetyCard(safety) {
  if (!safety || !safety.card) return false;
  const body = $("#chat-body");
  if (!body) return false;
  const hotlines = (safety.hotlines && safety.hotlines.length)
    ? safety.hotlines
    : [{ name: "全国统一心理援助热线", tel: Engine.CRISIS_HOTLINE, note: "24 小时" }];
  const wrap = document.createElement("div");
  wrap.className = "msg safety-wrap";   // 中性类：不带她的头像、不像是她说的气泡
  const rows = hotlines.map(h =>
    `<a class="safety-tel" href="tel:${esc(h.tel)}"><span class="st-name">${esc(h.name)}</span>` +
    `<span class="st-num">${esc(h.tel)}</span>${h.note ? `<span class="st-note">${esc(h.note)}</span>` : ""}</a>`
  ).join("");
  wrap.innerHTML =
    `<div class="safety-card">
       <div class="safety-head">
         <svg class="safety-icon" viewBox="0 0 24 24" aria-hidden="true">
           <path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
           <path d="M12 8.2c1.6-1.1 3.4-.4 3.4 1.2 0 1.6-1.7 2.7-3.4 4-1.7-1.3-3.4-2.4-3.4-4 0-1.6 1.8-2.3 3.4-1.2z" fill="currentColor" opacity=".85"/>
         </svg>
         <span class="safety-tag">安心提示</span>
         <button class="safety-close" type="button" aria-label="关闭">×</button>
       </div>
       <div class="safety-title">如果你现在很难受，可以找人说说</div>
       <div class="safety-desc">我会一直在这儿陪你。有些时候，让专业的人也搭把手会更好一点。</div>
       <div class="safety-tels">${rows}</div>
       <div class="safety-foot">这张卡只显示在你自己的设备上，不会被记录也不会发送到任何地方。</div>
     </div>`;
  wrap.querySelector(".safety-close").addEventListener("click", () => wrap.remove());
  body.appendChild(wrap);
  scrollBottom();
  // 只落冷却时间戳，不落任何危机文本（零留痕、零上报）
  S.safety = Object.assign({ lastCardAt: 0, off: false, hits: [] }, S.safety || {});
  S.safety.lastCardAt = safety.cardAt || Date.now();
  S.safety.hits = [];
  save();
  return true;
}

/* ================= 仪式感：特殊意图处理 ================= */
function celebrateTogether() {
  const toast = document.createElement("div");
  toast.className = "levelup-toast";
  toast.style.background = "linear-gradient(135deg, #ff8fab, #ff5c8a)";
  toast.innerHTML = `💞 我们在一起了 💞<br>今天起你是我的男朋友`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
  spawnHearts(18);
}

async function handleSpecialIntent(text, intent) {
  // 表白 / 确定关系
  if (intent === "propose") {
    if (S.dating) {
      return {
        replies: ["笨蛋，我们已经在一起了呀 💕", "我们早就确定关系了，想赖账可不行哦 😤"],
        expr: "happy", delta: 0,
      };
    }
    const lv = Engine.getLevel(S.affection).lv;
    if (lv >= 4) {
      S.dating = { since: Date.now() };
      save();
      recordAff(S.affection);
      const cChar = Engine.getChar(S.persona);
      pushStory("confess", "💞", `你向${cChar.name}表白，${cChar.aiPronoun}害羞地答应了，你们正式在一起 💍`);
      refreshRelationshipUI(); // 答应瞬间立即更新关系状态
      setExpression("happy", 3000);
      celebrateTogether();
      return {
        replies: [
          "我愿意！🥰 从今天起，你就是我正式的男朋友了，不准反悔哦～",
          "刚才心跳快得都快蹦出来了……以后请多多关照呀，男朋友 💕",
        ],
        expr: "happy", delta: 25,
      };
    }
    return {
      replies: [
        "诶？！太突然了吧……我们还不够了解呢，再多陪我一段时间好不好嘛 😳",
        "你现在说这种话，我心跳会乱掉的……先让我再多喜欢你一点嘛 🥺",
      ],
      expr: "shy", delta: 5,
    };
  }

  // 问纪念日 / 在一起多久
  if (intent === "anniversary_ask") {
    if (S.dating) {
      const d = daysDating();
      return {
        replies: [
          `我们的纪念日呀～ 是从 ${d} 天前开始的，那一天我记一辈子 💕`,
          `在一起 ${d} 天啦！每过一天我都更喜欢你一点 💗`,
        ],
        expr: "shy", delta: 1,
      };
    }
    return { replies: ["纪念日？我们……还只是好朋友啦，等你让我心动了再说 😏"], expr: "happy", delta: 1 };
  }

  // 想玩游戏
  if (intent === "game") {
    openGamesPanel();
    return {
      replies: ["好呀！点下面的「游戏」按钮陪我玩嘛～ 石头剪刀布还是真心话？😏"],
      expr: "happy", delta: 3,
    };
  }

  return null;
}

/* 待回复队列：她说话时用户发的消息会排队，合并后一起回复 */
let pendingQueue = [];
/* 待回复图片队列：发图时排队，herReply 处理完文字后再让小暖"看见" */
let pendingImgs = [];

/* 把一次对话的"情绪后果"落进连续情绪模型：施加冲量 → 衰减余韵 → 按天记录。
 * 返回当前情绪区，供决定立绘表情与语气。 */
function applyEmotion(intent, delta, ue) {
  // ue 为可选第 4 参：只在输入侧调制冲量（用户难过 → 她的冲量跟着往下压），
  // V-A 模型本身（9 情绪区 / 冲量表 / 基线回归）一字未改。不传时行为与 v10 完全一致。
  // v12 · D3 修复：第 5 参 minDv 真正接进调用链（真实档 -0.35 / 克制档 -0.20）。
  // 上一批只加了参数没接线，负向冲量实测能到 -0.64，直接击穿 PRD 5.1 的单次下限。
  Engine.Emotion.apply(S.emotion, intent, delta, ue || null, Engine.negMinDv(S));
  // v12 · T2：衰减目标从固定基线换成 effectiveBaseline(moodDay)——慢层唯一接缝。
  // moodDay 为 null（关层/老档/跨天前）时返回零偏置基线，逐位等价 v11。
  Engine.Emotion.decay(S.emotion, Engine.effectiveBaseline(S.moodDay));
  // v12 · D1/D3 写侧接线：安抚意图（对不起/抱抱/我爱你…）落地即清 G1 streak。
  // "判断正确"与"判断被消费"是两回事——G1 的读侧此前 100% 正确、写侧 0%，就栽在这类回写上。
  try { S.negGate = Engine.negAfterTurn(S, intent, { now: Date.now() }) || S.negGate; } catch (e) {}
  const _d = todayStr();
  Engine.Emotion.record(S.emotionLog, S.emotion, _d);
  // v12 · T2：情绪收盘每轮覆写。跨天时 moodTick 读到的就是"昨天最后一刻"的情绪，
  // 无需额外定时器，也不怕用户中途关页面（R4 余韵过夜）。
  S.emoCarry = { date: _d, v: +S.emotion.v.toFixed(3), a: +S.emotion.a.toFixed(3) };
  updateAura();
  save();
  return Engine.Emotion.zone(S.emotion);
}

async function herReply(userText, img) {
  herBusy = true;
  // 候选 A · 长期记忆：捕获本轮召回条目（send 阶段已检索），供引擎/模型分支注入
  const ltmRecall = __ltmRecallItems; __ltmRecallItems = null;
  // 构建长期记忆片段（供云端/端侧模型分支注入 prompt；本地冻结引擎忽略该字段）
  let ltmFrag = null;
  try {
    if (ltmRecall && ltmRecall.length && window.LTM && typeof window.LTM.buildMemoryFragment === "function") {
      ltmFrag = window.LTM.buildMemoryFragment(ltmRecall);
    }
  } catch (e) { ltmFrag = null; }
  if (userText) pendingQueue.push(userText);
  if (img) pendingImgs.push(img);

  while (pendingQueue.length) {
    const text = pendingQueue.length > 1 ? pendingQueue.join("；") : pendingQueue[0];
    pendingQueue = [];

    // 特殊仪式感意图（表白 / 纪念日 / 游戏）需要读取或改写状态
    const intent = Engine.detect(text);
    // v11 · 剧情双闸门的轮数计数器：唯一累加点就在这里（不含主动消息、不含互动动作）
    S.storyTurns = (Number(S.storyTurns) || 0) + 1;
    // 工具卡片演示：问时间时，先亮一张"查了下时间"的工具卡（为未来接外部工具铺路）
    if (intent === "time_ask") pushToolCard("🕐", "查了下时间", "完成");
    const special = await handleSpecialIntent(text, intent);
    if (special) {
      const z = applyEmotion(intent, special.delta);
      if (!special.expr || special.expr === "normal") special.expr = z.expr; // 情绪驱动表情（保留 kiss 等强表情）
      for (let i = 0; i < special.replies.length; i++) {
        await herSay(special.replies[i], special.expr);
        if (i < special.replies.length - 1) await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
      }
      markAllRead();
      S.lastReply = special.replies[special.replies.length - 1];
      save();
      if (special.delta) addAffection(special.delta);
      try { ltmPushTurn("assistant", special.replies.join(" ")); } catch (e) {}
      continue;
    }

    let result = null;

    // 语义召回（配置 embedding 时优先；未配置/无匹配则回落下面的本地词向量）
    const sem = await semanticRecall(text);
    if (sem) {
      if (sem.moodOverride) { mood = sem.moodOverride; S.moodKey = mood.key; save(); refreshAffectionUI(); }
      const z = applyEmotion(sem.intent || "rec", sem.delta);
      if (!sem.expression || sem.expression === "normal") sem.expression = z.expr;
      for (let i = 0; i < sem.replies.length; i++) {
        await herSay(sem.replies[i], sem.expression);
        if (i < sem.replies.length - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
      }
      markAllRead();
      S.lastReply = sem.replies[sem.replies.length - 1];
      save();
      addAffection(sem.delta);
      try { ltmPushTurn("assistant", sem.replies.join(" ")); } catch (e) {}
      continue;
    }

    // 心屿 MCP：拉取当前心智上下文（失败静默降级，绝不阻塞回复）
    // 每次 herReply（每条用户消息）拉取一次，结果缓存于 mindCtx 至本次回复结束。
    try {
      mindCtx = MCP ? await MCP.getMindContext() : null;
    } catch (e) {
      mindCtx = null;
    }

    // 候选 C（C2 本地模型热切换）：云端大脑启用时，走 ReplyRouter 统一路由 [cloud → local → heuristic]
    //   - cloud 失败 / 8s 超时 / 连续 2 次失败 / 401 → 降级 local（若 LocalModel 已 loaded）→ 终落 LocalHeuristic
    //   - S.cloud 关闭时本分支不进入，维持既有 engine.js 本地回复路径（不破坏 B）
    if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
      try {
        if (__replyRouter) {
          const routed = await __replyRouter.route(text, { ltmFragment: ltmFrag, mode: "reply", tone: S.persona.tone });  // 候选 E·L4：传 tone 供 LocalHeuristic 分流
          if (typeof routed === "string" && routed.trim()) {
            result = { replies: [routed], delta: 3, expression: "normal", via: (__replyRouter.lastVia || "cloud") };
          }
        } else {
          result = await callCloud(text, ltmFrag); // 路由未就绪：回退原 callCloud（共存安全网）
        }
      } catch (e) {
        console.warn("ReplyRouter 路由失败，回落本地引擎：", e);
        result = null; // 落入下方本地引擎兜底（冻结 engine.js，永远可用）
      }
    }
    // 端侧模型兜底（零配置离线 AI）：云端未配/失败，且用户已启用并加载了本地模型
    if (!result && S.localModel.enabled) {
      result = await localThink(text, ltmFrag);
    }
    // 本地引擎兜底（永远可用，无网络也无模型也能聊）
    // v11：把完整 state 交给引擎（话题 / 跨轮去重窗口 / 用户情绪 / 危机冷却 / 开关），
    // 引擎不写 state —— app.js 就是那个"调用方回写"的人，下面逐字段写回并持久化。
    if (!result) {
      const est = {
        affection: S.affection, nick: S.nick, mood, memory: S.memory, persona: S.persona,
        dating: S.dating, lastReply: S.lastReply,
        topic: S.topic, recentReplies: S.recentReplies, ue: S.ue,
        safety: S.safety, flags: S.flags,
        // ★ S0-a：慢层六字段必须入参。缺 moodDay 时 innerLeak 恒判 hint 档；
        // inner/voice/negGate 缺席时引擎在临时对象上自建，配额与吃醋阶段落不了盘。
        moodDay: S.moodDay, self: S.self, inner: S.inner,
        voice: S.voice, dayLife: S.dayLife, negGate: S.negGate,
        // ★ v13 待决点④：三模块的记忆/在场/微行为状态必须**入参**，否则 texture 的日配额与
        // presence 的不可用累计每轮从零开始 —— 门禁写得再严，计数器天天清零就等于没门禁。
        mem: S.mem, tex: S.tex, pres: S.pres, firstMeet: S.firstMeet,
        // 心屿 MCP：把当前心智摘要挂到 est（引擎冻结，v1 仅建数据可用性 + 控制台可观测）
        mindCtx: (mindCtx && MCP) ? MCP.buildFragment(mindCtx) : null,
        // v2 ③ 本地引擎消费 mindCtx：把 12 维信封归一化为 MindProfile 注入本地引擎，
        // 做回复塑形偏置（黏人/安抚/更早给台阶）。云端分支（callCloud）不变，仍用 buildFragment。
        mindProfile: (mindCtx && MCP) ? MCP.normalizeProfile(mindCtx) : null,
        // 候选 A · 长期记忆：补充字段，绝不覆盖上面的 mindCtx/mindProfile；冻结引擎忽略该字段
        longTermMemories: (ltmRecall && ltmRecall.length) ? ltmRecall : null,
      };
      const r = Engine.reply(text, est);
      // ★ v13 待决点④ 落盘：engine.js 冻结（T5a 零 diff），afterTurn 的调用点只能落在宿主。
      // presenceAfterTurn 原地写 est.pres（返回值即同一对象），textureAfterTurn 返回补丁不写 state，
      // 两种口径都在这里收敛成"取回 → 挂到 est → 随 result 回写 S → save()"。
      // 整段包 try：任一模块缺席（半更新态）或抛错都不许波及正常回复。
      try {
        const _P = Engine.mod && Engine.mod("presence");
        if (_P && r.presence) _P.presenceAfterTurn(est, Object.assign({ now: Date.now() }, r.presence));
        const _T = Engine.mod && Engine.mod("texture");
        if (_T) { const p = _T.textureAfterTurn(est, r.tx || {}); if (p) est.tex = p; }
      } catch (e) {}
      result = {
        replies: r.replies, delta: r.delta, expression: r.expression, moodOverride: r.moodOverride,
        textured: true,  // 候选 E·L4：本分支经 Engine.mod("texture") 已含微行为加工，告知 L3 跳过重叠维度
        intent: r.intent, intentEx: r.intentEx,
        topic: r.topic, recentReplies: r.recentReplies, ue: r.ue, safety: r.safety,
        moodDay: r.moodDay, self: r.self, inner: r.inner,
        voice: r.voice, dayLife: r.dayLife, negGate: r.negGate,
        presence: r.presence, pacing: r.pacing,
        pres: est.pres, tex: est.tex,
      };
    }

    // —— v11 新 state 字段回写（引擎侧是纯函数，落库责任在这里）——
    if (result.recentReplies !== undefined) S.recentReplies = result.recentReplies;
    if (result.topic !== undefined) S.topic = result.topic;
    if (result.ue !== undefined) S.ue = result.ue;

    // ★ S0-a 回写：innerLeak/jealousTick 在这些对象上原地写状态，不回写 = 日配额与
    // 吃醋阶段每轮清零。云端/端侧分支不返这些字段（undefined），逐字段判空即可共用。
    //
    // 这里的 save() 不是本回合末尾那次的重复：从这行到末尾之间隔着若干次 await herSay()
    // （逐条气泡 + 500~1100ms 停顿，整回合可达数秒）。这中间用户刷新页面，或 herSay/TTS
    // 抛错让末尾 save() 走不到，配额与吃醋阶段就又丢了 —— 正是本次要修的那个洞的窄版。
    // 状态在这一行就已权威，落盘时机必须跟着它，不能跟着渲染完成。
    if (result.moodDay !== undefined) S.moodDay = result.moodDay;
    if (result.self !== undefined) S.self = result.self;
    if (result.inner !== undefined) S.inner = result.inner;
    if (result.voice !== undefined) S.voice = result.voice;
    if (result.dayLife !== undefined) S.dayLife = result.dayLife;
    if (result.negGate !== undefined) S.negGate = result.negGate;
    // ★ v13 待决点④：与慢层六字段同一时机落盘。presence 的日累计/连发计数、texture 的
    // 日配额与错字冷却全靠这两行跨轮存活；漏了它们，R30「错字 ≤2/日」这类约束只在单轮内成立。
    if (result.pres !== undefined) S.pres = result.pres;
    if (result.tex !== undefined) S.tex = result.tex;
    save();

    if (result.moodOverride) { mood = result.moodOverride; S.moodKey = mood.key; save(); refreshAffectionUI(); }

    // 情绪状态机：用本轮回合的意图/好感度更新连续情绪，再决定表情（覆盖无表情的行）
    // v11：把用户情绪 result.ue 作为第 4 参传入，只调制输入侧冲量，V-A 模型本身不变
    const z = applyEmotion(intent, result.delta, result.ue);
    if (!result.expression || result.expression === "normal") result.expression = z.expr;

    if (result.intent === "greeting" && Engine.getLevel(S.affection).lv >= 3) waveHello();

    for (let i = 0; i < result.replies.length; i++) {
      let reply = result.replies[i];
      // 候选 E·L3：回复质感编排后处理管道（engine 之外，全 provider 出口统一生效）
      //   textured 分支（本地引擎已含 texture 微行为）跳过重叠维度，防双加工
      if (window.ReplyTexture && window.ReplyTexture.orchestrate) {
        try {
          reply = window.ReplyTexture.orchestrate(reply, {
            state: S,
            ctx: { ue: result.ue, mood: mood, intent: result.intent, textured: !!result.textured }
          });
        } catch (e) { /* 任一异常 → 原句直出，绝不静默/白屏 */ }
      }
      await herSay(reply, result.expression);
      if (i < result.replies.length - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
    }
    // 危机帮助卡：在最后一条气泡渲染完成之后追加，流内卡片、不阻断输入
    if (result.safety && result.safety.card) { try { renderSafetyCard(result.safety); } catch (e) {} }
    markAllRead();
    S.lastReply = result.replies[result.replies.length - 1];
    save();
    try { ltmPushTurn("assistant", result.replies.join(" ")); } catch (e) {}
    refreshNavStatus();
    refreshRecentUI();
    addAffection(result.delta);
  }

  // 图片：让小暖"看见"用户发来的图，再回应（三层管线在 understandImage 内）
  while (pendingImgs.length) {
    const im = pendingImgs.shift();
    const r = await handleImage(im);
    // 心屿 MCP：图片消息补发交互事件（失败静默；event_id 含时间+内容哈希，与文本 send() 的 fire 天然互不重复）
    if (MCP) MCP.fireUserEvent(im.caption || "[图片]", { intensity: 0.5, tags: ["image", "photo"] }).catch(() => {});
    if (r && r.replies && r.replies.length) {
      const z = applyEmotion("photo", r.delta);
      const expr = (r.expr && r.expr !== "normal") ? r.expr : z.expr;
      for (let i = 0; i < r.replies.length; i++) {
        await herSay(r.replies[i], expr);
        if (i < r.replies.length - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
      }
      markAllRead();
      S.lastReply = r.replies[r.replies.length - 1];
      save();
      addAffection(r.delta);
    }
  }

  // 日记：如果今晚小暖问过"今天怎么样"且用户回了实质内容，把回答整理成一篇日记
  const today = todayStr();
  if (S.lastDiaryPrompt === today && userText && userText.trim().length > 2 && !S.diaryEntries[today]) {
    const diaryText = await generateDiary(userText);
    if (diaryText) {
      S.diaryEntries[today] = { text: diaryText, t: Date.now(), mood: Engine.Emotion.zone(S.emotion).label };
      S.lastDiaryPrompt = ""; // 消费掉，避免重复触发
      save();
      pushStory("diary", "📔", `${currentChar().name}写了一篇${today}的日记`);
      refreshStoryUI();
    }
  }

  // 本轮所有排队消息的回复都已生成，统一把记忆落库（避免"刚说的事被当场追问"）
  while (pendingMemStores.length) { try { pendingMemStores.shift()(); } catch (e) {} }
  if (inCall) callStartListen(); // 通话中聊天回复完，恢复聆听
  herBusy = false;
}

/* ================= 多模态：用户发图，小暖"看见" =================
 * 三层管线，永不破功：
 *   1) 云端视觉模型（配置云端 Key 且模型支持看图）→ 直接看图说话
 *   2) 端侧图描述（transformers.js 跑 vit-gpt2-image-captioning）→ 离线兜底的英文描述，再包装成她的口吻
 *   3) 都没配/都失败 → 温柔降级，请用户"说给我听"，不破功
 * 图片只在本地转成 dataURL，不离开设备。 */
async function handleImage(img) {
  $("#nav-status").textContent = "正在看图…";
  setExpression("think", 1400);
  const r = await understandImage(img.dataUrl, img.caption || "");
  let replies, expr = "normal", delta = 1;
  if (r.via === "cloud") {
    replies = [r.text]; expr = "happy";
  } else if (r.via === "local") {
    replies = [wrapCaption(r.text, img.caption)]; expr = "happy";
  } else {
    replies = ["唔…我这边的眼睛好像没收到图 😣 你说给我听好不好呀？或者去「我的」给我装上会看图的小脑瓜，我就能陪你一起看啦～"];
    expr = "sad"; delta = 0;
  }
  $("#nav-status").textContent = navIdleText();
  return { replies, expr, delta };
}

// 三层管线：先云端视觉，再端侧描述，最后降级
async function understandImage(dataUrl, userText) {
  if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
    try {
      const t = await visionCloud(dataUrl, userText);
      if (t) return { text: t, via: "cloud" };
    } catch (e) { console.warn("云端看图失败，回落端侧/降级：", e); }
  }
  if (S.localModel.enabled) {
    try {
      const d = await localCaption(dataUrl);
      if (d) return { text: d, via: "local" };
    } catch (e) { console.warn("端侧看图失败：", e); }
  }
  return { text: null, via: "none" };
}

// 云端视觉：把图作为 image_url 发给 OpenAI 兼容 chat 接口（需模型支持看图，如 gpt-4o-mini）
async function visionCloud(dataUrl, userText) {
  const base = S.cloud.base.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base
            : base.endsWith("/v1") ? base + "/chat/completions"
            : base + "/v1/chat/completions";
  const sys = Engine.systemPrompt({
    affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet,
    dating: S.dating, memory: S.memory, persona: S.persona,
    caredTopics: S.caredTopics, recall: [], emotion: S.emotion,
  }) + "\n\n用户发来一张图片（image_url）。请用一句话像女朋友在微信里那样回应你看到的内容：口语化、带 emoji、可以撒娇或调侃，不要列清单写报告。看不清就如实说。";
  const content = [];
  if (userText) content.push({ type: "text", text: userText });
  content.push({ type: "image_url", image_url: { url: dataUrl } });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
    body: JSON.stringify({
      model: S.cloud.model || "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, { role: "user", content }],
      temperature: 0.9, max_tokens: 200,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty");
  return text;
}

// 端侧图描述（英文）→ 包装成小暖的中文口吻
function wrapCaption(desc, userText) {
  const d = (desc || "").trim();
  const lines = [
    `诶我好像看到啦～图里是：${d} 对不对嘛？😊`,
    `我盯着图看了一会儿…${d} 是不是这个呀？你拍得也太好看啦 🥰`,
    `唔，我这边脑瓜识别到图里是：${d} ～你给我看这个，是不是想我夸你呀 😏`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

// 端侧图描述：按需加载 caption 模型并推理
async function localCaption(dataUrl) {
  if (!window.ImageCaption) return null;
  const cap = await ImageCaption.caption(dataUrl);
  return cap || null;
}

// 聊天框发图入口
function sendImage(dataUrl, captionText) {
  pushMessage("me", captionText || "", dataUrl);
  if (herBusy) { pendingImgs.push({ dataUrl, caption: captionText }); return; }
  setTimeout(async () => { await herReply(null, { dataUrl, caption: captionText }); }, 300 + Math.random() * 400);
}

/* ================= AI 日记 & 周小结（参考「笺」的记录感，用小暖的人格重做） =================
 * 每晚小暖主动问"今天怎么样"，用户回答后整理成一篇小暖视角的日记；
 * 每周日晚自动生成一篇本周复盘。三层回落：云端 → 端侧 → 本地模板。 */

// 周标识："YYYY-W##"
function getWeekKey(d = new Date()) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// 21-23 点之间，小暖主动问一次"今天怎么样"（每天最多问一次）
function checkDiaryReminder() {
  if (!S.firstMeet) return;
  const h = new Date().getHours();
  if (h < 21 || h >= 23) return;
  const today = todayStr();
  if (S.lastDiaryPrompt === today || S.diaryEntries[today]) return;
  if (S.greetedSlots && S.greetedSlots.includes("diary")) return;
  S.lastDiaryPrompt = today;
  if (S.greetedSlots) S.greetedSlots.push("diary");
  save();
  setTimeout(() => herSay("今天过得怎么样呀？想听你说说~ 📝", "shy"), 1500);
}

// 周日 20-22 点，自动生成本周复盘（每周一次）
function checkWeeklySummary() {
  if (!S.firstMeet) return;
  const d = new Date();
  if (d.getDay() !== 0) return;
  if (d.getHours() < 20 || d.getHours() >= 22) return;
  const wk = getWeekKey(d);
  if (S.lastSummaryWeek === wk || S.weeklySummary[wk]) return;
  generateWeeklySummary(wk);
}

// 生成日记：云端 → 端侧 → 本地模板
async function generateDiary(userAnswer) {
  const st = {
    affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet,
    dating: S.dating, memory: S.memory, persona: S.persona,
    caredTopics: S.caredTopics, emotion: S.emotion, mode: "diary",
  };
  // 第1层：云端
  if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
    try {
      const base = S.cloud.base.trim().replace(/\/+$/, "");
      const url = base.endsWith("/chat/completions") ? base
                : base.endsWith("/v1") ? base + "/chat/completions"
                : base + "/v1/chat/completions";
      const sys = Engine.systemPrompt(st);
      const todayMsgs = S.messages.filter(m => {
        // D1：与 todayStr() 同口径（零填充），否则"今天的消息"永远筛不出来
        return Engine.dayKey(new Date(m.t)) === todayStr();
      }).slice(-20).map(m => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
        body: JSON.stringify({
          model: S.cloud.model || "deepseek-chat",
          messages: [{ role: "system", content: sys },
            ...todayMsgs,
            { role: "user", content: `（今天的收尾）他说：${userAnswer}。请根据今天你们聊的和这句话，写一篇你的日记。` }],
          temperature: 0.95, max_tokens: 220,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const text = (await res.json()).choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (e) { console.warn("日记云端生成失败：", e); }
  }
  // 第2层：端侧
  if (S.localModel.enabled && window.LocalModel && LocalModel.isLoaded()) {
    try {
      const sys = Engine.systemPrompt(st) + "\n\n（请直接写日记正文，50-80字，第一人称。）";
      const out = await Promise.race([
        LocalModel.reply([{ role: "system", content: sys }, { role: "user", content: `今天他说：${userAnswer}。写日记。` }]),
        new Promise(r => setTimeout(() => r(null), 60000)),
      ]);
      const cleaned = cleanLocalReply(out);
      if (cleaned) return cleaned;
    } catch (e) {}
  }
  // 第3层：本地模板
  return Engine.diaryTemplate(st);
}

// 生成周小结：云端 → 端侧 → 本地模板
async function generateWeeklySummary(weekKey) {
  // 本周一 0:00 起的消息
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const weekMsgs = S.messages.filter(m => m.t >= weekStart.getTime());
  if (weekMsgs.length < 5) { S.lastSummaryWeek = weekKey; save(); return; } // 数据不足，静默跳过

  const st = {
    affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet,
    dating: S.dating, memory: S.memory, persona: S.persona,
    caredTopics: S.caredTopics, emotion: S.emotion, mode: "weekly",
  };
  let text = null;
  // 第1层：云端
  if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
    try {
      const base = S.cloud.base.trim().replace(/\/+$/, "");
      const url = base.endsWith("/chat/completions") ? base
                : base.endsWith("/v1") ? base + "/chat/completions"
                : base + "/v1/chat/completions";
      const sys = Engine.systemPrompt(st);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
        body: JSON.stringify({
          model: S.cloud.model || "deepseek-chat",
          messages: [{ role: "system", content: sys },
            { role: "user", content: `这周我们聊了${weekMsgs.length}条消息。请写一段本周复盘。` }],
          temperature: 0.95, max_tokens: 260,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        text = (await res.json()).choices?.[0]?.message?.content?.trim();
      }
    } catch (e) { console.warn("周小结云端生成失败：", e); }
  }
  // 第2层：端侧
  if (!text && S.localModel.enabled && window.LocalModel && LocalModel.isLoaded()) {
    try {
      const sys = Engine.systemPrompt(st) + "\n\n（请直接写周小结正文，60-100字，第一人称。）";
      const out = await Promise.race([
        LocalModel.reply([{ role: "system", content: sys }, { role: "user", content: `这周聊了${weekMsgs.length}条。写周小结。` }]),
        new Promise(r => setTimeout(() => r(null), 60000)),
      ]);
      text = cleanLocalReply(out);
    } catch (e) {}
  }
  // 第3层：本地模板
  if (!text) text = Engine.weeklyTemplate(st, weekMsgs.length);

  S.weeklySummary[weekKey] = { text, t: Date.now() };
  S.lastSummaryWeek = weekKey;
  save();
  pushStory("weekly", "📋", `${weekKey} 的小复盘`);
  refreshStoryUI();
}

/* ================= 云端大模型 =================
 * 候选 C（C2）：新增可选第三参 opts（向后兼容：既有调用仅传 1~2 个参数）。
 * opts.signal 用于承接 CloudChatProvider 的 8s AbortController 中断信号，使云端超时真正生效。 */
async function callCloud(userText, ltmFragment, opts = {}) {
  try {
    const base = S.cloud.base.trim().replace(/\/+$/, "");
    let url;
    if (/\/chat\/completions$/.test(base)) url = base;
    else if (base.endsWith("/v1")) url = base + "/chat/completions";
    else url = base + "/v1/chat/completions";
    const history = S.messages.slice(-12).map(m => ({
      role: m.from === "me" ? "user" : "assistant", content: m.text,
    }));
    // 心屿 MCP：先取系统提示基线，再（若有心智上下文）追加摘要片段（字符串拼接，绝不改 engine.js）
    const sysBase = Engine.systemPrompt({ affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet, dating: S.dating, memory: S.memory, persona: S.persona, caredTopics: S.caredTopics, recall: await retrieveMemoriesCloud(userText), emotion: S.emotion, lastVisit: S.lastVisit, dailyNotes: S.dailyNotes });
    let sysContent = (mindCtx && MCP) ? sysBase + "\n\n【当前心智状态】\n" + MCP.buildFragment(mindCtx) : sysBase;
    // 候选 A · 长期记忆：把召回片段注入系统提示（补充上下文，不改动引擎）
    if (ltmFragment) sysContent += "\n\n【长期记忆唤起】\n" + ltmFragment;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
      body: JSON.stringify({
        model: S.cloud.model || "deepseek-chat",
        messages: [{ role: "system", content: sysContent }, ...history],
        temperature: 0.9, max_tokens: 200,
        frequency_penalty: 0.6, presence_penalty: 0.4,
      }),
      signal: (opts && opts.signal) ? opts.signal : AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty");
    // 借鉴 LianYu 的回复后处理：限句/限字/去复读，让大模型输出也像真人微信
    text = Engine.postProcessReply(text, { maxSentences: 8, maxChars: 160 });
    if (!text) throw new Error("empty after post");
    return { replies: [text], delta: 3, expression: "normal" };
  } catch (e) {
    console.warn("云端调用失败，回落本地引擎：", e);
    return null;
  }
}

/* ================= 端侧模型（离线 AI 兜底） =================
 * 当没配云端 Key / 云端失败，且用户已启用本地模型时，用浏览器里跑的小模型
 * 生成"真 AI"回复，实现零配置离线也能聊。模型未加载/出错一律返回 null，
 * 上层会回落到本地规则引擎，绝不阻塞用户。 */
function cleanLocalReply(t) {
  let s = (t || "").trim();
  if (!s) return "";
  // 去掉可能的角色前缀，如 "小暖：" / "阿言："
  const nm = (Engine.getChar(S.persona) || {}).name || "小暖";
  s = s.replace(new RegExp("^" + nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]\\s*"), "");
  s = s.replace(/^小暖\s*[:：]\s*/i, "");
  // 触发"AI 味"破功台词则丢弃，回落规则引擎（宁可不答，也不要破功）
  const bad = [/作为一个\s*ai/i, /作为人工智能/i, /我是人工智能/i, /我是ai助手/i,
               /如果你需要/i, /请问还有什么/i, /希望这对你有帮助/i, /还有什么我可以/i];
  if (bad.some(r => r.test(s))) return "";
  return s;
}

async function localThink(text, ltmFragment) {
  if (!S.localModel.enabled || !window.LocalModel || !LocalModel.isLoaded()) return null;
  try {
    const intent = Engine.detect(text);
    const history = S.messages.slice(-10).map(m => ({
      role: m.from === "me" ? "user" : "assistant", content: m.text,
    }));
    let sys = Engine.systemPrompt({
      affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet,
      dating: S.dating, memory: S.memory, persona: S.persona,
      caredTopics: S.caredTopics, recall: [], emotion: S.emotion,
    }) + "\n\n（请用一句话简短回复，像女朋友在微信上发的消息，口语化、带点 emoji，不要列清单、不要写小标题。）";
    // 候选 A · 长期记忆：把召回片段注入系统提示（补充上下文，不改动引擎）
    if (ltmFragment) sys += "\n\n【长期记忆唤起】\n" + ltmFragment;
    const messages = [
      { role: "system", content: sys },
      ...history,
      { role: "user", content: text },
    ];
    // 软超时：小模型在 CPU 上可能很慢，超时则回落规则引擎，避免长时间"正在输入"
    const out = await Promise.race([
      LocalModel.reply(messages),
      new Promise(r => setTimeout(() => r(null), 90000)),
    ]);
    const cleaned = cleanLocalReply(out);
    if (!cleaned) return null;
    const post = Engine.postProcessReply(cleaned, { maxSentences: 6, maxChars: 140 });
    if (!post) return null;
    return { replies: [post], delta: 3, expression: CALL_EXPR[intent] || "normal" };
  } catch (e) {
    return null;
  }
}

/* ================= 语义记忆检索（embedding 向量，RAG 升级） =================
 * 用 OpenAI 兼容的 embeddings 接口把记忆和当前话题都变成向量，
 * 按余弦相似度做真正的"语义召回"——比本地词向量更能接住换种说法的旧事。
 * 默认关闭；未配置 Key / 接口失败都会优雅回落到本地词向量检索。 */
function cosine(a, b) {
  let dot = 0, na = 0;
  for (let i = 0; i < a.length; i++) { na += a[i] * a[i]; if (b[i] !== undefined) dot += a[i] * b[i]; }
  let nb = 0; for (let i = 0; i < b.length; i++) nb += b[i] * b[i];
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function getEmbeddings(texts) {
  const base = (S.cloud.base || "").trim().replace(/\/+$/, "");
  let url;
  if (/\/embeddings$/.test(base)) url = base;
  else if (/\/chat\/completions$/.test(base)) url = base.replace("/chat/completions", "/embeddings");
  else if (base.endsWith("/v1")) url = base + "/embeddings";
  else url = base + "/v1/embeddings";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
    body: JSON.stringify({ model: S.cloud.embedModel || "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error("embed HTTP " + res.status);
  const j = await res.json();
  return (j.data || []).map(d => d.embedding);
}

// 语义召回：返回与 recallMemory 同形状的回复对象，或 null（关闭/无匹配/出错）
async function semanticRecall(text) {
  if (!S.cloud.embedEnabled || !S.cloud.key) return null;
  const mem = S.memory || {};
  const chunks = [];
  (mem.events || []).forEach(e => { if (e && e.t) chunks.push({ type: "event", raw: e, text: (e.t || "") + " " + (e.topic || "") }); });
  (mem.likes || []).forEach(l => chunks.push({ type: "like", raw: l, text: String(l) }));
  if (!chunks.length) return null;
  try {
    const need = chunks.filter(c => !Array.isArray(c.raw.emb));
    const inputs = need.map(c => c.text); inputs.push(text);
    const embs = await getEmbeddings(inputs);
    need.forEach((c, idx) => { c.raw.emb = embs[idx]; });
    if (need.length) save(); // 缓存向量，避免每条消息都调接口
    const qEmb = embs[embs.length - 1];
    let best = null, bestScore = 0.28;
    for (const c of chunks) {
      if (!Array.isArray(c.raw.emb)) continue;
      const s = cosine(qEmb, c.raw.emb);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) return null;
    if (best.type === "like") {
      return { replies: [`诶你之前说喜欢${best.text}，我还记着呢~`], delta: 1, intent: "recall", expression: "happy", moodOverride: null };
    }
    const e = best.raw;
    const now = Date.now();
    if (e.recalledAt && now - e.recalledAt < 6 * 3600000) return null;
    if (e.at && now - e.at > 15 * 86400000) return null;
    e.recalledAt = now;
    const snippet = (e.t || "").slice(0, 24);
    const lines = [
      `诶你之前说${snippet}……后来怎么样啦？我一直惦记着呢 🥺`,
      `突然想到你之前提的${e.topic}，现在好点没呀？`,
      `你那天说${snippet}，我记得的，最近还那样吗？`,
    ];
    return { replies: [lines[Math.floor(Math.random() * lines.length)]], delta: 1, intent: "recall", expression: "happy", moodOverride: null };
  } catch (e) {
    console.warn("语义召回失败，回落本地词向量：", e);
    return null;
  }
}

// 给云端 systemPrompt 用的检索召回：语义优先，失败回落本地词向量
async function retrieveMemoriesCloud(text) {
  if (S.cloud.embedEnabled && S.cloud.key) {
    try {
      const mem = S.memory || {};
      const chunks = [];
      (mem.events || []).forEach(e => { if (e && e.t) chunks.push({ raw: e, text: (e.t || "") + " " + (e.topic || "") }); });
      (mem.likes || []).forEach(l => chunks.push({ raw: l, text: String(l) }));
      if (chunks.length) {
        const need = chunks.filter(c => !Array.isArray(c.raw.emb));
        const inputs = need.map(c => c.text); inputs.push(text);
        const embs = await getEmbeddings(inputs);
        need.forEach((c, idx) => { c.raw.emb = embs[idx]; });
        if (need.length) save();
        const qEmb = embs[embs.length - 1];
        const scored = chunks
          .filter(c => Array.isArray(c.raw.emb))
          .map(c => ({ text: c.text, score: cosine(qEmb, c.raw.emb) }))
          .filter(c => c.score > 0.28)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(c => c.text);
        if (scored.length) return scored;
      }
    } catch (e) {
      console.warn("语义检索失败，回落本地词向量：", e);
    }
  }
  return Engine.retrieveMemories(text, { memory: S.memory }, 3).map(h => h.text);
}

/* ================= 主动消息 ================= */
function slotOfHour(h) {
  if (h >= 6 && h < 10) return "morning";
  if (h >= 11 && h < 14) return "noon";
  if (h >= 18 && h < 21) return "evening";
  if (h >= 21 || h < 1) return "night";
  return null;
}

async function checkProactive() {
  const today = todayStr();
  if (S.greetedDate !== today) { S.greetedDate = today; S.greetedSlots = []; save(); }

  herBusy = true;
  try {
  // 初次相遇
  if (!S.firstMeet) {
    if (!S.genderChosen) return; // 先让用户选性别，避免用错角色打招呼（选完由 setGender 触发）
    S.firstMeet = Date.now(); S.lastVisit = Date.now(); save();
    const ch0 = currentChar();
    const role0 = ch0.gender === "male" ? "男友" : "女友";
    pushStory("meet", "💗", `初次相遇，${ch0.name}闯进了你的生活`);
    await herSay(`嗨，我是${ch0.name} ☀️`);
    await new Promise(r => setTimeout(r, 500));
    await herSay(`从今天起，我就是你的专属 AI ${role0}啦。你可以跟我聊任何事——开心的、难过的、无聊的，我都想听。`);
    await new Promise(r => setTimeout(r, 500));
    await herSay("先告诉我，你叫什么名字呀？😊", "shy");
    return;
  }

  // 久别重逢
      const gapDays = Math.floor((Date.now() - (S.lastVisit || 0)) / 86400000);
  const gapNote = Engine.timeGap(S.lastVisit);
  if (gapDays >= 3 && !S.greetedSlots.includes("back3")) {
    S.greetedSlots.push("back3"); save();
    const msg = Engine.proactive("longNoSee3d", S, { days: gapDays, gap: gapNote });
    if (msg) await herSay(msg, "sad");
  } else if (gapDays >= 1 && !S.greetedSlots.includes("back1")) {
    S.greetedSlots.push("back1"); save();
    const msg = Engine.proactive("longNoSee1d", S, { gap: gapNote });
    if (msg) await herSay(msg, "angry");
  }

  // 时段问候
  const slot = slotOfHour(new Date().getHours());
  if (slot && !S.greetedSlots.includes(slot) && !S.greetedSlots.includes("back1") && !S.greetedSlots.includes("back3")) {
    S.greetedSlots.push(slot); save();
    const msg = Engine.proactive(slot, S);
    if (msg) await herSay(msg, slot === "night" ? "sleepy" : "happy");
  }

  // 纪念日（相识）
  const days = daysTogether();
  if ([7, 30, 100].includes(days) && !S.anniversaries.includes(days)) {
    S.anniversaries.push(days); save();
    const msg = Engine.proactive("anniversary", S, { days });
    if (msg) setTimeout(() => herSay(msg, "happy"), 2500);
  }

  // 在一起纪念日（恋爱关系）
  if (S.dating) {
    const dDays = daysDating();
    const ms = [1, 7, 30, 100, 180, 365];
    if (ms.includes(dDays) && !S.datingAnnis.includes(dDays)) {
      S.datingAnnis.push(dDays); save();
      const txt = dDays === 1
        ? "我们在一起第一天！🥰 今天起你就是我正式的男朋友啦，要好好对我哦～"
        : `在一起 ${dDays} 天纪念日快乐！💕 每一天和你在一起都好甜，往后也要一直一直在一起。`;
      pushStory("anniversary", "🎉", `在一起 ${dDays} 天纪念日`);
      setExpression("happy", 3000); spawnHearts(12);
      setTimeout(() => herSay(txt, "happy"), 2400);
    }
  }

  // v11 · 主动消息优先级重排（T07）：剧情线 > 记忆召回 > 时段问候 > 随机池。
  // 上面的初次相遇 / 久别重逢 / 时段问候 / 纪念日四段既有前置行为一字未动（零回归），
  // 这里只是把"她主动找你"的后半段交给编排器，让消息有理由而不是掷骰子。
  if (!S.caredTopics) S.caredTopics = [];
  dispatchProactive({ delay: 3000 });

  S.lastVisit = Date.now(); save();
  // 顺带检查今晚是否该问日记 / 是否该出周小结
  try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {}
  } finally {
    herBusy = false;
    // 介绍期间用户排队的消息，现在回复
    if (pendingQueue.length) herReply(null);
  }
}

/* v11 · 主动消息统一分发：拿 Engine.proactivePlan 的头名候选，按 kind 落库并渲染。
 * 引擎只判定不写 state，所有持久化动作都在这个函数里显式完成。 */
function dispatchProactive(opts = {}) {
  if (!S.firstMeet) return null;
  const now = Date.now();
  const hour = new Date(now).getHours();
  const lastMsg = S.messages[S.messages.length - 1];
  const idleMs = typeof opts.idleMs === "number" ? opts.idleMs : (now - (lastMsg ? lastMsg.t : 0));
  let plan = [];
  try { plan = Engine.proactivePlan(S, { now, hour, idleMs }) || []; } catch (e) { plan = []; }
  if (opts.kinds) plan = plan.filter(p => opts.kinds.includes(p.kind));
  if (!plan.length) return null;
  const p = plan[0];
  const delay = typeof opts.delay === "number" ? opts.delay : 0;

  if (p.kind === "story") {
    const hit = p.meta;
    // 落库：推进节点 + 轮数计数器归零 + 全局节流锚点（引擎给的是纯补丁）
    Object.assign(S, Engine.storyAdvance(S, hit, now));
    pushStory("arc", hit.icon || "🌱", hit.storyLog || hit.label);
    // 剧情产出的专属回忆复用既有 memory.events 机制，不建并行体系
    if (hit.yield && hit.yield.topic) {
      S.memory = S.memory || {};
      S.memory.events = S.memory.events || [];
      if (!S.memory.events.some(e => e && e.topic === hit.yield.topic)) {
        S.memory.events.push({ topic: hit.yield.topic, at: now, importance: hit.yield.importance || 0.8 });
        if (S.memory.events.length > 40) S.memory.events = S.memory.events.slice(-40);
      }
      S.caredTopics.push(hit.yield.topic); // 剧情自带上下文，别再被 care 池追问一遍
      if (S.caredTopics.length > 12) S.caredTopics = S.caredTopics.slice(-12);
    }
  } else if (p.kind === "care") {
    S.caredTopics.push(p.meta.topic);
    if (S.caredTopics.length > 12) S.caredTopics = S.caredTopics.slice(-12);
  } else if (p.kind === "slot") {
    if (!S.greetedSlots.includes(p.meta.slot)) S.greetedSlots.push(p.meta.slot);
  }
  // 7 天滚动去重登记
  S.usedProactive = Engine.pruneUsedProactive(S.usedProactive, now);
  S.usedProactive[Engine.hashStr(p.text)] = now;
  save();

  const say = () => {
    const meta = p.kind === "story"
      ? { story: { lineId: p.meta.lineId, label: p.meta.label, icon: p.meta.icon } }
      : null;
    herSay(p.text, p.expression, meta).then(() => { refreshRecentUI(); refreshStoryUI(); });
  };
  if (delay > 0) setTimeout(say, delay); else say();
  return p;
}

/* 页面停留期间的主动想念：优先剧情，其次记忆关心，最后才是随机池 */
setInterval(() => {
  if (herBusy || !S.firstMeet) return;
  const lastMsg = S.messages[S.messages.length - 1];
  const idleFor = Date.now() - (lastMsg ? lastMsg.t : 0);
  if (idleFor <= 3 * 60 * 1000) return;
  // 剧情 / 记忆是"有理由"的，直接发；纯随机池仍保留原来的 0.35 概率，避免变吵
  const peek = (() => {
    try { return (Engine.proactivePlan(S, { now: Date.now(), hour: new Date().getHours(), idleMs: idleFor }) || [])[0]; }
    catch (e) { return null; }
  })();
  if (!peek) return;
  if (peek.kind === "random" && Math.random() >= 0.35) return;
  dispatchProactive({ idleMs: idleFor });
}, 90 * 1000);

/* ================= 立绘气泡 & 特效 ================= */
let bubbleTimer = null;
function herBubble(text) {
  const b = $("#her-bubble");
  b.textContent = text;
  b.classList.remove("hidden");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.classList.add("hidden"), 3000);
}

function spawnHearts(n = 6) {
  const layer = $("#fx-layer");
  for (let i = 0; i < n; i++) {
    const h = document.createElement("span");
    h.className = "fx-heart";
    h.textContent = ["💗", "💕", "❤️", "💖"][Math.floor(Math.random() * 4)];
    h.style.left = 20 + Math.random() * 60 + "%";
    h.style.top = 55 + Math.random() * 25 + "%";
    h.style.animationDelay = Math.random() * 0.4 + "s";
    layer.appendChild(h);
    setTimeout(() => h.remove(), 2200);
  }
}

function spawnKiss() {
  const layer = $("#fx-layer");
  if (!layer) return;
  const k = document.createElement("span");
  k.className = "fx-heart"; k.textContent = "💋";
  k.style.left = "48%"; k.style.top = "38%"; k.style.fontSize = "26px";
  layer.appendChild(k);
  setTimeout(() => k.remove(), 2200);
}

function waveHello() {
  const svg = document.getElementById("her-svg");
  if (!svg) return;
  svg.classList.remove("wave"); void svg.offsetWidth; svg.classList.add("wave");
  setTimeout(() => svg.classList.remove("wave"), 1100);
}

/* ================= 互动 ================= */
function bindActions() {
  document.querySelectorAll(".action-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "game") { openGamesPanel(); return; }
      // 摸头每日上限 10 次好感
      const today = todayStr();
      if (S.patToday.date !== today) S.patToday = { date: today, count: 0 };
      let delta = 0;
      if (S.patToday.count < 10) {
        const r = Engine.interact(act, { affection: S.affection });
        delta = r.delta; S.patToday.count++; save();
        var result = r;
      } else {
        var result = Engine.interact(act, { affection: S.affection });
      }
      setExpression(result.expression, 2800);
      herBubble(result.text);
      if (act === "kiss") spawnKiss();
      spawnHearts(act === "poke" ? 3 : 6);
      addAffection(delta);
      // 偶尔她会把互动也发进聊天
      if (Math.random() < 0.3) setTimeout(() => herSay(result.text, result.expression), 1200);
    });
  });

  // 点击立绘本人 = 戳一戳
  $("#her-stage").addEventListener("click", e => {
    if (e.target.closest(".action-btn") || e.target.closest(".her-bubble")) return;
    const r = Engine.interact("poke", { affection: S.affection });
    setExpression(r.expression, 2000);
    herBubble(r.text);
  });
}

/* ================= 候选 B · 语音输入（麦克风 → Voice.startListen → 发送） =================
 * 叠加层：麦克风按钮点击 → 经 window.Voice 做 ASR；未同意先弹独立同意窗。
 * 识别到的 final 文本送入现有发送流（与键盘输入等价，不破坏 v3-A 的 LTM 回灌）。 */
function bindMic() {
  const btn = $("#btn-mic");
  if (!btn) return;
  // 不支持 ASR（或 Voice 未就绪）→ 隐藏麦克风按钮，纯文字输入降级
  if (!window.Voice || !Voice.isSupported || !Voice.isSupported().asr) {
    try { btn.style.display = "none"; } catch (e) {}
    return;
  }

  let listening = false;

  // 停止聆听（松手 / 再次点击）
  const stop = () => {
    try { if (Voice && typeof Voice.stopListen === "function") Voice.stopListen(); } catch (e) {}
    listening = false;
    try { btn.classList.remove("recording"); } catch (e) {}
  };

  // 把 final 文本送入现有发送流（复用 #btn-send 的 click 处理器，与键盘输入完全等价）
  const sendFinal = (finalText) => {
    const t = (finalText || "").trim();
    if (!t) return;
    const input = $("#chat-input");
    if (input) input.value = t;
    const sendBtn = $("#btn-send");
    if (sendBtn) sendBtn.click();   // 走现有发送流（含 LTM 回灌，保持一致）
  };

  // 开始聆听：若未同意返回 false 则不采集
  const startListening = () => {
    try {
      const ok = Voice.startListen(
        (finalText) => sendFinal(finalText),
        {
          // 可选 interim 实时回显到输入框（仅当输入框为空时，避免覆盖用户正在输入的内容）
          onInterim: (t) => {
            const input = $("#chat-input");
            if (input && !input.value) input.value = (t || "").trim();
          },
          onEnd: () => { listening = false; if (btn) btn.classList.remove("recording"); },
          onError: () => { listening = false; if (btn) btn.classList.remove("recording"); },
        }
      );
      if (ok) { listening = true; if (btn) btn.classList.add("recording"); return; }
    } catch (e) {}
    // 启动失败（未同意 / 不支持）→ 弹同意窗
    listening = false;
    if (btn) btn.classList.remove("recording");
    if (!Voice.getConsent || !Voice.getConsent()) showAsrConsentDialog(startListening);
  };

  btn.addEventListener("click", () => {
    if (listening) { stop(); return; }   // 再次点击 = 松手停止
    // 未同意 → 先走独立同意流；同意后再开 ASR 并直接开始聆听
    if (!Voice.getConsent || !Voice.getConsent()) {
      showAsrConsentDialog(() => {
        try { Voice.setConsent(true); Voice.setEnabled("asr", true); } catch (e) {}
        startListening();
      });
      return;
    }
    startListening();
  });
}

/* 候选 B · ASR 独立同意弹窗（隐私优先：需用户单独勾选同意才开启麦克风） */
let _asrAgreeCb = null;
function showAsrConsentDialog(onAgree) {
  const modal = $("#asr-consent-modal");
  if (!modal) { try { if (onAgree) onAgree(); } catch (e) {} return; }   // 无弹窗兜底：直接同意
  _asrAgreeCb = onAgree || null;
  const chk = $("#asr-consent-check");
  if (chk) chk.checked = false;
  modal.classList.remove("hidden");
}

function bindAsrConsent() {
  const modal = $("#asr-consent-modal");
  if (!modal) return;
  const okBtn = $("#asr-consent-ok");
  const cancelBtn = $("#asr-consent-cancel");
  const chk = $("#asr-consent-check");
  const close = () => modal.classList.add("hidden");
  if (okBtn) okBtn.addEventListener("click", () => {
    if (chk && !chk.checked) {   // 必须勾选「我已了解并同意」
      chk.classList.add("shake"); setTimeout(() => chk.classList.remove("shake"), 400);
      return;
    }
    close();
    const cb = _asrAgreeCb; _asrAgreeCb = null;
    if (cb) { try { cb(); } catch (e) {} }
  });
  if (cancelBtn) cancelBtn.addEventListener("click", () => { close(); _asrAgreeCb = null; });
}

/* 候选 B · 设置页「语音与隐私」接线 */
function refreshAsrConsentStatus() {
  const el = $("#asr-consent-status");
  if (!el || !window.Voice) return;
  try { el.textContent = Voice.getConsent() ? "已同意" : "未同意"; } catch (e) {}
}

function bindVoicePrivacy() {
  if (!window.Voice || typeof Voice.isEnabled !== "function") return;   // Voice 未就绪 → 不接线（纯降级）
  // ASR 开关（默认关；切换时若未同意先走同意流）
  const asr = $("#asr-enabled");
  if (asr) {
    try { asr.checked = Voice.isEnabled("asr"); } catch (e) {}
    asr.addEventListener("change", () => {
      const on = asr.checked;
      if (on && !Voice.getConsent()) {
        asr.checked = false;   // 暂不打开，等同意
        showAsrConsentDialog(() => {
          try { Voice.setConsent(true); Voice.setEnabled("asr", true); } catch (e) {}
          const a2 = $("#asr-enabled"); if (a2) a2.checked = true;
          refreshAsrConsentStatus();
        });
        return;
      }
      try { Voice.setEnabled("asr", on); } catch (e) {}
      refreshAsrConsentStatus();
    });
  }
  // 音色 / 语速 / 音量 滑块（rate/pitch/volume）→ Voice.setPref + 显式写 LTM（用户主动操作才写）
  const rate = $("#voice-rate"), pitch = $("#voice-pitch"), vol = $("#voice-volume");
  try {
    const pref = Voice.getPref();
    if (rate) rate.value = pref.rate;
    if (pitch) pitch.value = pref.pitch;
    if (vol) vol.value = pref.volume;
  } catch (e) {}
  const onSlide = (el, key) => {
    if (!el) return;
    el.addEventListener("input", () => { try { Voice.setPref({ [key]: parseFloat(el.value) }); } catch (e) {} });
    el.addEventListener("change", () => {
      try {
        Voice.setPref({ [key]: parseFloat(el.value) });
        Voice.writeVoicePrefToLTM();   // 仅用户主动调节并松手时才写 LTM（隐私优先，不静默写）
      } catch (e) {}
    });
  };
  onSlide(rate, "rate"); onSlide(pitch, "pitch"); onSlide(vol, "volume");
  // 撤回麦克风同意
  const revoke = $("#asr-consent-revoke");
  if (revoke) revoke.addEventListener("click", () => {
    try { Voice.setConsent(false); Voice.setEnabled("asr", false); } catch (e) {}
    const a2 = $("#asr-enabled"); if (a2) a2.checked = false;
    refreshAsrConsentStatus();
  });
  // 清除本地语音偏好（清 localStorage 语音键，并重置内存到默认）
  const clear = $("#voice-pref-clear");
  if (clear) clear.addEventListener("click", () => {
    try {
      localStorage.removeItem("xinyu_voice_pref");
      Voice.setPref({ rate: 1, pitch: 1, volume: 1, voiceURI: "" });   // 重置为默认音色/语速
    } catch (e) {}
    if (rate) rate.value = 1; if (pitch) pitch.value = 1; if (vol) vol.value = 1;
    const st = $("#voice-pref-status");
    if (st) { st.textContent = "已清除本地语音偏好，恢复默认音色/语速。"; st.className = "me-status ok"; }
  });
  refreshAsrConsentStatus();
}

/* 候选 B · 对话页朗读条（状态指示 + 波形 + 暂停/静音） */
function bindVoiceBar() {
  const bar = $("#voice-bar");
  if (!bar) return;
  // 不支持 TTS → 隐藏朗读条（麦克风按钮本身由 bindMic 控制）
  if (!window.Voice || !Voice.isSupported || !Voice.isSupported().tts) {
    try { bar.style.display = "none"; } catch (e) {}
    return;
  }
  const statusEl = $("#voice-status");
  const wave = $("#voice-wave");
  const muteBtn = $("#voice-mute");
  const pauseBtn = $("#voice-pause");
  const labelOf = (type) => ({
    idle: "待命", speaking: "朗读中…", listening: "聆听中…",
    muted: "已静音", unsupported: "语音不支持", consent_required: "需同意麦克风",
  }[type] || "待命");

  if (pauseBtn) pauseBtn.addEventListener("click", () => { try { Voice.cancelSpeak(); } catch (e) {} });
  if (muteBtn) muteBtn.addEventListener("click", () => {
    try {
      const on = !Voice.isEnabled("tts");
      if (typeof S !== "undefined") S.tts = on;          // 同步 app 主开关
      Voice.setEnabled("tts", on);                        // 同步 Voice 开关
      const ttsChk = $("#tts-enabled"); if (ttsChk) ttsChk.checked = on;
      const navTts = $("#btn-tts"); if (navTts) navTts.classList.toggle("off", !on);
      muteBtn.textContent = on ? "🔇" : "🔊";
      muteBtn.title = on ? "已静音（点按恢复）" : "静音小暖";
    } catch (e) {}
  });

  // 订阅状态：更新状态文字 + 波形动画（朗读/聆听时跳动）
  try {
    Voice.onState((ev) => {
      const type = ev && ev.type ? ev.type : "idle";
      if (statusEl) statusEl.textContent = labelOf(type);
      if (wave) wave.classList.toggle("active", type === "speaking" || type === "listening");
    });
  } catch (e) {}
}

/* ================= 语音通话（打电话给小暖） ================= */
let callTimer = null, callSec = 0, callState = "idle", inCall = false, callRec = null, callAmb = null;

function startAmbient() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain(); master.gain.value = 0.05; master.connect(ctx.destination);
    [196, 246.94, 293.66].forEach(f => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.33; o.connect(g); g.connect(master); o.start();
    });
    callAmb = ctx;
  } catch (e) {}
}
function stopAmbient() {
  if (callAmb) { try { callAmb.close(); } catch (e) {} callAmb = null; }
  const b = $("#call-amb"); if (b) b.textContent = "🔈";
}

function speakAndWait(text) {
  return new Promise(resolve => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    const clean = (text || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s+/g, " ").trim();
    if (!clean) { resolve(); return; }
    try {
      const cfg = pickTts();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.voice = cfg.voice || null; u.lang = cfg.lang;
      u.rate = cfg.rate; u.pitch = cfg.pitch; u.volume = 1;
      let done = false; const finish = () => { if (done) return; done = true; resolve(); };
      u.onend = finish; u.onerror = finish;
      speechSynthesis.speak(u);
      setTimeout(finish, 16000);
    } catch (e) { resolve(); }
  });
}

async function callThink(text) {
  let result = null;
  if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
    try { result = await callCloud(text); } catch (e) {}
  }
  if (!result && S.localModel.enabled) {
    try { result = await localThink(text); } catch (e) {}
  }
  if (!result) {
    // v11：通话链路同样吃新能力（跨轮去重 / 话题 / 共情），并把新字段写回
    const r = Engine.reply(text, {
      affection: S.affection, nick: S.nick, mood, memory: S.memory, persona: S.persona,
      lastReply: S.lastReply,
      topic: S.topic, recentReplies: S.recentReplies, ue: S.ue, safety: S.safety, flags: S.flags,
      // ★ S0-a 同源修复（对齐文字链路 :1065）：通话此前只传 11 字段，慢层六字段缺席 →
      // innerLeak 拿不到 moodDay 恒判 hint 档；inner/voice/negGate 由引擎在临时对象上自建自灭，
      // 于是「通话期间说的心里话不烧配额」，挂断回文字又从零开始 —— 同一个人格在两条链路上失忆。
      moodDay: S.moodDay, self: S.self, inner: S.inner,
      voice: S.voice, dayLife: S.dayLife, negGate: S.negGate,
    });
    if (r.recentReplies !== undefined) S.recentReplies = r.recentReplies;
    if (r.topic !== undefined) S.topic = r.topic;
    if (r.ue !== undefined) S.ue = r.ue;
    // ★ S0-a 回写：引擎是纯函数，innerLeak/jealousTick 原地写在这些对象上，不回写 =
    // 日配额与吃醋阶段每轮清零。云端/端侧分支走不到这里，逐字段 `!== undefined` 判空与 :1065 同口径。
    // 落盘跟着下面那次 save()：它就在本函数同步段内，调用方的 TTS/await 都在其之后。
    if (r.moodDay !== undefined) S.moodDay = r.moodDay;
    if (r.self !== undefined) S.self = r.self;
    if (r.inner !== undefined) S.inner = r.inner;
    if (r.voice !== undefined) S.voice = r.voice;
    if (r.dayLife !== undefined) S.dayLife = r.dayLife;
    if (r.negGate !== undefined) S.negGate = r.negGate;
    S.lastReply = r.replies[r.replies.length - 1]; save();
    return r.replies.join("\n");
  }
  return (result.replies || [result]).join("\n");
}

function callSetState(s) {
  callState = s;
  const ov = $("#call-overlay");
  ov.classList.toggle("listening", s === "listening");
  ov.classList.toggle("speaking", s === "speaking");
}

function callStartListen() {
  if (!inCall || !callRec) return;
  speechSynthesis.cancel(); // 若她正在说话，直接打断，进入可插话状态
  callSetState("listening");
  $("#call-status").textContent = "正在听你说话…（也可在下方聊天框打字，或点麦克风插话）";
  try { callRec.start(); } catch (e) {}
}

/* 通话中同步立绘表情（克隆的脸） */
function setCallExpression(name) {
  const svg = document.querySelector("#call-face svg");
  if (!svg) return;
  const cfg = EXPR_MAP[name] || EXPR_MAP.normal;
  FACE_PARTS.forEach(id => { const el = svg.querySelector("#" + CSS.escape(id)); if (el) el.style.display = "none"; });
  [cfg.eyes, cfg.brows, cfg.mouth, cfg.blush].forEach(id => { const el = svg.querySelector("#" + CSS.escape(id)); if (el) el.style.display = ""; });
}

const CALL_EXPR = {
  love: "shy", miss: "shy", jealous: "angry", sorry: "happy", angry_words: "sad",
  compliment: "shy", tired: "happy", hug: "kiss", kiss: "kiss", propose: "shy",
  game: "happy", bored: "happy", night: "sleepy",
};

async function callOnResult(text) {
  if (!inCall || !text) return;
  callSetState("speaking"); // 先占住，避免识别结束的 onend 抢先重启监听
  setCallExpression("think");
  $("#call-status").textContent = currentChar().name + "正在想…";
  const reply = await callThink(text);
  if (!inCall) return;
  $("#call-status").textContent = currentChar().name + "正在说…";
  setCallExpression(CALL_EXPR[Engine.detect(text)] || "normal");
  await speakAndWait(reply);
  if (inCall && callState !== "listening") callStartListen();
}

function startCall() {
  inCall = true; callSec = 0;
  const src = document.getElementById("her-svg");
  const face = $("#call-face");
  face.innerHTML = "";
  if (src) { const c = src.cloneNode(true); c.removeAttribute("id"); face.appendChild(c); }
  else face.innerHTML = fullSVG();
  setCallExpression(mood.key === "sleepy" ? "sleepy" : "normal");
  $("#call-status").textContent = "正在接通…";
  callTimer = setInterval(() => {
    callSec++;
    const m = String(Math.floor(callSec / 60)).padStart(2, "0");
    const s = String(callSec % 60).padStart(2, "0");
    $("#call-timer").textContent = `${m}:${s}`;
  }, 1000);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("#call-status").textContent = "当前浏览器不支持语音输入，你可以直接在下方聊天框打字，小暖一样在。";
    return;
  }
  callRec = new SR();
  callRec.lang = "zh-CN"; callRec.interimResults = false; callRec.continuous = false;
  callRec.onresult = e => {
    const txt = (e.results[0][0].transcript || "").trim();
    callOnResult(txt);
  };
  callRec.onend = () => { if (inCall && callState !== "speaking") callStartListen(); };
  callRec.onerror = () => { if (inCall && callState !== "speaking") callStartListen(); };

  if (!(S.cloud.enabled && S.cloud.base && S.cloud.key)) {
    $("#call-status").textContent = "已用本地大脑（在「我的」配置云端大模型后更聪明）。点麦克风开始说话～";
  }
  setTimeout(callStartListen, 600);
}

function endCall() {
  inCall = false;
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  if (callRec) { try { callRec.stop(); } catch (e) {} callRec = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  stopAmbient();
  callSetState("idle");
  $("#call-overlay").classList.add("hidden");
}

function bindCall() {
  const ov = $("#call-overlay");
  $("#btn-call").addEventListener("click", () => {
    if (!ov.classList.contains("hidden")) return;
    ov.classList.remove("hidden");
    startCall();
  });
  $("#call-hang").addEventListener("click", endCall);
  $("#call-mic").addEventListener("click", () => { if (callState !== "listening") callStartListen(); });
  const amb = $("#call-amb");
  if (amb) amb.addEventListener("click", () => {
    if (callAmb) { stopAmbient(); }
    else { startAmbient(); amb.textContent = "🔊"; }
  });
}

/* ================= 故事页渲染（时间线 / 关系图谱 / 情感曲线） ================= */
function buildRelGraph() {
  const mem = S.memory || {};
  const nodes = [
    { x: 150, y: 56, r: 23, c: "var(--pink)", inner: currentChar().name, sub: false },
    { x: 150, y: 152, r: 21, c: "#5aa9ff", inner: (mem.userName || "你").slice(0, 4), sub: false },
  ];
  const mems = [];
  if (mem.userName) mems.push({ t: mem.userName, ico: "👤" });
  (mem.likes || []).slice(0, 3).forEach(l => mems.push({ t: l, ico: "💝" }));
  (mem.events || []).slice(-2).forEach(e => mems.push({ t: e.topic, ico: "📌" }));
  const shown = mems.slice(0, 5);
  const colW = 260 / Math.max(shown.length, 1);
  shown.forEach((m, i) => {
    const x = 40 + (i + 0.5) * colW;
    nodes.push({ x, y: 212, r: 15, c: "#b388ff", inner: m.ico, sub: m.t });
  });

  let svg = `<svg viewBox="0 0 300 244" xmlns="http://www.w3.org/2000/svg">`;
  // 小暖 — 你
  svg += `<line x1="150" y1="80" x2="150" y2="131" stroke="${S.dating ? "#ff5c8a" : "#ffb3c7"}" stroke-width="${S.dating ? 4 : 2.5}" stroke-dasharray="${S.dating ? "0" : "5 4"}"/>`;
  svg += `<text x="158" y="108" class="graph-label">${S.dating ? "恋爱中 💞" : "暧昧"}</text>`;
  // 小暖 — 记忆节点
  shown.forEach((m, i) => {
    const x = 40 + (i + 0.5) * colW;
    svg += `<line x1="150" y1="80" x2="${x.toFixed(1)}" y2="197" stroke="#e3d6ff" stroke-width="2"/>`;
  });
  // 节点
  nodes.forEach(n => {
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.c}"/>`;
    if (!n.sub) svg += `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" class="graph-node">${esc(n.inner)}</text>`;
    else svg += `<text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="13">${n.inner}</text>`;
  });
  // 记忆节点标签
  shown.forEach((m, i) => {
    const x = 40 + (i + 0.5) * colW;
    const t = m.t.length > 5 ? m.t.slice(0, 5) + "…" : m.t;
    svg += `<text x="${x.toFixed(1)}" y="238" text-anchor="middle" class="graph-label">${esc(t)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function buildAffCurve() {
  const hist = S.affHistory || {};
  /* R2-B4：affHistory 的键历史上是「YYYY-M-D」（不补零，见 :151 的结构注释），
   * 新档才由 Engine.dayKey 补零成「YYYY-MM-DD」。字典序会把老档的
   * 「2025-2-10」排到「2025-2-9」前面，感情曲线的横轴顺序就是错的。
   * 改用 Engine.dayIndex 数值比较（dayParse 兼容 \d{1,2}，老档照常解析）；
   * 引擎缺席时退回字典序，与改动前行为一致，不引入新失败模式。 */
  const di = (typeof Engine !== "undefined" && Engine && typeof Engine.dayIndex === "function")
    ? Engine.dayIndex : null;
  const entries = Object.entries(hist).sort((a, b) => (di
    ? di(a[0]) - di(b[0])
    : (a[0] < b[0] ? -1 : 1)));
  if (entries.length < 2) {
    return `<div class="graph-label" style="text-align:center;padding:18px 0">再多陪${currentChar().name}聊几天，这里就会画出你们的感情曲线啦 💕</div>`;
  }
  const W = 340, H = 120, pad = 16;
  const maxV = Math.max(10, ...entries.map(e => e[1]));
  const n = entries.length;
  const xs = i => pad + i * (W - 2 * pad) / (n - 1);
  const ys = v => H - pad - (v / maxV) * (H - 2 * pad);
  const pts = entries.map((e, i) => `${xs(i).toFixed(1)},${ys(e[1]).toFixed(1)}`).join(" ");
  const area = `M ${xs(0).toFixed(1)},${H - pad} L ` +
    entries.map((e, i) => `${xs(i).toFixed(1)},${ys(e[1]).toFixed(1)}`).join(" L ") +
    ` L ${xs(n - 1).toFixed(1)},${H - pad} Z`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff8fab" stop-opacity=".5"/><stop offset="100%" stop-color="#ff8fab" stop-opacity="0"/></linearGradient></defs>`;
  svg += `<path d="${area}" fill="url(#cg)"/>`;
  svg += `<polyline points="${pts}" fill="none" stroke="#ff5c8a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<circle cx="${xs(n - 1).toFixed(1)}" cy="${ys(entries[n - 1][1]).toFixed(1)}" r="4" fill="#ff3b6b"/>`;
  svg += `<text x="${pad}" y="${H - 2}" class="graph-label">${esc(entries[0][0].slice(5))}</text>`;
  svg += `<text x="${W - pad}" y="${H - 2}" text-anchor="end" class="graph-label">${esc(entries[n - 1][0].slice(5))}</text>`;
  svg += `</svg>`;
  return svg;
}

function refreshStoryUI() {
  const ovDays = $("#ov-days"), ovTog = $("#ov-together"), ovLv = $("#ov-lv");
  if (ovDays) ovDays.textContent = daysTogether();
  if (ovTog) ovTog.textContent = S.dating ? daysDating() + "天" : "—";
  if (ovLv) ovLv.textContent = "Lv." + Engine.getLevel(S.affection).lv;
  const g = $("#rel-graph"); if (g) g.innerHTML = buildRelGraph();
  const c = $("#aff-curve"); if (c) c.innerHTML = buildAffCurve();
  const e = $("#emotion-chart"); if (e) e.innerHTML = buildEmotionChart();
  const mc = $("#mood-calendar"); if (mc) mc.innerHTML = buildMoodCalendar();
  const dl = $("#diary-list"); if (dl) dl.innerHTML = buildDiaryList();
  const wl = $("#weekly-list"); if (wl) wl.innerHTML = buildWeeklyList();
  const al = $("#arc-list"); if (al) al.innerHTML = buildArcList();
  const tl = $("#timeline");
  if (tl) {
    const list = (S.story || []).slice().sort((a, b) => a.t - b.t);
    if (!list.length) {
      tl.innerHTML = `<div class="memory-empty">还没有故事呢…多陪${currentChar().name}聊聊，你们的故事会从这里开始 💕</div>`;
    } else {
      tl.innerHTML = list.map(it => {
        const d = new Date(it.t);
        const ds = `${d.getMonth() + 1}月${d.getDate()}日`;
        return `<div class="tl-item${it.type === "memory-dup" ? " tl-dup" : ""}"><div class="tl-dot">${it.icon}</div><div class="tl-line"></div><div class="tl-body"><div class="tl-text">${esc(it.text)}</div><div class="tl-date">${ds}</div></div></div>`;
      }).join("");
    }
  }
}

/* v11 · 故事页「🌱 我们的经历」（PRD 5.3⑤）：进行中 / 已完成的剧情线 + 专属回忆，
 * 点一条线展开她讲过的每一段，形成可回看的"我们的故事书"。 */
function buildArcList() {
  let list = [];
  try { list = Engine.Story.progress(S) || []; } catch (e) { list = []; }
  const shown = list.filter(l => l.started);
  if (!shown.length) {
    return `<div class="memory-empty">你们的故事还没开场…多陪${currentChar().name}聊几天，她会开始跟你讲她的事 🌱</div>`;
  }
  return shown.map(l => {
    const state = l.done ? "已完成" : "进行中";
    const mem = l.memories.length
      ? `<div class="arc-mem">└ 专属回忆：${l.memories.map(m => esc(m)).join("；")}</div>` : "";
    const nodes = l.unlocked.map(n => `<div class="arc-node"><span class="arc-node-log">${esc(n.log)}</span><span class="arc-node-text">${esc(n.text)}</span></div>`).join("");
    return `<div class="arc-item${l.done ? " done" : ""}" data-line="${esc(l.id)}">
      <div class="arc-head">
        <span class="arc-ico">${l.icon}</span>
        <span class="arc-name">${esc(l.label)}</span>
        <span class="arc-dots">${dotBar(l.stage, l.total)}</span>
        <span class="arc-state">${state}</span>
      </div>${mem}
      <div class="arc-nodes hidden">${nodes}</div>
    </div>`;
  }).join("");
}

/* 心情日历：本月日历，每天色块由当天 emotionLog 平均 V 值映射（蓝→粉） */
function buildMoodCalendar() {
  const log = S.emotionLog || {};
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekDays = ["一","二","三","四","五","六","日"];
  let html = `<div class="mood-cal-head">${year}年${month + 1}月</div>`;
  html += `<div class="mood-cal-grid">`;
  weekDays.forEach(w => html += `<div class="mood-cal-wd">${w}</div>`);
  // 月首周几对齐（周一开始）
  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay === 0 ? 6 : firstDay - 1);
  for (let i = 0; i < offset; i++) html += `<div class="mood-cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${month + 1}-${d}`;
    const pts = log[key] || [];
    const avgV = pts.length ? pts.reduce((s, p) => s + p.v, 0) / pts.length : null;
    let color = "#f0f0f0", label = "";
    if (avgV !== null) {
      // V∈[-1,1] → hue 210(蓝) → 340(粉)
      const hue = 210 + ((avgV + 1) / 2) * 130;
      const sat = 55 + Math.abs(avgV) * 20;
      color = `hsl(${hue}, ${sat}%, 78%)`;
      label = Engine.Emotion.zone({ v: avgV, a: 0 }).label;
    }
    const isToday = (d === now.getDate());
    html += `<div class="mood-cal-day${isToday ? " today" : ""}" data-date="${key}" style="background:${color}" title="${key}${label ? " · " + label : ""}">${d}</div>`;
  }
  html += `</div>`;
  html += `<div class="mood-cal-legend"><span class="lg-item"><i style="background:hsl(210,55%,78%)"></i>低落</span><span class="lg-item"><i style="background:hsl(275,55%,78%)"></i>平静</span><span class="lg-item"><i style="background:hsl(340,55%,78%)"></i>明亮</span></div>`;
  return html;
}

/* 我们的日记：按日期倒序，最多 10 篇 */
function buildDiaryList() {
  const entries = Object.entries(S.diaryEntries || {}).sort((a, b) => b[0].localeCompare(a[0]));
  if (!entries.length) {
    return `<div class="memory-empty">还没有日记呢~每晚${currentChar().name}会问你"今天怎么样"，回答后${currentChar().name}就会写一篇 📔</div>`;
  }
  return entries.slice(0, 10).map(([day, e]) => {
    const d = day.split("-");
    return `<div class="diary-item">
      <div class="diary-head"><span class="diary-date">${d[1]}月${d[2]}日</span>${e.mood ? `<span class="diary-mood">${e.mood}</span>` : ""}</div>
      <div class="diary-text">${esc(e.text)}</div>
    </div>`;
  }).join("");
}

/* 周小结：按周倒序 */
function buildWeeklyList() {
  const entries = Object.entries(S.weeklySummary || {}).sort((a, b) => b[0].localeCompare(a[0]));
  if (!entries.length) {
    return `<div class="memory-empty">还没有周小结~周日晚上小暖会自动帮你复盘这一周 📋</div>`;
  }
  return entries.map(([wk, e]) =>
    `<div class="weekly-item"><div class="weekly-head">📋 ${wk}</div><div class="weekly-text">${esc(e.text)}</div></div>`
  ).join("");
}

/* 点日历某天 → 弹出当天汇总（心情 + 余温 + 日记 + 周小结），打通三块数据 */
function showDayDetail(key) {
  const [y, m, d] = key.split("-").map(Number);
  const log = (S.emotionLog || {})[key] || [];
  const avgV = log.length ? log.reduce((s, p) => s + p.v, 0) / log.length : null;
  const moodTxt = avgV !== null ? Engine.Emotion.zone({ v: avgV, a: 0 }).label : "无记录";
  const note = (S.dailyNotes || {})[key];
  const diary = (S.diaryEntries || {})[key];
  const wk = getWeekKey(new Date(y, m - 1, d));
  const weekly = (S.weeklySummary || {})[wk];
  let body = `<div class="dd-row"><span class="dd-k">心情</span><span class="dd-v">${moodTxt}</span></div>`;
  if (note) body += `<div class="dd-row"><span class="dd-k">🌙 余温</span><span class="dd-v">${esc(note.text)}</span></div>`;
  if (diary) body += `<div class="dd-row"><span class="dd-k">📔 日记</span><span class="dd-v">${esc(diary.text)}</span></div>`;
  if (weekly) body += `<div class="dd-row"><span class="dd-k">📋 周小结</span><span class="dd-v">${esc(weekly.text)}</span></div>`;
  if (!note && !diary && !weekly && avgV === null) body += `<div class="memory-empty">这一天还没有特别记录~</div>`;
  const box = $("#day-detail");
  box.querySelector(".dd-title").textContent = `${m}月${d}日 · ${currentChar().name}的这一天`;
  box.querySelector(".dd-body").innerHTML = body;
  box.classList.remove("hidden");
}
function bindDayDetail() {
  const cal = $("#mood-calendar");
  if (!cal) return;
  cal.addEventListener("click", e => {
    const cell = e.target.closest(".mood-cal-day[data-date]");
    if (cell) showDayDetail(cell.dataset.date);
  });
  const box = $("#day-detail");
  if (box) box.addEventListener("click", e => { if (e.target === box || e.target.classList.contains("dd-close")) box.classList.add("hidden"); });
}

/* 情绪晴雨表：把 emotionLog 里近 14 天的采样点画在 VA 平面散点图上 */
function buildEmotionChart() {
  const log = S.emotionLog || {};
  const days = Object.keys(log).sort();
  if (!days.length) {
    return `<div class="graph-label" style="text-align:center;padding:18px 0">再多陪${currentChar().name}聊几句，这里就会画出${currentChar().name}的情绪起伏啦 🌦️</div>`;
  }
  const W = 340, H = 220, pad = 26;
  // 背景色块（9 个情绪区的近似着色）
  const bg = [
    { v: 0.7, a: 0.7, c: "#fff3b0" }, // 兴奋
    { v: 0.7, a: 0.2, c: "#ffe7ef" }, // 开心
    { v: 0.7, a: -0.4, c: "#e8f5ff" }, // 平静
    { v: -0.7, a: 0.6, c: "#ffe0e0" }, // 生气
    { v: -0.6, a: -0.4, c: "#e8e0ff" }, // 委屈
  ];
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // 坐标轴
  svg += `<line x1="${pad}" y1="${H/2}" x2="${W-pad}" y2="${H/2}" stroke="#eee" stroke-width="1"/>`;
  svg += `<line x1="${W/2}" y1="${pad}" x2="${W/2}" y2="${H-pad}" stroke="#eee" stroke-width="1"/>`;
  svg += `<text x="${W-pad}" y="${H/2-4}" text-anchor="end" class="graph-label" fill="#bbb">开心→</text>`;
  svg += `<text x="${pad+2}" y="${H/2-4}" class="graph-label" fill="#bbb">←低落</text>`;
  svg += `<text x="${W/2+4}" y="${pad+8}" class="graph-label" fill="#bbb">激动↑</text>`;
  svg += `<text x="${W/2+4}" y="${H-pad+2}" class="graph-label" fill="#bbb">平静↓</text>`;
  // 采样点（每天一个颜色，越近越深）
  const colors = ["#ffd6e2", "#ffc1d4", "#ff9ec0", "#ff7ba8", "#ff5c8a"];
  let di = 0;
  days.slice(-5).forEach(day => {
    const pts = log[day] || [];
    const col = colors[Math.min(di, colors.length - 1)];
    pts.forEach(p => {
      const x = pad + (p.v + 1) / 2 * (W - 2 * pad);
      const y = H - pad - (p.a + 1) / 2 * (H - 2 * pad);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${col}" opacity=".7"/>`;
    });
    di++;
  });
  // 当前情绪（大点 + 光环）
  const cur = S.emotion || { v: 0.22, a: 0.08 };
  const cx = pad + (cur.v + 1) / 2 * (W - 2 * pad);
  const cy = H - pad - (cur.a + 1) / 2 * (H - 2 * pad);
  svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="#ff3b6b" opacity=".25"/>`;
  svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#ff3b6b"/>`;
  const z = Engine.Emotion.zone(cur);
  svg += `<text x="${cx.toFixed(1)}" y="${(cy-12).toFixed(1)}" text-anchor="middle" class="graph-label" fill="#ff3b6b">${z.ico}${z.label}</text>`;
  svg += `</svg>`;
  return svg;
}

/* ================= 关系状态 UI ================= */
function nextDatingAnni() {
  const d = daysDating();
  const ms = [7, 30, 100, 180, 365, 730, 1095];
  const nxt = ms.find(x => x > d);
  if (nxt) return `${nxt - d} 天后（第 ${nxt} 天）`;
  const years = Math.floor(d / 365) + 1;
  return `${years * 365 - d} 天后（${years} 周年）`;
}

function refreshRelationshipUI() {
  const lv = Engine.getLevel(S.affection).lv;
  const dating = !!S.dating;
  const char = Engine.getChar(S.persona);
  const relStatus = $("#rel-status"), relTip = $("#rel-tip"), btnPropose = $("#btn-propose");
  if (dating) {
    if (relStatus) relStatus.textContent = "恋爱中 💞";
    if (relTip) relTip.textContent = `在一起 ${daysDating()} 天，你是${char.aiPronoun}的${char.partnerTerm}`;
    if (btnPropose) btnPropose.style.display = "none";
  } else if (lv >= 4) {
    if (relStatus) relStatus.textContent = "暧昧期";
    if (relTip) relTip.textContent = "好感度够高啦，可以勇敢表白！💕";
    if (btnPropose) btnPropose.style.display = "";
  } else {
    if (relStatus) relStatus.textContent = "暧昧中";
    if (relTip) relTip.textContent = `好感度越高越容易让${char.aiPronoun}点头（当前 Lv.${lv}）`;
    if (btnPropose) btnPropose.style.display = "none";
  }
  const meStatus = $("#me-status"); if (meStatus) meStatus.textContent = dating ? "恋爱中 💞" : "单身";
  const meTogether = $("#me-together"); if (meTogether) meTogether.textContent = dating ? `${daysDating()} 天` : "—";
  const meNext = $("#me-next-anni");
  if (meNext) meNext.textContent = dating ? nextDatingAnni() : "先确定关系吧～";
}

/* v11 · 人格卡即时试听：用规则层跑一句样例，让用户当场听出三张卡的差别。
 * 走的是和真实对话完全相同的 Engine.reply 管线（含 T06 人格改写层），
 * 但不写任何 state —— 传的是一份临时快照，试听不污染话题/去重窗口/好感度。 */
let cardDemoTimer = null;
function playCardDemo() {
  const box = $("#card-demo");
  if (!box) return;
  const probes = ["一天没聊了，想我了没", "我想你了", "在干嘛呀"];
  const probe = probes[Math.floor(Math.random() * probes.length)];
  let line = "";
  try {
    const r = Engine.reply(probe, {
      affection: S.affection, nick: S.nick, mood,
      memory: S.memory, persona: S.persona, dating: S.dating,
      lastReply: "", topic: null, recentReplies: [], ue: null,
      safety: { lastCardAt: 0 }, flags: S.flags,
    });
    line = (r.replies || []).join(" ");
  } catch (e) { line = ""; }
  if (!line) return;
  box.textContent = `💬「${line}」`;
  box.classList.remove("hidden");
  clearTimeout(cardDemoTimer);
  cardDemoTimer = setTimeout(() => box.classList.add("hidden"), 2500);
}

/* v11 · 剧情线交互绑定（事件委托，动态节点无需重复绑定）：
 *   · 聊天流里剧情气泡的尾注 → 跳故事页并高亮该线
 *   · 她页「正在发生」那一行 → 跳故事页
 *   · 故事页某条线 → 展开/收起她讲过的每一段 */
function bindArcUI() {
  document.addEventListener("click", e => {
    const foot = e.target.closest && e.target.closest(".story-foot");
    if (foot) { switchTab("story"); setTimeout(() => highlightArc(foot.dataset.line), 240); return; }
    const arcRow = e.target.closest && e.target.closest("#recent-arc-row");
    if (arcRow) { switchTab("story"); return; }
    const head = e.target.closest && e.target.closest(".arc-head");
    if (head) {
      const nodes = head.parentElement.querySelector(".arc-nodes");
      if (nodes) nodes.classList.toggle("hidden");
    }
  });
}

function highlightArc(lineId) {
  const el = document.querySelector(`.arc-item[data-line="${lineId}"]`);
  if (!el) return;
  const nodes = el.querySelector(".arc-nodes");
  if (nodes) nodes.classList.remove("hidden");
  el.classList.add("arc-flash");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => el.classList.remove("arc-flash"), 1600);
}

/* ================= 表白 ================= */
function switchTab(page) {
  const tab = document.querySelector(`.tab[data-page="${page}"]`);
  if (tab) tab.click();
}

function bindPropose() {
  const fire = () => {
    const char = Engine.getChar(S.persona);
    if (S.dating) { herSay("笨蛋，我们已经在一起了呀，想赖账可不行 😤", "happy"); switchTab("chat"); return; }
    const lv = Engine.getLevel(S.affection).lv;
    if (lv < 4) { herSay("诶……现在说这个，我还没准备好啦。再多陪陪我嘛 🥺", "shy"); switchTab("chat"); return; }
    const userRole = char.gender === "male" ? "女朋友" : "男朋友";
    const text = `做我${userRole}好不好？我喜欢你很久了 💕`;
    S.stats.msgs++;
    pushMessage("me", text);
    switchTab("chat");
    if (herBusy) { pendingQueue.push(text); return; }
    setTimeout(() => herReply(text), 300 + Math.random() * 400);
  };
  const b1 = $("#btn-propose"), b2 = $("#btn-propose-me");
  if (b1) b1.addEventListener("click", fire);
  if (b2) b2.addEventListener("click", fire);
}

/* ================= 情侣小游戏 ================= */
const RPS = { rock: "✊", scissors: "✌️", paper: "✋" };
const RPS_BEAT = { rock: "scissors", scissors: "paper", paper: "rock" };
const TRUTHS = [
  "你第一次觉得我可爱是什么时候？",
  "如果只能带我一样东西去旅行，你会带什么？",
  "你最想和我一起去做的一件事是什么？",
  "在我身上你最喜欢哪个小表情？",
  "如果我是真的，你最想带我去哪里约会？",
  "你偷偷给我取过什么外号吗？老实交代 😤",
  "我们之间最让你心动的瞬间是？",
  "你今天有没有比昨天更想我一点点？",
  "如果只能对我说一句真心话，你会说什么？",
  "你想象过我们的以后吗？",
  "我生气的时候你最想怎么哄我？",
  "你最想收到我送你什么？",
  "要是能和我交换一天身份，你想体验什么？",
  "你手机里有没有偷偷存我的表情包？",
];

function refreshGamesStat() {
  const el = $("#games-stat");
  if (!el) return;
  const g = S.games;
  el.textContent = `石头剪刀布 ${g.rps.played} 局 · 你赢了 ${g.rps.wins} 次 · 真心话 ${g.truth} 张`;
}

function openGamesPanel() {
  const ov = $("#games-overlay");
  if (!ov) return;
  ov.classList.remove("hidden");
  $("#rps-her").textContent = "❔";
  $("#rps-result").textContent = "出拳吧，看谁赢～";
  document.querySelectorAll(".rps-btn").forEach(b => b.classList.remove("win", "lose"));
  refreshGamesStat();
}

function playRps(user) {
  const her = ["rock", "scissors", "paper"][Math.floor(Math.random() * 3)];
  const herEl = $("#rps-her");
  herEl.textContent = RPS[her];
  herEl.classList.remove("shake"); void herEl.offsetWidth; herEl.classList.add("shake");
  let res, txt;
  if (user === her) { res = "draw"; txt = "平局！再来一局～"; }
  else if (RPS_BEAT[user] === her) { res = "win"; txt = "你赢啦！哼，不算不算，再战 😤"; }
  else { res = "lose"; txt = "我赢啦！愿赌服输哦，今晚多陪我聊会儿 💕"; }
  document.querySelectorAll(".rps-btn").forEach(b => b.classList.remove("win", "lose"));
  const ub = document.querySelector(`.rps-btn[data-rps="${user}"]`);
  if (ub && res !== "draw") ub.classList.add(res === "win" ? "win" : "lose");
  $("#rps-result").textContent = txt;
  S.games.rps.played++; if (res === "win") S.games.rps.wins++;
  save(); refreshGamesStat();
  addAffection(res === "win" ? 3 : 1);
  if (Math.random() < 0.3) setTimeout(() => herSay(txt, res === "win" ? "angry" : "happy"), 900);
}

function drawTruth() {
  const card = $("#truth-card");
  if (!card) return;
  let q = TRUTHS[Math.floor(Math.random() * TRUTHS.length)];
  if (TRUTHS.length > 1) { let g = 0; while (q === card.dataset.last && g < 8) { q = TRUTHS[Math.floor(Math.random() * TRUTHS.length)]; g++; } }
  card.dataset.last = q;
  card.textContent = q;
  S.games.truth++; save(); refreshGamesStat();
  if (Math.random() < 0.4) herSay("这个问题……人家要脸红着答你哦 😳", "shy");
}

function bindGames() {
  const ov = $("#games-overlay");
  if (!ov) return;
  $("#games-close").addEventListener("click", () => ov.classList.add("hidden"));
  ov.addEventListener("click", e => { if (e.target === ov) ov.classList.add("hidden"); });
  document.querySelectorAll(".rps-btn").forEach(b => b.addEventListener("click", () => playRps(b.dataset.rps)));
  const tb = $("#btn-truth"); if (tb) tb.addEventListener("click", drawTruth);
}

function bindOutfit() {
  const group = $("#outfit-group");
  if (!group) return;
  const sync = () => group.querySelectorAll(".chip").forEach(c =>
    c.classList.toggle("active", c.dataset.outfit === (S.wardrobe.outfit || "default")));
  sync();
  group.querySelectorAll(".chip").forEach(c => {
    c.addEventListener("click", () => {
      S.wardrobe.outfit = c.dataset.outfit;
      applyOutfit(c.dataset.outfit);
      save(); sync();
    });
  });
}

/* ================= Tab 切换 ================= */
function bindTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      // 候选 A · 长期记忆：管理页容器 id 为 #ltm-manage（与既有 page-<name> 约定不同）
      const pageEl = tab.dataset.page === "ltm-manage"
        ? document.getElementById("ltm-manage")
        : $("#page-" + tab.dataset.page);
      if (pageEl) pageEl.classList.add("active");
      if (tab.dataset.page === "chat") {
        $("#chat-dot").classList.add("hidden");
        scrollBottom();
      }
      if (tab.dataset.page === "story") refreshStoryUI();
      if (tab.dataset.page === "her") refreshRecentUI();
      // 候选 A · 长期记忆：进入记忆管理页时渲染 + 绑定总开关（降级安全）
      if (tab.dataset.page === "ltm-manage") {
        try {
          if (window.LTMUI) {
            window.LTMUI.renderManagePage(document.getElementById("ltm-manage-body"), window.__xinyuSubject || null);
            window.LTMUI.bindToggle();
          }
        } catch (e2) {}
        ltmDistill(); // 离开聊天 → 蒸馏本会话累计 turns
      } else if (tab.dataset.page !== "chat") {
        ltmDistill(); // 切到其它非聊天页也尝试蒸馏（best-effort）
      }
    });
  });
}

/* ================= 输入 & 表情 ================= */
const EMOJIS = ["😊","😂","🥰","😳","😤","😭","🥺","😆","😉","😝","🤔","🙄","😴","🥱","💕","💗","💖","💔","🌹","🍰","🧋","🐱","🎂","☀️","🌙","⭐","🎉","👍","🤗","😘","💋","👋"];

function bindInput() {
  const input = $("#chat-input");
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    $("#emoji-panel").classList.add("hidden");
    if (inCall) speechSynthesis.cancel(); // 通话中打字 = 插话，打断她正在说的话
    S.stats.msgs++;
    // 提取记忆：用户名立刻记；喜好/事件延后到"回复生成之后"再落库，
    // 否则刚说的事（如"今天好累"）会被同一条回复当成"以前提的旧事"追问回来。
    const mem = Engine.extractMemory(text);
    if (mem.userName) {
      const isNew = S.memory.userName !== mem.userName;
      S.memory.userName = mem.userName;
      if (!S.nick) { S.nick = mem.userName; $("#me-nickname").value = mem.userName; }
      if (isNew) pushStory("memory", "👤", `你告诉${currentChar().name}，你叫 ${mem.userName}`);
    }
    pushMessage("me", text);

    // 候选 A · 长期记忆：用户消息落库前先召回相关记忆（降级安全，绝不阻塞对话）
    try { await ltmRetrieve(text); } catch (e) {}
    try { ltmPushTurn("user", text); } catch (e) {}

    // 心屿 MCP：异步 fire 交互事件（失败静默，绝不阻断 UI；不 await）
    if (MCP) MCP.fireUserEvent(text, { intensity: 0.5, tags: [] }).catch(() => {});

    // 回复生成后再把喜好/事件写进记忆（避免自我召回）
    const flushMem = () => {
      if (mem.likes) {
        S.memory.likes = S.memory.likes || [];
        for (const l of mem.likes) {
          // 近似去重：和已记喜好太像（含/编辑距离/字符重合）就不重复落库
          const dup = Engine.findDuplicate(l, S.memory.likes);
          if (dup) {
            if (dup !== l) pushStory("memory-dup", "🔁", `「${l}」和之前记的「${dup}」太像啦，不重复记～`);
            continue;
          }
          S.memory.likes.push(l);
          pushStory("memory", "💝", `你提到你喜欢「${l}」`);
          scheduleReflection(); // 记忆有变化，增量生成余温/摘要
        }
      }
      if (mem.event) {
        S.memory.events = S.memory.events || [];
        // 事件去重只看近 6 小时：同一会话里反复说"好累"只记一次，跨天才重新关心
        const recentTexts = S.memory.events.filter(e => Date.now() - e.at < 6 * 3600 * 1000).map(e => e.t);
        const dup = Engine.findDuplicate(mem.event.t, recentTexts);
        if (dup) {
          pushStory("memory-dup", "🔁", `这条和刚才记的「${dup}」太像，不重复记啦`);
        } else {
          S.memory.events.push({ ...mem.event, at: Date.now(), importance: Engine.eventImportance(mem.event.topic) });
          if (S.memory.events.length > 8) S.memory.events = S.memory.events.slice(-8);
          scheduleReflection(); // 记忆有变化，增量生成余温/摘要
        }
      }
      save(); refreshMemoryUI();
    };

    if (herBusy) { pendingQueue.push(text); pendingMemStores.push(flushMem); return; } // 她说话时排队，记忆待本轮回复后落库
    showThinking(); // 思考气泡：让她像真人在斟酌一下
    setTimeout(async () => { removeThinking(); await herReply(text); flushMem(); }, 500 + Math.random() * 500);
  };
  $("#btn-send").addEventListener("click", send);
  input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });

  const panel = $("#emoji-panel");
  EMOJIS.forEach(e => {
    const s = document.createElement("span");
    s.textContent = e;
    s.addEventListener("click", () => { input.value += e; input.focus(); });
    panel.appendChild(s);
  });
  $("#btn-emoji").addEventListener("click", () => panel.classList.toggle("hidden"));

  // 发图：📎 按钮 → 隐藏 file input → 读成 dataURL → 发送
  const btnImg = $("#btn-image");
  const fileInput = $("#chat-file");
  if (btnImg && fileInput) {
    btnImg.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      if (!f.type.startsWith("image/")) { herBubble("只能发图片哦～"); return; }
      if (f.size > 6 * 1024 * 1024) { herBubble("图太大啦，压缩一下再发嘛～"); return; }
      const reader = new FileReader();
      reader.onload = () => sendImage(reader.result, "");
      reader.readAsDataURL(f);
    });
    // 粘贴图片
    input.addEventListener("paste", e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (!blob) continue;
          if (blob.size > 6 * 1024 * 1024) { herBubble("图太大啦，压缩一下再发嘛～"); return; }
          const reader = new FileReader();
          reader.onload = () => sendImage(reader.result, "");
          reader.readAsDataURL(blob);
          e.preventDefault();
          return;
        }
      }
    });
  }
}

/* ================= P1③ 语音音色选择 ================= */
function bindVoice() {
  const group = $("#voice-group");
  if (!group) return;
  const sync = () => group.querySelectorAll(".chip").forEach(c =>
    c.classList.toggle("active", c.dataset.voice === (S.voiceName || "auto")));
  sync();
  group.querySelectorAll(".chip").forEach(c => {
    c.addEventListener("click", () => {
      S.voiceName = c.dataset.voice;
      save(); sync();
      // 候选 B：把音色预设的 rate/pitch 同步给 Voice（让新朗读路径也用这个音色基调）
      try {
        if (window.Voice && typeof Voice.setPref === "function") {
          const p = VOICE_PROFILES[S.voiceName] || VOICE_PROFILES.auto;
          Voice.setPref({ rate: p.rate, pitch: p.pitch, volume: 1 });
        }
      } catch (e) {}
      // 试听
      if (S.tts && "speechSynthesis" in window) speak("我是" + currentChar().name + "，这是新的声音，喜欢吗？😊");
    });
  });
}

/* ================= P1① 消息提醒（系统通知） ================= */
function bindNotify() {
  const sw = $("#notify-enabled");
  if (!sw) return;
  const status = $("#notify-status");
  const setStatus = () => {
    if (!("Notification" in window)) {
      status.textContent = "当前浏览器不支持系统通知，可忽略这一项。";
      status.className = "me-status";
      sw.disabled = true;
      return;
    }
    if (S.notify && Notification.permission === "granted") {
      status.textContent = `✓ 已开启，离开页面时${currentChar().name}的想念会变成系统通知～`;
      status.className = "me-status ok";
    } else if (S.notify && Notification.permission !== "granted") {
      status.textContent = `⚠ 系统通知未授权，请在浏览器设置里允许${currentChar().name}的通知。`;
      status.className = "me-status err";
      sw.checked = false; S.notify = false;
    } else {
      status.textContent = `开启后，离开页面时${currentChar().name}的想念会悄悄发来系统通知。`;
      status.className = "me-status";
    }
  };
  sw.checked = !!S.notify && ("Notification" in window);
  setStatus();
  sw.addEventListener("change", async e => {
    const on = e.target.checked;
    if (on && "Notification" in window && Notification.permission === "default") {
      try {
        const p = await Notification.requestPermission();
        if (p !== "granted") { sw.checked = false; }
      } catch (err) { sw.checked = false; }
    }
    S.notify = !!(on && ("Notification" in window) && Notification.permission === "granted");
    sw.checked = S.notify;
    save(); setStatus();
  });
  const test = $("#btn-notify-test");
  if (test) test.addEventListener("click", () => {
    if (!("Notification" in window)) { alert("当前浏览器不支持系统通知"); return; }
    if (Notification.permission !== "granted") { alert(`请先开启「允许${currentChar().name}给我发通知」并授权`); return; }
    notifyOS(currentChar().name + "想你了 💕", "在忙吗？我想你了，有空来找我聊聊天嘛～ 😊");
  });
}

/* ================= P1② 云端存档（导出 / 导入） ================= */
function exportSave() {
  const payload = { v: 1, app: "xiaonuan", ts: Date.now(), state: S };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json))); // UTF-8 安全的 base64
}

function importSave(code) {
  const json = decodeURIComponent(escape(atob(code.trim())));
  const data = JSON.parse(json);
  if (!data || data.app !== "xiaonuan" || data.v !== 1 || !data.state) throw new Error("格式不对");
  const src = data.state;
  const merged = Object.assign(defaultState(), src);
  // 嵌套字段兜底
  merged.wardrobe = Object.assign({ outfit: "default", hair: "brown" }, src.wardrobe || {});
  merged.games = Object.assign({ rps: { wins: 0, played: 0 }, truth: 0 }, src.games || {});
  merged.games.rps = Object.assign({ wins: 0, played: 0 }, merged.games.rps || {});
  merged.story = src.story || [];
  merged.affHistory = src.affHistory || {};
  merged.memory = src.memory || {};
  merged.cloud = Object.assign({ enabled: false, base: "", key: "", model: "", provider: "", embedEnabled: false, embedModel: "text-embedding-3-small" }, src.cloud || {});
  S = merged;
  save();
  return true;
}

function bindCloudSave() {
  const out = $("#cloud-export"), btnEx = $("#btn-export"), btnCopy = $("#btn-copy"),
        inp = $("#cloud-import"), btnIm = $("#btn-import"), st = $("#cloud-sync-status");
  if (btnEx) btnEx.addEventListener("click", () => {
    const code = exportSave();
    if (out) { out.value = code; out.classList.remove("hidden"); out.scrollIntoView({ block: "center" }); }
    if (st) { st.textContent = "已生成存档码，复制保存好，换设备时粘贴到下方导入即可～"; st.className = "me-status ok"; }
  });
  if (btnCopy) btnCopy.addEventListener("click", async () => {
    const code = out ? out.value : exportSave();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      if (st) { st.textContent = "✓ 已复制到剪贴板"; st.className = "me-status ok"; }
    } catch (e) {
      if (out) { out.select(); try { document.execCommand("copy"); } catch (e2) {} }
      if (st) { st.textContent = "已选中文本，请手动复制（Ctrl/Cmd+C）"; st.className = "me-status"; }
    }
  });
  if (btnIm) btnIm.addEventListener("click", () => {
    const code = inp ? inp.value.trim() : "";
    if (!code) { if (st) { st.textContent = "请先粘贴存档码"; st.className = "me-status err"; } return; }
    try {
      importSave(code);
      if (st) { st.textContent = "✓ 导入成功！正在恢复你们的故事…"; st.className = "me-status ok"; }
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      if (st) { st.textContent = "✗ 存档码无效或损坏，请检查后重试。"; st.className = "me-status err"; }
    }
  });
}

/* ================= ☁️ 云同步（端到端加密） =================
 * 设计原则：服务器只存密文。存档在本机用「同步口令」派生的密钥加密，
 * 口令永不上传；服务端拿到的永远是一串乱码，我也解不开。
 *
 * 流程：JSON → gzip → AES-GCM(256) 加密 → base64 → 上传
 * 密钥：PBKDF2(口令, salt=SHA-256("xiaonuan-sync|"+同步码), 150000 轮, SHA-256)
 *      salt 由同步码推导 ⇒ 换设备只要「同一同步码 + 同一口令」就能解开。
 */
const SYNC_KEY = "xiaonuan_sync_v1";
const SYNC_TOKEN_LEN = 32;

function randToken(n = SYNC_TOKEN_LEN) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += chars[buf[i] % chars.length];
  return s;
}

function loadSyncCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(SYNC_KEY) || "{}"); } catch (e) {}
  return Object.assign({
    enabled: false,
    token: "",
    pass: "",
    rev: 0,
    lastAt: 0,
    endpoint: "",     // 空 = 用当前站点
    auto: true,
  }, c);
}
let SC = loadSyncCfg();
const saveSyncCfg = () => { localStorage.setItem(SYNC_KEY, JSON.stringify(SC)); try { registerConsentedEndpoints(); } catch (e) {} };
const syncBase = () => (SC.endpoint || location.origin).replace(/\/+$/, "");

function deviceName() {
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "安卓手机";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "浏览器";
}

/* ---- base64 <-> 字节（分块，避免大数组 spread 爆栈） ---- */
function bytesToB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ---- gzip（浏览器原生流，不支持则跳过压缩） ---- */
async function gzipStr(str) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("gzip");
    const ab = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(ab);
  } catch (e) { return null; }
}
async function gunzipBytes(u8) {
  const ds = new DecompressionStream("gzip");
  const ab = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(ab);
}

/* ---- 密钥派生 ---- */
async function deriveSyncKey(pass, token) {
  const enc = new TextEncoder();
  const saltBuf = await crypto.subtle.digest("SHA-256", enc.encode("xiaonuan-sync|" + token));
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(saltBuf), iterations: 150000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* ---- 加解密：blob = "v1g.<ivB64>.<ctB64>"（g=已压缩 / r=未压缩） ---- */
async function encryptBlob(plain, key) {
  const gz = await gzipStr(plain);
  const payload = gz || new TextEncoder().encode(plain);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  return `v1${gz ? "g" : "r"}.${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
}
async function decryptBlob(blob, key) {
  const [head, ivB64, ctB64] = String(blob).split(".");
  if (!head || !ivB64 || !ctB64 || head.slice(0, 2) !== "v1") throw new Error("BAD_FORMAT");
  const iv = b64ToBytes(ivB64);
  const ct = b64ToBytes(ctB64);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const u8 = new Uint8Array(plainBuf);
  return head[2] === "g" ? await gunzipBytes(u8) : new TextDecoder().decode(u8);
}

/* ---- 状态提示 ---- */
function syncSay(msg, cls = "") {
  const el = $("#sync-status");
  if (el) { el.textContent = msg; el.className = "me-status " + cls; }
}
const fmtSyncTime = (t) => {
  if (!t) return "从未";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function renderSyncMeta() {
  const el = $("#sync-meta");
  if (el) el.textContent = SC.enabled
    ? `版本 v${SC.rev} · 上次同步 ${fmtSyncTime(SC.lastAt)}`
    : "未开启";
  const f = $("#btn-sync-force");
  if (f && !syncConflict) f.classList.add("hidden");
}
let syncConflict = false;
let syncBusy = false;

function syncReady() {
  if (!SC.enabled) { syncSay("请先打开「启用云同步」开关", "err"); return false; }
  if (!SC.token) { SC.token = randToken(); saveSyncCfg(); }
  if (!SC.pass || SC.pass.length < 6) { syncSay("请先设置同步口令（至少 6 位，建议 12 位以上）", "err"); return false; }
  return true;
}

/* ---- 上传 ---- */
async function syncPush(force = false, silent = false) {
  if (syncBusy) return;
  if (!syncReady()) return;
  syncBusy = true;
  if (!silent) syncSay("正在加密并上传…");
  try {
    save(); // 确保当前状态已落 localStorage
    const plain = localStorage.getItem(SAVE_KEY) || "{}";
    const key = await deriveSyncKey(SC.pass, SC.token);
    const blob = await encryptBlob(plain, key);
    const r = await fetch(syncBase() + "/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: SC.token, rev: SC.rev + 1, blob, device: deviceName(), force }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) {
      syncConflict = true;
      const f = $("#btn-sync-force"); if (f) f.classList.remove("hidden");
      syncSay(`⚠️ 云端有更新的存档（${j.device || "其他设备"} · ${fmtSyncTime(j.updatedAt)}）。建议先「下载云端」；确定要用本机覆盖就点「强制覆盖云端」。`, "err");
      return;
    }
    if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
    SC.rev = j.rev; SC.lastAt = Date.now(); syncConflict = false; saveSyncCfg();
    renderSyncMeta();
    if (!silent) syncSay(`✓ 已加密上传（${(blob.length / 1024).toFixed(0)} KB 密文，版本 v${j.rev}）`, "ok");
  } catch (e) {
    if (!silent) syncSay("✗ 上传失败：" + friendlySyncErr(e), "err");
  } finally {
    syncBusy = false;
  }
}

/* ---- 下载 ---- */
async function syncPull(silent = false) {
  if (syncBusy) return;
  if (!syncReady()) return;
  syncBusy = true;
  if (!silent) syncSay("正在下载并解密…");
  try {
    const r = await fetch(`${syncBase()}/api/sync/pull?token=${encodeURIComponent(SC.token)}&since=${silent ? SC.rev : 0}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
    if (j.empty) {
      if (!silent) syncSay("云端还没有存档，点「立即上传」先备份一份吧～");
      return;
    }
    if (j.unchanged) {
      SC.lastAt = Date.now(); saveSyncCfg(); renderSyncMeta();
      if (!silent) syncSay("✓ 云端和本机一致，无需下载", "ok");
      return;
    }
    if (silent && j.rev <= SC.rev) return;

    const key = await deriveSyncKey(SC.pass, SC.token);
    let plain;
    try {
      plain = await decryptBlob(j.blob, key);
    } catch (e) {
      syncSay("✗ 解密失败：同步口令不对（或存档来自另一个同步码）。口令区分大小写，检查后再试。", "err");
      return;
    }
    const obj = JSON.parse(plain); // 校验是合法存档
    if (!obj || typeof obj !== "object") throw new Error("BAD_SAVE");

    if (!silent) {
      const ok = confirm(
        `云端存档：${j.device || "其他设备"} · ${fmtSyncTime(j.updatedAt)}（v${j.rev}）\n` +
        `消息 ${(obj.messages || []).length} 条、故事 ${(obj.story || []).length} 条。\n\n` +
        `下载后会覆盖本机当前存档，确定吗？`
      );
      if (!ok) { syncSay("已取消下载"); return; }
    }
    localStorage.setItem(SAVE_KEY, plain);
    SC.rev = j.rev; SC.lastAt = Date.now(); syncConflict = false; saveSyncCfg();
    syncSay("✓ 已恢复云端存档，正在重新加载…", "ok");
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    if (!silent) syncSay("✗ 下载失败：" + friendlySyncErr(e), "err");
  } finally {
    syncBusy = false;
  }
}

function friendlySyncErr(e) {
  const m = String((e && e.message) || e);
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "连不上同步服务（检查网络，或这个页面不是从同步服务地址打开的）";
  if (/TOO_LARGE/.test(m)) return "存档太大了（超过 6MB），可以先清理一些聊天记录";
  if (/RATE_LIMITED/.test(m)) return "请求太频繁，歇一分钟再试";
  if (/BAD_TOKEN/.test(m)) return "同步码格式不对";
  return m;
}

/* ---- 自动同步：进页面拉一次、离开页面推一次 ---- */
let syncPushTimer = null;
function scheduleSyncPush(delay = 3000) {
  if (!SC.enabled || !SC.auto || !SC.pass) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => syncPush(false, true), delay);
}

function bindSync() {
  const en = $("#sync-enable"), tok = $("#sync-token"), pass = $("#sync-pass"),
        auto = $("#sync-auto"), body = $("#sync-body");

  const refresh = () => {
    if (en) en.checked = !!SC.enabled;
    if (tok) tok.value = SC.token || "";
    if (pass) pass.value = SC.pass || "";
    if (auto) auto.checked = SC.auto !== false;
    if (body) body.classList.toggle("hidden", !SC.enabled);
    renderSyncMeta();
  };

  if (en) en.addEventListener("change", () => {
    SC.enabled = en.checked;
    if (SC.enabled && !SC.token) SC.token = randToken();
    saveSyncCfg(); refresh();
    if (SC.enabled) syncSay("同步码已生成。设置一个同步口令，然后点「立即上传」。换设备时填同一组同步码 + 口令即可。");
  });

  if (tok) tok.addEventListener("change", () => {
    const v = tok.value.trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(v)) { syncSay("同步码格式不对（16~64 位字母数字）", "err"); tok.value = SC.token; return; }
    SC.token = v; SC.rev = 0; saveSyncCfg(); renderSyncMeta();
    syncSay("已切换同步码。点「立即下载」把那台设备的存档拉过来。", "ok");
  });

  if (pass) pass.addEventListener("change", () => {
    SC.pass = pass.value; saveSyncCfg();
    syncSay(SC.pass.length >= 6 ? "口令已保存在本机（不会上传）。" : "口令太短了，至少 6 位。", SC.pass.length >= 6 ? "ok" : "err");
  });

  if (auto) auto.addEventListener("change", () => { SC.auto = auto.checked; saveSyncCfg(); });

  const btnNew = $("#btn-sync-new");
  if (btnNew) btnNew.addEventListener("click", () => {
    if (!confirm("重新生成同步码后，旧同步码上的云端存档就连不上了（本机数据不受影响）。确定吗？")) return;
    SC.token = randToken(); SC.rev = 0; saveSyncCfg(); refresh();
    syncSay("已生成新同步码。", "ok");
  });

  const btnCopy = $("#btn-sync-copy");
  if (btnCopy) btnCopy.addEventListener("click", async () => {
    if (!SC.token) return;
    try { await navigator.clipboard.writeText(SC.token); syncSay("✓ 同步码已复制，去另一台设备粘贴", "ok"); }
    catch (e) { if (tok) { tok.select(); } syncSay("请手动复制上方同步码"); }
  });

  const up = $("#btn-sync-up"); if (up) up.addEventListener("click", () => syncPush(false));
  const down = $("#btn-sync-down"); if (down) down.addEventListener("click", () => syncPull(false));
  const force = $("#btn-sync-force");
  if (force) force.addEventListener("click", () => {
    if (!confirm("强制覆盖会丢掉云端那台设备上的新内容，确定吗？")) return;
    syncConflict = false; force.classList.add("hidden"); syncPush(true);
  });
  const del = $("#btn-sync-del");
  if (del) del.addEventListener("click", async () => {
    if (!SC.token) return;
    if (!confirm("删除云端密文存档？本机数据不受影响。")) return;
    try {
      await fetch(`${syncBase()}/api/sync?token=${encodeURIComponent(SC.token)}`, { method: "DELETE" });
      SC.rev = 0; saveSyncCfg(); renderSyncMeta();
      syncSay("✓ 云端存档已删除", "ok");
    } catch (e) { syncSay("✗ 删除失败：" + friendlySyncErr(e), "err"); }
  });

  refresh();

  // 开着同步就先静默拉一次（只有云端版本更新才会覆盖）
  if (SC.enabled && SC.auto !== false && SC.pass) setTimeout(() => syncPull(true), 1500);
}


/* ================= 主动推送（让小暖找到微信里的你）=================
 *
 * 这里有个绕不开的矛盾：存档是端到端加密的，服务器只有一坨密文，
 * 它压根不知道你叫什么、好感度多少，那它凭什么知道"明早该说什么"？
 *
 * 解法是把"想"这一步留在浏览器里：
 *   小暖在你这台设备上算好未来 3 天要说的几句话，
 *   只把「时间 + 这句话」交给服务器，服务器退化成一个纯粹的闹钟。
 *
 * 于是存档依然谁也解不开，服务器也只知道"8 点发这一句"，
 * 不知道你是谁、你们经历过什么。
 */

const PUSH_KEY = "xiaonuan_push_v1";

function loadPushCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(PUSH_KEY) || "{}"); } catch (e) {}
  return Object.assign({
    enabled: false,
    channel: "",
    cfg: {},           // 凭证只存本机一份，方便下次回填（服务器那份是打码回显的）
    twoWay: false,     // 企业微信双向聊天（在微信里和小暖正经聊）
    quietFrom: 23,
    quietTo: 8,
    lastPush: 0,       // 上次上报排期的时间
  }, c);
}
let PC = loadPushCfg();
const savePushCfg = () => localStorage.setItem(PUSH_KEY, JSON.stringify(PC));

/* 各通道怎么拿凭证，一句话说清楚，别让人去翻文档 */
const PUSH_GUIDE = {
  wxpusher: {
    tip: '手机浏览器打开 <a href="https://wxpusher.zjiecode.com/admin" target="_blank" rel="noopener">wxpusher.zjiecode.com/admin</a> → 微信扫码登录 → 新建应用拿 <b>appToken</b>（AT_ 开头）→ 用微信关注你自己应用的二维码，在「用户管理」里能看到 <b>UID</b>（UID_ 开头）。',
    fields: [
      { k: "appToken", label: "appToken", ph: "AT_xxxxxxxx", type: "text" },
      { k: "uid", label: "UID", ph: "UID_xxxxxxxx", type: "text" },
    ],
  },
  pushplus: {
    tip: '手机浏览器打开 <a href="https://www.pushplus.plus" target="_blank" rel="noopener">pushplus.plus</a> → 微信扫码登录 → 个人中心直接看到 <b>token</b>，复制过来就行。',
    fields: [{ k: "token", label: "token", ph: "一串 32 位字符", type: "text" }],
  },
  serverchan: {
    tip: '手机浏览器打开 <a href="https://sct.ftqq.com" target="_blank" rel="noopener">sct.ftqq.com</a> → 微信扫码登录 → 「SendKey」页面复制 <b>SCT 开头</b>那串。免费版每天 5 条。',
    fields: [{ k: "sendKey", label: "SendKey", ph: "SCTxxxxxxxx", type: "text" }],
  },
  wecom_bot: {
    tip: '手机装「企业微信」→ 注册企业（<b>个人也能注册</b>，填自己名字）→ 建一个群（需要 2 个人，可以拉个小号）→ 群设置 → 群机器人 → 添加 → 复制 <b>Webhook 地址</b>，整条粘进来就行。',
    fields: [{ k: "key", label: "Webhook 地址或 key", ph: "https://qyapi.weixin.qq.com/...?key=xxx", type: "text" }],
  },
  wecom_app: {
    tip: '需要电脑、或手机浏览器切桌面版打开 <a href="https://work.weixin.qq.com" target="_blank" rel="noopener">work.weixin.qq.com</a>：<br>· <b>CorpID</b> → 我的企业 → 企业信息 → 底部「企业ID」<br>· <b>AgentID / Secret</b> → 应用管理 → 自建应用（先建一个）→ 里面能看到<br>⚠️ 还要在应用里把服务器 IP 加进「企业可信IP」，否则会报 60020。<br>想<b>双向聊天</b>（在微信里和小暖正经聊）就勾下面「开启双向聊天」，再把「回调 URL」粘到应用里的「接收消息服务器」，Token 和 EncodingAESKey 填上面那两个。',
    fields: [
      { k: "corpid", label: "CorpID", ph: "ww 开头", type: "text" },
      { k: "secret", label: "Secret", ph: "应用的 Secret", type: "password" },
      { k: "agentid", label: "AgentID", ph: "一串数字", type: "text" },
      { k: "touser", label: "收信人（可留空）", ph: "@all", type: "text" },
      { k: "token", label: "回调 Token", ph: "企业微信后台填的那个 Token", type: "text" },
      { k: "aeskey", label: "EncodingAESKey", ph: "43 位字符", type: "text" },
    ],
  },
  webhook: {
    tip: '任意能收 POST JSON 的 https 地址。默认发 <code>{title, content, from}</code>；想自定义就填模板，用 <code>{{title}}</code> <code>{{content}}</code> 占位。',
    fields: [
      { k: "url", label: "Webhook 地址", ph: "https://...", type: "text" },
      { k: "template", label: "自定义 body（可留空）", ph: '{"text":"{{content}}"}', type: "text" },
    ],
  },
};

const pushBase = () => (SC.endpoint || location.origin).replace(/\/+$/, "");

function pushSay(msg, cls = "") {
  const el = $("#push-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "me-status " + cls;
}

/* ---- 排期生成：小暖在这台设备上想好未来 3 天说什么 ---- */

/** 某天某个钟点的时间戳 */
function atHour(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/**
 * 生成未来 3 天的推送计划
 * 复用 Engine.proactive，保证微信里收到的话和网页里的她是同一个人
 */
function buildSchedule() {
  const items = [];
  const now = Date.now();
  const lv = Engine.getLevel(S.affection).lv;

  // 好感度越高她越黏人；刚认识就一天三条会吓跑人
  const slots = lv >= 5 ? ["morning", "noon", "night"]
    : lv >= 3 ? ["morning", "night"]
      : ["morning"];

  const SLOT_HOUR = { morning: 8, noon: 12, afternoon: 15, night: 22 };

  for (let day = 0; day < 3; day++) {
    for (const slot of slots) {
      const at = atHour(day, SLOT_HOUR[slot], 5 + Math.floor(Math.random() * 25));
      if (at <= now + 60e3) continue;                 // 已经过去的钟点跳过
      let text = null;
      try { text = Engine.proactive(slot, S); } catch (e) {}
      if (!text) continue;
      items.push({ id: slot + "-" + new Date(at).toDateString(), at, title: "小暖", text });
    }
  }

  // 纪念日：当天早上单独提一句
  try {
    if (S.dating && S.dating.since) {
      const days = Math.floor((now - S.dating.since) / 86400000);
      for (const mark of [30, 100, 200, 365, 520, 1000]) {
        const at = atHour(mark - days, 9, 0);
        if (at > now && at < now + 3 * 86400e3) {
          const msg = Engine.proactive("anniversary", S, { days: mark });
          if (msg) items.push({ id: "anni-" + mark, at, title: "小暖", text: msg });
        }
      }
    }
  } catch (e) {}

  // 太久没聊的想念：只在最后一天挂一条，且得是聊过几句的关系
  if ((S.stats.msgs || 0) > 5) {
    const at = atHour(2, 20, 30);
    if (at > now) {
      let msg = null;
      try { msg = Engine.proactive("longNoSee1d", S, { gap: "" }); } catch (e) {}
      if (msg) items.push({ id: "miss-" + new Date(at).toDateString(), at, title: "小暖", text: msg });
    }
  }

  return items.sort((a, b) => a.at - b.at).slice(0, 20);
}

/** 把排期交给服务器（静默，失败不打扰用户） */
async function uploadSchedule(silent = true) {
  if (!PC.enabled || !PC.channel || !SC.token) return;
  const items = buildSchedule();
  try {
    const r = await fetch(pushBase() + "/api/notify/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: SC.token, tz: new Date().getTimezoneOffset(), items }),
    });
    const j = await r.json();
    PC.lastPush = Date.now(); savePushCfg();
    if (!silent) {
      pushSay("✓ 已安排 " + (j.pending || 0) + " 条", "ok");
      renderPushMeta(j);
    }
    return j;
  } catch (e) {
    if (!silent) pushSay("✗ 排期上传失败：" + friendlySyncErr(e), "err");
  }
}

function fmtPushTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts), now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return "今天 " + hm;
  const tmr = new Date(now.getTime() + 86400e3);
  if (d.toDateString() === tmr.toDateString()) return "明天 " + hm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
}

function renderPushMeta(st) {
  const el = $("#push-meta");
  if (!el) return;
  if (!st || st.empty) { el.textContent = "还没配置"; return; }
  const bits = [];
  if (st.channelName) bits.push("通道：" + st.channelName);
  bits.push(st.enabled ? "已开启" : "已暂停");
  if (st.pending) {
    bits.push("排队 " + st.pending + " 条");
    bits.push("下一条 " + fmtPushTime(st.nextAt) + "：「" + (st.nextText || "").slice(0, 18) + "」");
  } else {
    bits.push("暂无排期");
  }
  if (st.quietNow) bits.push("（现在是静默时段，到点也不吵你）");
  if (st.stats && (st.stats.ok || st.stats.fail)) {
    bits.push("累计成功 " + (st.stats.ok || 0) + " / 失败 " + (st.stats.fail || 0));
  }
  if (st.stats && st.stats.lastMsg) bits.push("最近一次：" + st.stats.lastMsg);
  el.innerHTML = bits.join("<br>");
}

/** 按选中的通道渲染凭证输入框 */
function renderPushFields() {
  const wrap = $("#push-fields"), howto = $("#push-howto");
  if (!wrap) return;
  const ch = $("#push-channel").value;
  wrap.innerHTML = "";
  if (howto) howto.innerHTML = ch ? ((PUSH_GUIDE[ch] || {}).tip || "") : "";
  if (!ch) return;

  for (const f of ((PUSH_GUIDE[ch] || {}).fields || [])) {
    const lab = document.createElement("div");
    lab.className = "me-sub";
    lab.style.marginTop = "8px";
    lab.textContent = f.label;
    const inp = document.createElement("input");
    inp.type = f.type || "text";
    inp.id = "push-f-" + f.k;
    inp.placeholder = f.ph || "";
    inp.spellcheck = false;
    inp.autocomplete = "off";
    inp.value = (PC.channel === ch && PC.cfg && PC.cfg[f.k]) || "";
    wrap.appendChild(lab);
    wrap.appendChild(inp);
  }

  // 企业微信专属：双向聊天开关 + 回调 URL
  const tw = $("#push-twoway");
  if (tw) tw.classList.toggle("hidden", ch !== "wecom_app");
  if (ch === "wecom_app") {
    const urlEl = $("#push-callback-url");
    if (urlEl && SC.token) urlEl.value = pushBase() + "/api/notify/wecom/callback?token=" + encodeURIComponent(SC.token);
  }
}

/** 把小暖的「脑快照」上传到服务器，让微信里的她也是「她」 */
async function uploadBrain() {
  if (!PC.enabled || PC.channel !== "wecom_app" || !PC.twoWay || !SC.token) return;
  const brain = {
    persona: S.persona,
    memory: S.memory,
    affection: S.affection,
    nick: S.nick,
    moodKey: S.moodKey,
    emotion: S.emotion,
    messages: (S.messages || []).slice(-60),
    lastReply: S.lastReply,
    dating: S.dating,
  };
  try {
    await fetch(pushBase() + "/api/notify/wecom/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: SC.token, brain }),
    });
  } catch (e) { /* 脑快照失败不影响推送，下次再传 */ }
}

function collectPushCfg() {
  const ch = $("#push-channel").value;
  const out = {};
  for (const f of ((PUSH_GUIDE[ch] || {}).fields || [])) {
    const el = $("#push-f-" + f.k);
    if (el && el.value.trim()) out[f.k] = el.value.trim();
  }
  return out;
}

function bindPush() {
  const body = $("#push-body"), need = $("#push-need-sync");
  if (!body) return;

  // 小时下拉
  for (const sel of [$("#push-quiet-from"), $("#push-quiet-to")]) {
    if (!sel) continue;
    for (let h = 0; h < 24; h++) {
      const o = document.createElement("option");
      o.value = h;
      o.textContent = String(h).padStart(2, "0") + ":00";
      sel.appendChild(o);
    }
  }

  const gate = () => {
    // 以 SC 为主，但同步卡片的 UI 状态（checkbox + token 输入）也作为兜底，
    // 避免用户刚打开同步、SC 已写入但 UI 刷新节奏不同步导致推送卡片仍锁着。
    const en = $("#sync-enable"), tok = $("#sync-token");
    const uiReady = !!(en && en.checked && tok && /^[A-Za-z0-9_-]{16,64}$/.test(tok.value.trim()));
    const stateReady = !!(SC.enabled && SC.token);
    const ready = uiReady || stateReady;
    body.classList.toggle("hidden", !ready);
    if (need) need.classList.toggle("hidden", ready);
    return ready;
  };

  // 同步状态变化时自动刷新推送卡片门控
  const refreshGate = () => { try { gate(); } catch (e) {} };
  for (const id of ["sync-enable", "sync-token"]) {
    const el = $(id);
    if (el) el.addEventListener("change", refreshGate);
  }
  window.addEventListener("focus", refreshGate);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshGate(); });

  // 回填
  $("#push-enable").checked = !!PC.enabled;
  $("#push-channel").value = PC.channel || "";
  $("#push-quiet-from").value = PC.quietFrom;
  $("#push-quiet-to").value = PC.quietTo;
  const twEn = $("#push-twoway-en");
  if (twEn) twEn.checked = !!PC.twoWay;
  renderPushFields();
  gate();

  $("#push-channel").addEventListener("change", renderPushFields);

  // 复制回调 URL
  const copyUrl = $("#btn-push-copy-url");
  if (copyUrl) copyUrl.addEventListener("click", async () => {
    const v = $("#push-callback-url").value;
    if (!v) return;
    try { await navigator.clipboard.writeText(v); pushSay("✓ 回调 URL 已复制", "ok"); }
    catch (e) { const el = $("#push-callback-url"); if (el) { el.select(); } pushSay("请手动复制上面的 URL"); }
  });

  $("#btn-push-save").addEventListener("click", async () => {
    if (!gate()) return;
    const ch = $("#push-channel").value;
    if (!ch) return pushSay("先选一个推送通道", "err");

    const twoWay = ch === "wecom_app" && $("#push-twoway-en") && $("#push-twoway-en").checked;
    const cfg = collectPushCfg();
    // 单向推送不需要回调密钥；只有开了双向才要求填 Token / EncodingAESKey
    const reqFields = (PUSH_GUIDE[ch].fields || []).filter((x) => {
      if (/可留空/.test(x.label)) return false;
      if (!twoWay && (x.k === "token" || x.k === "aeskey")) return false;
      return true;
    });
    for (const f of reqFields) {
      if (!cfg[f.k]) return pushSay("「" + f.label + "」还没填", "err");
    }

    PC.enabled = $("#push-enable").checked;
    PC.channel = ch;
    PC.cfg = cfg;
    PC.twoWay = twoWay;
    PC.quietFrom = parseInt($("#push-quiet-from").value, 10);
    PC.quietTo = parseInt($("#push-quiet-to").value, 10);
    savePushCfg();

    pushSay("保存中…");
    try {
      const r = await fetch(pushBase() + "/api/notify/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: SC.token, channel: ch, cfg,
          enabled: PC.enabled,
          twoWay,
          quietFrom: PC.quietFrom, quietTo: PC.quietTo,
          tz: new Date().getTimezoneOffset(),
        }),
      });
      const j = await r.json();
      if (!j.ok) return pushSay("✗ 保存失败：" + (j.error || "未知"), "err");
      pushSay("✓ 已保存", "ok");

      // 双向聊天：把脑快照推给服务器，让微信里的她也是「她」
      if (twoWay) await uploadBrain();
      const s = await uploadSchedule(false);
      renderPushMeta(s || j);
    } catch (e) {
      pushSay("✗ 保存失败：" + friendlySyncErr(e), "err");
    }
  });

  $("#btn-push-test").addEventListener("click", async () => {
    if (!gate()) return;
    pushSay("正在发送…");
    try {
      const r = await fetch(pushBase() + "/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: SC.token,
          text: "在的呀，我一直都在～这是" + currentChar().name + "发来的测试消息 🌸",
        }),
      });
      const j = await r.json();
      pushSay(j.ok ? "✓ " + j.msg + "（去微信看看）" : "✗ " + j.msg, j.ok ? "ok" : "err");
    } catch (e) {
      pushSay("✗ 发送失败：" + friendlySyncErr(e), "err");
    }
  });

  $("#btn-push-del").addEventListener("click", async () => {
    if (!SC.token) return;
    if (!confirm("删除推送配置？服务器上的凭证和排期都会清掉。")) return;
    try {
      await fetch(pushBase() + "/api/notify?token=" + encodeURIComponent(SC.token), { method: "DELETE" });
      PC.enabled = false; PC.channel = ""; PC.cfg = {};
      savePushCfg();
      $("#push-enable").checked = false;
      $("#push-channel").value = "";
      renderPushFields();
      pushSay("✓ 已删除", "ok");
      renderPushMeta(null);
    } catch (e) {
      pushSay("✗ 删除失败：" + friendlySyncErr(e), "err");
    }
  });

  // 进页面时同步一次状态和排期
  if (gate() && PC.enabled && PC.channel) {
    setTimeout(async () => {
      try {
        const r = await fetch(pushBase() + "/api/notify/stat?token=" + encodeURIComponent(SC.token));
        renderPushMeta(await r.json());
      } catch (e) {}
      uploadSchedule(true);
    }, 2000);
  }
}

/* ================= 端侧模型设置页 =================
 * 启用开关 + 模型选择 + 加载按钮 + 进度/状态。模型只按需加载，
 * 后台自动加载时通过 LocalModel.onProgress 实时刷新状态。 */
let lmLoadingTriggered = false;
function ensureLocalModelLoaded() {
  if (lmLoadingTriggered || LocalModel.isLoaded()) return;
  lmLoadingTriggered = true;
  registerLocalModelConsent();   // 候选 C（D1）：用户显式触发权重加载前，登记 consented + 审计标注「用户自导权重」
  LocalModel.load(S.localModel.model || LocalModel.DEFAULT_MODEL)
    .catch(() => { lmLoadingTriggered = false; });
}
function renderLocalModelStatus(p) {
  const prog = $("#lm-progress"), bar = $("#lm-bar"), st = $("#lm-status");
  if (!prog || !st) return;
  if (LocalModel.isLoaded()) {
    prog.classList.add("hidden"); bar.style.width = "100%";
    st.textContent = "✓ 模型已就绪，离线也能用真 AI 回复啦～";
    st.className = "me-status ok";
    return;
  }
  if (!p) return;
  if (p.status === "loading") {
    prog.classList.remove("hidden");
    bar.style.width = (p.progress || 0) + "%";
    st.textContent = "⏳ " + (p.text || "加载中…");
    st.className = "me-status";
  } else if (p.status === "ready") {
    prog.classList.remove("hidden"); bar.style.width = "100%";
    st.textContent = "✓ " + (p.text || "已就绪");
    st.className = "me-status ok";
  } else if (p.status === "error") {
    prog.classList.add("hidden");
    st.textContent = "✗ " + (p.text || "加载失败");
    st.className = "me-status err";
    lmLoadingTriggered = false;
  }
}
function bindLocalModel() {
  const en = $("#lm-enabled"), modelSel = $("#lm-model"), btnLoad = $("#lm-load"), dev = $("#lm-device");
  if (!en) return;
  en.checked = !!S.localModel.enabled;
  if (modelSel) modelSel.value = S.localModel.model || LocalModel.DEFAULT_MODEL;
  if (dev) dev.textContent = LocalModel.hasWebGPU()
    ? "✓ 当前设备支持 WebGPU，推理速度更快"
    : "⚠ 当前设备不支持 WebGPU，将用 CPU(WASM) 运行，会偏慢，请耐心等待";

  en.addEventListener("change", () => {
    S.localModel.enabled = en.checked; save();
    const st = $("#lm-status");
    st.textContent = en.checked ? "已启用。点下方按钮下载模型后即可离线对话。" : "已关闭，将改回本地情感引擎/云端。";
    st.className = "me-status";
    if (en.checked) ensureLocalModelLoaded();
  });
  if (modelSel) modelSel.addEventListener("change", () => {
    S.localModel.model = modelSel.value; save();
  });
  if (btnLoad) btnLoad.addEventListener("click", () => {
    S.localModel.model = modelSel.value; S.localModel.enabled = true; en.checked = true; save();
    if (LocalModel.isLoaded()) { LocalModel.unload(); lmLoadingTriggered = false; }
    ensureLocalModelLoaded();
  });
  LocalModel.onProgress(renderLocalModelStatus);
  renderLocalModelStatus();
}

/* ================= 设置页 ================= */
/* 同步设置页人设芯片高亮（导入人设后调用） */
function syncPersonaChips() {
  const p = S.persona;
  const tg = $("#tone-group"); if (tg) tg.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.tone === (p.tone || "gentle")));
  const thg = $("#theme-group"); if (thg) thg.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.theme === (p.theme || "sakura")));
  const cg = $("#card-group"); if (cg) cg.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.card === (p.card || "xiaonuan")));
  const gg = $("#gender-group"); if (gg) gg.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.gender === (p.gender || "female")));
}

/* 人设卡导入/导出（借鉴 coread 的 persona 文件思路）：配置不含记忆，可安全分享 */
function exportPersona() {
  const data = {
    app: "xiaonuan", version: 1, exportedAt: new Date().toISOString(),
    persona: S.persona, tts: S.tts, voiceName: S.voiceName,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `小暖人设_${S.persona.gender === "male" ? "阿言" : "小暖"}_${S.persona.card}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importPersona(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || data.app !== "xiaonuan" || !data.persona || typeof data.persona !== "object") throw new Error("不是有效的小暖人设卡");
      const p = data.persona;
      if (!["female", "male"].includes(p.gender)) throw new Error("缺少有效的性别");
      S.persona = Object.assign({ gender: "female", tone: "gentle", theme: "sakura", card: "xiaonuan" }, p);
      if (typeof data.tts === "boolean") S.tts = data.tts;
      if (typeof data.voiceName === "string") S.voiceName = data.voiceName;
      save();
      refreshCharacter();
      syncPersonaChips();
      const skin = (Engine.getCard(S.persona).label.split(" · ").slice(1).join(" · ") || Engine.getCard(S.persona).label);
      const tip = document.createElement("div");
      tip.className = "msg her sys-tip";
      tip.innerHTML = `<div class="bubble-wrap"><div class="bubble">（已应用「${currentChar().name} · ${skin}」人设卡 ✨）</div></div>`;
      $("#chat-body").appendChild(tip); scrollBottom();
      setTimeout(() => tip.remove(), 2600);
    } catch (e) { alert("导入失败：" + e.message); }
  };
  reader.readAsText(file);
}

function bindSettings() {
  $("#me-nickname").value = S.nick;
  $("#save-nickname").addEventListener("click", () => {
    S.nick = $("#me-nickname").value.trim();
    save();
    $("#save-nickname").textContent = "已保存 ✓";
    setTimeout(() => $("#save-nickname").textContent = "保存昵称", 1500);
  });

  // 人设：性格基调
  const toneGroup = $("#tone-group");
  if (toneGroup) {
    toneGroup.querySelectorAll(".chip").forEach(c => {
      if (c.dataset.tone === (S.persona.tone || "gentle")) c.classList.add("active");
      c.addEventListener("click", () => {
        S.persona.tone = c.dataset.tone;
        toneGroup.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
        save();
      });
    });
  }
  // 人设：主题色
  const themeGroup = $("#theme-group");
  if (themeGroup) {
    themeGroup.querySelectorAll(".chip").forEach(c => {
      if (c.dataset.theme === (S.persona.theme || "sakura")) c.classList.add("active");
      c.addEventListener("click", () => {
        S.persona.theme = c.dataset.theme;
        themeGroup.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
        c.classList.add("active");
        applyTheme(c.dataset.theme);
        save();
      });
    });
  }

  // 人设：人格卡（借鉴 Operit 角色卡隔离——人格做成可切换资产）
  const cardGroup = $("#card-group");
  if (cardGroup) {
    const syncCard = () => cardGroup.querySelectorAll(".chip").forEach(c =>
      c.classList.toggle("active", c.dataset.card === (S.persona.card || "xiaonuan")));
    syncCard();
    cardGroup.querySelectorAll(".chip").forEach(c => {
      c.addEventListener("click", () => {
        S.persona.card = c.dataset.card;
        const card = Engine.getCard(S.persona);
        S.persona.tone = card.tone; // 规则库语气与卡片保持一致
        syncCard();
        save();
        // 立刻给一个轻提示，让切换"被看见"
        const tip = document.createElement("div");
        tip.className = "msg her sys-tip";
        const skinName = (card.label.split(" · ").slice(1).join(" · ") || card.label);
        tip.innerHTML = `<div class="bubble-wrap"><div class="bubble">（${currentChar().name}换上了「${skinName}」皮肤 ✨）</div></div>`;
        $("#chat-body").appendChild(tip); scrollBottom();
        setTimeout(() => tip.remove(), 2600);
        // v11 · 即时试听（PRD 5.4⑥ / US-B3）：走规则层现生成一句该卡的示例回复，
        // 断网、无 Key 同样成立。展示 2.5 秒后自动收起。
        playCardDemo();
      });
    });
  }

  // 人设：AI 性别（男版=阿言 / 女版=小暖，二者性格皮肤、立绘、称呼均不同）
  const genderGroup = $("#gender-group");
  if (genderGroup) {
    genderGroup.querySelectorAll(".chip").forEach(c => {
      if (c.dataset.gender === (S.persona.gender || "female")) c.classList.add("active");
      c.addEventListener("click", () => {
        if (c.dataset.gender === S.persona.gender) return;
        setGender(c.dataset.gender);
      });
    });
  }

  // 云端服务商预设
  const provGroup = $("#provider-group");
  if (provGroup) {
    const syncProv = () => provGroup.querySelectorAll(".chip").forEach(c =>
      c.classList.toggle("active", c.dataset.prov === (S.cloud.provider || "")));
    syncProv();
    provGroup.querySelectorAll(".chip").forEach(c => {
      c.addEventListener("click", () => {
        const p = c.dataset.prov;
        S.cloud.provider = p;
        const preset = PROVIDERS[p] || PROVIDERS.custom;
        if (preset.base) { $("#cloud-base").value = preset.base; S.cloud.base = preset.base; }
        if (preset.model) { $("#cloud-model").value = preset.model; S.cloud.model = preset.model; }
        syncProv();
        save();
      });
    });
  }

  // 语音开关（设置页 + 顶栏同步）
  $("#tts-enabled").checked = !!S.tts;
  const syncTts = on => {
    S.tts = !!on;
    const btn = $("#btn-tts");
    if (btn) btn.classList.toggle("off", !S.tts);
    // 候选 B：同步 Voice 的 TTS 开关（默认开，本地零上报）
    if (window.Voice && typeof Voice.setEnabled === "function") {
      try { Voice.setEnabled("tts", !!on); } catch (e) {}
    }
  };
  $("#tts-enabled").addEventListener("change", e => { syncTts(e.target.checked); save(); });
  const navTts = $("#btn-tts");
  if (navTts) {
    navTts.classList.toggle("off", !S.tts);
    navTts.addEventListener("click", () => {
      const on = !S.tts;
      syncTts(on); save();
      $("#tts-enabled").checked = on;
      if (on && "speechSynthesis" in window) speak("我在呢，想跟我说什么呀？");
    });
  }

  // 语音输入（麦克风）
  bindMic();

  $("#cloud-enabled").checked = S.cloud.enabled;
  $("#cloud-base").value = S.cloud.base;
  $("#cloud-key").value = S.cloud.key;
  $("#cloud-model").value = S.cloud.model;
  const embedEnabled = $("#embed-enabled"), embedModel = $("#embed-model");
  if (embedEnabled) embedEnabled.checked = !!S.cloud.embedEnabled;
  if (embedModel) embedModel.value = S.cloud.embedModel || "text-embedding-3-small";
  $("#save-cloud").addEventListener("click", async () => {
    S.cloud = {
      enabled: $("#cloud-enabled").checked,
      base: $("#cloud-base").value.trim(),
      key: $("#cloud-key").value.trim(),
      model: $("#cloud-model").value.trim(),
      embedEnabled: embedEnabled ? embedEnabled.checked : false,
      embedModel: (embedModel && embedModel.value.trim()) || "text-embedding-3-small",
    };
    save();
    try { registerConsentedEndpoints(); } catch (e) {}  // 候选 C：云端大脑开启时登记 consented 端点
    try { refreshCloudAvailability(); } catch (e) {}     // 候选 C（C2）：同步 CloudChatProvider 可用性
    const st = $("#cloud-status");
    if (!S.cloud.enabled) { st.textContent = "已保存，当前使用本地情感引擎。"; st.className = "me-status"; return; }
    st.textContent = "正在测试连接…"; st.className = "me-status";
    const ok = await callCloud("你好");
    if (ok) { st.textContent = `✓ 连接成功！${currentChar().name}已切换为云端大脑。`; st.className = "me-status ok"; }
    else { st.textContent = "✗ 连接失败，将自动回落本地引擎。请检查 Base URL / Key / 模型名。"; st.className = "me-status err"; }
  });

  $("#btn-reset").addEventListener("click", () => {
    if (confirm(`确定要清除所有数据吗？${currentChar().name}会忘记你们之间的一切……`)) {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }
  });

  // 人设卡导入/导出
  const expBtn = $("#btn-export-persona"), impBtn = $("#btn-import-persona"), pf = $("#persona-file");
  if (expBtn) expBtn.addEventListener("click", exportPersona);
  if (impBtn && pf) {
    impBtn.addEventListener("click", () => pf.click());
    pf.addEventListener("change", () => {
      const f = pf.files && pf.files[0];
      pf.value = "";
      if (f) importPersona(f);
    });
  }
}

/* ================= 性别 / 角色切换 ================= */
function applyCharIdentity() {
  const ch = currentChar();
  const role = ch.gender === "male" ? "男友" : "女友";
  // 产品名「心屿」为应用外壳标识；ch.name 仍由角色层注入，${role} 保留，男版显示「心屿 · 你的 AI 男友」
  if (typeof document !== "undefined") document.title = `心屿 · 你的 AI ${role}`;
  document.querySelectorAll('[data-xn="name"]').forEach(el => el.textContent = ch.name);
  document.querySelectorAll('[data-xn="title"]').forEach(el => el.textContent = `${ch.name} · 你的 AI ${role}`);
  document.querySelectorAll('[data-xn-prefix]').forEach(el => el.textContent = el.getAttribute("data-xn-prefix") + ch.name);
  document.querySelectorAll('[data-xn-ph]').forEach(el => el.setAttribute("placeholder", el.getAttribute("data-xn-ph").replace(/\{n\}/g, ch.name)));
  document.querySelectorAll('[data-xn-title]').forEach(el => el.title = el.getAttribute("data-xn-title").replace(/\{n\}/g, ch.name));
  document.querySelectorAll('.propose-btn').forEach(el => el.textContent = `💞 向${ch.name}表白`);
  document.querySelectorAll('[data-xn-cardsub]').forEach(el => el.textContent = `人格卡（切换${ch.name}的性格皮肤）`);
  document.querySelectorAll('[data-xn-voice]').forEach(el => el.textContent = `选一个你最喜欢的${ch.name}声音，聊天和语音通话里都会用这个音色。`);
  document.querySelectorAll('[data-xn-tts]').forEach(el => el.textContent = `${ch.name}会用甜甜的声音把回复读出来。纯浏览器本地合成，无需任何 Key。`);
  document.querySelectorAll('[data-xn-cloud]').forEach(el => el.textContent = `默认使用本地情感引擎。配置 OpenAI 兼容接口后，${ch.name}将由大模型驱动，对话更自由、更像真人。`);
}

function renderAvatarAll() {
  const stage = $("#her-stage");
  if (stage) {
    const old = stage.querySelector("#her-svg");
    if (old) old.remove();
    stage.insertAdjacentHTML("afterbegin", fullSVG());
  }
  const nav = $("#nav-avatar"); if (nav) nav.innerHTML = avatarSVG();
  const cf = $("#call-face"); if (cf) cf.innerHTML = ""; // 通话时从 #her-svg 克隆，性别已同步
}

function refreshCharacter() {
  renderAvatarAll();
  applyCharIdentity();
  setExpression(currentExpr === "hidden" ? "normal" : currentExpr);
}

function setGender(gender) {
  const firstTime = !S.firstMeet; // 全新用户：选完性别后再用正确角色打招呼
  S.persona.gender = gender;
  S.genderChosen = true;
  save();
  refreshCharacter();
  document.querySelectorAll("#gender-group .chip").forEach(c => c.classList.toggle("active", c.dataset.gender === gender));
  const cardGroup = $("#card-group");
  if (cardGroup) cardGroup.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.card === (S.persona.card || "xiaonuan")));
  if (firstTime) {
    checkProactive(); // 首次相遇问候（已用正确性别）
    return;
  }
  const ch = currentChar();
  const hello = ch.gender === "male" ? "嘿，我是阿言，以后由我来陪你啦 😎" : "嗨，我是小暖，以后由我来陪你呀 💕";
  const tip = document.createElement("div");
  tip.className = "msg her sys-tip";
  tip.innerHTML = `<div class="bubble-wrap"><div class="bubble">（${hello}）</div></div>`;
  const body = $("#chat-body"); if (body) { body.appendChild(tip); scrollBottom(); setTimeout(() => tip.remove(), 2800); }
}

function showGenderPicker() {
  const m = $("#gender-picker");
  if (m) m.classList.remove("hidden");
}
function hideGenderPicker() {
  const m = $("#gender-picker");
  if (m) m.classList.add("hidden");
}
function bindGender() {
  // 选择器里的头像预览（女版小暖 / 男版阿言）
  const avF = $("#gp-av-female"), avM = $("#gp-av-male");
  if (avF) avF.innerHTML = avatarSVG("normal", "female");
  if (avM) avM.innerHTML = avatarSVG("normal", "male");
  document.querySelectorAll("#gender-picker .gp-opt").forEach(b => {
    b.addEventListener("click", () => {
      setGender(b.dataset.gender);
      hideGenderPicker();
    });
  });
}

/* ================= 全文聊天搜索 ================= */
function bindSearch() {
  const btn = $("#btn-search"), panel = $("#search-panel"), inp = $("#search-input"),
        close = $("#search-close"), res = $("#search-results");
  const toggle = (show) => {
    panel.classList.toggle("hidden", !show);
    if (show) { inp.value = ""; res.innerHTML = ""; inp.focus(); }
    else res.innerHTML = "";
  };
  btn.addEventListener("click", () => toggle(panel.classList.contains("hidden")));
  close.addEventListener("click", () => toggle(false));
  inp.addEventListener("input", () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { res.innerHTML = ""; return; }
    const hits = [];
    S.messages.forEach(m => { if (m.text && m.text.toLowerCase().includes(q)) hits.push(m); });
    if (!hits.length) { res.innerHTML = `<div class="search-empty">没有找到「${esc(q)}」</div>`; return; }
    res.innerHTML = hits.slice(-50).reverse().map(m => {
      const idx = S.messages.indexOf(m);
      return `<div class="search-hit" data-idx="${idx}"><span class="sh-from">${m.from === "me" ? "你" : currentChar().name}</span><span class="sh-text">${esc(m.text)}</span><span class="sh-time">${fmtTime(m.t)}</span></div>`;
    }).join("");
    res.querySelectorAll(".search-hit").forEach(el => el.addEventListener("click", () => {
      toggle(false);
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      document.querySelector('.tab[data-page="chat"]').classList.add("active");
      $("#page-chat").classList.add("active");
      let target = document.querySelector(`.msg[data-idx="${el.dataset.idx}"]`);
      if (!target) { renderAllMessages(); target = document.querySelector(`.msg[data-idx="${el.dataset.idx}"]`); }
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("search-flash");
        setTimeout(() => target.classList.remove("search-flash"), 1600);
      }
    }));
  });
}

/* ================= 设置页：分组折叠 / 设置项搜索 =================
   纯呈现层。三条纪律：
   ① 不碰任何设置项 id 与 localStorage key（INV-1 / INV-2）；
   ② 隐藏卡片用独立类 .me-hit-off，绝不复用全局 .hidden（后者带 !important，
      会与 #sync-body / #push-body 等业务显隐互相打架，INV-6）；
   ③ 折叠初始态写在 HTML 的 class 上，JS 只做 toggle，避免首屏闪烁（FOUC）。 */

/**
 * 绑定 5 个分组头的展开 / 折叠。
 * 点击整个组头（不只是箭头）即切换，并同步 aria-expanded 供读屏器识别。
 * @returns {void}
 */
function initMeGroups() {
  const body = document.querySelector(".me-body");
  if (!body) return;
  body.querySelectorAll(".me-group-head").forEach(head => {
    const group = head.closest(".me-group");
    if (!group) return;
    const toggle = () => {
      const collapsed = group.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

/**
 * 绑定设置项实时搜索。
 * 每次输入都重新读取 .me-card 的 textContent（不缓存索引）——性别切换后
 * applyCharIdentity() 会重写卡片内的角色文案，缓存索引会立刻过期。
 * @returns {void}
 */
function initMeSearch() {
  const body = document.querySelector(".me-body");
  const input = document.getElementById("me-search");
  if (!body || !input) return;
  const clearBtn = document.getElementById("me-search-clear");
  const empty = document.getElementById("me-search-empty");
  const wrap = input.closest(".me-search-wrap");

  const apply = () => {
    const q = (input.value || "").trim().toLowerCase();
    const searching = q.length > 0;
    if (wrap) wrap.classList.toggle("has-value", searching);
    body.classList.toggle("searching", searching);
    body.querySelectorAll(".me-group").forEach(g => g.classList.remove("has-hit"));

    let anyHit = false;
    body.querySelectorAll(".me-card").forEach(card => {
      const hit = !searching || (card.textContent || "").toLowerCase().includes(q);
      card.classList.toggle("me-hit-off", !hit);
      card.classList.toggle("me-hit-on", searching && hit);
      if (!hit) return;
      anyHit = true;
      const group = card.closest(".me-group");
      if (group) group.classList.add("has-hit");
    });

    if (empty) empty.classList.toggle("hidden", !(searching && !anyHit));
  };

  input.addEventListener("input", apply);
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { input.value = ""; apply(); }
  });
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      apply();
      input.focus();
    });
  }
  apply(); // 首帧对齐：清空态下移除一切搜索类，折叠态完全由 HTML 决定
}

/* ================= 初始化 ================= */
function init() {
  // 今日心情
  const today = todayStr();
  if (S.moodDate !== today) {
    // v12 · T3/T4：跨天先结算慢层（self 在前——moodTick 要读今天的 self），再由
    // moodProject 把心境投影成 MOODS 原对象；投影为空则原样兜底 moodOfDay（V-63c）。
    S.self = Engine.selfTick(S, today, { now: Date.now() });
    S.moodDay = Engine.moodTick(S, today, { now: Date.now() });
    // v12 · T6：跨天补一条离线生活痕迹（G3 四校验 + 关系钩子），供 daylife 动机通道引用
    try { S.dayLife = Engine.dayLifeGen(S, { now: Date.now(), hour: new Date().getHours() }) || S.dayLife; } catch (e) { /* 失败不阻断跨天 */ }
    mood = Engine.moodProject(S.moodDay) || Engine.moodOfDay(today);
    S.moodDate = today; S.moodKey = mood.key; save();
  } else {
    mood = Engine.MOODS.find(m => m.key === S.moodKey) || Engine.moodOfDay(today);
  }

  // 立绘与头像（含性别/角色身份）
  applyTheme(S.persona.theme || "sakura");
  recordAff(S.affection);
  refreshCharacter();
  applyOutfit(S.wardrobe.outfit || "default");
  updateAura();

  // 候选 A · 长期记忆：在底部 tabbar 注入「记忆」入口（不改动 index.html，外科手术式）。
  // 必须在 bindTabs() 之前注入，使其被通用 tab 点击处理器统一绑定。
  try {
    const bar = document.querySelector(".tabbar");
    if (bar && !bar.querySelector('[data-page="ltm-manage"]')) {
      const b = document.createElement("button");
      b.className = "tab"; b.dataset.page = "ltm-manage";
      b.innerHTML = '<span class="tab-ico">🧠</span>记忆';
      bar.appendChild(b);
    }
  } catch (e) {}
  bindTabs(); bindInput(); bindActions(); bindSettings(); bindCall(); bindGames(); bindPropose(); bindOutfit(); bindGender(); bindSearch(); bindDayDetail();
  bindVoice(); bindNotify(); bindCloudSave(); bindLocalModel(); bindSync(); bindPush();
  bindArcUI();
  // 候选 B · 语音接线（设置页同意/偏好、朗读条状态、打断）
  try { bindAsrConsent(); } catch (e) {}
  try { bindVoicePrivacy(); } catch (e) {}
  try { bindVoiceBar(); } catch (e) {}
  try { bindPrivacyAudit(); } catch (e) {}  // 候选 C（C-E3）：顶栏「⚙ 隐私审计」入口 + 面板开关

  /* ================= 候选 C · 隐私共存启动 =================
   * 仅叠加，不改动 B 逻辑：
   *  1) 注册用户显式同意的外发端点（云/同步/推送，仅当开启时）
   *  2) 启动离线三态探测（绕开冻结 sw.js）
   *  3) 预热独立 Cache 命名空间 xinyu-edge-v1（绝不读写 sw key=19）
   */
  try { registerConsentedEndpoints(); } catch (e) {}
  // 候选 C（C-E3）：暴露「重新登记已同意外发端点」钩子，供 PrivacyAudit.clearAll() 在重置探针后恢复 consentedRegistry
  try { if (typeof registerConsentedEndpoints === "function" && typeof window !== "undefined") window.__xinyuReconsent = registerConsentedEndpoints; } catch (e) {}
  try { initReplyRouter(); } catch (e) {}  // 候选 C（C2）：注册 [cloud→local→heuristic] 路由
  try {
    if (window.OfflineProbe) { __offlineProbe = window.OfflineProbe.getInstance(); __offlineProbe.start(30000); }
  } catch (e) {}
  // 候选 C（C-E4 · C11）：顶栏挂载离线三态指示灯，订阅 OfflineProbe.onChange 驱动 setState/animate
  try {
    if (window.OfflineIndicator) {
      var __ledAnchor = document.querySelector("#nav-offline-led") || document.querySelector("#page-chat .nav");
      if (__ledAnchor) {
        var __led = window.OfflineIndicator.getInstance().mount(__ledAnchor);
        if (window.OfflineProbe && window.OfflineProbe.getInstance) {
          window.OfflineProbe.getInstance().onChange(function (st) {
            try { __led.setState(st); __led.animate(); } catch (e2) {}
          });
          __led.setState(window.OfflineProbe.getInstance().getState());
        }
      }
    }
  } catch (e) {}
  try {
    if (window.CacheWarmer) { __cacheWarmer = window.CacheWarmer.getInstance(); __cacheWarmer.preloadCritical(); }
  } catch (e) {}
  // 打断（Q3）：用户开始说话即打断小暖正在朗读（Voice 内部 startListen 已 cancel，这里再显式兜底）
  try {
    if (window.Voice && typeof Voice.onState === "function") {
      Voice.onState((ev) => { try { if (ev && ev.type === "listening") Voice.cancelSpeak(); } catch (_) {} });
    }
  } catch (e) {}
  // 设置页分组 / 搜索：必须排在 refreshCharacter()→applyCharIdentity() 与 bindSettings() 之后，
  // 这样卡片里的角色文案（data-xn-*）已注入完毕，搜索读到的是最终文本。
  initMeGroups(); initMeSearch();
  if (S.localModel.enabled) ensureLocalModelLoaded(); // 后台自动加载，用户打开"我的"时可能已就绪
  maybeConsolidate();
  renderAllMessages();
  refreshAffectionUI();
  refreshStoryUI();
  refreshRecentUI();
  refreshNavStatus();

  // 离线整理：每天一次；切回页面 / 每 30 分钟顺带检查是否需要整理
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) maybeConsolidate();
    else {
      scheduleReflection();
      scheduleSyncPush(1200);
      // 关页面前把未来 3 天要说的话交代给服务器，这样你不开小暖她也能按时找你
      uploadSchedule(true);
      // 双向聊天：顺手把脑快照也交代给服务器，微信里她才有「记忆」
      uploadBrain();
    }
  });
  setInterval(maybeConsolidate, 30 * 60000);

  // 日记提醒 & 周小结：每 5 分钟检查一次（21-23 点问日记、周日 20-22 点出周小结）
  setInterval(() => { try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {} }, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {} } });
  // 候选 A · 长期记忆：页面隐藏 / 卸载前蒸馏本会话累计 turns（隐私优先，本地落库；降级安全）
  document.addEventListener("visibilitychange", () => { if (document.hidden) ltmDistill(); });
  window.addEventListener("beforeunload", () => { try { ltmDistill(); } catch (e) {} });

  // 连续情绪光晕：空闲时缓慢回落，立绘始终"活"着
  setInterval(tickEmotion, 10000);

  // PWA 更新提示：项目发新版本时，桌面书签只弹一个小条，点一下即更新（无需重装/清缓存）
  initPWAUpdate();

  // 启动页淡出
  setTimeout(() => {
    $("#splash").classList.add("fade");
    $("#app").classList.remove("hidden");
    setTimeout(() => $("#splash").remove(), 700);
    if (!S.genderChosen) showGenderPicker();
    checkProactive();
  }, 1400);

  // 心屿 MCP：异步引导加载前端模块（动态 import，不改 index.html），并自动完成 PKCE。
  // 失败静默降级：引擎不可用 / 用户未授权 → MCP=null 或令牌缺失，对话照常进行。
  (async () => {
    try {
      const mod = await import("./mcp-client.js");
      MCP = new mod.McpClient({ proxyUrl: "/api/mcp" });
      await MCP.ensureReady(); // 含 PKCE 自动流程（AS 不可达则降级，不阻断 App）
    } catch (e) {
      console.warn("[xinyu-mcp] 心智引擎模块不可用，已降级:", e && e.message);
      MCP = null;
    }
    // 候选 A · 长期记忆：解析身份、初始化视图层与本地后端（全部降级安全，绝不阻塞对话）
    try {
      const id = await ltmIdentity();
      if (id && id.subject) {
        try { window.__xinyuSubject = id.subject; } catch (e2) {}
        if (window.LTMUI && window.LTMUI.setSubject) {
          try { window.LTMUI.setSubject(id.subject); } catch (e2) {}
        }
      }
      // 首次加载弹出隐私同意（方法有 consent 标志守卫，幂等安全）
      if (window.LTMUI && window.LTMUI.maybeShowConsent) {
        try { window.LTMUI.maybeShowConsent(); } catch (e2) {}
      }
      // 顺手初始化 LTM 后端（失败静默）
      if (window.LTM && typeof window.LTM.init === "function") {
        try { await window.LTM.init(); } catch (e2) {}
      }
    } catch (e) {}
  })();
}

/* ================= PWA 自动更新 =================
 * 打开书签时若检测到新版本，新 SW（sw.js 里已 skipWaiting）会立刻接管，
 * 页面在 controllerchange 时自动刷新一次加载新缓存——不用你点、更不用重装书签。
 * 用 sessionStorage 做防循环保护，避免重复刷新。 */
let _swHadController = false;
function initPWAUpdate() {
  if (!("serviceWorker" in navigator)) return;
  const justUpdated = sessionStorage.getItem("sw_just_updated");
  if (justUpdated) sessionStorage.removeItem("sw_just_updated");
  // 注册前是否已有旧 SW 在控：是 → 这次是"更新"；否 → 首次安装（不自动刷新）
  _swHadController = !!navigator.serviceWorker.controller && !justUpdated;

  navigator.serviceWorker.register("./sw.js").then(reg => {
    if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING"); // 打开时已有等待中的新版，放行
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && reg.waiting) {
          reg.waiting.postMessage("SKIP_WAITING"); // 兜底：补一刀让新 SW 接管
        }
      });
    });
  }).catch(() => {});

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swHadController && !sessionStorage.getItem("sw_reloading")) {
      sessionStorage.setItem("sw_reloading", "1");
      sessionStorage.setItem("sw_just_updated", "1");
      location.reload(); // 新 SW 已接管 → 刷新一次用上最新版
    }
  });

  // 若本次是刚更新完（上一轮刷新带过来的标记），给个轻提示
  if (justUpdated) {
    const t = document.createElement("div");
    t.id = "sw-update-toast";
    t.className = "sw-update-toast show";
    t.innerHTML = `<span>✨ 已更新到最新版</span>`;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 2600);
  }
}

/* ================= 候选 C（C-E3 · C-T5）· 隐私审计面板入口 =================
 * 在 B 已合入的聊天顶栏追加「⚙ 隐私审计」按钮（不破坏语音条 / 其它按钮），
 * 绑定弹窗开关，并在 index.html 的隐藏弹窗骨架内渲染 PrivacyAudit。
 * 铁律：小暖 不更名；B 逻辑零改动；仅共存叠加；不触碰冻结线。 */
function bindPrivacyAudit() {
  // 1) 聊天顶栏追加入口按钮（B 已合入结构内追加，不破坏语音条等）
  try {
    const nav = document.querySelector("#page-chat .nav");
    if (nav && !nav.querySelector("#btn-privacy-audit")) {
      const b = document.createElement("button");
      b.className = "nav-audit";
      b.id = "btn-privacy-audit";
      b.type = "button";
      b.title = "隐私审计";
      b.setAttribute("aria-label", "隐私审计");
      b.textContent = "⚙";
      nav.appendChild(b);
      b.addEventListener("click", openPrivacyAudit);
    }
  } catch (e) {}

  // 2) 弹窗开关（关闭按钮 + 点遮罩关闭）
  try {
    const modal = document.getElementById("privacy-audit-modal");
    const closeBtn = document.getElementById("privacy-audit-close");
    if (modal && closeBtn) {
      closeBtn.addEventListener("click", () => { try { modal.classList.add("hidden"); } catch (e) {} });
      modal.addEventListener("click", (ev) => { try { if (ev.target === modal) modal.classList.add("hidden"); } catch (e) {} });
    }
  } catch (e) {}
}

/* 打开隐私审计面板：渲染并刷新指标（指标动态，每次打开重算）。 */
function openPrivacyAudit() {
  try {
    const modal = document.getElementById("privacy-audit-modal");
    if (!modal) return;
    if (window.PrivacyAudit && typeof window.PrivacyAudit.render === "function") {
      const body = document.getElementById("privacy-audit-body");
      window.PrivacyAudit.render(body);
    }
    modal.classList.remove("hidden");
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", init);
})();
