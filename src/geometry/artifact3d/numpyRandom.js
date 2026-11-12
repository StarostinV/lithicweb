/**
 * numpy-compatible random integers: `np.random.default_rng(seed).integers(n)`.
 *
 * The Python port of Artifact3-D draws its geodesic-clustering seeds with
 * `np.random.default_rng(seed).integers(len(avail))`. Reproducing that stream
 * exactly lets the browser port give the same segmentation as the Python port
 * for the same seed, which is what the validation compares against.
 *
 * Implemented independently from the published algorithms:
 *   - SeedSequence entropy pooling and state generation (numpy >= 1.17),
 *   - PCG64 (XSL-RR 128/64, O'Neill 2014) bit generator,
 *   - Lemire's bounded integers ("Fast random integer generation in an
 *     interval", 2019) as used by numpy's Generator.integers, including the
 *     32-bit path with the bit generator's buffered upper half-word.
 * Verified against numpy 2.5 by tests/unit/geometry/artifact3d/numpyRandom.test.js.
 *
 * BigInt is used for the 128-bit state; the clustering needs only a few
 * hundred draws, so speed does not matter.
 *
 * @module artifact3d/numpyRandom
 */

const M32 = 0xffffffffn;
const M64 = (1n << 64n) - 1n;
const M128 = (1n << 128n) - 1n;
const PCG_MULT = 0x2360ed051fc65da44385df649fccf645n;

const INIT_A = 0x43b0d7e5, MULT_A = 0x931e8875;
const INIT_B = 0x8b51f9dd, MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd, MIX_MULT_R = 0x4973f715;
const XSHIFT = 16;
const POOL_SIZE = 4;

/** uint32 words of a non-negative integer, least significant first. */
function toUint32Words(seed) {
    let x = BigInt(seed);
    if (x < 0n) throw new Error('seed must be non-negative');
    const out = [];
    do { out.push(Number(x & M32)); x >>= 32n; } while (x > 0n);
    return out;
}

/**
 * numpy SeedSequence(entropy).generate_state(nWords, uint32).
 * @param {number|bigint|string} seed
 * @param {number} nWords
 * @returns {number[]} uint32 words
 */
export function seedSequenceState(seed, nWords) {
    const entropy = toUint32Words(seed);
    let hashConst = INIT_A;
    const hashmix = (value) => {
        value = (value ^ hashConst) >>> 0;
        hashConst = Math.imul(hashConst, MULT_A) >>> 0;
        value = Math.imul(value, hashConst) >>> 0;
        value = (value ^ (value >>> XSHIFT)) >>> 0;
        return value;
    };
    const mix = (x, y) => {
        let r = (Math.imul(MIX_MULT_L, x) - Math.imul(MIX_MULT_R, y)) >>> 0;
        r = (r ^ (r >>> XSHIFT)) >>> 0;
        return r;
    };
    const pool = new Array(POOL_SIZE).fill(0);
    for (let i = 0; i < POOL_SIZE; i++) pool[i] = hashmix(i < entropy.length ? entropy[i] : 0);
    for (let s = 0; s < POOL_SIZE; s++) {
        for (let d = 0; d < POOL_SIZE; d++) {
            if (s !== d) pool[d] = mix(pool[d], hashmix(pool[s]));
        }
    }
    for (let s = POOL_SIZE; s < entropy.length; s++) {
        for (let d = 0; d < POOL_SIZE; d++) pool[d] = mix(pool[d], hashmix(entropy[s]));
    }
    let hc = INIT_B;
    const state = [];
    for (let i = 0; i < nWords; i++) {
        let v = pool[i % POOL_SIZE];
        v = (v ^ hc) >>> 0;
        hc = Math.imul(hc, MULT_B) >>> 0;
        v = Math.imul(v, hc) >>> 0;
        v = (v ^ (v >>> XSHIFT)) >>> 0;
        state.push(v);
    }
    return state;
}

/**
 * Generator(PCG64(SeedSequence(seed))) restricted to `integers(n)`.
 */
export class NumpyRandom {
    /** @param {number|bigint|string} seed non-negative integer seed */
    constructor(seed = 0) {
        const w = seedSequenceState(seed, 8).map(BigInt);
        const u64 = (k) => w[2 * k] | (w[2 * k + 1] << 32n);
        const initState = (u64(0) << 64n) | u64(1);
        const initSeq = (u64(2) << 64n) | u64(3);
        this.inc = ((initSeq << 1n) | 1n) & M128;
        this.state = 0n;
        this._step();
        this.state = (this.state + initState) & M128;
        this._step();
        this.hasUint32 = false;
        this.uinteger = 0n;
    }

    _step() {
        this.state = (this.state * PCG_MULT + this.inc) & M128;
    }

    /** Next raw 64-bit output as BigInt. */
    next64() {
        this._step();
        const s = this.state;
        const rot = Number(s >> 122n);
        const x = ((s >> 64n) ^ s) & M64;
        return ((x >> BigInt(rot)) | (x << BigInt((64 - rot) & 63))) & M64;
    }

    /** Next 32-bit output (low half first, upper half buffered), as BigInt. */
    next32() {
        if (this.hasUint32) {
            this.hasUint32 = false;
            return this.uinteger;
        }
        const n = this.next64();
        this.hasUint32 = true;
        this.uinteger = n >> 32n;
        return n & M32;
    }

    /**
     * Uniform integer in [0, n) — identical to numpy `Generator.integers(n)`.
     * @param {number|bigint} n exclusive upper bound (>= 1)
     * @returns {number}
     */
    integers(n) {
        const rng = BigInt(n) - 1n;           // inclusive range
        if (rng < 0n) throw new Error('integers: n must be >= 1');
        if (rng === 0n) return 0;
        if (rng <= M32) {
            if (rng === M32) return Number(this.next32());
            const excl = rng + 1n;
            let m = this.next32() * excl;
            let left = m & M32;
            if (left < excl) {
                const threshold = (M32 - rng) % excl;
                while (left < threshold) {
                    m = this.next32() * excl;
                    left = m & M32;
                }
            }
            return Number(m >> 32n);
        }
        if (rng === M64) return Number(this.next64());
        const excl = rng + 1n;
        let m = this.next64() * excl;
        let left = m & M64;
        if (left < excl) {
            const threshold = (M64 - rng) % excl;
            while (left < threshold) {
                m = this.next64() * excl;
                left = m & M64;
            }
        }
        return Number(m >> 64n);
    }
}
