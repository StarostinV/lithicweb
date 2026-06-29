// Registry of ONNX models served from Hugging Face. Each entry is a HF model repo
// containing `model_fp32.onnx` and `model_fp16.onnx`. Files are fetched directly from
// the HF `resolve` endpoint (CORS-enabled, CDN-backed) and cached in IndexedDB, so the
// app needs no contact with the Python `neurolithic_light` package or any server.
//
// To add a model: upload model_fp32.onnx / model_fp16.onnx to a HF repo under the
// `neurolithic` org and add an entry below (or pick "Custom…" in the UI at runtime).

export const HF_BASE = 'https://huggingface.co';

export const MODEL_REGISTRY = [
    // `neurolithic/best` tracks the current production model (re-published over time).
    { id: 'best', label: 'Best (production)', repo: 'neurolithic/best', revision: 'main' },
    { id: 'unet_v2', label: 'UNet v2 (latest)', repo: 'neurolithic/unet_v2', revision: 'main' },
];

export const DEFAULT_MODEL_ID = 'best';
export const CUSTOM_MODEL_ID = 'custom';

export function getModel(id) {
    return MODEL_REGISTRY.find((m) => m.id === id) || MODEL_REGISTRY[0];
}

/** Build a HF resolve URL for a model's onnx file at the given precision. */
export function modelFileUrl(model, precision) {
    const rev = model.revision || 'main';
    return `${HF_BASE}/${model.repo}/resolve/${rev}/model_${precision}.onnx`;
}

/** Both precision URLs for a model, in the {fp32, fp16} shape runLocalInference expects. */
export function modelUrls(model) {
    return { fp32: modelFileUrl(model, 'fp32'), fp16: modelFileUrl(model, 'fp16') };
}

/** Make an ad-hoc model entry from a user-entered "org/repo" (optionally "org/repo@rev"). */
export function customModel(repoSpec) {
    const [repo, revision] = String(repoSpec).trim().split('@');
    return { id: CUSTOM_MODEL_ID, label: repo, repo, revision: revision || 'main' };
}
