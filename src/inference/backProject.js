// Multi-view back-projection + gamma smoothing — port of edge_postprocess.py:
// multi_view_edge_predictions (aggregation half) and postprocess_3d.py:
// propagate_features_through_face_neighbors (aggr='gamma').
//
// Per view: normalize logits (min-max), zero background, gather one value per visible
// face, weight by a discretized face-normal-z (camera-facing) score, accumulate. After all
// views: weighted mean -> per-face edge field, then gamma graph propagation fills faces that
// no view saw edge-on, decaying by `gamma` each hop.

const THRESHOLDS = [0.5, 0.8]; // -> weights {1,2,3}

/** Accumulator across views, producing per-face edge_predictions. */
export class EdgeAccumulator {
  constructor(numFaces) {
    this.nF = numFaces;
    this.edge = new Float64Array(numFaces);
    this.weight = new Float64Array(numFaces);
  }

  /**
   * @param {Float32Array} logits model output, length RES*RES
   * @param {Int32Array} faceOfPixel visible face per pixel (-1 bg), length RES*RES
   * @param {Float32Array} normalZ per-face z of this view's rotated normal, length nF
   */
  addView(logits, faceOfPixel, normalZ) {
    const N = logits.length;
    // min-max over the full image, then zero background (res[~mask]=0).
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) { if (logits[i] < lo) lo = logits[i]; if (logits[i] > hi) hi = logits[i]; }
    const span = (hi - lo) || 1;

    // Per-face mean of normalized res over the face's pixels (deterministic stand-in for
    // Python's first-rendered-pixel gather; validated within tolerance in the spike).
    const acc = new Float64Array(this.nF), cnt = new Int32Array(this.nF);
    for (let i = 0; i < N; i++) {
      const f = faceOfPixel[i];
      if (f >= 0) { acc[f] += (logits[i] - lo) / span; cnt[f]++; }
    }
    for (let f = 0; f < this.nF; f++) {
      if (!cnt[f]) continue;
      const z = normalZ[f];
      let w = 1;
      for (let t = 0; t < THRESHOLDS.length; t++) if (z >= THRESHOLDS[t]) w = t + 2;
      this.edge[f] += (acc[f] / cnt[f]) * w;
      this.weight[f] += w;
    }
  }

  /** Weighted mean -> Float32Array(nF). Faces seen by no view stay 0. */
  result() {
    const out = new Float32Array(this.nF);
    for (let f = 0; f < this.nF; f++) out[f] = this.weight[f] > 0 ? this.edge[f] / this.weight[f] : 0;
    return out;
  }
}

/**
 * Gamma propagation over the face graph: BFS from faces with value>0; each unlabeled face
 * gets gamma * max(labeled-neighbor values). Mirrors propagate_features_through_face_neighbors.
 * @param {Float32Array} features per-face edge field (modified copy returned)
 * @param {Int32Array} faceAdjFlat flat (nF,3), -1 = boundary
 * @param {number} gamma
 * @param {number} maxSteps
 * @returns {Float32Array}
 */
export function propagateGamma(features, faceAdjFlat, gamma = 0.95, maxSteps = 500) {
  const nF = features.length;
  const out = Float64Array.from(features);
  const labeled = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) labeled[f] = out[f] > 0 ? 1 : 0;

  let frontier = [];
  for (let f = 0; f < nF; f++) if (labeled[f]) frontier.push(f);
  let step = 1;

  while (step < maxSteps) {
    // Candidate = unlabeled neighbors of the frontier.
    const candSet = new Set();
    for (const f of frontier) {
      for (let e = 0; e < 3; e++) {
        const nb = faceAdjFlat[3*f + e];
        if (nb >= 0 && !labeled[nb]) candSet.add(nb);
      }
    }
    if (candSet.size === 0) {
      // Frontier stalled; restart from the boundary of any remaining unlabeled region.
      const bound = [];
      let anyUnlabeled = false;
      for (let f = 0; f < nF; f++) {
        if (labeled[f]) continue;
        anyUnlabeled = true;
        for (let e = 0; e < 3; e++) {
          const nb = faceAdjFlat[3*f + e];
          if (nb >= 0 && labeled[nb]) { bound.push(nb); break; }
        }
      }
      if (!anyUnlabeled || bound.length === 0) break;
      frontier = bound;
      continue;
    }
    // Each candidate takes gamma * max over its currently-labeled neighbors.
    const added = [];
    const newVals = [];
    for (const c of candSet) {
      let mx = -Infinity, has = false;
      for (let e = 0; e < 3; e++) {
        const nb = faceAdjFlat[3*c + e];
        if (nb >= 0 && labeled[nb]) { has = true; if (out[nb] > mx) mx = out[nb]; }
      }
      if (has) { added.push(c); newVals.push(mx * gamma); }
    }
    if (added.length === 0) break;
    for (let i = 0; i < added.length; i++) { out[added[i]] = newVals[i]; labeled[added[i]] = 1; }
    frontier = added;
    step++;
  }
  return Float32Array.from(out);
}
