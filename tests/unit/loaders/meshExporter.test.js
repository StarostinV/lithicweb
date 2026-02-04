/**
 * @fileoverview Unit Tests for meshExporter
 * 
 * This test suite verifies the PLY file export functionality, specifically
 * the metadata serialization and mesh-to-PLY blob generation.
 * 
 * ## Test Coverage
 * 
 * - **serializeMetadata**: Converting JS objects to PLY comment strings
 *   - Simple values (string, number, boolean)
 *   - Complex values (objects, arrays) as JSON
 *   - Edge cases (null, undefined, whitespace keys)
 * 
 * - **exportMeshToBlob**: Generating complete PLY files
 *   - Header structure validation
 *   - Vertex and face data output
 *   - Metadata embedding
 * 
 * ## PLY Metadata Format
 * 
 * The exporter writes metadata as PLY comments:
 * - Simple: `comment metadata <key> <value>`
 * - JSON: `comment metadata:json <key> <json_string>`
 * 
 * This format is compatible with the CustomPLYLoader for round-trip support.
 * 
 * @see src/loaders/meshExporter.js - The module being tested
 * @see tests/unit/loaders/customPLYLoader.test.js - Tests for the matching loader
 */

import { serializeMetadata, exportMeshToBlob } from '../../../src/loaders/meshExporter.js';

describe('meshExporter', () => {
    // =========================================================================
    // SERIALIZE METADATA
    // =========================================================================

    describe('serializeMetadata', () => {
        /**
         * @test Verifies basic string metadata serialization
         * @given Metadata object with a string value
         * @when serializeMetadata is called
         * @then Returns PLY comment line with key and value
         */
        test('should serialize simple string metadata', () => {
            const metadata = { author: 'John Doe' };
            const result = serializeMetadata(metadata);
            
            expect(result).toBe('comment metadata author John Doe\n');
        });

        /**
         * @test Verifies numeric metadata serialization
         * @given Metadata object with integer and float values
         * @when serializeMetadata is called
         * @then Returns PLY comment lines with numeric values
         */
        test('should serialize numeric metadata', () => {
            const metadata = { version: 2, scale: 1.5 };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata version 2');
            expect(result).toContain('comment metadata scale 1.5');
        });

        /**
         * @test Verifies boolean metadata serialization
         * @given Metadata object with true and false values
         * @when serializeMetadata is called
         * @then Returns PLY comment lines with 'true' and 'false' strings
         */
        test('should serialize boolean metadata', () => {
            const metadata = { enabled: true, visible: false };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata enabled true');
            expect(result).toContain('comment metadata visible false');
        });

        /**
         * @test Verifies object metadata serialization as JSON
         * @given Metadata object containing a nested object
         * @when serializeMetadata is called
         * @then Returns PLY comment line with 'metadata:json' prefix and JSON string
         */
        test('should serialize object metadata as JSON', () => {
            const metadata = { settings: { scale: 1.5, visible: true } };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata:json settings {"scale":1.5,"visible":true}');
        });

        /**
         * @test Verifies array metadata serialization as JSON
         * @given Metadata object containing an array
         * @when serializeMetadata is called
         * @then Returns PLY comment line with 'metadata:json' prefix and JSON array string
         */
        test('should serialize array metadata as JSON', () => {
            const metadata = { tags: ['tag1', 'tag2'] };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata:json tags ["tag1","tag2"]');
        });

        /**
         * @test Verifies null and undefined values are skipped
         * @given Metadata object with null and undefined values
         * @when serializeMetadata is called
         * @then Output does not contain those keys
         */
        test('should skip null and undefined values', () => {
            const metadata = { valid: 'yes', nullVal: null, undefinedVal: undefined };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata valid yes');
            expect(result).not.toContain('nullVal');
            expect(result).not.toContain('undefinedVal');
        });

        /**
         * @test Verifies keys with whitespace are rejected
         * @given Metadata object with a key containing spaces
         * @when serializeMetadata is called
         * @then Key is skipped and warning is logged
         * 
         * Note: PLY format doesn't support spaces in metadata keys
         */
        test('should skip keys with whitespace', () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            const metadata = { 'key with space': 'value', validKey: 'value' };
            const result = serializeMetadata(metadata);
            
            expect(result).not.toContain('key with space');
            expect(result).toContain('comment metadata validKey value');
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        /**
         * @test Verifies null input returns empty string
         * @given null or undefined as input
         * @when serializeMetadata is called
         * @then Returns empty string without error
         */
        test('should return empty string for null/undefined input', () => {
            expect(serializeMetadata(null)).toBe('');
            expect(serializeMetadata(undefined)).toBe('');
        });

        /**
         * @test Verifies non-object input returns empty string
         * @given Primitive values (string, number) as input
         * @when serializeMetadata is called
         * @then Returns empty string without error
         */
        test('should return empty string for non-object input', () => {
            expect(serializeMetadata('string')).toBe('');
            expect(serializeMetadata(123)).toBe('');
        });

        /**
         * @test Verifies empty object returns empty string
         * @given Empty object {}
         * @when serializeMetadata is called
         * @then Returns empty string
         */
        test('should handle empty metadata object', () => {
            expect(serializeMetadata({})).toBe('');
        });

        /**
         * @test Verifies deeply nested object serialization
         * @given Metadata with multiple levels of nesting
         * @when serializeMetadata is called
         * @then JSON is valid and can be parsed back
         */
        test('should handle nested objects in JSON metadata', () => {
            const metadata = {
                complex: {
                    nested: {
                        value: 42
                    },
                    array: [1, 2, { key: 'val' }]
                }
            };
            const result = serializeMetadata(metadata);
            
            expect(result).toContain('comment metadata:json complex');
            
            // Verify the JSON is valid by extracting and parsing it
            const jsonMatch = result.match(/comment metadata:json complex (.+)/);
            expect(jsonMatch).not.toBeNull();
            const parsed = JSON.parse(jsonMatch[1]);
            expect(parsed.nested.value).toBe(42);
        });
    });

    // =========================================================================
    // EXPORT MESH TO BLOB
    // =========================================================================

    describe('exportMeshToBlob', () => {
        /**
         * @test Verifies basic PLY blob generation
         * @given Positions array, indices array, and metadata
         * @when exportMeshToBlob is called
         * @then Returns Blob with valid ASCII PLY content
         */
        test('should create valid ASCII PLY blob', async () => {
            // Simple triangle geometry
            const positions = new Float32Array([
                0, 0, 0,  // Vertex 0: origin
                1, 0, 0,  // Vertex 1: +X
                0, 1, 0   // Vertex 2: +Y
            ]);
            const indices = [0, 1, 2];
            const metadata = { author: 'Test' };
            
            const blob = exportMeshToBlob(positions, indices, metadata);
            
            // Verify blob type
            expect(blob).toBeInstanceOf(Blob);
            expect(blob.type).toBe('text/plain');
            
            // Verify PLY content structure
            const text = await blobToText(blob);
            expect(text).toContain('ply');
            expect(text).toContain('format ascii 1.0');
            expect(text).toContain('element vertex 3');
            expect(text).toContain('element face 1');
            expect(text).toContain('comment metadata author Test');
            expect(text).toContain('end_header');
        });

        /**
         * @test Verifies correct vertex count and data
         * @given Multiple vertices forming two triangles
         * @when exportMeshToBlob is called
         * @then PLY contains correct vertex count and coordinate data
         */
        test('should include all vertices in PLY output', async () => {
            const positions = new Float32Array([
                0, 0, 0,  // Vertex 0
                1, 0, 0,  // Vertex 1
                0, 1, 0,  // Vertex 2
                1, 1, 0   // Vertex 3
            ]);
            const indices = [0, 1, 2, 1, 3, 2];  // Two triangles
            
            const blob = exportMeshToBlob(positions, indices, {});
            const text = await blobToText(blob);
            
            // Verify header counts
            expect(text).toContain('element vertex 4');
            expect(text).toContain('element face 2');
            
            // Verify vertex data is present in body
            expect(text).toContain('0 0 0');
            expect(text).toContain('1 0 0');
            expect(text).toContain('0 1 0');
            expect(text).toContain('1 1 0');
        });

        /**
         * @test Verifies face index output format
         * @given Simple triangle with indices
         * @when exportMeshToBlob is called
         * @then PLY contains face data in correct format (count followed by indices)
         */
        test('should include face indices in PLY output', async () => {
            const positions = new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0
            ]);
            const indices = [0, 1, 2];
            
            const blob = exportMeshToBlob(positions, indices, {});
            const text = await blobToText(blob);
            
            // PLY face format: "3 v1 v2 v3" where 3 = number of vertices
            expect(text).toContain('3 0 1 2');
        });

        /**
         * @test Verifies PLY generation without metadata
         * @given Geometry data with empty metadata object
         * @when exportMeshToBlob is called
         * @then PLY is valid and contains no metadata comments
         */
        test('should handle empty metadata', async () => {
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            
            const blob = exportMeshToBlob(positions, indices, {});
            const text = await blobToText(blob);
            
            // Valid PLY structure
            expect(text).toContain('ply');
            expect(text).toContain('end_header');
            
            // No metadata comments present
            expect(text).not.toContain('comment metadata');
        });

        /**
         * @test Verifies complex metadata embedding
         * @given Geometry with various metadata types
         * @when exportMeshToBlob is called
         * @then PLY contains correctly formatted metadata comments
         */
        test('should serialize complex metadata in PLY', async () => {
            const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
            const indices = [0, 1, 2];
            const metadata = {
                author: 'Test Author',   // String
                version: 1,              // Number
                settings: { scale: 2.0 } // Object (becomes JSON)
            };
            
            const blob = exportMeshToBlob(positions, indices, metadata);
            const text = await blobToText(blob);
            
            // Verify all metadata types are serialized
            expect(text).toContain('comment metadata author Test Author');
            expect(text).toContain('comment metadata version 1');
            expect(text).toContain('comment metadata:json settings');
        });
    });
});
