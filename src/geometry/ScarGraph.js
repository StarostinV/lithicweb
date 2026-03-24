/**
 * Scar adjacency graph from segmented mesh annotation.
 *
 * Builds a graph where nodes are scars (contiguous segments) and edges
 * represent shared boundaries between adjacent scars. Computes dihedral
 * angle statistics (sharpness, roughness) along each boundary for
 * downstream analysis.
 *
 * Pipeline:
 * 1. Erode annotation edges — assign every edge vertex to a neighboring segment
 * 2. Identify scars from connected vertex labels
 * 3. Build adjacency by finding vertices whose neighbors have different labels
 * 4. Compute boundary roughness from dihedral angles
 *
 * No THREE.js dependencies. Uses typed arrays for performance on large meshes.
 *
 * @module geometry/ScarGraph
 */

import { edgeKey } from './edgeAngles.js';


// ============== Edge Erosion ==============

/**
 * Fully erode annotation edges by iteratively assigning each edge vertex
 * to the most common neighboring segment label. Continues until no edge
 * vertices (label 0) remain, or no further progress can be made.
 *
 * @param {Array|Int32Array} faceLabels - Per-vertex segment labels (1-indexed, 0 = edge vertex)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency (vertexIndex -> Set of neighbor vertices)
 * @param {number} vertexCount - Total number of vertices
 * @returns {{workingLabels: Int32Array, remainingEdges: Set<number>}}
 *   - workingLabels: Updated per-vertex labels with all edges assigned to segments
 *   - remainingEdges: Any vertices that could not be assigned (pathological cases only)
 */
export function erodeEdges(faceLabels, edgeIndices, adjacencyGraph, vertexCount) {
    const workingLabels = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        workingLabels[i] = faceLabels[i];
    }

    const remainingEdges = new Set(edgeIndices);

    while (remainingEdges.size > 0) {
        const toAssign = [];

        for (const v of remainingEdges) {
            // Count how many non-edge neighbors have each label
            const neighborCounts = new Map();
            const neighbors = adjacencyGraph.get(v);
            if (neighbors) {
                for (const n of neighbors) {
                    if (!remainingEdges.has(n) && workingLabels[n] > 0) {
                        neighborCounts.set(workingLabels[n], (neighborCounts.get(workingLabels[n]) || 0) + 1);
                    }
                }
            }

            if (neighborCounts.size >= 1) {
                // Pick the most common neighbor label
                let bestLabel = 0, bestCount = 0;
                for (const [label, count] of neighborCounts) {
                    if (count > bestCount) {
                        bestCount = count;
                        bestLabel = label;
                    }
                }
                toAssign.push({ vertex: v, label: bestLabel });
            }
        }

        if (toAssign.length === 0) break; // no progress — stop

        for (const { vertex, label } of toAssign) {
            workingLabels[vertex] = label;
            remainingEdges.delete(vertex);
        }
    }

    return { workingLabels, remainingEdges };
}


// ============== Scar Identification ==============

/**
 * Group vertices by their working labels and assign sequential scar IDs.
 * Scars are sorted by minimum vertex index ascending.
 *
 * @param {Int32Array} workingLabels - Per-vertex segment labels (0 = unassigned)
 * @param {number} vertexCount - Total number of vertices
 * @returns {Array<{scarId: number, representativeVertex: number, vertexCount: number, originalLabel: number}>}
 */
function identifyScars(workingLabels, vertexCount) {
    const labelGroups = new Map();
    for (let v = 0; v < vertexCount; v++) {
        const label = workingLabels[v];
        if (label === 0) continue;
        if (!labelGroups.has(label)) {
            labelGroups.set(label, { minVertex: v, count: 0, label });
        }
        const group = labelGroups.get(label);
        if (v < group.minVertex) {
            group.minVertex = v;
        }
        group.count++;
    }

    const groups = Array.from(labelGroups.values());
    // Sort by size descending (largest scar = scarId 0), tie-break by minVertex
    groups.sort((a, b) => b.count - a.count || a.minVertex - b.minVertex);

    return groups.map((g, idx) => ({
        scarId: idx,
        representativeVertex: g.minVertex,
        vertexCount: g.count,
        originalLabel: g.label,
    }));
}


// ============== Scar Adjacency ==============

/**
 * Build adjacency edges between scars by finding vertices whose neighbors
 * have different labels. Also identifies boundary vertices for roughness
 * computation.
 *
 * @param {Int32Array} workingLabels - Per-vertex segment labels (fully assigned)
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {Array<{scarId: number, originalLabel: number}>} scars - Scar definitions
 * @param {number} vertexCount - Total number of vertices
 * @returns {{adjacency: Array<{scarA: number, scarB: number, boundaryVertices: Set<number>}>, boundaryVertices: Set<number>}}
 */
function buildScarAdjacency(workingLabels, adjacencyGraph, scars, vertexCount) {
    const labelToScarId = new Map();
    for (const scar of scars) {
        labelToScarId.set(scar.originalLabel, scar.scarId);
    }

    const pairMap = new Map();
    const allBoundaryVertices = new Set();

    for (let v = 0; v < vertexCount; v++) {
        const labelV = workingLabels[v];
        if (labelV === 0) continue;
        const scarIdV = labelToScarId.get(labelV);
        if (scarIdV === undefined) continue;

        const neighbors = adjacencyGraph.get(v);
        if (!neighbors) continue;

        let isBoundary = false;
        for (const n of neighbors) {
            const labelN = workingLabels[n];
            if (labelN > 0 && labelN !== labelV) {
                isBoundary = true;
                const scarIdN = labelToScarId.get(labelN);
                if (scarIdN === undefined) continue;

                const a = Math.min(scarIdV, scarIdN);
                const b = Math.max(scarIdV, scarIdN);
                const key = `${a}_${b}`;
                if (!pairMap.has(key)) {
                    pairMap.set(key, { scarA: a, scarB: b, boundaryVertices: new Set() });
                }
                pairMap.get(key).boundaryVertices.add(v);
            }
        }
        if (isBoundary) allBoundaryVertices.add(v);
    }

    return {
        adjacency: Array.from(pairMap.values()),
        boundaryVertices: allBoundaryVertices,
    };
}


// ============== Face Normal Computation ==============

/**
 * Compute the unit normal of a triangle face.
 */
function computeFaceNormal(positions, v0, v1, v2) {
    const ax = positions[v0 * 3], ay = positions[v0 * 3 + 1], az = positions[v0 * 3 + 2];
    const bax = positions[v1 * 3] - ax, bay = positions[v1 * 3 + 1] - ay, baz = positions[v1 * 3 + 2] - az;
    const cax = positions[v2 * 3] - ax, cay = positions[v2 * 3 + 1] - ay, caz = positions[v2 * 3 + 2] - az;
    const nx = bay * caz - baz * cay;
    const ny = baz * cax - bax * caz;
    const nz = bax * cay - bay * cax;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-10) return [nx / len, ny / len, nz / len];
    return [0, 0, 0];
}


// ============== Boundary Roughness ==============

/**
 * Classify a face by majority vote of its 3 vertices' working labels.
 */
function majorityLabel(workingLabels, v0, v1, v2) {
    const a = workingLabels[v0];
    const b = workingLabels[v1];
    const c = workingLabels[v2];

    const counts = new Map();
    if (a > 0) counts.set(a, (counts.get(a) || 0) + 1);
    if (b > 0) counts.set(b, (counts.get(b) || 0) + 1);
    if (c > 0) counts.set(c, (counts.get(c) || 0) + 1);

    if (counts.size === 0) return 0;

    let bestLabel = 0;
    let bestCount = 0;
    for (const [label, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
        }
    }
    return bestLabel;
}

/**
 * Compute dihedral angle statistics along each scar adjacency boundary.
 * Mutates the edges array in place to add sharpness, roughness, and boundarySize.
 */
function computeBoundaryRoughness(edges, workingLabels, positions, indices) {
    const faceCount = indices.length / 3;

    const allBoundaryVertices = new Set();
    for (const edge of edges) {
        for (const v of edge.boundaryVertices) {
            allBoundaryVertices.add(v);
        }
    }

    if (allBoundaryVertices.size === 0) {
        for (const edge of edges) {
            edge.sharpness = 0;
            edge.roughness = 0;
            edge.boundarySize = 0;
        }
        return;
    }

    const vertexToFaces = new Map();
    const faceClassifications = new Int32Array(faceCount);

    for (let f = 0; f < faceCount; f++) {
        const base = f * 3;
        const v0 = indices[base];
        const v1 = indices[base + 1];
        const v2 = indices[base + 2];

        const incident = allBoundaryVertices.has(v0) ||
                          allBoundaryVertices.has(v1) ||
                          allBoundaryVertices.has(v2);

        if (incident) {
            const verts = [v0, v1, v2];
            for (const v of verts) {
                if (!vertexToFaces.has(v)) {
                    vertexToFaces.set(v, []);
                }
                vertexToFaces.get(v).push(f);
            }
        }

        faceClassifications[f] = majorityLabel(workingLabels, v0, v1, v2);
    }

    for (const edge of edges) {
        const candidateFaces = new Set();
        for (const v of edge.boundaryVertices) {
            const faces = vertexToFaces.get(v);
            if (faces) {
                for (const f of faces) {
                    candidateFaces.add(f);
                }
            }
        }

        const meshEdgeToFaces = new Map();
        for (const f of candidateFaces) {
            const base = f * 3;
            const v0 = indices[base];
            const v1 = indices[base + 1];
            const v2 = indices[base + 2];

            const meshEdges = [
                edgeKey(v0, v1),
                edgeKey(v1, v2),
                edgeKey(v2, v0),
            ];

            for (const key of meshEdges) {
                if (!meshEdgeToFaces.has(key)) {
                    meshEdgeToFaces.set(key, [f]);
                } else {
                    meshEdgeToFaces.get(key).push(f);
                }
            }
        }

        const dihedralAngles = [];

        for (const [, faces] of meshEdgeToFaces) {
            if (faces.length !== 2) continue;
            const f1 = faces[0];
            const f2 = faces[1];
            const seg1 = faceClassifications[f1];
            const seg2 = faceClassifications[f2];

            if (seg1 === seg2 || seg1 === 0 || seg2 === 0) continue;

            const base1 = f1 * 3;
            const n1 = computeFaceNormal(positions, indices[base1], indices[base1 + 1], indices[base1 + 2]);
            const base2 = f2 * 3;
            const n2 = computeFaceNormal(positions, indices[base2], indices[base2 + 1], indices[base2 + 2]);

            const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
            const clampedDot = Math.max(-1, Math.min(1, dot));
            const angle = Math.acos(clampedDot);
            dihedralAngles.push(angle);
        }

        if (dihedralAngles.length > 0) {
            let sum = 0;
            for (let i = 0; i < dihedralAngles.length; i++) {
                sum += dihedralAngles[i];
            }
            const mean = sum / dihedralAngles.length;

            let varianceSum = 0;
            for (let i = 0; i < dihedralAngles.length; i++) {
                const diff = dihedralAngles[i] - mean;
                varianceSum += diff * diff;
            }
            const stdDev = Math.sqrt(varianceSum / dihedralAngles.length);

            edge.sharpness = mean;
            edge.roughness = stdDev;
            edge.boundarySize = dihedralAngles.length;
        } else {
            edge.sharpness = 0;
            edge.roughness = 0;
            edge.boundarySize = 0;
        }
    }
}


// ============== Main Entry Point ==============

/**
 * Build a scar adjacency graph from a segmented mesh annotation.
 *
 * Orchestrates edge erosion, scar identification, adjacency construction,
 * and boundary roughness computation.
 *
 * @param {Array|Int32Array} faceLabels - Per-vertex segment labels (1-indexed, 0 = edge vertex)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency (vertexIndex -> Set of neighbor vertices)
 * @param {number} vertexCount - Total number of vertices
 * @param {Float32Array|number[]} positions - Flat vertex positions [x0,y0,z0, x1,y1,z1, ...]
 * @param {Uint32Array|number[]} indices - Flat triangle indices [i0,i1,i2, ...]
 * @returns {{
 *   scars: Array<{scarId: number, representativeVertex: number, vertexCount: number}>,
 *   edges: Array<{scarA: number, scarB: number, sharpness: number, roughness: number, boundarySize: number}>,
 *   workingLabels: Int32Array,
 *   boundaryVertices: Set<number>
 * }}
 */
export function buildScarGraph(faceLabels, edgeIndices, adjacencyGraph, vertexCount, positions, indices) {
    // Step 1: Fully erode annotation edges
    const { workingLabels, remainingEdges } = erodeEdges(faceLabels, edgeIndices, adjacencyGraph, vertexCount);

    // Step 2: Identify scars from working labels
    const scars = identifyScars(workingLabels, vertexCount);

    // Step 3: Build adjacency by scanning for label boundaries
    const { adjacency: edges, boundaryVertices } = buildScarAdjacency(
        workingLabels, adjacencyGraph, scars, vertexCount
    );

    // Step 4: Compute boundary roughness statistics
    computeBoundaryRoughness(edges, workingLabels, positions, indices);

    // Step 5: Strip internal fields from output
    return {
        scars: scars.map(({ scarId, representativeVertex, vertexCount, originalLabel }) => ({
            scarId,
            representativeVertex,
            vertexCount,
            originalLabel,
        })),
        edges: edges.map(({ scarA, scarB, sharpness, roughness, boundarySize }) => ({
            scarA,
            scarB,
            sharpness,
            roughness,
            boundarySize,
        })),
        workingLabels,
        boundaryVertices,
    };
}
