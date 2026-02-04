import { 
    computeEdgeAngles, 
    computeVertexMaxAngles,
    getSharpVertices,
    radiansToDegrees 
} from '../../../src/geometry/edgeAngles.js';

describe('edgeAngles', () => {
    // Simple flat quad (two triangles)
    // All vertices are coplanar, so dihedral angle = 0
    const flatQuadPositions = new Float32Array([
        0, 0, 0,  // v0
        1, 0, 0,  // v1
        1, 1, 0,  // v2
        0, 1, 0   // v3
    ]);
    const flatQuadIndices = [
        0, 1, 2,  // face 0
        0, 2, 3   // face 1
    ];

    // L-shaped mesh (two triangles at 90 degrees)
    const lShapePositions = new Float32Array([
        0, 0, 0,  // v0 - shared edge vertex
        1, 0, 0,  // v1 - shared edge vertex
        0, 1, 0,  // v2 - on horizontal face
        0, 0, 1   // v3 - on vertical face
    ]);
    const lShapeIndices = [
        0, 1, 2,  // horizontal face (normal pointing up in +Y)
        0, 3, 1   // vertical face (normal pointing out in +Y, but rotated)
    ];

    describe('computeEdgeAngles', () => {
        it('should return correct structure', () => {
            const result = computeEdgeAngles(flatQuadPositions, flatQuadIndices);
            
            expect(result).toHaveProperty('vertexMaxAngles');
            expect(result).toHaveProperty('edgeAngles');
            expect(result).toHaveProperty('faceNormals');
            
            expect(result.vertexMaxAngles).toBeInstanceOf(Float32Array);
            expect(result.vertexMaxAngles.length).toBe(4);
            expect(result.edgeAngles).toBeInstanceOf(Map);
            expect(result.faceNormals).toBeInstanceOf(Float32Array);
            expect(result.faceNormals.length).toBe(6); // 2 faces * 3 components
        });

        it('should compute zero angle for coplanar faces', () => {
            const result = computeEdgeAngles(flatQuadPositions, flatQuadIndices);
            
            // The shared edge (0-2) should have angle 0 (coplanar faces)
            const sharedEdgeAngle = result.edgeAngles.get('0_2');
            expect(sharedEdgeAngle).toBeCloseTo(0, 5);
        });

        it('should compute π for boundary edges', () => {
            const result = computeEdgeAngles(flatQuadPositions, flatQuadIndices);
            
            // Boundary edges should have angle π
            const boundaryEdge = result.edgeAngles.get('0_1');
            expect(boundaryEdge).toBeCloseTo(Math.PI, 5);
        });

        it('should assign max angle to vertices', () => {
            const result = computeEdgeAngles(flatQuadPositions, flatQuadIndices);
            
            // All vertices touch boundary edges, so max angle should be π
            for (let i = 0; i < 4; i++) {
                expect(result.vertexMaxAngles[i]).toBeCloseTo(Math.PI, 5);
            }
        });
    });

    describe('computeVertexMaxAngles', () => {
        it('should return Float32Array of correct length', () => {
            const result = computeVertexMaxAngles(flatQuadPositions, flatQuadIndices);
            
            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(4);
        });

        it('should match computeEdgeAngles output', () => {
            const full = computeEdgeAngles(flatQuadPositions, flatQuadIndices);
            const simple = computeVertexMaxAngles(flatQuadPositions, flatQuadIndices);
            
            for (let i = 0; i < simple.length; i++) {
                expect(simple[i]).toBeCloseTo(full.vertexMaxAngles[i], 5);
            }
        });
    });

    describe('getSharpVertices', () => {
        it('should return vertices above threshold', () => {
            const angles = new Float32Array([0.1, 0.5, 1.0, 1.5, 2.0]);
            const sharp = getSharpVertices(angles, 1.0);
            
            expect(sharp).toBeInstanceOf(Uint32Array);
            expect(sharp.length).toBe(3);
            expect(Array.from(sharp)).toEqual([2, 3, 4]);
        });

        it('should return empty array if no vertices above threshold', () => {
            const angles = new Float32Array([0.1, 0.2, 0.3]);
            const sharp = getSharpVertices(angles, 1.0);
            
            expect(sharp.length).toBe(0);
        });
    });

    describe('radiansToDegrees', () => {
        it('should convert radians to degrees', () => {
            expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 5);
            expect(radiansToDegrees(Math.PI / 2)).toBeCloseTo(90, 5);
            expect(radiansToDegrees(0)).toBeCloseTo(0, 5);
        });
    });

    describe('L-shaped mesh (90 degree edge)', () => {
        it('should compute approximately π/2 for the 90 degree edge', () => {
            const result = computeEdgeAngles(lShapePositions, lShapeIndices);
            
            // The shared edge 0-1 should have approximately 90 degree angle
            const sharedEdgeAngle = result.edgeAngles.get('0_1');
            
            // Note: The exact angle depends on face orientation
            // For faces at 90 degrees, the angle between normals is π/2
            expect(sharedEdgeAngle).toBeCloseTo(Math.PI / 2, 1);
        });
    });

    describe('performance characteristics', () => {
        it('should handle larger meshes', () => {
            // Create a grid mesh (10x10 = 100 vertices, 162 triangles)
            const gridSize = 10;
            const positions = new Float32Array(gridSize * gridSize * 3);
            const indices = [];
            
            // Generate grid positions
            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    const idx = (y * gridSize + x) * 3;
                    positions[idx] = x;
                    positions[idx + 1] = y;
                    positions[idx + 2] = 0;
                }
            }
            
            // Generate triangles
            for (let y = 0; y < gridSize - 1; y++) {
                for (let x = 0; x < gridSize - 1; x++) {
                    const v0 = y * gridSize + x;
                    const v1 = v0 + 1;
                    const v2 = v0 + gridSize;
                    const v3 = v2 + 1;
                    
                    indices.push(v0, v1, v2);
                    indices.push(v1, v3, v2);
                }
            }
            
            const startTime = performance.now();
            const result = computeVertexMaxAngles(positions, indices);
            const endTime = performance.now();
            
            expect(result.length).toBe(gridSize * gridSize);
            
            // Interior vertices should have ~0 angle (flat surface)
            // This tests that the algorithm correctly identifies flat regions
            const interiorVertex = 5 * gridSize + 5; // Center-ish vertex
            expect(result[interiorVertex]).toBeCloseTo(0, 1);
            
            // Should complete quickly (< 100ms for this small mesh)
            expect(endTime - startTime).toBeLessThan(100);
        });
    });
});
