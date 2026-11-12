/**
 * End-to-end tests of the Artifact3-D browser port: the whole JS chain
 * (pose, curvature ... cleanup) on the Python port's working mesh, plus the
 * public pipeline's progress, cancellation and label transfer.
 */
import path from 'path';
import { segmentWorkingMesh, segmentArtifact3D, CancelledError } from '../../../../src/geometry/artifact3d/pipeline.js';
import { fixtureDirs, loadFixture } from './fixtureLoader.js';

const committed = fixtureDirs().filter(d => !d.includes(`${path.sep}local${path.sep}`));

describe.each(committed.map(d => [path.basename(d), d]))('Artifact3-D pipeline vs Python: %s', (_, dir) => {
    test('JS stages from the pose onwards reproduce the Python segmentation', () => {
        const fx = loadFixture(dir);
        // the posed mesh is fed as raw input: the JS pose is recomputed from it
        const r = segmentWorkingMesh(fx.get('v'), fx.get('f'), { seed: fx.meta.params.seed });
        expect(r.meanEdge).toBeCloseTo(fx.meta.mean_edge, 12);
        expect(r.clustering.centers.length).toBe(fx.meta.n_clusters);
        let merged = 0;
        for (const x of r.ML) merged = Math.max(merged, x);
        expect(merged).toBe(fx.meta.n_merged);
        expect(r.nScars).toBe(fx.meta.n_final);
        const GL2 = fx.get('GL2');
        let same = 0;
        for (let i = 0; i < GL2.length; i++) if (r.labels[i] === GL2[i]) same++;
        // measured 99.92 % on RF.c_218 (min-cut ties in the graph cut)
        expect(same / GL2.length).toBeGreaterThanOrEqual(0.995);
    }, 120000);
});

/** Flat-sided box-like mesh: a cube subdivided into a grid on every side. */
function gridCube(n = 12, size = 20) {
    const pos = [], idx = [], key = new Map();
    const vid = (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (!key.has(k)) { key.set(k, pos.length / 3); pos.push(x * size / n, y * size / n, z * size / n); }
        return key.get(k);
    };
    const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        quad(vid(i, j, 0), vid(i, j + 1, 0), vid(i + 1, j + 1, 0), vid(i + 1, j, 0));          // z=0 (outward -z)
        quad(vid(i, j, n), vid(i + 1, j, n), vid(i + 1, j + 1, n), vid(i, j + 1, n));          // z=n
        quad(vid(i, 0, j), vid(i + 1, 0, j), vid(i + 1, 0, j + 1), vid(i, 0, j + 1));          // y=0
        quad(vid(i, n, j), vid(i, n, j + 1), vid(i + 1, n, j + 1), vid(i + 1, n, j));          // y=n
        quad(vid(0, i, j), vid(0, i, j + 1), vid(0, i + 1, j + 1), vid(0, i + 1, j));          // x=0
        quad(vid(n, i, j), vid(n, i + 1, j), vid(n, i + 1, j + 1), vid(n, i, j + 1));          // x=n
    }
    return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

describe('segmentArtifact3D', () => {
    /** Dominant label per cube side and its share of that side's faces. */
    function sidePurity(positions, indices, faceLabels) {
        const sideOf = (t) => {
            const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
            for (let k = 0; k < 3; k++) {
                const x = [positions[3 * a + k], positions[3 * b + k], positions[3 * c + k]];
                if (x[0] === x[1] && x[1] === x[2]) return `${k}:${x[0]}`;
            }
            return null;
        };
        const counts = new Map();
        for (let t = 0; t < faceLabels.length; t++) {
            const s = sideOf(t);
            if (!counts.has(s)) counts.set(s, new Map());
            const m = counts.get(s);
            m.set(faceLabels[t], (m.get(faceLabels[t]) || 0) + 1);
        }
        return Array.from(counts.values()).map((m) => {
            let best = 0, lab = 0, tot = 0;
            for (const [l, c] of m) { tot += c; if (c > best) { best = c; lab = l; } }
            return { label: lab, share: best / tot };
        });
    }

    // 0.36 mm edges, close to the 0.346 mm resolution the thresholds are calibrated for
    test('segments a cube along its edges and reports monotone progress per stage', async () => {
        const { positions, indices } = gridCube(45, 16);
        const seen = [];
        const r = await segmentArtifact3D(positions, indices, {}, { onProgress: (p) => seen.push(p) });
        expect(r.faceLabels.length).toBe(indices.length / 3);
        const sides = sidePurity(positions, indices, r.faceLabels);
        expect(sides.length).toBe(6);
        expect(new Set(sides.map(s => s.label)).size).toBe(6);       // sides never share a scar
        for (const s of sides) expect(s.share).toBeGreaterThan(0.9);
        const stages = new Set(seen.map(p => p.stage));
        for (const s of ['prepare', 'curvature', 'clustering', 'graphcut', 'transfer']) expect(stages.has(s)).toBe(true);
        for (let i = 1; i < seen.length; i++) expect(seen[i].overall).toBeGreaterThanOrEqual(seen[i - 1].overall - 1e-9);
        expect(seen[seen.length - 1].overall).toBeCloseTo(1, 6);
    }, 60000);

    test('honours cancellation', async () => {
        const { positions, indices } = gridCube(10, 30);
        let calls = 0;
        await expect(segmentArtifact3D(positions, indices, {}, {
            isCancelled: () => ++calls > 3,
        })).rejects.toBeInstanceOf(CancelledError);
    });

    test('decimates above the target and transfers labels back to every input face', async () => {
        const { positions, indices } = gridCube(45, 16);   // 24300 faces
        const r = await segmentArtifact3D(positions, indices, { targetFaces: 16000 });
        expect(r.info.decimated).toBe(true);
        expect(r.info.workingFaces).toBeLessThanOrEqual(16000);
        expect(r.faceLabels.length).toBe(indices.length / 3);
        for (const x of r.faceLabels) expect(x).toBeGreaterThan(0);
        // decimation turns the flat sides into large triangles, so only the transfer
        // is checked here: every input face labelled, no scar invented or lost
        expect(r.nScars).toBeGreaterThanOrEqual(2);
        expect(r.nScars).toBe(r.info.workingScars);
    }, 60000);
});
