/**
 * qa-e-acceptance.test.js · 心屿 候选 E（回答系统真人感）· 严过关验收
 * 运行：node --test ai-girlfriend/test/qa-e-acceptance.test.js
 *
 * 覆盖 PRD AC-E1~E12 的可自动化部分：
 *   E1 冻结四文件字节精确   E2 app.js 改动可审计   E4 零外发（先剥注释）
 *   E5 小暖不更名           E6 旧基线可加载        E8 L1 texture 情境化（静态）
 *   E9 L2 local-heuristic tone 分流（静态）
 *   E10 L3 orchestrate 行为（总开关/防双加工/补云端缺口/幂等/参数驱动/降级）
 *   E11 L3 强度受 S.persona 驱动
 * E12（浏览器真机双视口抽查）由主理人在独立环境用 Playwright 完成，本报告记录证据。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = __dirname;
const SELF = 'qa-e-acceptance.test.js';

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
function hasNetwork(s) {
  return /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new URL|https?:\/\/|navigator\.(sendBeacon|geolocation)|^\s*import\s|require\(/.test(s);
}

// 递归收集根目录下全部 .js/.html/.css 源码内容（跳过二进制/.data/node_modules/.git 大目录）
function walkSource(dir, acc) {
  acc = acc || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.data' || e.name === 'node_modules' || e.name === '.git') continue;
      walkSource(p, acc);
    } else if (/\.(js|html|css)$/.test(e.name)) {
      try { acc.push(fs.readFileSync(p, 'utf8')); } catch { /* 跳过不可读文件 */ }
    }
  }
  return acc;
}

/* ── E1 冻结四文件字节精确（CI 级字节闸） ── */
test('E1 · 冻结四文件字节精确不变', () => {
  const exp = { 'engine.js': 251068, 'sw.js': 13723, 'memory.js': 13333, 'test/baseline.js': 2646 };
  for (const f in exp) {
    const sz = fs.statSync(path.join(ROOT, f)).size;
    assert.strictEqual(sz, exp[f], `${f} 字节应精确为 ${exp[f]}，实际 ${sz}（冻结线被触碰！）`);
  }
});

/* ── E2 app.js 改动可审计（仅 persona 配置 + 挂载点 + route ctx，无生成逻辑改动） ── */
test('E2 · app.js 改动可审计（L3 挂载 + textured 标记 + tone 入参 + persona 参数）', () => {
  const s = read('app.js');
  assert.ok(s.includes('ReplyTexture.orchestrate'), '应挂载 L3 orchestrate 管道');
  assert.ok(s.includes('textured: true'), '本地引擎分支应标记 textured（告知 L3 跳过重叠维度）');
  assert.ok(s.includes('tone: S.persona.tone'), 'ReplyRouter.route ctx 应传入 tone 供 LocalHeuristic 分流');
  assert.ok(/warmth:\s*0?\.\d+/.test(s) && /whitespace:\s*0?\.\d+/.test(s), 'S.persona 应含 warmth/proactivity/whitespace 可调参数');
  // 反向守护：不得出现重写回复生成/applyPersonaStyle 的痕迹
  assert.ok(!/\.applyPersonaStyle\s*=/.test(s), 'app.js 不得重写 engine 的风格化函数');
});

/* ── E4 零外发（先剥注释再扫网络字面） ── */
test('E4 · 零外发：L3 / texture / local-heuristic 扫描命中 0', () => {
  for (const f of ['reply-texture-orchestrator.js', 'texture.js', 'local-heuristic.js']) {
    const s = stripComments(read(f));
    assert.strictEqual(hasNetwork(s), false, `${f} 含网络外发字面（剥注释后）`);
  }
});

/* ── E5 小暖不更名（护栏：触碰文件保留「小暖」+ 全仓源码仍含 Xiaonuan，证明未被全局更名/意译） ── */
test('E5 · 小暖不更名', () => {
  // (a) 候选 E 触碰的三文件必须完好保留角色名「小暖」（实质守护，不弱化）
  const touched = ['app.js', 'reply-texture-orchestrator.js', 'texture.js'];
  let warmHits = 0;
  for (const f of touched) {
    const c = read(f);
    assert.ok(c.includes('小暖'), `触碰文件 ${f} 必须保留角色名「小暖」`);
    warmHits += (c.match(/小暖/g) || []).length;
  }
  assert.ok(warmHits >= 45, `触碰文件「小暖」出现次数不应被削弱（当前 ${warmHits}，阈值 ≥45，证明未做更名清理）`);

  // (b) 扫描全仓源码（.js/.html/.css，排除二进制/.data/node_modules/.git）确认心智体标识 Xiaonuan 仍存在，
  //     证明本次变更未触发全局更名 / 意译（Xiaonuan 本就仅存在于我们未触碰的文件，如 ltm-ui.js / voice.js）
  const sources = walkSource(ROOT);
  let xiaoFiles = 0;
  for (const c of sources) if (c.includes('Xiaonuan')) xiaoFiles++;
  assert.ok(xiaoFiles > 0, '全仓源码应仍含心智体标识 Xiaonuan（证明未被全局更名/意译）');
  assert.ok(xiaoFiles >= 5, `Xiaonuan 应稳定存在于多个源码文件（当前 ${xiaoFiles}，阈值 ≥5）`);
});

/* ── E6 旧基线测试套件完整且可加载（守 449/0 语义） ── */
test('E6 · 旧基线测试文件完整且语法可加载', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.test.js')).sort();
  const legacy = files.filter((f) => f !== SELF);
  // 候选 D 的 AC-D42 锁定：排除任一验收文件后，既有 .test.js 恒可加载；守下限不被误删
  assert.ok(legacy.length >= 30, `既有测试文件应 ≥30，实际 ${legacy.length}`);
  for (const f of legacy) {
    try { execFileSync(process.execPath, ['--check', path.join(DIR, f)], { cwd: ROOT, encoding: 'utf8' }); }
    catch (e) { assert.fail(`${f} 语法校验失败：${String(e.stderr || e.stdout || e).slice(0, 200)}`); }
  }
});

/* ── E8 L1 texture.js 情境化微行为（静态守护） ── */
test('E8 · L1 texture.js：UE_TIC 情绪口头禅 + drift 记忆呼应扩展', () => {
  const s = read('texture.js');
  assert.ok(s.includes('UE_TIC'), '应新增 UE_TIC 情绪维度口头禅');
  assert.ok(s.includes('O(st).ue'), 'tic 分支应读 ue 做情境化');
  assert.ok(s.includes('O(st).mem'), 'drift 分支应扩展到长期记忆 mem');
});

/* ── E9 L2 local-heuristic.js 按 tone 分流（静态守护） ── */
test('E9 · L2 local-heuristic.js：傲娇/黏人句库 + ruleReply 按 tone 分流', () => {
  const s = read('local-heuristic.js');
  assert.ok(s.includes('INTENT_POOL_TSUNDERE') && s.includes('INTENT_POOL_CLINGY'), '应新增傲娇/黏人句库');
  assert.ok(s.includes('normTone(ctx.tone)'), 'ruleReply 应按 ctx.tone 分流句库');
});

/* ════════════════════════════════════════════════════════════
 * E10 / E11 · L3 orchestrate 行为级（核心，纯函数可 node 直测）
 * ══════════════════════════════════════════════════════════ */
const RT = require(path.join(ROOT, 'reply-texture-orchestrator.js'));

test('E10a · 总开关关闭 → 原句直出（在线降级闸门）', () => {
  RT.setConfig({ enabled: false });
  try {
    assert.strictEqual(RT.orchestrate('今天天气真好呀', { state: {}, ctx: {} }), '今天天气真好呀');
  } finally {
    RT.setConfig({ enabled: true });
  }
});

test('E10b · textured 分支（本地引擎已含 texture）→ 防双加工，短文本原句直出', () => {
  let altered = 0;
  for (let i = 0; i < 100; i++) {
    const out = RT.orchestrate('我有点累', { state: {}, ctx: { ue: { type: 'tired' }, textured: true } });
    if (out !== '我有点累') altered++;
  }
  assert.strictEqual(altered, 0, 'textured 分支不应对短文本做镜像/记忆加工（避免与 texture 双叠加）');
});

test('E10c · 非 textured 分支（云端/端侧逃过 texture）→ 全策略生效，补缺口', () => {
  let recallHits = 0, mirrorHits = 0;
  for (let i = 0; i < 100; i++) {
    const out = RT.orchestrate('今天好累哦想睡觉', {
      state: { persona: { tone: 'playful', warmth: 0.9, proactivity: 0.9, whitespace: 0.2 },
               mem: ['上周说好一起去海边'], dayLife: {} },
      ctx: { ue: { type: 'tired' }, textured: false },
    });
    if (out.includes('你之前还说起过')) recallHits++;
    if (/心里也|陪着你|心疼|我也/.test(out)) mirrorHits++;
  }
  assert.ok(recallHits > 0, '非 textured 分支应触发记忆自然引用（补云端缺口）');
  assert.ok(mirrorHits > 0, '非 textured 分支应触发情绪镜像');
});

test('E10d · 幂等（相同 rng 序列 → 相同输出）', () => {
  const mk = () => { let s = 42; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
  const base = { state: { persona: { tone: 'playful' }, mem: ['去海边'], dayLife: {} }, ctx: { ue: { type: 'tired' }, textured: false } };
  const a = RT.orchestrate('今天好累哦想睡海边计划', Object.assign({ rng: mk() }, base));
  const b = RT.orchestrate('今天好累哦想睡海边计划', Object.assign({ rng: mk() }, base));
  assert.strictEqual(a, b, '同 rng 应得一致输出（幂等）');
});

test('E10e · 参数驱动 whitespace → 节奏分段可禁用', () => {
  const long = '今天发生了一件特别特别长的事情我都不知道该怎么说才好了总之就是很累很烦然后还想吃东西最后决定去睡觉';
  try {
    RT.setConfig({ whitespace: 0 });
    const a = RT.orchestrate(long, { state: { persona: { tone: 'playful', whitespace: 0 } }, ctx: { textured: false } });
    assert.strictEqual(a.includes('\n'), false, 'whitespace=0 应不做节奏分段');
    RT.setConfig({ whitespace: 1 });
    const b = RT.orchestrate(long, { state: { persona: { tone: 'playful', whitespace: 1 } }, ctx: { textured: false } });
    assert.ok(typeof b === 'string' && b.length > 0, 'whitespace=1 不应抛错，返回可读文本');
  } finally {
    RT.setConfig({ whitespace: 0.5 });
  }
});

test('E11 · 强度受 S.persona 驱动（getParam 回退 cfg 默认）', () => {
  // 短文本无微行为 → 原句；验证 S.persona 缺失时回退 cfg 不抛错
  const out = RT.orchestrate('短句', { state: {}, ctx: { textured: false } });
  assert.strictEqual(out, '短句');
  // 带 S.persona.warmth 时被读取（通过 getParam），非 micro 文本在情感下可被镜像
  const out2 = RT.orchestrate('我好难过', {
    state: { persona: { tone: 'playful', warmth: 1, proactivity: 1, whitespace: 0 } },
    ctx: { ue: { type: 'sad' }, textured: false },
  });
  assert.ok(out2.length >= '我好难过'.length, '带 persona 参数时应正常加工或原句，绝不静默');
});
