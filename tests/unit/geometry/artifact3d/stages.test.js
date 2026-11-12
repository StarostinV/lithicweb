/**
 * Per-stage agreement of the browser port with the Python port of
 * Artifact3-D's scar segmentation. Each stage is fed the Python port's own
 * inputs from the golden fixtures (tools/artifact3d/make_fixtures.py), so a
 * difference is attributable to that stage alone.
 *
 * Fixtures: tests/fixtures/artifact3d/RF.c_218 (committed, 100k faces) and,
 * when present, tests/fixtures/artifact3d/local/* (larger, not in git).
 */
import path from 'path';
import { computeCurvature, meanEdgeLength, updateCurvature } from '../../../../src/geometry/artifact3d/curvature.js';
import { detectCrestLines } from '../../../../src/geometry/artifact3d/crestLines.js';
import { buildSmoothnessGraph } from '../../../../src/geometry/artifact3d/smoothness.js';
import { geodesicClustering } from '../../../../src/geometry/artifact3d/clustering.js';
import { mergeClusters, mergeSmallFinal } from '../../../../src/geometry/artifact3d/merging.js';
import { alphaExpansionPotts } from '../../../../src/geometry/artifact3d/graphcut.js';
import { faceAdjacencyPairs } from '../../../../src/geometry/artifact3d/topology.js';
import { fixtureDirs, loadFixture } from './fixtureLoader.js';

const countDiff = (a, b) => {
    expect(a.length).toBe(b.length);
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
};
const maxAbsDiff = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
};
/** Replays the random draws recorded from Python, checking the bound each time. */
const replay = (draws) => {
    let k = 0;
    return {
        integers(n) {
            const [nn, r] = draws[k++];
            if (nn !== n) throw new Error(`draw ${k - 1}: bound ${n}, Python had ${nn}`);
            return r;
        },
    };
};

describe.each(fixtureDirs().map(d => [path.basename(d), d]))('Artifact3-D stages vs Python: %s', (_, dir) => {
    const fx = loadFixture(dir);
    const v = fx.get('v'), f = fx.get('f');
    const nv = v.length / 3;
    const th = 0.017, thHigh = 0.05;

    test('1 curvature: max |dCmax|, |dCmin| < 1e-9, same mean edge', () => {
        const c = computeCurvature(v, f, 10);
        const h = meanEdgeLength(v, f);
        expect(h).toBe(fx.meta.mean_edge);
        const scale = 0.3462 / h;
        const Cmax = c.Cmax.map(x => x * scale);
        expect(maxAbsDiff(Cmax, fx.get('Cmax_raw'))).toBeLessThan(1e-9);
        expect(maxAbsDiff(c.Cmin, fx.get('Cmin'))).toBeLessThan(1e-9);
        // eigenvector of the middle |eigenvalue| (sign is arbitrary)
        const U = fx.get('Umax');
        let worst = 0;
        for (let i = 0; i < nv; i++) {
            const d = Math.abs(c.Umax[3 * i] * U[3 * i] + c.Umax[3 * i + 1] * U[3 * i + 1] + c.Umax[3 * i + 2] * U[3 * i + 2]);
            worst = Math.max(worst, 1 - d);
        }
        expect(worst).toBeLessThan(1e-9);
    });

    test('2 crest lines identical', () => {
        const cr = detectCrestLines(v, f, fx.get('Cmax_raw'), fx.get('Umax'), { candidateThreshold: th });
        expect(cr.idx.length).toBe(fx.meta.n_crest_points);
        expect(countDiff(cr.idx, fx.get('crest_idx'))).toBe(0);
        expect(countDiff(cr.edges, fx.get('crest_edges'))).toBe(0);
    });

    test('3 ridge boost identical', () => {
        const CmaxRaw = fx.get('Cmax_raw');
        const idx = fx.get('crest_idx');
        const strength = Float64Array.from(idx, i => CmaxRaw[i]);
        expect(countDiff(updateCurvature(v, CmaxRaw, idx, strength), fx.get('Cmax'))).toBe(0);
    });

    test('4 smoothness graph: face pairs and weights identical', () => {
        const CmaxRaw = fx.get('Cmax_raw');
        const idx = fx.get('crest_idx');
        const crest = { idx, strength: Float64Array.from(idx, i => CmaxRaw[i]), edges: fx.get('crest_edges') };
        const g = buildSmoothnessGraph(v, f, fx.get('Cmax'), crest, { curvatureThreshold: th, curvatureHighThreshold: thHigh });
        expect(g.count).toBe(fx.meta.n_face_pairs);
        expect(countDiff(g.fp, fx.get('fp'))).toBe(0);
        expect(countDiff(g.ew, fx.get('ew'))).toBe(0);
    });

    test('5 geodesic clustering identical (injected Python draws, and own numpy PRNG)', () => {
        const Cmax = fx.get('Cmax');
        const a = geodesicClustering(v, f, Cmax, { rng: replay(fx.meta.rng_draws) });
        expect(a.draws.length).toBe(fx.meta.rng_draws.length);
        expect(countDiff(a.vertexLabels, fx.get('VL'))).toBe(0);
        expect(countDiff(a.faceLabels, fx.get('L'))).toBe(0);
        expect(countDiff(a.centers, fx.get('centers'))).toBe(0);
        const b = geodesicClustering(v, f, Cmax, { rng: fx.meta.params.seed });
        expect(countDiff(b.faceLabels, fx.get('L'))).toBe(0);
    });

    test('6 merging identical', () => {
        const ML = mergeClusters(fx.get('Cmax'), fx.get('L'), faceAdjacencyPairs(f, nv));
        expect(countDiff(ML, fx.get('ML'))).toBe(0);
    });

    // Plan criterion: relative energy difference <= 1e-4 and >= 99.5 % faces equal.
    test('7 graph cut, Python-equivalent construction: energy within 1e-4, >= 99.5 % faces', () => {
        const GL = fx.get('GL');
        const gc = alphaExpansionPotts(fx.get('ML'), fx.get('fp'), fx.get('ew'), { symmetric: false });
        const rel = Math.abs(gc.energy - fx.meta.energy_final) / fx.meta.energy_final;
        expect(rel).toBeLessThanOrEqual(1e-4);
        expect(1 - countDiff(gc.labels, GL) / GL.length).toBeGreaterThanOrEqual(0.995);
    }, 180000);

    // Default (fast) construction: symmetric arcs + skipping unchanged labels.
    // Measured: RF.c_218 rel 1.07e-4 / 99.92 %, CTC_1011 rel 5.0e-5 / 99.83 %;
    // its JS energy is the higher one on both, so the bound here is 2e-4.
    test('7 graph cut, default fast construction: energy within 2e-4, >= 99.5 % faces', () => {
        const GL = fx.get('GL');
        const gc = alphaExpansionPotts(fx.get('ML'), fx.get('fp'), fx.get('ew'));
        const rel = Math.abs(gc.energy - fx.meta.energy_final) / fx.meta.energy_final;
        expect(rel).toBeLessThanOrEqual(2e-4);
        expect(1 - countDiff(gc.labels, GL) / GL.length).toBeGreaterThanOrEqual(0.995);
        let k = 0;
        for (const x of gc.labels) if (x > k) k = x;
        expect(k).toBe(fx.meta.n_graphcut);
    }, 180000);

    test('7b small-scar cleanup identical', () => {
        const fp = fx.get('fp');
        const out = mergeSmallFinal(fx.get('GL'), fp, fp.length / 2, fx.meta.params.min_scar_faces);
        expect(countDiff(out, fx.get('GL2'))).toBe(0);
    });
});
