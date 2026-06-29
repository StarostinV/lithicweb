// PCA canonical alignment — port of neurolithic_light/utils.py:compute_pca_axes.
// Centers vertices, projects onto principal axes (longest -> X, shortest -> Z),
// and matches scikit-learn's deterministic sign convention (svd_flip, u_based_decision):
// each axis is signed so the vertex with the largest |projection| projects positive.
//
// sklearn computes SVD of the centered data; we equivalently eigendecompose the 3x3
// covariance (Jacobi), which is exact for well-separated axes and matches to ~1e-6.

// Cyclic Jacobi eigendecomposition of a symmetric 3x3 matrix.
// Returns { values: [l0,l1,l2], vectors: [[v0],[v1],[v2]] } with columns = eigenvectors.
function jacobiEigen3(A) {
  const a = [A[0][0], A[1][1], A[2][2]];
  const off = [A[0][1], A[0][2], A[1][2]]; // (01,02,12)
  // V starts as identity (columns are eigenvectors)
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const m = [[a[0], off[0], off[1]], [off[0], a[1], off[2]], [off[1], off[2], a[2]]];

  for (let sweep = 0; sweep < 50; sweep++) {
    const offNorm = Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]);
    if (offNorm < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(m[p][q]) < 1e-300) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      // Rotate m
      for (let k = 0; k < 3; k++) {
        const mkp = m[k][p], mkq = m[k][q];
        m[k][p] = c * mkp - s * mkq;
        m[k][q] = s * mkp + c * mkq;
      }
      for (let k = 0; k < 3; k++) {
        const mpk = m[p][k], mqk = m[q][k];
        m[p][k] = c * mpk - s * mqk;
        m[q][k] = s * mpk + c * mqk;
      }
      // Accumulate rotation into V
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq;
        V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [m[0][0], m[1][1], m[2][2]], vectors: V };
}

/**
 * @param {Float32Array|Float64Array} verts flat (V,3)
 * @returns {Float32Array} aligned vertices, flat (V,3)
 */
export function computePcaAxes(verts) {
  const n = verts.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += verts[3*i]; cy += verts[3*i+1]; cz += verts[3*i+2]; }
  cx /= n; cy /= n; cz /= n;

  // Covariance (symmetric 3x3) of centered data.
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const x = verts[3*i] - cx, y = verts[3*i+1] - cy, z = verts[3*i+2] - cz;
    xx += x*x; xy += x*y; xz += x*z; yy += y*y; yz += y*z; zz += z*z;
  }
  const C = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const { values, vectors } = jacobiEigen3(C);

  // Sort axes by descending eigenvalue (longest axis first -> X).
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  // Component vectors as rows (axes[k] = eigenvector for k-th largest eigenvalue).
  const axes = order.map(o => [vectors[0][o], vectors[1][o], vectors[2][o]]);

  // Project: transformed[:,k] = centered . axes[k]
  const out = new Float32Array(n * 3);
  // First pass: projections; track max |proj| index per axis for sign flip.
  const maxAbs = [0, 0, 0], maxSign = [1, 1, 1];
  for (let i = 0; i < n; i++) {
    const x = verts[3*i] - cx, y = verts[3*i+1] - cy, z = verts[3*i+2] - cz;
    for (let k = 0; k < 3; k++) {
      const p = x*axes[k][0] + y*axes[k][1] + z*axes[k][2];
      out[3*i+k] = p;
      const ap = Math.abs(p);
      if (ap > maxAbs[k]) { maxAbs[k] = ap; maxSign[k] = p < 0 ? -1 : 1; }
    }
  }
  // svd_flip: apply sign so the max-|proj| vertex is positive on each axis.
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) out[3*i+k] *= maxSign[k];

  return out;
}
