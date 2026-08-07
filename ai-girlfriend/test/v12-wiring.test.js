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
