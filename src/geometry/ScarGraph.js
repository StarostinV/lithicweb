/**
 * Scar adjacency graph from segmented mesh annotation.
 *
 * Builds a graph where nodes are scars (contiguous segments) and edges
 * represent shared boundaries between adjacent scars. Computes dihedral
 * angle statistics (sharpness, roughness) along each boundary for
 * downstream analysis.
 *
 * Pipeline:
 * 1. Erode fat annotation edges to true segment boundaries
 * 2. Identify scars from connected vertex labels
 * 3. Build adjacency from remaining boundary vertices
 * 4. Compute boundary roughness from dihedral angles
 *
 * No THREE.js dependencies. Uses typed arrays for performance on large meshes.
 *
 * @module geometry/ScarGraph
 */

import { edgeKey } from './edgeAngles.js';


// ============== Edge Erosion ==============

/**
 * Erode "fat" annotation edges by iteratively peeling edge vertices
 * that touch only one segment. Remaining edge vertices touch 2+ segments
 * (true boundaries) or none.
 *
 * @param {Array|Int32Array} faceLabels - Per-vertex segment labels (1-indexed, 0 = edge vertex)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency (vertexIndex -> Set of neighbor vertices)
 * @param {number} vertexCount - Total number of vertices
 * @returns {{workingLabels: Int32Array, remainingEdges: Set<number>}}
 *   - workingLabels: Updated per-vertex labels with eroded edges assigned to segments
 *   - remainingEdges: Remaining true boundary vertices
 */
export function erodeEdges(faceLabels, edgeIndices, adjacencyGraph, vertexCount) {
    const workingLabels = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        workingLabels[i] = faceLabels[i];
    }

    const remainingEdges = new Set(edgeIndices);

    while (true) {
        const toAssign = [];

        for (const v of remainingEdges) {
            const neighborSegments = new Set();
            const neighbors = adjacencyGraph.get(v);
            if (neighbors) {
                for (const n of neighbors) {
                    if (!remainingEdges.has(n) && workingLabels[n] > 0) {
                        neighborSegments.add(workingLabels[n]);
                    }
                }
            }
            if (neighborSegments.size === 1) {
                const label = neighborSegments.values().next().value;
                toAssign.push({ vertex: v, label });
            }
        }

        if (toAssign.length === 0) break;

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
 * @param {Int32Array} workingLabels - Per-vertex segment labels (0 = boundary)
 * @param {number} vertexCount - Total number of vertices
 * @returns {Array<{scarId: number, representativeVertex: number, vertexCount: number, originalLabel: number}>}
 */
function identifyScars(workingLabels, vertexCount) {
    // Group vertices by label
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

    // Sort by minVertex ascending
    const groups = Array.from(labelGroups.values());
    groups.sort((a, b) => a.minVertex - b.minVertex);

    // Assign sequential scarIds
    return groups.map((g, idx) => ({
        scarId: idx,
        representativeVertex: g.minVertex,
        vertexCount: g.count,
        originalLabel: g.label,
    }));
}


// ============== Scar Adjacency ==============

/**
 * Build adjacency edges between scars from remaining boundary vertices.
 * A boundary vertex that touches 2+ different scars creates edges between
 * each pair.
 *
 * @param {Set<number>} remainingEdges - True boundary vertex indices
 * @param {Int32Array} workingLabels - Per-vertex segment labels
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {Array<{scarId: number, originalLabel: number}>} scars - Scar definitions
 * @returns {Array<{scarA: number, scarB: number, boundaryVertices: Set<number>}>}
 */
function buildScarAdjacency(remainingEdges, workingLabels, adjacencyGraph, scars) {
    // Build label → scarId lookup
    const labelToScarId = new Map();
    for (const scar of scars) {
        labelToScarId.set(scar.originalLabel, scar.scarId);
    }

    // Collect boundary pairs
    const pairMap = new Map(); // "scarA_scarB" -> { scarA, scarB, boundaryVertices }

    for (const v of remainingEdges) {
        const neighborScarIds = new Set();
        const neighbors = adjacencyGraph.get(v);
        if (neighbors) {
            for (const n of neighbors) {
                if (!remainingEdges.has(n)) {
                    const label = workingLabels[n];
                    if (label > 0 && labelToScarId.has(label)) {
                        neighborScarIds.add(labelToScarId.get(label));
                    }
                }
            }
        }

        if (neighborScarIds.size >= 2) {
            const ids = Array.from(neighborScarIds).sort((a, b) => a - b);
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = ids[i];
                    const b = ids[j];
                    const key = `${a}_${b}`;
                    if (!pairMap.has(key)) {
                        pairMap.set(key, { scarA: a, scarB: b, boundaryVertices: new Set() });
                    }
                    pairMap.get(key).boundaryVertices.add(v);
                }
            }
        }
    }

    return Array.from(pairMap.values());
}


// ============== Face Normal Computation ==============

/**
 * Compute the unit normal of a triangle face.
 *
 * @param {Float32Array|number[]} positions - Flat vertex positions [x0,y0,z0, x1,y1,z1, ...]
 * @param {number} v0 - First vertex index
 * @param {number} v1 - Second vertex index
 * @param {number} v2 - Third vertex index
 * @returns {number[]} Unit normal [nx, ny, nz], or [0,0,0] for degenerate triangles
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
 * Only non-zero labels are counted.
 *
 * @param {Int32Array} workingLabels - Per-vertex segment labels
 * @param {number} v0 - First vertex index
 * @param {number} v1 - Second vertex index
 * @param {number} v2 - Third vertex index
 * @returns {number} The most common non-zero label, or 0 if all are zero
 */
function majorityLabel(workingLabels, v0, v1, v2) {
    const a = workingLabels[v0];
    const b = workingLabels[v1];
    const c = workingLabels[v2];

    // Count occurrences of each non-zero label
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
 *
 * @param {Array<{scarA: number, scarB: number, boundaryVertices: Set<number>}>} edges - Adjacency edges
 * @param {Int32Array} workingLabels - Per-vertex segment labels
 * @param {Float32Array|number[]} positions - Flat vertex positions
 * @param {Uint32Array|number[]} indices - Flat triangle indices
 */
function computeBoundaryRoughness(edges, workingLabels, positions, indices) {
    const faceCount = indices.length / 3;

    // Step 1: Collect all boundary vertices across all edges
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

    // Step 2: Build vertex→faces map for vertices incident to boundary vertices
    // A face is relevant if any of its 3 vertices is a boundary vertex
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
            // Register this face for all three vertices
            const verts = [v0, v1, v2];
            for (const v of verts) {
                if (!vertexToFaces.has(v)) {
                    vertexToFaces.set(v, []);
                }
                vertexToFaces.get(v).push(f);
            }
        }

        // Step 3: Classify every face by majority vote
        faceClassifications[f] = majorityLabel(workingLabels, v0, v1, v2);
    }

    // Step 4: For each adjacency edge, compute dihedral angle statistics
    for (const edge of edges) {
        // 4a: Collect candidate faces (incident to any boundary vertex of this edge)
        const candidateFaces = new Set();
        for (const v of edge.boundaryVertices) {
            const faces = vertexToFaces.get(v);
            if (faces) {
                for (const f of faces) {
                    candidateFaces.add(f);
                }
            }
        }

        // 4b-c: Build local mesh edge → [face1, face2] map for candidate faces
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

        // Find cross-boundary mesh edges: two incident faces belong to different segments
        const dihedralAngles = [];

        for (const [, faces] of meshEdgeToFaces) {
            if (faces.length !== 2) continue;
            const f1 = faces[0];
            const f2 = faces[1];
            const seg1 = faceClassifications[f1];
            const seg2 = faceClassifications[f2];

            if (seg1 === seg2 || seg1 === 0 || seg2 === 0) continue;

            // 4d: Compute dihedral angle from face normals
            const base1 = f1 * 3;
            const n1 = computeFaceNormal(positions, indices[base1], indices[base1 + 1], indices[base1 + 2]);
            const base2 = f2 * 3;
            const n2 = computeFaceNormal(positions, indices[base2], indices[base2 + 1], indices[base2 + 2]);

            const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
            const clampedDot = Math.max(-1, Math.min(1, dot));
            const angle = Math.acos(clampedDot);
            dihedralAngles.push(angle);
        }

        // Step 5: Compute statistics
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
    // Step 1: Erode fat annotation edges
    const { workingLabels, remainingEdges } = erodeEdges(faceLabels, edgeIndices, adjacencyGraph, vertexCount);

    // Step 2: Identify scars from working labels
    const scars = identifyScars(workingLabels, vertexCount);

    // Step 3: Build adjacency between scars
    const edges = buildScarAdjacency(remainingEdges, workingLabels, adjacencyGraph, scars);

    // Step 4: Compute boundary roughness statistics
    computeBoundaryRoughness(edges, workingLabels, positions, indices);

    // Step 5: Strip internal fields from output
    return {
        scars: scars.map(({ scarId, representativeVertex, vertexCount }) => ({
            scarId,
            representativeVertex,
            vertexCount,
        })),
        edges: edges.map(({ scarA, scarB, sharpness, roughness, boundarySize }) => ({
            scarA,
            scarB,
            sharpness,
            roughness,
            boundarySize,
        })),
        workingLabels,
        boundaryVertices: remainingEdges,
    };
}
