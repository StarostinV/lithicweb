/**
 * Per-segment metric computations for lithic analysis.
 *
 * Computes surface area, maximum dimension, and centroid for each segment
 * using MeshView's segments and faceLabels directly (no scar graph dependency).
 *
 * @module geometry/scarMetrics
 */

/**
 * Compute per-segment metrics from MeshView data.
 *
 * @param {Array<Array<number>>} segments - MeshView.segments (each subarray is vertex indices)
 * @param {Array<number>} faceLabels - MeshView.faceLabels (per-vertex, 1-indexed segment IDs, 0 = edge)
 * @param {Float32Array} positions - Vertex positions (flat xyz)
 * @param {Array<number>} indices - Triangle indices
 * @returns {Array<{segmentId: number, vertexCount: number, surfaceArea: number, maxDimension: number, centroid: {x: number, y: number, z: number}}>}
 */
export function computeSegmentMetrics(segments, faceLabels, positions, indices) {
    if (!segments || segments.length === 0) return [];

    const numFaces = Math.floor(indices.length / 3);

    // Compute per-face area and assign to segment by majority vote
    const segmentArea = new Map();
    for (let i = 0; i < segments.length; i++) {
        segmentArea.set(i + 1, 0); // segment IDs are 1-indexed
    }

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];

        const l0 = faceLabels[i0];
        const l1 = faceLabels[i1];
        const l2 = faceLabels[i2];

        // Majority vote for face label
        let faceLabel;
        if (l0 === l1 || l0 === l2) faceLabel = l0;
        else if (l1 === l2) faceLabel = l1;
        else faceLabel = l0;

        if (!faceLabel || !segmentArea.has(faceLabel)) continue;

        // Triangle area = 0.5 * |cross(B-A, C-A)|
        const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
        const bx = positions[i1 * 3] - ax, by = positions[i1 * 3 + 1] - ay, bz = positions[i1 * 3 + 2] - az;
        const cx = positions[i2 * 3] - ax, cy = positions[i2 * 3 + 1] - ay, cz = positions[i2 * 3 + 2] - az;

        const crossX = by * cz - bz * cy;
        const crossY = bz * cx - bx * cz;
        const crossZ = bx * cy - by * cx;

        const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
        segmentArea.set(faceLabel, segmentArea.get(faceLabel) + area);
    }

    // Compute per-segment bounding box diagonal and centroid
    return segments.map((verts, index) => {
        const segmentId = index + 1;

        if (verts.length === 0) {
            return {
                segmentId,
                vertexCount: 0,
                surfaceArea: segmentArea.get(segmentId) || 0,
                maxDimension: 0,
                centroid: { x: 0, y: 0, z: 0 }
            };
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let sumX = 0, sumY = 0, sumZ = 0;

        for (const v of verts) {
            const x = positions[v * 3];
            const y = positions[v * 3 + 1];
            const z = positions[v * 3 + 2];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
            sumX += x;
            sumY += y;
            sumZ += z;
        }

        const n = verts.length;
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;

        return {
            segmentId,
            vertexCount: n,
            surfaceArea: segmentArea.get(segmentId) || 0,
            maxDimension: Math.sqrt(dx * dx + dy * dy + dz * dz),
            centroid: { x: sumX / n, y: sumY / n, z: sumZ / n }
        };
    });
}
