// Client-side inference orchestrator: mesh -> per-face edge_predictions + face_adjacency,
// the same {edge_predictions, face_adjacency, num_faces} shape the server returns with
// return_model_output=true, so the existing runClientPostprocessing() (union-find ->
// vertex labels) consumes it unchanged.
//
// Pipeline (mirrors Inference.forward -> multi_view_edge_predictions):
//   PCA-align (preprocess_data) -> face adjacency + max_angles -> re-PCA (multi_view) ->
//   for each of N views: render 6-ch -> ONNX -> accumulate weighted back-projection ->
//   gamma graph smoothing.
import { computePcaAxes } from './pcaAlign.js';
import { calcFaceAdjacency } from './faceAdjacency.js';
import { computeFaceNormals, computeMaxAngles } from './meshFeatures.js';
import { canonicalRotations } from './rotations.js';
import { ViewRenderer } from './renderViews.js';
import { OnnxModel } from './onnxModel.js';
import { EdgeAccumulator, propagateGamma } from './backProject.js';
import { getModel, modelUrls as hfModelUrls, DEFAULT_MODEL_ID } from './modelRegistry.js';

const DEFAULTS = {
  nAngles: 6,
  resolution: 512,
  gamma: 0.95,
  maxSteps: 500,
  precision: 'fp32',                  // 'fp32' (exact) | 'fp16' (smaller; see plan re: tuning)
  modelUrls: hfModelUrls(getModel(DEFAULT_MODEL_ID)),  // Hugging Face by default
};

/**
 * @param {Float32Array|number[]} vertices flat (V,3)
 * @param {Int32Array|number[]} faces flat (nF,3)
 * @param {object} [opts] overrides of DEFAULTS, plus optional callbacks:
 *        onDownload(received,total) during model download (bytes),
 *        onProgress(fraction,label) for inference progress (fraction in [0,1]).
 * @returns {Promise<{edge_predictions: Float32Array, face_adjacency: Int32Array,
 *          num_faces: number, provider: string}>}
 */
export async function runLocalInference(vertices, faces, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const verts = vertices instanceof Float32Array ? vertices : Float32Array.from(vertices);
  const F = faces instanceof Int32Array ? faces : Int32Array.from(faces);
  const nF = F.length / 3;

  // preprocess_data: PCA align, then topology/feature derivation on the aligned mesh.
  let v = computePcaAxes(verts);
  const faceAdj = calcFaceAdjacency(F);
  const maxAngles = computeMaxAngles(computeFaceNormals(v, F), faceAdj);

  // multi_view_edge_predictions re-applies PCA before rendering.
  v = computePcaAxes(v);

  // Single monotonic progress scale across the whole operation so the bar never resets:
  //   model load -> [0, MODEL_W],  the n views -> [MODEL_W, MODEL_W+VIEW_W],  smoothing -> rest.
  const MODEL_W = 0.5, VIEW_W = 0.45;
  const report = (f, label) => cfg.onProgress?.(Math.max(0, Math.min(1, f)), label);

  const rotations = canonicalRotations(cfg.nAngles);
  const n = rotations.length;
  const model = new OnnxModel();
  report(0, 'Loading model…');
  const provider = await model.load(cfg.modelUrls[cfg.precision], (recv, total) => {
    if (total) report((recv / total) * MODEL_W, `Downloading model ${(recv / 1e6) | 0}/${(total / 1e6) | 0} MB`);
    else report(0.05, `Downloading model ${(recv / 1e6) | 0} MB…`);
  });
  report(MODEL_W, 'Model ready');  // reaches the half mark whether downloaded or served from cache

  const renderer = new ViewRenderer(cfg.resolution);
  const acc = new EdgeAccumulator(nF);
  try {
    for (let i = 0; i < n; i++) {
      report(MODEL_W + (i / n) * VIEW_W, `Inferring view ${i + 1}/${n}`);
      await yieldToBrowser();  // let the progress bar/label paint before the heavy sync render
      const { img, faceOfPixel, normalZ } = renderer.renderView(v, F, rotations[i], maxAngles);
      const logits = await model.run(img, cfg.resolution);
      acc.addView(logits, faceOfPixel, normalZ);
    }
  } finally {
    renderer.dispose();
    model.dispose();
  }

  report(MODEL_W + VIEW_W, 'Smoothing edges');
  let edge = acc.result();
  edge = propagateGamma(edge, faceAdj, cfg.gamma, cfg.maxSteps);
  report(1, 'Finalizing');

  return { edge_predictions: edge, face_adjacency: faceAdj, num_faces: nF, provider };
}

// Yield to the browser so pending DOM/progress updates paint before the next blocking step.
function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}
