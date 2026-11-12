/**
 * k-nearest-neighbour queries on a fixed point set with a uniform grid.
 * Replaces scipy's cKDTree in the Artifact3-D port (ridge boost, label
 * transfer). Results are ordered by (squared distance, index).
 *
 * @module artifact3d/knn
 */

export class KNNGrid {
    /**
     * @param {Float64Array|Float32Array} pts flat (n,3)
     * @param {number} [perCell=2] target mean number of points per occupied cell
     */
    constructor(pts, perCell = 2) {
        const n = pts.length / 3;
        this.pts = pts;
        this.n = n;
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < n; i++) {
            for (let k = 0; k < 3; k++) {
                const x = pts[3 * i + k];
                if (x < lo[k]) lo[k] = x;
                if (x > hi[k]) hi[k] = x;
            }
        }
        if (n === 0) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
        const ext = [0, 1, 2].map(k => Math.max(hi[k] - lo[k], 1e-12));
        // surface-like point sets: size cells from the bounding-box area, not volume
        const area = ext[0] * ext[1] + ext[1] * ext[2] + ext[0] * ext[2];
        let h = Math.sqrt((perCell * area) / Math.max(1, n));
        const maxCells = 4 * Math.max(1, n) + 64;
        let dims;
        for (;;) {
            dims = ext.map(e => Math.max(1, Math.ceil(e / h)));
            if (dims[0] * dims[1] * dims[2] <= maxCells) break;
            h *= 1.25;
        }
        this.h = h;
        this.lo = lo;
        this.dims = dims;
        const nc = dims[0] * dims[1] * dims[2];
        const cellOf = new Int32Array(n);
        const start = new Int32Array(nc + 1);
        for (let i = 0; i < n; i++) {
            const c = this._cell(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
            cellOf[i] = c;
            start[c + 1]++;
        }
        for (let c = 0; c < nc; c++) start[c + 1] += start[c];
        const fill = start.slice(0, nc);
        const items = new Int32Array(n);
        for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
        this.start = start;
        this.items = items;
    }

    _coord(x, k) {
        const c = Math.floor((x - this.lo[k]) / this.h);
        return c < 0 ? 0 : (c >= this.dims[k] ? this.dims[k] - 1 : c);
    }

    _cell(x, y, z) {
        const d = this.dims;
        return this._coord(x, 0) + d[0] * (this._coord(y, 1) + d[1] * this._coord(z, 2));
    }

    /**
     * Indices of the k nearest points to (x,y,z), nearest first.
     * @param {number} x @param {number} y @param {number} z
     * @param {number} k
     * @returns {number[]}
     */
    query(x, y, z, k) {
        k = Math.min(k, this.n);
        if (k <= 0) return [];
        const d = this.dims, pts = this.pts, start = this.start, items = this.items;
        const cx = this._coord(x, 0), cy = this._coord(y, 1), cz = this._coord(z, 2);
        const bestD = [], bestI = [];
        const consider = (i) => {
            const dx = pts[3 * i] - x, dy = pts[3 * i + 1] - y, dz = pts[3 * i + 2] - z;
            const dd = dx * dx + dy * dy + dz * dz;
            const m = bestD.length;
            if (m === k && (dd > bestD[m - 1] || (dd === bestD[m - 1] && i > bestI[m - 1]))) return;
            let p = m;
            while (p > 0 && (bestD[p - 1] > dd || (bestD[p - 1] === dd && bestI[p - 1] > i))) p--;
            bestD.splice(p, 0, dd); bestI.splice(p, 0, i);
            if (bestD.length > k) { bestD.pop(); bestI.pop(); }
        };
        const maxR = Math.max(d[0], d[1], d[2]);
        for (let r = 0; r <= maxR; r++) {
            const z0 = Math.max(0, cz - r), z1 = Math.min(d[2] - 1, cz + r);
            const y0 = Math.max(0, cy - r), y1 = Math.min(d[1] - 1, cy + r);
            const x0 = Math.max(0, cx - r), x1 = Math.min(d[0] - 1, cx + r);
            for (let iz = z0; iz <= z1; iz++) {
                const onZ = iz === cz - r || iz === cz + r;
                for (let iy = y0; iy <= y1; iy++) {
                    const onY = onZ || iy === cy - r || iy === cy + r;
                    for (let ix = x0; ix <= x1; ix++) {
                        if (!onY && ix !== cx - r && ix !== cx + r) continue;  // shell only
                        const c = ix + d[0] * (iy + d[1] * iz);
                        for (let s = start[c]; s < start[c + 1]; s++) consider(items[s]);
                    }
                }
            }
            // distance from the query to the nearest unsearched cell
            let bound = Infinity;
            const q = [x, y, z], c0 = [x0, y0, z0], c1 = [x1, y1, z1];
            for (let a = 0; a < 3; a++) {
                if (c0[a] > 0) bound = Math.min(bound, q[a] - (this.lo[a] + c0[a] * this.h));
                if (c1[a] < d[a] - 1) bound = Math.min(bound, (this.lo[a] + (c1[a] + 1) * this.h) - q[a]);
            }
            if (bound === Infinity) break;               // whole grid searched
            if (bestD.length === k && bound > 0 && bestD[k - 1] < bound * bound) break;
        }
        return bestI;
    }
}
