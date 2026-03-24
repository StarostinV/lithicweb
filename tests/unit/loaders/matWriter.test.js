/**
 * @fileoverview Unit Tests for matWriter
 *
 * Tests the minimal MAT Level 5 binary writer. Verifies correct
 * binary structure (header, data elements) and round-trip compatibility
 * with the mat-for-js reader.
 *
 * @see src/loaders/matWriter.js
 */

import { writeMatFile } from '../../../src/loaders/matWriter.js';
import { read as readmat } from 'mat-for-js';

describe('matWriter', () => {
    // =========================================================================
    // HEADER VALIDATION
    // =========================================================================

    describe('MAT Level 5 header', () => {
        test('should produce a valid 128-byte header', () => {
            const buffer = writeMatFile([]);
            expect(buffer.byteLength).toBe(128);

            const view = new DataView(buffer);

            // Version at bytes 124-125: 0x0100 (little-endian)
            expect(view.getUint16(124, true)).toBe(0x0100);

            // Endian indicator at bytes 126-127: 0x4D49 ('MI' for little-endian)
            expect(view.getUint16(126, true)).toBe(0x4D49);
        });

        test('should contain descriptive text in first 116 bytes', () => {
            const buffer = writeMatFile([]);
            const bytes = new Uint8Array(buffer, 0, 116);
            const text = String.fromCharCode(...bytes).trimEnd();
            expect(text).toContain('MATLAB 5.0');
            expect(text).toContain('LithicWeb');
        });
    });

    // =========================================================================
    // ROUND-TRIP TESTS
    // =========================================================================

    describe('round-trip with mat-for-js reader', () => {
        test('should round-trip a single 1D double array', () => {
            const data = [1.5, 2.7, 3.14, 4.0, 5.0];
            const buffer = writeMatFile([
                { name: 'x', data, rows: 5, cols: 1, type: 'double' },
            ]);

            const result = readmat(buffer);
            expect(result.data.x).toBeDefined();

            // mat-for-js collapses Nx1 to 1D array
            const x = result.data.x;
            expect(x.length).toBe(5);
            for (let i = 0; i < 5; i++) {
                expect(x[i]).toBeCloseTo(data[i]);
            }
        });

        test('should round-trip a 3-vertex, 1-face mesh (vertices, faces, GL)', () => {
            // Triangle: 3 vertices, 1 face
            const vertices = [
                0, 0, 0,   // vertex 0
                1, 0, 0,   // vertex 1
                0, 1, 0,   // vertex 2
            ];
            const faces = [1, 2, 3]; // 1-indexed (MATLAB convention)
            const labels = [1];      // face label for the single face

            const buffer = writeMatFile([
                { name: 'vertices', data: vertices, rows: 3, cols: 3, type: 'double' },
                { name: 'faces', data: faces, rows: 1, cols: 3, type: 'double' },
                { name: 'GL', data: labels, rows: 1, cols: 1, type: 'uint16' },
            ]);

            const result = readmat(buffer);

            // Verify vertices: 3x3 nested array
            const v = result.data.vertices;
            expect(v.length).toBe(3);
            expect(v[0]).toEqual([0, 0, 0]);
            expect(v[1]).toEqual([1, 0, 0]);
            expect(v[2]).toEqual([0, 1, 0]);

            // Verify faces: 1x3 — mat-for-js collapses 1xN to 1D
            const f = result.data.faces;
            expect(f.length).toBe(3);
            expect(f[0]).toBe(1);
            expect(f[1]).toBe(2);
            expect(f[2]).toBe(3);

            // Verify GL: scalar (1x1 collapsed)
            const gl = result.data.GL;
            // mat-for-js collapses 1x1 to [value] (length-1 array)
            const glVal = Array.isArray(gl) ? gl[0] : gl;
            expect(glVal).toBe(1);
        });

        test('should store faces as 1-indexed values', () => {
            const faces = [1, 2, 3, 2, 4, 3]; // Two triangles, 1-indexed
            const buffer = writeMatFile([
                { name: 'f', data: faces, rows: 2, cols: 3, type: 'double' },
            ]);

            const result = readmat(buffer);
            const f = result.data.f;

            // All values should be >= 1
            const flat = f.flat();
            for (const val of flat) {
                expect(val).toBeGreaterThanOrEqual(1);
            }
            expect(flat).toEqual([1, 2, 3, 2, 4, 3]);
        });

        test('should correctly transpose to column-major (Nx3)', () => {
            // 4 vertices with distinct x, y, z values
            const data = [
                10, 20, 30,  // row 0
                11, 21, 31,  // row 1
                12, 22, 32,  // row 2
                13, 23, 33,  // row 3
            ];
            const buffer = writeMatFile([
                { name: 'v', data, rows: 4, cols: 3, type: 'double' },
            ]);

            const result = readmat(buffer);
            const v = result.data.v;

            // Should be a 4x3 nested array
            expect(v.length).toBe(4);
            expect(v[0]).toEqual([10, 20, 30]);
            expect(v[1]).toEqual([11, 21, 31]);
            expect(v[2]).toEqual([12, 22, 32]);
            expect(v[3]).toEqual([13, 23, 33]);
        });

        test('should handle uint16 arrays', () => {
            const labels = [0, 1, 2, 3, 1, 2];
            const buffer = writeMatFile([
                { name: 'GL', data: labels, rows: 6, cols: 1, type: 'uint16' },
            ]);

            const result = readmat(buffer);
            const gl = result.data.GL;
            expect(gl.length).toBe(6);
            expect(gl).toEqual([0, 1, 2, 3, 1, 2]);
        });

        test('should handle arrows as Kx2 double array', () => {
            const arrows = [10, 20, 30, 40]; // 2 arrows: (10,20) and (30,40)
            const buffer = writeMatFile([
                { name: 'arrows', data: arrows, rows: 2, cols: 2, type: 'double' },
            ]);

            const result = readmat(buffer);
            const a = result.data.arrows;
            expect(a.length).toBe(2);
            expect(a[0]).toEqual([10, 20]);
            expect(a[1]).toEqual([30, 40]);
        });

        test('should handle multiple variables in one file', () => {
            const buffer = writeMatFile([
                { name: 'vertices', data: [1, 2, 3, 4, 5, 6], rows: 2, cols: 3, type: 'double' },
                { name: 'faces', data: [1, 2, 3], rows: 1, cols: 3, type: 'double' },
                { name: 'GL', data: [5], rows: 1, cols: 1, type: 'uint16' },
            ]);

            const result = readmat(buffer);
            expect(result.data.vertices).toBeDefined();
            expect(result.data.faces).toBeDefined();
            expect(result.data.GL).toBeDefined();
        });

        test('should round-trip Artifact3D variables (Tuzy, RTia, Vp1, Mm)', () => {
            const eye3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
            const mm = [42.5, 1, 2, 3, 0.1, 0.2, 0.3, 10, 20, 30];

            const buffer = writeMatFile([
                { name: 'Tuzy', data: eye3, rows: 3, cols: 3, type: 'double' },
                { name: 'RTia', data: eye3, rows: 3, cols: 3, type: 'double' },
                { name: 'Vp1',  data: [42.5], rows: 1, cols: 1, type: 'double' },
                { name: 'Mm',   data: mm, rows: 1, cols: 10, type: 'double' },
            ]);

            const result = readmat(buffer);

            // Tuzy: 3x3 identity
            const T = result.data.Tuzy;
            expect(T.length).toBe(3);
            expect(T[0]).toEqual([1, 0, 0]);
            expect(T[1]).toEqual([0, 1, 0]);
            expect(T[2]).toEqual([0, 0, 1]);

            // RTia: same as Tuzy
            expect(result.data.RTia).toEqual(T);

            // Vp1: scalar (mat-for-js collapses 1x1)
            const vp1 = result.data.Vp1;
            const vp1Val = Array.isArray(vp1) ? vp1[0] : vp1;
            expect(vp1Val).toBeCloseTo(42.5);

            // Mm: 1x10 (mat-for-js collapses 1xN to 1D)
            const Mm = result.data.Mm;
            expect(Mm.length).toBe(10);
            for (let i = 0; i < 10; i++) {
                expect(Mm[i]).toBeCloseTo(mm[i]);
            }
        });
    });

    // =========================================================================
    // LEGACY v/f NAMING BACKWARD COMPATIBILITY
    // =========================================================================

    describe('legacy v/f naming backward compatibility', () => {
        /**
         * Helper that mimics readMAT's fallback logic:
         *   vertices || v,  faces || f
         */
        function readMeshVars(matData) {
            const positions = (matData['vertices'] || matData['v'] || []).flat();
            const indices = (matData['faces'] || matData['f'] || []).flat();
            return { positions, indices };
        }

        test('should read old-format files with v and f', () => {
            const buffer = writeMatFile([
                { name: 'v', data: [0, 0, 0, 1, 0, 0, 0, 1, 0], rows: 3, cols: 3, type: 'double' },
                { name: 'f', data: [1, 2, 3], rows: 1, cols: 3, type: 'double' },
                { name: 'GL', data: [1], rows: 1, cols: 1, type: 'uint16' },
            ]);

            const result = readmat(buffer);
            const { positions, indices } = readMeshVars(result.data);

            expect(positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            expect(indices).toEqual([1, 2, 3]);
        });

        test('should read new-format files with vertices and faces', () => {
            const buffer = writeMatFile([
                { name: 'vertices', data: [0, 0, 0, 1, 0, 0, 0, 1, 0], rows: 3, cols: 3, type: 'double' },
                { name: 'faces', data: [1, 2, 3], rows: 1, cols: 3, type: 'double' },
            ]);

            const result = readmat(buffer);
            const { positions, indices } = readMeshVars(result.data);

            expect(positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            expect(indices).toEqual([1, 2, 3]);
        });

        test('should prefer vertices/faces over v/f when both present', () => {
            const buffer = writeMatFile([
                { name: 'vertices', data: [10, 20, 30], rows: 1, cols: 3, type: 'double' },
                { name: 'v',        data: [99, 99, 99], rows: 1, cols: 3, type: 'double' },
                { name: 'faces',    data: [1, 2, 3],    rows: 1, cols: 3, type: 'double' },
                { name: 'f',        data: [9, 9, 9],    rows: 1, cols: 3, type: 'double' },
            ]);

            const result = readmat(buffer);
            const { positions, indices } = readMeshVars(result.data);

            expect(positions).toEqual([10, 20, 30]);
            expect(indices).toEqual([1, 2, 3]);
        });

        test('should handle file with only Artifact3D extras and no mesh', () => {
            const buffer = writeMatFile([
                { name: 'Tuzy', data: [1, 0, 0, 0, 1, 0, 0, 0, 1], rows: 3, cols: 3, type: 'double' },
            ]);

            const result = readmat(buffer);
            const { positions, indices } = readMeshVars(result.data);

            expect(positions).toEqual([]);
            expect(indices).toEqual([]);
        });
    });

    // =========================================================================
    // EDGE CASES
    // =========================================================================

    describe('edge cases', () => {
        test('should handle empty variable list', () => {
            const buffer = writeMatFile([]);
            expect(buffer.byteLength).toBe(128); // header only
        });

        test('should throw for unsupported type', () => {
            expect(() => {
                writeMatFile([{ name: 'x', data: [1], rows: 1, cols: 1, type: 'int64' }]);
            }).toThrow('Unsupported type');
        });
    });
});
