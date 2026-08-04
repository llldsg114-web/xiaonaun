/* ============================================================
 * 小暖 · 端侧推理模块（离线 AI 兜底）
 * 用 transformers.js 在浏览器里跑一个小模型，实现"零配置、断网也能聊"。
 * 只有在用户启用并点击加载时，才会动态 import 这个库，不增加首屏体积。
 * 默认模型：onnx-community/Qwen2.5-0.5B-Instruct（中文友好，约 0.5GB）。
 * ============================================================ */
const LocalModel = (() => {
  let generator = null;
  let loading = false;
  let busy = false;
  const listeners = [];

  const DEFAULT_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
  // 最新稳定版 transformers.js（v4）。HTML 里通过 CDN 动态加载。
  const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

  function emit(p) { listeners.forEach(cb => { try { cb(p); } catch (e) {} }); }
  function onProgress(cb) { if (typeof cb === "function") listeners.push(cb); }

  function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }
  function isLoaded() { return !!generator; }
  function isLoading() { return loading; }

  /* 加载模型：先动态 import 库，再按设备能力选后端与量化精度。
   * progress_callback 把下载进度通过 onProgress 抛给 UI。 */
  async function load(modelId) {
    if (generator || loading) return generator;
    const model = modelId || DEFAULT_MODEL;
    loading = true;
    emit({ status: "loading", progress: 0, text: "开始加载端侧模型…" });
    try {
      const mod = await import(/* @vite-ignore */ CDN);
      const { pipeline, env } = mod;
      env.allowLocalModels = false;        // 我们只用 HuggingFace 远程权重
      env.useBrowserCache = true;          // 浏览器缓存，下次免下载

      const device = hasWebGPU() ? "webgpu" : "wasm";
      const dtype = device === "webgpu" ? "q4f16" : "q4";
      emit({ status: "loading", progress: 2, text: `准备推理后端（${device.toUpperCase()}）…` });

      generator = await pipeline("text-generation", model, {
        device, dtype,
        progress_callback: (p) => {
          if (!p) return;
          if (p.status === "progress" && typeof p.progress === "number") {
            emit({ status: "loading", progress: Math.round(p.progress), file: p.file,
                   text: `${p.file || "模型权重"} ${Math.round(p.progress)}%` });
          } else if (p.status === "ready") {
            emit({ status: "loading", progress: 98, text: "模型加载完成，正在预热…" });
          } else if (p.status === "done") {
            emit({ status: "loading", progress: 99, text: "正在预热…" });
          }
        },
      });
      loading = false;
      emit({ status: "ready", progress: 100, text: "已就绪，可以离线对话啦～" });
      return generator;
    } catch (e) {
      loading = false;
      generator = null;
      console.warn("[LocalModel] 加载失败：", e);
      emit({ status: "error", text: "加载失败：" + (e && e.message ? e.message : e) });
      throw e;
    }
  }

  /* 推理：传入 messages（含 system + 历史 + 当前 user），返回纯文本或 null。
   * 推理出错/超时都返回 null，让上层回落到本地规则引擎，永不阻塞用户。 */
  async function reply(messages) {
    if (!generator || busy) return null;
    busy = true;
    try {
      const out = await generator(messages, {
        max_new_tokens: 140,
        do_sample: true,
        temperature: 0.9,
        top_p: 0.9,
        repetition_penalty: 1.15,
        skip_special_tokens: true,
      });
      const gen = out && out[0] && out[0].generated_text;
      let text = "";
      if (Array.isArray(gen)) text = (gen[gen.length - 1].content) || "";
      else if (typeof gen === "string") text = gen;
      text = (text || "").trim();
      return text || null;
    } catch (e) {
      console.warn("[LocalModel] 推理失败：", e);
      return null;
    } finally {
      busy = false;
    }
  }

  function unload() { generator = null; emit({ status: "idle", text: "已卸载模型" }); }

  return { load, reply, isLoaded, isLoading, hasWebGPU, onProgress, unload, DEFAULT_MODEL };
})();
if (typeof window !== "undefined") window.LocalModel = LocalModel;
