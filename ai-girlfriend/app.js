/* ============================================================
 * 小暖 · AI 女友 —— 应用主逻辑
 * ============================================================ */
(() => {
"use strict";

/* ================= 状态与持久化 ================= */
const SAVE_KEY = "xiaonuan_save_v1";

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
  if (!S.tts || !("speechSynthesis" in window)) return;
  // 去掉 emoji / 控制符，避免部分合成器报错
  const clean = (text || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean) return;
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
  memory: {}, // {userName, likes, events}
  persona: { gender: "female", tone: "gentle", theme: "sakura", card: "xiaonuan" },
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
});

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
      s.persona = Object.assign({ gender: "female", tone: "gentle", theme: "sakura", card: "xiaonuan" }, s.persona || {});
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
      return s;
    }
  } catch (e) {}
  return defaultState();
}
function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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
  const hue = Math.round(200 + t * 140);      // 200 蓝 → 340 粉
  const sat = 80;
  const light = 60 + a * 6;
  const intensity = 0.34 + Math.abs(a) * 0.5; // 0.34 .. 0.84
  const scale = 1 + Math.abs(a) * 0.28;
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

/* 离线整理（Sleep-time Compute）：每天至多一次，整理并（如有变化）记到时间线 */
function maybeConsolidate() {
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
  if (!animate) wrap.style.animation = "none";
  // 图片消息：气泡里只放图（+可选文字说明）
  const imgHtml = m.img ? `<img class="bubble-img" src="${m.img}" alt="图片">` : "";
  const txtHtml = m.text ? esc(m.text) : "";
  const inner = imgHtml + (imgHtml && txtHtml ? `<div class="bubble-cap">${txtHtml}</div>` : txtHtml);
  if (m.from === "her") {
    wrap.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
      <div class="bubble-wrap"><div class="bubble">${inner}</div>
      <div class="msg-meta">${fmtTime(m.t)}</div></div>`;
  } else {
    wrap.innerHTML = `<div class="bubble-wrap"><div class="bubble">${inner}</div>
      <div class="msg-meta">${fmtTime(m.t)} <span class="read">${m.read ? "已读" : "送达"}</span></div></div>`;
  }
  body.appendChild(wrap);
  scrollBottom();
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
async function herSay(text, expr = null) {
  // 显示"正在输入"
  $("#nav-status").textContent = "正在输入…";
  $("#nav-status").classList.add("typing");
  const body = $("#chat-body");
  const tip = document.createElement("div");
  tip.className = "msg her";
  const meta = `<div class="msg-meta">${fmtTime(Date.now())}</div>`;
  tip.innerHTML = `<div class="msg-avatar">${avatarSVG()}</div>
    <div class="bubble-wrap"><div class="bubble typing-bubble"><i></i><i></i><i></i></div>${meta}</div>`;
  body.appendChild(tip); scrollBottom();

  // 思考停顿：短消息更快开打，长消息略多酝酿
  await new Promise(r => setTimeout(r, 350 + Math.min(900, text.length * 12)));
  $("#nav-status").textContent = "在线";
  $("#nav-status").classList.remove("typing");

  // 把"正在输入"气泡换成真实气泡，逐字渲染（流式打字机效果）
  const wrap = tip.querySelector(".bubble-wrap");
  wrap.innerHTML = `<div class="bubble her-bubble-stream"></div>${meta}`;
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
function applyEmotion(intent, delta) {
  Engine.Emotion.apply(S.emotion, intent, delta);
  Engine.Emotion.decay(S.emotion);
  Engine.Emotion.record(S.emotionLog, S.emotion, todayStr());
  updateAura();
  save();
  return Engine.Emotion.zone(S.emotion);
}

async function herReply(userText, img) {
  herBusy = true;
  if (userText) pendingQueue.push(userText);
  if (img) pendingImgs.push(img);

  while (pendingQueue.length) {
    const text = pendingQueue.length > 1 ? pendingQueue.join("；") : pendingQueue[0];
    pendingQueue = [];

    // 特殊仪式感意图（表白 / 纪念日 / 游戏）需要读取或改写状态
    const intent = Engine.detect(text);
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
      continue;
    }

    // 优先云端大模型（有配置时作为主引擎）
    if (S.cloud.enabled && S.cloud.base && S.cloud.key) {
      result = await callCloud(text);
    }
    // 端侧模型兜底（零配置离线 AI）：云端未配/失败，且用户已启用并加载了本地模型
    if (!result && S.localModel.enabled) {
      result = await localThink(text);
    }
    // 本地引擎兜底（永远可用，无网络也无模型也能聊）
    if (!result) {
      const r = Engine.reply(text, { affection: S.affection, nick: S.nick, mood, memory: S.memory, persona: S.persona, dating: S.dating, lastReply: S.lastReply });
      result = { replies: r.replies, delta: r.delta, expression: r.expression, moodOverride: r.moodOverride };
    }

    if (result.moodOverride) { mood = result.moodOverride; S.moodKey = mood.key; save(); refreshAffectionUI(); }

    // 情绪状态机：用本轮回合的意图/好感度更新连续情绪，再决定表情（覆盖无表情的行）
    const z = applyEmotion(intent, result.delta);
    if (!result.expression || result.expression === "normal") result.expression = z.expr;

    if (result.intent === "greeting" && Engine.getLevel(S.affection).lv >= 3) waveHello();

    for (let i = 0; i < result.replies.length; i++) {
      await herSay(result.replies[i], result.expression);
      if (i < result.replies.length - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 600));
    }
    markAllRead();
    S.lastReply = result.replies[result.replies.length - 1];
    save();
    addAffection(result.delta);
  }

  // 图片：让小暖"看见"用户发来的图，再回应（三层管线在 understandImage 内）
  while (pendingImgs.length) {
    const im = pendingImgs.shift();
    const r = await handleImage(im);
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
  $("#nav-status").textContent = "在线";
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
        const d = new Date(m.t); const t = todayStr();
        return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}` === t;
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

/* ================= 云端大模型 ================= */
async function callCloud(userText) {
  try {
    const base = S.cloud.base.trim().replace(/\/+$/, "");
    let url;
    if (/\/chat\/completions$/.test(base)) url = base;
    else if (base.endsWith("/v1")) url = base + "/chat/completions";
    else url = base + "/v1/chat/completions";
    const history = S.messages.slice(-12).map(m => ({
      role: m.from === "me" ? "user" : "assistant", content: m.text,
    }));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${S.cloud.key}` },
      body: JSON.stringify({
        model: S.cloud.model || "deepseek-chat",
        messages: [{ role: "system", content: Engine.systemPrompt({ affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet, dating: S.dating, memory: S.memory, persona: S.persona, caredTopics: S.caredTopics, recall: await retrieveMemoriesCloud(userText), emotion: S.emotion }) }, ...history],
        temperature: 0.9, max_tokens: 200,
        frequency_penalty: 0.6, presence_penalty: 0.4,
      }),
      signal: AbortSignal.timeout(15000),
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

async function localThink(text) {
  if (!S.localModel.enabled || !window.LocalModel || !LocalModel.isLoaded()) return null;
  try {
    const intent = Engine.detect(text);
    const history = S.messages.slice(-10).map(m => ({
      role: m.from === "me" ? "user" : "assistant", content: m.text,
    }));
    const sys = Engine.systemPrompt({
      affection: S.affection, nick: S.nick, mood, firstMeet: S.firstMeet,
      dating: S.dating, memory: S.memory, persona: S.persona,
      caredTopics: S.caredTopics, recall: [], emotion: S.emotion,
    }) + "\n\n（请用一句话简短回复，像女朋友在微信上发的消息，口语化、带点 emoji，不要列清单、不要写小标题。）";
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
  if (gapDays >= 3 && !S.greetedSlots.includes("back3")) {
    S.greetedSlots.push("back3"); save();
    const msg = Engine.proactive("longNoSee3d", S, { days: gapDays });
    if (msg) await herSay(msg, "sad");
  } else if (gapDays >= 1 && !S.greetedSlots.includes("back1")) {
    S.greetedSlots.push("back1"); save();
    const msg = Engine.proactive("longNoSee1d", S);
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

  // 基于记忆的主动关心（记得你之前提过的事）
  if (!S.caredTopics) S.caredTopics = [];
  const ev = (S.memory.events || []).find(e => !S.caredTopics.includes(e.topic) && Date.now() - e.at < 3 * 86400000);
  if (ev) {
    const msg = Engine.proactive("care", S, { topic: ev.topic });
    if (msg) {
      S.caredTopics.push(ev.topic);
      if (S.caredTopics.length > 12) S.caredTopics = S.caredTopics.slice(-12);
      save();
      setTimeout(() => herSay(msg, "shy"), 3000);
    }
  }

  S.lastVisit = Date.now(); save();
  // 顺带检查今晚是否该问日记 / 是否该出周小结
  try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {}
  } finally {
    herBusy = false;
    // 介绍期间用户排队的消息，现在回复
    if (pendingQueue.length) herReply(null);
  }
}

/* 页面停留期间的随机想念 */
setInterval(() => {
  if (herBusy || !S.firstMeet) return;
  const lastMsg = S.messages[S.messages.length - 1];
  const idleFor = Date.now() - (lastMsg ? lastMsg.t : 0);
  if (idleFor > 3 * 60 * 1000 && Math.random() < 0.35) {
    const msg = Engine.proactive("random", S);
    if (msg) herSay(msg);
  }
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

/* ================= 语音输入（麦克风） ================= */
function bindMic() {
  const btn = $("#btn-mic");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { if (btn) btn.style.display = "none"; return; }
  const rec = new SR();
  rec.lang = "zh-CN"; rec.interimResults = false; rec.continuous = false;
  let listening = false;
  const stop = () => { try { rec.stop(); } catch (e) {} listening = false; btn.classList.remove("recording"); };
  btn.addEventListener("click", () => {
    if (listening) { stop(); return; }
    try {
      rec.start();
      listening = true; btn.classList.add("recording");
    } catch (e) { listening = false; btn.classList.remove("recording"); }
  });
  rec.onresult = e => {
    const txt = e.results[0][0].transcript || "";
    const input = $("#chat-input");
    input.value = (input.value + " " + txt).trim();
    input.focus();
    stop();
  };
  rec.onend = stop;
  rec.onerror = stop;
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
    const r = Engine.reply(text, { affection: S.affection, nick: S.nick, mood, memory: S.memory, persona: S.persona, lastReply: S.lastReply });
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
  const entries = Object.entries(hist).sort((a, b) => (a[0] < b[0] ? -1 : 1));
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
  const tl = $("#timeline");
  if (tl) {
    const list = (S.story || []).slice().sort((a, b) => a.t - b.t);
    if (!list.length) {
      tl.innerHTML = `<div class="memory-empty">还没有故事呢…多陪${currentChar().name}聊聊，你们的故事会从这里开始 💕</div>`;
    } else {
      tl.innerHTML = list.map(it => {
        const d = new Date(it.t);
        const ds = `${d.getMonth() + 1}月${d.getDate()}日`;
        return `<div class="tl-item"><div class="tl-dot">${it.icon}</div><div class="tl-line"></div><div class="tl-body"><div class="tl-text">${esc(it.text)}</div><div class="tl-date">${ds}</div></div></div>`;
      }).join("");
    }
  }
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
    html += `<div class="mood-cal-day${isToday ? " today" : ""}" style="background:${color}" title="${key}${label ? " · " + label : ""}">${d}</div>`;
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
      $("#page-" + tab.dataset.page).classList.add("active");
      if (tab.dataset.page === "chat") {
        $("#chat-dot").classList.add("hidden");
        scrollBottom();
      }
      if (tab.dataset.page === "story") refreshStoryUI();
    });
  });
}

/* ================= 输入 & 表情 ================= */
const EMOJIS = ["😊","😂","🥰","😳","😤","😭","🥺","😆","😉","😝","🤔","🙄","😴","🥱","💕","💗","💖","💔","🌹","🍰","🧋","🐱","🎂","☀️","🌙","⭐","🎉","👍","🤗","😘","💋","👋"];

function bindInput() {
  const input = $("#chat-input");
  const send = () => {
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

    // 回复生成后再把喜好/事件写进记忆（避免自我召回）
    const flushMem = () => {
      if (mem.likes) {
        S.memory.likes = S.memory.likes || [];
        for (const l of mem.likes) {
          if (!S.memory.likes.includes(l)) {
            S.memory.likes.push(l);
            pushStory("memory", "💝", `你提到你喜欢「${l}」`);
          }
        }
      }
      if (mem.event) {
        S.memory.events = S.memory.events || [];
        S.memory.events.push({ ...mem.event, at: Date.now(), importance: Engine.eventImportance(mem.event.topic) });
        if (S.memory.events.length > 8) S.memory.events = S.memory.events.slice(-8);
      }
      save(); refreshMemoryUI();
    };

    if (herBusy) { pendingQueue.push(text); pendingMemStores.push(flushMem); return; } // 她说话时排队，记忆待本轮回复后落库
    setTimeout(async () => { await herReply(text); flushMem(); }, 300 + Math.random() * 500);
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

/* ================= 端侧模型设置页 =================
 * 启用开关 + 模型选择 + 加载按钮 + 进度/状态。模型只按需加载，
 * 后台自动加载时通过 LocalModel.onProgress 实时刷新状态。 */
let lmLoadingTriggered = false;
function ensureLocalModelLoaded() {
  if (lmLoadingTriggered || LocalModel.isLoaded()) return;
  lmLoadingTriggered = true;
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
}

/* ================= 性别 / 角色切换 ================= */
function applyCharIdentity() {
  const ch = currentChar();
  const role = ch.gender === "male" ? "男友" : "女友";
  if (typeof document !== "undefined") document.title = `${ch.name} · 你的 AI ${role}`;
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

/* ================= 初始化 ================= */
function init() {
  // 今日心情
  const today = todayStr();
  if (S.moodDate !== today) {
    mood = Engine.moodOfDay(today);
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

  bindTabs(); bindInput(); bindActions(); bindSettings(); bindCall(); bindGames(); bindPropose(); bindOutfit(); bindGender();
  bindVoice(); bindNotify(); bindCloudSave(); bindLocalModel();
  if (S.localModel.enabled) ensureLocalModelLoaded(); // 后台自动加载，用户打开"我的"时可能已就绪
  maybeConsolidate();
  renderAllMessages();
  refreshAffectionUI();
  refreshStoryUI();

  // 离线整理：每天一次；切回页面 / 每 30 分钟顺带检查是否需要整理
  document.addEventListener("visibilitychange", () => { if (!document.hidden) maybeConsolidate(); });
  setInterval(maybeConsolidate, 30 * 60000);

  // 日记提醒 & 周小结：每 5 分钟检查一次（21-23 点问日记、周日 20-22 点出周小结）
  setInterval(() => { try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {} }, 5 * 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { try { checkDiaryReminder(); checkWeeklySummary(); } catch (e) {} } });

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

document.addEventListener("DOMContentLoaded", init);
})();
