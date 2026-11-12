/**
 * Boykov-Kolmogorov max-flow / min-cut on typed arrays (Float64 capacities).
 *
 * Written from the published algorithm (Y. Boykov and V. Kolmogorov, "An
 * experimental comparison of min-cut/max-flow algorithms for energy
 * minimization in vision", IEEE PAMI 26(9), 2004). It is NOT derived from
 * Kolmogorov's maxflow sources (GPL / research-only) nor from the GCO-3.0
 * library bundled with Artifact3-D (research-only). Single-shot graphs:
 * build once, call maxflow() once, read the cut.
 *
 * Cut convention: sinkSide()[i] is 1 iff i can still reach the sink in the
 * residual graph after max-flow (the minimal sink set).
 *
 * @module artifact3d/maxflow
 */

const NONE = -1, TERMINAL = -2, ORPHAN = -3;

/** Directed graph with source/sink terminals. */
export class BKGraph {
    constructor(nNodes, nEdgesHint) {
        this.n = nNodes;
        this.trCap = new Float64Array(nNodes);   // >0: residual s->i, <0: residual i->t
        this.first = new Int32Array(nNodes).fill(-1);
        const m = 2 * Math.max(1, nEdgesHint);
        this.head = new Int32Array(m);
        this.next = new Int32Array(m);
        this.rcap = new Float64Array(m);
        this.nArcs = 0;
        this.flow = 0;
    }

    /**
     * Add terminal capacities: capSource is paid when i ends on the sink side,
     * capSink when it ends on the source side. May be called repeatedly.
     */
    addTWeights(i, capSource, capSink) {
        const delta = this.trCap[i];
        if (delta > 0) capSource += delta; else capSink -= delta;
        this.flow += capSource < capSink ? capSource : capSink;
        this.trCap[i] = capSource - capSink;
    }

    /** Add arc i->j with capacity cap and the reverse arc j->i with revCap. */
    addEdge(i, j, cap, revCap) {
        let a = this.nArcs;
        if (a + 2 > this.head.length) this._grow();
        // arc a: i->j, arc a^1: j->i
        this.head[a] = j; this.rcap[a] = cap; this.next[a] = this.first[i]; this.first[i] = a;
        this.head[a + 1] = i; this.rcap[a + 1] = revCap; this.next[a + 1] = this.first[j]; this.first[j] = a + 1;
        this.nArcs += 2;
    }

    _grow() {
        const m = this.head.length * 2;
        const h = new Int32Array(m); h.set(this.head); this.head = h;
        const nx = new Int32Array(m); nx.set(this.next); this.next = nx;
        const r = new Float64Array(m); r.set(this.rcap); this.rcap = r;
    }

    /**
     * Run max-flow; returns the flow value. Afterwards sinkSide() gives the cut.
     * @returns {number}
     */
    maxflow() {
        const n = this.n, head = this.head, next = this.next, rcap = this.rcap,
            first = this.first, trCap = this.trCap;
        let nAug = 0;
        const parent = new Int32Array(n).fill(NONE);
        const isSink = new Uint8Array(n);
        const ts = new Int32Array(n);
        const dist = new Int32Array(n);
        // active FIFO (circular, each node at most once)
        const q = new Int32Array(n + 1);
        const inQ = new Uint8Array(n);
        let qh = 0, qt = 0, qn = 0;
        const push = (i) => { if (!inQ[i]) { inQ[i] = 1; q[qt] = i; qt = qt === n ? 0 : qt + 1; qn++; } };
        const pop = () => { const i = q[qh]; qh = qh === n ? 0 : qh + 1; qn--; inQ[i] = 0; return i; };
        // orphan FIFO
        let orph = new Int32Array(1024), oh = 0, ot = 0;
        const pushOrphan = (i) => {
            if (ot === orph.length) {
                if (oh > 0) { orph.copyWithin(0, oh, ot); ot -= oh; oh = 0; }
                if (ot === orph.length) { const o = new Int32Array(orph.length * 2); o.set(orph); orph = o; }
            }
            orph[ot++] = i;
        };

        for (let i = 0; i < n; i++) {
            if (trCap[i] > 0) { parent[i] = TERMINAL; isSink[i] = 0; ts[i] = 0; dist[i] = 1; push(i); }
            else if (trCap[i] < 0) { parent[i] = TERMINAL; isSink[i] = 1; ts[i] = 0; dist[i] = 1; push(i); }
        }

        let TIME = 0;
        let flow = this.flow;
        let cur = -1;   // node kept active after it found a path

        while (true) {
            let i = -1;
            if (cur >= 0 && parent[cur] !== NONE) i = cur;
            else {
                cur = -1;
                while (qn > 0) { const c = pop(); if (parent[c] !== NONE) { i = c; break; } }
                if (i < 0) break;
            }
            // ---- growth ----
            let mid = -1;   // arc from source-tree node to sink-tree node
            if (!isSink[i]) {
                for (let a = first[i]; a >= 0; a = next[a]) {
                    if (rcap[a] > 0) {
                        const j = head[a];
                        if (parent[j] === NONE) {
                            isSink[j] = 0; parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; push(j);
                        } else if (isSink[j]) { mid = a; break; }
                        else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
                            parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1;
                        }
                    }
                }
            } else {
                for (let a = first[i]; a >= 0; a = next[a]) {
                    if (rcap[a ^ 1] > 0) {
                        const j = head[a];
                        if (parent[j] === NONE) {
                            isSink[j] = 1; parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; push(j);
                        } else if (!isSink[j]) { mid = a ^ 1; break; }
                        else if (ts[j] <= ts[i] && dist[j] > dist[i]) {
                            parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1;
                        }
                    }
                }
            }
            TIME++;
            if (mid < 0) { cur = -1; continue; }
            cur = i;   // keep processing this node next round

            // ---- augmentation ----
            const sNode0 = head[mid ^ 1], tNode0 = head[mid];
            let b = rcap[mid];
            for (let x = sNode0; ;) {
                const p = parent[x];
                if (p === TERMINAL) { if (trCap[x] < b) b = trCap[x]; break; }
                if (rcap[p ^ 1] < b) b = rcap[p ^ 1];
                x = head[p];
            }
            for (let x = tNode0; ;) {
                const p = parent[x];
                if (p === TERMINAL) { if (-trCap[x] < b) b = -trCap[x]; break; }
                if (rcap[p] < b) b = rcap[p];
                x = head[p];
            }
            rcap[mid ^ 1] += b; rcap[mid] -= b;
            for (let x = sNode0; ;) {
                const p = parent[x];
                if (p === TERMINAL) {
                    trCap[x] -= b;
                    if (trCap[x] === 0) { parent[x] = ORPHAN; pushOrphan(x); }
                    break;
                }
                rcap[p] += b; rcap[p ^ 1] -= b;
                const up = head[p];
                if (rcap[p ^ 1] === 0) { parent[x] = ORPHAN; pushOrphan(x); }
                x = up;
            }
            for (let x = tNode0; ;) {
                const p = parent[x];
                if (p === TERMINAL) {
                    trCap[x] += b;
                    if (trCap[x] === 0) { parent[x] = ORPHAN; pushOrphan(x); }
                    break;
                }
                rcap[p ^ 1] += b; rcap[p] -= b;
                const up = head[p];
                if (rcap[p] === 0) { parent[x] = ORPHAN; pushOrphan(x); }
                x = up;
            }
            flow += b; nAug++;

            // ---- adoption ----
            while (oh < ot) {
                const x = orph[oh++];
                const sinkTree = isSink[x];
                let best = NONE, bestD = 0x7fffffff;
                for (let a0 = first[x]; a0 >= 0; a0 = next[a0]) {
                    if ((sinkTree ? rcap[a0] : rcap[a0 ^ 1]) > 0) {
                        let j = head[a0];
                        if (isSink[j] !== sinkTree || parent[j] === NONE) continue;
                        // check origin of j
                        let d = 0, ok = false;
                        while (true) {
                            if (ts[j] === TIME) { d += dist[j]; ok = true; break; }
                            const pj = parent[j];
                            d++;
                            if (pj === TERMINAL) { ts[j] = TIME; dist[j] = 1; ok = true; break; }
                            if (pj === ORPHAN) { ok = false; break; }
                            j = head[pj];
                        }
                        if (ok) {
                            if (d < bestD) { best = a0; bestD = d; }
                            // stamp the path
                            for (j = head[a0]; ts[j] !== TIME; j = head[parent[j]]) { ts[j] = TIME; dist[j] = d; d--; }
                        }
                    }
                }
                if (best !== NONE) {
                    parent[x] = best; ts[x] = TIME; dist[x] = bestD + 1;
                } else {
                    parent[x] = NONE;
                    for (let a0 = first[x]; a0 >= 0; a0 = next[a0]) {
                        const j = head[a0];
                        if (isSink[j] !== sinkTree) continue;
                        const pj = parent[j];
                        if (pj === NONE) continue;
                        if ((sinkTree ? rcap[a0] : rcap[a0 ^ 1]) > 0) push(j);
                        if (pj !== TERMINAL && pj !== ORPHAN && head[pj] === x) { parent[j] = ORPHAN; pushOrphan(j); }
                    }
                    if (cur === x) cur = -1;
                }
            }
            oh = 0; ot = 0;
        }
        this.flow = flow;
        this.nAug = nAug;
        return flow;
    }

    /** Minimal sink set: nodes that can reach t in the residual graph. */
    sinkSide() {
        const n = this.n, head = this.head, next = this.next, rcap = this.rcap,
            first = this.first, trCap = this.trCap;
        const side = new Uint8Array(n);
        const stack = new Int32Array(n);
        let sp = 0;
        for (let i = 0; i < n; i++) if (trCap[i] < 0) { side[i] = 1; stack[sp++] = i; }
        while (sp > 0) {
            const v = stack[--sp];
            for (let a = first[v]; a >= 0; a = next[a]) {
                const u = head[a];
                if (!side[u] && rcap[a ^ 1] > 0) { side[u] = 1; stack[sp++] = u; }
            }
        }
        return side;
    }
}
