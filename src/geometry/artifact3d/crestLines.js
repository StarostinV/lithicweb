/**
 * Crest-line detection by non-maximum suppression of the maximal principal
 * curvature along its own direction — the Python port's substitute for the
 * CrestCODE binary (Yoshizawa et al.) used by Artifact3-D's runcrest.m.
 *
 * A vertex is a crest vertex when Cmax >= the candidate threshold and no
 * neighbour lying roughly along the max-curvature direction has a higher
 * Cmax. Crest edges are mesh edges joining two crest vertices.
 *
 * @module artifact3d/crestLines
 */

import { uniqueEdges, norm3 } from './topology.js';

/**
 * @typedef {Object} CrestLines
 * @property {Int32Array} idx crest vertex ids, ascending (crest points = v[idx])
 * @property {Float64Array} strength ridginess per crest point (= Cmax[idx])
 * @property {Int32Array} edges flat (k,2) indices into idx
 */

/**
 * @param {Float64Array} v flat vertices
 * @param {Int32Array} f flat faces
 * @param {Float64Array} Cmax rescaled max curvature (before the ridge boost)
 * @param {Float64Array} Umax flat (nv,3) max-curvature directions
 * @param {{candidateThreshold?: number, directionCos?: number, edges?: {a: Int32Array, b: Int32Array, count: number}}} [opts]
 * @returns {CrestLines}
 */
export function detectCrestLines(v, f, Cmax, Umax,
    { candidateThreshold = 0.017, directionCos = 0.5, edges = null } = {}) {
    const nv = v.length / 3;
    const E = edges || uniqueEdges(f, nv);
    const beaten = new Uint8Array(nv);
    const check = (di, dj) => {
        const a = 3 * di, b = 3 * dj;
        let x = v[b] - v[a], y = v[b + 1] - v[a + 1], z = v[b + 2] - v[a + 2];
        let l = norm3(x, y, z);
        if (l < 1e-30) l = 1e-30;
        x /= l; y /= l; z /= l;
        const along = Math.abs(x * Umax[a] + y * Umax[a + 1] + z * Umax[a + 2]) >= directionCos;
        if (along && Cmax[dj] > Cmax[di]) beaten[di] = 1;
    };
    for (let e = 0; e < E.count; e++) check(E.a[e], E.b[e]);
    for (let e = 0; e < E.count; e++) check(E.b[e], E.a[e]);

    const remap = new Int32Array(nv).fill(-1);
    const ids = [];
    for (let i = 0; i < nv; i++) {
        if (Cmax[i] >= candidateThreshold && !beaten[i]) { remap[i] = ids.length; ids.push(i); }
    }
    const idx = Int32Array.from(ids);
    const strength = new Float64Array(idx.length);
    for (let r = 0; r < idx.length; r++) strength[r] = Cmax[idx[r]];
    const re = [];
    for (let e = 0; e < E.count; e++) {
        const p = remap[E.a[e]], q = remap[E.b[e]];
        if (p >= 0 && q >= 0) re.push(p, q);
    }
    return { idx, strength, edges: Int32Array.from(re) };
}
