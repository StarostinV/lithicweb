/**
 * Unit tests of the Artifact3-D port's building blocks on small synthetic
 * inputs with brute-force references (max-flow, k-NN, alpha-expansion moves,
 * winding repair, label transfer, decimation).
 */
import { BKGraph } from '../../../../src/geometry/artifact3d/maxflow.js';
import { KNNGrid } from '../../../../src/geometry/artifact3d/knn.js';
import { alphaExpansionPotts, pottsEnergy } from '../../../../src/geometry/artifact3d/graphcut.js';
import { prepareMesh, fixWinding, decimateMesh, reorientMesh } from '../../../../src/geometry/artifact3d/meshPrep.js';
import { majorityVertexLabels, faceLabelsFromVertices, nearestVertexLabels } from '../../../../src/geometry/artifact3d/labelTransfer.js';
import { mergeSmallFinal } from '../../../../src/geometry/artifact3d/merging.js';
import { pairwiseSum, median, faceAdjacencyPairs } from '../../../../src/geometry/artifact3d/topology.js';
import { NumpyRandom } from '../../../../src/geometry/artifact3d/numpyRandom.js';

/** Small deterministic PRNG for synthetic data. */
const lcg = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** UV sphere as flat arrays (closed, outward winding). */
function sphere(nu = 24, nv = 16, r = 10) {
    const pos = [], idx = [];
    pos.push(0, 0, r);
    for (let i = 1; i < nv; i++) {
        const th = Math.PI * i / nv;
        for (let j = 0; j < nu; j++) {
            const ph = 2 * Math.PI * j / nu;
            pos.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
        }
    }
    pos.push(0, 0, -r);
    const ring = (i, j) => 1 + (i - 1) * nu + (j % nu);
    const bottom = pos.length / 3 - 1;
    for (let j = 0; j < nu; j++) idx.push(0, ring(1, j), ring(1, j + 1));
    for (let i = 1; i < nv - 1; i++) {
        for (let j = 0; j < nu; j++) {
            idx.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1));
            idx.push(ring(i, j), ring(i + 1, j + 1), ring(i, j + 1));
        }
    }
    for (let j = 0; j < nu; j++) idx.push(bottom, ring(nv - 1, j + 1), ring(nv - 1, j));
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

function signedVolume(v, f) {
    let vol = 0;
    for (let t = 0; t < f.length; t += 3) {
        const a = 3 * f[t], b = 3 * f[t + 1], c = 3 * f[t + 2];
        vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
             - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
             + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    return vol / 6;
}

describe('BK max-flow', () => {
    test('min cut equals brute force on 200 random small graphs', () => {
        const rnd = lcg(7);
        for (let trial = 0; trial < 200; trial++) {
            const n = 2 + Math.floor(rnd() * 7);
            const src = [], snk = [], arcs = [];
            for (let i = 0; i < n; i++) { src.push(Math.floor(rnd() * 10)); snk.push(Math.floor(rnd() * 10)); }
            for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
                if (rnd() < 0.5) arcs.push([i, j, Math.floor(rnd() * 8), Math.floor(rnd() * 8)]);
            }
            const g = new BKGraph(n, arcs.length);
            for (let i = 0; i < n; i++) g.addTWeights(i, src[i], snk[i]);
            for (const [i, j, c, r] of arcs) g.addEdge(i, j, c, r);
            const flow = g.maxflow();
            const side = g.sinkSide();
            // brute force over all 2^n labellings; x=1 = sink side pays src
            let best = Infinity;
            const cutOf = (x) => {
                let c = 0;
                for (let i = 0; i < n; i++) c += x[i] ? src[i] : snk[i];
                for (const [i, j, cij, cji] of arcs) {
                    if (!x[i] && x[j]) c += cij;
                    if (x[i] && !x[j]) c += cji;
                }
                return c;
            };
            for (let mask = 0; mask < (1 << n); mask++) {
                const x = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
                best = Math.min(best, cutOf(x));
            }
            expect(flow).toBeCloseTo(best, 9);
            expect(cutOf(Array.from(side))).toBeCloseTo(best, 9);
        }
    });
});

describe('alpha-expansion', () => {
    test('both constructions never increase the energy and agree on a toy grid', () => {
        // 6x6 grid of faces, four noisy quadrants
        const W = 6, N = W * W, rnd = lcg(3);
        const fp = [], ew = [];
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
            if (x + 1 < W) { fp.push(y * W + x, y * W + x + 1); ew.push(x === 2 ? 0.1 : 1 + rnd()); }
            if (y + 1 < W) { fp.push(y * W + x, (y + 1) * W + x); ew.push(y === 2 ? 0.1 : 1 + rnd()); }
        }
        const ML = new Int32Array(N);
        for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
            ML[y * W + x] = 1 + (x > 2 ? 1 : 0) + (y > 2 ? 2 : 0);
            if (rnd() < 0.2) ML[y * W + x] = 1 + Math.floor(rnd() * 4);
        }
        const fpA = Int32Array.from(fp), ewA = Float64Array.from(ew);
        const e0 = pottsEnergy(ML, ML, fpA, ewA, 1, 1);
        const a = alphaExpansionPotts(ML, fpA, ewA, { dataCost: 1, smoothCost: 1, symmetric: true });
        const b = alphaExpansionPotts(ML, fpA, ewA, { dataCost: 1, smoothCost: 1, symmetric: false, skipUnchanged: false });
        expect(a.energy).toBeLessThanOrEqual(e0);
        expect(b.energy).toBeCloseTo(a.energy, 9);
        expect(a.labels.reduce((m, x) => Math.max(m, x), 0)).toBe(4);
    });
});

describe('KNNGrid', () => {
    test('matches brute force (k = 1, 2, 6) on a noisy sphere', () => {
        const { positions } = sphere(30, 20, 7);
        const rnd = lcg(11);
        const pts = Float64Array.from(positions, x => x + (rnd() - 0.5) * 0.3);
        const grid = new KNNGrid(pts);
        const n = pts.length / 3;
        for (let q = 0; q < 200; q++) {
            const x = (rnd() - 0.5) * 20, y = (rnd() - 0.5) * 20, z = (rnd() - 0.5) * 20;
            const all = [];
            for (let i = 0; i < n; i++) {
                const dx = pts[3 * i] - x, dy = pts[3 * i + 1] - y, dz = pts[3 * i + 2] - z;
                all.push([dx * dx + dy * dy + dz * dz, i]);
            }
            all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const k of [1, 2, 6]) expect(grid.query(x, y, z, k)).toEqual(all.slice(0, k).map(e => e[1]));
        }
    });
});

describe('mesh preparation', () => {
    test('welds duplicates, repairs mixed winding and inverts inside-out meshes', () => {
        const { positions, indices } = sphere();
        // duplicate vertex 5 (and point one face at the copy), flip a third of the faces
        const pos = Float32Array.from([...positions, positions[15], positions[16], positions[17]]);
        const idx = Uint32Array.from(indices);
        const dup = pos.length / 3 - 1;
        for (let x = 0; x < idx.length; x++) if (idx[x] === 5) { idx[x] = dup; break; }
        for (let t = 0; t < idx.length; t += 9) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
        const p = prepareMesh(pos, idx, 1);
        expect(p.v.length / 3).toBe(positions.length / 3);
        expect(p.vertexMap[dup]).toBe(p.vertexMap[5]);
        expect(p.flippedFaces).toBeGreaterThan(0);
        expect(signedVolume(p.v, p.f)).toBeGreaterThan(0);
        // every interior edge now traversed once in each direction
        const pairs = faceAdjacencyPairs(p.f, p.v.length / 3);
        expect(pairs.count).toBe(p.f.length / 2);
        // a fully inverted mesh is turned outward
        const inv = Int32Array.from(p.f);
        for (let t = 0; t < inv.length; t += 3) { const s = inv[t + 1]; inv[t + 1] = inv[t + 2]; inv[t + 2] = s; }
        expect(fixWinding(p.v, inv).inverted).toBe(true);
        expect(signedVolume(p.v, inv)).toBeGreaterThan(0);
    });

    test('unit factor converts to mm', () => {
        const { positions, indices } = sphere(8, 6, 1);
        const p = prepareMesh(positions, indices, 10);
        expect(Math.max(...p.v)).toBeCloseTo(10, 5);
    });

    test('decimation reaches the face target and keeps the mesh closed', async () => {
        const { positions, indices } = sphere(80, 60, 10);
        const p = prepareMesh(positions, indices, 1);
        const d = await decimateMesh(p.v, p.f, 2000);
        expect(d.decimated).toBe(true);
        expect(d.f.length / 3).toBeLessThanOrEqual(2000);
        expect(d.f.length / 3).toBeGreaterThan(1800);
        expect(faceAdjacencyPairs(d.f, d.v.length / 3).count).toBe(d.f.length / 2);
        expect(signedVolume(d.v, d.f)).toBeGreaterThan(0.95 * signedVolume(p.v, p.f));
        const same = await decimateMesh(p.v, p.f, 1e9);
        expect(same.decimated).toBe(false);
    });

    test('PCA pose puts the long axis on X', () => {
        const { positions } = sphere(20, 12, 1);
        const v = Float64Array.from(positions);
        for (let i = 0; i < v.length; i += 3) { v[i] *= 1; v[i + 1] *= 5; v[i + 2] *= 2; }
        const r = reorientMesh(v);
        const ext = (k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < r.length; i += 3) { lo = Math.min(lo, r[i]); hi = Math.max(hi, r[i]); } return hi - lo; };
        expect(ext(0)).toBeCloseTo(10, 6);
        expect(ext(1)).toBeCloseTo(4, 6);
    });
});

describe('label transfer and cleanup helpers', () => {
    test('majority vertex labels: ties go to the larger label', () => {
        const f = Int32Array.from([0, 1, 2, 0, 2, 3]);
        expect(Array.from(majorityVertexLabels(f, Int32Array.from([1, 2]), 5))).toEqual([2, 1, 2, 2, 0]);
    });

    test('face labels from vertices: two-of-three, else middle value', () => {
        const f = [0, 1, 2, 3, 4, 5];
        expect(Array.from(faceLabelsFromVertices(f, Int32Array.from([1, 2, 2, 3, 1, 2])))).toEqual([2, 2]);
    });

    test('nearest-vertex transfer', () => {
        const src = Float64Array.from([0, 0, 0, 10, 0, 0]);
        const out = nearestVertexLabels(src, Int32Array.from([4, 7]), [1, 0, 0, 9, 1, 0, 6, 0, 0]);
        expect(Array.from(out)).toEqual([4, 7, 7]);
    });

    test('small final scars are absorbed into the neighbour with the longest border', () => {
        // faces 0..5 in a strip; label 3 (one face) touches 1 once and 2 twice
        const L = Int32Array.from([1, 1, 3, 2, 2, 2]);
        const fp = Int32Array.from([0, 1, 1, 2, 2, 3, 2, 4, 3, 4, 4, 5]);
        expect(Array.from(mergeSmallFinal(L, fp, 6, 2))).toEqual([1, 1, 2, 2, 2, 2]);
    });

    test('numpy-style pairwise sum and median', () => {
        const a = Float64Array.from({ length: 1000 }, (_, i) => 0.1 * i + 1e-3 / (i + 1));
        let naive = 0;
        for (const x of a) naive += x;
        expect(pairwiseSum(a)).toBeCloseTo(naive, 6);
        expect(median([3, 1, 2, 10])).toBe(2.5);
        expect(median([5, 1, 3])).toBe(3);
    });

    test('NumpyRandom integers stay in range', () => {
        const g = new NumpyRandom(123);
        for (let i = 0; i < 1000; i++) {
            const r = g.integers(17);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(17);
        }
    });
});
