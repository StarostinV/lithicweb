/**
 * Cluster merging (Artifact3-D mergeclusts.m, via the Python port's
 * merging.merge_clusters) and the post-graph-cut small-scar cleanup
 * (merging.merge_small_final, an extension of the Python port).
 *
 * Neighbouring clusters whose shared border does not lie on curved (ridge)
 * surface are merged: such a border is an artefact of the seeded clustering
 * rather than a scar boundary.
 *
 * @module artifact3d/merging
 */

import { median, compactLabels } from './topology.js';

/**
 * Sorted unique (min,max) label pairs across face pairs with different labels,
 * plus, per pair, the face-pair indices on that border.
 */
function adjacentLabelPairs(fp, count, L) {
    const groups = new Map();
    let K = 0;
    for (let i = 0; i < L.length; i++) if (L[i] > K) K = L[i];
    const S = K + 1;
    for (let e = 0; e < count; e++) {
        const a = L[fp[2 * e]], b = L[fp[2 * e + 1]];
        if (a === b) continue;
        const key = a < b ? a * S + b : b * S + a;
        let g = groups.get(key);
        if (!g) { g = []; groups.set(key, g); }
        g.push(e);
    }
    const keys = Array.from(groups.keys()).sort((x, y) => x - y);
    return keys.map(key => ({ a1: Math.floor(key / S), a2: key % S, edges: groups.get(key) }));
}

/** merging._merge_small_scars: absorb clusters under minFaces into a neighbour. */
function mergeSmallScars(L, fp, count, minFaces = 10) {
    const A = adjacentLabelPairs(fp, count, L);
    let K = 0;
    for (let i = 0; i < L.length; i++) if (L[i] > K) K = L[i];
    const cur = new Int32Array(K + 1);            // original label -> current label
    for (let l = 0; l <= K; l++) cur[l] = l;
    const size = new Int32Array(K + 1);           // faces per current label
    for (let i = 0; i < L.length; i++) size[L[i]]++;
    for (const { a1, a2 } of A) {
        if (size[a1] < minFaces) {               // L[L == a1] = a2
            if (a1 === a2) continue;
            for (let l = 0; l <= K; l++) if (cur[l] === a1) cur[l] = a2;
            size[a2] += size[a1];
            size[a1] = 0;
        }
    }
    const out = new Int32Array(L.length);
    for (let i = 0; i < L.length; i++) out[i] = cur[L[i]];
    return compactLabels(out);
}

/**
 * @param {Float64Array} Cmax boosted max curvature (per vertex)
 * @param {Int32Array} L 1-based cluster per face
 * @param {{fp: Int32Array, ev: Int32Array, count: number}} pairs face pairs + shared edges
 * @param {{ridgeCurvatureLow?: number, ridgeHighCurvatureRatio?: number, minBorderVertices?: number}} [opts]
 * @returns {Int32Array} merged 1-based face labels (the MATLAB 'ML')
 */
export function mergeClusters(Cmax, L, pairs, {
    ridgeCurvatureLow = 0.00008, ridgeHighCurvatureRatio = 0.5, minBorderVertices = 10,
} = {}) {
    const { fp, ev, count } = pairs;
    const Ls = mergeSmallScars(L, fp, count, 10);
    const A = adjacentLabelPairs(fp, count, Ls);
    let k = 0;
    for (let i = 0; i < Ls.length; i++) if (Ls[i] > k) k = Ls[i];
    const Lm = new Int32Array(k + 1);
    for (let l = 0; l <= k; l++) Lm[l] = l;
    const n = A.length;
    const m0 = new Float64Array(n).fill(-1), m1 = new Float64Array(n).fill(-1), m2 = new Float64Array(n).fill(-1);

    const seen = new Int32Array(Cmax.length).fill(-1);
    for (let idx = 0; idx < n; idx++) {
        const { a1, a2, edges } = A[idx];
        const vb = [];
        for (const e of edges) {
            for (const x of [ev[2 * e], ev[2 * e + 1]]) {
                if (seen[x] !== idx) { seen[x] = idx; vb.push(x); }
            }
        }
        if (vb.length < minBorderVertices) continue;
        const c = vb.map(x => Cmax[x]);
        const cmed = median(c);
        let hi = 0;
        for (const x of c) if (x >= ridgeCurvatureLow) hi++;
        const cratio = hi / vb.length;
        if (cmed < ridgeCurvatureLow || cratio < ridgeHighCurvatureRatio) {
            const from = Lm[a2], to = Lm[a1];
            for (let l = 0; l <= k; l++) if (Lm[l] === from) Lm[l] = to;
            m0[idx] = cmed; m1[idx] = cratio; m2[idx] = 1;
        } else {
            m0[idx] = cmed; m1[idx] = cratio; m2[idx] = 0;
        }
    }

    // second pass: a good border inside a transitively merged group marks a
    // suspicious merge — cancel the best-scoring merge of that group
    const md = Float64Array.from(m2);
    for (let idx = 0; idx < n; idx++) {
        const g0 = Lm[A[idx].a1], g1 = Lm[A[idx].a2];
        if (g0 === g1 && m2[idx] === 0 && m0[idx] > ridgeCurvatureLow && m1[idx] > ridgeHighCurvatureRatio) {
            let best = -Infinity, smaxi = 0;
            for (let j = 0; j < n; j++) {
                const grp = (Lm[A[j].a1] === g0 && Lm[A[j].a2] === g0) ? 1 : 0;
                const sci = m0[j] * m1[j] * m2[j] * grp;
                if (sci > best) { best = sci; smaxi = j; }
            }
            if (m0[smaxi] > ridgeCurvatureLow * 0.75) md[smaxi] = 0;
        }
    }

    const Lm2 = new Int32Array(k + 1);
    for (let l = 0; l <= k; l++) Lm2[l] = l;
    for (let idx = 0; idx < n; idx++) {
        if (md[idx] !== 1) continue;
        const from = Lm2[A[idx].a2], to = Lm2[A[idx].a1];
        for (let l = 0; l <= k; l++) if (Lm2[l] === from) Lm2[l] = to;
    }
    // np.unique(Lm2[1:], return_inverse) -> ML = inv[L-1] + 1
    const vals = Array.from(new Set(Array.from(Lm2.subarray(1)))).sort((x, y) => x - y);
    const rank = new Map(vals.map((x, r) => [x, r + 1]));
    const ML = new Int32Array(Ls.length);
    for (let i = 0; i < Ls.length; i++) ML[i] = rank.get(Lm2[Ls[i]]);
    return ML;
}

/**
 * Absorb final scars smaller than minFaces into the neighbour sharing the
 * longest border (merging.merge_small_final). Labels are compacted to 1..k.
 * @param {Int32Array} L 1-based face labels
 * @param {Int32Array} fp flat face pairs
 * @param {number} count number of face pairs
 * @param {number} minFaces
 * @returns {Int32Array}
 */
export function mergeSmallFinal(L, fp, count, minFaces) {
    const lab = Int32Array.from(L);
    let K = 0;
    for (let i = 0; i < lab.length; i++) if (lab[i] > K) K = lab[i];
    const S = K + 1;
    const sizes = new Int32Array(S);
    for (let i = 0; i < lab.length; i++) sizes[lab[i]]++;
    for (;;) {
        const small = [];
        for (let l = 1; l < S; l++) if (sizes[l] > 0 && sizes[l] < minFaces) small.push(l);
        if (!small.length) break;
        small.sort((x, y) => sizes[x] - sizes[y]);            // stable: ties by label
        const isSmall = new Uint8Array(S);
        for (const l of small) isSmall[l] = 1;
        const nb = new Map();                                 // small label -> Int32Array counts
        for (let e = 0; e < count; e++) {
            const a = lab[fp[2 * e]], b = lab[fp[2 * e + 1]];
            if (a === b) continue;
            if (isSmall[a]) { let c = nb.get(a); if (!c) { c = new Int32Array(S); nb.set(a, c); } c[b]++; }
            if (isSmall[b]) { let c = nb.get(b); if (!c) { c = new Int32Array(S); nb.set(b, c); } c[a]++; }
        }
        let changed = false;
        for (const l of small) {
            const c = nb.get(l);
            if (!c) continue;
            let target = 0, best = -1;
            for (let t = 0; t < S; t++) if (c[t] > best) { best = c[t]; target = t; }
            for (let i = 0; i < lab.length; i++) if (lab[i] === l) lab[i] = target;
            sizes[target] += sizes[l];
            sizes[l] = 0;
            changed = true;
            break;
        }
        if (!changed) break;
    }
    return compactLabels(lab);
}
