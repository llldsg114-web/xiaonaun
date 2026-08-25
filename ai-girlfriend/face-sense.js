/**
 * face-sense.js · 心屿 v4.2（五官双向指标系统 · S3-A 摄像头识别）· 端侧面部信号本地提取
 * --------------------------------------------------------------------
 * 摄像头端侧识别（纯 JS 启发式优先，零模型、零依赖）：光度高斯近似 + 相邻帧运动矢量 →
 * 推断 注视/微笑/皱眉/疲劳 等情绪信号，产出 ue 喂 SenseCore。
 *
 * 设计铁律（架构 ARCH-xinyu-v4-2-sense.md / PRD G2）：
 *   · 隐私零上报：摄像头原始帧仅在本机内存（canvas）处理，绝不录音录像、绝不落盘、绝不外发；
 *     本文件不含 fetch / XHR / WebSocket / sendBeacon / new URL / http(s):// 字面量。
 *   · 同意门控：仅当 SenseCore 经 ConsentStore 同意后才由 setEnabled(true) 触发 getUserMedia，
 *     未同意绝不开启摄像头；撤销即停机并释放媒体流。
 *   · 降级安全：任一异常 → 退 neutral ue，绝不阻塞对话。
 *   · 前端零新增 npm 依赖（纯原生 Web API）。
 *   · 小暖不更名。
 */
(function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined' ? self : null);

  /** face-sense 适配器工厂（挂 window.FaceSense）。 */
  function FaceSense() {}

  /** 创建一个适配器实例。
   *  @returns {object} { setEnabled, isEnabled, infer, stop, start }
   */
  FaceSense.create = function () {
    var video = null, canvas = null, ctx2d = null, stream = null, raf = 0;
    var running = false, enabled = false;
    var lastGray = null;     // 上一帧下采样灰度（运动矢量基准）
    // 最新本地推断结果（ue）；未启用时返回中性
    var ue = { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, gaze: 'center', tired: 0, smile: 0, frown: 0 };

    /** 取一帧 → 计算灰度数组 + 均值亮度（光度） */
    function grabGray() {
      if (!video || !ctx2d) return null;
      try {
        ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
        var data = ctx2d.getImageData(0, 0, canvas.width, canvas.height).data;
        var gray = [], sum = 0;
        for (var i = 0; i < data.length; i += 4) {
          var g = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;  // 亮度
          gray.push(g); sum += g;
        }
        return { gray: gray, mean: sum / (gray.length || 1) };
      } catch (e) { return null; }
    }

    /** 主循环：光度 + 运动 → 启发式情绪信号（仅内存，绝不外发） */
    function loop() {
      if (!running) return;
      raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(loop) : setTimeout(loop, 100);
      var f = grabGray();
      if (!f) return;
      var mean = f.mean;
      // 运动矢量：与上一帧间隔采样灰度差均值（downsample 8 倍提速）
      var motion = 0, cnt = 0;
      if (lastGray) {
        var step = 8;
        for (var k = 0; k < f.gray.length; k += step) {
          motion += Math.abs(f.gray[k] - (lastGray[k] || mean));
          cnt++;
        }
      }
      lastGray = f.gray;
      motion = cnt ? motion / cnt : 0;

      var lum = mean / 255;                       // 0..1 光度
      var mv = Math.min(1, motion / 40);          // 0..1 运动强度
      // 启发式推导（纯局部、零模型）：
      //  · 暗光 → 疲劳/低落（tired↑）
      //  · 中高运动 → 活跃（可能微笑/说话）
      var tired = lum < 0.18 ? 0.7 : (lum < 0.30 ? 0.35 : 0.0);
      var smile = mv > 0.32 ? 0.6 : 0.1;
      var polarity = (lum > 0.4 ? 0.25 : 0) - tired * 0.5 + smile * 0.3;
      ue = {
        type: polarity < 0 ? 'tired' : (smile > 0.4 ? 'affection' : 'neutral'),
        polarity: polarity,
        intensity: Math.max(mv, tired, smile) * 0.8 + 0.1,
        confidence: 0.5,
        gaze: (mv > 0.5) ? 'active' : 'center',   // 运动活跃→注视互动中
        tired: tired,
        smile: smile,
        frown: (lum < 0.18 && mv < 0.1) ? 0.4 : 0,  // 暗且静止→略皱眉/疲惫
      };
    }

    /** 启动摄像头采集（仅本地）。返回 Promise<boolean>。失败静默降级。 */
    function start() {
      if (running) return Promise.resolve(true);
      if (!G || !G.navigator || !G.navigator.mediaDevices || !G.navigator.mediaDevices.getUserMedia) {
        return Promise.resolve(false);   // 不支持 → 退文本路径
      }
      return G.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function (s) {
        stream = s;
        video = G.document.createElement('video');
        video.muted = true; video.playsInline = true; video.srcObject = s;
        return video.play().then(function () {
          canvas = G.document.createElement('canvas');
          canvas.width = 64; canvas.height = 48;     // 小尺寸足以做光度/运动启发式，省内存
          ctx2d = canvas.getContext('2d');
          running = true; loop();
          return true;
        });
      }).catch(function () { return false; });   // 拒权/无设备 → 退文本路径
    }

    /** 停机并释放媒体流（撤销同意时调用，零上报铁律） */
    function stop() {
      running = false;
      if (raf) { try { (typeof cancelAnimationFrame === 'function') ? cancelAnimationFrame(raf) : clearTimeout(raf); } catch (e) {} }
      if (stream) { try { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (e) {} stream = null; }
      video = null; canvas = null; ctx2d = null; lastGray = null;
      ue = { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, gaze: 'center', tired: 0, smile: 0, frown: 0 };
    }

    return {
      /** 由 SenseCore 门控：开启即按同意态取流，关闭即停机释放 */
      setEnabled: function (on) {
        enabled = !!on;
        if (enabled) { try { start(); } catch (e) {} } else { try { stop(); } catch (e) {} }
      },
      isEnabled: function () { return enabled; },
      /** 返回最新本地推断 ue（未启用返回中性） */
      infer: function () { return enabled ? ue : { type: 'neutral', polarity: 0, intensity: 0, confidence: 0, gaze: 'center', tired: 0, smile: 0, frown: 0 }; },
      start: start,
      stop: stop,
    };
  };

  // 对外门面
  if (G) {
    G.FaceSense = FaceSense;
    if (typeof module !== 'undefined' && module.exports) module.exports = FaceSense;
  }
})();
