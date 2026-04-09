/**
 * Shared client-side postprocessing pipeline.
 *
 * Takes cached model output (per-face edge probabilities + face adjacency) and
 * a meshView, runs union-find segmentation → vertex labeling → edge normalization,
 * and returns the final per-vertex edge labels in the format applyResults() expects.
 *
 * Used by both ModelPanel (interactive inference) and FastVerificationPanel
 * (precomputed model output verification).
 *
 * @module postprocess
 */

import {
    unionFindSegmentation,
    faceSegmentsToVertexSegments,
    normalizeEdges,
} from '../geometry/faceUnionFind.js';

/**
 * Run client-side postprocessing on cached model output.
 *
 * @param {{edgePredictions: Float64Array, faceAdjacencyFlat: Int32Array, numFaces: number}} cachedModelOutput
 * @param {Object} meshView - MeshView instance (needs .indices, .positions, .adjacencyGraph)
 * @param {Object} config - Postprocessing config with union_find_max_merge_cost, union_find_max_segment_size, union_find_merge_cost, min_segment_size
 * @returns {number[]} Per-vertex edge labels (0 or 1), same format as applyResults({ labels }) expects
 */
export function runClientPostprocessing(cachedModelOutput, meshView, config) {
    const { edgePredictions, faceAdjacencyFlat, numFaces } = cachedModelOutput;
    const indices = meshView.indices;
    const numVertices = meshView.positions.length / 3;
    const adjacencyGraph = meshView.adjacencyGraph;

    // Step 1: Union-find segmentation (skip internal cleanup — normalizeEdges handles it)
    const faceSegments = unionFindSegmentation(
        edgePredictions,
        faceAdjacencyFlat,
        numFaces,
        {
            maxMergeCost: config.union_find_max_merge_cost,
            maxSegmentSize: config.union_find_max_segment_size,
            minSegmentSize: 1, // skip internal cleanupPass
            mergeCost: config.union_find_merge_cost,
        }
    );

    // Step 2: Convert per-face → per-vertex segment labels (0 = edge)
    const vertexSegLabels = faceSegmentsToVertexSegments(faceSegments, indices, numVertices);

    // Step 3: Normalize edges (removes small segments, erodes, assigns thin edges)
    const edgeIndices = new Set();
    for (let v = 0; v < numVertices; v++) {
        if (vertexSegLabels[v] === 0) edgeIndices.add(v);
    }
    const { edgeLabels } = normalizeEdges(
        vertexSegLabels, edgeIndices, adjacencyGraph,
        numVertices, indices, config.min_segment_size
    );

    return Array.from(edgeLabels);
}
