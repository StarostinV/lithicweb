/**
 * Compute volume and moments (up to second order) for a closed triangular
 * mesh via signed-tetrahedra decomposition.
 *
 * Equivalent to Artifact3D's Moments2Patch / VM2_0xyzPatch for closed meshes.
 *
 * Returns Mm in Artifact3D order:
 *   [V, Mx, My, Mz, Mxy, Mzy, Mzx, Mx², My², Mz²]
 *
 * @module geometry/meshMoments
 */

/**
 * @param {Float32Array} pos - Flat vertex positions [x0,y0,z0, x1,y1,z1, …]
 * @param {ArrayLike<number>} idx - Triangle indices (0-indexed, flat)
 * @returns {{ Vp1: number, Mm: Float64Array }}
 */
export function computeMeshMoments(pos, idx) {
    // Accumulate raw (unscaled) sums — divide once at the end.
    // For N ≈ 1 M faces the inner loop must stay allocation-free.
    let sV = 0, sMx = 0, sMy = 0, sMz = 0;
    let sMxy = 0, sMzy = 0, sMzx = 0;
    let sMx2 = 0, sMy2 = 0, sMz2 = 0;

    for (let i = 0, n = idx.length; i < n; i += 3) {
        const o0 = idx[i] * 3, o1 = idx[i + 1] * 3, o2 = idx[i + 2] * 3;

        const ax = pos[o0], ay = pos[o0 + 1], az = pos[o0 + 2];
        const bx = pos[o1], by = pos[o1 + 1], bz = pos[o1 + 2];
        const cx = pos[o2], cy = pos[o2 + 1], cz = pos[o2 + 2];

        // det = 6 * signed tetrahedron volume = a · (b × c)
        const det = ax * (by * cz - bz * cy)
                  - ay * (bx * cz - bz * cx)
                  + az * (bx * cy - by * cx);

        // Volume:  Σ det/6  →  accumulate det, divide by 6 at end
        sV += det;

        // First moments:  Σ (det/6)·(ai+bi+ci)/4 = Σ det·(ai+bi+ci) / 24
        const sx = ax + bx + cx, sy = ay + by + cy, sz = az + bz + cz;
        sMx += det * sx;
        sMy += det * sy;
        sMz += det * sz;

        // Second moments: Σ (det/6)·(ai²+bi²+ci²+ai·bi+ai·ci+bi·ci)/10
        //   = Σ det·(…) / 60
        sMx2 += det * (ax * ax + bx * bx + cx * cx + ax * bx + ax * cx + bx * cx);
        sMy2 += det * (ay * ay + by * by + cy * cy + ay * by + ay * cy + by * cy);
        sMz2 += det * (az * az + bz * bz + cz * cz + az * bz + az * cz + bz * cz);

        // Products of inertia: Σ (det/6)·(2·Σ ai·aj + cross terms)/20
        //   = Σ det·(…) / 120
        sMxy += det * (2 * (ax * ay + bx * by + cx * cy)
                       + ax * by + ay * bx + ax * cy + ay * cx + bx * cy + by * cx);
        sMzy += det * (2 * (az * ay + bz * by + cz * cy)
                       + az * by + ay * bz + az * cy + ay * cz + bz * cy + by * cz);
        sMzx += det * (2 * (az * ax + bz * bx + cz * cx)
                       + az * bx + ax * bz + az * cx + ax * cz + bz * cx + bx * cz);
    }

    const V = sV / 6;
    const Mm = new Float64Array([
        V,
        sMx / 24,          // Mx
        sMy / 24,          // My
        sMz / 24,          // Mz
        sMxy / 120,         // Mxy
        sMzy / 120,         // Mzy
        sMzx / 120,         // Mzx
        sMx2 / 60,          // Mx²
        sMy2 / 60,          // My²
        sMz2 / 60,          // Mz²
    ]);

    return { Vp1: V, Mm };
}
