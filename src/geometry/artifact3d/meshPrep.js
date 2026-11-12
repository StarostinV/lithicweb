/**
 * Mesh preparation for the Artifact3-D pipeline: unit conversion, vertex
 * welding, consistent outward winding, decimation (meshoptimizer, MIT) and
 * the PCA pose of Artifact3-D's reorientmesh.m.
 *
 * The Python port's preprocessing (pilot_run.py) is trimesh `process=True` +
 * `fix_normals`, then quadric decimation to 200k faces when the mesh is
 * larger. meshoptimizer's simplifier is a different quadric decimator, so a
 * decimated mesh — and with it the segmentation — differs slightly from the
 * Python port's on meshes above the target size.
 *
 * @module artifact3d/meshPrep
 */

/**
 * @typedef {Object} PreparedMesh
 * @property {Float64Array} v flat welded vertices in mm
 * @property {Int32Array} f flat faces (consistently wound, outward when closed)
 * @property {Int32Array} vertexMap input vertex -> welded vertex
 * @property {Int32Array} faceMap input face -> prepared face (-1 if dropped)
 * @property {number} flippedFaces faces whose winding was reversed
 * @property {boolean} inverted whether the whole mesh was turned inside out
 */

/**
 * Weld exact-duplicate vertices, drop unreferenced vertices and
 * index-degenerate faces, convert to mm and fix the face winding.
 * @param {ArrayLike<number>} positions flat (n,3)
 * @param {ArrayLike<number>} indices flat (m,3)
 * @param {number} [unitFactor=1] multiply coordinates by this to get mm
 * @returns {PreparedMesh}
 */
export function prepareMesh(positions, indices, unitFactor = 1) {
    const n = positions.length / 3;
    const key = (i) => `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
    // referenced vertices, welded by exact position; first occurrence keeps the slot
    const used = new Uint8Array(n);
    for (let x = 0; x < indices.length; x++) used[indices[x]] = 1;
    const seen = new Map();
    const vertexMap = new Int32Array(n).fill(-1);
    const keep = [];
    for (let i = 0; i < n; i++) {
        if (!used[i]) continue;
        const k = key(i);
        let j = seen.get(k);
        if (j === undefined) { j = keep.length; seen.set(k, j); keep.push(i); }
        vertexMap[i] = j;
    }
    // unreferenced input vertices still get a welded id when they coincide with one
    for (let i = 0; i < n; i++) {
        if (vertexMap[i] < 0) {
            const j = seen.get(key(i));
            if (j !== undefined) vertexMap[i] = j;
        }
    }
    const v = new Float64Array(3 * keep.length);
    for (let j = 0; j < keep.length; j++) {
        for (let k = 0; k < 3; k++) v[3 * j + k] = positions[3 * keep[j] + k] * unitFactor;
    }
    const m = indices.length / 3;
    const faceMap = new Int32Array(m).fill(-1);
    const fl = [];
    for (let t = 0; t < m; t++) {
        const a = vertexMap[indices[3 * t]], b = vertexMap[indices[3 * t + 1]], c = vertexMap[indices[3 * t + 2]];
        if (a === b || b === c || a === c) continue;
        faceMap[t] = fl.length / 3;
        fl.push(a, b, c);
    }
    const f = Int32Array.from(fl);
    const { flipped, inverted } = fixWinding(v, f);
    return { v, f, vertexMap, faceMap, flippedFaces: flipped, inverted };
}

/**
 * Make the winding consistent across each edge-connected component (BFS from
 * the lowest face id, as trimesh.repair.fix_winding), then turn the mesh
 * inside out if its signed volume is negative. In place.
 *
 * Deviation: trimesh only inverts watertight meshes; here the signed volume
 * decides for open meshes too (scans are nearly closed, and inward winding
 * flips the curvature sign and breaks crest detection).
 * @param {Float64Array} v
 * @param {Int32Array} f
 * @returns {{flipped: number, inverted: boolean}}
 */
export function fixWinding(v, f) {
    const nf = f.length / 3;
    const nv = v.length / 3;
    // directed half-edge lookup: key a*nv+b -> list of faces using a->b or b->a
    const edgeFaces = new Map();
    for (let t = 0; t < nf; t++) {
        for (let k = 0; k < 3; k++) {
            const a = f[3 * t + k], b = f[3 * t + (k + 1) % 3];
            const ek = a < b ? a * nv + b : b * nv + a;
            const l = edgeFaces.get(ek);
            if (l) l.push(t); else edgeFaces.set(ek, [t]);
        }
    }
    const hasDirected = (t, a, b) => {
        for (let k = 0; k < 3; k++) if (f[3 * t + k] === a && f[3 * t + (k + 1) % 3] === b) return true;
        return false;
    };
    const visited = new Uint8Array(nf);
    let flipped = 0;
    const queue = new Int32Array(nf);
    for (let s = 0; s < nf; s++) {
        if (visited[s]) continue;
        visited[s] = 1;
        let qh = 0, qt = 0;
        queue[qt++] = s;
        while (qh < qt) {
            const t = queue[qh++];
            for (let k = 0; k < 3; k++) {
                const a = f[3 * t + k], b = f[3 * t + (k + 1) % 3];
                const ek = a < b ? a * nv + b : b * nv + a;
                const l = edgeFaces.get(ek);
                if (l.length !== 2) continue;                 // boundary / non-manifold
                const u = l[0] === t ? l[1] : l[0];
                if (visited[u]) continue;
                visited[u] = 1;
                // consistent neighbours traverse the shared edge as b->a
                if (hasDirected(u, a, b)) {
                    const x = f[3 * u + 1]; f[3 * u + 1] = f[3 * u + 2]; f[3 * u + 2] = x;
                    flipped++;
                }
                queue[qt++] = u;
            }
        }
    }
    let vol = 0;
    for (let t = 0; t < nf; t++) {
        const a = 3 * f[3 * t], b = 3 * f[3 * t + 1], c = 3 * f[3 * t + 2];
        vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
             - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
             + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    const inverted = vol < 0;
    if (inverted) {
        for (let t = 0; t < nf; t++) { const x = f[3 * t + 1]; f[3 * t + 1] = f[3 * t + 2]; f[3 * t + 2] = x; }
    }
    return { flipped, inverted };
}

let simplifierPromise = null;
/** Lazily load meshoptimizer's simplifier (wasm embedded in the JS module). */
async function loadSimplifier() {
    if (!simplifierPromise) {
        simplifierPromise = import('meshoptimizer/simplifier').then(async (mod) => {
            await mod.MeshoptSimplifier.ready;
            return mod.MeshoptSimplifier;
        });
    }
    return simplifierPromise;
}

/**
 * Quadric-error decimation to `targetFaces` with meshoptimizer's
 * simplifyWithUpdate (moves vertices to optimal positions, like trimesh's
 * quadric decimation). Unreferenced vertices are dropped; vertex order follows
 * the original ids. Returns the input unchanged when it is small enough.
 * @param {Float64Array} v flat vertices
 * @param {Int32Array} f flat faces
 * @param {number} targetFaces
 * @returns {Promise<{v: Float64Array, f: Int32Array, decimated: boolean, error: number}>}
 */
export async function decimateMesh(v, f, targetFaces) {
    const nf = f.length / 3;
    if (!(targetFaces > 0) || nf <= targetFaces) return { v, f, decimated: false, error: 0 };
    const S = await loadSimplifier();
    const nv = v.length / 3;
    // work in float32 relative to the centroid (keeps precision for large offsets)
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < nv; i++) { cx += v[3 * i]; cy += v[3 * i + 1]; cz += v[3 * i + 2]; }
    cx /= nv; cy /= nv; cz /= nv;
    const pos = new Float32Array(3 * nv);
    for (let i = 0; i < nv; i++) {
        pos[3 * i] = v[3 * i] - cx; pos[3 * i + 1] = v[3 * i + 1] - cy; pos[3 * i + 2] = v[3 * i + 2] - cz;
    }
    const idx = Uint32Array.from(f);
    const [count, error] = S.simplifyWithUpdate(idx, pos, 3, new Float32Array(0), 0, [], null,
        3 * targetFaces, 1.0, []);
    const out = idx.subarray(0, count);
    const used = new Int32Array(nv).fill(-1);
    for (let x = 0; x < count; x++) used[out[x]] = 1;
    let nn = 0;
    for (let i = 0; i < nv; i++) if (used[i] > 0) used[i] = nn++;
    const v2 = new Float64Array(3 * nn);
    for (let i = 0; i < nv; i++) {
        const j = used[i];
        if (j < 0) continue;
        v2[3 * j] = pos[3 * i] + cx; v2[3 * j + 1] = pos[3 * i + 1] + cy; v2[3 * j + 2] = pos[3 * i + 2] + cz;
    }
    const f2 = new Int32Array(count);
    for (let x = 0; x < count; x++) f2[x] = used[out[x]];
    fixWinding(v2, f2);
    return { v: v2, f: f2, decimated: true, error };
}

/**
 * Symmetric 3x3 eigen-decomposition (cyclic Jacobi); eigenvectors as columns of V.
 */
function eig3(A) {
    const a = A.slice();
    const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let sweep = 0; sweep < 60; sweep++) {
        const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
        if (off < 1e-300) break;
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
            const apq = a[3 * p + q];
            if (apq === 0) continue;
            const theta = (a[3 * q + q] - a[3 * p + p]) / (2 * apq);
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < 3; k++) {
                const akp = a[3 * k + p], akq = a[3 * k + q];
                a[3 * k + p] = c * akp - s * akq; a[3 * k + q] = s * akp + c * akq;
            }
            for (let k = 0; k < 3; k++) {
                const apk = a[3 * p + k], aqk = a[3 * q + k];
                a[3 * p + k] = c * apk - s * aqk; a[3 * q + k] = s * apk + c * aqk;
            }
            for (let k = 0; k < 3; k++) {
                const vkp = V[3 * k + p], vkq = V[3 * k + q];
                V[3 * k + p] = c * vkp - s * vkq; V[3 * k + q] = s * vkp + c * vkq;
            }
        }
    }
    return { w: [a[0], a[4], a[8]], V };
}

/**
 * PCA pose (Common/reorientmesh.m via mesh_utils.reorient_mesh): centre,
 * rotate the principal axis onto X, and put the pointed end at +X.
 * Segmentation is rotation invariant; the pose only fixes the mesh length
 * (X extent) that scales the clustering radii.
 * @param {Float64Array} v flat vertices
 * @returns {Float64Array} new flat vertices
 */
export function reorientMesh(v) {
    const n = v.length / 3;
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mean[k] += v[3 * i + k];
    for (let k = 0; k < 3; k++) mean[k] /= n;
    const C = new Array(9).fill(0);
    for (let i = 0; i < n; i++) {
        const x = [v[3 * i] - mean[0], v[3 * i + 1] - mean[1], v[3 * i + 2] - mean[2]];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[3 * r + c] += x[r] * x[c];
    }
    for (let k = 0; k < 9; k++) C[k] /= Math.max(1, n - 1);
    const { w, V } = eig3(C);
    const order = [0, 1, 2].sort((p, q) => w[q] - w[p]);      // descending variance
    const col = (j) => [V[order[j]], V[3 + order[j]], V[6 + order[j]]];
    const e0 = col(0), e1 = col(1);
    let e2 = col(2);
    const det = e0[0] * (e1[1] * e2[2] - e1[2] * e2[1])
              - e1[0] * (e0[1] * e2[2] - e0[2] * e2[1])
              + e2[0] * (e0[1] * e1[2] - e0[2] * e1[1]);
    if (det < 0) e2 = e2.map(x => -x);
    const out = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
        const x = v[3 * i] - mean[0], y = v[3 * i + 1] - mean[1], z = v[3 * i + 2] - mean[2];
        out[3 * i] = x * e0[0] + y * e0[1] + z * e0[2];
        out[3 * i + 1] = x * e1[0] + y * e1[1] + z * e1[2];
        out[3 * i + 2] = x * e2[0] + y * e2[1] + z * e2[2];
    }
    let xmin = Infinity, xmax = -Infinity;
    for (let i = 0; i < n; i++) { const x = out[3 * i]; if (x < xmin) xmin = x; if (x > xmax) xmax = x; }
    const l = xmax - xmin;
    const ytop = xmax - l * 0.07, ybot = xmin + l * 0.07;
    let tmin = Infinity, tmax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (let i = 0; i < n; i++) {
        const x = out[3 * i], y = out[3 * i + 1];
        if (x > ytop) { if (y < tmin) tmin = y; if (y > tmax) tmax = y; }
        if (x < ybot) { if (y < bmin) bmin = y; if (y > bmax) bmax = y; }
    }
    if (tmax - tmin > bmax - bmin) {
        for (let i = 0; i < n; i++) { out[3 * i] = -out[3 * i]; out[3 * i + 1] = -out[3 * i + 1]; }
    }
    return out;
}

/** Mesh length along X after reorientMesh (used for diagnostics). */
export function xExtent(v) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < v.length; i += 3) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
    return hi - lo;
}
