/**
 * Smoothness graph over mesh faces (Artifact3-D buildsmoothnessgraph.m, via
 * the Python port's smoothness.build_smoothness_graph).
 *
 * Adjacent faces get a weight from the max curvature at the two vertices of
 * their shared edge (20 on flat surface, 5..1 across the ridge band, 1 on
 * sharp ridges); edges on a strong crest line get machine epsilon, so the
 * graph cut can separate scars there for free.
 *
 * @module artifact3d/smoothness
 */

import { faceAdjacencyPairs, median } from './topology.js';

export const EPS = 2.220446049250313e-16;

/**
 * @param {Float64Array} v flat vertices
 * @param {Int32Array} f flat faces
 * @param {Float64Array} Cmax boosted max curvature
 * @param {{idx: Int32Array, strength: Float64Array, edges: Int32Array}} crest crest lines
 * @param {Object} [opts]
 * @param {number} [opts.curvatureThreshold=0.017]
 * @param {number} [opts.curvatureHighThreshold=0.05]
 * @param {number} [opts.highFactor=1]
 * @param {number} [opts.ridgeWeight=EPS]
 * @param {number} [opts.bandLowWeight=1]
 * @param {number} [opts.bandHighWeight=5]
 * @param {number} [opts.flatWeight=20]
 * @param {{fp: Int32Array, ev: Int32Array, count: number}} [opts.pairs] precomputed face pairs
 * @returns {{fp: Int32Array, ev: Int32Array, ew: Float64Array, count: number}}
 */
export function buildSmoothnessGraph(v, f, Cmax, crest, {
    curvatureThreshold = 0.017, curvatureHighThreshold = 0.05, highFactor = 1.0,
    ridgeWeight = EPS, bandLowWeight = 1.0, bandHighWeight = 5.0, flatWeight = 20.0,
    pairs = null,
} = {}) {
    const nv = v.length / 3;
    const a = (bandHighWeight - bandLowWeight) / (1.0 / curvatureThreshold - 1.0 / curvatureHighThreshold);
    const b = 1.0 / curvatureHighThreshold;

    const cm = new Float64Array(nv);
    for (let i = 0; i < nv; i++) {
        const c = Cmax[i];
        if (c < curvatureThreshold) cm[i] = flatWeight;
        else if (c <= curvatureHighThreshold) cm[i] = (1.0 / c - b) * a + bandLowWeight;
        else if (c > curvatureHighThreshold) cm[i] = bandLowWeight;
        else cm[i] = 0;   // NaN curvature: np.empty_like leaves it unset; never hit in practice
    }

    // strong crest edges, mapped onto mesh edges (crest points are mesh vertices)
    const ridgeKeys = new Set();
    const ne = crest.edges.length / 2;
    if (ne > 0) {
        const high = median(crest.strength) * highFactor;
        for (let e = 0; e < ne; e++) {
            const p = crest.edges[2 * e], q = crest.edges[2 * e + 1];
            if (!(crest.strength[p] >= high)) continue;      // edge strength = strength of its first point
            const i = crest.idx[p], j = crest.idx[q];
            ridgeKeys.add(i < j ? i * nv + j : j * nv + i);
        }
    }

    const P = pairs || faceAdjacencyPairs(f, nv);
    const { fp, ev, count } = P;
    const ew = new Float64Array(count);
    for (let e = 0; e < count; e++) {
        const i = ev[2 * e], j = ev[2 * e + 1];
        ew[e] = Math.max(cm[i], cm[j]);
        if (ridgeKeys.size && ridgeKeys.has(i * nv + j)) ew[e] = ridgeWeight;
    }
    return { fp, ev, ew, count };
}
