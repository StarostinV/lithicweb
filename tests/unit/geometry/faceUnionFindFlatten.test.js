/**
 * Regression tests: union-find labels must be ROOTS (bug found 2026-11-03).
 * ufFindAll used path halving without assigning the root back, so remapByFrequency
 * turned intermediate nodes into phantom tiny segments.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ufFindAll, unionFindSegmentation } from '../../../src/geometry/faceUnionFind.js';

// deterministic PRNG (mulberry32)
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('union-find flattening (regression)', () => {
    it('assigns the root on a chain longer than 2', () => {
        // 0 -> 1 -> 2 -> 3 -> 4 (root); path halving alone leaves parent[0] = 2
        const parent = new Int32Array([1, 2, 3, 4, 4]);
        ufFindAll(parent);
        expect(Array.from(parent)).toEqual([4, 4, 4, 4, 4]);
    });

    it('flattens random deep forests to their roots', () => {
        const r = rng(0);
        for (let trial = 0; trial < 200; trial++) {
            const n = 5 + Math.floor(r() * 55);
            const parent = new Int32Array(n);
            for (let i = 0; i < n; i++) parent[i] = i;
            for (let i = 0; i < n - 1; i++) if (r() < 0.8) parent[i] = i + 1 + Math.floor(r() * (n - i - 1));
            const ref = Int32Array.from(parent);
            const root = (x) => { while (ref[x] !== x) x = ref[x]; return x; };
            const expected = Array.from({ length: n }, (_, i) => root(i));
            ufFindAll(parent);
            expect(Array.from(parent)).toEqual(expected);
        }
    });

    it('real mesh (RF.b_10366): no phantom segments, same partition as Python', () => {
        // Fixture (tests/fixtures/uf_real_RF.b_10366.bin.gz), written from the paper's
        // held-out data: int32 numFaces | float32 pred[n] | int32 adj[3n] |
        // int32 labels from the FIXED Python union_find_segmentation (tau 0.45, min 50)
        // run with a STABLE argsort (numpy default sort is unstable; JS sort is stable,
        // and more than half of the edge costs are tied).
        // The synthetic grids tried did not produce deep enough trees in JS; with the
        // old code this mesh gave 139 segments instead of 99 (40 phantom segments).
        const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '../../fixtures/uf_real_RF.b_10366.bin.gz')));
        const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        const n = new Int32Array(buf, 0, 1)[0];
        const pred = new Float32Array(buf, 4, n);
        const adj = new Int32Array(buf, 4 + 4 * n, 3 * n);
        const py = new Int32Array(buf, 4 + 16 * n, n);
        const labels = unionFindSegmentation(pred, adj, n, { maxMergeCost: 0.45, minSegmentSize: 50, mergeCost: 'max' });
        const count = (arr) => { const m = new Map(); for (const l of arr) m.set(l, (m.get(l) || 0) + 1); return m; };
        const cj = count(labels), cp = count(py);
        // identical partition (bijection between JS and Python labels)
        const pairs = new Set();
        for (let i = 0; i < n; i++) pairs.add(labels[i] * 1048576 + py[i]);
        expect(cj.size).toBe(cp.size);
        expect(pairs.size).toBe(cj.size);
        // only true islands may stay below the minimum (the reference has exactly 1 here)
        const smallJ = [...cj.values()].filter((c) => c < 50).length;
        const smallP = [...cp.values()].filter((c) => c < 50).length;
        expect(smallJ).toBe(smallP);
    });
});
