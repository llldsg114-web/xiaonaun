/**
 * qa-v4-2-acceptance.test.js · 心屿 v4.2（五官双向指标系统 S3）· QA 严过关 独立验收
 *
 * 独立验证工程师寇豆码自报 IS_PASS=YES 的 v4.2「五官双向指标系统」，不轻信工程师。
 * 8 项断言（F1–F8）以静态/git 级为主（项目 node 侧无 DOM，helpers.js 用 Proxy 毒化 document），
 * 真实 DOM 行为按 qa-d 既有约定标注为需浏览器人工确认。
 *
 *   F1 冻结线四文件字节精确零交集（statSync）
 *   F2 零上报守门：sense/face/voice 三文件剥注释后无外发原语，仅本地 API
 *   F3 ConsentStore 守门：sense.camera/sense.mic 默认 false，未同意不启动 getUserMedia
 *   F4 降级路径：无 camera/mic 同意走纯文本+SVG/emoji，不白屏不抛错
 *   F5 神态呈现双轨：SVG(moodToExpr 复用) + emoji 通道 + moodToTTS 7 态档位（非自建静音拼接）
 *   F6 面部信号本地提取：光度/运动启发式，无端侧模型硬依赖
 *   F7 语音情绪本地提取：AnalyserNode 基频/能量/语速→情绪信号，零上报
 *   F8 装载拓扑：6 模块 index.html 装载 + app.js 之前 + engine.files.json order
 *
 * 运行：node --test ai-girlfriend/test/qa-v4-2-acceptance.test.js
 * 纪律：只写验收测试，不改冻结四文件 / 体积闸 / qa-d（AC-D42 由主理人齐活林重 baselining）。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* 剥注释（块注释 + 行注释）；三文件无正则字面量、无字符串含 // 或 /*，安全 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/* 外发原语扫描（与 qa-v4-1 同口径，覆盖 PRD/ARCH 零上报字面量清单） */
function hasNetwork(s) {
  return /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new URL|https?:\/\/|navigator\.(sendBeacon|geolocation)|^\s*import\s|require\(/.test(s);
}

/* ───────────────────────── F1 · 冻结线零交集 ───────────────────────── */
test('F1 · 冻结线四文件字节精确零交集（engine/sw/memory/test-baseline）', () => {
  const exp = { 'engine.js': 251068, 'sw.js': 13894, 'memory.js': 13333, 'test/baseline.js': 2646 };
  for (const f in exp) {
    const sz = fs.statSync(path.join(ROOT, f)).size;
    assert.strictEqual(sz, exp[f], `${f} 字节应精确 ${exp[f]}，实际 ${sz}（冻结线被触碰！）`);
  }
});

/* ───────────────────────── F2 · 零上报守门 ───────────────────────── */
test('F2 · 零上报守门：sense/face/voice 三文件剥注释后无外发原语，仅本地 API', () => {
  const trio = ['sense-core.js', 'face-sense.js', 'voice-sense.js'];
  for (const f of trio) {
    const stripped = stripComments(read(f));
    assert.strictEqual(hasNetwork(stripped), false, `${f} 剥注释后含外发字面（零上报破防！）`);
  }
  // 正向：走本地端侧 API（getUserMedia/AnalyserNode/Canvas），证明取流仅做本地分析、无上传
  assert.ok(stripComments(read('face-sense.js')).includes('getUserMedia'), 'face-sense 应走 getUserMedia 本地取流');
  assert.ok(/createAnalyser|AnalyserNode|getByteTimeDomainData/.test(stripComments(read('voice-sense.js'))), 'voice-sense 应走 AnalyserNode 本地分析');
  // sense-core 自身不含 getUserMedia（取流由适配器门控，统一入口不直接碰媒体设备）
  assert.ok(!stripComments(read('sense-core.js')).includes('getUserMedia'), 'sense-core 统一入口不应直接 getUserMedia（由 face/voice 适配器门控）');
});

/* ───────────────────────── F3 · ConsentStore 守门 ───────────────────────── */
test('F3 · ConsentStore 守门：sense.camera/sense.mic 默认 false，未同意不启动 getUserMedia', () => {
  // 静态：授权键 + 默认 false
  const csSrc = read('consent-store.js');
  assert.ok(/'sense\.camera'/.test(csSrc) && /'sense\.mic'/.test(csSrc), 'consent-store 应含 sense.camera/sense.mic 授权键');
  assert.ok(/sense\.camera'\s*:\s*false/.test(csSrc) && /sense\.mic'\s*:\s*false/.test(csSrc), 'sense.camera/sense.mic 默认值应为 false');
  // 动态：实例默认 false
  const CS = require(path.join(ROOT, 'consent-store.js'));
  const inst = new CS();
  assert.strictEqual(inst.get('sense.camera'), false, 'sense.camera 默认应 false（最小权限）');
  assert.strictEqual(inst.get('sense.mic'), false, 'sense.mic 默认应 false（最小权限）');
  // 静态：SenseCore.readUserEmotion 含 isConsented 门控分支（未同意绝不调适配器 infer / getUserMedia）
  const scSrc = stripComments(read('sense-core.js'));
  assert.ok(/isConsented\(\s*['"]sense\.camera['"]\s*\)/.test(scSrc), 'sense-core 应以 isConsented("sense.camera") 门控 face 适配器');
  assert.ok(/isConsented\(\s*['"]sense\.mic['"]\s*\)/.test(scSrc), 'sense-core 应以 isConsented("sense.mic") 门控 voice 适配器');
  // 动态：未同意时 readUserEmotion 即使传入 frame/analyser 也不注入 face/voice 维度
  const SC = require(path.join(ROOT, 'sense-core.js'));
  SC.init({ get: () => false, onChange: () => {} }, null);
  const ue = SC.readUserEmotion({ text: '今天好累', cameraFrame: { dummy: 1 }, audioAnalyser: { dummy: 1 } });
  assert.ok(ue && typeof ue === 'object', '未同意也应返回文本 ue（不白屏）');
  assert.ok(ue.gaze === undefined && ue.smile === undefined && ue.arousal === undefined,
    '未同意不应注入 face/voice 专属维度（getUserMedia 门控生效）');
});

/* ───────────────────────── F4 · 降级路径 ───────────────────────── */
test('F4 · 降级路径：无 camera/mic 同意走纯文本+SVG/emoji，不白屏不抛错', () => {
  const app = read('app.js');
  // safeSenseRead 降级安全：SenseCore 缺席/抛错 → null（try/catch 兜底）
  const fnAt = app.indexOf('function safeSenseRead');
  assert.ok(fnAt >= 0, 'app.js 应有 safeSenseRead');
  const fnBody = app.slice(fnAt, fnAt + 260);
  assert.ok(/try/.test(fnBody) && /catch/.test(fnBody) && /return null/.test(fnBody), 'safeSenseRead 应 try/catch→null 降级（不抛错）');
  // 纯文本+SVG/emoji 神态分支存在（降级路径下同样可见，绝不白屏）
  assert.ok(/function setExpression/.test(app), 'app.js 应有 SVG 神态 setExpression（降级仍呈现）');
  assert.ok(/MOOD_EMOJI/.test(app) && /function applyMoodEmoji/.test(app), 'app.js 应有轻量 emoji 通道（降级可见）');
  // herSay 中 SenseCore 缺席退纯文本语调（senseTts 可为 null，speak 仍以文本为主）
  assert.ok(/senseTts/.test(app), 'herSay 应合并 senseTts（缺席则 null，退纯文本语调）');
  // 动态：未同意 + 无 frame → 仅文本 ue，不抛
  const SC = require(path.join(ROOT, 'sense-core.js'));
  SC.init({ get: () => false, onChange: () => {} }, null);
  const ue = SC.readUserEmotion({ text: '我好累' });
  assert.ok(typeof ue === 'object' && ue !== null, '降级路径应返回文本 ue，绝不抛错/白屏');
  // 注：真实 DOM 渲染（setExpression/applyMoodEmoji 写节点）需浏览器人工确认，此处仅静态锁分支存在
});

/* ───────────────────────── F5 · 神态呈现双轨 ───────────────────────── */
test('F5 · 神态呈现双轨：SVG(moodToExpr 复用) + emoji 通道 + moodToTTS 7 态档位（非自建静音拼接）', () => {
  const EC = require(path.join(ROOT, 'emotion-core.js'));
  const SC = require(path.join(ROOT, 'sense-core.js'));
  const app = read('app.js');
  // SVG 神态：moodToExpr 复用（emotion-core 暴露，app.js 调用）
  assert.strictEqual(typeof EC.moodToExpr, 'function', 'emotion-core 应暴露 moodToExpr（SVG 神态复用）');
  assert.ok(/moodToExpr/.test(app), 'app.js 应调用 moodToExpr（SVG 神态主轨）');
  // emoji 轻量通道（气泡尾/心情徽标，降级路径下同样可见）
  assert.ok(/applyMoodEmoji/.test(app), 'app.js 应有 emoji 轻量通道（双轨辅轨）');
  // moodToTTS：7 态 → speed/pitch/pause 粗粒度档位
  assert.strictEqual(typeof SC.moodToTTS, 'function', 'sense-core 应暴露 moodToTTS（S3 双向对称归属）');
  const states = ['joy', 'anger', 'sad', 'coquettish', 'jealous', 'longing', 'peaceful', 'neutral'];
  const seen = new Set();
  for (const k of states) {
    const t = SC.moodToTTS({ key: k, intensity: 0.8 });
    assert.ok(t && typeof t.speed === 'number' && typeof t.pitch === 'number' && typeof t.pause === 'string',
      `${k} moodToTTS 应返回 {speed:number, pitch:number, pause:string}`);
    seen.add(t.speed + ':' + t.pitch + ':' + t.pause);
  }
  assert.ok(seen.size >= 4, `7 态语调档位应差异化（≥4 种），实 ${seen.size}（不应全同一档）`);
  // 非自建静音拼接（架构决策⑥：粗粒度档位，pause 仅作节奏提示）
  const scSrc = stripComments(read('sense-core.js'));
  assert.ok(!/OfflineAudioContext|AudioBuffer|createBuffer/.test(scSrc), 'moodToTTS 不应自建静音拼接（零依赖优先）');
});

/* ───────────────────────── F6 · 面部信号本地提取 ───────────────────────── */
test('F6 · 面部信号本地提取：光度/运动启发式，无端侧模型硬依赖（P1 才可选）', () => {
  const stripped = stripComments(read('face-sense.js'));
  // 光度/运动启发式关键词（灰度亮度 + 相邻帧运动矢量）
  assert.ok(/0\.299|0\.587|0\.114|getImageData|drawImage/.test(stripped), 'face-sense 应含光度灰度启发式（亮度系数/canvas 取帧）');
  assert.ok(/motion|lastGray|mean/.test(stripped), 'face-sense 应含相邻帧运动矢量启发式');
  // 无端侧模型硬依赖（face-api/tfjs/tensorflow/onnx/loadModel 等）
  assert.ok(!/face-api|tfjs|tensorflow|@tensorflow|onnx|loadModel|model\.load/.test(stripped), 'face-sense 不应硬依赖端侧模型（P1 才可选）');
  // 动态：FaceSense.create() 未 setEnabled 时 infer 返回中性 ue（不碰媒体设备）
  const FS = require(path.join(ROOT, 'face-sense.js'));
  const adapter = FS.create();
  assert.strictEqual(adapter.isEnabled(), false, 'face-sense 默认未启用');
  const ue = adapter.infer();
  assert.ok(ue && ue.type === 'neutral', '未启用时 face-sense.infer 应返回中性 ue');
  assert.ok(ue.gaze === 'center' && ue.smile === 0, '未启用时面部维度应回落中性');
});

/* ───────────────────────── F7 · 语音情绪本地提取 ───────────────────────── */
test('F7 · 语音情绪本地提取：AnalyserNode 基频/能量/语速→情绪信号，零上报', () => {
  const stripped = stripComments(read('voice-sense.js'));
  // AnalyserNode 时域分析
  assert.ok(/createAnalyser|getByteTimeDomainData|fftSize/.test(stripped), 'voice-sense 应走 AnalyserNode 时域分析');
  // 基频/能量/语速/唤醒度提取
  assert.ok(/estimatePitch|pitch/.test(stripped), 'voice-sense 应提取基频（自相关 estimatePitch）');
  assert.ok(/rms|RMS|segments|rate|arousal/.test(stripped), 'voice-sense 应提取能量/语速/唤醒度');
  // 零上报（与 F2 互证）
  assert.strictEqual(hasNetwork(stripped), false, 'voice-sense 剥注释后无外发原语（零上报铁律）');
  // 动态：VoiceSense.create() 未启用时 infer 返回中性，语音维度归零
  const VS = require(path.join(ROOT, 'voice-sense.js'));
  const adapter = VS.create();
  assert.strictEqual(adapter.isEnabled(), false, 'voice-sense 默认未启用');
  const ue = adapter.infer();
  assert.ok(ue && ue.type === 'neutral', '未启用时 voice-sense.infer 应返回中性 ue');
  assert.ok(ue.arousal === 0 && ue.pitch === 0 && ue.rate === 0, '未启用时语音维度应归零');
});

/* ───────────────────────── F8 · 装载拓扑 ───────────────────────── */
test('F8 · 装载拓扑：6 模块 index.html 装载 + app.js 之前 + engine.files.json order', () => {
  const HTML = read('index.html');
  const CORES = ['dialogue-core.js', 'emotion-core.js', 'persona-core.js', 'face-sense.js', 'voice-sense.js', 'sense-core.js'];
  for (const f of CORES) {
    assert.ok(HTML.includes(`<script src="${f}"></script>`), `index.html 应以 <script> 装载 ${f}`);
  }
  // 6 模块均位于 app.js 之前（herReply/senseCore 才能消费）
  const atLast = Math.max(...CORES.map(f => HTML.indexOf(`<script src="${f}"></script>`)));
  const atApp = HTML.indexOf('<script src="app.js"></script>');
  assert.ok(atLast >= 0 && atApp >= 0 && atLast < atApp, '6 模块必须全部在 app.js 之前装载');
  // engine.files.json order 同步 6 模块（WR-13 missingAssets 校验）
  const man = JSON.parse(read('engine.files.json'));
  for (const f of CORES) {
    assert.ok(Array.isArray(man.order) && man.order.includes(f), `${f} 应进 engine.files.json order（WR-13 对齐）`);
  }
});
