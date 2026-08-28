/**
 * qa-v4-3-acceptance.test.js · 心屿 v4.3（S4 关系记忆 + S5 主动性）独立验收
 * --------------------------------------------------------------------
 * 验收口径（主理人齐活林拍板 Q1–Q8 + QA 严过关验收清单）：
 *   ① bond-memory 只读消费 memory.js，绝不改写（S4 铁律）
 *   ② 关系等级 L0–L3 派生公式与命名
 *   ③ 线性遗忘曲线 45 天归零 + clamp
 *   ④ 不打扰守门：consent / 日上限 / 间隔 / 深夜静默（五重门核心 4 门）+ 纪念日深夜例外
 *   ⑤ 节律表：L3 ≤8/日、≥20min；L0 基线
 *   ⑥ ConsentStore.proactive 默认开启、可撤销（零上报守门前置）
 *   ⑦ 隐私零上报：两模块源码绝无 fetch/XHR/WebSocket/sendBeacon/外链/import
 *   ⑧ index.html 主动关心 4 控件 id 齐备 + voice 组声明计数===实际===6
 *
 * 格式：Node.js 内置 node:test（严禁 console.log + process.exit 自验脚本）。
 */
'use strict';

const test = require('node:test').test;
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BondMemory = require(path.join(REPO, 'bond-memory.js'));
const ProactivityCore = require(path.join(REPO, 'proactivity-core.js'));
const ConsentStore = require(path.join(REPO, 'consent-store.js'));
const HTML = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

function todayKey(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.now());
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function freshS(over) {
  const S = {
    affection: 500,
    firstMeet: Date.now() - 86400000,
    bond: { warmth: 0.3 },
    relationship: { proact: { day: todayKey(), count: 0, lastAt: 0 } },
  };
  return Object.assign(S, over || {});
}

/* ─────────────────────────────────────────────────────────────
 * ① S4 · 只读契约：bondWrite / bondRecall 绝不触碰 memory.js 写入接口
 * ───────────────────────────────────────────────────────────── */
test('S4 · bond-memory 只读消费 memory.js：bondWrite/bondRecall 绝不调用任何写入接口', () => {
  const recorder = { writes: 0, reads: 0 };
  const memStub = {
    retrieveFacts() { recorder.reads++; },
    recallV2() { recorder.reads++; },
    listFacts() { recorder.reads++; },
    applyPatch() { recorder.writes++; },   // 写入类接口：绝不可被调用
    addFact() { recorder.writes++; },
    writeFact() { recorder.writes++; },
    upsert() { recorder.writes++; },
  };
  const origRandom = Math.random;
  globalThis.Engine = { use() {}, mod(name) { return name === 'memory' ? memStub : null; } };
  try {
    Math.random = () => 0;   // 让概率门控恒通过，确保读路径被走到
    const S = {
      firstMeet: Date.now() - 86400000, affection: 500,
      bond: { warmth: 0.3, shards: [{ id: 'seed', topic: 'test', gist: 'seed', kind: 'chat', at: Date.now(), importance: 1, lastUsedAt: 0, decayedAt: null }] },
    };
    BondMemory.bondWrite(S, { text: '今天聊得很开心', gist: '聊得很开心', topic: '开心', intent: 'thanks', delta: 5 });
    BondMemory.bondRecall(S, { text: '我们之前聊过什么' });
    assert.strictEqual(recorder.writes, 0, `bond-memory 不得调用 memory.js 任何写入接口（实测 ${recorder.writes} 次）`);
    assert.ok(recorder.reads >= 1, 'retrieveFacts 只读调用应被走到（实测 ' + recorder.reads + ' 次）');
    assert.ok(Array.isArray(S.bond.shards) && S.bond.shards.length >= 1, '关系碎片应沉淀到 S.bond.shards');
    assert.strictEqual(S.memory, undefined, '不得改写 memory.js 承载的 S.memory');
  } finally {
    Math.random = origRandom;
    delete globalThis.Engine;
  }
});

/* ─────────────────────────────────────────────────────────────
 * ② S5 · 关系等级 L0–L3 派生与命名
 * ───────────────────────────────────────────────────────────── */
test('S5 · 关系等级 L0–L3 派生与命名正确（warmth=0.5·affNorm+0.35·bond+0.15·时长；dating→≥L2）', () => {
  const L = ProactivityCore.relationshipLevel;
  const z = L({ affection: 0 });
  assert.strictEqual(z.lv, 0); assert.strictEqual(z.name, '初识');
  const one = L({ affection: 500 });                  // 0.5*0.5=0.25 → 熟络
  assert.strictEqual(one.lv, 1); assert.strictEqual(one.name, '熟络');
  const two = L({ dating: { since: Date.now() - 86400000 }, affection: 0 }); // dating 确立 → ≥0.5 → 亲密
  assert.strictEqual(two.lv, 2); assert.strictEqual(two.name, '亲密');
  const three = L({ affection: 1000, bond: { warmth: 1 }, firstMeet: Date.now() - 200 * 86400000 }); // 1.0 → 挚爱
  assert.strictEqual(three.lv, 3); assert.strictEqual(three.name, '挚爱');
});

/* ─────────────────────────────────────────────────────────────
 * ③ S4 · 线性遗忘曲线：45 天线性归零 + clamp
 * ───────────────────────────────────────────────────────────── */
test('S4 · 线性衰减：effImportance 按 45 天线性归零并 clamp 至 [0,1]', () => {
  const now = Date.now();
  const D = 86400000;
  assert.strictEqual(BondMemory.effImportance({ importance: 1, at: now }, now), 1, '当天应=1');
  assert.strictEqual(BondMemory.effImportance({ importance: 1, at: now - 45 * D }, now), 0, '满 45 天应归零');
  assert.ok(Math.abs(BondMemory.effImportance({ importance: 1, at: now - 22.5 * D }, now) - 0.5) < 1e-9, '22.5 天应=0.5');
  assert.strictEqual(BondMemory.effImportance({ importance: 1, at: now - 90 * D }, now), 0, '超 45 天应 clamp 到 0');
});

/* ─────────────────────────────────────────────────────────────
 * ④ S5 · 不打扰守门：consent / 日上限 / 间隔 生效 + 全开放行
 * ───────────────────────────────────────────────────────────── */
test('S5 · 不打扰守门 ①consent / ②daily-max / ③gap 生效，全开时 ok', () => {
  const origCs = globalThis.ConsentStore;
  try {
    // ① 用户关停
    globalThis.ConsentStore = { get(k) { return k === 'proactive' ? false : true; } };
    let r = ProactivityCore.shouldProactive(freshS());
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'user-disabled');

    // ② 当日上限（L1 dailyMax=4，count 设为 99）
    globalThis.ConsentStore = origCs;
    r = ProactivityCore.shouldProactive(freshS({ relationship: { proact: { day: todayKey(), count: 99, lastAt: 0 } } }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'daily-max');

    // ③ 间隔下限（L1 minGapMin=45，lastAt=now）
    r = ProactivityCore.shouldProactive(freshS({ relationship: { proact: { day: todayKey(), count: 0, lastAt: Date.now() } } }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'gap');

    // 守门全开 → ok
    r = ProactivityCore.shouldProactive(freshS());
    assert.strictEqual(r.ok, true); assert.strictEqual(r.why, 'ok');
  } finally {
    globalThis.ConsentStore = origCs;
  }
});

/* ─────────────────────────────────────────────────────────────
 * ⑤ S5 · 节律表 + 深夜静默 + 纪念日深夜例外
 * ───────────────────────────────────────────────────────────── */
test('S5 · 节律表 L3≤8/日≥20min、L0 基线；深夜 01–06 静默、纪念日当日例外放行', () => {
  const ST = ProactivityCore.STAGES;
  assert.strictEqual(ST.L0.dailyMax, 2); assert.strictEqual(ST.L0.minGapMin, 90);
  assert.strictEqual(ST.L3.dailyMax, 8); assert.strictEqual(ST.L3.minGapMin, 20);

  const realNow = Date.now;
  const base = new Date();
  base.setHours(3, 0, 0, 0);   // 钉在凌晨 03:00 本地
  const t = base.getTime();
  Date.now = () => t;
  try {
    // 深夜静默（非纪念日、count>0）
    let r = ProactivityCore.shouldProactive(freshS({ relationship: { proact: { day: todayKey(t), count: 1, lastAt: 0 } } }));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.why, 'night-silent');

    // 纪念日当日深夜例外（count=0 放行）
    const S = freshS({
      dating: { since: t - 4 * 86400000 },   // dDays=5，临近 target 7（diff=2≤3）→ 纪念日
      relationship: { proact: { day: todayKey(t), count: 0, lastAt: 0 } },
    });
    r = ProactivityCore.shouldProactive(S);
    assert.strictEqual(r.ok, true); assert.strictEqual(r.why, 'ok');
  } finally {
    Date.now = realNow;
  }
});

/* ─────────────────────────────────────────────────────────────
 * ⑥ S5 · ConsentStore.proactive 默认开启、可撤销
 * ───────────────────────────────────────────────────────────── */
test('S5 · ConsentStore.proactive 默认开启（可撤销、零上报守门前置）', () => {
  const cs = new ConsentStore();
  assert.strictEqual(cs.proactive, true, 'proactive 应默认 true');
  assert.strictEqual(typeof cs.set, 'function', '应提供 set 以支撑撤销（零上报守门）');
});

/* ─────────────────────────────────────────────────────────────
 * ⑦ S4/S5 · 隐私零上报：两模块源码绝无外发 API
 * ───────────────────────────────────────────────────────────── */
test('S4/S5 · 隐私零上报：bond-memory.js / proactivity-core.js 无任何外发或模块加载 API', () => {
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`\w])\/\/.*$/gm, '$1');
  const forbidden = [
    [/\bfetch\s*\(/, 'fetch'],
    [/XMLHttpRequest/, 'XMLHttpRequest'],
    [/sendBeacon/, 'sendBeacon'],
    [/WebSocket/, 'WebSocket'],
    [/http:\/\//, 'http://'],
    [/https:\/\//, 'https://'],
    [/\bimport\s+/, 'import'],
  ];
  for (const f of ['bond-memory.js', 'proactivity-core.js']) {
    const src = strip(fs.readFileSync(path.join(REPO, f), 'utf8'));
    for (const [re, label] of forbidden) {
      assert.strictEqual(re.test(src), false, `${f} 不得含外发/加载 API（命中 ${label}）`);
    }
  }
});

/* ─────────────────────────────────────────────────────────────
 * ⑧ S5 · index.html 主动关心 4 控件 id 齐备 + voice 组声明计数===实际===6
 * ───────────────────────────────────────────────────────────── */
test('S5 · index.html 主动关心四控件 id 齐备，voice 组声明计数===实际===6', () => {
  for (const id of ['proactive-enabled', 'proactive-revoke', 'proactive-status', 'bond-clear']) {
    const n = (HTML.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    assert.strictEqual(n, 1, `控件 #${id} 应恰好出现 1 次（实测 ${n}）`);
  }
  const voiceBlock = HTML.split(/<div class="me-group[^"]*" data-group="voice">/)[1].split(/<div class="me-group[^"]*" data-group="/)[0];
  const declared = /me-group-count">([^<]+)</.exec(voiceBlock)[1];
  const cards = (voiceBlock.match(/class="me-card/g) || []).length;
  assert.strictEqual(declared, '6', 'voice 组声明计数应为 6（v4.3 主动关心卡入 voice 组）');
  assert.strictEqual(cards, 6, 'voice 组实际卡片应为 6');
});
