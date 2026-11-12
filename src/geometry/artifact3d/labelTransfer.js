/**
 * Transfer scar labels from the (decimated) working mesh back to the mesh the
 * user loaded, as the Python port's pilot_run.py does: per-vertex majority of
 * incident face labels on the working mesh, then nearest working vertex for
 * every full-resolution vertex.
 *
 * @module artifact3d/labelTransfer
 */

import { KNNGrid } from './knn.js';

/**
 * Per-vertex label = most frequent label among incident faces (ties: larger
 * label, as pilot_run.majority_vertex_labels). Unreferenced vertices get 0.
 * @param {Int32Array} f flat faces
 * @param {Int32Array} faceLabels
 * @param {number} nv
 * @returns {Int32Array}
 */
export function majorityVertexLabels(f, faceLabels, nv) {
    // count (vertex,label) pairs with a sort over packed keys
    const n = f.length;
    let K = 0;
    for (let t = 0; t < faceLabels.length; t++) if (faceLabels[t] > K) K = faceLabels[t];
    const S = K + 1;
    const keys = new Float64Array(n);
    for (let x = 0; x < n; x++) keys[x] = f[x] * S + faceLabels[(x / 3) | 0];
    keys.sort();
    const out = new Int32Array(nv);
    const best = new Int32Array(nv);
    for (let x = 0; x < n;) {
        let y = x + 1;
        while (y < n && keys[y] === keys[x]) y++;
        const vtx = Math.floor(keys[x] / S), lab = keys[x] - vtx * S, c = y - x;
        if (c >= best[vtx]) { best[vtx] = c; out[vtx] = lab; }   // ascending labels: ties -> larger
        x = y;
    }
    return out;
}

/**
 * Nearest-vertex transfer of per-vertex labels from `src` to `dst` points.
 * @param {Float64Array} srcV flat working-mesh vertices
 * @param {Int32Array} srcLabels per working vertex
 * @param {ArrayLike<number>} dstV flat target vertices (same coordinate frame)
 * @returns {Int32Array}
 */
export function nearestVertexLabels(srcV, srcLabels, dstV) {
    const grid = new KNNGrid(srcV);
    const n = dstV.length / 3;
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        const nn = grid.query(dstV[3 * i], dstV[3 * i + 1], dstV[3 * i + 2], 1);
        out[i] = nn.length ? srcLabels[nn[0]] : 0;
    }
    return out;
}

/**
 * Face label from its three vertex labels: the label shared by two or three
 * vertices, otherwise the middle value (as the clustering's face rule).
 * @param {ArrayLike<number>} indices flat faces
 * @param {Int32Array} vertexLabels
 * @returns {Int32Array}
 */
export function faceLabelsFromVertices(indices, vertexLabels) {
    const m = indices.length / 3;
    const out = new Int32Array(m);
    for (let t = 0; t < m; t++) {
        const a = vertexLabels[indices[3 * t]], b = vertexLabels[indices[3 * t + 1]], c = vertexLabels[indices[3 * t + 2]];
        out[t] = (a === b || a === c) ? a : (b === c ? b : Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)));
    }
    return out;
}
