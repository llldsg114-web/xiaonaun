/**
 * voice-sense.js · 心屿 v4.2（五官双向指标系统 · S3-A 麦克风识别）· 端侧语音情绪本地提取
 * --------------------------------------------------------------------
 * 麦克风端侧识别（Web Audio AnalyserNode，纯原生、零依赖）：基频/能量/RMS/停顿/语速启发式 →
 * 推断情绪与唤醒度，产出 ue 喂 SenseCore。
 *
 * 设计铁律（架构 ARCH-xinyu-v4-2-sense.md / PRD G3 / 主理人拍板④）：
 *   · 隐私零上报：麦克风原始音频仅在本机内存（AnalyserNode 时域缓冲）处理，绝不录音、绝不外发；
 *     本文件不含 fetch / XHR / WebSocket / sendBeacon / new URL / http(s):// 字面量。
 *   · 独立授权项：sense.mic 与 asr 授权解耦（实现层可共享同一 getUserMedia 流以省资源，
 *     此处按独立流实现，授权各自独立读取）；未同意绝不开启麦克风；撤销即停机释放流。
 *   · 降级安全：任一异常 → 退中性 ue，绝不阻塞对话。
 *   · 前端零新增 npm 依赖。
 *   · 小暖不更名。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  /** voice-sense 适配器工厂（挂 window.VoiceSense）。 */
  function VoiceSense() {}

  /** 创建一个适配器实例。
   *  @returns {object} { setEnabled, isEnabled, infer, stop, start }
   */
  VoiceSense.create = function () {
    var AC = null, src = null, analyser = null, stream = null, buf = null;
    var raf = 0, running = false, enabled = false;
    // 语音活动统计（用于语速/停顿启发式）
    var speechFrames = 0, silenceFrames = 0, lastSpeechAt = 0, segments = 0, pendingSeg = false;
    // 最新本地推断结果（ue）
    var ue = { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, arousal: 0, rate: 0, pitch: 0, speaking: false };

    /** 估算基频（自相关，降采样时域缓冲） */
    function estimatePitch(data, sampleRate) {
      try {
        var SIZE = data.length;
        var MAX_LAG = Math.floor(sampleRate / 80);    // 80Hz 下限
        var MIN_LAG = Math.floor(sampleRate / 400);   // 400Hz 上限（人声基频区间）
        var bestLag = -1, bestCorr = 0;
        for (var lag = MIN_LAG; lag <= MAX_LAG; lag++) {
          var corr = 0;
          for (var i = 0; i < SIZE - lag; i++) corr += (data[i] - 128) * (data[i + lag] - 128);
          if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
        }
        if (bestLag > 0 && bestCorr > 0) return sampleRate / bestLag;
      } catch (e) {}
      return 0;
    }

    /** 主循环：时域 RMS + 基频 → 情绪/唤醒度（仅内存，绝不外发） */
    function loop() {
      if (!running) return;
      raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(loop) : setTimeout(loop, 80);
      if (!analyser || !buf) return;
      try {
        analyser.getByteTimeDomainData(buf);
        // RMS 能量（0..1）
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
        var rms = Math.sqrt(sum / buf.length);
        var sr = (AC && AC.sampleRate) ? AC.sampleRate : 16000;
        var pitch = estimatePitch(buf, sr);
        var speaking = rms > 0.04;   // 能量门限：高于即视为在说话

        // 语音段统计（语速/停顿启发式）
        var now = (G && G.Date) ? Date.now() : 0;
        if (speaking) {
          speechFrames++;
          if (!pendingSeg) { pendingSeg = true; segments++; lastSpeechAt = now; }
        } else {
          silenceFrames++;
          if (pendingSeg && (now - lastSpeechAt) > 350) pendingSeg = false;   // 停顿 >350ms 视为一个语段结束
        }
        // 唤醒度随能量/基频；正向情绪（开心）语速快、基频高；低落（疲惫/哀）语速慢、基频低
        var arousal = Math.min(1, rms * 6);
        var rate = segments > 0 ? Math.min(1, segments / 6) : 0;   // 语段数归一（越多越流利/急）
        // 极性启发式：高唤醒 + 高基频 → 正向（joy）；低唤醒 → 负向（哀/累）
        var polarity = (arousal > 0.35 ? 0.4 : -0.2) + (pitch > 200 ? 0.15 : -0.1);
        ue = {
          type: polarity > 0 ? 'joy' : (arousal < 0.15 ? 'tired' : 'neutral'),
          polarity: polarity,
          intensity: Math.max(arousal, rate) * 0.8 + 0.1,
          confidence: 0.5,
          arousal: arousal,
          rate: rate,
          pitch: pitch,
          speaking: speaking,
        };
      } catch (e) {}
    }

    /** 启动麦克风采集（仅本地）。返回 Promise<boolean>。失败静默降级。 */
    function start() {
      if (running) return Promise.resolve(true);
      if (!G || !G.navigator || !G.navigator.mediaDevices || !G.navigator.mediaDevices.getUserMedia) {
        return Promise.resolve(false);
      }
      return G.navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (s) {
        stream = s;
        var ACtor = G.AudioContext || G.webkitAudioContext;
        if (!ACtor) throw new Error('no AudioContext');
        AC = new ACtor();
        if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
        src = AC.createMediaStreamSource(s);
        analyser = AC.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        buf = new Uint8Array(analyser.fftSize);
        running = true; loop();
        return true;
      }).catch(function () { return false; });
    }

    /** 停机并释放媒体流（撤销同意时调用，零上报铁律） */
    function stop() {
      running = false;
      if (raf) { try { (typeof cancelAnimationFrame === 'function') ? cancelAnimationFrame(raf) : clearTimeout(raf); } catch (e) {} }
      if (src) { try { src.disconnect(); } catch (e) {} src = null; }
      if (AC) { try { AC.close(); } catch (e) {} AC = null; }
      if (stream) { try { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (e) {} stream = null; }
      analyser = null; buf = null;
      speechFrames = 0; silenceFrames = 0; segments = 0; pendingSeg = false; lastSpeechAt = 0;
      ue = { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, arousal: 0, rate: 0, pitch: 0, speaking: false };
    }

    return {
      /** 由 SenseCore 门控：开启即按同意态取流，关闭即停机释放 */
      setEnabled: function (on) {
        enabled = !!on;
        if (enabled) { try { start(); } catch (e) {} } else { try { stop(); } catch (e) {} }
      },
      isEnabled: function () { return enabled; },
      /** 返回最新本地推断 ue（未启用返回中性） */
      infer: function () { return enabled ? ue : { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, arousal: 0, rate: 0, pitch: 0, speaking: false }; },
      start: start,
      stop: stop,
    };
  };

  // 对外门面
  if (G) {
    G.VoiceSense = VoiceSense;
    if (typeof module !== 'undefined' && module.exports) module.exports = VoiceSense;
  }
})();
