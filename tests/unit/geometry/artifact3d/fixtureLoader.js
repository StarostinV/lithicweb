/**
 * Loader for the Artifact3-D golden fixtures written by
 * tools/artifact3d/make_fixtures.py (gzip-compressed little-endian arrays).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export const FIXTURE_ROOT = path.resolve(__dirname, '../../../fixtures/artifact3d');

/** Fixture directories present on disk (committed + optional local/ ones). */
export function fixtureDirs() {
    const out = [];
    const scan = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
            const d = path.join(dir, name);
            if (!fs.statSync(d).isDirectory()) continue;
            if (fs.existsSync(path.join(d, 'meta.json'))) out.push(d);
            else scan(d);
        }
    };
    scan(FIXTURE_ROOT);
    return out.sort();
}

/** Lazy accessor: fx.get('Cmax') -> Float64Array / Int32Array. */
export function loadFixture(dir) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const cache = {};
    const get = (name) => {
        if (cache[name]) return cache[name];
        for (const [kind, T] of [['f64', Float64Array], ['i32', Int32Array]]) {
            const p = path.join(dir, `${name}.${kind}.gz`);
            if (fs.existsSync(p)) {
                const raw = zlib.gunzipSync(fs.readFileSync(p));
                const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
                cache[name] = new T(buf);
                return cache[name];
            }
        }
        return null;
    };
    return { dir, name: path.basename(dir), meta, get };
}
