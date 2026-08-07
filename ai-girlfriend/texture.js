/* 小暖 · v13 微行为模块（texture.js）—— T1/S0-f 空壳：只注册契约，不实现业务逻辑。
 *
 * 装载序：engine.js → memory.js → presence.js → **texture.js**（见 engine.files.json）。
 * texture 排最后的原因：它同时消费 memory（R38 inside-joke 词条）与 presence（energy/在场态）。
 * 约定同 memory.js（DESIGN §2.1 A–H）。
 *
 * ★ 本阶段（T1）全部为**安全默认值桩**：texturePass 恒返回 null（引擎原样保留 replies，
 *   逐位等于 v12）、textureAllow 恒 { ok:false }。R28 六重与门 / R29 六类互斥择一 /
 *   R30 频控与 7 天爬坡在 T4 实现，且**门禁必须先于效果**独立验收通过（PRD R-T1 铁律）。
 *
 * ★ 两张表先落桩空表：真实语料在 T4 填。错字只能取自 TYPO_TABLE 白名单（拼音/形近、可辨认、
 *   不产生歧义）且必须有后续更正；TIC_TABLE 是人格卡专属口头禅。二者供测试直接断言。 */
(function (E) {
  "use strict";
  if (!E || typeof E.use !== "function") return;

  /* R28 六重与门：{ ok, banTypo, ramp }。桩恒不放行 → 出口永远是完美句（= v12）。 */
  function textureAllow(state, ctx) { return { ok: false, banTypo: true, ramp: 0 }; }

  /* R29 六类互斥择一：{ text, kind, split:[String] } | null。
   * ★ 桩返回 null —— engine 侧 `if (tx && tx.text)` 不成立，replies 原样通过护栏。
   * T4 实现时铁律不变：改写后对全句复检 PERSONA_BREAK_RE，命中即丢弃修饰回退原句，
   * 绝不替换为 PERSONA_FALLBACK（沿用 Inner「失败即沉默」范式）。 */
  function texturePass(text, state, ctx) { return null; }

  /* R30 冷却/配额回写补丁（依赖 S0-a 的 reply 回传链路）。桩：空补丁。 */
  function textureAfterTurn(state, hit) { return null; }

  /* 错字白名单 / 口头禅表（只读常量，供测试断言）。T4 填充语料。 */
  const TYPO_TABLE = [];
  const TIC_TABLE = { soft: [], tsundere: [], clingy: [] };

  E.use("texture", {
    textureAllow, texturePass, textureAfterTurn,
    TYPO_TABLE, TIC_TABLE,
    STUB: true,   // T1 标记：T4 真实实现落地后删除本字段
  });
})(typeof Engine !== "undefined" ? Engine : null);
