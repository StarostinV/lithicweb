// End-to-end validation of the Artifact3-D browser port against the Python
// port on one mesh (node, one thread).
//
//   node tools/artifact3d/validate.mjs MESH.ply FIXTURE_DIR [--json out.json]
//
// FIXTURE_DIR is the output of make_fixtures.py for the same mesh.
// (a) JS stages 1-7b on the Python port's own working mesh (decimated by
//     trimesh when the mesh is larger than 200k faces): face agreement with
//     Python's final labels, segment counts, per-stage times.
// (b) full JS pipeline from the PLY (meshoptimizer decimation): segment
//     counts and PQ / F1 against the expert edges stored in the PLY, using the
//     web client's own evaluation path (face labels -> vertex segments ->
//     normalizeEdges -> flood fill -> computeInstanceSegmentationMetrics),
//     for the JS result and for the Python port's labels alike.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A3D = path.join(ROOT, 'src/geometry/artifact3d');
const { segmentWorkingMesh, segmentArtifact3D } = await import(path.join(A3D, 'pipeline.js'));
const { prepareMesh } = await import(path.join(A3D, 'meshPrep.js'));
const { majorityVertexLabels, nearestVertexLabels, faceLabelsFromVertices } = await import(path.join(A3D, 'labelTransfer.js'));
const { faceSegmentsToVertexSegments, normalizeEdges } = await import(path.join(ROOT, 'src/geometry/faceUnionFind.js'));
const { computeInstanceSegmentationMetrics } = await import(path.join(ROOT, 'src/evaluation/MetricsComputer.js'));
const { linearSumAssignment } = await import(path.join(ROOT, 'src/evaluation/HungarianAlgorithm.js'));

const [plyPath, fixDir] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

function readPly(p) {
    const buf = fs.readFileSync(p);
    const end = buf.indexOf('end_header') + 'end_header'.length;
    let off = end + (buf[end] === 13 ? 2 : 1);
    const header = buf.subarray(0, end).toString('latin1').split(/\r?\n/);
    const els = [];
    for (const line of header) {
        const t = line.trim().split(/\s+/);
        if (t[0] === 'element') els.push({ name: t[1], count: +t[2], props: [] });
        else if (t[0] === 'property') els[els.length - 1].props.push(t.slice(1));
    }
    const size = { float: 4, float32: 4, int: 4, int32: 4, uint: 4, uchar: 1, uint8: 1, double: 8, short: 2, ushort: 2 };
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const rd = (type, o) => {
        switch (type) {
            case 'float': case 'float32': return dv.getFloat32(o, true);
            case 'double': return dv.getFloat64(o, true);
            case 'int': case 'int32': return dv.getInt32(o, true);
            case 'uint': return dv.getUint32(o, true);
            case 'uchar': case 'uint8': return dv.getUint8(o);
            case 'short': return dv.getInt16(o, true);
            case 'ushort': return dv.getUint16(o, true);
            default: throw new Error(type);
        }
    };
    const out = {};
    for (const el of els) {
        if (el.name === 'vertex') {
            const pos = new Float32Array(3 * el.count), lab = new Int32Array(el.count);
            for (let i = 0; i < el.count; i++) {
                for (const [type, name] of el.props) {
                    const val = rd(type, off); off += size[type];
                    if (name === 'x') pos[3 * i] = val; else if (name === 'y') pos[3 * i + 1] = val;
                    else if (name === 'z') pos[3 * i + 2] = val; else if (name === 'labels') lab[i] = val;
                }
            }
            out.positions = pos; out.labels = lab;
        } else if (el.name === 'face') {
            const [, ct, it] = el.props[0];
            const idx = new Uint32Array(3 * el.count);
            for (let t = 0; t < el.count; t++) {
                const n = rd(ct, off); off += size[ct];
                if (n !== 3) throw new Error('triangles only');
                for (let k = 0; k < 3; k++) { idx[3 * t + k] = rd(it, off); off += size[it]; }
            }
            out.indices = idx;
        } else {
            for (let i = 0; i < el.count; i++) for (const [type] of el.props) off += size[type];
        }
    }
    return out;
}

function loadFixture(dir) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const get = (n) => {
        for (const [k, T] of [['f64', Float64Array], ['i32', Int32Array]]) {
            const p = path.join(dir, `${n}.${k}.gz`);
            if (fs.existsSync(p)) {
                const r = zlib.gunzipSync(fs.readFileSync(p));
                return new T(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength));
            }
        }
        return null;
    };
    return { meta, get };
}

function adjacency(indices, nv) {
    const adj = new Map();
    for (let i = 0; i < nv; i++) adj.set(i, new Set());
    for (let t = 0; t < indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const a = indices[t + k], b = indices[t + (k + 1) % 3];
            adj.get(a).add(b); adj.get(b).add(a);
        }
    }
    return adj;
}

/** Edge vertices -> per-vertex segment ids by flood fill (EvaluationManager._floodFillSegments). */
function floodFill(isEdge, adj, nv) {
    const lab = new Int32Array(nv);
    let id = 0;
    for (let s = 0; s < nv; s++) {
        if (isEdge[s] || lab[s]) continue;
        id++;
        const stack = [s];
        lab[s] = id;
        while (stack.length) {
            const u = stack.pop();
            for (const w of adj.get(u)) if (!isEdge[w] && !lab[w]) { lab[w] = id; stack.push(w); }
        }
    }
    return lab;
}

/** The web client's path: face segments -> vertex segments -> normalizeEdges -> edge labels. */
function faceLabelsToEdges(faceLabels, indices, nv, adj) {
    const vseg = faceSegmentsToVertexSegments(faceLabels, indices, nv);
    const edgeSet = new Set();
    for (let i = 0; i < nv; i++) if (vseg[i] === 0) edgeSet.add(i);
    return normalizeEdges(vseg, edgeSet, adj, nv, indices, 1).edgeLabels;
}

function evaluate(name, faceLabels, mesh, adj, gtSeg) {
    const nv = mesh.positions.length / 3;
    const edges = faceLabelsToEdges(faceLabels, mesh.indices, nv, adj);
    const pred = floodFill(edges, adj, nv);
    const m = computeInstanceSegmentationMetrics(Array.from(gtSeg), Array.from(pred));
    const k = new Set(faceLabels); k.delete(0);
    return { name, faceSegments: k.size, edgeVertices: edges.reduce((s, x) => s + x, 0),
        predSegments: m.nPredInstances, gtSegments: m.nGtInstances,
        PQ: m.PQ, F1: m.f1, precision: m.precision, recall: m.recall, SQ: m.SQ };
}

const agree = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return 1 - d / a.length; };
/** Share of faces whose labels correspond under the best one-to-one label matching. */
function matchedAgreement(a, b) {
    const ka = maxOf(a), kb = maxOf(b);
    const C = Array.from({ length: ka + 1 }, () => new Array(kb + 1).fill(0));
    for (let i = 0; i < a.length; i++) C[a[i]][b[i]]++;
    const cost = C.map(row => row.map(x => -x));
    const { rowInd: ri, colInd: ci } = linearSumAssignment(cost);
    let s = 0;
    for (let k = 0; k < ri.length; k++) s += C[ri[k]][ci[k]];
    return s / a.length;
}
const maxOf = (a) => { let k = 0; for (const x of a) if (x > k) k = x; return k; };

const mesh = readPly(plyPath);
const fx = loadFixture(fixDir);
const nvFull = mesh.positions.length / 3;
const adj = adjacency(mesh.indices, nvFull);
const gtSeg = floodFill(mesh.labels, adj, nvFull);
const report = { mesh: path.basename(plyPath), faces: mesh.indices.length / 3, python: {
    clusters: fx.meta.n_clusters, merged: fx.meta.n_merged, graphcut: fx.meta.n_graphcut,
    final: fx.meta.n_final, energy: fx.meta.energy_final, cpu_seconds: fx.meta.cpu_seconds } };

// ---- (a) Python's working mesh through the JS stages
let vRaw, fW;
if (fx.meta.decimated) {
    vRaw = fx.get('v_raw'); fW = fx.get('f');
} else {
    const prep = prepareMesh(mesh.positions, mesh.indices, 1);
    vRaw = prep.v; fW = prep.f;
    const fPy = fx.get('f');
    if (agree(fW, fPy) !== 1) throw new Error('prepared faces differ from the Python port\'s');
}
const c0 = process.cpuUsage();
const a = segmentWorkingMesh(vRaw, fW, {});
const cpuA = process.cpuUsage(c0).user / 1e6;
const GL2 = fx.get('GL2');
report.a = {
    clusters: a.clustering.centers.length, merged: maxOf(a.ML), graphcut: maxOf(a.graphcut.labels),
    final: a.nScars, energy: a.graphcut.energy,
    energyRelDiff: (a.graphcut.energy - fx.meta.energy_final) / fx.meta.energy_final,
    clusterFaceAgreement: agree(a.clustering.faceLabels, fx.get('L')),
    mergeFaceAgreement: agree(a.ML, fx.get('ML')),
    graphcutFaceAgreement: agree(a.graphcut.labels, fx.get('GL')),
    finalFaceAgreement: agree(a.labels, GL2),
    finalMatchedAgreement: matchedAgreement(a.labels, GL2),
    seconds: a.timings, cpuSeconds: cpuA,
};
// Python labels and JS (a) labels on the loaded mesh
let pyFaces, aFaces;
if (fx.meta.decimated) {
    const pyFull = fx.get('pred_full_vertex');
    pyFaces = faceLabelsFromVertices(mesh.indices, pyFull);
    const vl = majorityVertexLabels(fW, a.labels, vRaw.length / 3);
    const jsFull = nearestVertexLabels(vRaw, vl, Float64Array.from(mesh.positions));
    report.a.fullVertexAgreement = agree(jsFull, pyFull);
    aFaces = faceLabelsFromVertices(mesh.indices, jsFull);
} else {
    pyFaces = GL2; aFaces = a.labels;
}

// ---- (b) full JS pipeline from the PLY
const c1 = process.cpuUsage();
const t1 = performance.now();
const b = await segmentArtifact3D(mesh.positions, mesh.indices, {});
report.b = { wallSeconds: (performance.now() - t1) / 1000, cpuSeconds: process.cpuUsage(c1).user / 1e6,
    seconds: b.timings, info: { ...b.info, params: undefined }, faceSegments: b.nScars,
    faceAgreementWithPython: agree(b.faceLabels, pyFaces),
    matchedAgreementWithPython: matchedAgreement(b.faceLabels, pyFaces) };

report.metrics = [
    evaluate('python_port', pyFaces, mesh, adj, gtSeg),
    evaluate('js_on_python_mesh', aFaces, mesh, adj, gtSeg),
    evaluate('js_full_pipeline', b.faceLabels, mesh, adj, gtSeg),
];
console.log(JSON.stringify(report, null, 1));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
