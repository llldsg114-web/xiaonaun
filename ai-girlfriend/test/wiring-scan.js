"use strict";
/* 护栏接线扫描器（v12 · 第 3 轮引入）
 *
 * 起因：三轮验收里连续出现三次同一类缺陷 ——
 *   D1  negMark() 返回值被丢弃 → 计数器永远回不到 state，读侧 100% 拦截、写侧 0%；
 *   D3  negClampDv() 零调用点  → 冲量地板写好了但没人调，angry_words 照样冲到 -0.64；
 *   N4  ACCUSE_RE 零调用点     → 出口黑名单只挂了 GUILT_TRIP_RE，文档承诺的那一半不存在。
 *
 * 三次的共同根因不是粗心，而是**自检的口径错了**：所有单测都在验证"函数自己算得对不对"，
 * 没有任何一条在验证"这个函数有没有被人调用"。一个定义正确却无人调用的护栏，
 * 单测永远绿，线上永远不生效 —— 这是自检的结构性盲区，只能用结构性断言补。
 *
 * 本模块只做一件事：把 engine.js 当**文本**扫一遍，对每个符号回答
 *   "除了定义处、注释、导出清单之外，它还在别处出现过吗？"
 * 出现过 = 已接线；没有 = 悬空。刻意不做 AST 解析：AST 会把导出清单里的
 * `{ negMark }` 也算成引用，正好漏掉我们要抓的那一类；纯文本反而更严。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENGINE_PATH = path.join(ROOT, "engine.js");
/* 消费方（宿主）。engine.js 是**库**，"有没有接线"必须连宿主一起看：
 * negMinDv / negAfterTurn / dayLifeGen 在 engine 内部零调用点是正常的 —— 它们本就由 app.js 调。
 * 只扫 engine 自己会把这三个误报成悬空，只扫宿主又抓不到 ACCUSE_RE 那种引擎内部该自用的。
 * 刻意**不含 test/**：测试调用不算接线，否则 D3「写了单测但没人调」那次就又漏了。 */
const HOST_FILES = ["app.js", "openclaw.js", "server.js", "localmodel.js",
  "schedule.js", "notify.js", "caption.js", path.join("bridge", "xiaonuan-bridge.js")];

/* ---------- 1. 剥注释 ----------
 * 块注释直接删。行注释要小心：正则字面量 /(a|b)/ 里没有 //，但字符串里可能有（如 URL）。
 * 折中判据：`//` 之前的引号必须成对出现（不在字符串里），且前一个字符不是 `:`（协议头）。
 * 对自家源码足够可靠，且判错方向是"少删注释"= 多算引用 = 漏报，不会误报冤枉人。 */
function stripComments(src) {
  // 用等量换行替换块注释，保持行号与原文件一致 —— 报告里的"调用点在第几行"必须能直接跳过去。
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length));
  return noBlock.split("\n").map((line) => {
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] !== "/" || line[i + 1] !== "/") continue;
      if (i > 0 && line[i - 1] === ":") continue;          // http:// 之类
      const head = line.slice(0, i);
      const q = (ch) => (head.split(ch).length - 1) % 2 === 0;
      if (q('"') && q("'") && q("`")) return head;          // 引号都成对 → 确实是注释
    }
    return line;
  }).join("\n");
}

/* ---------- 2. 摘出导出清单 ----------
 * 顶层 IIFE 末尾的 `return { ... };`。清单里的裸名字是"对外 API 声明"，不是运行时调用，
 * 必须从引用计数里排除 —— 否则每个符号都至少有 1 次引用，扫描器等于没写。 */
function splitExports(src) {
  // 必须取**最后一个**顶层 return {...}：函数体内的 `return { n, mean }` 之类比比皆是，
  // 匹配到任意一个都会让真正的导出清单留在 body 里，清单里的裸名字随即被当成调用点 ——
  // 那正是本扫描器要抓的伪装，扫描器自己踩进去就等于全绿造假（WR-03 反测这一点）。
  // 闭合行的缩进必须与 return 行相同，避免吞掉半个文件。
  const re = /\n([ \t]*)return \{[\s\S]*?\n\1\};/g;
  let m = null, last = null;
  while ((m = re.exec(src)) !== null) last = m;
  if (!last) last = src.match(/\n[ \t]*return \{[^\n]*\};/);   // 单行清单（测试夹具）
  if (!last) return { body: src, exports: "" };
  const cut = last[0].replace(/[^\n]/g, "");                    // 用等量换行占位，保住行号
  return { body: src.slice(0, last.index) + cut + src.slice(last.index + last[0].length), exports: last[0] };
}

/* ---------- 3. 收集顶层定义 ---------- */
function collectDefs(body) {
  const defs = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    let m = line.match(/^\s*const ([A-Za-z_$][\w$]*) = (\/(?![/*])|new RegExp)/);
    if (m) { defs.push({ name: m[1], kind: "regex", line: i + 1 }); return; }
    m = line.match(/^\s*function ([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { defs.push({ name: m[1], kind: "function", line: i + 1 }); return; }
    m = line.match(/^\s*const ([A-Za-z_$][\w$]*) = (?:\([^)]*\)|[A-Za-z_$][\w$]*) =>/);
    if (m) defs.push({ name: m[1], kind: "function", line: i + 1 });
  });
  // 同名重复定义（不同作用域）只留第一处，避免一个符号被算成两个悬空
  const seen = new Set();
  return defs.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)));
}

/* ---------- 4. 统计运行时引用点 ----------
 * 逐行扫，跳过定义行本身。用词边界匹配，避免 negMark 命中 negMarkFoo。 */
function callSites(body, def) {
  const re = new RegExp("(?<![\\w$])" + def.name.replace(/\$/g, "\\$") + "(?![\\w$])");
  const out = [];
  body.split("\n").forEach((line, i) => {
    if (i + 1 === def.line) return;                  // 定义行不算引用
    if (re.test(line)) out.push(i + 1);
  });
  return out;
}

/* ---------- 5. 护栏符号判定 ----------
 * 哪些符号"必须有运行时调用点"？口径取**保守但覆盖已发生的三次事故**：
 *   ① 所有 *_RE 正则表：正则的存在意义就是被 test()，定义了不调用一定是漏接线；
 *   ② 闸门/护栏函数：G1 neg* / G2 jealous* / G3 dayLife* / Inner inner* / 出口 *Guard。
 * 纯数据表（LIB / POOL / 文案池）与工具函数不在内，它们被"引用"而非"调用"，另有覆盖。 */
const GUARD_FN_RE = /^(neg|jealous|inner|dayLife|life)[A-Z]|Guard$|^guard/;
function isGuard(def) {
  if (def.kind === "regex") return /_RE$/.test(def.name);
  return GUARD_FN_RE.test(def.name);
}

/* ---------- 6. 白名单 ----------
 * 只允许两类豁免，且每条都要写清理由：
 *   · 构造期/测试期自检工具：本就只在测试里调用（innerScan / lifePlaceScan）；
 *   · 纯对外 API：宿主调用而非引擎内部调用，引擎内零调用点属正常。
 * 白名单必须显式列举，不许写通配 —— 否则下一个漏接线的护栏又会被悄悄放行。 */
const ALLOW = {
  innerScan: "构造期自检工具：全量扫 INNER_LIB 是否越界，由测试与构建期调用，运行时本就不该跑",
  lifePlaceScan: "同上，D8 引入的 LIFE_PLACE 自检工具",
};

/* 宿主侧引用：只要在任一宿主文件里出现（非注释），就算已接线 */
function hostSites(name) {
  const re = new RegExp("(?<![\\w$])" + name.replace(/\$/g, "\\$") + "(?![\\w$])");
  const out = [];
  for (const rel of HOST_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    stripComments(fs.readFileSync(p, "utf8")).split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(rel + ":" + (i + 1));
    });
  }
  return out;
}

function scan(src) {
  const clean = stripComments(src || fs.readFileSync(ENGINE_PATH, "utf8"));
  const { body } = splitExports(clean);
  const defs = collectDefs(body);
  const rows = defs.map((d) => {
    const inner = callSites(body, d);
    const host = inner.length ? [] : hostSites(d.name);   // 引擎内有调用就不必再翻宿主
    return {
      name: d.name, kind: d.kind, def: d.line,
      sites: inner, host,
      wired: inner.length > 0 || host.length > 0,
      where: inner.length ? "engine" : (host.length ? "host" : "—"),
      guard: isGuard(d),
    };
  });
  const dangling = rows.filter((r) => r.guard && !r.wired && !ALLOW[r.name]);
  return { rows, dangling, guards: rows.filter((r) => r.guard) };
}

/* ================= v13 · 装载拓扑与体积（S0-g） =================
 * 沿用本文件的同一套哲学：不验证"模块算得对不对"，验证"模块会不会被装进来"。
 * 一个写得完美但 index.html 没写 <script>、或 sw.js 没进 ASSETS 的模块，
 * 在 Node 测试里全绿（helpers 走 engine.files.json 拼接），在浏览器里恒缺席。
 * 两条装载路径必须交叉校验，任何一条漏了都是"线上不生效"。 */

const MANIFEST_PATH = path.join(ROOT, "engine.files.json");

/* 体积配额（DESIGN §11 锁定）。engine.js 只放薄接线，语料/算法必须待在模块里；
 * 配额写死在这里而不是从文件读，是为了让"改配额"这件事必须走代码评审。
 * 审批记录：
 *   · v13 T2+T4 配额修正轮：memory 8192→12288 / texture 4096→4608 / moduleSum 16384→20480，
 *     由主理人 Qi 批准（2026-06-18）。
 *   · v13 T5a 集成修复轮：memory 12288→14336 / texture 4608→5120 / moduleSum 20480→24576，
 *     由主理人 Qi 预批（走本文件代码评审落地）。理由：T5a 五项集成修复全部落在既有模块内
 *     （待决②横向走查表挂载 / 遗留-1 职业族 tag 派生 / 遗留-2 破墙脱敏 / 遗留-4 R30 基频），
 *     engine.js 绝对零 diff，新增字节只能进模块。
 *   · v13 T5b 收尾轮：engineNetMax 2048→2060 / moduleSumMax 24576→24643 / 新增 contingency.js 1892，
 *     由主理人 Qi 预批（走本文件代码评审落地）。两项各有精确来源，不是"拍脑袋加一点"：
 *       - engineNetMax +12：A6-a 解冻 engine.js:1322（职业族折叠后再判破墙表）所需，实占 +≤56B 中的
 *         增量部分；V-33 ≤247955B 同时锁死，两把锁谁先响都算越界。
 *       - moduleSumMax = 272384 − 247741 = 24643：把"系统天花板 − 当前 engine 体积"完整让给模块侧，
 *         使 T5b 的 contingency.js 有满额 contingency 空间；天花板 totalMax 本身**一个字节都没动**。
 *     memory/presence/texture 三项配额本轮**不动** —— A6-b 的 tex.n 回写必须靠 memory.js 内部等量
 *     trim 自筹字节，不许用"顺手抬配额"绕过。 */
/*   · v14 体积决议轮（R-B0，路径 C「trim + 抬天花板」组合）：
 *     totalMax 272384→276480 / engineNetMax 2060→2200 / moduleSumMax 24643→28525 /
 *     contingency.js 1892→4096，由主理人 Qi 于 v14 立项评审批准（D-1 / D-2）；
 *     moduleSumMax 取值由架构师依算术勘误裁定为 28525，并经主理人 U-1 追认。
 *     ★ 这是 v13「266KB 硬约束」被**有意放宽**的一次 deliberate 决策，经天花板评审，非失守。
 *     四项各有精确来源，不是「拍脑袋加一点」：
 *       - totalMax +4096（266KB→270KB）：本期需求池估算上限 3.2KB，trim 后仍需的最小增量。
 *         前置义务已履行：先执行 T1 trim（memory 14326→12711 / texture 4850→4194，共 −2271B），
 *         天花板抬升只是「已尽全力压缩后仍需的部分」，用于对冲 PRD §5.4 指出的棘轮效应。
 *         trim 验收口径是机器断言：剥注释 + 去空白后代码体与 trim 前**逐位一致**（sha256 同值），
 *         被删注释原样迁入 DESIGN-v14 §13 注释档案（文档不计入体积预算，见 S-12）。
 *       - engineNetMax +140：**第二把独立锁**。trim 模块对 engine net 零帮助（两者是独立配额），
 *         而 R-P0（:1307 +16B）与 R-P2（:2897 +19B）必须改 engine.js，v13 余量仅 4B。
 *         实占 +35B，留 105B。V-33 ≤247955 同时锁死，两把锁谁先响都算越界。
 *       - moduleSumMax = totalMax − V33 = 276480 − 247955 = 28525。
 *         ★ 不是 276480 − 247793（当前 engine 体积）= 28687：后者会让
 *         engineBase + engineNetMax + moduleSumMax 之和越过 totalMax 162B，
 *         被 A1-a 的结构性断言判红。取 28525 保证三锁自洽（打满时 total 恰等于 276480）。
 *       - contingency.js 1892→4096：恢复 v13 §2.6 原始规划配额。R-C4/R-C5/R-S1 三项
 *         全部落此模块（PRD N3 不新建模块文件，避免装载序 + 缓存键的 C0-b 同族事故）。
 *     memory/presence/texture 三项配额本轮**不动** —— trim 已腾出足够空间，
 *     不许用「顺手抬配额」绕过 trim 义务。 */
/*   · v15 R-C5 落地轮：contingency.js 4096→4973，**且仅此一项**，
 *     由主理人 Qi 于 v15 立项评审批准（裁定 U-3）。取值有精确推导，不是「拍脑袋加一点」：
 *       - 必要性：v14 交付态 contingency.js = 4086B，距 4096 仅余 10B。R-C5（c4 好奇追问 /
 *         c5 共同回忆 + :43 选择器 find→PW(filter) 修复）实测净增 428B → 落地 4514B，
 *         原配额必红。PRD 估算值是 420B，实测 428B，差 8B 已由主理人按实测口径追认（U-3）：
 *         验收改钉「增量 ≤470B **且** contingency.js ≤4973」—— 硬锁是 4973，不是 420。
 *       - 取值：4973 = moduleSumMax − memory − presence − texture = 28525 − 14336 − 4096 − 5120。
 *         即把模块侧配额的**全部剩余额度**一次划给 contingency，四项配额之和恰等于 moduleSumMax，
 *         moduleSum 打满时不多不少 = 28525，与 A1-a 的三锁自洽结构断言保持一致。
 *     ⚠ v16 预警（U-7 存档，不阻塞 v15）：本次取满后 contingency 已顶到 **moduleSum 自洽天花板**。
 *       v16 若还要动 contingency，只能谈抬 moduleSumMax，或从 memory/presence/texture 让渡额度
 *       —— 两者都属破锁决策，必须单独立项评审，不许在实现轮里顺手改这一行。
 *     ★ 体积四锁除本项外**一个字节都没动**：totalMax 276480 / engineNetMax 2200 /
 *       moduleSumMax 28525 / V-33(engine.js ≤247955) 全部原值锁死。NOTE-2 的 +13B 走
 *       engineNet 既有余量（2087→2100，仍在 2200 以内），不申请任何配额。 */
/*   · v15 Q-V15-1 修复轮（H13 一票否决项回补）：**配额一个字节都没动**，只重置基线数字。
 *     背景：NOTE-2 删掉段 1 裸词 `模型|` 后，段 3 副词槽 `(?:不过?|其实|就)?` 接不住
 *     「我们**都**是模型训练的」—— 匹配在系动词位断裂，195 条组合成为本期引入的新回归。
 *     修复是 :1307 单行逐位替换（副词槽补全为 `(?:不过?|其实|确实|本来|终究|无非|毕竟|真的)?
 *     [都也还只就]{0,2}`），实测净 +60B ⇒ engineNet 2100→2160，**仍在 engineNetMax 2200 以内**，
 *     故属「花既有余量」而非「抬配额」，不需要新的配额审批（S-2 只管配额，不管余量怎么花）。
 *     ★ 严禁用「加裸词 `模型训练|`」的方式绕过 —— 那会触犯 T2·U-5 破墙表裸词守卫。
 *   · QA 方法学纠正（QA-ACCEPTANCE-v15 NOTE-1）：engine.js 的**真实硬上限**是
 *     engineBase + engineNetMax = 245737 + 2200 = **247937**，不是 v13/v14 文档沿用的 247955。
 *     两者差 18B —— 247955 是 v13 时期写死的**兜底锁**，比 engineNet 锁宽 18B，永远不会先响，
 *     照它排预算会**超卖 18B**。故本轮把真实上限提升为 SIZE_BUDGET 的派生字段 `engineMax`，
 *     由本文件单一供给（DESIGN-v15 §7 S-2：配额真相源只此一处），测试侧不再硬编码 247955。
 *     ⚠ 唯一保留 247955 字面量的地方是 qa-v13-t2t4-fix.test.js A1-a 的「三锁自洽」会计恒等式：
 *       该式断言「未分配余量(18B) 恰等于两把 engine 锁的设计性间隙(V33 − engineCap)」，
 *       是 v14 D-2 有意留下的结构，改它等于改 moduleSumMax 配额，必须单独立项评审。 */
/*   · v16 T0 预算重谈轮（V16-3，路径 A「让渡，不抬系统天花板」）：
 *     engineNetMax 2200→2400 / engineMax 247937→248137 / moduleSumMax 28525→28343 /
 *     memory.js 14336→14154，由主理人 Qi 于 v16 立项裁定批准（Q1 追认，含 §5.0 连带项）。
 *     ★ 源码侧 0 字节改动：本轮**只谈配额**，不 trim 任何模块源码，不动 engineBase，不动 totalMax。
 *     四项各有精确推导式，不是「拍脑袋加一点」：
 *       - engineNetMax +200：V16-2（:1307 破墙表四轴扩展，H13 由「抽样 0 泄漏」升级为
 *         「六维全组合 1,034,880 组合 0 漏网」）实测最小代价 +190B，而 v15 交付态余量仅 40B
 *         （engineNet 2160/2200）—— **不先抬配额，V16-2 物理上写不进去**。取 200 而非 256：
 *         架构师选型 E1 实测 +190B，落位 2350，余 50B，Δ=200 已够用且不多占天花板。
 *         ⚠ 模块侧 moduleSum 看似余 2722B，但那 2722B 对 engine net **零帮助** ——
 *         两者是两把独立锁（v14 审批链已明确），engine 缺字节只能谈 engineNetMax。
 *       - engineMax = engineBase + engineNetMax = 245737 + 2400 = 248137（派生量，非配额项，
 *         下方加载期自证把守；同时它也是 A1-a 会计恒等式里 V33 兜底锁的新取值，见次条）。
 *       - moduleSumMax = totalMax − engineMax = 276480 − 248137 = 28343（−182）。
 *         ★ 口径变更（§5.0）：v14/v15 该式右端用的是**硬编码兜底锁 V33=247955**，它比
 *         engineNet 锁宽 18B、永不先响。v16 抬顶后两把 engine 锁**重合**（V33 := engineMax = 248137），
 *         设计性间隙 18B → **0**，三锁松弛亦 → **0**（245737+2400+28343 = 276480 = totalMax，打满即恰好）。
 *         这是路径 A「不破 270KB 承诺」的固有代价，已由主理人 Qi 明示知悉并追认（裁定 Q1）。
 *         ⚠ 后果：v16 之后**任何**字节级扩张都必须重新谈预算，不存在任何免费额度。
 *       - memory.js 14336→14154（−182）：让渡额度精确等于 moduleSumMax 的减量，使 ② Σ配额
 *         === moduleSumMax 严格等式继续成立。让渡的是**配额空转额度**：memory.js 实测 13371B，
 *         让渡后仍余 783B，零功能影响、零源码改动（不许借「让渡」之名行 trim 之实）。
 *         presence 4096 / texture 5120 / contingency 4973 三项**一个字节都没动**
 *         —— contingency 已顶到 moduleSum 自洽天花板（v15 U-7 存档），本轮不再从它身上取。
 *     四锁恒等式复算（scanSizes() 直驱实测，非引用文档算术）：
 *       ① 248137 = 245737 + 2400                                  ✓（加载期自证）
 *       ② 14154 + 4096 + 5120 + 4973 = 28343 = moduleSumMax        ✓
 *       ③ 245737 + 2400 + 28343 = 276480 ≤ 276480（松弛 0）        ✓
 *       ④ 14154>13371 / 4096>3557 / 5120>4357 / 4973>4518          ✓
 *     ★ 风险登记（S-2 铁律要求写明）：本轮把「松弛」与「兜底间隙」双双归零，
 *       体积体系从「有缓冲」进入「打满即恰好」态。v17 起改动 engine.js 或任一模块前，
 *       必须先做配额评审 —— 不得再假定「反正还有余量」。 */
/* ★★【v17 T0 预算 gating 轮 · 主理人 Qi 批准（PRD-v17 §4 选项 A / DESIGN-v17 §2.5 唯一自洽解）】★★
 *     路径：**模块 → engine 让渡 Δ=+400，totalMax 一个字节都不抬**（270KB 承诺继续守住）。
 *     主方程（③ 取等，v16 已进入「打满即恰好」态，不许倒退）：
 *       engineNetMax + moduleSumMax = totalMax − engineBase = 276480 − 245737 = 30743
 *       取 Δ=+400 ⇒ engineNetMax 2400→2800、moduleSumMax 28343→27943、engineMax 248137→248537。
 *     Δ 的下界由 engine 侧造价反推（DESIGN-v17 §2.2）：pnorm 声明 105 + :1322 收口 −29 +
 *       R2-A5b 回避型终止语 69 + 归一化接线 6×7 + selfTick 防重放 90 + 导出 7 + 容差 16 = 300
 *       ⇒ engineNetMax ≥ 2350 + 300 = 2650；取 2800 留 150B 缓冲（Δ=250 余量 0，违反 R4 风险登记，否决）。
 *     ⚠ PRD §4 的自洽示例**欠一步**（架构师勘误 ②）：moduleSumMax −400 与 contingency +445
 *       是**两笔账**，必须由 memory/presence/texture 三者同额让渡 845B 补回，否则 Σ配额 = 28788
 *       ≠ 27943，锁 ② 直接破。故本轮四个模块配额按分配规则 R-Q 重新求解：
 *       三个让渡模块取「v17 预测实测 + ≥240B 缓冲」的最近 KiB/半 KiB/四分之一 KiB 边界（可审计、可口算），
 *       contingency 取残差（沿用 v15 U-3 的既有推导范式 4973 = 28525−14336−4096−5120）：
 *         memory.js    13331+240=13571 → 13824 (13.5KiB)  让渡 −330
 *         presence.js   3566+240= 3806 →  3840 (3.75KiB)  让渡 −256
 *         texture.js    4366+240= 4606 →  4608 (4.5KiB)   让渡 −512
 *         contingency  = 27943 − (13824+3840+4608) = 5671（相对 4973 为 +698，R-S2 载体）
 *       净核对：−1098 + 698 = −400 = ΔmoduleSumMax ✓
 *     四锁恒等式复算（scanSizes() 直驱实测，非引用文档算术）：
 *       ① 248537 = 245737 + 2800                                     ✓（加载期自证）
 *       ② 13824 + 3840 + 4608 + 5671 = 27943 = moduleSumMax           ✓（严格等式）
 *       ③ 245737 + 2800 + 27943 = 276480 ≤ 276480（松弛仍为 0）       ✓
 *       ④ᵀ⁰ 13824>13371 / 3840>3557 / 4608>4357 / 5671>4518           ✓（T0 时点，源码 0 diff）
 *       ④ᵀ⁴ 13824>13331 / 3840>3566 / 4608>4366 / 5671>5391           ✓（T4 交付时点）
 *       ⑦ A1-a 硬编码 V33 := engineMax = 248537（漏改即 T0 首日两红，v16 §5.0 教训）
 *     ⚠ 让渡的仍是**配额空转额度**，不是 trim：memory/presence/texture 三个文件本轮
 *       只做归一化收口（净 −38B），让渡后各留 ≥242B 缓冲，零功能影响。
 *     ⚠ R-S2 硬顶：contingency 交付 ≤5671 ⇒ 净增上限 5671−(4518−27)=1180B，设计值 900B。
 *       写超先砍语料条数（每型 3→2），**不许**申请第二次配额（那会破坏本轮锁定的 Δ=+400）。 */
/* ★★【v18 T0 预算 gating 轮 · 主理人 Qi 批准（PRD-v18 §4.4 选项 A / A2 档 · DESIGN-v18 §2.3 唯一自洽解）】★★
 *     路径：**纯模块侧内部重分配**——顶层三值（engineNetMax / engineMax / moduleSumMax）与
 *       两条红线（engineBase / totalMax）**一个字节都不动**，只在 moduleSumMax 这一个总额内部四项重切。
 *     分配规则 R-Q'（本轮弃用 v17 的 KiB 边界法，改「实测 + 固定缓冲 B=32」）：
 *       理由：memory 实测 13333，最近半 KiB 下边界 13312 < 实测（破锁 ④），上边界仍是 13824（让渡 0）
 *       ⇒ 边界法本轮**可行解为空**；且本轮目标正是榨出闲置，「好看的边界」与目标直接冲突。
 *       B=32 是可行域内唯一整解：B=0 任一字节改动即破锁 ④（脆性不可接受）；
 *       B=64 只给 contingency 剩 834B < ~900B 语料目标，须立刻走砍语料降级。
 *         memory.js     13333+32 = 13365  让渡 −459
 *         presence.js    3566+32 =  3598  让渡 −242
 *         texture.js     4366+32 =  4398  让渡 −210
 *         contingency   = 27943 − (13365+3598+4398) = 27943 − 21361 = 6582（+911，v19 语料备粮）
 *       让渡分录双向核对（v17 勘误 ② 的教训，两笔账必须对平）：
 *         让渡方合计释放 = 459+242+210 = 911；contingency 接收 = 6582−5671 = 911；
 *         净变化 = −911+911 = 0 = ΔmoduleSumMax ✓（moduleSumMax 不变，故必须严格对平）
 *     四锁恒等式复算（scanSizes() 直驱实测，非引用文档算术）：
 *       ① 248537 = 245737 + 2800                                     ✓（三项全未触碰，加载期自证必然通过）
 *       ② 13365 + 3598 + 4398 + 6582 = 27943 = moduleSumMax           ✓（严格等式 · 明细 13365+3598=16963；+4398=21361；+6582=27943）
 *       ③ 245737 + 2800 + 27943 = 276480 ≤ 276480（松弛仍为 0）       ✓（四项全冻结）
 *       ④ᵀ⁰ 13365>13333(32) / 3598>3566(32) / 4398>4366(32) / 6582>5652(930)  ✓（T0 时点，源码 0 diff）
 *       ④ᵀ⁴ 同 ④ᵀ⁰ 逐值相同 ✓ —— v18「先备粮、后开火」，本轮不落任何 contingency 语料，
 *            四模块源码全程冻结（DESIGN-v18 §1.4），故 T0 与 T4 两时点实测完全相同。
 *     ⑦ ★★【v18 无 V33 翻转 · 显式书面声明（PRD-v18 P0-3 要求）】★★
 *       推导链：① A2 是纯模块侧重分配 ⇒ engineNetMax 不变(2800)；② engineMax = engineBase + engineNetMax，
 *       两加数都不变 ⇒ engineMax 不变(248537)；③ V33 := engineMax（派生常量，非独立真源）⇒ V33 不变(248537)。
 *       ∴ 三处硬编码点（本文件 :291 / qa-v13-t2t4-fix.test.js:117 / qa-v16-size-probe.js:74）
 *         **同步条目数 = 0，一处都不改**。但 T4 仍须实读取证三处均为 248537（"不改"也要证明"确实没被改"）。
 *       ⚠ 写给 v19+：V33 是派生常量。一旦哪版动了 engineNetMax（如走 PRD §4.2 选项 B 从 engine 侧让渡），
 *         上述三处**必须在同一个 PR 内同步改完**，漏一处即 T0 首日两红（v16 §5.0 / v17 P0-3 双重教训）。
 *     🔴🔴 硬纪律（工程师必读 · DESIGN-v18 §2.5 第一风险项）🔴🔴
 *       **v18 起，memory.js / presence.js / texture.js 的任何字节增量（含注释、含空格、含一个标点）
 *       都必须先重谈配额** —— 32B ≈ 10 个汉字，不构成「可以随手改一点」的许可。
 *       三者中 memory.js 最危险：它是 12 个 pnorm 消费点里唯一有**两个**消费点（:100 / :107）的模块，
 *       未来任何归一化口径调整都会同时命中两处，一次改动即可能超 32B。
 *       重谈路径（不得跳步）：① 从 contingency 的 930B 余量回让（Σ 不变，最廉价）
 *         → ② PRD §4.2 选项 B（engine 让渡 ≤142B，**须 V33 三处同步**）→ ③ 最后才考虑选项 C/D。
 *     ⚠ contingency 的 930B 是**为 v19 预留的可用额度，不是本轮消耗**；本轮 contingency 源码零改动。 */
/* ★★【v19 · contingency 三锁归一 · 主理人 Qi 批准（PRD-v19 Q1 推荐案 / DESIGN-v19 §3）】★★
 *     本轮 SIZE_BUDGET **一个字节不改**（零预算版本）：九个数值逐位不变，
 *     四锁 ①②③④ 逐位不变，V33 三针（本文件 / qa-v13-t2t4-fix.test.js:117 /
 *     qa-v16-size-probe.js:74）同步条目数 = 0，天然不翻转。
 *     v19 改的不是数字，是**「谁有资格写这个数字」的拓扑**：
 *       · v17 遗留的残差锁（≤5671）与净增锁（≤1180）两个**平行字面量**，
 *         已从 4 个测试文件（qa-v15-t1 / qa-rs2-type / qa-v17-independent-size /
 *         qa-v16-size-probe）**全部移除**，改由本表派生：
 *             CEILING := SIZE_BUDGET["contingency.js"]
 *             NET_MAX := SIZE_BUDGET["contingency.js"] − V16_ANCHOR(4518)
 *         两者都**没有独立的可写位置**，改配额即自动跟随。
 *       · ∴ 上方 v17 历史块 :286 的「≤5671 ⇒ 净增上限 1180」是**历史审批记录**，
 *         v19 起**不再生效**；保留仅作审计轨迹（§3.4 裁定：历史块逐字不动），
 *         **禁止**据此写新断言、也禁止把它当作 contingency 的现行上限。
 *     ⑧ 新增恒等式：V16_ANCHOR(4518) + NET_MAX ≡ SIZE_BUDGET["contingency.js"]
 *       ⇒ 有效天花板 = min(配额, 残差锁, 净增锁) 三者恒重合于同一个值，
 *         「改了配额忘了另一把锁」这一缺陷类别在结构上消失（v16/v17/v19 已复发 3 次）。
 *     ⇒ 三锁归一：**配额即上限，contingency 不再有任何独立的残差锁**。
 *       下方 "contingency.js" 行尾注释所称的余量自此为**实数**（6582 − 5652 = 930），
 *       而非宣称值；此前有效天花板被残差锁压到 5671，真实余量其实只有 19B。
 *     ⚠ 本文件 v19 只加本注释块 + 行尾注释订正，**逻辑、导出、九个预算值全部零改动**。
 *     ⚠ 四模块字节的 diff=0 门禁另落在 test/qa-v19-quota-gate.js（独立探针，不在本文件加
 *       任何断言/throw —— 本文件被 12+ 测试 require，加载期 throw 会连锁染红全套）。 */
/* ★★【v20 · R-S2 语料首次真实消费 · 主理人 Qi 批准（PRD-v20 / DESIGN-v20 §0）】★★
 *     本轮 SIZE_BUDGET **九值依旧一个字节不改**。请务必分清两件事：
 *       v19 = 「零预算」——谁都没花钱；
 *       v20 = 「**在既有配额内花钱**」——contingency.js 首次真实消费额度，但配额本身不动。
 *     ⇒ 四锁 ①②③ 逐位不变，⑧ 逐位不变，V33 三针（本文件 / qa-v13-t2t4-fix.test.js:117 /
 *       qa-v16-size-probe.js:74）同步条目数 = 0，天然不翻转。
 *     ④ 唯一右移项：contingency 6582>5652 → 6582>6270（Δ+618，余量 311B，仍成立）。
 *
 *     ★★ 929B 一字节边界（v21 请先读这三行，否则落地首日门禁转红）★★
 *       配额 6582 → 门禁锁④允许的最大实测字节 = 6582 − 1 = 6581 → 自 5652 起安全 Δ = **929B**。
 *       成因：两把锁的**比较符不一致**，这不是缺陷，是语义差异的正确外显 ——
 *         · 门禁锁④ `B[f] > T0_BYTES[f]`（严格 >，qa-v19-quota-gate.js）
 *           语义是「配额必须严格宽于基线」，它**拒绝零余量**（相等 = 下一个字节就击穿的假安全态）；
 *         · 业务锁 `b <= CEILING`（qa-rs2-type.test.js / qa-v15-t1.test.js）
 *           语义是「不许超配额」，用满配额不算违规。
 *       ⇒ Δ=930 时门禁判 `6582 > 6582` = false **转红**，而业务测试判 `6582 <= 6582` = true **仍绿**。
 *         **业务侧对这次越界毫无察觉。** 已由 test/qa-v20-ceiling-drill.js 固化为可复跑取证。
 *       ⚠ 排预算铁律：任何后续版本按 **929** 排，不按 930 排。若确需用满第 930 个字节，
 *         那不叫「用满余量」，那叫**配额重谈**，必须走三件套。
 *
 *     ⚠ 本文件 v20 只加本注释块 + contingency 行尾注释订正（930→929 口径），
 *       **逻辑、导出、九个预算值全部零改动**；上方 v14/v16/v17/v18/v19 历史块逐字不动。 */
/* ★★【v21 · 配额重谈首秀 · 路径③ · 主理人 Qi 批准（PRD-v21 / DESIGN-v21 §1.1）】★★
 *     与 v19（零预算）、v20（配额内消费）都不同：**v21 是本项目第一次真正移动配额边界**。
 *     触发需求：contingency.js 追加第 5 语料型（repair），造价实测 +356B，
 *     而 v20 收线后 contingency 的门禁可用量仅剩 311B（配额 6582 − 基线 6270，且锁④ 用严格 >）
 *     ⇒ 装不下，必须重谈。
 *
 *     ── 路径③（engine 让渡 D=100）逐级推导，四锁两边同移 ──────────────
 *       engineNetMax  = 2800 − 100            = 2700
 *       engineMax(V33)= 245737 + 2700         = 248437     ← 派生，非独立真源
 *       moduleSumMax  = 276480 − 248437       = 28043      ← 锁② 右移 100（Q3 已批）
 *       contingency   = 6582  + 100           = 6682       ← 受援方
 *       memory/presence/texture 三项**逐位不动**（13365 / 3598 / 4398）。
 *
 *     ── 四锁 + ⑧ 复算（node 实算，非纸面）──────────────────────────
 *       ① 248437 = 245737 + 2700                                      ✓（加载期自证）
 *       ② 13365 + 3598 + 4398 + 6682 = 28043 = moduleSumMax           ✓（严格等式）
 *       ③ 245737 + 2700 + 28043 = 276480 ≤ 276480（松弛仍为 0）        ✓（totalMax 未抬顶）
 *       ④ᵛ²¹ 13365>13333(32) / 3598>3566(32) / 4398>4366(32) / 6682>6626(56)  ✓
 *       ⑧ V16_ANCHOR 4518 + NET_MAX 2164 = 6682                       ✓（派生，自动跟随）
 *
 *     ★ engineNetMax 收紧 100B 的安全性：engine.js 本轮**零改动**，实测 net 仍为 2658，
 *       2658 ≤ 2700 成立，余 42B。让渡后 engine 侧余量由 142B 收到 42B —— 这是**有代价的**，
 *       下一次 engine 侧增量超过 42B 就必须再次重谈，主理人已明示知悉并追认。
 *
 *     ⚠ V33 多针：engineMax 一旦变动，**所有平行字面量必须同步翻转**（DESIGN-v21 §1.2 表 B）。
 *       实读工作区确认的针位远多于「三针」之说，完整清单见 DESIGN-v21 §1.2。
 *     ⚠ 本文件 v21 只加本注释块 + 四个真源值与其行尾注释；
 *       上方 v14/v16/v17/v18/v19/v20 历史块**逐字不动**（qa-v16-size-probe.js:87/:89
 *       正则断言 v16/v17 块内的旧数字字样存在，改写历史块会立刻转红）。 */
const SIZE_BUDGET = {
  engineBase: 245737,      // 反向保护项，永不许动（v12 收线时的 engine.js 字节数）
  engineNetMax: 2700,      // 改配额必须走代码评审 · 主理人 Qi 于 v21 批准 2800→2700（路径③：engine 让渡 D=100B 予 contingency，见上方 v21 审批块）· 让渡后 engine 侧实测 2658，余 42B
  engineMax: 248437,       // 派生量 = engineBase + engineNetMax（V-33 真实硬上限；非配额项，改上面两项即自动失配，见下方自洽断言）· v21 随让渡同步 248537→248437 ⇒ V33 多针必须同步翻转（清单见 DESIGN-v21 §1.2 表 B）
  "memory.js": 13365,      // 改配额必须走代码评审 · 主理人 Qi 于 v18 批准 13824→13365（让渡 459B 予 contingency · 实测 13333 + 32B 缓冲，★极紧，任何增量须先重谈配额）
  "presence.js": 3598,     // 改配额必须走代码评审 · 主理人 Qi 于 v18 批准 3840→3598（让渡 242B 予 contingency · 实测 3566 + 32B 缓冲，★极紧，任何增量须先重谈配额）
  "texture.js": 4398,      // 改配额必须走代码评审 · 主理人 Qi 于 v18 批准 4608→4398（让渡 210B 予 contingency · 实测 4366 + 32B 缓冲，★极紧，任何增量须先重谈配额）
  "contingency.js": 6682,  // 改配额必须走代码评审 · 主理人 Qi 于 v21 批准 6582→6682（路径③ 受援方 +100B，源自 engine 让渡；见上方 v21 审批块）· v21 实测 6626（第 5 语料型 repair 落地 +356B，T0 基线已同步迁移），配额余量 56B；★门禁锁④用严格 >（B[f] > T0_BYTES[f]），故自 6626 起的安全 Δ 上限是 55B 而非 56B —— 第 56B 会让「配额 > 基线」失效（业务锁用 ≤，对此毫无察觉），口径同下方 v20 块的 929B 推导
  moduleSumMax: 28043,     // 改配额必须走代码评审 · 主理人 Qi 于 v21 批准 27943→28043 = totalMax − engineMax(248437)（锁② 两边同移，Q3 已批）
  totalMax: 276480,        // 改天花板必须走代码评审 · 主理人 Qi 于 v14 批准 272384→276480（266KB→270KB）· v17 不动
};

/* engineMax 是派生量，不是独立配额 —— 一旦有人只改 engineBase/engineNetMax 而忘了它，
 * 上限就会悄悄失真（正是 247955 这个错值当年的成因）。加载期即刻自证，不给漂移留窗口。 */
if (SIZE_BUDGET.engineMax !== SIZE_BUDGET.engineBase + SIZE_BUDGET.engineNetMax) {
  throw new Error("SIZE_BUDGET.engineMax 与 engineBase + engineNetMax 失配："
    + SIZE_BUDGET.engineMax + " ≠ " + (SIZE_BUDGET.engineBase + SIZE_BUDGET.engineNetMax));
}

/* 读装载清单。缺文件 → 返回 null，调用方据此判定"退化为单文件模式"。 */
function loadManifest() {
  try {
    const cfg = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return {
      order: Array.isArray(cfg.order) ? cfg.order : [],
      optional: Array.isArray(cfg.optional) ? cfg.optional : [],
    };
  } catch (e) { return null; }
}

/* 从 index.html 抠出 <script src="xxx.js"> 的顺序（只取同目录相对路径，忽略 CDN/绝对 URL）。 */
function htmlScripts() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const s = m[1].trim();
    if (/^(https?:)?\/\//.test(s) || s.startsWith("/")) continue;
    out.push(s.replace(/^\.\//, ""));
  }
  return out;
}

/* 从 sw.js 抠出 CACHE 版本号与 ASSETS 清单（纯文本，不执行 SW 代码）。 */
function swManifest() {
  const src = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const mv = src.match(/const\s+CACHE\s*=\s*["']xiaonuan-v(\d+)["']/);
  const ma = src.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/);
  const assets = [];
  if (ma) {
    const re = /["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(ma[1]))) assets.push(m[1]);
  }
  return { version: mv ? parseInt(mv[1], 10) : -1, assets };
}

/* WR-13 的取证主体：把「清单 / HTML / sw」三方对齐结果算成一张表。 */
function scanLoaders() {
  const man = loadManifest();
  const scripts = htmlScripts();
  const sw = swManifest();
  const order = man ? man.order : [];
  const modules = order.filter((f) => f !== "engine.js");
  return {
    manifest: man,
    scripts,
    sw,
    modules,
    // 清单里声明的每个文件都得真的存在（否则浏览器 404、Node 静默跳过 → 半更新态）
    missingFiles: order.filter((f) => !fs.existsSync(path.join(ROOT, f))),
    // HTML 里必须按清单顺序出现（子序列比对：允许 localmodel/app 等夹在后面）
    htmlOrder: scripts.filter((s) => order.includes(s)),
    // sw ASSETS 必须逐个覆盖（带 "/" 前缀）
    missingAssets: order.filter((f) => !sw.assets.includes("/" + f)),
  };
}

/* V-90 的取证主体：逐文件字节数 + 三层配额判定。 */
function scanSizes() {
  const sizeOf = (f) => {
    const p = path.join(ROOT, f);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  };
  /* Tier2 的 contingency.js 是 optional：不存在时 sizeOf 返 0，既不进 over 也不撑 moduleSum，
   * 于是"未交付"与"交付且达标"两种状态都判绿 —— 与 engine.files.json 的 optional 语义一致。 */
  const mods = ["memory.js", "presence.js", "texture.js", "contingency.js"];
  const each = {};
  for (const f of mods) each[f] = sizeOf(f);
  const engine = sizeOf("engine.js");
  const moduleSum = mods.reduce((a, f) => a + each[f], 0);
  return {
    each,
    engine,
    engineNet: engine - SIZE_BUDGET.engineBase,
    moduleSum,
    total: engine + moduleSum,
    over: mods.filter((f) => each[f] > SIZE_BUDGET[f]),
  };
}

module.exports = {
  scan, stripComments, splitExports, collectDefs, callSites, isGuard, ALLOW, ENGINE_PATH,
  MANIFEST_PATH, SIZE_BUDGET, loadManifest, htmlScripts, swManifest, scanLoaders, scanSizes,
};
