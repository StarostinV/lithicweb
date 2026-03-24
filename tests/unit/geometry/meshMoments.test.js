/**
 * @fileoverview Unit tests for meshMoments
 *
 * Verifies volume and moment computation against known analytic results
 * for simple closed meshes (unit cube, tetrahedron).
 */

import { computeMeshMoments } from '../../../src/geometry/meshMoments.js';

describe('computeMeshMoments', () => {
    /**
     * Unit cube with origin at (0,0,0), side length 1.
     * 8 vertices, 12 triangular faces (2 per cube face).
     * Known volume = 1.0, center of mass at (0.5, 0.5, 0.5).
     */
    function makeUnitCube() {
        // prettier-ignore
        const positions = new Float32Array([
            0,0,0,  1,0,0,  1,1,0,  0,1,0,   // z=0 face
            0,0,1,  1,0,1,  1,1,1,  0,1,1,   // z=1 face
        ]);
        // 12 triangles, outward-facing normals (right-hand rule)
        // prettier-ignore
        const indices = [
            // front (z=1): 4,5,6  4,6,7
            4,6,5,  4,7,6,
            // back (z=0): 0,1,2  0,2,3  (reversed winding)
            0,1,2,  0,2,3,
            // right (x=1): 1,5,6  1,6,2
            1,5,6,  1,6,2,
            // left (x=0): 0,3,7  0,7,4
            0,3,7,  0,7,4,
            // top (y=1): 3,2,6  3,6,7
            3,2,6,  3,6,7,
            // bottom (y=0): 0,4,5  0,5,1
            0,4,5,  0,5,1,
        ];
        return { positions, indices };
    }

    test('unit cube volume should be 1.0', () => {
        const { positions, indices } = makeUnitCube();
        const { Vp1, Mm } = computeMeshMoments(positions, indices);

        expect(Math.abs(Vp1)).toBeCloseTo(1.0, 4);
        expect(Math.abs(Mm[0])).toBeCloseTo(1.0, 4); // Mm[0] == V
    });

    test('unit cube center of mass at (0.5, 0.5, 0.5)', () => {
        const { positions, indices } = makeUnitCube();
        const { Vp1, Mm } = computeMeshMoments(positions, indices);

        const V = Math.abs(Vp1);
        const sign = Math.sign(Vp1);
        // center of mass = first moments / volume
        expect(sign * Mm[1] / V).toBeCloseTo(0.5, 4); // Mx/V
        expect(sign * Mm[2] / V).toBeCloseTo(0.5, 4); // My/V
        expect(sign * Mm[3] / V).toBeCloseTo(0.5, 4); // Mz/V
    });

    test('unit cube second moments', () => {
        const { positions, indices } = makeUnitCube();
        const { Vp1, Mm } = computeMeshMoments(positions, indices);

        const sign = Math.sign(Vp1);
        // ∫x² dV over [0,1]³ = 1/3
        expect(sign * Mm[7]).toBeCloseTo(1 / 3, 4);  // Mx²
        expect(sign * Mm[8]).toBeCloseTo(1 / 3, 4);  // My²
        expect(sign * Mm[9]).toBeCloseTo(1 / 3, 4);  // Mz²

        // ∫xy dV over [0,1]³ = 1/4
        expect(sign * Mm[4]).toBeCloseTo(1 / 4, 4);  // Mxy
        expect(sign * Mm[5]).toBeCloseTo(1 / 4, 4);  // Mzy
        expect(sign * Mm[6]).toBeCloseTo(1 / 4, 4);  // Mzx
    });

    test('returns Float64Array of length 10 for Mm', () => {
        const { positions, indices } = makeUnitCube();
        const { Mm } = computeMeshMoments(positions, indices);

        expect(Mm).toBeInstanceOf(Float64Array);
        expect(Mm.length).toBe(10);
    });

    test('empty mesh returns all zeros', () => {
        const { Vp1, Mm } = computeMeshMoments(new Float32Array(0), []);

        expect(Vp1).toBe(0);
        expect(Mm.every(v => v === 0)).toBe(true);
    });

    /**
     * Regular tetrahedron with one vertex at origin.
     * Vertices: (0,0,0), (1,0,0), (0,1,0), (0,0,1)
     * Known volume = 1/6.
     */
    test('tetrahedron volume should be 1/6', () => {
        // prettier-ignore
        const positions = new Float32Array([
            0,0,0,  1,0,0,  0,1,0,  0,0,1,
        ]);
        // 4 faces with outward normals
        // prettier-ignore
        const indices = [
            0,2,1,  // base z=0
            0,1,3,  // front
            0,3,2,  // left
            1,2,3,  // hypotenuse
        ];

        const { Vp1 } = computeMeshMoments(positions, indices);
        expect(Math.abs(Vp1)).toBeCloseTo(1 / 6, 5);
    });
});
