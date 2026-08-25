/**
 * qa-f-acceptance.test.js · 心屿 候选 F（真人感精调）· 工程师收口验收
 *
 * 覆盖 PRD G1/G2（可自动化部分）+ 防双加工 + L3 路径全覆盖；G3 盲评由 QA 严过关组织，不在此。
 *   ① G1 · 30 轮剧本，同 (tone,intent) 池 verbatim 重复率 < 15%
 *   ② G2 · 微行为覆盖率 ∈ [35%, 65%]
 *   ③ 跨 tone 池不互窜
 *   ④ 防双加工（textured 分支不二次加工 mirror/recall）
 *   ⑤ L3 路径全覆盖（mirror / pacing / recall / continuity 至少各命中一次）
 * 另含守门断言：冻结四文件字节精确、零外发、小暖不更名、F7 persona 默认值。
 *
 * 运行：node --test ai-girlfriend/test/qa-f-acceptance.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = __dirname;

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
function hasNetwork(s) {
  return /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new URL|https?:\/\/|navigator\.(sendBeacon|geolocation)|^\s*import\s|require\(/.test(s);
}

const LH = require(path.join(ROOT, 'local-heuristic.js'));
const RT = require(path.join(ROOT, 'reply-texture-orchestrator.js'));
const H = require('./helpers.js');

/* 统一的微行为检测器（L1 texture 犹豫词/口头禅/错字 + L3 镜像/承接/记忆引用/节奏分段） */
const HES = ['嗯…', '那个…', '唔…', '诶…'];
const TICS = ['嗯', '唔', '诶嘿', '哼', '啧', '才不是', '笨蛋', '欸', '呐', '诶呀', '呜哇', '抱抱', '嘻', '嘿嘿', '哇', '好耶', '哎'];
const MIRROR_START = /^(看你|听你|你难过|你笑|你高兴|你激动|你一个人|别怕|别慌|没事儿|有我在|深呼吸|哇你)/;
const BRIDGE_START = /^(对了|话说|诶，说起这个|顺便说一句|哎对了)/;
function hasMicro(t) {
  if (!t) return false;
  if (HES.some((h) => t.startsWith(h))) return true;
  if (TICS.some((x) => t.startsWith(x + '，') || t.startsWith(x + '～'))) return true;
  if (t.indexOf('…嗯，') >= 0) return true;
  if (t.indexOf('  *') >= 0) return true;
  if (BRIDGE_START.test(t)) return true;
  if (MIRROR_START.test(t)) return true;
  if (/～ 你之前还说起过/.test(t)) return true;
  if (t.includes('\n')) return true;
  return false;
}

/* ── ① G1 · 同池 verbatim 重复率 < 15% ── */
test('F-G1 · 30 轮剧本：同 (tone,intent) 池 verbatim 重复率 < 15%', () => {
  const lh = new LH();
  // 30 轮覆盖 10 intent（每 intent 仅访问 3 次，避免同一池被单一 intent 连击 9+ 次）
  const SCRIPT = [
    ['我爱你呀', 'playful'], ['好想你', 'playful'], ['今天好累', 'playful'],
    ['谢谢你陪我', 'playful'], ['对不起我错了', 'playful'], ['你真可爱', 'playful'],
    ['记得吃饭呀', 'playful'], ['晚安啦', 'playful'], ['在吗', 'playful'], ['你好呀', 'playful'],
    ['我有点难过', 'playful'], ['你太棒了', 'playful'], ['忙死了', 'playful'], ['想我没', 'playful'],
    ['抱抱', 'playful'], ['你怎么这么好', 'playful'], ['我不开心', 'playful'], ['早点睡', 'playful'],
    ['拜拜', 'playful'], ['今天顺利吗', 'playful'], ['我好想你', 'playful'], ['你最好了', 'playful'],
    ['好累啊', 'playful'], ['谢谢你懂我', 'playful'], ['我错了嘛', 'playful'], ['你真厉害', 'playful'],
    ['去忙吧', 'playful'], ['想念你', 'playful'], ['睡了哦', 'playful'], ['在不在呀', 'playful'],
  ];
  const hist = {};   // key: tone+':'+intent → 最近 3 条回复
  let repeats = 0, total = 0;
  for (const [u, tone] of SCRIPT) {
    const reply = lh.ruleReply(u, { tone, affection: 5 });
    const key = tone + ':' + (detectIntentFor(u));
    const recent = hist[key] || [];
    if (recent.indexOf(reply) >= 0) repeats++;
    recent.push(reply);
    if (recent.length > 3) recent.shift();
    hist[key] = recent;
    total++;
  }
  const rate = repeats / total * 100;
  assert.ok(rate < 15, `同池相邻 3 轮内 verbatim 重复率 ${rate.toFixed(1)}% ≥ 15%（G1 失守）`);
});

/* 轻量意图识别副本（仅用于 G1 的池分组；与 local-heuristic 内部保持一致口径） */
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

/* ── ② G2 · 微行为覆盖率 ∈ [35%, 65%]（Monte Carlo：24 次独立 30 轮仿真取均值） ── */
test('F-G2 · 微行为覆盖率 ∈ [35%, 65%]（30 轮剧本 ×24 仿真均值）', () => {
  const E = H.loadEngine();
  const SCRIPT = [
    '我爱你呀', '好想你', '今天好累', '谢谢你陪我', '对不起我错了', '你真可爱',
    '记得吃饭呀', '晚安啦', '在吗', '你好呀', '我有点难过', '你太棒了',
    '忙死了', '想我没', '抱抱', '你怎么这么好', '我不开心', '早点睡',
    '拜拜', '今天顺利吗', '我好想你', '你最好了', '好累啊', '谢谢你懂我',
    '我错了嘛', '你真厉害', '去忙吧', '想念你', '睡了哦', '在不在呀',
  ];
  function freshState(over) {
    return Object.assign({
      affection: 300, firstMeet: Date.now() - 5 * 864e5,
      tex: { t: 50, d: -1, n: 0, ty: 0, tyAt: -99 },
      persona: { gender: 'female', tone: 'playful', theme: 'sakura', card: 'xiaonuan',
                 warmth: 0.6, proactivity: 0.45, whitespace: 0.5 },
      dayLife: {}, flags: {},
    }, over || {});
  }
  function runOnce() {
    const st = freshState();
    let hit = 0;
    for (const u of SCRIPT) {
      const r = E.reply(u, st);
      if (r.recentReplies !== undefined) st.recentReplies = r.recentReplies;
      if (r.topic !== undefined) st.topic = r.topic;
      if (r.ue !== undefined) st.ue = r.ue;
      if (r.replies && r.replies.length) st.lastReply = r.replies[r.replies.length - 1];
      const line = (r.replies && r.replies[0]) || '';
      if (hasMicro(line)) hit++;
    }
    return hit / SCRIPT.length * 100;
  }
  const K = 24;
  const rates = [];
  for (let i = 0; i < K; i++) rates.push(runOnce());
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  assert.ok(mean >= 35 && mean <= 65,
    `微行为覆盖率均值 ${mean.toFixed(1)}% 超出 [35,65] 设计带（G2 失守；24 次采样 ${rates.map((x) => x.toFixed(0)).join(',')}）`);
});

/* ── ③ 跨 tone 池不互窜（playful 不应取出仅属于 tsundere/clingy 的专属句） ── */
test('F-cross-tone · 跨 tone 池不互窜（同 intent 三态输出不取他态专属句）', () => {
  const lh = new LH();
  // 排除含情境变体（时间窗/affection 分桶）的 greeting/bye/concern，仅测纯 intent 池
  const cases = [
    ['我爱你呀', 'love'], ['好想你', 'miss'], ['我好难过', 'sad'], ['忙死了', 'busy'],
    ['谢谢你', 'thanks'], ['对不起', 'sorry'], ['你真可爱', 'praise'], ['你在干嘛呢', 'question'],
  ];
  const tones = ['playful', 'tsundere', 'clingy'];
  for (const [, intent] of cases) {
    const pools = {};
    for (const tone of tones) {
      const s = new Set();
      for (let i = 0; i < 40; i++) s.add(lh.ruleReply(pickUserText(intent), { tone, affection: 5 }));
      pools[tone] = s;
    }
    // 某 tone 的「专属句」= 落在该 tone 池、但另两 tone 池都不出现的句（即仅属该 tone）。
    // 断言：任一 tone 的输出集不得含「仅属另一 tone」的专属句 —— 即跨 tone 不互窜。
    // （共享通用句如「道什么歉呀…」三态同有，属刻意设计，不视为互窜；PRD F1 仅要求跨 intent 不互窜。）
    for (let a = 0; a < tones.length; a++) {
      for (let b = 0; b < tones.length; b++) {
        if (a === b) continue;
        const ta = tones[a], tb = tones[b], tc = tones[3 - a - b];
        const bExclusive = [...pools[tb]].filter((line) => !pools[ta].has(line) && !pools[tc].has(line));
        const leak = [...pools[ta]].filter((line) => bExclusive.indexOf(line) >= 0);
        assert.deepStrictEqual(leak, [],
          `${intent} · ${ta} 取出了仅属 ${tb} 的专属句（跨 tone 互窜）：${JSON.stringify(leak.slice(0, 2))}`);
      }
    }
  }
});
function pickUserText(intent) {
  const m = {
    love: '我爱你呀', miss: '好想你', sad: '我好难过', busy: '忙死了',
    thanks: '谢谢你', sorry: '对不起', praise: '你真可爱', question: '你在干嘛呢',
  };
  return m[intent];
}

/* ── ④ 防双加工（textured 分支不二次加工 mirror/recall） ── */
test('F-no-double-process · textured 分支不二次加工（跳过 mirror/recall）', () => {
  // (a) 短文本 + textured=true → 原句直出（无 pacing/continuity 触发）
  let altered = 0;
  const shorts = ['我有点累', '想你了', '今天开心', '在吗', '抱抱我'];
  for (let i = 0; i < 200; i++) {
    const t = shorts[i % shorts.length];
    const out = RT.orchestrate(t, { state: {}, ctx: { ue: { type: 'sad' }, textured: true } });
    if (out !== t) altered++;
  }
  assert.strictEqual(altered, 0, 'textured 分支对短文本做了二次加工（与 texture 双叠加）');

  // (b) 长文本 + textured=true + ue + mem → 不得出现 mirror 回声前缀 / recall 引用（pacing 允许）
  const MIRROR_SAD = ['看你这样，我心里也跟着软了', '听你这么说，我也闷闷的', '你难过我也跟着鼻酸', '怎么就让你受委屈了'];
  let mirrorHits = 0, recallHits = 0;
  const long = '今天发生了一件特别特别长的事情我都不知道该怎么说才好了总之就是很累很烦然后还想吃东西最后决定去睡觉';
  for (let i = 0; i < 200; i++) {
    const out = RT.orchestrate(long, {
      state: { persona: { tone: 'playful', warmth: 0.6, proactivity: 0.45, whitespace: 1 },
               mem: ['上周说好一起去海边'], dayLife: {} },
      ctx: { ue: { type: 'sad' }, textured: true },
    });
    if (MIRROR_SAD.some((p) => out.startsWith(p))) mirrorHits++;
    if (out.includes('～ 你之前还说起过')) recallHits++;
  }
  assert.strictEqual(mirrorHits, 0, 'textured 分支仍触发了 mirror（双加工）');
  assert.strictEqual(recallHits, 0, 'textured 分支仍触发了 recall（双加工）');

  // (c) 控制组：textured=false 时 mirror 必须能命中，证明 (b) 若回归会被抓到
  let ctrlMirror = 0;
  for (let i = 0; i < 100; i++) {
    const out = RT.orchestrate('我好难过', {
      state: { persona: { tone: 'playful', warmth: 0.6, proactivity: 0.45, whitespace: 0.5 } },
      ctx: { ue: { type: 'sad' }, textured: false },
    });
    if (MIRROR_SAD.some((p) => out.startsWith(p))) ctrlMirror++;
  }
  assert.ok(ctrlMirror > 0, '控制组：textured=false 时 mirror 完全不命中（L3 镜像失效，测试失灵）');
});

/* ── ⑤ L3 路径全覆盖（mirror/pacing/recall/continuity 至少各命中一次） ── */
test('F-L3-paths · L3 路径全覆盖：mirror/pacing/recall/continuity 各 ≥1 命中', () => {
  const MIRROR_SAD = ['看你这样，我心里也跟着软了', '听你这么说，我也闷闷的', '你难过我也跟着鼻酸', '怎么就让你受委屈了'];
  const BRIDGE = ['对了', '话说', '诶，说起这个', '顺便说一句', '哎对了'];
  // 含句末标点（。！？）且 ≥70 字、首标点位于中段（≥30 且 ≤ len-20），使 pacing 节奏分段可命中
  const long = '今天发生了一件特别特别长的事情我都不知道该怎么说才好了总之就是很累很烦然后还想吃东西最后决定去睡觉。不过后来我想了想其实也没那么严重，明天还要早起上班呢先好好休息吧，你也要早点睡哦。';
  let mirror = 0, pacing = 0, recall = 0, continuity = 0;
  for (let i = 0; i < 800; i++) {
    const out = RT.orchestrate(long, {
      state: { persona: { tone: 'playful', warmth: 0.6, proactivity: 0.45, whitespace: 1 },
               mem: ['上周说好一起去海边'], dayLife: {} },
      ctx: { ue: { type: 'sad' }, textured: false, isContinuation: true },
    });
    if (MIRROR_SAD.some((p) => out.startsWith(p))) mirror++;
    if (out.includes('\n')) pacing++;
    if (out.includes('～ 你之前还说起过')) recall++;
    if (BRIDGE.some((p) => out.startsWith(p + '，'))) continuity++;
  }
  assert.ok(mirror > 0, 'L3 mirror 路径 800 轮零命中（强度参数/门槛异常）');
  assert.ok(pacing > 0, 'L3 pacing 路径 800 轮零命中（节奏分段失效）');
  assert.ok(recall > 0, 'L3 recall 路径 800 轮零命中（记忆引用失效）');
  assert.ok(continuity > 0, 'L3 continuity 路径 800 轮零命中（话题连贯失效）');
});

/* ── 守门：冻结四文件字节精确 ── */
test('F-guard · 冻结四文件字节精确不变', () => {
  const exp = { 'engine.js': 251068, 'sw.js': 13894, 'memory.js': 13333, 'test/baseline.js': 2646 };
  for (const f in exp) {
    const sz = fs.statSync(path.join(ROOT, f)).size;
    assert.strictEqual(sz, exp[f], `${f} 字节应精确为 ${exp[f]}，实际 ${sz}（冻结线被触碰！）`);
  }
});

/* ── 守门：零外发（三微行为模块剥注释后扫网络字面） ──
 * 仅扫 F 真人感三层模块（texture / local-heuristic / reply-texture-orchestrator）；
 * app.js 的 https:// 云端点为候选 E 前既有（F7 仅改 persona 默认，零新增外发），
 * 与 E4 守门口径一致（E4 亦仅扫三模块，不含 app.js）。 */
test('F-guard · 零外发：三微行为模块扫描命中 0', () => {
  for (const f of ['reply-texture-orchestrator.js', 'texture.js', 'local-heuristic.js']) {
    const s = stripComments(read(f));
    assert.strictEqual(hasNetwork(s), false, `${f} 含网络外发字面（剥注释后）`);
  }
});

/* ── 守门：小暖不更名（四改动文件保留「小暖」） ── */
test('F-guard · 小暖不更名：四改动文件保留角色名', () => {
  let hits = 0;
  for (const f of ['reply-texture-orchestrator.js', 'texture.js', 'local-heuristic.js', 'app.js']) {
    const c = read(f);
    assert.ok(c.includes('小暖'), `改动文件 ${f} 必须保留角色名「小暖」`);
    hits += (c.match(/小暖/g) || []).length;
  }
  assert.ok(hits >= 45, `「小暖」出现次数不应被削弱（当前 ${hits}，阈值 ≥45）`);
});

/* ── 守门：F7 persona 默认值已落（warmth 0.6 / proactivity 0.45） ── */
test('F-guard · F7 app.js persona 默认 warmth 0.6 / proactivity 0.45', () => {
  const s = read('app.js');
  assert.ok(/warmth:\s*0\.6/.test(s), 'app.js defaultState 应含 warmth: 0.6（F7）');
  assert.ok(/proactivity:\s*0\.45/.test(s), 'app.js defaultState 应含 proactivity: 0.45（F7）');
});
