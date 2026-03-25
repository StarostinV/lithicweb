/**
 * ScarExporter - Export a single scar as a watertight PLY mesh.
 *
 * Builds a closed shell by duplicating the scar surface, offsetting it
 * inward along vertex normals, and stitching the boundary with side faces.
 *
 * @module loaders/scarExporter
 */

import { triggerDownload } from './meshExporter.js';

/**
 * Build a watertight mesh from a single scar.
 *
 * @param {number} scarId
 * @param {import('../geometry/ScarGraphContext.js').ScarGraphContext} ctx
 * @param {import('../geometry/BasicMesh.js').BasicMesh} basicMesh
 * @returns {{ positions: Float32Array, normals: Float32Array, faces: Uint32Array } | null}
 */
export function buildWatertightScarMesh(scarId, ctx, basicMesh) {
    const scarVertices = ctx.scarIdToVertices.get(scarId);
    if (!scarVertices || scarVertices.length === 0) return null;

    const scarVertexSet = new Set(scarVertices);
    const positions = basicMesh.positions;
    const indices = basicMesh.indices;

    // Ensure normals exist
    if (!basicMesh.geometry.attributes.normal) {
        basicMesh.geometry.computeVertexNormals();
    }
    const normalArray = basicMesh.geometry.attributes.normal.array;

    // ── Step 1: Extract scar faces and build reindex maps ─────────
    const reindexMap = new Map(); // oldIdx → newIdx
    const reverseMap = [];        // newIdx → oldIdx
    const topFaces = [];
    let nextIdx = 0;

    const numFaces = indices.length / 3;
    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];

        // Face belongs to scar only if ALL three vertices are in the scar
        if (!scarVertexSet.has(i0) || !scarVertexSet.has(i1) || !scarVertexSet.has(i2)) {
            continue;
        }

        // Assign compact indices
        for (const v of [i0, i1, i2]) {
            if (!reindexMap.has(v)) {
                reindexMap.set(v, nextIdx);
                reverseMap.push(v);
                nextIdx++;
            }
        }

        topFaces.push(reindexMap.get(i0), reindexMap.get(i1), reindexMap.get(i2));
    }

    const N = reverseMap.length; // top vertex count
    const topFaceCount = topFaces.length / 3;

    if (topFaceCount === 0) {
        console.warn(`Scar ${scarId}: no complete faces found, skipping export.`);
        return null;
    }

    // ── Step 2: Compute delta (mean edge length) ──────────────────
    let edgeLengthSum = 0;
    let edgeCount = 0;

    for (let f = 0; f < topFaceCount; f++) {
        const a = topFaces[f * 3];
        const b = topFaces[f * 3 + 1];
        const c = topFaces[f * 3 + 2];

        const oA = reverseMap[a], oB = reverseMap[b], oC = reverseMap[c];

        edgeLengthSum += edgeLength(positions, oA, oB);
        edgeLengthSum += edgeLength(positions, oB, oC);
        edgeLengthSum += edgeLength(positions, oA, oC);
        edgeCount += 3;
    }

    const delta = edgeLengthSum / edgeCount;

    // ── Step 3: Build top + bottom vertex arrays ──────────────────
    // Compute average normal as fallback for zero-length normals
    let avgNx = 0, avgNy = 0, avgNz = 0;
    for (let i = 0; i < N; i++) {
        const o = reverseMap[i];
        avgNx += normalArray[o * 3];
        avgNy += normalArray[o * 3 + 1];
        avgNz += normalArray[o * 3 + 2];
    }
    const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz);
    if (avgLen > 1e-10) { avgNx /= avgLen; avgNy /= avgLen; avgNz /= avgLen; }
    else { avgNx = 0; avgNy = 0; avgNz = 1; }

    const totalVertices = N * 2;
    const outPositions = new Float32Array(totalVertices * 3);
    const outNormals = new Float32Array(totalVertices * 3);

    for (let i = 0; i < N; i++) {
        const o = reverseMap[i];
        const px = positions[o * 3];
        const py = positions[o * 3 + 1];
        const pz = positions[o * 3 + 2];

        let nx = normalArray[o * 3];
        let ny = normalArray[o * 3 + 1];
        let nz = normalArray[o * 3 + 2];
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nLen < 1e-10) { nx = avgNx; ny = avgNy; nz = avgNz; }
        else { nx /= nLen; ny /= nLen; nz /= nLen; }

        // Top layer
        outPositions[i * 3] = px;
        outPositions[i * 3 + 1] = py;
        outPositions[i * 3 + 2] = pz;
        outNormals[i * 3] = nx;
        outNormals[i * 3 + 1] = ny;
        outNormals[i * 3 + 2] = nz;

        // Bottom layer (offset inward, negated normal)
        const bi = i + N;
        outPositions[bi * 3] = px - delta * nx;
        outPositions[bi * 3 + 1] = py - delta * ny;
        outPositions[bi * 3 + 2] = pz - delta * nz;
        outNormals[bi * 3] = -nx;
        outNormals[bi * 3 + 1] = -ny;
        outNormals[bi * 3 + 2] = -nz;
    }

    // ── Step 4: Build bottom faces (reversed winding) ─────────────
    const bottomFaces = new Array(topFaces.length);
    for (let f = 0; f < topFaceCount; f++) {
        const a = topFaces[f * 3] + N;
        const b = topFaces[f * 3 + 1] + N;
        const c = topFaces[f * 3 + 2] + N;
        // Reverse winding: swap b and c
        bottomFaces[f * 3] = a;
        bottomFaces[f * 3 + 1] = c;
        bottomFaces[f * 3 + 2] = b;
    }

    // ── Step 5: Find boundary edges via half-edge cancellation ────
    const halfEdges = new Map(); // "a_b" → [a, b]

    for (let f = 0; f < topFaceCount; f++) {
        const a = topFaces[f * 3];
        const b = topFaces[f * 3 + 1];
        const c = topFaces[f * 3 + 2];

        insertHalfEdge(halfEdges, a, b);
        insertHalfEdge(halfEdges, b, c);
        insertHalfEdge(halfEdges, c, a);
    }

    // Build side faces from remaining boundary half-edges
    const sideFaces = [];
    for (const [, [a, b]] of halfEdges) {
        // Side triangle 1: (a, b, b+N)
        // Side triangle 2: (a, b+N, a+N)
        sideFaces.push(a, b, b + N);
        sideFaces.push(a, b + N, a + N);
    }

    // ── Step 6: Assemble final face array ─────────────────────────
    const totalFaceCount = topFaceCount + topFaceCount + sideFaces.length / 3;
    const outFaces = new Uint32Array(totalFaceCount * 3);

    let offset = 0;
    for (let i = 0; i < topFaces.length; i++) outFaces[offset++] = topFaces[i];
    for (let i = 0; i < bottomFaces.length; i++) outFaces[offset++] = bottomFaces[i];
    for (let i = 0; i < sideFaces.length; i++) outFaces[offset++] = sideFaces[i];

    return { positions: outPositions, normals: outNormals, faces: outFaces };
}

/**
 * Export a scar as a watertight binary PLY file.
 *
 * @param {number} scarId
 * @param {import('../geometry/ScarGraphContext.js').ScarGraphContext} ctx
 * @param {import('../geometry/BasicMesh.js').BasicMesh} basicMesh
 * @param {import('../loaders/meshLoader.js').MeshLoader} meshLoader
 * @param {string} [scarLabel] - Human-readable scar label for the filename
 */
export function exportScarAsWatertightPLY(scarId, ctx, basicMesh, meshLoader, scarLabel) {
    const result = buildWatertightScarMesh(scarId, ctx, basicMesh);
    if (!result) return;

    const { positions, normals, faces } = result;
    const vertexCount = positions.length / 3;
    const faceCount = faces.length / 3;

    // ── Build binary PLY ──────────────────────────────────────────
    const header = `ply\nformat binary_little_endian 1.0\ncomment Watertight scar export\nelement vertex ${vertexCount}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face ${faceCount}\nproperty list uchar int vertex_indices\nend_header\n`;

    const headerBytes = new TextEncoder().encode(header);
    const vertexSize = 6 * 4; // 6 floats
    const faceSize = 1 + 3 * 4; // 1 uchar + 3 ints
    const totalSize = headerBytes.length + vertexCount * vertexSize + faceCount * faceSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let off = 0;

    // Header
    for (let i = 0; i < headerBytes.length; i++) {
        view.setUint8(off++, headerBytes[i]);
    }

    // Vertices
    for (let i = 0; i < vertexCount; i++) {
        view.setFloat32(off, positions[i * 3], true); off += 4;
        view.setFloat32(off, positions[i * 3 + 1], true); off += 4;
        view.setFloat32(off, positions[i * 3 + 2], true); off += 4;
        view.setFloat32(off, normals[i * 3], true); off += 4;
        view.setFloat32(off, normals[i * 3 + 1], true); off += 4;
        view.setFloat32(off, normals[i * 3 + 2], true); off += 4;
    }

    // Faces
    for (let i = 0; i < faceCount; i++) {
        view.setUint8(off, 3); off += 1;
        view.setInt32(off, faces[i * 3], true); off += 4;
        view.setInt32(off, faces[i * 3 + 1], true); off += 4;
        view.setInt32(off, faces[i * 3 + 2], true); off += 4;
    }

    // Download
    const baseName = meshLoader?.currentFileName?.replace(/\.[^.]+$/, '') || 'scar';
    const label = scarLabel || String(scarId);
    const filename = `${baseName}_scar_${label}.ply`;

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    triggerDownload(blob, filename);
}

// ── Helpers ───────────────────────────────────────────────────────

function edgeLength(positions, a, b) {
    const dx = positions[a * 3] - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function insertHalfEdge(map, a, b) {
    const reverseKey = `${b}_${a}`;
    if (map.has(reverseKey)) {
        map.delete(reverseKey);
    } else {
        map.set(`${a}_${b}`, [a, b]);
    }
}
