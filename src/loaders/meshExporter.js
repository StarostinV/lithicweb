export function exportAnnotations(mesh, meshColors, arrowDrawer, meshLoader) {
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

    // PLY file header
    const header = `ply
format binary_little_endian 1.0
element vertex ${vertexCount}
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
