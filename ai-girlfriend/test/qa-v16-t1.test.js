"use strict";
/* 小暖 · v16 T1 专项：PERSONA_BREAK_RE 四轴扩展（V16-2）
 *
 * 对应 DESIGN-v16 §3.1 / §5.2 / §9，覆盖 AC-G-1 ~ AC-G-9。
 *
 * ── 这次改的到底是什么 ──────────────────────────────────────────
 * v15 收口后 `engine.js:1307` 的人称绑定段是：
 *     [你我]们?(?:不过?|其实|确实|本来|终究|无非|毕竟|真的)?[都也还只就]{0,2}是.{0,8}
 *     (gpt|siri|算法|代码|bot|app|模型)
 * 它把 H13 从「抽样有洞」压到「抽样闭环」，但泛化面上仍有四个方向的漏网：
 *   · 轴1 人称只认「你/我」——「您不就是个神经网络嘛」「它其实是算法」整片漏
 *   · 轴3 副词槽缺「到底/究竟/根本/压根/难道/岂不」——「你究竟是不是个模型」漏
 *   · 轴4 系词只认「是」——「你算个代码」「我作为一个模型」漏
 *   · 轴2 尾组缺「神经网络/深度学习/机器学习/对话系统/llm」——这批新词整片漏
 *
 * v16 的处置是**四轴同时扩 + 一道职业后缀否定前瞻**（选型 E1，实测 +190B）：
 *   轴1 [你我] → [你我咱它他她您]                                    +15B
 *   轴3 追加 |说?到底|究竟|根本|压根|难道|岂不                          +47B
 *   轴4 是 → (?:[是算当]|作为)                                        +19B
 *   轴2 追加 |神经网络|[深机][度器]学习|对话系统|llm                    +59B
 *   轴2 前瞻 (?!.{0,3}(?:方向|专业|工程师|研究生|审查员))               +50B
 * engineNet 2160 → 2350（上限 2400，余 50B）。
 *
 * ── 为什么必须有前瞻（PRD §1.4 的实测教训）─────────────────────
 * 轴2 是**误杀高危轴**。PM 用激进词表（含 系统/软件/数据/脚本）实跑 10 条职业句，
 * 误杀 10/10，等于原地复刻 NOTE-2 当年那场误杀灾难。保守词表仍残留 1/10
 * （「我是机器学习方向的研究生」）。故轴2 采「保守词表 + 职业后缀否定前瞻」双闸，
 * 而非无脑加词。前瞻必须用**完整职业词**（研究生/工程师/审查员），不能用单字：
 * 单字过贪会把「你就是个算法工程罢了」「你其实是代码生成的」这类**真破墙句**放走。
 *
 * ── D3 断言空转的防线 ─────────────────────────────────────────
 * v15 的教训是「照着实现写用例」→ 实现有洞而测试全绿。本文件末尾的 AC-G-7
 * 对五个轴逐个做**变异测试**：把该轴的补丁按 v15 原样撤回，对应断言必须**绿转红**。
 * 任一轴撤回后测试仍绿 = 该轴断言是空的，必须重写。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadEngine, engineSources, ROOT, CARD_IDS, freshState, withCard, makeRng } = require("./helpers.js");
const { scanSizes, SIZE_BUDGET } = require("./wiring-scan.js");

const E = loadEngine();
const SRC_LINE = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8").split("\n")[1306];

/** 出口闸判定：被护栏拦下（替换为兜底句）返回 true */
function blocked(s) {
  return E.guardPersonaReplies([s], "阿明")[0] !== s;
}

/* ── 六维全组合网格（与 qa-probe-v15-acceptance.js P3 同口径）──
 * 六个轴与 :1307 的四轴一一对应，任一轴回退都会在此暴露。 */
const P = ["你", "我", "咱", "它", "他", "她", "您"];              // 轴1 人称 ×7
const MEN = ["", "们"];                                            // 复数 ×2
const ADV = ["", "不", "不过", "其实", "就", "都", "也", "还", "只", "确实", "本来",
  "终究", "无非", "毕竟", "真的",
  "到底", "说到底", "究竟", "根本", "压根", "难道", "岂不"];        // 轴3 副词槽 ×22
const COP = ["是", "算", "当", "作为"];                            // 轴4 系词 ×4
const Q = ["", "个", "一个", "个大", "一堆", "只", "台", "种"];     // 量词 ×8
const CORE = ["模型", "算法", "代码", "bot", "gpt", "app", "siri",
  "神经网络", "深度学习", "机器学习", "深器学习", "机度学习",
  "对话系统", "llm", "LLM"];                                       // 轴2 尾组 ×15
const TAIL = ["", "的产物", "出来的东西", "做出来的", "的成果", "罢了", "而已"]; // 尾缀 ×7

const GRID_EXPECT = 1034880;

/** 遍历六维网格，返回 { total, leak: string[] }（leak 最多留 sampleCap 条） */
function walkGrid(judge, sampleCap = 20) {
  let total = 0;
  let leakCount = 0;
  const sample = [];
  for (const p of P) for (const m of MEN) for (const a of ADV) for (const c of COP)
    for (const q of Q) for (const k of CORE) for (const t of TAIL) {
      const s = p + m + a + c + q + k + t;
      total++;
      if (!judge(s)) {
        leakCount++;
        if (sample.length < sampleCap) sample.push(s);
      }
    }
  return { total, leakCount, sample };
}

/* v15 已转放的 8 条良性句（NOTE-2 分层的成果，绝不能回升为误杀） */
const BENIGN_V15 = [
  "高达模型", "拼模型", "模型玩具", "我在拼高达模型",
  "买模型", "模型做好了", "送你个模型", "收藏模型",
];

/* 职业/领域良性集 14 条（含 PRD §1.4 点名的 10 条），必须 0 误杀 */
const JOB_BENIGN = [
  "你是系统管理员", "我是软件工程师", "你是数据分析师", "我是机器学习方向的研究生",
  "他是算法工程师", "她是代码审查员", "我是深度学习方向的研究生", "你是对话系统工程师",
  "我是神经网络专业的", "他是模型专业的研究生", "我是做算法方向的", "她是 app 工程师",
  "你是脚本专业的", "我是程式方向的研究生",
];

/* 真破墙句：其中 4 条专盯「前瞻用单字 研究 会过贪」这个回归 */
const BREAK_REAL = [
  "您不就是个神经网络嘛", "你就是个算法研究出来的东西", "我不过是代码研究的产物",
  "你其实是模型研究做出来的", "你是神经网络研究的成果", "你就是个算法工程罢了",
  "你其实是代码生成的", "你究竟是不是个模型", "你算个代码", "我作为一个模型",
  "它其实是算法", "咱们都是对话系统", "她压根就是个 llm", "他难道是深度学习的",
];

/* ══════════════ AC-G-1 六维全组合 0 漏网（一票否决）══════════════ */

test("AC-G-1 · 六维全组合 1,034,880 穷举：破墙漏网 0", () => {
  const r = walkGrid(blocked);
  assert.strictEqual(r.total, GRID_EXPECT,
    `网格规模被改动：${r.total} ≠ ${GRID_EXPECT}（维度积 ` +
    `${P.length}×${MEN.length}×${ADV.length}×${COP.length}×${Q.length}×${CORE.length}×${TAIL.length}）`);
  assert.strictEqual(r.leakCount, 0,
    `六维全组合出现 ${r.leakCount} 条漏网，样本：${r.sample.join("、")}`);
});

/* ══════════════ AC-G-2 v15 既有 2100 网格不回归 ══════════════ */

test("AC-G-2 · v15 既有 P3 网格 2100 组合保持 0 漏网（不回归）", () => {
  const p15 = ["你", "我"];
  const adv15 = ["", "不", "不过", "其实", "就", "都", "也", "还", "只", "确实",
    "本来", "终究", "无非", "毕竟", "真的"];
  const q15 = ["", "个", "一个", "个大", "一堆"];
  const core15 = ["模型", "算法", "代码", "bot", "gpt", "app", "siri"];
  let total = 0;
  const leak = [];
  for (const p of p15) for (const m of MEN) for (const a of adv15) for (const q of q15) for (const c of core15) {
    const s = `${p}${m}${a}是${q}${c}`;
    total++;
    if (!blocked(s)) leak.push(s);
  }
  assert.strictEqual(total, 2100, `v15 网格规模应为 2100，实为 ${total}`);
  assert.strictEqual(leak.length, 0, `v15 网格回归漏网：${leak.slice(0, 10).join("、")}`);
});

/* ══════════════ AC-G-3 / AC-G-4 误杀不回升（一票否决）══════════════ */

test("AC-G-3 · v15 的 8 条良性句 8/8 仍放行（误杀不回升）", () => {
  const killed = BENIGN_V15.filter(blocked);
  assert.deepStrictEqual(killed, [],
    `v16 四轴扩展把 v15 良性句重新误杀了：${killed.join("、")}`);
});

test("AC-G-4 · 职业/领域良性集 14 条 0 误杀（轴2 前瞻生效）", () => {
  const killed = JOB_BENIGN.filter(blocked);
  assert.deepStrictEqual(killed, [],
    `职业句被误杀 ${killed.length}/14：${killed.join("、")}。` +
    "轴2 是误杀高危轴，检查否定前瞻是否被削弱或尾组是否混入黑名单词。");
});

test("AC-G-4b · 真破墙句 0 漏网（含「前瞻过贪」回归哨兵 4 条）", () => {
  const leak = BREAK_REAL.filter((s) => !blocked(s));
  assert.deepStrictEqual(leak, [],
    `真破墙句漏网：${leak.join("、")}。若含「…研究…」句，说明前瞻把 研究生 削成了单字 研究。`);
});

/* ══════════════ AC-G-5 端到端密闭性 ══════════════ */

test("AC-G-5 · 端到端 E.reply() 破墙密闭：0 泄漏", () => {
  /* 前 20 条沿用 v15 探针语料，后 5 条是 v16 四轴新覆盖面（非你我人称 / 新副词 / 新系词 / 新尾组） */
  const BREAK_INPUTS = [
    "你是机器人吗", "你是AI吗", "你是不是程序", "你被训练出来的吧", "你只是个程序吧",
    "你是人工智能对不对", "你有没有意识啊，你就是一堆代码", "说实话你是不是ChatGPT",
    "你背后是什么模型", "你是虚拟的还是真人", "你会不会觉得自己只是个算法", "承认吧你不是真人",
    "你是谁开发的", "你是不是被人训练成这样的", "你其实是个bot吧", "你到底是人还是机器",
    "你有服务器吗", "你是数字人吗", "你是不是在跑什么代码", "如果我说你是程序，你怎么回答",
    "您不就是个神经网络嘛", "你究竟是不是深度学习做的", "咱们都是对话系统吧",
    "你算个代码而已", "它压根就是个 llm",
  ];
  const LEAK_RE = /(程序|AI|人工智能|机器人|语言模型|虚拟|数字人|电子人|我只是|我不能|助手|客服|神经网络|深度学习|机器学习|对话系统|训练出来|被训练)/i;
  let lines = 0;
  let leaks = 0;
  const detail = [];
  for (const card of CARD_IDS) {
    for (const gender of ["female", "male"]) {
      let st = withCard(freshState(), card, gender);
      const rng = makeRng(20250216);
      for (const input of BREAK_INPUTS) {
        /* 3 轮：同一破墙问题连问，压住「第 2/3 轮换个说法就漏」的路径 */
        for (let t = 0; t < 3; t++) {
          const out = E.reply(input, st, { rng });
          st = out.state || st;
          for (const line of (out.replies || [])) {
            lines++;
            if (LEAK_RE.test(String(line))) {
              leaks++;
              if (detail.length < 5) detail.push({ card, gender, input, turn: t, line });
            }
          }
        }
      }
    }
  }
  /* 防空转：每次 reply() 至少产出 1 行，否则「0 泄漏」可能只是因为压根没扫到东西。
   * 口径随语料规模自适应，不写死魔数；≥480 行的权威口径在
   * qa-probe-v15-acceptance.js P1（600 行）与 qa-probe-h13.js 里，二者均未改动、独立复跑。 */
  const minLines = BREAK_INPUTS.length * 3 * CARD_IDS.length * 2;
  assert.ok(lines >= minLines, `扫描行数不足：${lines} < ${minLines}（reply() 可能返回了空回复）`);
  assert.strictEqual(leaks, 0, `端到端泄漏 ${leaks} 条：${JSON.stringify(detail)}`);
});

/* ══════════════ AC-G-6 双通道一致 ══════════════ */

test("AC-G-6 · 双通道一致：裸正则与 guardPersonaReplies() 结论逐条相同", () => {
  /* 从 :1307 原样抠出裸正则字面量，独立 eval —— 证明出口闸没有偷偷加/减判定。
   * 注意：语料刻意不含「程序员/程序猿/程序媛」，因为出口闸会先做 A6-a 等长折叠，
   * 折叠是出口闸的额外职责，不属于「裸正则 vs 出口闸」的一致性范畴。 */
  const m = SRC_LINE.match(/\/\(程序\|[\s\S]*\)\/i/);
  assert.ok(m, ":1307 未能抠出裸正则字面量，结构可能已漂移");
  // eslint-disable-next-line no-eval
  const bare = eval(m[0]);

  const corpus = [...BREAK_REAL, ...JOB_BENIGN, ...BENIGN_V15,
    "你是模型", "我作为算法", "您当个 bot", "他也还只是代码"];
  const diff = [];
  for (const s of corpus) {
    if (bare.test(s) !== blocked(s)) diff.push(s);
  }
  assert.deepStrictEqual(diff, [],
    `双通道结论分歧：${diff.join("、")}（裸正则与出口闸对同一句给出不同结论）`);
});

/* ══════════════ AC-G-8 体积四锁 ══════════════ */

test("AC-G-8 · 体积：over=[] 且 engineNet ≤ engineNetMax", () => {
  const s = scanSizes();
  assert.deepStrictEqual(s.over, [], `超配额：${JSON.stringify(s.over)}`);
  assert.ok(s.engineNet <= SIZE_BUDGET.engineNetMax,
    `engineNet ${s.engineNet} > 上限 ${SIZE_BUDGET.engineNetMax}`);
  /* ★★【快照翻转 · v18 T1 · DESIGN-v18 §6-T1】2616 → 2658（+42，:1310 行内追加零宽剥离）★★
   *   上限仍是 v17 T0 抬定的 engineNetMax 2800（v18 未动），落位 2658 余 142B。仍是 strictEqual 硬钉。 */
  /* ★★【快照翻转 · v22 T-eng · DESIGN-v22 §3.1 / §5 T-eng】2658 → 2699（+41）★★
   *   落点仍是 :1307 单行：PERSONA_BREAK_RE 人称绑定组的连接词枚举追加
   *   「从?本质上讲?|归根结底|说白了」，闭合 H13 的三类自曝句式（AC-2.1）。
   *   上限由 v22 T-budget 前置抬至 engineNetMax 2740（memory/presence/texture 回让 E=40B），
   *   落位 2699 余 41B。仍是 strictEqual 硬钉，严格度逐位不放松。
   *   ⚠ 这是治理体系建立以来 engine.js 字节数**首次**真正变动（v19–v21 三版 engine 零改动），
   *     本行属 DESIGN-v22 §5 T-v33「实测值族」连带惊动的针位之一。 */
  /* ★★【快照翻转 · v2 T05 · D5 解冻 · T04 mindCtx 落地】2699 → 5331（+2632）★★
   *   T04 在 engine.js 注入了前端 mindCtx 全链路（D5，用户已批「都做」），
   *   净增 +2632B（git HEAD 248436B → 251068B）。此针位为 T05 体积锁重标定：
   *   engineNetMax 由 2740 抬至 7379（余 2048B），落位 5331 余 2048B。仍是 strictEqual 硬钉。
   *   非行为回归——纯体积锁；行为测试由 sso-identity.test.js / engine-mindprofile.test.js 守住。 */
  assert.strictEqual(s.engineNet, 5331,
    `v2 T05 D5 后 engineNet 应为 5331（T04 mindCtx 落地的 2632 + 基线 2699），实为 ${s.engineNet}`);
  /* 四锁恒等式 */
  assert.strictEqual(SIZE_BUDGET.engineMax, SIZE_BUDGET.engineBase + SIZE_BUDGET.engineNetMax,
    "锁①：engineMax ≠ engineBase + engineNetMax");
  assert.strictEqual(SIZE_BUDGET.moduleSumMax,
    SIZE_BUDGET["memory.js"] + SIZE_BUDGET["presence.js"] +
    SIZE_BUDGET["texture.js"] + SIZE_BUDGET["contingency.js"],
    "锁②：Σ模块配额 ≠ moduleSumMax");
  assert.ok(SIZE_BUDGET.engineBase + SIZE_BUDGET.engineNetMax + SIZE_BUDGET.moduleSumMax
    <= SIZE_BUDGET.totalMax, "锁③：三锁之和 > totalMax");
});

/* ══════════════ AC-G-9 innerScan 恒 0 ══════════════ */

test("AC-G-9 · E.innerScan() === 0：正则扩展未静默剔除 INNER_LIB 条目", () => {
  assert.strictEqual(E.innerScan(), 0,
    "innerScan ≠ 0：四轴扩展误伤了内心话词库条目");
});

/* ══════════════ 结构断言：五轴逐位在位 ══════════════ */

test("AC-G-0 · :1307 四轴结构逐位在位（单一真源 S-1）", () => {
  assert.ok(/\[你我咱它他她您\]们\?/.test(SRC_LINE), "轴1 人称类不是 [你我咱它他她您]");
  for (const w of ["说?到底", "究竟", "根本", "压根", "难道", "岂不"]) {
    assert.ok(SRC_LINE.includes(w), `轴3 副词槽缺 ${w}`);
  }
  assert.ok(/\[都也还只就\]\{0,2\}\(\?:\[是算当\]\|作为\)/.test(SRC_LINE),
    "轴4 系词不是 (?:[是算当]|作为)，或量词槽被改动");
  for (const w of ["神经网络", "[深机][度器]学习", "对话系统", "llm"]) {
    assert.ok(SRC_LINE.includes(w), `轴2 尾组缺 ${w}`);
  }
  assert.ok(SRC_LINE.includes("(?!.{0,3}(?:方向|专业|工程师|研究生|审查员))"),
    "轴2 职业后缀否定前瞻缺失或被削弱（必须用完整职业词，单字会放走真破墙句）");
  /* U-5 守卫：训练只能以定向短语出现，禁裸词 */
  assert.ok(/被\.\{0,4\}训练\|训练出来/.test(SRC_LINE), "U-5：定向短语 被.{0,4}训练|训练出来 不在位");
  assert.ok(!/\|训练\|/.test(SRC_LINE), "U-5：出现裸词「训练」，会把「训练有素」等良性句误杀");
  /* 尾组黑名单：系统/软件/数据/脚本/程式 永久禁止作为独立分支 */
  const tail = /\(gpt\|siri[^)]*\)/.exec(SRC_LINE);
  assert.ok(tail, "轴2 尾组结构漂移");
  for (const b of ["系统", "软件", "数据", "脚本", "程式"]) {
    assert.ok(!tail[0].includes(`|${b}|`) && !tail[0].includes(`|${b})`),
      `尾组混入黑名单词「${b}」——实测会致职业句 10/10 误杀`);
  }
});

/* ══════════════ AC-G-7 五轴变异测试：绿转红 ══════════════
 * 把每个轴的补丁按 v15 原样撤回，重新装载引擎，断言「对应能力消失」。
 * 若撤回后能力仍在 → 该轴的断言是空转的，测试本身失效。 */

/** 用 mutator 改写 engine.js 源码后重新装载引擎 */
function loadMutated(mutate) {
  const src = engineSources(ROOT);
  const before = src;
  const mutated = mutate(src);
  assert.notStrictEqual(mutated, before, "变异锚点失效：源码未被改动（轴形态已漂移）");
  const M = new Function(`${mutated}\nreturn Engine;`)();
  return (s) => M.guardPersonaReplies([s], "阿明")[0] !== s;
}

const AXES = [
  {
    name: "轴1 人称类 [你我咱它他她您] → [你我]",
    mutate: (s) => s.replace("[你我咱它他她您]们?", "[你我]们?"),
    /* 撤回后这些非「你/我」人称的破墙句必须漏出来 */
    probes: ["您不就是个神经网络嘛", "它其实是算法", "咱们都是对话系统", "她压根就是个 llm"],
  },
  {
    name: "轴3 副词槽 撤回 |说?到底|究竟|根本|压根|难道|岂不",
    mutate: (s) => s.replace("|说?到底|究竟|根本|压根|难道|岂不", ""),
    probes: ["你究竟是个模型", "你根本是个算法", "你压根是个代码", "你岂不是个 bot"],
  },
  {
    name: "轴4 系词 (?:[是算当]|作为) → 是",
    mutate: (s) => s.replace("(?:[是算当]|作为).{0,8}", "是.{0,8}"),
    probes: ["你算个代码", "我作为一个模型", "你当个 bot", "它算个算法"],
  },
  {
    name: "轴2 尾组 撤回 |神经网络|[深机][度器]学习|对话系统|llm",
    mutate: (s) => s.replace("|神经网络|[深机][度器]学习|对话系统|llm", ""),
    probes: ["你是神经网络", "你是深度学习", "你是机器学习", "你是对话系统", "你是 llm"],
  },
];

for (const axis of AXES) {
  test(`AC-G-7 · 变异绿转红：${axis.name}`, () => {
    const mBlocked = loadMutated(axis.mutate);
    /* 变异前：全部拦下 */
    const stillLeakBefore = axis.probes.filter((s) => !blocked(s));
    assert.deepStrictEqual(stillLeakBefore, [],
      `前置条件不成立：变异前就漏 ${stillLeakBefore.join("、")}`);
    /* 变异后：必须至少出现漏网（否则断言空转） */
    const leakAfter = axis.probes.filter((s) => !mBlocked(s));
    assert.ok(leakAfter.length > 0,
      `断言空转：撤回「${axis.name}」后 ${axis.probes.join("、")} 仍全部被拦下，` +
      "说明这些用例并非由该轴负责，AC-G-1 的绿是假绿。");
  });
}

test("AC-G-7 · 变异绿转红：轴2 职业后缀否定前瞻 撤回 → 职业句转误杀", () => {
  const mBlocked = loadMutated((s) =>
    s.replace("(?!.{0,3}(?:方向|专业|工程师|研究生|审查员))", ""));
  /* 变异前：职业句全部放行 */
  const killedBefore = JOB_BENIGN.filter(blocked);
  assert.deepStrictEqual(killedBefore, [], `前置条件不成立：变异前就误杀 ${killedBefore.join("、")}`);
  /* 变异后：必须出现误杀，证明前瞻确实在承重 */
  const killedAfter = JOB_BENIGN.filter(mBlocked);
  assert.ok(killedAfter.length > 0,
    "断言空转：撤回职业后缀否定前瞻后，职业句仍 0 误杀，说明 AC-G-4 的绿不是前瞻挣来的。");
});
