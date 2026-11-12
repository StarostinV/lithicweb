/**
 * Principal curvature by the normal-cycle tensor (Cohen-Steiner & Morvan 2003),
 * following the Python port's curvature.compute_curvature (itself a port of
 * toolbox_graph/compute_curvature.m used by Artifact3-D's calccurvature.m),
 * and the ridge-based curvature boost of updatecurvature.m.
 *
 * Arithmetic follows numpy's evaluation order (slot-major edge order,
 * np.add.at accumulation order, CSR mat-vec order, pairwise means) so the
 * result agrees with the Python port to ~1e-12.
 *
 * @module artifact3d/curvature
 */

import { pairwiseSum, uniqueEdges, vertexAdjacencyCSR, norm3, median } from './topology.js';
import { KNNGrid } from './knn.js';

/**
 * Symmetric 3x3 eigen-decomposition by cyclic Jacobi rotations.
 * Writes eigenvalues to w[0..2] and eigenvectors (columns) to V (row-major 3x3).
 */
function eigSym3(a00, a01, a02, a11, a12, a22, w, V) {
    const A = [a00, a01, a02, a01, a11, a12, a02, a12, a22];
    V.fill(0); V[0] = V[4] = V[8] = 1;
    const PQ = [[0, 1], [0, 2], [1, 2]];
    for (let sweep = 0; sweep < 50; sweep++) {
        const off = A[1] * A[1] + A[2] * A[2] + A[5] * A[5];
        const diag = A[0] * A[0] + A[4] * A[4] + A[8] * A[8];
        if (off === 0 || off < 1e-36 * diag) break;
        for (const [p, q] of PQ) {
            const apq = A[3 * p + q];
            if (apq === 0) continue;
            const theta = (A[3 * q + q] - A[3 * p + p]) / (2 * apq);
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < 3; k++) {
                const akp = A[3 * k + p], akq = A[3 * k + q];
                A[3 * k + p] = c * akp - s * akq; A[3 * k + q] = s * akp + c * akq;
            }
            for (let k = 0; k < 3; k++) {
                const apk = A[3 * p + k], aqk = A[3 * q + k];
                A[3 * p + k] = c * apk - s * aqk; A[3 * q + k] = s * apk + c * aqk;
            }
            for (let k = 0; k < 3; k++) {
                const vkp = V[3 * k + p], vkq = V[3 * k + q];
                V[3 * k + p] = c * vkp - s * vkq; V[3 * k + q] = s * vkp + c * vkq;
            }
        }
    }
    w[0] = A[0]; w[1] = A[4]; w[2] = A[8];
}

/**
 * Unit face normals, as mesh_utils.face_normals.
 * @param {Float64Array} v
 * @param {Int32Array} f
 * @returns {Float64Array} flat (nf,3)
 */
export function faceNormals(v, f) {
    const nf = f.length / 3;
    const fn = new Float64Array(3 * nf);
    for (let t = 0; t < nf; t++) {
        const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        let l = norm3(nx, ny, nz);
        if (l < 1e-30) l = 1;
        fn[3 * t] = nx / l; fn[3 * t + 1] = ny / l; fn[3 * t + 2] = nz / l;
    }
    return fn;
}

/**
 * Interior directed edges (i<j) with the face containing i->j and the face
 * containing j->i, in the slot-major order of mesh_utils.directed_edge_face_pairs.
 */
function directedEdgeFacePairs(f, nv) {
    const m = f.length / 3;
    const n = 3 * m;
    const I = new Int32Array(n), J = new Int32Array(n);
    const slots = [[0, 1], [1, 2], [2, 0]];
    for (let k = 0; k < 3; k++) {
        for (let t = 0; t < m; t++) {
            I[k * m + t] = f[3 * t + slots[k][0]];
            J[k * m + t] = f[3 * t + slots[k][1]];
        }
    }
    const key = new Float64Array(n);
    for (let x = 0; x < n; x++) key[x] = I[x] * nv + J[x];
    const order = new Uint32Array(n);
    for (let x = 0; x < n; x++) order[x] = x;
    order.sort((x, y) => (key[x] - key[y]) || (x - y));
    const skey = new Float64Array(n);
    for (let x = 0; x < n; x++) skey[x] = key[order[x]];
    const EI = [], EJ = [], F1 = [], F2 = [];
    for (let x = 0; x < n; x++) {
        const i = I[x], j = J[x];
        if (i >= j) continue;
        const rk = j * nv + i;
        let lo = 0, hi = n;               // leftmost insertion point (searchsorted)
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (skey[mid] < rk) lo = mid + 1; else hi = mid;
        }
        const pos = Math.min(lo, n - 1);
        if (skey[pos] !== rk) continue;
        EI.push(i); EJ.push(j); F1.push(x % m); F2.push(order[pos] % m);
    }
    return {
        ei: Int32Array.from(EI), ej: Int32Array.from(EJ),
        f1: Int32Array.from(F1), f2: Int32Array.from(F2),
    };
}

/**
 * Mean length of the unique undirected edges (pipeline.py's resolution h).
 * @param {Float64Array} v
 * @param {Int32Array} f
 * @returns {number}
 */
export function meanEdgeLength(v, f) {
    const nv = v.length / 3;
    const { a, b, count } = uniqueEdges(f, nv);
    const len = new Float64Array(count);
    for (let e = 0; e < count; e++) {
        const p = 3 * a[e], q = 3 * b[e];
        len[e] = norm3(v[p] - v[q], v[p + 1] - v[q + 1], v[p + 2] - v[q + 2]);
    }
    return pairwiseSum(len) / count;
}

/**
 * Normal-cycle principal curvature per vertex.
 * @param {Float64Array} v flat (nv,3), in mm
 * @param {Int32Array} f flat (nf,3), consistently (outward) wound
 * @param {number} [smoothing=10] combinatorial smoothing iterations of the tensor
 * @returns {{Cmin: Float64Array, Cmax: Float64Array, Umax: Float64Array}}
 *   Cmax is relative to the mean interior edge length (multiply by
 *   referenceEdge / meanEdgeLength to rescale, as the pipeline does).
 */
export function computeCurvature(v, f, smoothing = 10) {
    const nv = v.length / 3;
    const { ei, ej, f1, f2 } = directedEdgeFacePairs(f, nv);
    const fn = faceNormals(v, f);
    const ne = ei.length;

    const ex = new Float64Array(3 * ne), d = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
        const a = 3 * ei[e], b = 3 * ej[e];
        const x = v[b] - v[a], y = v[b + 1] - v[a + 1], z = v[b + 2] - v[a + 2];
        let l = norm3(x, y, z);
        if (l < 1e-30) l = 1e-30;
        ex[3 * e] = x / l; ex[3 * e + 1] = y / l; ex[3 * e + 2] = z / l;
        d[e] = l;
    }
    const dmean = pairwiseSum(d) / ne;

    // per-edge scale d*beta (signed dihedral angle)
    const s = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
        const p = 3 * f1[e], q = 3 * f2[e];
        let dp = fn[p] * fn[q] + fn[p + 1] * fn[q + 1] + fn[p + 2] * fn[q + 2];
        dp = Math.min(1, Math.max(-1, dp));
        let beta = Math.acos(dp);
        const cx = fn[p + 1] * fn[q + 2] - fn[p + 2] * fn[q + 1];
        const cy = fn[p + 2] * fn[q] - fn[p] * fn[q + 2];
        const cz = fn[p] * fn[q + 1] - fn[p + 1] * fn[q];
        beta = beta * Math.sign(cx * ex[3 * e] + cy * ex[3 * e + 1] + cz * ex[3 * e + 2]);
        s[e] = (d[e] / dmean) * beta;
    }

    // np.add.at(Tv, ei, T) then np.add.at(Tv, ej, T)
    const Tv = new Float64Array(9 * nv), cnt = new Float64Array(nv);
    const T = new Float64Array(9);
    for (const ends of [ei, ej]) {
        for (let e = 0; e < ne; e++) {
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
                T[3 * r + c] = ex[3 * e + r] * ex[3 * e + c] * s[e];
            }
            const o = 9 * ends[e];
            for (let k = 0; k < 9; k++) Tv[o + k] += T[k];
        }
    }
    for (let e = 0; e < ne; e++) cnt[ei[e]] += 1;
    for (let e = 0; e < ne; e++) cnt[ej[e]] += 1;
    for (let i = 0; i < nv; i++) {
        const c = cnt[i] < 1e-12 ? 1 : cnt[i];
        for (let k = 0; k < 9; k++) Tv[9 * i + k] /= c;
    }

    // smoothing: row-normalised (A + I), CSR mat-vec in ascending column order
    const { start, nbr } = vertexAdjacencyCSR(f, nv);
    let cur = Tv, nxt = new Float64Array(9 * nv);
    const acc = new Float64Array(9);
    for (let it = 0; it < smoothing; it++) {
        for (let i = 0; i < nv; i++) {
            const s0 = start[i], s1 = start[i + 1];
            const inv = 1.0 / (s1 - s0 + 1);
            acc.fill(0);
            let selfDone = false;
            for (let x = s0; x < s1; x++) {
                const j = nbr[x];
                if (!selfDone && j > i) {
                    const o = 9 * i;
                    for (let k = 0; k < 9; k++) acc[k] += inv * cur[o + k];
                    selfDone = true;
                }
                const o = 9 * j;
                for (let k = 0; k < 9; k++) acc[k] += inv * cur[o + k];
            }
            if (!selfDone) {
                const o = 9 * i;
                for (let k = 0; k < 9; k++) acc[k] += inv * cur[o + k];
            }
            for (let k = 0; k < 9; k++) nxt[9 * i + k] = acc[k];
        }
        const tmp = cur; cur = nxt; nxt = tmp;
    }

    const Cmin = new Float64Array(nv), Cmax = new Float64Array(nv), Umax = new Float64Array(3 * nv);
    const w = new Float64Array(3), V = new Float64Array(9);
    const idx = [0, 1, 2];
    for (let i = 0; i < nv; i++) {
        const o = 9 * i;
        eigSym3(cur[o], cur[o + 1], cur[o + 2], cur[o + 4], cur[o + 5], cur[o + 8], w, V);
        // eigh order (ascending eigenvalue), then a stable sort by |eigenvalue|
        idx[0] = 0; idx[1] = 1; idx[2] = 2;
        idx.sort((p, q) => w[p] - w[q]);
        idx.sort((p, q) => Math.abs(w[p]) - Math.abs(w[q]));
        const cmin = w[idx[1]], cmax = w[idx[2]];
        const umax = idx[1];  // Umax = eigenvector of the middle |eigenvalue| (as in the port)
        Cmin[i] = cmin; Cmax[i] = cmax;
        Umax[3 * i] = V[umax]; Umax[3 * i + 1] = V[3 + umax]; Umax[3 * i + 2] = V[6 + umax];
    }
    return { Cmin, Cmax, Umax };
}

/**
 * Boost Cmax around strong crest points (updatecurvature.m).
 * @param {Float64Array} v flat vertices
 * @param {Float64Array} Cmax per-vertex curvature (not modified)
 * @param {Int32Array} crestIdx crest vertex ids (crest points = their positions)
 * @param {Float64Array} strength per crest point ridginess (= Cmax at the crest)
 * @param {{threshold1?: number, threshold2?: number, highFactor?: number, knn?: KNNGrid}} [opts]
 * @returns {Float64Array} boosted copy of Cmax
 */
export function updateCurvature(v, Cmax, crestIdx, strength,
    { threshold1 = 0.1, threshold2 = 0.2, highFactor = 1.0, knn = null } = {}) {
    const out = Float64Array.from(Cmax);
    if (crestIdx.length === 0) return out;
    const high = median(strength) * highFactor;
    const nv = v.length / 3;
    const grid = knn || new KNNGrid(v);
    const rv2 = new Uint8Array(nv), rv6 = new Uint8Array(nv);
    let any = false;
    for (let r = 0; r < crestIdx.length; r++) {
        if (!(strength[r] >= high)) continue;
        any = true;
        const c = 3 * crestIdx[r];
        const nn = grid.query(v[c], v[c + 1], v[c + 2], 6);
        for (let k = 0; k < nn.length; k++) {
            rv6[nn[k]] = 1;
            if (k < 2) rv2[nn[k]] = 1;
        }
    }
    if (!any) return out;
    for (let i = 0; i < nv; i++) if (out[i] < threshold1 && rv6[i]) out[i] = threshold1;
    for (let i = 0; i < nv; i++) if (out[i] < threshold2 && rv2[i]) out[i] = threshold2;
    return out;
}
