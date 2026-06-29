// Canonical view rotations — port of utils.py:generate_canonical_rotation_matrices.
// Production config is n_angles=6 -> (n_x, n_y, n_z) = (6, 0, 0): n evenly-spaced
// rotations about the longest PCA axis (X). For the (n,0,0) case the duplicate
// filter is a no-op, so it is omitted here.
//
// Returns an array of 3x3 row-major matrices (Float64). Applied as v' = R @ v.

/** @param {number} nAngles @returns {number[][]} array of length-9 row-major matrices */
export function canonicalRotations(nAngles) {
  const mats = [];
  for (let i = 0; i < nAngles; i++) {
    const angle = (2 * Math.PI * i) / nAngles; // linspace(0,2pi,n,endpoint=False)
    const c = Math.cos(angle), s = Math.sin(angle);
    // Rotation about X (rotates Y-Z plane), matching the Python matrix.
    mats.push([
      1, 0, 0,
      0, c, -s,
      0, s, c,
    ]);
  }
  return mats;
}

/** Apply a row-major 3x3 R to flat (V,3) verts: out[i] = R @ v[i] (scipy Rotation.apply). */
export function applyRotation(verts, R) {
  const n = verts.length / 3;
  const out = new Float32Array(verts.length);
  for (let i = 0; i < n; i++) {
    const x = verts[3*i], y = verts[3*i+1], z = verts[3*i+2];
    out[3*i]   = R[0]*x + R[1]*y + R[2]*z;
    out[3*i+1] = R[3]*x + R[4]*y + R[5]*z;
    out[3*i+2] = R[6]*x + R[7]*y + R[8]*z;
  }
  return out;
}
