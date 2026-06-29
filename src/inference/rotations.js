// Canonical view rotations — port of utils.py:generate_canonical_rotation_matrices.
// Production config is n_angles=(6, 6, 6) -> (n_x, n_y, n_z): evenly-spaced rotations
// about the longest (X), middle (Y) and shortest (Z) PCA axes, with duplicate views
// removed. For (6,6,6) this yields 10 matrices (6 about X, 4 about Y; the redundant
// Y views and all in-plane Z views are filtered). A single int n is accepted as
// (n, 0, 0) for backward compatibility.
//
// Returns an array of 3x3 row-major matrices (Float64). Applied as v' = R @ v.

const DEG = Math.PI / 180;

/** Row-major 3x3 rotation about the X axis, matching the Python matrix. */
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0,  0, c, -s,  0, s, c];
}
/** Row-major 3x3 rotation about the Y axis, matching the Python matrix. */
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s,  0, 1, 0,  -s, 0, c];
}
/** Row-major 3x3 rotation about the Z axis, matching the Python matrix. */
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0,  s, c, 0,  0, 0, 1];
}

/** out = A^T @ B for row-major 3x3 (= relative rotation R_kept.inv() * R, scipy convention). */
function relMatrix(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      // A^T[r][k] = A[k][r] = A[3*k + r]
      out[3 * r + col] = A[r] * B[col] + A[3 + r] * B[3 + col] + A[6 + r] * B[6 + col];
    }
  }
  return out;
}

/** Geodesic angle in [0,pi] and unit rotation axis of a row-major 3x3 rotation. */
function angleAxis(m) {
  const R00 = m[0], R01 = m[1], R02 = m[2];
  const R10 = m[3], R11 = m[4], R12 = m[5];
  const R20 = m[6], R21 = m[7], R22 = m[8];
  // Robust matrix -> quaternion (Shepperd), so the axis is stable even near angle = pi.
  const t = R00 + R11 + R22;
  let w, x, y, z, S;
  if (t > 0) {
    S = Math.sqrt(t + 1) * 2;
    w = 0.25 * S; x = (R21 - R12) / S; y = (R02 - R20) / S; z = (R10 - R01) / S;
  } else if (R00 > R11 && R00 > R22) {
    S = Math.sqrt(1 + R00 - R11 - R22) * 2;
    w = (R21 - R12) / S; x = 0.25 * S; y = (R01 + R10) / S; z = (R02 + R20) / S;
  } else if (R11 > R22) {
    S = Math.sqrt(1 + R11 - R00 - R22) * 2;
    w = (R02 - R20) / S; x = (R01 + R10) / S; y = 0.25 * S; z = (R12 + R21) / S;
  } else {
    S = Math.sqrt(1 + R22 - R00 - R11) * 2;
    w = (R10 - R01) / S; x = (R02 + R20) / S; y = (R12 + R21) / S; z = 0.25 * S;
  }
  const sinHalf = Math.hypot(x, y, z);
  const angle = 2 * Math.atan2(sinHalf, Math.abs(w)); // [0, pi]
  let axis = [0, 0, 0];
  if (sinHalf > 1e-12) axis = [x / sinHalf, y / sinHalf, z / sinHalf];
  return { angle, axis };
}

// Filter thresholds mirror the Python implementation.
const ANGLE_THRESHOLD = 1.0 * DEG;        // ~same rotation
const AXIS_ALIGN_THRESHOLD = 0.05;        // relative rotation is purely about Z (same 2D projection)

/**
 * Canonical rotation matrices, matching generate_canonical_rotation_matrices.
 * @param {number|number[]} nAngles single int -> (n,0,0), or [n_x, n_y, n_z].
 * @returns {number[][]} array of length-9 row-major matrices (post duplicate-filter).
 */
export function canonicalRotations(nAngles) {
  let nx, ny, nz;
  if (typeof nAngles === 'number') {
    [nx, ny, nz] = [nAngles, 0, 0];
  } else {
    [nx = 0, ny = 0, nz = 0] = nAngles;
  }

  const candidates = [];
  const push = (n, rot) => {
    for (let i = 0; i < n; i++) candidates.push(rot((2 * Math.PI * i) / n));
  };
  push(nx, rotX); // longest axis (X)
  push(ny, rotY); // middle axis (Y)
  push(nz, rotZ); // shortest axis (Z)

  if (candidates.length <= 1) return candidates;

  // Remove duplicate views: same rotation, or relative rotation purely about Z
  // (identical 2D projection up to in-plane rotation).
  const kept = [];
  for (const cand of candidates) {
    let isDup = false;
    for (const k of kept) {
      const { angle, axis } = angleAxis(relMatrix(k, cand));
      if (angle < ANGLE_THRESHOLD || angle > 2 * Math.PI - ANGLE_THRESHOLD) { isDup = true; break; }
      if (Math.abs(axis[0]) < AXIS_ALIGN_THRESHOLD &&
          Math.abs(axis[1]) < AXIS_ALIGN_THRESHOLD &&
          Math.abs(Math.abs(axis[2]) - 1.0) < AXIS_ALIGN_THRESHOLD) { isDup = true; break; }
    }
    if (!isDup) kept.push(cand);
  }
  return kept;
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
