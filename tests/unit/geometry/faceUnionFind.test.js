import {
    buildEdgeList,
    computeEdgeCosts,
    argsort,
    remapByFrequency,
    unionFindSegmentation,
    faceSegmentsToVertexEdges,
    facePredictionsToVertexValues,
} from '../../../src/geometry/faceUnionFind.js';


// ============== Test Fixtures ==============

/**
 * Tetrahedron: 4 vertices, 4 faces, every face shares an edge with every other.
 *
 *   v0 = (0, 0, 0)
 *   v1 = (1, 0, 0)
 *   v2 = (0.5, 1, 0)
 *   v3 = (0.5, 0.5, 1)
 *
 *   Face 0: [0, 1, 2]
 *   Face 1: [0, 1, 3]
 *   Face 2: [0, 2, 3]
 *   Face 3: [1, 2, 3]
 *
 * Face adjacency (each face neighbors all other 3):
 *   Face 0 neighbors: [1, 3, 2]  (across edges 12, 02, 01)
 *   Face 1 neighbors: [0, 3, 2]  (across edges 13, 01, 03) -- wait, need to compute properly
 *
 * For a tetrahedron with 4 faces, each face has exactly 3 neighbors (all other faces).
 * The exact ordering depends on the edge-to-face mapping. Let's use a known adjacency:
 */
function makeTetrahedron() {
    const indices = new Uint32Array([
        0, 1, 2,  // face 0
        0, 1, 3,  // face 1
        0, 2, 3,  // face 2
        1, 2, 3,  // face 3
    ]);

    // Face adjacency: for each face, 3 neighbors.
    // Edge (0,1) shared by face 0 and 1
    // Edge (0,2) shared by face 0 and 2
    // Edge (1,2) shared by face 0 and 3
    // Edge (0,3) shared by face 1 and 2
    // Edge (1,3) shared by face 1 and 3
    // Edge (2,3) shared by face 2 and 3
    //
    // Face 0 [0,1,2]: edges (1,2),(0,2),(0,1) → neighbors face3, face2, face1
    // Face 1 [0,1,3]: edges (1,3),(0,3),(0,1) → neighbors face3, face2, face0
    // Face 2 [0,2,3]: edges (2,3),(0,3),(0,2) → neighbors face3, face1, face0
    // Face 3 [1,2,3]: edges (2,3),(1,3),(1,2) → neighbors face2, face1, face0
    const faceAdjacencyFlat = new Int32Array([
        3, 2, 1,  // face 0
        3, 2, 0,  // face 1
        3, 1, 0,  // face 2
        2, 1, 0,  // face 3
    ]);

    return { indices, faceAdjacencyFlat, numFaces: 4, numVertices: 4 };
}

/**
 * Two-triangle "butterfly" mesh: 4 vertices, 2 faces sharing one edge.
 *
 *   v0 = (0, 0, 0)
 *   v1 = (1, 0, 0)
 *   v2 = (0.5, 1, 0)
 *   v3 = (0.5, -1, 0)
 *
 *   Face 0: [0, 1, 2]
 *   Face 1: [0, 1, 3]
 *
 * Face adjacency:
 *   Face 0: [1, -1, -1]  (neighbor across edge (0,1); other edges are boundary)
 *   Face 1: [0, -1, -1]
 *
 * Wait, need to match the edge convention from calc_face_adjacency:
 *   Face 0 [v0,v1,v2]: edges are (v1,v2)=edge0, (v2,v0)=edge1, (v0,v1)=edge2
 *     - edge(v0,v1) shared with face 1 → faceAdj[0][2] = 1
 *     - edge(v1,v2) boundary → faceAdj[0][0] = -1
 *     - edge(v2,v0) boundary → faceAdj[0][1] = -1
 *   Face 1 [v0,v1,v3]: edges are (v1,v3)=edge0, (v3,v0)=edge1, (v0,v1)=edge2
 *     - edge(v0,v1) shared with face 0 → faceAdj[1][2] = 0
 *     - edge(v1,v3) boundary → faceAdj[1][0] = -1
 *     - edge(v3,v0) boundary → faceAdj[1][1] = -1
 */
function makeButterfly() {
    const indices = new Uint32Array([
        0, 1, 2,  // face 0
        0, 1, 3,  // face 1
    ]);
    const faceAdjacencyFlat = new Int32Array([
        -1, -1, 1,  // face 0: only neighbor is face 1 across edge (v0,v1)
        -1, -1, 0,  // face 1: only neighbor is face 0 across edge (v0,v1)
    ]);
    return { indices, faceAdjacencyFlat, numFaces: 2, numVertices: 4 };
}

/**
 * 6-face strip mesh for testing segmentation into 2 groups.
 *
 * A strip of 6 triangles in a row:
 *
 *   v0---v2---v4---v6
 *   | f0/| f2/| f4/|
 *   |/ f1|/ f3|/ f5|
 *   v1---v3---v5---v7
 *
 * Faces: [0,1,2], [1,2,3], [2,3,4], [3,4,5], [4,5,6], [5,6,7]
 * Face adjacency: each interior face neighbors 2-3 others.
 */
function makeSixFaceStrip() {
    const indices = new Uint32Array([
        0, 1, 2,  // f0
        1, 2, 3,  // f1
        2, 3, 4,  // f2
        3, 4, 5,  // f3
        4, 5, 6,  // f4
        5, 6, 7,  // f5
    ]);

    // Face adjacency (manually computed):
    // f0 [0,1,2]: edges (1,2),(2,0),(0,1) → f1 across (1,2); others boundary
    // f1 [1,2,3]: edges (2,3),(3,1),(1,2) → f2 across (2,3); f0 across (1,2); boundary (1,3)
    // f2 [2,3,4]: edges (3,4),(4,2),(2,3) → f3 across (3,4); f1 across (2,3); boundary (2,4)
    // f3 [3,4,5]: edges (4,5),(5,3),(3,4) → f4 across (4,5); f2 across (3,4); boundary (3,5)
    // f4 [4,5,6]: edges (5,6),(6,4),(4,5) → f5 across (5,6); f3 across (4,5); boundary (4,6)
    // f5 [5,6,7]: edges (6,7),(7,5),(5,6) → boundary; f4 across (5,6); boundary (5,7)
    const faceAdjacencyFlat = new Int32Array([
        1, -1, -1,   // f0: neighbor f1 across edge (1,2)
        2, -1, 0,    // f1: f2 across (2,3), boundary, f0 across (1,2)
        3, -1, 1,    // f2: f3 across (3,4), boundary, f1 across (2,3)
        4, -1, 2,    // f3: f4 across (4,5), boundary, f2 across (3,4)
        5, -1, 3,    // f4: f5 across (5,6), boundary, f3 across (4,5)
        -1, -1, 4,   // f5: boundary, boundary, f4 across (5,6)
    ]);

    return { indices, faceAdjacencyFlat, numFaces: 6, numVertices: 8 };
}


// ============== Tests ==============

describe('faceUnionFind', () => {

    describe('buildEdgeList', () => {
        it('should extract 6 unique edges from a tetrahedron', () => {
            const { faceAdjacencyFlat, numFaces } = makeTetrahedron();
            const { src, dst, count } = buildEdgeList(faceAdjacencyFlat, numFaces);

            expect(count).toBe(6); // C(4,2) = 6 edges
            // All edges should have src < dst
            for (let i = 0; i < count; i++) {
                expect(src[i]).toBeLessThan(dst[i]);
            }
        });

        it('should extract 1 edge from a butterfly mesh', () => {
            const { faceAdjacencyFlat, numFaces } = makeButterfly();
            const { count } = buildEdgeList(faceAdjacencyFlat, numFaces);

            expect(count).toBe(1); // Only one shared edge
        });

        it('should extract 5 edges from a 6-face strip', () => {
            const { faceAdjacencyFlat, numFaces } = makeSixFaceStrip();
            const { count } = buildEdgeList(faceAdjacencyFlat, numFaces);

            expect(count).toBe(5); // 6 faces in a line: 5 connections
        });

        it('should handle empty adjacency', () => {
            const { count } = buildEdgeList(new Int32Array(0), 0);
            expect(count).toBe(0);
        });
    });

    describe('computeEdgeCosts', () => {
        it('should compute max costs correctly', () => {
            const predictions = new Float64Array([0.1, 0.9, 0.5]);
            const src = new Int32Array([0, 0, 1]);
            const dst = new Int32Array([1, 2, 2]);
            const costs = computeEdgeCosts(predictions, src, dst, 3, 'max');

            expect(costs[0]).toBeCloseTo(0.9); // max(0.1, 0.9)
            expect(costs[1]).toBeCloseTo(0.5); // max(0.1, 0.5)
            expect(costs[2]).toBeCloseTo(0.9); // max(0.9, 0.5)
        });

        it('should compute mean costs correctly', () => {
            const predictions = new Float64Array([0.1, 0.9, 0.5]);
            const src = new Int32Array([0, 0, 1]);
            const dst = new Int32Array([1, 2, 2]);
            const costs = computeEdgeCosts(predictions, src, dst, 3, 'mean');

            expect(costs[0]).toBeCloseTo(0.5);  // (0.1 + 0.9) / 2
            expect(costs[1]).toBeCloseTo(0.3);  // (0.1 + 0.5) / 2
            expect(costs[2]).toBeCloseTo(0.7);  // (0.9 + 0.5) / 2
        });

        it('should compute min costs correctly', () => {
            const predictions = new Float64Array([0.1, 0.9, 0.5]);
            const src = new Int32Array([0, 0, 1]);
            const dst = new Int32Array([1, 2, 2]);
            const costs = computeEdgeCosts(predictions, src, dst, 3, 'min');

            expect(costs[0]).toBeCloseTo(0.1); // min(0.1, 0.9)
            expect(costs[1]).toBeCloseTo(0.1); // min(0.1, 0.5)
            expect(costs[2]).toBeCloseTo(0.5); // min(0.9, 0.5)
        });
    });

    describe('argsort', () => {
        it('should return indices that sort the array ascending', () => {
            const costs = new Float64Array([0.5, 0.1, 0.9, 0.3]);
            const order = argsort(costs);

            expect(order[0]).toBe(1); // 0.1
            expect(order[1]).toBe(3); // 0.3
            expect(order[2]).toBe(0); // 0.5
            expect(order[3]).toBe(2); // 0.9
        });

        it('should handle empty array', () => {
            const order = argsort(new Float64Array(0));
            expect(order.length).toBe(0);
        });

        it('should handle equal values (stability)', () => {
            const costs = new Float64Array([0.5, 0.5, 0.5]);
            const order = argsort(costs);
            // All values equal — indices should all be present
            const sorted = Array.from(order).sort();
            expect(sorted).toEqual([0, 1, 2]);
        });
    });

    describe('remapByFrequency', () => {
        it('should match Python docstring example', () => {
            // Python: remap_integers_by_frequency([3, 1, 3, 2, 3, 1, 5, 5])
            //       → array([1, 2, 1, 4, 1, 2, 3, 3])
            const input = new Int32Array([3, 1, 3, 2, 3, 1, 5, 5]);
            const result = remapByFrequency(input);

            expect(Array.from(result)).toEqual([1, 2, 1, 4, 1, 2, 3, 3]);
        });

        it('should handle single value', () => {
            const input = new Int32Array([5, 5, 5]);
            const result = remapByFrequency(input);

            expect(Array.from(result)).toEqual([1, 1, 1]);
        });

        it('should handle all unique values', () => {
            const input = new Int32Array([10, 20, 30]);
            const result = remapByFrequency(input);

            // All counts equal (1 each), tie-break by value ascending
            // 10→rank1, 20→rank2, 30→rank3
            expect(Array.from(result)).toEqual([1, 2, 3]);
        });
    });

    describe('unionFindSegmentation', () => {
        it('should merge all faces in a tetrahedron with low predictions', () => {
            const { faceAdjacencyFlat, numFaces } = makeTetrahedron();
            // All faces have low edge probability → should all merge into 1 segment
            const predictions = new Float64Array([0.1, 0.1, 0.1, 0.1]);

            const labels = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 0.5,
                minSegmentSize: 1,
                mergeCost: 'max',
            });

            // All faces should be in the same segment
            const unique = new Set(labels);
            expect(unique.size).toBe(1);
            expect(labels[0]).toBe(1); // remapped to 1
        });

        it('should keep all faces separate with high predictions and low threshold', () => {
            const { faceAdjacencyFlat, numFaces } = makeTetrahedron();
            // All faces have high edge probability
            const predictions = new Float64Array([0.9, 0.9, 0.9, 0.9]);

            const labels = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 0.1, // very low threshold → no merges
                minSegmentSize: 1,  // no cleanup
                mergeCost: 'max',
            });

            // All faces should be in separate segments
            const unique = new Set(labels);
            expect(unique.size).toBe(4);
        });

        it('should split a strip into 2 segments with a high-cost boundary', () => {
            const { faceAdjacencyFlat, numFaces } = makeSixFaceStrip();
            // Left half (f0,f1,f2) low predictions, right half (f3,f4,f5) low
            // But f2 and f3 have high predictions → boundary between them
            const predictions = new Float64Array([0.05, 0.05, 0.4, 0.4, 0.05, 0.05]);

            const labels = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 0.3,  // won't merge edges with cost > 0.3
                minSegmentSize: 1,
                mergeCost: 'max',
            });

            // f0,f1 should be in one segment, f4,f5 in another
            // f2 and f3 may be isolated or joined to their respective sides
            expect(labels[0]).toBe(labels[1]); // f0 and f1 in same segment
            expect(labels[4]).toBe(labels[5]); // f4 and f5 in same segment
            expect(labels[0]).not.toBe(labels[4]); // left and right separated
        });

        it('should merge small segments in cleanup pass', () => {
            const { faceAdjacencyFlat, numFaces } = makeSixFaceStrip();
            // Create a scenario where f0 is isolated (high prediction)
            // but minSegmentSize forces it to merge
            const predictions = new Float64Array([0.05, 0.05, 0.9, 0.05, 0.05, 0.05]);

            const labels = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 0.3,
                minSegmentSize: 3, // segments smaller than 3 get merged
                mergeCost: 'max',
            });

            // All faces should end up in at most 2 segments due to cleanup
            const unique = new Set(labels);
            expect(unique.size).toBeLessThanOrEqual(2);
        });

        it('should respect maxSegmentSize', () => {
            const { faceAdjacencyFlat, numFaces } = makeSixFaceStrip();
            const predictions = new Float64Array([0.05, 0.05, 0.05, 0.05, 0.05, 0.05]);

            const labels = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 1.0,
                maxSegmentSize: 3, // no segment larger than 3 faces
                minSegmentSize: 1,
                mergeCost: 'max',
            });

            // Count faces per segment
            const segCounts = new Map();
            for (let i = 0; i < numFaces; i++) {
                segCounts.set(labels[i], (segCounts.get(labels[i]) || 0) + 1);
            }

            for (const count of segCounts.values()) {
                expect(count).toBeLessThanOrEqual(3);
            }
        });
    });

    describe('faceSegmentsToVertexEdges', () => {
        it('should mark boundary vertices between segments', () => {
            const { indices, numVertices } = makeButterfly();
            // Two faces in different segments
            const faceSegments = new Int32Array([1, 2]);

            const labels = faceSegmentsToVertexEdges(faceSegments, indices, numVertices);

            // v0 and v1 are shared by both faces (different segments) → edge
            expect(labels[0]).toBe(1); // v0: in face0(seg1) and face1(seg2) → boundary
            expect(labels[1]).toBe(1); // v1: in face0(seg1) and face1(seg2) → boundary
            // v2 only in face0 (seg1), v3 only in face1 (seg2) → interior
            expect(labels[2]).toBe(0);
            expect(labels[3]).toBe(0);
        });

        it('should mark no edges when all faces are same segment', () => {
            const { indices, numVertices } = makeTetrahedron();
            const faceSegments = new Int32Array([1, 1, 1, 1]);

            const labels = faceSegmentsToVertexEdges(faceSegments, indices, numVertices);

            for (let v = 0; v < numVertices; v++) {
                expect(labels[v]).toBe(0);
            }
        });

        it('should mark all shared vertices as edges in fully segmented tetrahedron', () => {
            const { indices, numVertices } = makeTetrahedron();
            // Each face in a different segment
            const faceSegments = new Int32Array([1, 2, 3, 4]);

            const labels = faceSegmentsToVertexEdges(faceSegments, indices, numVertices);

            // Every vertex is shared by multiple faces in different segments
            for (let v = 0; v < numVertices; v++) {
                expect(labels[v]).toBe(1);
            }
        });
    });

    describe('facePredictionsToVertexValues', () => {
        it('should average face predictions at each vertex', () => {
            const { indices, numFaces, numVertices } = makeButterfly();
            const predictions = new Float64Array([0.2, 0.8]);

            const values = facePredictionsToVertexValues(predictions, indices, numFaces, numVertices);

            // v0: in face0(0.2) and face1(0.8) → avg 0.5
            expect(values[0]).toBeCloseTo(0.5);
            // v1: in face0(0.2) and face1(0.8) → avg 0.5
            expect(values[1]).toBeCloseTo(0.5);
            // v2: only in face0(0.2)
            expect(values[2]).toBeCloseTo(0.2);
            // v3: only in face1(0.8)
            expect(values[3]).toBeCloseTo(0.8);
        });

        it('should handle uniform predictions', () => {
            const { indices, numFaces, numVertices } = makeTetrahedron();
            const predictions = new Float64Array([0.5, 0.5, 0.5, 0.5]);

            const values = facePredictionsToVertexValues(predictions, indices, numFaces, numVertices);

            for (let v = 0; v < numVertices; v++) {
                expect(values[v]).toBeCloseTo(0.5);
            }
        });
    });

    describe('end-to-end: segmentation → vertex edges', () => {
        it('should produce edge labels from predictions on a strip mesh', () => {
            const { indices, faceAdjacencyFlat, numFaces, numVertices } = makeSixFaceStrip();
            // Left 3 faces low prediction, right 3 faces low, with high boundary
            const predictions = new Float64Array([0.05, 0.05, 0.4, 0.4, 0.05, 0.05]);

            const faceSegments = unionFindSegmentation(predictions, faceAdjacencyFlat, numFaces, {
                maxMergeCost: 0.3,
                minSegmentSize: 1,
                mergeCost: 'max',
            });

            const vertexLabels = faceSegmentsToVertexEdges(faceSegments, indices, numVertices);

            // Vertices shared between segments should be edges
            // The exact boundary depends on which faces get merged
            // At minimum, some vertices should be marked as edges
            const edgeCount = vertexLabels.reduce((sum, v) => sum + v, 0);
            expect(edgeCount).toBeGreaterThan(0);
            expect(edgeCount).toBeLessThan(numVertices); // not all are edges
        });
    });

    describe('reference fixtures', () => {
        // Load reference test data
        const fixtures = require('../../fixtures/union_find_reference.json');

        it('tetrahedron_all_merge: all faces merge into 1 segment', () => {
            const fix = fixtures.find(f => f.name === 'tetrahedron_all_merge');
            const labels = unionFindSegmentation(
                new Float64Array(fix.edgePredictions),
                new Int32Array(fix.faceAdjacencyFlat),
                fix.numFaces,
                {
                    maxMergeCost: fix.params.max_merge_cost,
                    maxSegmentSize: fix.params.max_segment_size,
                    minSegmentSize: fix.params.min_segment_size,
                    mergeCost: fix.params.merge_cost,
                }
            );

            expect(Array.from(labels)).toEqual(fix.expectedLabels);

            // Also verify vertex edges
            const vertexEdges = faceSegmentsToVertexEdges(
                labels,
                new Uint32Array(fix.indicesFlat),
                fix.numVertices
            );
            expect(Array.from(vertexEdges)).toEqual(fix.expectedVertexEdges);
        });

        it('tetrahedron_no_merge: all faces stay separate', () => {
            const fix = fixtures.find(f => f.name === 'tetrahedron_no_merge');
            const labels = unionFindSegmentation(
                new Float64Array(fix.edgePredictions),
                new Int32Array(fix.faceAdjacencyFlat),
                fix.numFaces,
                {
                    maxMergeCost: fix.params.max_merge_cost,
                    maxSegmentSize: fix.params.max_segment_size,
                    minSegmentSize: fix.params.min_segment_size,
                    mergeCost: fix.params.merge_cost,
                }
            );

            const unique = new Set(labels);
            expect(unique.size).toBe(fix.expectedNumSegments);

            // All vertices should be edges
            const vertexEdges = faceSegmentsToVertexEdges(
                labels,
                new Uint32Array(fix.indicesFlat),
                fix.numVertices
            );
            for (let v = 0; v < fix.numVertices; v++) {
                expect(vertexEdges[v]).toBe(1);
            }
        });

        it('six_face_strip_split: correct grouping', () => {
            const fix = fixtures.find(f => f.name === 'six_face_strip_split');
            const labels = unionFindSegmentation(
                new Float64Array(fix.edgePredictions),
                new Int32Array(fix.faceAdjacencyFlat),
                fix.numFaces,
                {
                    maxMergeCost: fix.params.max_merge_cost,
                    maxSegmentSize: fix.params.max_segment_size,
                    minSegmentSize: fix.params.min_segment_size,
                    mergeCost: fix.params.merge_cost,
                }
            );

            const g = fix.expectedGrouping;
            if (g.f0_f1_same) expect(labels[0]).toBe(labels[1]);
            if (g.f4_f5_same) expect(labels[4]).toBe(labels[5]);
            if (g.f0_f4_different) expect(labels[0]).not.toBe(labels[4]);
        });

        it('remap_by_frequency_reference: matches Python output', () => {
            const fix = fixtures.find(f => f.name === 'remap_by_frequency_reference');
            const result = remapByFrequency(new Int32Array(fix.input));
            expect(Array.from(result)).toEqual(fix.expected);
        });
    });

    describe('performance', () => {
        it('should handle a large synthetic mesh within reasonable time', () => {
            // Generate a synthetic mesh with ~10000 faces in a grid
            const gridSize = 100; // 100x100 = 10000 quads = 20000 triangles
            const numFaces = gridSize * gridSize * 2;
            const numVertices = (gridSize + 1) * (gridSize + 1);

            // Build face adjacency for a triangulated grid
            const faceAdj = new Int32Array(numFaces * 3).fill(-1);
            for (let row = 0; row < gridSize; row++) {
                for (let col = 0; col < gridSize; col++) {
                    const quadIdx = row * gridSize + col;
                    const f0 = quadIdx * 2;     // upper-left triangle
                    const f1 = quadIdx * 2 + 1; // lower-right triangle

                    // f0 and f1 share an edge (diagonal)
                    faceAdj[f0 * 3 + 0] = f1;
                    faceAdj[f1 * 3 + 0] = f0;

                    // f0's bottom neighbor: f1 of the cell below
                    if (row > 0) {
                        const belowQuad = (row - 1) * gridSize + col;
                        faceAdj[f0 * 3 + 1] = belowQuad * 2 + 1;
                    }
                    // f1's right neighbor: f0 of the cell to the right
                    if (col < gridSize - 1) {
                        const rightQuad = row * gridSize + (col + 1);
                        faceAdj[f1 * 3 + 1] = rightQuad * 2;
                    }
                }
            }

            // Random predictions
            const predictions = new Float64Array(numFaces);
            for (let i = 0; i < numFaces; i++) {
                predictions[i] = Math.random();
            }

            const start = performance.now();
            const labels = unionFindSegmentation(predictions, faceAdj, numFaces, {
                maxMergeCost: 0.5,
                minSegmentSize: 10,
                mergeCost: 'max',
            });
            const elapsed = performance.now() - start;

            expect(labels.length).toBe(numFaces);
            // Should complete in < 2 seconds for 20K faces
            expect(elapsed).toBeLessThan(2000);

            // Verify all labels are positive integers
            for (let i = 0; i < numFaces; i++) {
                expect(labels[i]).toBeGreaterThan(0);
            }
        });
    });
});
