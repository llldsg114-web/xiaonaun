/* ============================================================
 * 小暖 · 端侧图像描述模块（离线看图兜底）
 * 用 transformers.js 在浏览器里跑 vit-gpt2-image-captioning，纯本地把图"看"成一句
 * 英文描述，作为云端视觉模型不可用时的兜底。只有在真的需要看图（用户发图且未配
 * 云端视觉）时才动态 import 该库，不增加首屏体积。
 * 默认模型：Xenova/vit-gpt2-image-captioning（小巧，约 0.4GB 权重）。
 * ============================================================ */
const ImageCaption = (() => {
  let pipe = null;
  let loading = false;
  let busy = false;
  const listeners = [];

  const DEFAULT_MODEL = "Xenova/vit-gpt2-image-captioning";
  const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

  function emit(p) { listeners.forEach(cb => { try { cb(p); } catch (e) {} }); }
  function onProgress(cb) { if (typeof cb === "function") listeners.push(cb); }

  function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }
  function isLoaded() { return !!pipe; }
  function isLoading() { return loading; }

  /* 加载模型：动态 import 库 → 按设备能力选后端。progress 抛给 UI。 */
  async function load(modelId) {
    if (pipe || loading) return pipe;
    const model = modelId || DEFAULT_MODEL;
    loading = true;
    emit({ status: "loading", progress: 0, text: "开始加载看图模型…" });
    try {
      const mod = await import(/* @vite-ignore */ CDN);
      const { pipeline, env } = mod;
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const device = hasWebGPU() ? "webgpu" : "wasm";
      emit({ status: "loading", progress: 2, text: `准备看图后端（${device.toUpperCase()}）…` });

      pipe = await pipeline("image-captioning", model, {
        device,
        progress_callback: (p) => {
          if (!p) return;
          if (p.status === "progress" && typeof p.progress === "number") {
            emit({ status: "loading", progress: Math.round(p.progress), file: p.file,
                   text: `${p.file || "看图模型"} ${Math.round(p.progress)}%` });
          } else if (p.status === "ready" || p.status === "done") {
            emit({ status: "loading", progress: 99, text: "看图模型预热中…" });
          }
        },
      });
      loading = false;
      emit({ status: "ready", progress: 100, text: "已就绪，我可以看图啦～" });
      return pipe;
    } catch (e) {
      loading = false;
      pipe = null;
      console.warn("[ImageCaption] 加载失败：", e);
      emit({ status: "error", text: "看图模型加载失败：" + (e && e.message ? e.message : e) });
      throw e;
    }
  }

  /* 描述一张图：src 可为 dataURL / blobURL / 图片地址。返回英文描述字符串或 null。 */
  async function caption(src) {
    if (!pipe) {
      // 未加载则先按需加载（首张图会稍慢，之后走浏览器缓存）
      try { await load(); } catch (e) { return null; }
    }
    if (!pipe || busy) {
      if (busy) return null;
      return null;
    }
    busy = true;
    try {
      const out = await pipe(src, { max_new_tokens: 24, num_beams: 4, do_sample: false });
      const text = (Array.isArray(out) ? out[0] && out[0].generated_text : out && out.generated_text) || "";
      return (text || "").trim() || null;
    } catch (e) {
      console.warn("[ImageCaption] 推理失败：", e);
      return null;
    } finally {
      busy = false;
    }
  }

  function unload() { pipe = null; emit({ status: "idle", text: "已卸载看图模型" }); }

  return { load, caption, isLoaded, isLoading, hasWebGPU, onProgress, unload, DEFAULT_MODEL };
})();
if (typeof window !== "undefined") window.ImageCaption = ImageCaption;
