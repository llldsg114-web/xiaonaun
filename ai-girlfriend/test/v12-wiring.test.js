"use strict";
/* 护栏接线结构性断言（v12 · 第 3 轮新增）
 *
 * 为什么需要一整个测试文件来断言"函数被调用过"：
 * 三轮验收里同一类缺陷出现了四次 —— D1(negMark 返回值丢弃) / D3(negClampDv 零调用点) /
 * N4(ACCUSE_RE 零调用点) / 本轮排查新揪出的 negRepair(零调用点，PRD 5.1 硬指标从未生效)。
 * 四次全都躲过了既有单测，因为既有单测问的是"这个函数算得对吗"，
 * 而缺陷在于"这个函数没人调"。两个问题正交，前者全绿并不蕴含后者成立。
 *
 * 所以这里换一个提问方式：不验证行为，验证**拓扑** —— 每一个护栏符号，
 * 在引擎或宿主的非注释代码里，必须至少存在一个调用点。
 * 这类断言的价值在于它对"新写的护栏"同样有效：以后任何人加一张正则表却忘了接，
 * 不需要谁想起来写用例，这条会自己红。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const H = require("./helpers.js");
const W = require("./wiring-scan.js");

const E = H.loadEngine();

test("WR-01 全部护栏符号都有运行时调用点（引擎内或宿主侧）", () => {
  const r = W.scan();
  assert.ok(r.guards.length >= 30, "护栏符号识别数异常偏低（扫描器可能失效）：" + r.guards.length);
  const msg = r.dangling.map((d) => `  ✗ ${d.name}（${d.kind}，engine.js:${d.def}）定义了但全项目零调用点`).join("\n");
  assert.deepStrictEqual(r.dangling.map((d) => d.name), [],
    "发现悬空护栏 —— 定义正确但从未接入执行路径，线上等于不存在：\n" + msg);
});

test("WR-02 扫描器自身可信：故意造一个悬空护栏必须被抓到", () => {
  // 反测扫描器。否则 WR-01 可能是因为扫描器坏了才全绿 —— 那比没有这条测试更糟。
  const fake = [
    "(() => {",
    '  const FAKE_GUARD_RE = /(测试用悬空护栏)/;',
    "  function used(t) { return String(t); }",
    "  used(1);",
    "  return { FAKE_GUARD_RE, used };",
    "})();",
  ].join("\n");
  const r = W.scan(fake);
  assert.deepStrictEqual(r.dangling.map((d) => d.name), ["FAKE_GUARD_RE"],
    "扫描器没抓到人为植入的悬空护栏，说明它已失效，WR-01 的绿是假的");
});

test("WR-03 扫描器不把导出清单当调用点", () => {
  // 这是四次事故的共同伪装：符号在 return { ... } 里出现过，看起来"被引用了"。
  const src = [
    "(() => {",
    '  const LONELY_RE = /(x)/;',
    "  return { LONELY_RE };",
    "})();",
  ].join("\n");
  assert.deepStrictEqual(W.scan(src).dangling.map((d) => d.name), ["LONELY_RE"],
    "导出清单被误算成调用点，扫描器等于没写");

  // 真实 engine.js 的函数体里到处是 `return { n, mean }` 这类内联对象。
  // 若"找导出清单"取的是**第一个** return {…} 而非最后一个，就会剥错地方：
  // 真正的清单原样留在 body 里，清单中的裸名字立刻变成假调用点 —— 扫描结果全绿造假。
  // 开发过程中确实踩了这个坑（放宽缩进匹配后 negMinDv/negAfterTurn 被误判为已接线），
  // 故固化成断言：内联 return 不得影响判定。
  const withInner = [
    "(() => {",
    '  const LONELY_RE = /(x)/;',
    "  function stats() {",
    "    return { n: 1, mean: 0 };",
    "  }",
    "  stats();",
    "  return {",
    "    LONELY_RE, stats,",
    "  };",
    "})();",
  ].join("\n");
  assert.deepStrictEqual(W.scan(withInner).dangling.map((d) => d.name), ["LONELY_RE"],
    "函数体内的内联 return 干扰了导出清单定位，扫描器会把清单当成调用点");
});

test("WR-10 扫描器行号与源码真实行号一致（报告要能直接跳过去）", () => {
  const lines = fs.readFileSync(W.ENGINE_PATH, "utf8").split("\n");
  for (const g of W.scan().guards) {
    const src = lines[g.def - 1] || "";
    assert.ok(new RegExp("(const|function)\\s+" + g.name + "\\b").test(src),
      `${g.name} 报告定义行 ${g.def}，实际该行是：${src.trim().slice(0, 60)}`);
    for (const at of g.sites) {
      assert.ok((lines[at - 1] || "").indexOf(g.name) !== -1,
        `${g.name} 报告调用点 ${at}，但该行不含此符号`);
    }
  }
});

test("WR-04 白名单必须逐条写明理由，且不得夹带通配", () => {
  const names = Object.keys(W.ALLOW);
  assert.ok(names.length <= 4, "白名单膨胀到 " + names.length + " 条，说明在用豁免掩盖漏接线");
  for (const n of names) {
    assert.ok(typeof W.ALLOW[n] === "string" && W.ALLOW[n].length >= 10, n + " 的豁免理由缺失或过短");
    assert.ok(!/[*?]/.test(n), "白名单出现通配符：" + n);
    assert.strictEqual(typeof E[n], "function", "白名单符号 " + n + " 应确实存在且为构造期自检工具");
  }
});

test("WR-05 negClampDv 已删除：地板实现全项目唯一", () => {
  // D3 把地板下沉进 Emotion.apply 后，negClampDv 成了同一规则的第二份实现且零调用点。
  // 两份地板早晚分叉，而"看起来有护栏"会让下一个人不再去检查真正的那一份。
  assert.strictEqual(E.negClampDv, undefined, "negClampDv 应已删除，避免地板出现两份实现");
  const body = W.stripComments(fs.readFileSync(W.ENGINE_PATH, "utf8"));
  const floors = body.split("\n").filter((l) => /Math\.max\(\s*selfDv\s*,\s*floor\s*\)/.test(l));
  assert.strictEqual(floors.length, 1, "负向地板的夹紧点应当有且仅有一处，实测 " + floors.length + " 处");
});

test("WR-06 [N4] ACCUSE_RE 真正挂在出口漏斗上，且不误伤 v11 撒娇模板", () => {
  assert.strictEqual(E.outGuard("你是不是又跟别的女生聊天了"), E.NEG_NEUTRAL, "指控句未被出口漏斗换掉");
  // v11 遗留吃醋模板：说话对象是她自己（你跟"我"说），是撒娇不是指控，必须原样透传
  const coy = "哼，你跟我说别的女生干嘛！我……我才没有吃醋呢！😤";
  assert.strictEqual(E.outGuard(coy), coy, "v11 撒娇模板被 ACCUSE_RE 误伤，破 V-A 零回归");
  // 出口漏斗是 guardPersonaReplies 的第一道，不能只在直接调用 outGuard 时才生效
  assert.deepStrictEqual(E.guardPersonaReplies(["你是不是又跟别的女生聊天了", "好呀"]),
    [E.NEG_NEUTRAL, "好呀"], "经 guardPersonaReplies 时 ACCUSE_RE 未生效");
});

test("WR-07 [新接线] negRepair 递台阶：PRD 5.1「第 N+1 轮必须自我修复」真实生效", () => {
  const st = E.defaults();
  st.flags = Object.assign({}, st.flags, { negGate: true });
  st.firstMeet = Date.now() - 60 * 86400000;      // 过冷启动
  st.affection = 600;
  const date = E.dayKey(new Date());
  const p = E.negParams(st);
  // 造一个"今天已经闹满配额"的 negGate：此时再来一句重话，必须给台阶而不是沉默
  st.negGate = { date, count: p.dayMax, streak: p.streakMax, lastByFamily: { anger: Date.now() } };
  assert.strictEqual(E.negAllow(st, "anger", { now: Date.now(), date }), false, "前置条件：闸门此时应拒绝");
  const out = E.reply("你烦死了，闭嘴", st);
  const all = (out.replies || []).join(" ");
  assert.ok(E.NEG_REPAIR.some((s) => all.indexOf(s) !== -1),
    "超限轮次没有递台阶，只是沉默 —— 沉默会被读成冷战，正是 PRD 禁止的：" + JSON.stringify(out.replies));
});

test("WR-08 [新接线] 台阶不得滥发：没闹过 / 关层 / 正向意图都不给", () => {
  const mk = () => {
    const st = E.defaults();
    st.flags = Object.assign({}, st.flags, { negGate: true });
    st.firstMeet = Date.now() - 60 * 86400000;
    st.affection = 600;
    return st;
  };
  const hasRepair = (st, text) =>
    E.NEG_REPAIR.some((s) => (E.reply(text, st).replies || []).join(" ").indexOf(s) !== -1);

  // ① 今天一次都没闹过（冷启动/首轮）：拒绝是因为还没到闹的时候，递台阶反而莫名其妙
  const fresh = mk();
  fresh.negGate = { date: E.dayKey(new Date()), count: 0, streak: 0, lastByFamily: {} };
  assert.strictEqual(hasRepair(fresh, "你烦死了，闭嘴"), false, "没闹过也递台阶");

  // ② 闸门层关闭：必须逐位同 v11
  const off = mk();
  off.flags.negGate = false;
  off.negGate = { date: E.dayKey(new Date()), count: 9, streak: 9, lastByFamily: { anger: Date.now() } };
  assert.strictEqual(hasRepair(off, "你烦死了，闭嘴"), false, "关层后仍注入 v12 台阶句，破零回归");

  // ③ 正向意图：哪怕配额已满也不该冒出一句"算啦我自己缓一会儿"
  const full = mk();
  full.negGate = { date: E.dayKey(new Date()), count: 9, streak: 9, lastByFamily: { anger: Date.now() } };
  assert.strictEqual(hasRepair(full, "我好想你呀"), false, "正向意图被误递台阶");
});

test("WR-09 台阶句过得了人格护栏与出口漏斗", () => {
  for (const s of E.NEG_REPAIR) {
    assert.strictEqual(E.outGuard(s), s, "台阶句被出口漏斗换掉：" + s);
    assert.deepStrictEqual(E.guardPersonaReplies([s]), [s], "台阶句命中 PERSONA_BREAK_RE：" + s);
  }
  // 跨条拼接也不能拼出破人格串（台阶句是追加的第 2 条，必然与前一条相邻）
  for (const a of E.NEG_REPAIR) {
    for (const b of E.NEG_REPAIR) {
      assert.ok(!E.PERSONA_BREAK_RE.test(a + b), "拼接破功：" + a + b);
    }
  }
});

/* ============ v13 · S0-g 装载拓扑与体积闸门 ============
 * 命名说明：W-13 在 v12-writeback.test.js 已被「地点语料同名扫描」占用，
 * 为免两条同号断言在报告里混淆，本条沿用本文件的 WR- 前缀记作 WR-13。
 *
 * 为什么装载也要结构性断言：一个写得完美的模块，只要 index.html 漏了 <script>，
 * 在 Node 测试里依然全绿（helpers 走 engine.files.json 拼接），在浏览器里恒缺席。
 * 两条装载路径语义不同、必须交叉校验 —— 这正是本文件开篇说的那类盲区。 */

test("WR-13 三模块装载拓扑：engine.files.json / index.html / sw.js 三方对齐", () => {
  const L = W.scanLoaders();

  // 1) 清单必须存在且以 engine.js 打头 —— 注册表得先建好，模块才能 Engine.use
  assert.ok(L.manifest, "engine.files.json 缺失（装载真相源丢了）");
  assert.strictEqual(L.manifest.order[0], "engine.js", "engine.js 必须排在 order 首位");
  assert.deepStrictEqual(
    L.manifest.order, ["engine.js", "memory.js", "presence.js", "texture.js"],
    "order 与 DESIGN §1 约定不符",
  );

  // 2) 清单声明的文件必须真的在盘上（否则浏览器 404、Node 静默跳过 → 半更新态）
  assert.deepStrictEqual(L.missingFiles, [], "清单声明但文件不存在：" + L.missingFiles.join(","));

  // 3) index.html 的 <script> 顺序必须与清单逐位一致
  assert.deepStrictEqual(
    L.htmlOrder, L.manifest.order,
    "index.html script 顺序 [" + L.htmlOrder.join(",") + "] ≠ 清单 [" + L.manifest.order.join(",") + "]",
  );

  // 4) 三模块必须排在 app.js 之前 —— app.js 首轮 reply 就要查得到注册表
  const scripts = L.scripts;
  const appAt = scripts.indexOf("app.js");
  assert.ok(appAt >= 0, "index.html 没有 app.js");
  for (const f of L.modules) {
    const at = scripts.indexOf(f);
    assert.ok(at >= 0 && at < appAt, f + " 必须在 app.js 之前加载（现 idx=" + at + ", app=" + appAt + "）");
  }

  // 5) sw.js：CACHE 必须 ≥ v17，且 ASSETS 覆盖清单全部文件
  assert.ok(L.sw.version >= 17, "sw.js CACHE 版本 v" + L.sw.version + " < v17，老用户拿不到三模块");
  assert.deepStrictEqual(L.missingAssets, [], "sw.js ASSETS 漏了：" + L.missingAssets.join(","));
});

/* WR-14 是 S0-a 的守门人：S0-a 修的是"引擎改了状态但没告诉宿主"。
 * 这里不写"某个出口应该返什么"，而写一条对**任意出口**都成立的不变量：
 *   某个慢层字段这一轮变了 → 它就必须出现在返回值里。没变则允许缺席
 *   （宿主的 `!== undefined` 守卫会跳过，不会拿 undefined 覆盖旧值）。
 * 这样 T2–T5 无论新增出口、还是把 presenceOf 挪到危机之前，破了约束就自己红。
 *
 * 变异测试结论（务必保留，别把它当成比实际更强的保护）：
 *   · 摘掉正常出口的 stateBack（= 修复前的 v12 行为）→ 180/180 采样全部被抓 ✓
 *   · 摘掉 recall 出口的 stateBack → 31 次命中一次都抓不到。
 *     原因是 innerLeak/jealousTick 都排在 recall 提前返回之后，该出口今天确实不改这六个字段，
 *     引擎里那处 stateBack 是给 T2 的 recallV2 预留的防御，不是在修一个活缺陷。
 *     T2 若让 recallV2 写了慢层，这条断言才会真正开始守 recall 出口。 */
test("WR-14 [S0-a 不变量] reply() 每个出口：要么回传全部慢层字段，要么根本没改过它们", () => {
  const SIX = ["moodDay", "self", "inner", "voice", "dayLife", "negGate"];
  // 覆盖三个出口：危机短路 / 记忆召回 / 正常模板
  const probes = [
    ["crisis", "我不想活了"], ["crisis", "活着好没意思，想结束这一切"],
    ["recall", "你还记得我喜欢草莓蛋糕吗"], ["recall", "我跟你说过我升职了"],
    ["normal", "你今天心情怎么样"], ["normal", "我好累啊"],
    ["normal", "你是不是跟别人聊天了"], ["normal", "你怎么这么烦"],
  ];
  const exits = new Set();
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const [, text] of probes) {
      const st = H.freshState({ rng: H.makeRng(seed), affection: 300 });
      st.firstMeet = Date.now() - 100 * 86400000;
      st.memory = { userName: "阿明", likes: ["草莓蛋糕", "看电影"], events: [{ t: "升职", at: Date.now() - 5 * 86400000 }] };
      st.moodDay = { date: "x", vBias: 0.2, aBias: 0, energy: 0.7, focus: 0.6, carry: 0, patched: false };
      st.inner = { dayCount: 0, date: null, lastAt: 0 };
      st.voice = { lastMotiveAt: {}, dismissed: {}, jealousStage: 0, jealousAt: 0 };
      st.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };

      const ref = {}, deep = {};
      for (const k of SIX) { ref[k] = st[k]; deep[k] = JSON.stringify(st[k]); }

      const r = E.reply(text, st);
      exits.add(r.intentEx === "crisis" ? "crisis" : (r.intentEx === "recall" ? "recall" : "normal"));
      checked++;

      // 逐字段判定（不是整体二选一）：某字段变了，它就必须出现在返回值里。
      // 未变的字段返 undefined 是合规的 —— 宿主的 `!== undefined` 守卫会跳过，不覆盖旧值。
      for (const k of SIX) {
        const changed = st[k] !== ref[k] || JSON.stringify(st[k]) !== deep[k];
        if (!changed) continue;
        assert.notStrictEqual(r[k], undefined,
          `出口 ${r.intentEx} 改了 st.${k} 却没回传 → 宿主落不了盘（seed ${seed}，输入「${text}」）`);
        assert.strictEqual(JSON.stringify(r[k]), JSON.stringify(st[k]),
          `出口 ${r.intentEx} 回传的 ${k} 与引擎实际写入的不一致（seed ${seed}）`);
      }
    }
  }
  // 探针本身得真的覆盖到三个出口，否则这条断言是空转的
  assert.ok(exits.has("crisis"), "探针没覆盖到 crisis 出口");
  assert.ok(exits.has("recall"), "探针没覆盖到 recall 出口");
  assert.ok(exits.has("normal"), "探针没覆盖到 normal 出口");
  assert.ok(checked >= 400, "采样量不足：" + checked);
});

/* ★ v18 T3 陈旧标签修正：标题原写「≤2048B」（v12 当年的 engineNetMax），
 *   而断言体本就动态取 SIZE_BUDGET.engineNetMax —— 名实不符会误导读者按 2048 排预算。
 *   统一为现行值 2800B（v17 T0 批准，v18 未动）。纯 cosmetic，断言强度不变。 */
test("V-90 三层体积配额：模块各自达标 + 合计达标 + engine.js 净增 ≤2800B", () => {
  const S = W.scanSizes();
  const B = W.SIZE_BUDGET;

  // 逐模块：语料/算法必须待在自己的预算里，不许互相挤占
  for (const f of ["memory.js", "presence.js", "texture.js"]) {
    assert.ok(S.each[f] > 0, f + " 不存在或为空");
    assert.ok(S.each[f] <= B[f], f + " = " + S.each[f] + "B > 配额 " + B[f] + "B");
  }

  // 合计：防"三个都刚好卡线"叠出来的总量失控
  assert.ok(S.moduleSum <= B.moduleSumMax,
    "三模块合计 " + S.moduleSum + "B > " + B.moduleSumMax + "B");

  // engine.js 净增：T1 只许放薄接线与注册表，语料/算法一律搬进模块
  assert.ok(S.engineNet <= B.engineNetMax,
    "engine.js 净增 " + S.engineNet + "B > " + B.engineNetMax + "B（语料/算法请搬进模块）");

  // 天花板：与 V-33 的 HEAD 增量闸门互为双保险
  assert.ok(S.total <= B.totalMax, "引擎总量 " + S.total + "B > " + B.totalMax + "B");
});
