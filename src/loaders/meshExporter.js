import { writeMatFile } from './matWriter.js';
import { erodeEdges } from '../geometry/ScarGraph.js';

/**
 * Metadata prefix used when writing metadata to PLY comments.
 * Must match the prefix used in customPLYLoader.js for consistency.
 */
const METADATA_PREFIX = 'metadata ';
const METADATA_JSON_PREFIX = 'metadata:json ';

/**
 * Trigger a browser file download from a Blob.
 * @param {Blob} blob - The file data
 * @param {string} filename - The download filename
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Serialize a metadata object into PLY comment lines.
 * - Simple values (string, number, boolean) are written as: "comment metadata key value"
 * - Complex values (objects, arrays) are written as: "comment metadata:json key {json}"
 * 
 * @param {Object} metadata - Key-value pairs to serialize
 * @returns {string} PLY comment lines for the metadata
 */
export function serializeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        return '';
    }

    const lines = [];
    
    for (const [key, value] of Object.entries(metadata)) {
        // Skip null/undefined values
        if (value === null || value === undefined) {
            continue;
        }
        
        // Validate key (no spaces or newlines allowed)
        if (/[\s\n\r]/.test(key)) {
            console.warn(`Skipping metadata key "${key}": keys cannot contain whitespace`);
            continue;
        }

        if (typeof value === 'object') {
            // Complex value: serialize as JSON
            try {
                const jsonStr = JSON.stringify(value);
                lines.push(`comment ${METADATA_JSON_PREFIX}${key} ${jsonStr}`);
            } catch (e) {
                console.warn(`Failed to serialize metadata key "${key}":`, e);
            }
        } else {
            // Simple value: string, number, or boolean
            lines.push(`comment ${METADATA_PREFIX}${key} ${value}`);
        }
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Export mesh with annotations, arrows, and metadata to a PLY file.
 * 
 * The exported PLY file contains:
 * - Vertex positions (x, y, z) and labels
 * - Face indices (triangles)
 * - Arrow elements (start_index, end_index)
 * - Metadata stored as PLY comments
 * 
 * @param {THREE.Mesh} mesh - The Three.js mesh to export
 * @param {Float32Array} meshColors - Vertex colors array (used to determine labels)
 * @param {Object} arrowDrawer - Arrow drawer containing arrows array
 * @param {MeshLoader} meshLoader - Mesh loader containing filename and metadata
 * @param {Object} [additionalMetadata={}] - Optional additional metadata to include
 */
export function exportAnnotations(mesh, meshColors, arrowDrawer, meshLoader, additionalMetadata = {}) {
    if (!mesh) {
        console.error("No mesh to export.");
        return;
    }

    // Get filename
    const fileName = (meshLoader.currentFileName || 'mesh') + '.ply';

    // Extract vertex data
    const positions = mesh.geometry.attributes.position.array;
    const indices = mesh.geometry.index.array;

    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;
    const arrowCount = arrowDrawer.arrows.length;

    // Merge metadata from meshLoader with additional metadata
    // Additional metadata takes precedence over loaded metadata
    const metadata = {
        ...(meshLoader.metadata || {}),
        ...additionalMetadata,
        // Add export timestamp
        exportedAt: new Date().toISOString()
    };

    // Serialize metadata to PLY comment lines
    const metadataComments = serializeMetadata(metadata);

    // PLY file header with metadata comments
    const header = `ply
format binary_little_endian 1.0
${metadataComments}element vertex ${vertexCount}
property float x
property float y
property float z
property int labels
element face ${faceCount}
property list uchar int vertex_indices
element arrow ${arrowCount}
property int start_index
property int end_index
end_header
`;

    // Calculate the size of the binary buffer
    const vertexElementSize = 4 * (3 + 1); // 3 floats (x, y, z) + 1 int (label)
    const faceElementSize = 1 + 3 * 4; // 1 uchar (vertex count) + 3 ints (vertex indices)
    const arrowElementSize = 2 * 4; // 2 ints (start_index, end_index)
    const headerSize = new TextEncoder().encode(header).length;
    const totalSize = headerSize + vertexCount * vertexElementSize + faceCount * faceElementSize + arrowCount * arrowElementSize;

    // Create the binary buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);
    let offset = 0;

    // Write the header
    const headerBytes = new TextEncoder().encode(header);
    for (let i = 0; i < headerBytes.length; i++) {
        dataView.setUint8(offset++, headerBytes[i]);
    }

    // Write the vertex data
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const label = meshColors[i * 3] === 1 ? 1 : 0; // Check if red component is 1 for the label

        dataView.setFloat32(offset, x, true); offset += 4;
        dataView.setFloat32(offset, y, true); offset += 4;
        dataView.setFloat32(offset, z, true); offset += 4;
        dataView.setInt32(offset, label, true); offset += 4;
    }

    // Write the face data
    for (let i = 0; i < faceCount; i++) {
        const i1 = indices[i * 3];
        const i2 = indices[i * 3 + 1];
        const i3 = indices[i * 3 + 2];

        dataView.setUint8(offset, 3); offset += 1; // Number of vertices per face
        dataView.setInt32(offset, i1, true); offset += 4;
        dataView.setInt32(offset, i2, true); offset += 4;
        dataView.setInt32(offset, i3, true); offset += 4;
    }

    // Write the arrow data
    for (let i = 0; i < arrowCount; i++) {
        const arrow = arrowDrawer.arrows[i];
        dataView.setInt32(offset, arrow.startIndex, true); offset += 4;
        dataView.setInt32(offset, arrow.endIndex, true); offset += 4;
    }

    // Create a Blob and trigger the download
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    triggerDownload(blob, fileName);
}

/**
 * Export mesh geometry with metadata to a PLY Blob (without downloading).
 * This is used for cloud upload where we need just the geometry and metadata,
 * not the annotations (which are saved separately).
 * 
 * @param {Float32Array} positions - Vertex positions array
 * @param {Uint32Array|Array} indices - Face indices array
 * @param {Object} metadata - Metadata to include in the PLY file
 * @returns {Blob} PLY file as a Blob
 */
export function exportMeshToBlob(positions, indices, metadata = {}) {
    const numVertices = positions.length / 3;
    const numFaces = indices.length / 3;
    
    // Serialize metadata to PLY comment lines
    const metadataComments = serializeMetadata(metadata);
    
    // Build PLY header with metadata comments (ASCII format for simplicity)
    let ply = 'ply\n';
    ply += 'format ascii 1.0\n';
    ply += metadataComments;
    ply += `element vertex ${numVertices}\n`;
    ply += 'property float x\n';
    ply += 'property float y\n';
    ply += 'property float z\n';
    ply += `element face ${numFaces}\n`;
    ply += 'property list uchar int vertex_indices\n';
    ply += 'end_header\n';
    
    // Add vertices
    for (let i = 0; i < numVertices; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        ply += `${x} ${y} ${z}\n`;
    }
    
    // Add faces
    for (let i = 0; i < numFaces; i++) {
        const a = indices[i * 3];
        const b = indices[i * 3 + 1];
        const c = indices[i * 3 + 2];
        ply += `3 ${a} ${b} ${c}\n`;
    }
    
    return new Blob([ply], { type: 'text/plain' });
}

// ============== MAT Export ==============

/**
 * Convert per-vertex segment labels to per-face labels.
 * Uses erodeEdges to first assign all edge vertices to segments,
 * then takes majority vote among each face's three vertices.
 *
 * @param {Array|Int32Array} faceLabels - Per-vertex segment labels (1-indexed, 0 = edge)
 * @param {Set<number>} edgeIndices - Vertex indices marked as edges
 * @param {Map<number, Set<number>>} adjacencyGraph - Vertex adjacency
 * @param {Uint32Array|Array} indices - Face vertex indices (flat, 0-indexed)
 * @param {number} vertexCount - Total number of vertices
 * @returns {Uint16Array} Per-face labels
 */
export function vertexLabelsToFaceLabels(faceLabels, edgeIndices, adjacencyGraph, indices, vertexCount) {
    const faceCount = indices.length / 3;

    // No annotations — return all zeros
    if (!faceLabels || faceLabels.length === 0) {
        return new Uint16Array(faceCount);
    }

    // Erode edges so every vertex gets a segment label.
    // If there are no edge vertices, erodeEdges is a no-op and labels pass through.
    const edgeSet = edgeIndices || new Set();
    const { workingLabels } = erodeEdges(faceLabels, edgeSet, adjacencyGraph || new Map(), vertexCount);

    const result = new Uint16Array(faceCount);
    for (let i = 0; i < faceCount; i++) {
        const v0 = workingLabels[indices[i * 3]];
        const v1 = workingLabels[indices[i * 3 + 1]];
        const v2 = workingLabels[indices[i * 3 + 2]];

        // Majority vote
        if (v0 === v1 || v0 === v2) {
            result[i] = v0;
        } else if (v1 === v2) {
            result[i] = v1;
        } else {
            result[i] = v0; // all different — pick first
        }
    }
    return result;
}

/**
 * Export mesh with annotations to a MATLAB .mat file.
 *
 * Exports variables: v (Nx3 vertices), f (Mx3 faces, 1-indexed),
 * GL (Mx1 face labels), and optionally arrows (Kx2, 1-indexed).
 *
 * @param {THREE.Mesh} mesh - The Three.js mesh
 * @param {Object} meshView - MeshView instance (provides faceLabels, edgeIndices, basicMesh)
 * @param {Object} arrowDrawer - Arrow drawer with arrows array
 * @param {MeshLoader} meshLoader - Mesh loader with filename
 */
export function exportAnnotationsToMAT(mesh, meshView, arrowDrawer, meshLoader) {
    if (!mesh) {
        console.error("No mesh to export.");
        return;
    }

    const fileName = (meshLoader.currentFileName || 'mesh') + '.mat';
    const positions = mesh.geometry.attributes.position.array;
    const indices = mesh.geometry.index.array;
    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;

    // v: Nx3 vertices as doubles (row-major flat — matWriter transposes to column-major)
    const vData = new Float64Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
        vData[i] = positions[i];
    }

    // f: Mx3 faces as doubles, converted from 0-indexed to 1-indexed
    const fData = new Float64Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
        fData[i] = indices[i] + 1;
    }

    // GL: Mx1 per-face labels
    const gl = vertexLabelsToFaceLabels(
        meshView.faceLabels,
        meshView.currentEdgeIndices,
        meshView.basicMesh?.adjacencyGraph,
        indices,
        vertexCount
    );

    const variables = [
        { name: 'v', data: vData, rows: vertexCount, cols: 3, type: 'double' },
        { name: 'f', data: fData, rows: faceCount, cols: 3, type: 'double' },
        { name: 'GL', data: gl, rows: faceCount, cols: 1, type: 'uint16' },
    ];

    // Add arrows if present
    if (arrowDrawer.arrows.length > 0) {
        const arrowCount = arrowDrawer.arrows.length;
        const arrowData = new Float64Array(arrowCount * 2);
        for (let i = 0; i < arrowCount; i++) {
            arrowData[i * 2] = arrowDrawer.arrows[i].startIndex + 1;
            arrowData[i * 2 + 1] = arrowDrawer.arrows[i].endIndex + 1;
        }
        variables.push({ name: 'arrows', data: arrowData, rows: arrowCount, cols: 2, type: 'double' });
    }

    const buffer = writeMatFile(variables);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    triggerDownload(blob, fileName);
}

// ============== Metadata Export ==============

/**
 * Flatten a nested object into dot-notation keys.
 * E.g., { a: { b: 1 } } → { 'a.b': 1 }
 *
 * @param {Object} obj - Object to flatten
 * @param {string} [prefix=''] - Key prefix for recursion
 * @returns {Object} Flat key-value pairs
 */
export function flattenObject(obj, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenObject(value, fullKey));
        } else {
            result[fullKey] = value;
        }
    }
    return result;
}

/**
 * Escape a value for CSV output. Wraps in quotes if the value contains
 * commas, quotes, or newlines. Doubles internal quotes per RFC 4180.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeCSV(value) {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

/**
 * Export mesh and annotation metadata as a JSON file.
 *
 * @param {MeshLoader} meshLoader - Provides mesh-level metadata and filename
 * @param {Object} meshView - MeshView instance providing annotation metadata
 */
export function exportMetadataToJSON(meshLoader, meshView) {
    const metadata = {
        mesh: meshLoader.metadata || {},
        annotation: meshView.getCurrentStateMetadata() || {},
        exportedAt: new Date().toISOString(),
        sourceFile: meshLoader.currentFileName || null,
    };

    const json = JSON.stringify(metadata, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, (meshLoader.currentFileName || 'metadata') + '_metadata.json');
}

/**
 * Export mesh and annotation metadata as a flat CSV file.
 * Nested objects are flattened with dot-notation keys.
 *
 * @param {MeshLoader} meshLoader - Provides mesh-level metadata and filename
 * @param {Object} meshView - MeshView instance providing annotation metadata
 */
export function exportMetadataToCSV(meshLoader, meshView) {
    const meshMeta = meshLoader.metadata || {};
    const annotMeta = meshView.getCurrentStateMetadata() || {};

    // Combine with annotation keys prefixed to avoid collisions
    const combined = {
        ...meshMeta,
    };
    for (const [key, value] of Object.entries(annotMeta)) {
        combined[`annotation.${key}`] = value;
    }
    combined['exportedAt'] = new Date().toISOString();
    combined['sourceFile'] = meshLoader.currentFileName || '';

    const flat = flattenObject(combined);
    const keys = Object.keys(flat);
    const header = keys.map(escapeCSV).join(',');
    const row = keys.map(k => escapeCSV(flat[k])).join(',');
    const csv = header + '\n' + row + '\n';

    const blob = new Blob([csv], { type: 'text/csv' });
    triggerDownload(blob, (meshLoader.currentFileName || 'metadata') + '_metadata.csv');
}
