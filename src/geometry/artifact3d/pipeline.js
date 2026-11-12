/*! Artifact3-D scar segmentation, browser port. MIT License. Artifact3-D (c) 2022
 * Leore Grosman, Computerized Archaeology Laboratory, The Hebrew University of
 * Jerusalem; scar segmentation code by Eitan Richardson, HUJI 2011. Full notice:
 * licenses/artifact3d-LICENSE.txt */
/**
 * Artifact3-D scar segmentation — browser port.
 *
 * A classic, curvature-based segmentation of a lithic artefact surface into
 * flake scars, ported from the Python port of Artifact3-D's
 * ScarsCode/ScarsSegmentation (MATLAB, Eitan Richardson, The Hebrew University
 * of Jerusalem, 2011; Artifact3-D (c) 2022 Leore Grosman / Computerized
 * Archaeology Lab, HUJI, MIT licence — see ./LICENSE).
 *
 * Please cite:
 *   L. Grosman, A. Muller, G. Dag, H. Goldgeier, O. Harush, G. Herzlinger,
 *   K. Nebenhaus, F. Valetta, T. Yashuv, N. Dick (2022). Artifact3-D: New
 *   software for accurate, objective and efficient 3D analysis and
 *   documentation of archaeological artifacts. PLOS ONE 17(6): e0268401.
 *   https://doi.org/10.1371/journal.pone.0268401
 *   E. Richardson, L. Grosman, U. Smilansky, M. Werman (2014). Extracting scar
 *   and ridge features from 3D-scanned lithic artifacts. In: Archaeology in
 *   the Digital Era (CAA 2012), Amsterdam University Press, pp. 83-92.
 *   https://doi.org/10.1515/9789048519590-010
 *
 * Stages (Python port module in brackets):
 *   0  mesh preparation: mm units, welding, outward winding, decimation to
 *      200k faces (meshoptimizer), PCA pose                  [pilot_run.py]
 *   1  normal-cycle curvature, rescaled to 0.3462 mm edges    [curvature]
 *   2  crest lines by curvature non-maximum suppression       [ridges]
 *   3  curvature boost around strong crests                   [curvature]
 *   4  face smoothness graph                                  [smoothness]
 *   5  seeded geodesic clustering (numpy-compatible PRNG)     [clustering]
 *   6  merging of clusters across flat borders                [merging]
 *   7  Potts alpha-expansion graph cut (own BK max-flow)      [graphcut]
 *   7b absorption of scars smaller than minScarFaces          [merging]
 *   8  label transfer to the loaded mesh                      [pilot_run.py]
 *
 * The GCO-3.0 graph-cut library bundled with Artifact3-D (research-only
 * licence) and Kolmogorov's maxflow / PyMaxflow (GPL) are not used.
 *
 * @module artifact3d/pipeline
 */

import { prepareMesh, decimateMesh, reorientMesh, xExtent } from './meshPrep.js';
import { computeCurvature, meanEdgeLength, updateCurvature } from './curvature.js';
import { detectCrestLines } from './crestLines.js';
import { buildSmoothnessGraph } from './smoothness.js';
import { geodesicClustering } from './clustering.js';
import { mergeClusters, mergeSmallFinal } from './merging.js';
import { alphaExpansionPotts } from './graphcut.js';
import { majorityVertexLabels, nearestVertexLabels, faceLabelsFromVertices } from './labelTransfer.js';
import { faceAdjacencyPairs, uniqueEdges, CancelledError } from './topology.js';

/**
 * Parameters; defaults are the Python port's SegmentationParams with the
 * settings of its 546-mesh run (200k faces, min_scar_faces = 50, seed 0).
 * @typedef {Object} Artifact3DParams
 * @property {number} [targetFaces=200000] decimate meshes larger than this (0 = never)
 * @property {number} [thresholdScale=1] scales the three curvature thresholds
 * @property {number} [minScarFaces=50] absorb final scars smaller than this (0 = keep all)
 * @property {number} [seed=0] clustering seed (numpy default_rng compatible)
 * @property {number} [dataCost=10] graph-cut cost of leaving a face's cluster label
 * @property {number} [smoothCost=100] graph-cut cost per unit smoothness weight
 * @property {number} [maxClusters=350]
 * @property {number} [curvatureSmoothing=10]
 * @property {number} [referenceEdgeLength=0.3462] mm; Cmax is rescaled to this edge length
 * @property {number} [unitFactor=1] multiply input coordinates by this to get mm
 * @property {boolean} [exactGraphCut=false] use the Python port's graph construction
 *   (Kolmogorov-Zabih reparametrisation; ~2x slower) instead of symmetric arcs
 */
export const DEFAULT_PARAMS = Object.freeze({
    targetFaces: 200000,
    thresholdScale: 1.0,
    minScarFaces: 50,
    seed: 0,
    dataCost: 10,
    smoothCost: 100,
    maxClusters: 350,
    curvatureSmoothing: 10,
    referenceEdgeLength: 0.3462,
    unitFactor: 1,
    exactGraphCut: false,
});

/** Stage names and their share of the progress bar. */
export const STAGES = [
    ['prepare', 'Preparing mesh', 0.04],
    ['decimate', 'Decimating', 0.04],
    ['curvature', 'Curvature', 0.05],
    ['crest', 'Crest lines', 0.01],
    ['boost', 'Ridge boost', 0.01],
    ['smoothness', 'Smoothness graph', 0.02],
    ['clustering', 'Geodesic clustering', 0.08],
    ['merge', 'Merging clusters', 0.02],
    ['graphcut', 'Graph cut', 0.70],
    ['cleanup', 'Small-scar cleanup', 0.01],
    ['transfer', 'Label transfer', 0.02],
];

/**
 * Stage computations on an already prepared working mesh (stages 1-7b).
 * Exposed separately so tests can feed the Python port's decimated mesh.
 * @param {Float64Array} vRaw flat working-mesh vertices in mm (not reoriented)
 * @param {Int32Array} f flat faces, outward winding
 * @param {Artifact3DParams} params
 * @param {Object} [hooks]
 * @param {(stage: string, fraction: number, detail?: string) => void} [hooks.onStage]
 * @param {() => boolean} [hooks.isCancelled]
 * @param {{integers: (n:number)=>number}} [hooks.rng] override the PRNG (tests)
 * @param {Float64Array} [hooks.reoriented] use these posed vertices instead of reorientMesh(vRaw) (tests)
 * @returns {Object} intermediates, final labels and per-stage timings
 */
export function segmentWorkingMesh(vRaw, f, params = {}, hooks = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const { onStage = null, isCancelled = null } = hooks;
    const timings = {};
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const check = () => { if (isCancelled && isCancelled()) throw new CancelledError(); };
    let t0;
    const start = (name, detail) => { check(); if (onStage) onStage(name, 0, detail); t0 = now(); };
    const end = (name) => { timings[name] = (now() - t0) / 1000; };

    const s = p.thresholdScale;
    const thLow = 0.017 * s, thMid = 0.017 * s, thHigh = 0.05 * s;

    start('curvature');
    const v = hooks.reoriented || reorientMesh(vRaw);
    const nv = v.length / 3;
    const curv = computeCurvature(v, f, p.curvatureSmoothing);
    const h = meanEdgeLength(v, f);
    const scale = p.referenceEdgeLength / h;
    const CmaxRaw = new Float64Array(nv);
    for (let i = 0; i < nv; i++) CmaxRaw[i] = curv.Cmax[i] * scale;
    end('curvature');

    start('crest');
    const edges = uniqueEdges(f, nv);
    const crest = detectCrestLines(v, f, CmaxRaw, curv.Umax, { candidateThreshold: thLow, edges });
    end('crest');

    start('boost');
    const Cmax = updateCurvature(v, CmaxRaw, crest.idx, crest.strength);
    end('boost');

    start('smoothness');
    const pairs = faceAdjacencyPairs(f, nv);
    const graph = buildSmoothnessGraph(v, f, Cmax, crest, {
        curvatureThreshold: thMid, curvatureHighThreshold: thHigh, pairs,
    });
    end('smoothness');

    start('clustering');
    const clus = geodesicClustering(v, f, Cmax, {
        thresholds: [thLow, thMid, thHigh], maxClusters: p.maxClusters,
        rng: hooks.rng || p.seed, isCancelled,
        onCluster: onStage ? (i, max) => onStage('clustering', i / max, `cluster ${i}`) : null,
    });
    end('clustering');

    start('merge');
    const ML = mergeClusters(Cmax, clus.faceLabels, pairs);
    end('merge');

    start('graphcut');
    const gc = alphaExpansionPotts(ML, graph.fp, graph.ew, {
        dataCost: p.dataCost, smoothCost: p.smoothCost, isCancelled,
        symmetric: !p.exactGraphCut,
        onLabel: onStage ? ({ cycle, alpha, K }) => {
            // cycles are not known in advance (typically 2-4): approximate the bar
            const done = cycle + alpha / K;
            onStage('graphcut', Math.min(0.98, done / Math.max(3, cycle + 1.5)),
                `cycle ${cycle + 1}, label ${alpha}/${K}`);
        } : null,
    });
    end('graphcut');

    start('cleanup');
    const labels = p.minScarFaces > 0
        ? mergeSmallFinal(gc.labels, graph.fp, graph.count, p.minScarFaces)
        : gc.labels;
    end('cleanup');

    let nScars = 0;
    for (let t = 0; t < labels.length; t++) if (labels[t] > nScars) nScars = labels[t];
    return {
        v, meanEdge: h, cmaxScale: scale, vsize: xExtent(v),
        Cmin: curv.Cmin, CmaxRaw, Umax: curv.Umax, crest, Cmax,
        graph, clustering: clus, ML, graphcut: gc, labels, nScars, timings,
    };
}

/**
 * Full pipeline on a loaded mesh. Returns one 1-based scar label per input face.
 * @param {ArrayLike<number>} positions flat (n,3) as loaded (in source units)
 * @param {ArrayLike<number>} indices flat (m,3)
 * @param {Artifact3DParams} [params]
 * @param {Object} [hooks]
 * @param {(info: {stage: string, label: string, fraction: number, overall: number, detail?: string}) => void} [hooks.onProgress]
 * @param {() => boolean} [hooks.isCancelled]
 * @returns {Promise<{faceLabels: Int32Array, nScars: number, timings: Object, info: Object}>}
 */
export async function segmentArtifact3D(positions, indices, params = {}, hooks = {}) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const { onProgress = null, isCancelled = null } = hooks;
    const offsets = {};
    let acc = 0;
    for (const [name, , w] of STAGES) { offsets[name] = acc; acc += w; }
    const weight = Object.fromEntries(STAGES.map(([n, , w]) => [n, w]));
    const label = Object.fromEntries(STAGES.map(([n, l]) => [n, l]));
    const onStage = (stage, fraction, detail) => {
        if (onProgress) {
            onProgress({
                stage, label: label[stage], fraction, detail,
                overall: Math.min(1, (offsets[stage] + weight[stage] * fraction) / acc),
            });
        }
    };
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const check = () => { if (isCancelled && isCancelled()) throw new CancelledError(); };
    const timings = {};

    check(); onStage('prepare', 0);
    let t0 = now();
    const prep = prepareMesh(positions, indices, p.unitFactor);
    timings.prepare = (now() - t0) / 1000;

    check(); onStage('decimate', 0);
    t0 = now();
    const dec = await decimateMesh(prep.v, prep.f, p.targetFaces);
    timings.decimate = (now() - t0) / 1000;

    const res = segmentWorkingMesh(dec.v, dec.f, p, { onStage, isCancelled });
    Object.assign(timings, res.timings);

    check(); onStage('transfer', 0);
    t0 = now();
    const m = indices.length / 3;
    let faceLabels;
    if (!dec.decimated) {
        // same faces: copy labels; faces dropped as degenerate take their vertices' labels
        faceLabels = new Int32Array(m);
        let missing = false;
        for (let t = 0; t < m; t++) {
            const j = prep.faceMap[t];
            if (j >= 0) faceLabels[t] = res.labels[j]; else missing = true;
        }
        if (missing) {
            const vl = majorityVertexLabels(prep.f, res.labels, prep.v.length / 3);
            const inputVL = new Int32Array(positions.length / 3);
            for (let i = 0; i < inputVL.length; i++) inputVL[i] = prep.vertexMap[i] >= 0 ? vl[prep.vertexMap[i]] : 0;
            const fromV = faceLabelsFromVertices(indices, inputVL);
            for (let t = 0; t < m; t++) if (prep.faceMap[t] < 0) faceLabels[t] = fromV[t];
        }
    } else {
        const vl = majorityVertexLabels(dec.f, res.labels, dec.v.length / 3);
        const weldedVL = nearestVertexLabels(dec.v, vl, prep.v);
        const inputVL = new Int32Array(positions.length / 3);
        for (let i = 0; i < inputVL.length; i++) inputVL[i] = prep.vertexMap[i] >= 0 ? weldedVL[prep.vertexMap[i]] : 0;
        faceLabels = faceLabelsFromVertices(indices, inputVL);
    }
    timings.transfer = (now() - t0) / 1000;
    onStage('transfer', 1);

    let nScars = 0;
    const seen = new Set();
    for (let t = 0; t < m; t++) seen.add(faceLabels[t]);
    seen.delete(0);
    nScars = seen.size;
    return {
        faceLabels, nScars, timings,
        info: {
            inputFaces: m, workingFaces: dec.f.length / 3, workingVertices: dec.v.length / 3,
            decimated: dec.decimated, flippedFaces: prep.flippedFaces, inverted: prep.inverted,
            meanEdge: res.meanEdge, clusters: res.clustering.centers.length,
            merged: maxLabel(res.ML), graphcutScars: maxLabel(res.graphcut.labels),
            workingScars: res.nScars, energy: res.graphcut.energy, params: p,
        },
    };
}

function maxLabel(a) {
    let k = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > k) k = a[i];
    return k;
}

export { CancelledError };
