// Per-face geometry features used by the renderer and the max_angles input channel.
// Ports neurolithic_light/utils.py:calc_face_normals and preprocess.py:neighbor_angles.

/**
 * Flat per-face unit normals: cross(v1-v0, v2-v0), normalized.
 * @param {Float32Array} verts flat (V,3)
 * @param {Int32Array} faces flat (nF,3)
 * @returns {Float32Array} flat (nF,3)
 */
export function computeFaceNormals(verts, faces, eps = 1e-12) {
  const nF = faces.length / 3;
  const out = new Float32Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    const a = faces[3*f], b = faces[3*f+1], c = faces[3*f+2];
    const e1x = verts[3*b]-verts[3*a], e1y = verts[3*b+1]-verts[3*a+1], e1z = verts[3*b+2]-verts[3*a+2];
    const e2x = verts[3*c]-verts[3*a], e2y = verts[3*c+1]-verts[3*a+1], e2z = verts[3*c+2]-verts[3*a+2];
    let nx = e1y*e2z - e1z*e2y, ny = e1z*e2x - e1x*e2z, nz = e1x*e2y - e1y*e2x;
    const len = Math.hypot(nx, ny, nz) + eps;
    out[3*f] = nx/len; out[3*f+1] = ny/len; out[3*f+2] = nz/len;
  }
  return out;
}

/**
 * max_angles input channel = exp(-max dihedral angle to the (up to 3) face neighbors).
 * Mirrors preprocess_data: np.exp(-neighbor_angles(...)['max_angles']), oriented normals,
 * nanmax over neighbors (boundary edges ignored).
 * @param {Float32Array} normals flat (nF,3)
 * @param {Int32Array} faceAdjFlat flat (nF,3), -1 = boundary
 * @returns {Float32Array} (nF,)
 */
export function computeMaxAngles(normals, faceAdjFlat) {
  const nF = normals.length / 3;
  const out = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    const nx = normals[3*f], ny = normals[3*f+1], nz = normals[3*f+2];
    let maxAngle = NaN;
    for (let e = 0; e < 3; e++) {
      const nb = faceAdjFlat[3*f + e];
      if (nb < 0) continue;
      let dot = nx*normals[3*nb] + ny*normals[3*nb+1] + nz*normals[3*nb+2];
      if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
      const ang = Math.acos(dot);
      if (Number.isNaN(maxAngle) || ang > maxAngle) maxAngle = ang;
    }
    // exp(-nanmax); isolated faces (no neighbors) -> angle 0 -> 1 (closed meshes have none).
    out[f] = Math.exp(-(Number.isNaN(maxAngle) ? 0 : maxAngle));
  }
  return out;
}
