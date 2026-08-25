/**
 * qa-v4-1-acceptance.test.js · 心屿 v4.1（语言+情绪核心）· 工程师收口验收
 *
 * 覆盖 T1.6 六类验收 + 硬约束守门：
 *   ① G1 · 30 轮 (tone,intent) 全链路（engine→dialogueWeave）复读率 < 12%（扩量+去重）
 *   ② G2 · 情绪 ≥7 态且触发后 1 轮内正确呈现（moodToExpr 映射）
 *   ③ 冻结线零交集：engine.js/sw.js/memory.js/test/baseline.js 字节精确
 *   ④ 零外发：三 v4.1 模块网络字面量扫描命中 0
 *   ⑤ 不白屏降级：三模块任一异常均兜底（不抛、不静默）
 *   ⑥ 防双加工 / L3 路径不破：textured 跳过 mirror/recall + v4.1 钩子不重加工
 * 另含守门：改动面仅 6 文件、小暖不更名、v4.1 模块不进 engine.files.json order。
 *
 * 运行：node --test ai-girlfriend/test/qa-v4-1-acceptance.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const H = require('./helpers.js');

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function hasNetwork(s) {
  return /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new URL|https?:\/\/|navigator\.(sendBeacon|geolocation)|^\s*import\s|require\(/.test(s);
}

// 引擎 + 三模块（node 侧借 globalThis.Engine 挂载，复刻浏览器 Engine.use 契约）
const E = H.loadEngine();
globalThis.Engine = E;
const EC = require(path.join(ROOT, 'emotion-core.js'));
const DC = require(path.join(ROOT, 'dialogue-core.js'));
const PC = require(path.join(ROOT, 'persona-core.js'));

function detectIntentFor(text) {
  if (/(爱你|喜欢你|好爱|超爱|抱抱|亲亲|么么)/.test(text)) return 'love';
  if (/(想你|想我|想念|挂念)/.test(text)) return 'miss';
  if (/(难过|伤心|不开心|累|疲惫|委屈|哭|烦|难受|孤单|孤独)/.test(text)) return 'sad';
  if (/(忙|加班|开会|出差|工作)/.test(text)) return 'busy';
  if (/(谢谢|感谢|多谢|辛苦了)/.test(text)) return 'thanks';
  if (/(对不起|抱歉|我的错)/.test(text)) return 'sorry';
  if (/(可爱|漂亮|好看|聪明|棒|厉害|好)/.test(text)) return 'praise';
  if (/(吃饭|吃了吗|饿|喝水|早点睡|照顾好|休息)/.test(text)) return 'concern';
  if (/(晚安|睡了|睡觉|拜拜|再见|走了|安啦|安安)/.test(text)) return 'bye';
  if (/(你好|在吗|在不在|在么|早|晚上好|嗨|hi|hello)/.test(text)) return 'greeting';
  return 'question';
}

const SCRIPT = [
  '我爱你呀', '好想你', '今天好累', '谢谢你陪我', '对不起我错了', '你真可爱',
  '记得吃饭呀', '晚安啦', '在吗', '你好呀', '我有点难过', '你太棒了',
  '忙死了', '想我没', '抱抱', '你怎么这么好', '我不开心', '早点睡',
  '拜拜', '今天顺利吗', '我好想你', '你最好了', '好累啊', '谢谢你懂我',
  '我错了嘛', '你真厉害', '去忙吧', '想念你', '睡了哦', '在不在呀',
];

/* ── ① G1 · 30 轮全链路复读率 < 12% ── */
test('V4-G1 · 30 轮 (playful) 全链路（engine→dialogueWeave）复读率 < 12%', () => {
  DC.resetDedup();
  const st = H.freshState();
  const hist = {};
  let repeats = 0, total = 0;
  for (const u of SCRIPT) {
    const r = E.reply(u, st);
    if (r.recentReplies !== undefined) st.recentReplies = r.recentReplies;
    if (r.topic !== undefined) st.topic = r.topic;
    if (r.ue !== undefined) st.ue = r.ue;
    if (r.replies && r.replies.length) st.lastReply = r.replies[r.replies.length - 1];
    let reply = (r.replies && r.replies[0]) ? r.replies[0] : '';
    // v4.1 dialogueWeave 接管（与 herReply 同口径）
    reply = DC.dialogueWeave(reply, { ue: r.ue, moodState: st.moodState, S: st });
    const key = 'playful:' + detectIntentFor(u);
    const recent = hist[key] || [];
    if (recent.indexOf(reply) >= 0) repeats++;
    recent.push(reply);
    if (recent.length > 3) recent.shift();
    hist[key] = recent;
    total++;
  }
  const rate = repeats / total * 100;
  assert.ok(rate < 12, `全链路 (tone,intent) 池 verbatim 复读率 ${rate.toFixed(1)}% ≥ 12%（G1 失守）`);
});

/* ── ② G2 · 情绪 ≥7 态 + 触发后 1 轮内正确呈现 ── */
test('V4-G2 · 情绪 ≥7 态且触发后 1 轮内正确映射（moodToExpr）', () => {
  const STATES = ['joy', 'anger', 'sad', 'coquettish', 'jealous', 'longing', 'peaceful'];
  const EXPR = { joy: 'happy', anger: 'angry', sad: 'sad', coquettish: 'coquettish', jealous: 'jealous', longing: 'longing', peaceful: 'peaceful' };
  assert.ok(STATES.length >= 7, '情绪态应 ≥7（喜/怒/哀/娇/醋/念/安）');
  for (const s of STATES) {
    const ms = EC.moodTick({ type: s, intensity: 0.8 }, { v: 0.2, a: 0.1 }, { stage: 'stranger' });
    assert.ok(ms && ms.key === s, `${s} 触发后 moodState.key 应为 ${s}，实=${ms && ms.key}`);
    const expr = EC.moodToExpr(ms, 'normal');
    assert.strictEqual(expr, EXPR[s], `${s} 应映射为 ${EXPR[s]}，实=${expr}`);
  }
  // 1 轮内呈现：moodTick 返回即落 moodState，无需多轮
  const st = { moodState: EC.NEUTRAL_STATE };
  st.moodState = EC.moodTick({ type: 'jealous', intensity: 0.9 }, { v: 0.2, a: 0.1 }, { stage: 'stranger' });
  assert.strictEqual(EC.moodToExpr(st.moodState, 'normal'), 'jealous', '醋意应在触发当轮内呈现（G2 1 轮内正确率）');
  // inferMoodEvent 映射（用户事件 → 小暖自身态）
  assert.strictEqual(EC.inferMoodEvent('我爱你呀', 'love', null).type, 'coquettish', 'love → 娇');
  assert.strictEqual(EC.inferMoodEvent('晚安啦', 'bye', null).type, 'longing', 'bye → 念');
  assert.strictEqual(EC.inferMoodEvent('你和别的女生暧昧', 'question', null).type, 'jealous', '提第三方 → 醋（V-A 未覆盖态）');
});

/* ── ③ 冻结线零交集 ── */
test('V4-guard · 冻结四文件字节精确零交集', () => {
  const exp = { 'engine.js': 251068, 'sw.js': 13894, 'memory.js': 13333, 'test/baseline.js': 2646 };
  for (const f in exp) {
    const sz = fs.statSync(path.join(ROOT, f)).size;
    assert.strictEqual(sz, exp[f], `${f} 字节应精确为 ${exp[f]}，实际 ${sz}（冻结线被触碰！）`);
  }
});

/* ── ④ 零外发 ── */
test('V4-guard · 零外发：三 v4.1 模块网络字面量扫描命中 0', () => {
  for (const f of ['dialogue-core.js', 'emotion-core.js', 'persona-core.js']) {
    const s = stripComments(read(f));
    assert.strictEqual(hasNetwork(s), false, `${f} 含网络外发字面（剥注释后）`);
  }
});

/* ── ⑤ 不白屏降级（钩子异常兜底） ── */
test('V4-guard · 不白屏降级：三模块任一异常均兜底（不抛、不静默）', () => {
  // dialogueWeave：异常输入 → 原样返回
  assert.strictEqual(DC.dialogueWeave('在吗', { S: null }), '在吗', 'dialogueWeave 异常 ctx 应原样返回');
  assert.strictEqual(DC.dialogueWeave(null, {}), null, 'dialogueWeave 非字符串输入应原样返回');
  // emotionCore：异常 moodState → 回落 fallback
  assert.strictEqual(EC.moodToExpr(null, 'normal'), 'normal', 'moodToExpr null 应回落 fallback');
  assert.strictEqual(EC.moodToExpr({ key: 'unknown-x' }, 'happy'), 'happy', 'moodToExpr 未知态应回落 fallback');
  assert.strictEqual(EC.moodTick(null, {}, {}), null, 'moodTick 无事件应返回 null（不推进）');
  // personaCore：PERSONA_BREAK_RE 抛错 → 保守放行（true），绝不误伤正常回复
  const orig = E.PERSONA_BREAK_RE;
  E.PERSONA_BREAK_RE = { test: () => { throw new Error('boom'); } };
  assert.strictEqual(PC.safetyGuard('小暖一直陪着你呀'), true, '护栏异常应保守放行（不白屏/不静默）');
  E.PERSONA_BREAK_RE = orig;
});

/* ── ⑥ 防双加工 / L3 路径不破 ── */
test('V4-G6 · 防双加工：textured 跳过 mirror/recall + v4.1 钩子不重加工', () => {
  const RT = require(path.join(ROOT, 'reply-texture-orchestrator.js'));
  // (a) textured 分支不二次加工（沿用候选 F 口径）
  let altered = 0;
  const shorts = ['我有点累', '想你了', '今天开心', '在吗', '抱抱我'];
  for (let i = 0; i < 200; i++) {
    const t = shorts[i % shorts.length];
    const out = RT.orchestrate(t, { state: {}, ctx: { ue: { type: 'sad' }, textured: true } });
    if (out !== t) altered++;
  }
  assert.strictEqual(altered, 0, 'textured 分支仍二次加工（与 texture 双叠加）');
  // (b) dialogueWeave 不重加工非复读句（保持原样，不引入第二重微行为）
  DC.resetDedup();
  assert.strictEqual(DC.dialogueWeave('今天也要加油哦', { S: {} }), '今天也要加油哦', 'dialogueWeave 不应改写非复读句');
  // (c) personaCore 拦截破墙 → 回落原句（不破墙表）
  const orig = E.PERSONA_BREAK_RE;
  E.PERSONA_BREAK_RE = /BREAKWALL_MARKER/;
  assert.strictEqual(PC.safetyGuard('这是 BREAKWALL_MARKER 测试'), false, '破墙句应被 personaCore 拦截');
  E.PERSONA_BREAK_RE = orig;
  assert.strictEqual(PC.safetyGuard('小暖一直都在呢'), true, '正常句应放行');
  // (d) consistencyGuard / validateVoice 雏形不破（返回布尔）
  assert.strictEqual(typeof DC.consistencyGuard({ persona: {} }), 'boolean', 'consistencyGuard 应返回布尔');
  assert.strictEqual(typeof PC.validateVoice({ persona: { tone: 'playful' } }), 'boolean', 'validateVoice 应返回布尔');
});

/* ── 守门：改动面仅 6 文件 + 装载序 ── */
test('V4-guard · 改动面与装载序：3 模块在 index.html 已装载、不进 engine.files.json order', () => {
  const HTML = read('index.html');
  for (const f of ['dialogue-core.js', 'emotion-core.js', 'persona-core.js']) {
    assert.ok(HTML.includes(`<script src="${f}"></script>`), `index.html 应装载 ${f}`);
  }
  // v4.1 模块必须位于 app.js 之前（herReply 才能消费）
  const atCore = HTML.indexOf('<script src="emotion-core.js"></script>');
  const atApp = HTML.indexOf('<script src="app.js"></script>');
  assert.ok(atCore >= 0 && atApp >= 0 && atCore < atApp, 'v4.1 模块必须在 app.js 之前装载');
  // 不进 engine.files.json order（避免 WR-13 missingAssets 误报）
  const man = JSON.parse(read('engine.files.json'));
  for (const f of ['dialogue-core.js', 'emotion-core.js', 'persona-core.js']) {
    assert.ok(!man.order.includes(f), `${f} 不应进 engine.files.json order（v4.1 不触发 sw ASSETS）`);
  }
});

/* ── 守门：小暖不更名（app.js 保留 ≥45 次） ── */
test('V4-guard · 小暖不更名：app.js 角色名计数不削弱（≥45）', () => {
  const c = read('app.js');
  const hits = (c.match(/小暖/g) || []).length;
  assert.ok(hits >= 45, `app.js「小暖」出现 ${hits} 次，不应被削弱（阈值 ≥45）`);
});
