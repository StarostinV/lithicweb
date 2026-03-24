/**
 * Face-based Union-Find Segmentation
 *
 * Port of neurolithic_light/postprocess_3d.py to JavaScript.
 * Uses TypedArrays throughout for performance on meshes with 1M+ vertices.
 *
 * Must produce identical results to the Python/Numba implementation
 * for the same inputs.
 *
 * @module faceUnionFind
 */



// ============== Union-Find Primitives ==============

/**
 * Find root with path halving (matches Numba _uf_find).
 * @param {Int32Array} parent
 * @param {number} x
 * @returns {number} root
 */
function ufFind(parent, x) {
    while (parent[x] !== x) {
        parent[x] = parent[parent[x]]; // path halving
        x = parent[x];
    }
    return x;
}

/**
 * Union by rank, tracking segment size (matches Numba _uf_union).
 * @param {Int32Array} parent
 * @param {Int32Array} rank
 * @param {Int32Array} size
 * @param {number} x
 * @param {number} y
 * @returns {boolean} true if merge happened
 */
function ufUnion(parent, rank, size, x, y) {
    let rx = ufFind(parent, x);
    let ry = ufFind(parent, y);
    if (rx === ry) return false;
    if (rank[rx] < rank[ry]) {
        const tmp = rx; rx = ry; ry = tmp;
    }
    parent[ry] = rx;
    size[rx] += size[ry];
    if (rank[rx] === rank[ry]) rank[rx]++;
    return true;
}

/**
 * Flatten all parents to roots (matches Numba _uf_find_all).
 * @param {Int32Array} parent
 */
function ufFindAll(parent) {
    for (let i = 0; i < parent.length; i++) {
        ufFind(parent, i);
    }
}


// ============== Edge List & Costs ==============

/**
 * Build unique undirected edge list from flat face adjacency.
 * Keeps only edges where src < dst to deduplicate (matches _build_edge_list).
 *
 * @param {Int32Array} faceAdjacencyFlat - (numFaces * 3) flat array
 * @param {number} numFaces
 * @returns {{src: Int32Array, dst: Int32Array, count: number}}
 */
export function buildEdgeList(faceAdjacencyFlat, numFaces) {
    // Upper bound: each face has 3 neighbors, each edge counted once (src < dst)
    const maxEdges = numFaces * 3;
    const src = new Int32Array(maxEdges);
    const dst = new Int32Array(maxEdges);
    let count = 0;

    for (let face = 0; face < numFaces; face++) {
        const base = face * 3;
        for (let k = 0; k < 3; k++) {
            const neighbor = faceAdjacencyFlat[base + k];
            if (neighbor >= 0 && face < neighbor) {
                src[count] = face;
                dst[count] = neighbor;
                count++;
            }
        }
    }

    return {
        src: src.subarray(0, count),
        dst: dst.subarray(0, count),
        count
    };
}

/**
 * Compute edge costs from face predictions (matches _compute_edge_costs).
 *
 * @param {Float64Array} predictions - Per-face edge probabilities
 * @param {Int32Array} src - Edge source faces
 * @param {Int32Array} dst - Edge destination faces
 * @param {number} count - Number of edges
 * @param {string} mergeCost - 'max', 'mean', or 'min'
 * @returns {Float64Array}
 */
export function computeEdgeCosts(predictions, src, dst, count, mergeCost) {
    const costs = new Float64Array(count);

    if (mergeCost === 'max') {
        for (let i = 0; i < count; i++) {
            const a = predictions[src[i]];
            const b = predictions[dst[i]];
            costs[i] = a > b ? a : b;
        }
    } else if (mergeCost === 'mean') {
        for (let i = 0; i < count; i++) {
            costs[i] = (predictions[src[i]] + predictions[dst[i]]) * 0.5;
        }
    } else { // 'min'
        for (let i = 0; i < count; i++) {
            const a = predictions[src[i]];
            const b = predictions[dst[i]];
            costs[i] = a < b ? a : b;
        }
    }

    return costs;
}


// ============== Sorting ==============

/**
 * Indirect argsort: returns indices that would sort the costs array ascending.
 * Uses Uint32Array for the index array.
 *
 * @param {Float64Array} costs
 * @returns {Uint32Array} sorted indices
 */
export function argsort(costs) {
    const n = costs.length;
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    indices.sort((a, b) => costs[a] - costs[b]);
    return indices;
}

/**
 * Reorder src and dst arrays by the given sort order.
 * Returns new contiguous Int32Arrays.
 *
 * @param {Int32Array} src
 * @param {Int32Array} dst
 * @param {Uint32Array} order
 * @param {number} count - Number of elements to take (for cutoff)
 * @returns {{src: Int32Array, dst: Int32Array}}
 */
function reorderEdges(src, dst, order, count) {
    const newSrc = new Int32Array(count);
    const newDst = new Int32Array(count);
    for (let i = 0; i < count; i++) {
        const idx = order[i];
        newSrc[i] = src[idx];
        newDst[i] = dst[idx];
    }
    return { src: newSrc, dst: newDst };
}

/**
 * Binary search for the rightmost position where costs[order[i]] <= threshold.
 * Equivalent to np.searchsorted(sorted_costs, threshold, side='right').
 *
 * @param {Float64Array} costs - Original unsorted costs
 * @param {Uint32Array} order - Sort order (indices into costs)
 * @param {number} threshold
 * @returns {number} cutoff index
 */
function searchSortedRight(costs, order, threshold) {
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (costs[order[mid]] <= threshold) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}


// ============== Merge Passes ==============

/**
 * Main merge pass (matches Numba _merge_pass).
 * Iterates sorted edges and merges with size constraint.
 *
 * @param {Int32Array} edgesSrc - Sorted edge sources
 * @param {Int32Array} edgesDst - Sorted edge destinations
 * @param {Int32Array} parent
 * @param {Int32Array} rank
 * @param {Int32Array} size
 * @param {number} maxSegmentSize - 0 means no limit
 * @returns {number} number of merges
 */
function mergePass(edgesSrc, edgesDst, parent, rank, size, maxSegmentSize) {
    let merged = 0;
    const useSizeLimit = maxSegmentSize > 0;
    const n = edgesSrc.length;

    for (let idx = 0; idx < n; idx++) {
        const i = edgesSrc[idx];
        const j = edgesDst[idx];
        const ri = ufFind(parent, i);
        const rj = ufFind(parent, j);
        if (ri === rj) continue;
        if (useSizeLimit && size[ri] + size[rj] > maxSegmentSize) continue;
        ufUnion(parent, rank, size, ri, rj);
        merged++;
    }

    return merged;
}

/**
 * Cleanup pass: merge small segments into nearest neighbor (matches Numba _cleanup_pass).
 *
 * @param {Int32Array} edgesSrc - All edges sorted by cost
 * @param {Int32Array} edgesDst
 * @param {Int32Array} parent
 * @param {Int32Array} rank
 * @param {Int32Array} size
 * @param {number} minSegmentSize
 * @returns {number} number of merges
 */
function cleanupPass(edgesSrc, edgesDst, parent, rank, size, minSegmentSize) {
    let merged = 0;
    const n = edgesSrc.length;

    for (let idx = 0; idx < n; idx++) {
        const i = edgesSrc[idx];
        const j = edgesDst[idx];
        const ri = ufFind(parent, i);
        const rj = ufFind(parent, j);
        if (ri === rj) continue;
        if (size[ri] >= minSegmentSize && size[rj] >= minSegmentSize) continue;
        ufUnion(parent, rank, size, ri, rj);
        merged++;
    }

    return merged;
}


// ============== Remap by Frequency ==============

/**
 * Remap integer array values to 1-indexed ranks ordered by descending frequency.
 * Most frequent value → 1, second → 2, etc.
 * Matches neurolithic_light/utils.py remap_integers_by_frequency().
 *
 * @param {Int32Array} arr
 * @returns {Int32Array} remapped array
 */
export function remapByFrequency(arr) {
    // Count frequencies
    const counts = new Map();
    for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        counts.set(v, (counts.get(v) || 0) + 1);
    }

    // Sort values by frequency descending, then by value ascending (tie-break)
    const entries = Array.from(counts.entries());
    entries.sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]; // descending by count
        return a[0] - b[0]; // ascending by value (matches np.unique sort order)
    });

    // Build lookup: old value → new rank (1-indexed)
    const lookup = new Map();
    for (let rank = 0; rank < entries.length; rank++) {
        lookup.set(entries[rank][0], rank + 1);
    }

    // Remap
    const result = new Int32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
        result[i] = lookup.get(arr[i]);
    }

    return result;
}


// ============== Main Entry Point ==============

/**
 * Union-Find segmentation on a face graph.
 * Produces identical results to Python union_find_segmentation() in postprocess_3d.py.
 *
 * @param {Float64Array} edgePredictions - (numFaces,) per-face edge probability [0,1]
 * @param {Int32Array} faceAdjacencyFlat - (numFaces * 3,) flat neighbor indices (-1 = no neighbor)
 * @param {number} numFaces
 * @param {Object} params
 * @param {number} params.maxMergeCost - Never merge edges with cost > this (default 0.45)
 * @param {number|null} params.maxSegmentSize - Don't merge if result exceeds this (null/0 = no limit)
 * @param {number} params.minSegmentSize - Cleanup threshold (default 50)
 * @param {string} params.mergeCost - 'max', 'mean', or 'min' (default 'max')
 * @returns {Int32Array} Per-face segment labels (1-indexed, frequency-ordered)
 */
export function unionFindSegmentation(edgePredictions, faceAdjacencyFlat, numFaces, params = {}) {
    const {
        maxMergeCost = 0.45,
        maxSegmentSize = null,
        minSegmentSize = 50,
        mergeCost = 'max',
    } = params;

    // Build edge list
    const edges = buildEdgeList(faceAdjacencyFlat, numFaces);

    // Compute edge costs
    const costs = computeEdgeCosts(
        edgePredictions, edges.src, edges.dst, edges.count, mergeCost
    );

    // Sort edges by cost ascending, find cutoff at maxMergeCost
    const order = argsort(costs);
    const cutoff = searchSortedRight(costs, order, maxMergeCost);

    // Reorder edges up to cutoff for the main merge pass
    const sortedMain = reorderEdges(edges.src, edges.dst, order, cutoff);

    // Initialize union-find structures
    const parent = new Int32Array(numFaces);
    const rank = new Int32Array(numFaces);
    const size = new Int32Array(numFaces);
    for (let i = 0; i < numFaces; i++) {
        parent[i] = i;
        size[i] = 1;
    }

    // Main merge pass
    const sizeLimit = (maxSegmentSize != null && maxSegmentSize > 0) ? maxSegmentSize : 0;
    mergePass(sortedMain.src, sortedMain.dst, parent, rank, size, sizeLimit);

    // Cleanup pass: merge small segments
    if (minSegmentSize > 1) {
        // Rebuild ALL edges sorted by cost (no threshold cutoff)
        const allEdges = buildEdgeList(faceAdjacencyFlat, numFaces);
        const allCosts = computeEdgeCosts(
            edgePredictions, allEdges.src, allEdges.dst, allEdges.count, mergeCost
        );
        const allOrder = argsort(allCosts);
        const sortedAll = reorderEdges(allEdges.src, allEdges.dst, allOrder, allEdges.count);

        cleanupPass(sortedAll.src, sortedAll.dst, parent, rank, size, minSegmentSize);
    }

    // Flatten all parents to roots
    ufFindAll(parent);

    // Remap by frequency
    return remapByFrequency(parent);
}


// ============== Face-to-Vertex Conversion ==============

/**
 * Convert face segment labels to vertex edge labels.
 * A vertex is on an edge (label=1) if its incident faces have different segment IDs.
 * Matches postprocess_result() in inference.py.
 *
 * @param {Int32Array} faceSegments - Per-face segment labels (numFaces)
 * @param {Uint32Array|Int32Array|Array} indicesFlat - Face vertex indices (numFaces * 3)
 * @param {number} numVertices
 * @returns {Uint8Array} Per-vertex edge labels (0 or 1)
 */
export function faceSegmentsToVertexEdges(faceSegments, indicesFlat, numVertices) {
    const maxIds = new Int32Array(numVertices).fill(-1);
    const minIds = new Int32Array(numVertices).fill(0x7FFFFFFF); // max int32
    const numFaces = faceSegments.length;

    for (let f = 0; f < numFaces; f++) {
        const seg = faceSegments[f];
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v = indicesFlat[base + k];
            if (seg > maxIds[v]) maxIds[v] = seg;
            if (seg < minIds[v]) minIds[v] = seg;
        }
    }

    const labels = new Uint8Array(numVertices);
    for (let v = 0; v < numVertices; v++) {
        if (maxIds[v] !== minIds[v]) labels[v] = 1;
    }

    return labels;
}


// ============== Heatmap Helpers ==============

/**
 * Convert per-face predictions to per-vertex values by averaging incident face predictions.
 * Used for heatmap visualization of model output.
 *
 * @param {Float64Array} edgePredictions - (numFaces,) per-face probabilities
 * @param {Uint32Array|Int32Array|Array} indicesFlat - Face vertex indices (numFaces * 3)
 * @param {number} numFaces
 * @param {number} numVertices
 * @returns {Float64Array} Per-vertex averaged predictions
 */
export function facePredictionsToVertexValues(edgePredictions, indicesFlat, numFaces, numVertices) {
    const sums = new Float64Array(numVertices);
    const counts = new Uint32Array(numVertices);

    for (let f = 0; f < numFaces; f++) {
        const pred = edgePredictions[f];
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v = indicesFlat[base + k];
            sums[v] += pred;
            counts[v]++;
        }
    }

    const result = new Float64Array(numVertices);
    for (let v = 0; v < numVertices; v++) {
        result[v] = counts[v] > 0 ? sums[v] / counts[v] : 0;
    }

    return result;
}


// ============== Edge Cleanup ==============

/**
 * Convert per-face segment IDs to per-vertex segment labels.
 * Only needed in the postprocessing pipeline (Path B) where we start from per-face data.
 *
 * For each face with segment > 0, assigns that segment to its 3 vertices.
 * If a vertex sees two different non-zero segment IDs → set to 0 (edge).
 * Faces with segment 0 (e.g. small segments marked as edge) are skipped.
 *
 * @param {Int32Array} faceSegments - Per-face segment labels (0 = edge/small)
 * @param {Uint32Array|Int32Array|Array} indicesFlat - Face vertex indices (numFaces * 3)
 * @param {number} numVertices
 * @returns {Int32Array} Per-vertex segment labels (0 = edge)
 */
export function faceSegmentsToVertexSegments(faceSegments, indicesFlat, numVertices) {
    const vertexLabels = new Int32Array(numVertices); // all 0
    const numFaces = faceSegments.length;

    for (let f = 0; f < numFaces; f++) {
        const seg = faceSegments[f];
        if (seg === 0) continue; // skip edge faces

        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v = indicesFlat[base + k];
            if (vertexLabels[v] === 0) {
                // First non-zero assignment
                vertexLabels[v] = seg;
            } else if (vertexLabels[v] !== seg && vertexLabels[v] !== -1) {
                // Conflict: vertex sees two different non-zero segments → edge
                vertexLabels[v] = -1;
            }
        }
    }

    // Convert -1 (conflict) back to 0 (edge)
    for (let v = 0; v < numVertices; v++) {
        if (vertexLabels[v] === -1) vertexLabels[v] = 0;
    }

    return vertexLabels;
}

/**
 * Assign clean, thin edges in a single pass over faces using lower-side marking.
 *
 * For each mesh edge (pair of adjacent vertices in a face) where the two
 * vertices have different segment IDs, mark the vertex with the lower
 * segment ID as edge. This consistently places edges on one side of
 * the boundary, producing ~1-vertex-wide edges.
 *
 * For triple junctions (A,B,C), the two lower-segment vertices are marked.
 *
 * Airtight: every boundary face has at least one edge vertex on each
 * cross-boundary mesh edge, so flood-fill cannot cross segments.
 *
 * @param {Int32Array} vertexLabels - Per-vertex segment labels (all non-zero, from erodeEdges)
 * @param {Uint32Array|Int32Array|Array} indicesFlat - Face vertex indices (numFaces * 3)
 * @param {number} numVertices
 * @returns {Uint8Array} Per-vertex edge labels (0 or 1)
 */
function assignThinEdges(vertexLabels, indicesFlat, numVertices) {
    const numFaces = indicesFlat.length / 3;
    const edgeLabels = new Uint8Array(numVertices);

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        const v0 = indicesFlat[base];
        const v1 = indicesFlat[base + 1];
        const v2 = indicesFlat[base + 2];
        const s0 = vertexLabels[v0];
        const s1 = vertexLabels[v1];
        const s2 = vertexLabels[v2];

        // Edge (v0, v1)
        if (s0 !== s1) {
            if (s0 < s1) edgeLabels[v0] = 1;
            else edgeLabels[v1] = 1;
        }
        // Edge (v1, v2)
        if (s1 !== s2) {
            if (s1 < s2) edgeLabels[v1] = 1;
            else edgeLabels[v2] = 1;
        }
        // Edge (v0, v2)
        if (s0 !== s2) {
            if (s0 < s2) edgeLabels[v0] = 1;
            else edgeLabels[v2] = 1;
        }
    }

    return edgeLabels;
}


/**
 * Mark vertices of small segments as edge (label 0) in per-vertex segment labels.
 * Uses flood-fill to find connected components of non-edge vertices,
 * then marks components smaller than minSize as edge.
 *
 * @param {Int32Array} vertexLabels - Per-vertex segment labels (0 = edge), modified in place
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {number} vertexCount
 * @param {number} minSize - Minimum segment size (vertex count)
 * @returns {boolean} true if any segments were marked
 */
function markSmallVertexSegmentsAsEdge(vertexLabels, adjacencyGraph, vertexCount, minSize) {
    const visited = new Uint8Array(vertexCount);
    const smallVertices = [];

    for (let v = 0; v < vertexCount; v++) {
        if (visited[v] || vertexLabels[v] === 0) continue;

        const segment = [];
        const queue = [v];
        visited[v] = 1;

        while (queue.length > 0) {
            const current = queue.pop();
            segment.push(current);

            const neighbors = adjacencyGraph.get(current);
            if (neighbors) {
                for (const n of neighbors) {
                    if (!visited[n] && vertexLabels[n] !== 0) {
                        visited[n] = 1;
                        queue.push(n);
                    }
                }
            }
        }

        if (segment.length < minSize) {
            for (const sv of segment) smallVertices.push(sv);
        }
    }

    if (smallVertices.length === 0) return false;

    for (const v of smallVertices) vertexLabels[v] = 0;
    return true;
}

/**
 * Erode edge vertices by assigning each to the minimum segment ID among
 * its non-edge neighbors. Iterates layer by layer until all edges are assigned.
 *
 * Uses min-assignment (not majority voting) to align with the lower-side
 * convention in assignThinEdges, ensuring idempotent normalization.
 *
 * @param {Array|Int32Array} faceLabels - Per-vertex segment labels (0 = edge)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {number} vertexCount - Total number of vertices
 * @returns {{workingLabels: Int32Array, remainingEdges: Set<number>}}
 */
function erodeEdgesToMin(faceLabels, edgeIndices, adjacencyGraph, vertexCount) {
    const workingLabels = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        workingLabels[i] = faceLabels[i];
    }

    const remainingEdges = new Set(edgeIndices);

    while (remainingEdges.size > 0) {
        const toAssign = [];

        for (const v of remainingEdges) {
            let minLabel = 0;
            const neighbors = adjacencyGraph.get(v);
            if (neighbors) {
                for (const n of neighbors) {
                    if (!remainingEdges.has(n) && workingLabels[n] > 0) {
                        if (minLabel === 0 || workingLabels[n] < minLabel) {
                            minLabel = workingLabels[n];
                        }
                    }
                }
            }

            if (minLabel > 0) {
                toAssign.push({ vertex: v, label: minLabel });
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

/**
 * Two-stage edge cleanup: erode existing edges, then assign clean thin boundaries.
 *
 * Stage 1 (erodeEdgesToMin): Assigns each edge vertex (label 0) to the minimum
 *   segment ID among its non-edge neighbors. This aligns with Stage 2's convention
 *   that edges live on the lower-ID side, ensuring idempotent normalization.
 *
 * Stage 2 (assignThinEdges): For each mesh edge crossing a segment boundary,
 *   marks the vertex with the lower segment ID. Produces thin, ~1-vertex-wide edges.
 *
 * @param {Array|Int32Array} vertexSegmentLabels - Per-vertex segment labels (0 = edge)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {number} vertexCount - Total vertex count
 * @param {Uint32Array|Int32Array|Array} indicesFlat - Face vertex indices (numFaces * 3)
 * @param {number} [minSegmentSize=1] - Remove vertex-level segments smaller than this
 * @param {number} [maxIterations=3] - Maximum normalization iterations
 * @returns {{edgeLabels: Uint8Array, converged: boolean, iterations: number}}
 */
export function normalizeEdges(vertexSegmentLabels, edgeIndices, adjacencyGraph, vertexCount, indicesFlat, minSegmentSize = 1, maxIterations = 3) {
    // Copy input labels so we can mutate across iterations
    const labels = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) labels[i] = vertexSegmentLabels[i];

    let edgeLabels;
    let converged = false;
    let iter;

    for (iter = 0; iter < maxIterations; iter++) {
        // Step 1: Mark small vertex segments as edge
        if (minSegmentSize > 1) {
            markSmallVertexSegmentsAsEdge(labels, adjacencyGraph, vertexCount, minSegmentSize);
        }

        // Build edge set from current labels
        const currentEdges = new Set();
        for (let v = 0; v < vertexCount; v++) {
            if (labels[v] === 0) currentEdges.add(v);
        }

        // Step 2: Erode edges — assign to min neighboring segment
        const { workingLabels } = erodeEdgesToMin(labels, currentEdges, adjacencyGraph, vertexCount);

        // Step 3: Assign thin edges (lower-side marking)
        edgeLabels = assignThinEdges(workingLabels, indicesFlat, vertexCount);

        // Check convergence: update labels for next iteration
        let changed = false;
        for (let v = 0; v < vertexCount; v++) {
            const newLabel = edgeLabels[v] === 1 ? 0 : workingLabels[v];
            if (newLabel !== labels[v]) changed = true;
            labels[v] = newLabel;
        }

        if (!changed) {
            converged = true;
            break;
        }

        if (iter === maxIterations - 1) {
            console.warn(`[normalizeEdges] Not fully converged after ${maxIterations} iterations`);
        }
    }

    return { edgeLabels, converged, iterations: iter + 1 };
}
