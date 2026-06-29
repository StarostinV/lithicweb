// ONNX model runner for in-browser inference (onnxruntime-web).
// - Prefers the WebGPU execution provider, falls back to WASM.
// - Caches the (60-120 MB) model file in IndexedDB so it downloads once.
// - Selectable precision: 'fp32' (exact parity) or 'fp16' (~half size; see plan re: tuning).
import * as ort from 'onnxruntime-web/webgpu';

// Serve the wasm runtime from a static path (copied to /ort/). numThreads=1 because the
// dev server doesn't set COOP/COEP, so SharedArrayBuffer (multi-thread wasm) is unavailable.
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

const DB_NAME = 'lithic-models';
const STORE = 'onnx';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    tx.onsuccess = () => resolve(tx.result || null);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Fetch model bytes, using IndexedDB cache. onProgress(receivedBytes, totalBytes?). */
async function fetchModelBytes(url, onProgress) {
  const cached = await idbGet(url).catch(() => null);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`model fetch failed: ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    if (onProgress) onProgress(received, total);
  }
  const bytes = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  await idbPut(url, bytes).catch(() => {});  // best-effort cache
  return bytes;
}

export async function webgpuAvailable() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator &&
    !!(await navigator.gpu?.requestAdapter().catch(() => null));
}

/** Whether the model file at `url` is already cached in IndexedDB (downloaded once). */
export async function isModelCached(url) {
  return !!(await idbGet(url).catch(() => null));
}

export class OnnxModel {
  constructor() { this.session = null; this.provider = null; }

  /**
   * @param {string} url model file URL (fp32 or fp16 .onnx)
   * @param {(received:number,total:number)=>void} [onProgress]
   */
  async load(url, onProgress) {
    const bytes = await fetchModelBytes(url, onProgress);
    const preferWebgpu = await webgpuAvailable();
    const providers = preferWebgpu ? ['webgpu', 'wasm'] : ['wasm'];
    let lastErr;
    for (const ep of providers) {
      try {
        this.session = await ort.InferenceSession.create(bytes, { executionProviders: [ep] });
        this.provider = ep;
        return ep;
      } catch (e) { lastErr = e; }
    }
    throw new Error(`failed to create ONNX session: ${lastErr?.message}`);
  }

  /**
   * Run the model on one 6-channel image.
   * @param {Float32Array} img6 length 6*RES*RES (channel-major, Python layout)
   * @param {number} res
   * @returns {Promise<Float32Array>} length RES*RES (soft-edge logits)
   */
  async run(img6, res = 512) {
    const input = new ort.Tensor('float32', img6, [1, 6, res, res]);
    const out = await this.session.run({ input });
    return out[Object.keys(out)[0]].data;
  }

  dispose() { this.session?.release?.(); this.session = null; }
}
