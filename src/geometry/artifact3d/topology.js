/**
 * Mesh connectivity helpers shared by the Artifact3-D stages, and numpy-exact
 * arithmetic helpers (pairwise summation, median) so that every stage rounds
 * like the Python port it is validated against.
 *
 * Faces are flat Int32Array (nf*3), vertices flat Float64Array (nv*3).
 *
 * @module artifact3d/topology
 */

/**
 * numpy's pairwise summation (used by np.sum / np.mean on contiguous float64).
 * @param {Float64Array|number[]} a
 * @param {number} [lo=0]
 * @param {number} [n=a.length-lo]
 * @returns {number}
 */
export function pairwiseSum(a, lo = 0, n = a.length - lo) {
    if (n < 8) {
        let s = 0;
        for (let i = 0; i < n; i++) s += a[lo + i];
        return s;
    }
    if (n <= 128) {
        const r0 = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
        let i;
        for (i = 8; i < n - (n % 8); i += 8) {
            for (let k = 0; k < 8; k++) r0[k] += a[lo + i + k];
        }
        let res = ((r0[0] + r0[1]) + (r0[2] + r0[3])) + ((r0[4] + r0[5]) + (r0[6] + r0[7]));
        for (; i < n; i++) res += a[lo + i];
        return res;
    }
    let n2 = n >> 1;
    n2 -= n2 % 8;
    return pairwiseSum(a, lo, n2) + pairwiseSum(a, lo + n2, n - n2);
}

/**
 * np.median of a list of numbers (copies; mean of the two middle values when even).
 * @param {ArrayLike<number>} values
 * @returns {number}
 */
export function median(values) {
    const s = Float64Array.from(values).sort();
    const n = s.length;
    if (n === 0) return NaN;
    const h = n >> 1;
    return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Euclidean norm of a 3-vector as numpy computes it (sqrt of sequential sum). */
export function norm3(x, y, z) {
    return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Sorted unique undirected edges (i < j), lexicographic order — np.unique(np.sort(edges), axis=0).
 * @param {Int32Array} f flat faces
 * @param {number} nv
 * @returns {{a: Int32Array, b: Int32Array, count: number}}
 */
export function uniqueEdges(f, nv) {
    const m = f.length;
    const keys = new Float64Array(m);
    for (let t = 0; t < m; t += 3) {
        for (let k = 0; k < 3; k++) {
            const i = f[t + k], j = f[t + (k + 1) % 3];
            keys[t + k] = i < j ? i * nv + j : j * nv + i;
        }
    }
    keys.sort();
    let count = 0;
    for (let x = 0; x < m; x++) if (x === 0 || keys[x] !== keys[x - 1]) count++;
    const a = new Int32Array(count), b = new Int32Array(count);
    let c = 0;
    for (let x = 0; x < m; x++) {
        if (x > 0 && keys[x] === keys[x - 1]) continue;
        const i = Math.floor(keys[x] / nv);
        a[c] = i; b[c] = keys[x] - i * nv; c++;
    }
    return { a, b, count };
}

/**
 * Pairs of faces sharing an edge plus the shared edge's sorted vertices, in
 * exactly the order of the Python port's mesh_utils.face_adjacency_pairs
 * (stable lexsort of slot-major edge list; consecutive equal edges pair up).
 * @param {Int32Array} f flat faces
 * @param {number} nv
 * @returns {{fp: Int32Array, ev: Int32Array, count: number}} fp, ev flat (k,2)
 */
export function faceAdjacencyPairs(f, nv) {
    const m = f.length / 3;
    const n = 3 * m;
    const key = new Float64Array(n);
    const slots = [[0, 1], [1, 2], [2, 0]];
    for (let k = 0; k < 3; k++) {
        const [p, q] = slots[k];
        for (let t = 0; t < m; t++) {
            const i = f[3 * t + p], j = f[3 * t + q];
            key[k * m + t] = i < j ? i * nv + j : j * nv + i;
        }
    }
    const order = new Uint32Array(n);
    for (let x = 0; x < n; x++) order[x] = x;
    order.sort((x, y) => (key[x] - key[y]) || (x - y));
    let count = 0;
    for (let x = 1; x < n; x++) if (key[order[x]] === key[order[x - 1]]) count++;
    const fp = new Int32Array(2 * count), ev = new Int32Array(2 * count);
    let c = 0;
    for (let x = 0; x + 1 < n; x++) {
        const k0 = key[order[x]];
        if (k0 !== key[order[x + 1]]) continue;
        fp[2 * c] = order[x] % m;
        fp[2 * c + 1] = order[x + 1] % m;
        const i = Math.floor(k0 / nv);
        ev[2 * c] = i;
        ev[2 * c + 1] = k0 - i * nv;
        c++;
    }
    return { fp, ev, count };
}

/**
 * Vertex adjacency in CSR form with sorted unique neighbours (no self loops).
 * @param {Int32Array} f flat faces
 * @param {number} nv
 * @returns {{start: Int32Array, nbr: Int32Array}}
 */
export function vertexAdjacencyCSR(f, nv) {
    const m = f.length;
    const keys = new Float64Array(2 * m);
    let n = 0;
    for (let t = 0; t < m; t += 3) {
        for (let k = 0; k < 3; k++) {
            const i = f[t + k], j = f[t + (k + 1) % 3];
            keys[n++] = i * nv + j;
            keys[n++] = j * nv + i;
        }
    }
    keys.sort();
    const start = new Int32Array(nv + 1);
    const tmp = [];
    let last = -1;
    for (let x = 0; x < n; x++) {
        const kx = keys[x];
        if (kx === last) continue;
        last = kx;
        const i = Math.floor(kx / nv);
        const j = kx - i * nv;
        if (i === j) continue;
        tmp.push(j);
        start[i + 1]++;
    }
    for (let i = 0; i < nv; i++) start[i + 1] += start[i];
    return { start, nbr: Int32Array.from(tmp) };
}

/**
 * Compact labels to 1..k in ascending order of label value (np.unique(..., return_inverse) + 1).
 * @param {Int32Array} labels non-negative labels
 * @returns {Int32Array}
 */
export function compactLabels(labels) {
    let K = 0;
    for (let i = 0; i < labels.length; i++) if (labels[i] > K) K = labels[i];
    const used = new Uint8Array(K + 1);
    for (let i = 0; i < labels.length; i++) used[labels[i]] = 1;
    const map = new Int32Array(K + 1);
    let c = 0;
    for (let l = 0; l <= K; l++) if (used[l]) map[l] = ++c;
    const out = new Int32Array(labels.length);
    for (let i = 0; i < labels.length; i++) out[i] = map[labels[i]];
    return out;
}

/**
 * Report progress / honour cancellation between heavy loops.
 * @typedef {Object} StageHooks
 * @property {(fraction:number, label?:string)=>void} [onProgress]
 * @property {()=>boolean} [isCancelled]
 */

/** Error thrown when a run is cancelled through StageHooks.isCancelled. */
export class CancelledError extends Error {
    constructor() {
        super('Artifact3-D segmentation cancelled');
        this.name = 'CancelledError';
    }
}
