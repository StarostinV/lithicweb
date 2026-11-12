/**
 * Potts alpha-expansion (Boykov, Veksler & Zabih 2001) over the face graph —
 * the graph-cut stage of Artifact3-D (graphcut.m, which used GCO-3.0) as
 * implemented by the Python port's graphcut.alpha_expansion_potts: same label
 * order, same acceptance rule (newE < E - 1e-9), same cycle limit.
 *
 * Data cost: 0 for a face's own merged-cluster label, `dataCost` otherwise.
 * Smoothness: `smoothCost * w_pq` between adjacent faces with different labels.
 *
 * Two exact speed-ups over the Python port (both on by default):
 *  - symmetric: Potts terms as symmetric arcs instead of the
 *    Kolmogorov-Zabih reparametrisation (same energy, less flow to push);
 *  - skipUnchanged: an expansion that was rejected is not retried while the
 *    labelling has not changed since (it would give the same cut).
 * Min-cut ties can still be broken differently from PyMaxflow, so labels agree
 * with the Python port statistically (~99.9 % of faces), not bit for bit.
 *
 * @module artifact3d/graphcut
 */

import { BKGraph } from './maxflow.js';
import { pairwiseSum, CancelledError } from './topology.js';

/**
 * Potts energy, rounded like the Python port (np.sum pairwise summation).
 * @returns {number}
 */
export function pottsEnergy(labels, ML, fp, ew, dataCost, smoothCost, scratch = null) {
    let cnt = 0;
    for (let i = 0; i < labels.length; i++) if (labels[i] !== ML[i]) cnt++;
    const buf = scratch || new Float64Array(ew.length);
    let m = 0;
    for (let e = 0; e < ew.length; e++) if (labels[fp[2 * e]] !== labels[fp[2 * e + 1]]) buf[m++] = ew[e];
    return dataCost * cnt + smoothCost * pairwiseSum(buf, 0, m);
}

/**
 * @param {Int32Array} ML 1-based initial face labels
 * @param {Int32Array} fp flat (k,2) adjacent face pairs
 * @param {Float64Array} ew (k) smoothness weights
 * @param {Object} [opts]
 * @param {number} [opts.dataCost=10]
 * @param {number} [opts.smoothCost=100]
 * @param {number} [opts.maxCycles=10]
 * @param {boolean} [opts.symmetric=true]
 * @param {boolean} [opts.skipUnchanged=true]
 * @param {(info: {cycle: number, alpha: number, K: number, energy: number}) => void} [opts.onLabel]
 * @param {() => boolean} [opts.isCancelled]
 * @returns {{labels: Int32Array, energy: number, stats: Object}} labels compacted to 1..k;
 *   energy of the final (uncompacted) labelling
 */
export function alphaExpansionPotts(ML, fp, ew, {
    dataCost = 10, smoothCost = 100, maxCycles = 10, symmetric = true, skipUnchanged = true,
    onLabel = null, isCancelled = null,
} = {}) {
    const N = ML.length, k = ew.length;
    const P = new Int32Array(k), Q = new Int32Array(k);
    for (let e = 0; e < k; e++) { P[e] = fp[2 * e]; Q[e] = fp[2 * e + 1]; }
    let K = 0;
    for (let i = 0; i < N; i++) if (ML[i] > K) K = ML[i];
    const labels = Int32Array.from(ML);
    const scratch = new Float64Array(k);
    let E = pottsEnergy(labels, ML, fp, ew, dataCost, smoothCost, scratch);
    const w = new Float64Array(k);
    for (let e = 0; e < k; e++) w[e] = ew[e] * smoothCost;
    const src = new Float64Array(N), snk = new Float64Array(N);
    const newLabels = new Int32Array(N);
    const stats = { cycles: 0, maxflowCalls: 0, skipped: 0, accepted: 0, augmentations: 0 };
    let version = 0;
    const triedAt = new Int32Array(K + 1).fill(-1);

    for (let cycle = 0; cycle < maxCycles; cycle++) {
        let improved = false;
        for (let alpha = 1; alpha <= K; alpha++) {
            if (isCancelled && isCancelled()) throw new CancelledError();
            if (skipUnchanged && triedAt[alpha] === version) {
                stats.skipped++;
                if (onLabel) onLabel({ cycle, alpha, K, energy: E });
                continue;
            }
            for (let i = 0; i < N; i++) {
                src[i] = ML[i] === alpha ? 0 : dataCost;        // cost of x=1 (take alpha)
                snk[i] = ML[i] === labels[i] ? 0 : dataCost;    // cost of x=0 (keep)
            }
            const g = new BKGraph(N, k);
            if (symmetric) {
                for (let e = 0; e < k; e++) {
                    const p = P[e], q = Q[e], lp = labels[p], lq = labels[q], we = w[e];
                    const pa = lp === alpha, qa = lq === alpha;
                    if (pa && qa) continue;
                    if (pa) { snk[q] += we; continue; }                 // w (1 - x_q)
                    if (qa) { snk[p] += we; continue; }                 // w (1 - x_p)
                    if (lp === lq) g.addEdge(p, q, we, we);            // w [x_p != x_q]
                    else { snk[p] += we; g.addEdge(q, p, we, 0); }     // w (1 - x_p x_q)
                }
                for (let i = 0; i < N; i++) g.addTWeights(i, src[i], snk[i]);
            } else {
                // Kolmogorov-Zabih reparametrisation, accumulated like the np.add.at calls
                const caps = new Float64Array(k), uqs = new Float64Array(k);
                for (let e = 0; e < k; e++) {
                    const p = P[e], lp = labels[p], lq = labels[Q[e]], we = w[e];
                    const A = lp !== lq ? we : 0, B = lp !== alpha ? we : 0, C = lq !== alpha ? we : 0;
                    const up = C - A;
                    if (up > 0) src[p] += up; else snk[p] += -up;
                    uqs[e] = -C;
                    caps[e] = B + C - A;
                }
                for (let e = 0; e < k; e++) {
                    const uq = uqs[e], q = Q[e];
                    if (uq > 0) src[q] += uq; else snk[q] += -uq;
                }
                for (let i = 0; i < N; i++) g.addTWeights(i, src[i], snk[i]);
                for (let e = 0; e < k; e++) if (caps[e] > 0) g.addEdge(P[e], Q[e], caps[e], 0);
            }
            g.maxflow();
            stats.maxflowCalls++;
            stats.augmentations += g.nAug;
            const take = g.sinkSide();
            for (let i = 0; i < N; i++) newLabels[i] = take[i] ? alpha : labels[i];
            const newE = pottsEnergy(newLabels, ML, fp, ew, dataCost, smoothCost, scratch);
            if (newE < E - 1e-9) {
                labels.set(newLabels);
                E = newE;
                improved = true;
                stats.accepted++;
                version++;
            } else {
                triedAt[alpha] = version;
            }
            if (onLabel) onLabel({ cycle, alpha, K, energy: E });
        }
        stats.cycles = cycle + 1;
        if (!improved) break;
    }

    // compact to 1..k (ascending label value, as np.unique)
    const used = new Uint8Array(K + 1);
    for (let i = 0; i < N; i++) used[labels[i]] = 1;
    const map = new Int32Array(K + 1);
    let c = 0;
    for (let l = 1; l <= K; l++) if (used[l]) map[l] = ++c;
    const out = new Int32Array(N);
    for (let i = 0; i < N; i++) out[i] = map[labels[i]];
    return { labels: out, energy: E, stats };
}
