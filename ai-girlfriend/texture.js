/* 小暖 texture.js · §2.5 · R28门禁→R29微行为→R30频率 · 破墙即回退原句 · V-90 ≤5120B */
(function (E) {
"use strict";
if (!E || typeof E.use !== "function") return;
const O = E.safeObj, PW = E.pickWith, CW = E.chanceWith, RG = E.rngOf;
const N = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
const DAY = 864e5, CAP = 6, TYCAP = 2;
const KEY = /[0-9１-９]|[点分秒]|(明天|后天|周[一二三四五六日天]|答应|保证|一定|记得)/;
const TYPO_TABLE = [["什么", "甚么"], ["怎么", "怎末"], ["现在", "现再"], ["知道", "知到"],
 ["一下", "一夏"], ["可以", "可已"], ["这样", "这养"], ["休息", "休戏"]];
const TIC_TABLE = { soft: ["嗯", "唔", "诶嘿"], tsundere: ["哼", "啧", "才不是"], clingy: ["欸", "呐", "诶呀"] };
const HES = ["嗯…", "那个…", "唔…", "诶…"], CUT = /[，。！？~…]/;
const OFF = { ok: false, banTypo: true, ramp: 0, en: 0 };

function textureAllow(state, ctx) {
 try {
  const st = O(state), c = O(ctx), now = Date.now();
  if (E.flagOn(st, "texture") === false) return OFF;   // ① 总开关（缺省开）
  const lv = N(c.lv, E.getLevel(N(st.affection, 0)).lv), tex = O(st.tex);
  if (lv < 2 || (N(tex.t, 0) < 30 && now - N(st.firstMeet, now) < DAY)) return OFF;   // ② 确立＋非首轮
  if (c.crisis) return OFF;   // ③ 危机
  const ue = O(c.ue);
  if (N(E.UE_POLARITY[ue.type], 0) < 0 && N(E.UE_AROUSAL[ue.type], 0) > .3) return OFF;   // ④ 负向高唤醒
  const day = Math.floor(now / DAY), fresh = N(tex.d, -1) === day;   // ⑥ 配额冷却
  if (fresh && N(tex.n, 0) >= CAP) return OFF;
  return { ok: true, banTypo: !!(fresh && N(tex.ty, 0) >= TYCAP) || N(tex.t, 0) - N(tex.tyAt, -99) < 20,
   ramp: Math.min(1, .6 + .2 * (lv - 1)), en: ue.type === "tired" ? .8 : 1 };
 } catch (e) { return OFF; }
}

function build(k, t, st, rng) {
 if (k === "hes") return { text: PW(HES, rng) + t };
 if (k === "tic") return { text: PW(TIC_TABLE[{playful:"tsundere",clingy:"clingy"}[O(st.persona).tone]||"soft"], rng) + "，" + t };
 if (k === "fix") return { text: t.slice(0, 3) + "…嗯，" + t };
 if (k === "frag") { const i = t.search(CUT);
  return (i > 0 && i < t.length - 2) ? { split: [t.slice(0, i + 1), t.slice(i + 1)] } : null; }
 if (k === "typo") {
  for (const p of TYPO_TABLE) if (t.indexOf(p[0]) >= 0) return { text: t.replace(p[0], p[1]) + "  *" + p[0] };
  return null; }
 if (k === "drift") { const tr = String(O(st.dayLife).trace || "");
  return tr ? { text: t + "…啊对了，" + tr } : null; }
 return null;
}

function texturePass(text, state, ctx) {
 try {
  const t = String(text || ""); if (t.length < 6) return null;
  const st = O(state), c = O(ctx), g = textureAllow(st, c);
  if (!g.ok || E.detectCrisis(t).level !== "none") return null;
  const rng = RG(c);
  if (!CW(.25 * g.ramp * g.en, rng)) return null;
  const pool = ["hes", "tic", "fix"], ci = t.search(CUT);
  if (!c.nosplit && ci > 0 && ci < t.length - 2) pool.push("frag");
  if (O(st.dayLife).trace) pool.push("drift");
  if (!g.banTypo && !KEY.test(t) && TYPO_TABLE.some((p) => t.indexOf(p[0]) >= 0)) pool.push("typo");   // ⑤ 关键信息禁错字；无白名单词不入池
  const k = PW(pool, rng), r = build(k, t, st, rng);
  if (!r) return null;
  const full = r.text || (r.split || []).join("");
  if (!full || full.length > 140 || E.PERSONA_BREAK_RE.test(full)) return null;
  O(st.tex).hAt = N(O(st.tex).t, 0);   // v14 R-S1 门③：本轮质感已命中的唯一同轮信号（tex.t 只在 afterTurn 自增，故 hAt===t ⟺ 本轮）
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
