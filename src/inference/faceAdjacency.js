// Face adjacency — port of neurolithic_light/utils.py:calc_face_adjacency
// (general edge-grouping variant; correct for closed and open/non-manifold meshes).
//
// Returns a flat Int32Array of length nF*3 where entry f*3+i is the face sharing
// edge i of face f, or -1 if none. Edge i is (v_{i+1}, v_{i+2}):
//   edge 0 = (v1,v2), edge 1 = (v2,v0), edge 2 = (v0,v1).
// This is the `faceAdjacencyFlat` consumed by faceUnionFind.js and backProject gamma.
//
// @param {Int32Array} faces flat (nF,3)
// @returns {Int32Array} flat (nF,3)
export function calcFaceAdjacency(faces) {
  const nF = faces.length / 3;
  const nE = 3 * nF;
  // Directed edges: per face, edge0=(v1,v2), edge1=(v2,v0), edge2=(v0,v1).
  const ea = new Int32Array(nE);   // endpoint a
  const eb = new Int32Array(nE);   // endpoint b
  const ef = new Int32Array(nE);   // face
  const el = new Int32Array(nE);   // local edge id
  let maxV = 0;
  for (let f = 0; f < nF; f++) {
    const v0 = faces[3*f], v1 = faces[3*f+1], v2 = faces[3*f+2];
    if (v0 > maxV) maxV = v0; if (v1 > maxV) maxV = v1; if (v2 > maxV) maxV = v2;
    const pairs = [[v1, v2, 0], [v2, v0, 1], [v0, v1, 2]];
    for (let j = 0; j < 3; j++) {
      const idx = 3*f + j;
      const [p, q, lid] = pairs[j];
      ea[idx] = Math.min(p, q);   // undirected: sorted endpoints
      eb[idx] = Math.max(p, q);
      ef[idx] = f;
      el[idx] = lid;
    }
  }
  // Pack undirected key = a*(maxV+1) + b, sort to group identical edges.
  const stride = maxV + 1;
  const order = Array.from({ length: nE }, (_, i) => i);
  order.sort((i, j) => {
    const ki = ea[i] * stride + eb[i];
    const kj = ea[j] * stride + eb[j];
    return ki - kj;
  });

  const N = new Int32Array(nF * 3).fill(-1);
  // Walk sorted edges; pair up runs of equal undirected key of length exactly 2.
  let run = 0;
  while (run < nE) {
    let end = run + 1;
    const ka = ea[order[run]], kb = eb[order[run]];
    while (end < nE && ea[order[end]] === ka && eb[order[end]] === kb) end++;
    if (end - run === 2) {
      const i1 = order[run], i2 = order[run + 1];
      N[ef[i1] * 3 + el[i1]] = ef[i2];
      N[ef[i2] * 3 + el[i2]] = ef[i1];
    }
    run = end;
  }
  return N;
}
