/* 小暖 · v13 记忆模块（memory.js）—— T1/S0-f 空壳：只注册契约，不实现业务逻辑。
 *
 * 装载序：engine.js → **memory.js** → presence.js → texture.js（见 engine.files.json）。
 * 形态约定（DESIGN §2.1）：
 *   A 文件形态  单 IIFE，无 export / require / 全局变量泄露（除注册表内）。
 *   B 向上可见  模块内可直接读 Engine.*（engine.js 必先求值）。
 *   C 向下查表  engine 侧禁止直书 Memory 标识符，只能 Engine.mod("memory")。
 *   D 单向依赖  禁止反向：本文件不得出现 mod("texture") / mod("presence")。
 *   E 纯函数    不写 state，一切变更以补丁对象返回，由 app.js 回写落盘。
 *   F 静默降级  engine 是老版本（无 use）时直接 return，不注册。
 *   G 零浏览器依赖  不触碰 document/window/localStorage/navigator/self/location。
 *   H 失败即沉默  内部异常一律吞掉返回 null，绝不向上抛。
 *
 * ★ "use strict" 必须写在 IIFE **内部**：engine.js 是 sloppy 模式，Node 侧四份源码 concat 进
 *   同一个 new Function 后，文件顶部的 "use strict" 不再处于指令序言位置而退化为无效字符串；
 *   浏览器多 script 下却会真的生效 —— 两侧语义分歧。写进函数体内则两侧完全一致。
 *
 * ★ 本阶段（T1）全部为**安全默认值桩**：recallV2 恒返回 null → 引擎完全走 v12 recallMemory。
 *   真实逻辑（R23 semantic / R24 episodic / R25 融入式召回 / R27 纠错 / 淘汰 / 迁移）在 T2 实现。 */
(function (E) {
  "use strict";
  if (!E || typeof E.use !== "function") return;   // F：老 engine → 不注册，engine 侧查表得 null

  const safeObj = E.safeObj, safeArr = E.safeArr;

  /* 写入侧 ---------------------------------------------------------------- */
  /* 从本轮用户输入抽取事实 / 时刻，返回补丁（不写 state）。T2 实现。 */
  function extractFacts(text, state, ctx) { return null; }

  /* 把补丁合并进 mem，纯函数，宿主回写用。桩：原样返回一个安全 mem 对象。 */
  function applyPatch(mem, patch) { return safeObj(mem); }

  /* 口头纠错识别（R27）：{ factId, kind:"deny"|"revise", value } | null。T2 实现。 */
  function detectCorrection(text, state) { return null; }

  /* 读取侧 ---------------------------------------------------------------- */
  /* 语义检索（复用 E.tokenize / E.vec / E.cosine）。桩：恒空命中。 */
  function retrieveFacts(query, state, k) { return []; }

  /* R25 融入式召回。★ 桩恒返回 null —— 走沉默路径，引擎逐位回落 v12 recallMemory。 */
  function recallV2(text, state, ctx) { return null; }

  /* 维护侧 ---------------------------------------------------------------- */
  /* R23/R24 按价值淘汰（conf + peak + 时间衰减 + 使用反馈）。桩：原样返回。 */
  function evict(mem, now) { return safeObj(mem); }

  /* R35 老档迁移，幂等。桩：不迁移、不改档，migrated 恒 0（用户档任何情况下都不丢）。 */
  function migrateV12(state) { return { mem: safeObj(safeObj(state).mem), migrated: 0 }; }

  /* 面板 API（R26）—— 刻意无 addFact：用户手填等于自己写剧本（PRD N4）。 */
  function listFacts(state) { return safeArr(safeObj(safeObj(state).mem).facts).slice(0, 0); }
  function editFact(mem, id, value) { return safeObj(mem); }
  function deleteFact(mem, id) { return safeObj(mem); }

  /* 供 texture 消费（R38 inside-joke）。桩：无候选。 */
  function jokeCandidates(state, ctx) { return []; }

  E.use("memory", {
    extractFacts, applyPatch, detectCorrection,
    retrieveFacts, recallV2,
    evict, migrateV12,
    listFacts, editFact, deleteFact,
    jokeCandidates,
    STUB: true,   // T1 标记：T2 真实实现落地后删除本字段
  });
})(typeof Engine !== "undefined" ? Engine : null);
