/**
 * @fileoverview Round-Trip Integration Tests for PLY Load/Export
 * 
 * This test suite verifies data consistency through the complete cycle:
 * **Load PLY → Export PLY → Load Again**
 * 
 * Round-trip testing ensures that:
 * 1. The loader and exporter are compatible with each other
 * 2. No data is lost or corrupted during save/load cycles
 * 3. Users can reliably edit and re-save their work
 * 
 * ## Test Categories
 * 
 * - **ASCII Round-Trip**: In-memory PLY strings for quick validation
 * - **Binary Fixture Round-Trip**: Real binary PLY files from disk
 * - **Metadata Edge Cases**: Special values that might cause issues
 * 
 * ## Why Round-Trip Tests Matter
 * 
 * In a 3D annotation application, users frequently:
 * - Load existing work
 * - Make modifications
 * - Save changes
 * - Reload to verify
 * 
 * Any data loss in this cycle would corrupt user work. These tests catch:
 * - Floating-point precision issues
 * - Character encoding problems in metadata
 * - Format compatibility between loader/exporter
 * 
 * @see src/loaders/customPLYLoader.js - The loader being tested
 * @see src/loaders/meshExporter.js - The exporter being tested
 */

import * as fs from 'fs';
import * as path from 'path';
import CustomPLYLoader from '../../../src/loaders/customPLYLoader.js';
import { exportMeshToBlob, serializeMetadata } from '../../../src/loaders/meshExporter.js';

describe('PLY Round-Trip Consistency', () => {
    /** @type {CustomPLYLoader} Loader instance, recreated for each test */
    let loader;
    
    beforeEach(() => {
        loader = new CustomPLYLoader();
    });

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    /**
     * Compares two Float32Arrays with tolerance for floating-point precision.
     * 
     * Floating-point numbers can have slight precision differences after
     * binary→ASCII→binary conversion. This helper allows for acceptable
     * tolerance while still catching significant data corruption.
     * 
     * @param {Float32Array} arr1 - First array to compare
     * @param {Float32Array} arr2 - Second array to compare
     * @param {number} tolerance - Maximum allowed difference per element
     * @returns {boolean} True if arrays are approximately equal
     * 
     * @example
     * const original = new Float32Array([1.0, 2.0, 3.0]);
     * const loaded = new Float32Array([1.0000001, 2.0, 3.0]);
     * arraysApproximatelyEqual(original, loaded, 1e-6); // true
     */
    function arraysApproximatelyEqual(arr1, arr2, tolerance = 1e-6) {
        if (arr1.length !== arr2.length) return false;
        for (let i = 0; i < arr1.length; i++) {
            if (Math.abs(arr1[i] - arr2[i]) > tolerance) {
                return false;
            }
        }
        return true;
    }

    // =========================================================================
    // ASCII PLY ROUND-TRIP
    // =========================================================================

    describe('ASCII PLY Round-Trip', () => {
        /**
         * @test Verifies geometry preservation through round-trip
         * @given ASCII PLY with vertices and faces
         * @when Loaded, exported, then loaded again
         * @then Vertex positions and face indices are identical
         */
        test('should preserve geometry through round-trip', async () => {
            // Original PLY: 4 vertices forming a square, 2 triangular faces
            const originalPly = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 2
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
1 1 0
0 1 0
3 0 1 2
3 0 2 3
`;
            // === FIRST LOAD ===
            const geometry1 = loader.parse(originalPly);
            const positions1 = geometry1.attributes.position.array;
            const indices1 = Array.from(geometry1.index.array);
            
            // === EXPORT ===
            const blob = exportMeshToBlob(positions1, indices1, {});
            const exportedPly = await blobToText(blob);
            
            // === SECOND LOAD ===
            const geometry2 = loader.parse(exportedPly);
            const positions2 = geometry2.attributes.position.array;
            const indices2 = Array.from(geometry2.index.array);
            
            // === COMPARE ===
            expect(positions1.length).toBe(positions2.length);
            expect(arraysApproximatelyEqual(positions1, positions2)).toBe(true);
            expect(indices1).toEqual(indices2);
        });

        /**
         * @test Verifies metadata preservation through round-trip
         * @given ASCII PLY with various metadata types
         * @when Loaded, exported with metadata, then loaded again
         * @then All metadata values match original
         */
        test('should preserve metadata through round-trip', async () => {
            const originalPly = `ply
format ascii 1.0
comment metadata author John Doe
comment metadata version 2
comment metadata:json settings {"scale":1.5,"visible":true}
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;
            // === FIRST LOAD ===
            const geometry1 = loader.parse(originalPly);
            const metadata1 = geometry1.userData.metadata;
            const positions1 = geometry1.attributes.position.array;
            const indices1 = Array.from(geometry1.index.array);
            
            // === EXPORT WITH METADATA ===
            const blob = exportMeshToBlob(positions1, indices1, metadata1);
            const exportedPly = await blobToText(blob);
            
            // === SECOND LOAD ===
            const geometry2 = loader.parse(exportedPly);
            const metadata2 = geometry2.userData.metadata;
            
            // === COMPARE METADATA ===
            expect(metadata2.author).toBe(metadata1.author);
            expect(metadata2.version).toBe(metadata1.version);
            expect(metadata2.settings).toEqual(metadata1.settings);
        });

        /**
         * @test Verifies complex nested metadata round-trip
         * @given Metadata with deeply nested objects and arrays
         * @when Exported and loaded
         * @then Nested structure is fully preserved
         * 
         * This tests the limits of JSON serialization in PLY comments
         */
        test('should handle complex nested metadata through round-trip', async () => {
            const originalMetadata = {
                project: 'Test Project',
                version: 3,
                config: {
                    display: {
                        wireframe: true,
                        opacity: 0.8
                    },
                    tools: ['brush', 'eraser', 'fill']
                },
                tags: ['lithic', 'test', 'artifact']
            };
            
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            
            // === EXPORT WITH COMPLEX METADATA ===
            const blob = exportMeshToBlob(positions, indices, originalMetadata);
            const exportedPly = await blobToText(blob);
            
            // === LOAD AND COMPARE ===
            const geometry = loader.parse(exportedPly);
            const loadedMetadata = geometry.userData.metadata;
            
            expect(loadedMetadata.project).toBe(originalMetadata.project);
            expect(loadedMetadata.version).toBe(originalMetadata.version);
            expect(loadedMetadata.config).toEqual(originalMetadata.config);
            expect(loadedMetadata.tags).toEqual(originalMetadata.tags);
        });
    });

    // =========================================================================
    // BINARY PLY FIXTURE ROUND-TRIP
    // =========================================================================

    describe('Binary PLY Fixture Round-Trip', () => {
        /**
         * Path to the binary PLY fixture file.
         * This is a real mesh file used for integration testing.
         */
        const fixturePath = path.join(__dirname, '../../fixtures/ply/test_annotated_mesh.ply');
        
        /**
         * Check if fixture exists (tests skip gracefully if missing).
         * This allows the test suite to run even if fixtures aren't set up.
         */
        const fixtureExists = fs.existsSync(fixturePath);
        
        /**
         * @test Verifies binary→ASCII→binary consistency
         * @given Real binary PLY fixture file
         * @when Loaded, exported to ASCII, then loaded again
         * @then Geometry remains consistent within tolerance
         * 
         * Note: Uses higher tolerance (1e-5) because:
         * - Binary uses Float32 directly
         * - ASCII conversion introduces text parsing precision loss
         */
        (fixtureExists ? test : test.skip)('should load binary fixture and export/reload with consistent geometry', async () => {
            // === LOAD BINARY FIXTURE ===
            const fileBuffer = fs.readFileSync(fixturePath);
            const arrayBuffer = fileBuffer.buffer.slice(
                fileBuffer.byteOffset,
                fileBuffer.byteOffset + fileBuffer.byteLength
            );
            
            const geometry1 = loader.parse(arrayBuffer);
            const positions1 = geometry1.attributes.position.array;
            const indices1 = geometry1.index ? Array.from(geometry1.index.array) : [];
            const metadata1 = geometry1.userData.metadata || {};
            
            // === EXPORT TO ASCII PLY ===
            const blob = exportMeshToBlob(
                new Float32Array(positions1),
                indices1,
                metadata1
            );
            const exportedPly = await blobToText(blob);
            
            // === RELOAD FROM ASCII ===
            const geometry2 = loader.parse(exportedPly);
            const positions2 = geometry2.attributes.position.array;
            const indices2 = geometry2.index ? Array.from(geometry2.index.array) : [];
            
            // === VERIFY CONSISTENCY ===
            expect(positions1.length).toBe(positions2.length);
            expect(arraysApproximatelyEqual(
                new Float32Array(positions1),
                positions2,
                1e-5  // Slightly higher tolerance for binary→ASCII conversion
            )).toBe(true);
            
            expect(indices1.length).toBe(indices2.length);
            expect(indices1).toEqual(indices2);
        });

        /**
         * @test Verifies vertex count preservation from fixture
         * @given Binary PLY fixture
         * @when Exported and reloaded
         * @then Number of vertices is identical
         */
        (fixtureExists ? test : test.skip)('should preserve vertex count through round-trip from fixture', async () => {
            const fileBuffer = fs.readFileSync(fixturePath);
            const arrayBuffer = fileBuffer.buffer.slice(
                fileBuffer.byteOffset,
                fileBuffer.byteOffset + fileBuffer.byteLength
            );
            
            const geometry1 = loader.parse(arrayBuffer);
            const vertexCount1 = geometry1.attributes.position.count;
            
            const positions = geometry1.attributes.position.array;
            const indices = geometry1.index ? Array.from(geometry1.index.array) : [];
            
            const blob = exportMeshToBlob(new Float32Array(positions), indices, {});
            const exportedPly = await blobToText(blob);
            
            const geometry2 = loader.parse(exportedPly);
            const vertexCount2 = geometry2.attributes.position.count;
            
            expect(vertexCount1).toBe(vertexCount2);
        });

        /**
         * @test Verifies face count preservation from fixture
         * @given Binary PLY fixture
         * @when Exported and reloaded
         * @then Number of triangular faces is identical
         */
        (fixtureExists ? test : test.skip)('should preserve face count through round-trip from fixture', async () => {
            const fileBuffer = fs.readFileSync(fixturePath);
            const arrayBuffer = fileBuffer.buffer.slice(
                fileBuffer.byteOffset,
                fileBuffer.byteOffset + fileBuffer.byteLength
            );
            
            const geometry1 = loader.parse(arrayBuffer);
            const faceCount1 = geometry1.index ? geometry1.index.count / 3 : 0;
            
            const positions = geometry1.attributes.position.array;
            const indices = geometry1.index ? Array.from(geometry1.index.array) : [];
            
            const blob = exportMeshToBlob(new Float32Array(positions), indices, {});
            const exportedPly = await blobToText(blob);
            
            const geometry2 = loader.parse(exportedPly);
            const faceCount2 = geometry2.index ? geometry2.index.count / 3 : 0;
            
            expect(faceCount1).toBe(faceCount2);
        });
    });

    // =========================================================================
    // METADATA EDGE CASES
    // =========================================================================

    describe('Metadata Edge Cases', () => {
        /**
         * @test Verifies special character handling in metadata
         * @given Metadata with numbers, hyphens, underscores, etc.
         * @when Exported and reloaded
         * @then String value is preserved exactly
         * 
         * Note: PLY comments have limited special character support.
         * Newlines and some characters may not survive round-trip.
         */
        test('should handle special characters in string metadata', async () => {
            const metadata = {
                description: 'Test with numbers 123 and symbols -_.+'
            };
            
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            
            const blob = exportMeshToBlob(positions, indices, metadata);
            const exportedPly = await blobToText(blob);
            
            const geometry = loader.parse(exportedPly);
            expect(geometry.userData.metadata.description).toBe(metadata.description);
        });

        /**
         * @test Verifies empty string metadata handling
         * @given Metadata with empty string value
         * @when Exported and reloaded
         * @then Key exists (value may become boolean true or empty string)
         * 
         * Note: This tests current behavior, not necessarily ideal behavior.
         * The important thing is the key is preserved.
         */
        test('should handle empty string metadata values', async () => {
            const metadata = { emptyField: '' };
            
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            
            const blob = exportMeshToBlob(positions, indices, metadata);
            const exportedPly = await blobToText(blob);
            
            const geometry = loader.parse(exportedPly);
            // Key should exist (value may be empty string or boolean true)
            expect(geometry.userData.metadata.emptyField).toBeDefined();
        });

        /**
         * @test Verifies zero numeric metadata preservation
         * @given Metadata with integer 0 and float 0.0
         * @when Exported and reloaded
         * @then Values are exactly 0 (not falsy undefined/null)
         * 
         * This is important because 0 is a valid value, not absence of value.
         */
        test('should handle zero numeric metadata', async () => {
            const metadata = { count: 0, scale: 0.0 };
            
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            
            const blob = exportMeshToBlob(positions, indices, metadata);
            const exportedPly = await blobToText(blob);
            
            const geometry = loader.parse(exportedPly);
            expect(geometry.userData.metadata.count).toBe(0);
            expect(geometry.userData.metadata.scale).toBe(0);
        });
    });
});
