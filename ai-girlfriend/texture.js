/* 小暖 texture.js · §2.5 · R28门禁→R29微行为→R30频率 · 破墙即回退原句 · 候选 F 精调（F3/F4/F5） */
(function (E) {
"use strict";
if (!E || typeof E.use !== "function") return;
const O = E.safeObj, PW = E.pickWith, CW = E.chanceWith, RG = E.rngOf;
const N = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const DAY = 864e5, CAP = 6, TYCAP = 2;
const KEY = /[0-9１-９]|[点分秒]|(明天|后天|周[一二三四五六日天]|答应|保证|一定|记得)/;
const TYPO_TABLE = [["什么", "甚么"], ["怎么", "怎末"], ["现在", "现再"], ["知道", "知到"],
 ["一下", "一夏"], ["可以", "可已"], ["这样", "这养"], ["休息", "休戏"]];
/* 候选 F·F3：TIC_TABLE 每 tone 3→5 条，降复读塑料感 */
const TIC_TABLE = {
  soft: ["嗯", "唔", "诶嘿", "诶", "那个…"],
  tsundere: ["哼", "啧", "才不是", "笨蛋", "谁稀罕"],
  clingy: ["欸", "呐", "诶呀", "呜哇", "抱抱"]
};
/* 候选 F·F4：UE_TIC 单值→每情绪 2–3 条数组（L1 情境化；build 兼容数组形态） */
const UE_TIC = {
  tired:   ["欸", "唔…", "累了吧你"],
  sad:     ["唔", "哎", "心里一紧"],
  happy:   ["嘻", "嘿嘿", "笑出声了"],
  excited: ["哇", "诶呀", "好耶"],
  anxious: ["诶", "唔", "别慌啊"],
  lonely:  ["唔", "欸", "陪陪我嘛"]
};
/* 候选 F·F3：HES 4→6 条 */
const HES = ["嗯…", "那个…", "唔…", "诶…", "其实…", "怎么说呢…"], CUT = /[，。！？~…]/;
const OFF = { ok: false, banTypo: true, ramp: 0, en: 0 };

function textureAllow(state, ctx) {
 try {
  const st = O(state), c = O(ctx), now = Date.now();
  if (E.flagOn(st, "texture") === false) return OFF;   // ① 总开关
  const lv = N(c.lv, E.getLevel(N(st.affection, 0)).lv), tex = O(st.tex);
  if (lv < 2 || (N(tex.t, 0) < 30 && now - N(st.firstMeet, now) < DAY)) return OFF;   // ② 确立＋非首轮
  if (c.crisis) return OFF;   // ③ 危机
  const ue = O(c.ue);
  if (N(E.UE_POLARITY[ue.type], 0) < 0 && N(E.UE_AROUSAL[ue.type], 0) > .3) return OFF;   // ④ 负向高唤醒
  const day = Math.floor(now / DAY), fresh = N(tex.d, -1) === day;   // ⑥ 配额冷却
  if (fresh && N(tex.n, 0) >= CAP) return OFF;
  return { ok: true, banTypo: !!(fresh && N(tex.ty, 0) >= TYCAP) || N(tex.t, 0) - N(tex.tyAt, -99) < 20,
   ramp: Math.min(1, .7 + .2 * (lv - 1)), en: ue.type === "tired" ? .8 : 1 };   // 候选 F·F5：ramp floor 0.6→0.7
 } catch (e) { return OFF; }
}

function build(k, t, st, rng) {
 if (k === "hes") return { text: PW(HES, rng) + t };
 if (k === "tic") {
  const p = O(O(st).persona) || {};
  const tone = p.tone || "soft";
  const warmth = (typeof p.warmth === "number") ? p.warmth : 0.6;   // 候选 F·F7 默认 0.6
  const ueType = O(O(st).ue).type;
  // 兼容 UE_TIC 数组形态（旧单值写法亦兼容为单元素数组）
  const ueArr = Array.isArray(UE_TIC[ueType]) ? UE_TIC[ueType] : (UE_TIC[ueType] ? [UE_TIC[ueType]] : null);
  // 候选 F·F4：p_ue = 0.35 + 0.25·warmth；情绪 tic 池存在且命中则走情绪，否则走 tone tic（修复 E 缺口②）
  const useUE = !!(ueArr && ueArr.length) && CW(0.35 + 0.25 * warmth, rng);
  const tk = useUE ? "ue" : ({ playful: "tsundere", clingy: "clingy" }[tone] || "soft");
  const pool = tk === "ue" ? ueArr : TIC_TABLE[tk];
  return { text: PW(pool, rng) + "，" + t };
 }
 if (k === "fix") return { text: t.slice(0, 3) + "…嗯，" + t };
 if (k === "frag") { const i = t.search(CUT);
  return (i > 0 && i < t.length - 2) ? { split: [t.slice(0, i + 1), t.slice(i + 1)] } : null; }
 if (k === "typo") {
  for (const p of TYPO_TABLE) if (t.indexOf(p[0]) >= 0) return { text: t.replace(p[0], p[1]) + "  *" + p[0] };
  return null; }
 if (k === "drift") {
  let tr = String(O(st.dayLife).trace || "");
  if (!tr && Array.isArray(O(st).mem) && O(st).mem.length) {
    const last = O(st).mem[O(st).mem.length - 1];
    tr = (typeof last === "string") ? last : (last && typeof last.text === "string" ? last.text : "");
  }
  return tr ? { text: t + "…啊对了，" + tr } : null;
 }
 return null;
}

function texturePass(text, state, ctx) {
 try {
  const t = String(text || ""); if (t.length < 6) return null;
  const st = O(state), c = O(ctx), g = textureAllow(st, c);
  if (!g.ok || E.detectCrisis(t).level !== "none") return null;
  const rng = RG(c);
  if (!CW(.32 * g.ramp * g.en, rng)) return null;   // 候选 F·F5：门槛 0.25 → 0.32
  const pool = ["hes", "tic", "fix"], ci = t.search(CUT);
  if (!c.nosplit && ci > 0 && ci < t.length - 2) pool.push("frag");
  if (O(st.dayLife).trace) pool.push("drift");
  if (!g.banTypo && !KEY.test(t) && TYPO_TABLE.some((p) => t.indexOf(p[0]) >= 0)) pool.push("typo");   // ⑤ 关键信息禁错字
  const k = PW(pool, rng), r = build(k, t, st, rng);
  if (!r) return null;
  const full = r.text || (r.split || []).join("");
  if (!full || full.length > 140 || E.PERSONA_BREAK_RE.test(E.pnorm(full))) return null;
  O(st.tex).hAt = N(O(st.tex).t, 0);   // v14 R-S1 门③：本轮质感已命中的唯一同轮信号
  return { text: r.text || "", kind: k, split: r.split || null };
 } catch (e) { return null; }
}

/* R30 回写契约：engine 冻结不加调用点，由 app.js 在 reply() 末尾经 mod("texture") 查表回写 state.tex */
function textureAfterTurn(state, hit) {
 try {
  const tex = O(O(state).tex), day = Math.floor(Date.now() / DAY), fresh = N(tex.d, -1) === day;
  const t = N(tex.t, 0) + 1, k = O(hit).kind;
  const p = { d: day, t, n: (fresh ? N(tex.n, 0) : 0) + (k ? 1 : 0), ty: fresh ? N(tex.ty, 0) : 0, tyAt: N(tex.tyAt, -99) };
  if (k === "typo") { p.ty += 1; p.tyAt = t; }
  return p;
 } catch (e) { return null; }
}

E.use("texture", { textureAllow, texturePass, textureAfterTurn, TYPO_TABLE, TIC_TABLE });
})(typeof Engine !== "undefined" ? Engine : null);
