/**
 * @fileoverview Unit tests for OBJ file parser (geometry only)
 *
 * Tests cover:
 * - Position parsing
 * - Face formats: v, v/vt, v/vt/vn, v//vn
 * - Quad and n-gon triangulation
 * - Line ending variants
 *
 * Additionally, if real OBJ fixture files are present at
 * ../../../data/obj-files/, integration-style tests run against them.
 * These files are large (~50 MB) and not committed to git, so the
 * tests skip gracefully when the files are absent.
 *
 * @see src/loaders/objLoader.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseOBJ } from '../../../src/loaders/objLoader.js';

// =========================================================================
// INLINE TEST DATA
// =========================================================================

/** Minimal OBJ: single triangle, positions only */
const TRIANGLE_OBJ = `
# simple triangle
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;

/** OBJ with texture coordinates (v/vt format) */
const TEXTURED_TRIANGLE_OBJ = `
mtllib test.mtl
v 0 0 0
v 1 0 0
v 0 1 0
vt 0.0 0.0
vt 1.0 0.0
vt 0.5 1.0
usemtl MyMaterial
f 1/1 2/2 3/3
`;

/** OBJ with positions, UVs, and normals (v/vt/vn format) */
const FULL_FORMAT_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
vt 0.0 0.0
vt 1.0 0.0
vt 0.0 1.0
vt 1.0 1.0
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
f 2/2/1 4/4/1 3/3/1
`;

/** OBJ with normals but no UVs (v//vn format) */
const NO_UV_NORMALS_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 1
f 1//1 2//1 3//1
`;

/** OBJ with a quad face */
const QUAD_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;

// =========================================================================
// UNIT TESTS
// =========================================================================

describe('OBJ Parser', () => {

    test('should parse a single triangle', () => {
        const result = parseOBJ(TRIANGLE_OBJ);

        expect(result.positions.length).toBe(9);  // 3 vertices × 3
        expect(result.indices.length).toBe(3);     // 1 triangle

        // Check vertex values
        expect(result.positions[0]).toBe(0);
        expect(result.positions[3]).toBe(1);
        expect(result.positions[7]).toBe(1);

        // Check face indices (0-based)
        expect(result.indices).toEqual([0, 1, 2]);
    });

    test('should parse v/vt face format (ignores UVs, uses position indices only)', () => {
        const result = parseOBJ(TEXTURED_TRIANGLE_OBJ);

        expect(result.positions.length).toBe(9);
        expect(result.indices).toEqual([0, 1, 2]);
    });

    test('should parse v/vt/vn face format', () => {
        const result = parseOBJ(FULL_FORMAT_OBJ);

        expect(result.positions.length).toBe(12);  // 4 vertices × 3
        expect(result.indices.length).toBe(6);      // 2 triangles
        expect(result.indices).toEqual([0, 1, 2, 1, 3, 2]);
    });

    test('should parse v//vn face format (no UVs)', () => {
        const result = parseOBJ(NO_UV_NORMALS_OBJ);

        expect(result.positions.length).toBe(9);
        expect(result.indices).toEqual([0, 1, 2]);
    });

    test('should triangulate a quad into 2 triangles', () => {
        const result = parseOBJ(QUAD_OBJ);

        expect(result.positions.length).toBe(12);  // 4 vertices
        expect(result.indices.length).toBe(6);      // 2 triangles
        // Fan: (0,1,2) and (0,2,3)
        expect(result.indices).toEqual([0, 1, 2, 0, 2, 3]);
    });

    test('should handle Windows-style line endings (\\r\\n)', () => {
        const crlf = TRIANGLE_OBJ.replace(/\n/g, '\r\n');
        const result = parseOBJ(crlf);

        expect(result.positions.length).toBe(9);
        expect(result.indices).toEqual([0, 1, 2]);
    });

    test('should skip comments and blank lines', () => {
        const obj = `
# This is a comment
   # indented comment

v 0 0 0
v 1 0 0
v 0 1 0

f 1 2 3
`;
        const result = parseOBJ(obj);
        expect(result.positions.length).toBe(9);
        expect(result.indices).toEqual([0, 1, 2]);
    });
});


// =========================================================================
// FIXTURE TESTS — Real OBJ files (skip if not present)
// =========================================================================

describe('OBJ Fixture Tests (external files)', () => {

    const fixtureDir = path.resolve(__dirname, '../../../../data/obj-files');
    const objPath = path.join(fixtureDir, 'CTS_CP_R5-1485.obj');
    const fixtureExists = fs.existsSync(objPath);

    if (!fixtureExists) {
        test.skip('Skipping fixture tests — files not found at ' + fixtureDir, () => {});
    }

    const loadOBJText = () => fs.readFileSync(objPath, 'utf-8');

    (fixtureExists ? test : test.skip)(
        'should parse real OBJ file (175K vertices, 350K faces)',
        () => {
            const text = loadOBJText();
            const result = parseOBJ(text);

            // Known counts for CTS_CP_R5-1485.obj
            expect(result.positions.length).toBe(175002 * 3);
            expect(result.indices.length).toBe(350000 * 3);

            // No NaN values in positions
            let hasNaN = false;
            for (let i = 0; i < result.positions.length; i++) {
                if (isNaN(result.positions[i])) { hasNaN = true; break; }
            }
            expect(hasNaN).toBe(false);

            // All indices are valid
            const maxIdx = result.positions.length / 3 - 1;
            for (let i = 0; i < result.indices.length; i++) {
                expect(result.indices[i]).toBeGreaterThanOrEqual(0);
                expect(result.indices[i]).toBeLessThanOrEqual(maxIdx);
            }
        },
        30000  // 30s timeout for large file
    );
});
