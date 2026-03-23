import { buildScarGraph, erodeEdges } from '../../../src/geometry/ScarGraph.js';
import { buildAdjacencyGraph } from '../../../src/utils/graphUtils.js';


// ============== Test Fixtures ==============

/**
 * Flat strip mesh: 10 vertices, 8 faces arranged in a 5x2 grid.
 *
 *   v0 -- v1 -- v2 -- v3 -- v4
 *   | \   | \   | \   | \   |
 *   |  \  |  \  |  \  |  \  |
 *   v5 -- v6 -- v7 -- v8 -- v9
 *
 * All vertices on z=0 plane.
 *
 * Faces:
 *   0: [0, 5, 1]   1: [1, 5, 6]
 *   2: [1, 6, 2]   3: [2, 6, 7]
 *   4: [2, 7, 3]   5: [3, 7, 8]
 *   6: [3, 8, 4]   7: [4, 8, 9]
 */
function makeFlatStrip() {
    const positions = new Float32Array([
        0, 0, 0,  // v0
        1, 0, 0,  // v1
        2, 0, 0,  // v2
        3, 0, 0,  // v3
        4, 0, 0,  // v4
        0, 1, 0,  // v5
        1, 1, 0,  // v6
        2, 1, 0,  // v7
        3, 1, 0,  // v8
        4, 1, 0,  // v9
    ]);
    const indices = [
        0, 5, 1,
        1, 5, 6,
        1, 6, 2,
        2, 6, 7,
        2, 7, 3,
        3, 7, 8,
        3, 8, 4,
        4, 8, 9,
    ];
    const vertexCount = 10;
    const adjacencyGraph = buildAdjacencyGraph(indices, vertexCount);

    return { positions, indices, vertexCount, adjacencyGraph };
}

/**
 * Folded strip: same topology as flat strip, but right half bends upward.
 * Creates a ridge at x=2 with non-zero dihedral angles.
 */
function makeFoldedStrip() {
    const positions = new Float32Array([
        0, 0, 0,  // v0
        1, 0, 0,  // v1
        2, 0, 0,  // v2
        3, 0, 1,  // v3 - tilted up
        4, 0, 2,  // v4 - tilted up
        0, 1, 0,  // v5
        1, 1, 0,  // v6
        2, 1, 0,  // v7
        3, 1, 1,  // v8 - tilted up
        4, 1, 2,  // v9 - tilted up
    ]);
    const indices = [
        0, 5, 1,
        1, 5, 6,
        1, 6, 2,
        2, 6, 7,
        2, 7, 3,
        3, 7, 8,
        3, 8, 4,
        4, 8, 9,
    ];
    const vertexCount = 10;
    const adjacencyGraph = buildAdjacencyGraph(indices, vertexCount);

    return { positions, indices, vertexCount, adjacencyGraph };
}

/**
 * Create faceLabels for two-segment mesh with a THIN edge (1 vertex wide).
 * Segment 1: {0, 1, 5, 6}  (left)
 * Edge:      {2, 7}         (boundary)
 * Segment 2: {3, 4, 8, 9}  (right)
 */
function makeThinEdgeLabels() {
    // faceLabels[vertexIndex] = segmentId (0 = edge)
    return [1, 1, 0, 2, 2, 1, 1, 0, 2, 2];
}

function makeThinEdgeIndices() {
    return new Set([2, 7]);
}

/**
 * Create faceLabels for two-segment mesh with a FAT edge (3 vertices wide).
 * Segment 1: {0, 5}                     (left)
 * Edge:      {1, 2, 3, 6, 7, 8}         (fat boundary)
 * Segment 2: {4, 9}                     (right)
 */
function makeFatEdgeLabels() {
    return [1, 0, 0, 0, 2, 1, 0, 0, 0, 2];
}

function makeFatEdgeIndices() {
    return new Set([1, 2, 3, 6, 7, 8]);
}

/**
 * Three-segment mesh with triple junction.
 * Triangle mesh:
 *
 *       v2
 *      / | \
 *    v0--v4--v1
 *      \ | /
 *       v3
 *
 * 5 vertices, 4 faces:
 *   0: [0, 4, 2]   (segment A)
 *   1: [4, 1, 2]   (segment B)
 *   2: [0, 3, 4]   (segment A)
 *   3: [4, 3, 1]   (segment B)
 *
 * Actually, let's make 3 segments meeting at v4:
 *   Segment A: {0} (top-left)
 *   Segment B: {1} (top-right)
 *   Segment C: {3} (bottom)
 *   Edge: {2, 4}   (junction)
 *
 * Need more vertices. Let me use a hex-like layout:
 *       v1
 *      / \
 *   v0 - v2 - v3
 *      \ /
 *       v4
 *
 * 5 vertices, 4 faces:
 *   0: [0, 1, 2]
 *   1: [0, 2, 4]
 *   2: [2, 3, 4]  -- wait, this doesn't form 3 segments
 *
 * Let me use a simpler approach: 7 vertices with a central edge vertex.
 */
function makeTripleJunction() {
    //   v1 --- v2
    //   |  \ / |
    //   |  v0  |
    //   |  / \ |
    //   v3 --- v4
    //    \  |  /
    //     v5-v6  -- no, too complex
    //
    // Simpler: star shape with center vertex v0 as edge
    //   v1--v2
    //    \ / \
    //    v0   v3
    //    / \ /
    //   v5--v4
    //
    // 6 vertices, 6 faces, v0 is the edge (junction)
    const positions = new Float32Array([
        0, 0, 0,    // v0 (center, edge)
        -1, 1, 0,   // v1
        1, 1, 0,    // v2
        2, 0, 0,    // v3
        1, -1, 0,   // v4
        -1, -1, 0,  // v5
    ]);
    const indices = [
        0, 1, 2,  // face 0
        0, 2, 3,  // face 1
        0, 3, 4,  // face 2
        0, 4, 5,  // face 3
        0, 5, 1,  // face 4
    ];
    const vertexCount = 6;
    const adjacencyGraph = buildAdjacencyGraph(indices, vertexCount);

    // v0 is edge, v1-v5 are in different segments
    // Segment 1: {1, 2}  (top pair, connected via face 0)
    // Segment 2: {3, 4}  (right pair, connected via face 2)
    // Segment 3: {5}     (bottom-left)
    // Wait, v1 and v2 are connected through v0, but v0 is edge.
    // v1's neighbors: {0, 2, 5}. 0 is edge, 2 and 5 are non-edge.
    // But 2 and 5 aren't direct neighbors of v1... let me check.
    // adjacencyGraph for face [0,1,2]: v1 connects to {0, 2}
    // adjacencyGraph for face [0,5,1]: v1 connects to {0, 5}
    // So v1's neighbors: {0, 2, 5}
    // Since v0 is edge, flood-fill from v1: v1→v2 (via edge 1-2 in face 0),
    //   v1→v5 (via edge 1-5 in face 4). So {1, 2, 5} might all be one segment!
    // That's not 3 segments. Need more edge vertices.

    // Let me make it so v0, v2, v4 are edges (3 ridges radiating from center):
    // Segment A: {1}
    // Segment B: {3}
    // Segment C: {5}
    // Edge: {0, 2, 4}
    //
    // v1's neighbors: {0, 2, 5}. 0 and 2 are edge. 5 is non-edge.
    //   But v1 and v5 are connected (face [0,5,1]). So flood-fill from v1:
    //   v1→v5? v5's neighbors: {0, 1, 4}. 0 and 4 are edge. v1 is non-edge.
    //   So segment = {1, 5}. That's only 2 segments, not 3.

    // OK, let me use a proper fixture with more vertices.
    // 7 vertices: v0 center (edge), v1-v6 around it, edge between pairs.
    return null;  // Will use alternative fixture below
}

/**
 * Proper three-segment fixture with triple junction.
 *
 * 7 vertices: v0 center (edge), v1-v6 around.
 * v0 is edge, plus v2 and v4 are edge (3 radial edges).
 *
 *      v1   v3
 *       \ / \ /
 *   v6 - v0 - v2 -- nope, hard to visualize.
 *
 * Let's use a hex with center:
 *        v1
 *       / \
 *     v6   v2
 *     |  v0  |
 *     v5   v3
 *       \ /
 *        v4
 *
 * 7 vertices, 6 faces.
 * Edge = {v0} (just center).
 * Segments: each pair of outer vertices forms a segment IF they're connected.
 *   But they connect through v0 (edge), so each adjacent pair is separate UNLESS
 *   they share a non-edge path.
 *
 * faces: [v0,v1,v2], [v0,v2,v3], [v0,v3,v4], [v0,v4,v5], [v0,v5,v6], [v0,v6,v1]
 * adjacency: v1-{v0,v2,v6}, v2-{v0,v1,v3}, v3-{v0,v2,v4}, etc.
 *
 * With only v0 as edge:
 * v1→v2→v3→v4→v5→v6→v1 all connected through outer ring. So 1 segment!
 * Need to add edge vertices to separate them.
 *
 * Make v0, v2, v4 edges:
 * v1: neighbors {v0, v2, v6}. v0 and v2 are edge. v6 is non-edge. Flood: v1→v6.
 *   But v6's neighbors are {v0, v5, v1}. v0 is edge. So segment = {v1, v6}.
 * v3: neighbors {v0, v2, v4}. All edge. Segment = {v3}.
 * v5: neighbors {v0, v4, v6}. v0, v4 edge. v6 is non-edge. Flood: v5→v6→v1.
 *   So segment = {v1, v5, v6}. Only 2 segments!
 *
 * Make v0, v2, v4, v6 edges:
 * v1: neighbors {v0, v2, v6}. All edge. Segment = {v1}.
 * v3: neighbors {v0, v2, v4}. All edge. Segment = {v3}.
 * v5: neighbors {v0, v4, v6}. All edge. Segment = {v5}.
 * Now 3 segments meeting at v0. Edges: {v0, v2, v4, v6}.
 */
function makeTripleJunctionFixture() {
    const positions = new Float32Array([
        0, 0, 0,    // v0 (center, edge)
        0, 1, 0,    // v1 (segment A)
        1, 0.5, 0,  // v2 (edge)
        1, -0.5, 0, // v3 (segment B)
        0, -1, 0,   // v4 (edge)
        -1, -0.5, 0,// v5 (segment C)
        -1, 0.5, 0, // v6 (edge)
    ]);
    const indices = [
        0, 1, 2,  // face 0
        0, 2, 3,  // face 1
        0, 3, 4,  // face 2
        0, 4, 5,  // face 3
        0, 5, 6,  // face 4
        0, 6, 1,  // face 5
    ];
    const vertexCount = 7;
    const adjacencyGraph = buildAdjacencyGraph(indices, vertexCount);

    // faceLabels: v0,v2,v4,v6 = edge (0). v1 = seg 1, v3 = seg 2, v5 = seg 3
    const faceLabels = [0, 1, 0, 2, 0, 3, 0];
    const edgeIndices = new Set([0, 2, 4, 6]);

    return { positions, indices, vertexCount, adjacencyGraph, faceLabels, edgeIndices };
}


// ============== Tests ==============

describe('ScarGraph', () => {
    describe('erodeEdges', () => {
        it('should not change thin edges (1 vertex wide)', () => {
            const { adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const { workingLabels, remainingEdges } = erodeEdges(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount
            );

            // Thin edges should remain: vertices 2 and 7
            expect(remainingEdges.size).toBe(2);
            expect(remainingEdges.has(2)).toBe(true);
            expect(remainingEdges.has(7)).toBe(true);

            // Non-edge labels should be unchanged
            expect(workingLabels[0]).toBe(1);
            expect(workingLabels[1]).toBe(1);
            expect(workingLabels[3]).toBe(2);
            expect(workingLabels[4]).toBe(2);
        });

        it('should erode fat edges to thin boundary', () => {
            const { adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeFatEdgeLabels();
            const edgeIndices = makeFatEdgeIndices();

            const { workingLabels, remainingEdges } = erodeEdges(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount
            );

            // Fat edge should erode to boundary at v2, v7
            expect(remainingEdges.size).toBe(2);
            expect(remainingEdges.has(2)).toBe(true);
            expect(remainingEdges.has(7)).toBe(true);

            // Eroded vertices assigned to nearest segment
            expect(workingLabels[1]).toBe(1);  // v1 → segment 1
            expect(workingLabels[6]).toBe(1);  // v6 → segment 1
            expect(workingLabels[3]).toBe(2);  // v3 → segment 2
            expect(workingLabels[8]).toBe(2);  // v8 → segment 2

            // Boundary vertices remain 0
            expect(workingLabels[2]).toBe(0);
            expect(workingLabels[7]).toBe(0);
        });

        it('should handle empty edge set', () => {
            const { adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            const edgeIndices = new Set();

            const { workingLabels, remainingEdges } = erodeEdges(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount
            );

            expect(remainingEdges.size).toBe(0);
            expect(workingLabels[0]).toBe(1);
        });
    });

    describe('buildScarGraph', () => {
        it('should identify two scars with thin edge', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.scars.length).toBe(2);

            // Scar 0 should be segment with min vertex 0
            expect(result.scars[0].representativeVertex).toBe(0);
            expect(result.scars[0].vertexCount).toBe(4); // v0, v1, v5, v6

            // Scar 1 should be segment with min vertex 3
            expect(result.scars[1].representativeVertex).toBe(3);
            expect(result.scars[1].vertexCount).toBe(4); // v3, v4, v8, v9
        });

        it('should detect adjacency between two scars', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.edges.length).toBe(1);
            expect(result.edges[0].scarA).toBe(0);
            expect(result.edges[0].scarB).toBe(1);
        });

        it('should produce same scars from fat edge after erosion', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeFatEdgeLabels();
            const edgeIndices = makeFatEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            // After erosion, should still find 2 scars with adjacency
            expect(result.scars.length).toBe(2);
            expect(result.edges.length).toBe(1);
            expect(result.edges[0].scarA).toBe(0);
            expect(result.edges[0].scarB).toBe(1);

            // Scar identification should use min vertex from eroded labels
            // After erosion: seg 1 = {0, 1, 5, 6}, seg 2 = {3, 4, 8, 9}
            expect(result.scars[0].representativeVertex).toBe(0);
            expect(result.scars[1].representativeVertex).toBe(3);
        });

        it('should detect triple junction adjacency', () => {
            const { positions, indices, adjacencyGraph, vertexCount, faceLabels, edgeIndices } =
                makeTripleJunctionFixture();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            // 3 scars (v1=seg1, v3=seg2, v5=seg3)
            expect(result.scars.length).toBe(3);

            // 3 adjacency edges (all pairs of scars)
            expect(result.edges.length).toBe(3);

            // Verify all pairs present
            const pairKeys = result.edges.map(e => `${e.scarA}_${e.scarB}`).sort();
            expect(pairKeys).toEqual(['0_1', '0_2', '1_2']);
        });

        it('should compute zero sharpness for flat boundary', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.edges[0].sharpness).toBeCloseTo(0, 3);
            expect(result.edges[0].roughness).toBeCloseTo(0, 3);
        });

        it('should compute non-zero sharpness for folded boundary', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFoldedStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.edges[0].sharpness).toBeGreaterThan(0.1);
            expect(result.edges[0].boundarySize).toBeGreaterThan(0);
        });

        it('should return boundary vertices', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.boundaryVertices).toBeInstanceOf(Set);
            expect(result.boundaryVertices.size).toBe(2);
            expect(result.boundaryVertices.has(2)).toBe(true);
            expect(result.boundaryVertices.has(7)).toBe(true);
        });

        it('should return workingLabels as Int32Array', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.workingLabels).toBeInstanceOf(Int32Array);
            expect(result.workingLabels.length).toBe(vertexCount);
        });

        it('should handle single segment (no edges)', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            const edgeIndices = new Set();

            const result = buildScarGraph(
                faceLabels, edgeIndices, adjacencyGraph, vertexCount,
                positions, indices
            );

            expect(result.scars.length).toBe(1);
            expect(result.scars[0].vertexCount).toBe(10);
            expect(result.edges.length).toBe(0);
        });

        it('should produce deterministic scar IDs', () => {
            const { positions, indices, adjacencyGraph, vertexCount } = makeFlatStrip();
            const faceLabels = makeThinEdgeLabels();
            const edgeIndices = makeThinEdgeIndices();

            // Run twice
            const r1 = buildScarGraph(faceLabels, edgeIndices, adjacencyGraph, vertexCount, positions, indices);
            const r2 = buildScarGraph(faceLabels, edgeIndices, adjacencyGraph, vertexCount, positions, indices);

            expect(r1.scars).toEqual(r2.scars);
            expect(r1.edges.map(e => ({ scarA: e.scarA, scarB: e.scarB }))).toEqual(
                r2.edges.map(e => ({ scarA: e.scarA, scarB: e.scarB }))
            );
        });
    });
});
