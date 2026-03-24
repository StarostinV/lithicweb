/**
 * Per-scar metric computations for lithic analysis.
 *
 * Computes surface area, maximum dimension, and centroid for each scar
 * identified by the scar graph.
 *
 * @module geometry/scarMetrics
 */

/**
 * Compute per-scar metrics from a scar graph result.
 *
 * @param {object} scarGraph - Result from buildScarGraph()
 * @param {Float32Array} positions - Vertex positions (flat xyz)
 * @param {Array<number>} indices - Triangle indices
 * @param {Int32Array} workingLabels - Per-vertex scar labels from scar graph
 * @returns {Array<{scarId: number, vertexCount: number, surfaceArea: number, maxDimension: number, centroid: {x: number, y: number, z: number}}>}
 */
export function computeScarMetrics(scarGraph, positions, indices, workingLabels) {
    if (!scarGraph || !scarGraph.scars || scarGraph.scars.length === 0) return [];

    const scars = scarGraph.scars;
    const numFaces = Math.floor(indices.length / 3);

    // Build mapping from originalLabel (in workingLabels) -> scarId
    // identifyScars() assigns sequential scarIds but workingLabels contains originalLabels
    const labelToScarId = new Map();
    for (const scar of scars) {
        if (scar.originalLabel !== undefined) {
            labelToScarId.set(scar.originalLabel, scar.scarId);
        }
    }

    // If scars don't have originalLabel (stripped in buildScarGraph output),
    // reconstruct by finding which label each scar's representativeVertex has
    if (labelToScarId.size === 0) {
        for (const scar of scars) {
            const label = workingLabels[scar.representativeVertex];
            if (label > 0) {
                labelToScarId.set(label, scar.scarId);
            }
        }
    }

    // Build per-scar vertex sets for bounding box and centroid
    const scarVertices = new Map(); // scarId -> array of vertex indices
    for (const scar of scars) {
        scarVertices.set(scar.scarId, []);
    }

    // Assign vertices to scars using working labels -> scarId mapping
    for (let v = 0; v < workingLabels.length; v++) {
        const label = workingLabels[v];
        if (label <= 0) continue;
        const scarId = labelToScarId.get(label);
        if (scarId !== undefined && scarVertices.has(scarId)) {
            scarVertices.get(scarId).push(v);
        }
    }

    // Compute per-face area and assign to scar by majority vote
    const scarArea = new Map();
    for (const scar of scars) {
        scarArea.set(scar.scarId, 0);
    }

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];

        const l0 = workingLabels[i0];
        const l1 = workingLabels[i1];
        const l2 = workingLabels[i2];

        // Majority vote for face label -> convert to scarId
        let faceLabel;
        if (l0 === l1 || l0 === l2) faceLabel = l0;
        else if (l1 === l2) faceLabel = l1;
        else faceLabel = l0; // tie-break: first vertex

        if (faceLabel <= 0) continue;
        const faceScarId = labelToScarId.get(faceLabel);
        if (faceScarId === undefined || !scarArea.has(faceScarId)) continue;

        // Triangle area = 0.5 * |cross(B-A, C-A)|
        const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
        const bx = positions[i1 * 3] - ax, by = positions[i1 * 3 + 1] - ay, bz = positions[i1 * 3 + 2] - az;
        const cx = positions[i2 * 3] - ax, cy = positions[i2 * 3 + 1] - ay, cz = positions[i2 * 3 + 2] - az;

        const crossX = by * cz - bz * cy;
        const crossY = bz * cx - bx * cz;
        const crossZ = bx * cy - by * cx;

        const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
        scarArea.set(faceScarId, scarArea.get(faceScarId) + area);
    }

    // Compute per-scar bounding box diagonal and centroid
    const results = scars.map(scar => {
        const verts = scarVertices.get(scar.scarId) || [];
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

        const n = verts.length || 1;
        if (verts.length === 0) {
            return {
                scarId: scar.scarId,
                vertexCount: scar.vertexCount,
                surfaceArea: scarArea.get(scar.scarId) || 0,
                maxDimension: 0,
                centroid: { x: 0, y: 0, z: 0 }
            };
        }
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;

        return {
            scarId: scar.scarId,
            vertexCount: scar.vertexCount,
            surfaceArea: scarArea.get(scar.scarId) || 0,
            maxDimension: Math.sqrt(dx * dx + dy * dy + dz * dz),
            centroid: { x: sumX / n, y: sumY / n, z: sumZ / n }
        };
    });

    return results;
}
