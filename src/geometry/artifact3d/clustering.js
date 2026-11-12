/**
 * Seeded geodesic clustering (Artifact3-D geodclust.m, via the Python port's
 * clustering.geodesic_clustering).
 *
 * Random seeds are drawn among flat vertices not yet near a centre; each seed
 * claims the vertices geodesically closer to it than to any earlier centre,
 * with edge cost len(i,j) * (W_i + W_j) / 2 and W growing with curvature, so
 * clusters do not leak across ridges. Dijkstra runs inside a Euclidean ball of
 * radius 0.1 x the mesh length around the seed, as in the original.
 *
 * @module artifact3d/clustering
 */

import { uniqueEdges, norm3, CancelledError } from './topology.js';
import { NumpyRandom } from './numpyRandom.js';

/** Binary min-heap of (key, node) with lazy deletion. */
class MinHeap {
    constructor(cap = 1024) {
        this.k = new Float64Array(cap);
        this.v = new Int32Array(cap);
        this.n = 0;
    }
    push(key, node) {
        if (this.n === this.k.length) {
            const k2 = new Float64Array(this.n * 2); k2.set(this.k); this.k = k2;
            const v2 = new Int32Array(this.n * 2); v2.set(this.v); this.v = v2;
        }
        let i = this.n++;
        const K = this.k, V = this.v;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (K[p] <= key) break;
            K[i] = K[p]; V[i] = V[p]; i = p;
        }
        K[i] = key; V[i] = node;
    }
    pop() {   // returns node; key in this.lastKey
        const K = this.k, V = this.v;
        const topV = V[0];
        this.lastKey = K[0];
        const n = --this.n;
        if (n > 0) {
            const key = K[n], node = V[n];
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && K[c + 1] < K[c]) c++;
                if (K[c] >= key) break;
                K[i] = K[c]; V[i] = V[c]; i = c;
            }
            K[i] = key; V[i] = node;
        }
        return topV;
    }
}

/**
 * @typedef {Object} ClusteringResult
 * @property {Int32Array} faceLabels 1-based cluster per face (middle of its 3 vertex labels)
 * @property {Int32Array} vertexLabels 1-based cluster per vertex
 * @property {Int32Array} centers cluster centre vertex ids
 * @property {Array<[number, number]>} draws every random draw as [n, r]
 */

/**
 * @param {Float64Array} v flat vertices (PCA-reoriented, mm)
 * @param {Int32Array} f flat faces
 * @param {Float64Array} Cmax boosted max curvature
 * @param {Object} [opts]
 * @param {number[]} [opts.Wc=[0.1,5,20,50]] inverse speeds per curvature band
 * @param {number[]} [opts.thresholds=[0.017,0.017,0.05]]
 * @param {number} [opts.distanceToCheck=0.1] Euclidean ball radius / mesh x-extent
 * @param {number} [opts.distanceToRecenter=0.04]
 * @param {number} [opts.neighborhoodGeoDistance=1.5]
 * @param {number} [opts.maxClusters=350]
 * @param {number} [opts.maxRecenters=10]
 * @param {number|{integers: (n:number)=>number}} [opts.rng=0] seed or generator with integers(n)
 * @param {(i:number, max:number)=>void} [opts.onCluster] progress callback
 * @param {()=>boolean} [opts.isCancelled]
 * @returns {ClusteringResult}
 */
export function geodesicClustering(v, f, Cmax, {
    Wc = [0.1, 5.0, 20.0, 50.0], thresholds = [0.017, 0.017, 0.05],
    distanceToCheck = 0.1, distanceToRecenter = 0.04, neighborhoodGeoDistance = 1.5,
    maxClusters = 350, maxRecenters = 10, rng = 0, onCluster = null, isCancelled = null,
} = {}) {
    const gen = (typeof rng === 'object' && rng && typeof rng.integers === 'function')
        ? rng : new NumpyRandom(rng);
    const nv = v.length / 3;
    const W = new Float64Array(nv).fill(Wc[0]);
    for (let i = 0; i < nv; i++) {
        if (Cmax[i] > thresholds[0]) W[i] = Wc[1];
        if (Cmax[i] > thresholds[1]) W[i] = Wc[2];
        if (Cmax[i] > thresholds[2]) W[i] = Wc[3];
    }

    // CSR adjacency with edge cost elen * 0.5 * (W_i + W_j); zero-cost edges are
    // dropped, as scipy's sparse graph does with explicit zeros.
    const E = uniqueEdges(f, nv);
    const deg = new Int32Array(nv + 1);
    const cost = new Float64Array(E.count);
    for (let e = 0; e < E.count; e++) {
        const p = 3 * E.a[e], q = 3 * E.b[e];
        const len = norm3(v[p] - v[q], v[p + 1] - v[q + 1], v[p + 2] - v[q + 2]);
        cost[e] = len * 0.5 * (W[E.a[e]] + W[E.b[e]]);
        if (cost[e] !== 0) { deg[E.a[e] + 1]++; deg[E.b[e] + 1]++; }
    }
    for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
    const fill = deg.slice(0, nv);
    const nbr = new Int32Array(deg[nv]), wgt = new Float64Array(deg[nv]);
    for (let e = 0; e < E.count; e++) {
        if (cost[e] === 0) continue;
        const a = E.a[e], b = E.b[e];
        nbr[fill[a]] = b; wgt[fill[a]++] = cost[e];
        nbr[fill[b]] = a; wgt[fill[b]++] = cost[e];
    }

    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < nv; i++) { const x = v[3 * i]; if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
    const vsize = xmax - xmin;
    const checkR = distanceToCheck * vsize;
    const recenterR = distanceToRecenter * vsize;

    const L = new Int32Array(nv);
    const minD = new Float64Array(nv).fill(Infinity);
    const vstat = new Int32Array(nv);
    const centers = [];
    const draws = [];

    const inBall = new Uint8Array(nv);
    const dist = new Float64Array(nv).fill(Infinity);
    const done = new Uint8Array(nv);
    const ball = new Int32Array(nv);
    const heap = new MinHeap(4096);
    const avail = new Int32Array(nv);

    let numRecenters = 0;
    let i = 1;
    while (i <= maxClusters) {
        if (isCancelled && isCancelled()) throw new CancelledError();
        let na = 0;
        for (let x = 0; x < nv; x++) if (vstat[x] === 0 && W[x] === Wc[0]) avail[na++] = x;
        if (na === 0) break;
        const r = gen.integers(na);
        draws.push([na, r]);
        const ci = avail[r];
        const cx = v[3 * ci], cy = v[3 * ci + 1], cz = v[3 * ci + 2];

        // Euclidean ball (ascending vertex ids)
        let nb = 0;
        for (let x = 0; x < nv; x++) {
            const dd = norm3(v[3 * x] - cx, v[3 * x + 1] - cy, v[3 * x + 2] - cz);
            if (dd < checkR) { inBall[x] = 1; ball[nb++] = x; }
        }

        // Dijkstra from ci inside the ball
        heap.n = 0;
        dist[ci] = 0;
        heap.push(0, ci);
        while (heap.n > 0) {
            const u = heap.pop();
            if (done[u]) continue;
            done[u] = 1;
            const du = dist[u];
            for (let s = deg[u]; s < deg[u + 1]; s++) {
                const w = nbr[s];
                if (!inBall[w] || done[w]) continue;
                const nd = du + wgt[s];
                if (nd < dist[w]) { dist[w] = nd; heap.push(nd, w); }
            }
        }

        // claimed vertices and their centroid offset
        let sx = 0, sy = 0, sz = 0, nClaimed = 0;
        for (let t = 0; t < nb; t++) {
            const x = ball[t];
            if (dist[x] < minD[x]) {
                sx += v[3 * x]; sy += v[3 * x + 1]; sz += v[3 * x + 2]; nClaimed++;
            }
        }
        const cOff = nClaimed
            ? norm3(sx / nClaimed - cx, sy / nClaimed - cy, sz / nClaimed - cz)
            : NaN;
        const reject = cOff > recenterR && numRecenters < maxRecenters;
        if (reject) {
            numRecenters++;
        } else {
            numRecenters = 0;
            for (let t = 0; t < nb; t++) {
                const x = ball[t];
                if (dist[x] < neighborhoodGeoDistance) vstat[x] = i;
                if (dist[x] < minD[x]) { minD[x] = dist[x]; L[x] = i; }
            }
            centers.push(ci);
            if (onCluster) onCluster(i, maxClusters);
            i++;
        }
        for (let t = 0; t < nb; t++) {
            const x = ball[t];
            inBall[x] = 0; dist[x] = Infinity; done[x] = 0;
        }
    }

    // leftover vertices -> cluster of the Euclidean-closest centre (first on ties)
    const k = centers.length;
    if (k) {
        for (let x = 0; x < nv; x++) {
            if (L[x] !== 0) continue;
            let best = Infinity, bi = 0;
            for (let c = 0; c < k; c++) {
                const q = 3 * centers[c];
                const dd = norm3(v[q] - v[3 * x], v[q + 1] - v[3 * x + 1], v[q + 2] - v[3 * x + 2]);
                if (dd < best) { best = dd; bi = c; }
            }
            L[x] = L[centers[bi]];
        }
    }

    const nf = f.length / 3;
    const faceLabels = new Int32Array(nf);
    for (let t = 0; t < nf; t++) {
        const a = L[f[3 * t]], b = L[f[3 * t + 1]], c = L[f[3 * t + 2]];
        faceLabels[t] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    }
    return { faceLabels, vertexLabels: L, centers: Int32Array.from(centers), draws };
}
