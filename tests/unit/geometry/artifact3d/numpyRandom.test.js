/**
 * The clustering PRNG must reproduce numpy's default_rng(seed).integers(n)
 * so the browser port draws the same seeds as the Python port.
 */
import fs from 'fs';
import path from 'path';
import { NumpyRandom, seedSequenceState } from '../../../../src/geometry/artifact3d/numpyRandom.js';
import { FIXTURE_ROOT, fixtureDirs, loadFixture } from './fixtureLoader.js';

describe('NumpyRandom', () => {
    test('SeedSequence(0) state words', () => {
        // np.random.SeedSequence(0).generate_state(4, np.uint64)[0] = 15793235383387715774
        const w = seedSequenceState(0, 2);
        expect((BigInt(w[1]) << 32n) | BigInt(w[0])).toBe(15793235383387715774n);
    });

    test('PCG64 raw outputs for seed 0', () => {
        const g = new NumpyRandom(0);
        expect([g.next64(), g.next64(), g.next64()]).toEqual(
            [11749869230777074271n, 4976686463289251617n, 755828109848996024n]);
    });

    test('integers(n) matches numpy for 8 seeds x 45 bounds (32- and 64-bit paths)', () => {
        const ref = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'rng_numpy.json'), 'utf8'));
        let n = 0;
        for (const c of ref.cases) {
            const g = new NumpyRandom(c.seed);
            for (const [bound, value] of c.draws) {
                expect(String(g.integers(BigInt(bound)))).toBe(value);
                n++;
            }
        }
        expect(n).toBe(360);
    });

    test.each(fixtureDirs().map(d => [path.basename(d), d]))(
        '%s: reproduces the clustering draws recorded from Python', (_, dir) => {
            const fx = loadFixture(dir);
            const g = new NumpyRandom(fx.meta.params.seed);
            for (const [n, r] of fx.meta.rng_draws) expect(g.integers(n)).toBe(r);
        });
});
