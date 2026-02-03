/**
 * Metadata prefix used when writing metadata to PLY comments.
 * Must match the prefix used in customPLYLoader.js for consistency.
 */
const METADATA_PREFIX = 'metadata ';
const METADATA_JSON_PREFIX = 'metadata:json ';

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

    // Create a Blob from the binary buffer
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Create a link element and trigger the download
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
