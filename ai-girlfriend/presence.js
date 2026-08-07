/* 小暖 · v13 在场模块（presence.js）—— T1/S0-f 空壳：只注册契约，不实现业务逻辑。
 *
 * 装载序：engine.js → memory.js → **presence.js** → texture.js（见 engine.files.json）。
 * 约定同 memory.js（DESIGN §2.1 A–H）：单 IIFE / 只读 Engine.* / 不写 state / 失败即沉默 /
 * 零浏览器依赖 / "use strict" 写在函数体内（Node concat 与浏览器多 script 语义一致）。
 *
 * ★ 本阶段（T1）全部为**安全默认值桩**：presenceOf 恒 awake、pacingOf 返回 null（宿主走原
 *   固定延迟策略）、unavailAllow 恒 false（绝不静默缺席）、makeupLine 恒 null。
 *   真实逻辑（R31 状态机 + 睡眠窗 / R32 高方差节奏 / R33 不可用与补偿）在 T3 实现。 */
(function (E) {
  "use strict";
  if (!E || typeof E.use !== "function") return;

  /* R31 在场状态机：{ state:"awake"|"busy"|"asleep"|"away", until, reason, traceIdx }。
   * 桩恒 awake —— 危机豁免、trace 同源（busy 必须指向已落盘 dayLife.traces[i]，
   * 取不到即降级 awake）、用户催 ≥2 条即 awake，全部留给 T3。 */
  function presenceOf(state, ctx) {
    return { state: "awake", until: 0, reason: "stub", traceIdx: -1 };
  }

  /* 睡眠窗（人格卡 + moodDay.energy + 日抖动 σ≥15min）。桩：给出基准窗，不参与判定。 */
  function sleepWindow(state, day) { return { from: 1, to: 8 }; }

  /* R32 响应节奏：{ delayMs, typingMs, split }。
   * ★ 桩返回 null —— reply() 不会把 pacing 字段塞进返回对象，老前端逐位走原固定策略。 */
  function pacingOf(userText, reply, ctx) { return null; }

  /* R33 是否允许本次不可用（日累计≤10h / 不连续 2 天 / 用户催即 false）。桩：恒不允许。 */
  function unavailAllow(state, ctx) { return false; }

  /* R33 补偿句（100% 发出，必须过 GUILT_TRIP_RE）。桩：无补偿待办即 null。 */
  function makeupLine(state, ctx) { return null; }

  /* 宿主回写补丁：累计不可用时长、补偿待办。桩：空补丁（不改任何字段）。 */
  function presenceAfterTurn(state, p) { return null; }

  E.use("presence", {
    presenceOf, sleepWindow,
    pacingOf,
    unavailAllow, makeupLine, presenceAfterTurn,
    STUB: true,   // T1 标记：T3 真实实现落地后删除本字段
  });
})(typeof Engine !== "undefined" ? Engine : null);
