/**
 * @fileoverview Unit Tests for CustomPLYLoader
 * 
 * This test suite verifies the PLY file parsing functionality of the
 * CustomPLYLoader class, which extends Three.js's PLYLoader with support
 * for metadata and custom elements.
 * 
 * ## Test Coverage
 * 
 * - **ASCII Format Parsing**: Standard PLY parsing (vertices, faces, quads)
 * - **Custom Attributes**: Labels, labelId, and arrow elements
 * - **Metadata Extraction**: Simple values, JSON objects, type coercion
 * - **Binary Format Parsing**: Little-endian and big-endian formats
 * - **Edge Cases**: Empty files, point clouds, malformed data
 * 
 * ## PLY File Format Reference
 * 
 * PLY files consist of:
 * 1. Header (ASCII text) - declares format, elements, and properties
 * 2. Body (ASCII or binary) - contains the actual data
 * 
 * ### Metadata Convention
 * 
 * This loader supports custom metadata in PLY comments:
 * - Simple: `comment metadata key value`
 * - JSON: `comment metadata:json key {"nested":"data"}`
 * 
 * @see src/loaders/customPLYLoader.js - The module being tested
 * @see https://en.wikipedia.org/wiki/PLY_(file_format) - PLY format spec
 */

import CustomPLYLoader from '../../../src/loaders/customPLYLoader.js';

describe('CustomPLYLoader', () => {
    /** @type {CustomPLYLoader} Loader instance, recreated for each test */
    let loader;

    beforeEach(() => {
        loader = new CustomPLYLoader();
    });

    // =========================================================================
    // ASCII FORMAT PARSING
    // =========================================================================

    describe('ASCII Format Parsing', () => {
        /**
         * @test Verifies basic triangle parsing from ASCII PLY
         * @given A minimal ASCII PLY string with 3 vertices and 1 face
         * @when The PLY data is parsed
         * @then Geometry contains correct positions and face indices
         */
        test('should parse a minimal ASCII PLY with single triangle', () => {
            // Minimal valid PLY: 3 vertices forming a right triangle at origin
            const plyData = `ply
format ascii 1.0
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
            const geometry = loader.parse(plyData);
            
            // Verify vertex positions (3 vertices × 3 components = 9 values)
            const positions = geometry.attributes.position.array;
            expect(positions.length).toBe(9);
            expect(positions[0]).toBe(0); // First vertex: x=0
            expect(positions[3]).toBe(1); // Second vertex: x=1
            expect(positions[7]).toBe(1); // Third vertex: y=1
            
            // Verify face indices (single triangle)
            const indices = geometry.index.array;
            expect(indices.length).toBe(3);
            expect(Array.from(indices)).toEqual([0, 1, 2]);
        });

        /**
         * @test Verifies quad face triangulation
         * @given ASCII PLY with a quad (4-vertex face)
         * @when The PLY data is parsed
         * @then Quad is converted to 2 triangles (6 indices)
         * 
         * Note: PLY quads are split into triangles: [0,1,2,3] → [0,1,3] + [1,2,3]
         */
        test('should parse ASCII PLY with quad faces (converted to triangles)', () => {
            const plyData = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
1 1 0
0 1 0
4 0 1 2 3
`;
            const geometry = loader.parse(plyData);
            
            // Quad should be split into 2 triangles (6 indices total)
            const indices = geometry.index.array;
            expect(indices.length).toBe(6);
        });

        /**
         * @test Verifies per-vertex labels attribute parsing
         * @given ASCII PLY with 'labels' property on vertices
         * @when The PLY data is parsed
         * @then Geometry has 'labels' attribute with correct values
         * 
         * Labels are used for annotation data (0 = unmarked, 1 = marked edge)
         */
        test('should parse vertex labels attribute', () => {
            const plyData = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property int labels
element face 1
property list uchar int vertex_indices
end_header
0 0 0 1
1 0 0 0
0 1 0 1
3 0 1 2
`;
            const geometry = loader.parse(plyData);
            
            expect(geometry.attributes.labels).toBeDefined();
            const labels = geometry.attributes.labels.array;
            expect(labels.length).toBe(3);
            expect(Array.from(labels)).toEqual([1, 0, 1]);
        });

        /**
         * @test Verifies per-vertex labelid attribute parsing
         * @given ASCII PLY with 'labelid' property on vertices
         * @when The PLY data is parsed
         * @then Geometry has 'labelid' attribute with segment IDs
         * 
         * LabelId identifies which segment/region each vertex belongs to
         */
        test('should parse vertex labelid attribute', () => {
            const plyData = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property int labelid
element face 1
property list uchar int vertex_indices
end_header
0 0 0 5
1 0 0 5
0 1 0 7
3 0 1 2
`;
            const geometry = loader.parse(plyData);
            
            expect(geometry.attributes.labelid).toBeDefined();
            const labelIds = geometry.attributes.labelid.array;
            expect(labelIds.length).toBe(3);
            expect(Array.from(labelIds)).toEqual([5, 5, 7]);
        });

        /**
         * @test Verifies custom 'arrow' element parsing
         * @given ASCII PLY with arrow elements (vertex-to-vertex pointers)
         * @when The PLY data is parsed
         * @then Arrows are stored in geometry.userData.arrows
         * 
         * Arrows represent directional indicators between mesh vertices
         */
        test('should parse arrow elements', () => {
            const plyData = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
element arrow 2
property int start_index
property int end_index
end_header
0 0 0
1 0 0
0 1 0
0 0 1
3 0 1 2
0 1
2 3
`;
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.arrows).toBeDefined();
            expect(geometry.userData.arrows.length).toBe(2);
            expect(geometry.userData.arrows[0]).toEqual({ startIndex: 0, endIndex: 1 });
            expect(geometry.userData.arrows[1]).toEqual({ startIndex: 2, endIndex: 3 });
        });
    });

    // =========================================================================
    // METADATA PARSING
    // =========================================================================

    describe('Metadata Parsing', () => {
        /**
         * @test Verifies simple string metadata extraction
         * @given PLY with `comment metadata key value` lines
         * @when The PLY data is parsed
         * @then Metadata object contains key-value pairs as strings
         */
        test('should parse simple string metadata', () => {
            const plyData = `ply
format ascii 1.0
comment metadata author John Doe
comment metadata project Test Project
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata).toBeDefined();
            expect(geometry.userData.metadata.author).toBe('John Doe');
            expect(geometry.userData.metadata.project).toBe('Test Project');
        });

        /**
         * @test Verifies numeric metadata is parsed as numbers
         * @given PLY with numeric values in metadata comments
         * @when The PLY data is parsed
         * @then Metadata values are JavaScript numbers (not strings)
         */
        test('should parse numeric metadata', () => {
            const plyData = `ply
format ascii 1.0
comment metadata version 2
comment metadata scale 1.5
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata.version).toBe(2);
            expect(typeof geometry.userData.metadata.version).toBe('number');
            expect(geometry.userData.metadata.scale).toBe(1.5);
            expect(typeof geometry.userData.metadata.scale).toBe('number');
        });

        /**
         * @test Verifies boolean metadata coercion
         * @given PLY with 'true' and 'false' string values in metadata
         * @when The PLY data is parsed
         * @then Metadata values are JavaScript booleans
         */
        test('should parse boolean metadata', () => {
            const plyData = `ply
format ascii 1.0
comment metadata enabled true
comment metadata visible false
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata.enabled).toBe(true);
            expect(typeof geometry.userData.metadata.enabled).toBe('boolean');
            expect(geometry.userData.metadata.visible).toBe(false);
            expect(typeof geometry.userData.metadata.visible).toBe('boolean');
        });

        /**
         * @test Verifies JSON metadata parsing
         * @given PLY with `comment metadata:json key {...}` lines
         * @when The PLY data is parsed
         * @then Metadata values are parsed JavaScript objects/arrays
         */
        test('should parse JSON metadata', () => {
            const plyData = `ply
format ascii 1.0
comment metadata:json settings {"scale":1.5,"visible":true}
comment metadata:json tags ["tag1","tag2","tag3"]
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata.settings).toEqual({ scale: 1.5, visible: true });
            expect(geometry.userData.metadata.tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        /**
         * @test Verifies graceful handling of invalid JSON
         * @given PLY with malformed JSON in metadata:json comment
         * @when The PLY data is parsed
         * @then Parse completes without throwing, value stored as string
         */
        test('should handle malformed JSON metadata gracefully', () => {
            const plyData = `ply
format ascii 1.0
comment metadata:json broken {invalid json}
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
            // Should not throw - malformed JSON is stored as string fallback
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata.broken).toBe('{invalid json}');
        });

        /**
         * @test Verifies metadata comments are separated from regular comments
         * @given PLY with both regular comments and metadata comments
         * @when The PLY data is parsed
         * @then Regular comments go to userData.comments, metadata to userData.metadata
         */
        test('should separate regular comments from metadata', () => {
            const plyData = `ply
format ascii 1.0
comment This is a regular comment
comment metadata author Test
comment Another regular comment
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
            const geometry = loader.parse(plyData);
            
            // Metadata goes to userData.metadata
            expect(geometry.userData.metadata.author).toBe('Test');
            
            // Regular comments go to userData.comments array
            expect(geometry.userData.comments).toContain('This is a regular comment');
            expect(geometry.userData.comments).toContain('Another regular comment');
            expect(geometry.userData.comments.length).toBe(2);
        });

        /**
         * @test Verifies key-only metadata becomes boolean true
         * @given PLY with `comment metadata keyOnly` (no value)
         * @when The PLY data is parsed
         * @then Metadata key exists with value `true`
         */
        test('should handle metadata key with no value as boolean true', () => {
            const plyData = `ply
format ascii 1.0
comment metadata flagEnabled
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata.flagEnabled).toBe(true);
        });
    });

    // =========================================================================
    // BINARY FORMAT PARSING
    // =========================================================================

    describe('Binary Format Parsing', () => {
        /**
         * Creates a binary PLY ArrayBuffer for testing.
         * 
         * Generates a minimal valid binary PLY file with:
         * - 3 vertices (triangle at origin)
         * - 1 face
         * - Test metadata comment
         * 
         * @param {boolean} littleEndian - True for little-endian, false for big-endian
         * @returns {ArrayBuffer} Complete binary PLY data
         */
        function createBinaryPLY(littleEndian = true) {
            const format = littleEndian ? 'binary_little_endian' : 'binary_big_endian';
            const header = `ply
format ${format} 1.0
comment metadata test binary
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
`;
            const headerBytes = new TextEncoder().encode(header);
            
            // Calculate binary body size
            // Vertices: 3 vertices × 3 floats × 4 bytes = 36 bytes
            // Face: 1 uchar (count) + 3 ints × 4 bytes = 13 bytes
            const vertexSize = 3 * 4 * 3;
            const faceSize = 1 + 3 * 4;
            const totalSize = headerBytes.length + vertexSize + faceSize;
            
            const buffer = new ArrayBuffer(totalSize);
            const view = new DataView(buffer);
            const uint8View = new Uint8Array(buffer);
            
            // Write ASCII header
            uint8View.set(headerBytes, 0);
            let offset = headerBytes.length;
            
            // Write binary vertex data
            const vertices = [
                [0, 0, 0],  // Origin
                [1, 0, 0],  // +X
                [0, 1, 0]   // +Y
            ];
            for (const [x, y, z] of vertices) {
                view.setFloat32(offset, x, littleEndian); offset += 4;
                view.setFloat32(offset, y, littleEndian); offset += 4;
                view.setFloat32(offset, z, littleEndian); offset += 4;
            }
            
            // Write binary face data (triangle with 3 indices)
            view.setUint8(offset, 3); offset += 1;  // Vertex count
            view.setInt32(offset, 0, littleEndian); offset += 4;
            view.setInt32(offset, 1, littleEndian); offset += 4;
            view.setInt32(offset, 2, littleEndian); offset += 4;
            
            return buffer;
        }

        /**
         * @test Verifies little-endian binary PLY parsing
         * @given Binary PLY in little-endian format (most common)
         * @when The PLY data is parsed
         * @then Geometry and metadata are correctly extracted
         */
        test('should parse binary little-endian PLY', () => {
            const buffer = createBinaryPLY(true);
            const geometry = loader.parse(buffer);
            
            // Verify vertex positions
            const positions = geometry.attributes.position.array;
            expect(positions.length).toBe(9);
            expect(positions[0]).toBe(0);  // First vertex x
            expect(positions[3]).toBe(1);  // Second vertex x
            
            // Verify face indices
            const indices = geometry.index.array;
            expect(indices.length).toBe(3);
            expect(Array.from(indices)).toEqual([0, 1, 2]);
            
            // Verify metadata was parsed from header comments
            expect(geometry.userData.metadata.test).toBe('binary');
        });

        /**
         * @test Verifies big-endian binary PLY parsing
         * @given Binary PLY in big-endian format
         * @when The PLY data is parsed
         * @then Geometry is correctly extracted with proper byte order
         */
        test('should parse binary big-endian PLY', () => {
            const buffer = createBinaryPLY(false);
            const geometry = loader.parse(buffer);
            
            const positions = geometry.attributes.position.array;
            expect(positions.length).toBe(9);
            
            const indices = geometry.index.array;
            expect(indices.length).toBe(3);
        });
    });

    // =========================================================================
    // EDGE CASES
    // =========================================================================

    describe('Edge Cases', () => {
        /**
         * @test Verifies handling of PLY with no metadata or comments
         * @given PLY file with no comment lines
         * @when The PLY data is parsed
         * @then userData contains empty metadata object and comments array
         */
        test('should handle empty metadata', () => {
            const plyData = `ply
format ascii 1.0
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.metadata).toEqual({});
            expect(geometry.userData.comments).toEqual([]);
        });

        /**
         * @test Verifies point cloud support (vertices without faces)
         * @given PLY with only vertex elements, no face element
         * @when The PLY data is parsed
         * @then Geometry has positions but null index
         */
        test('should handle PLY with no faces (point cloud)', () => {
            const plyData = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
end_header
0 0 0
1 0 0
0 1 0
`;
            const geometry = loader.parse(plyData);
            
            const positions = geometry.attributes.position.array;
            expect(positions.length).toBe(9);
            expect(geometry.index).toBeNull();
        });

        /**
         * @test Verifies handling of PLY without arrow elements
         * @given Standard PLY with vertices and faces but no arrows
         * @when The PLY data is parsed
         * @then userData.arrows is an empty array
         */
        test('should handle PLY with no arrows', () => {
            const plyData = `ply
format ascii 1.0
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
            const geometry = loader.parse(plyData);
            
            expect(geometry.userData.arrows).toEqual([]);
        });
    });
});
