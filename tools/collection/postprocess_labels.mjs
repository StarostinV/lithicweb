/**
 * Turn stored model outputs into per-vertex edge labels with the client's own
 * postprocessing (src/utils/postprocess.js), so prescreen labels match what
 * running the model in the app shows.
 *
 *   node --experimental-detect-module tools/collection/postprocess_labels.mjs WORK_DIR
 *
 * WORK_DIR/manifest.json lists {key, nv, nf, params}; for each key the
 * directory holds <key>_faces.i32, <key>_pred.f32 and <key>_adj.i32. Writes
 * <key>_labels.u8 (one byte per vertex, 1 = edge).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { runClientPostprocessing } = await import(path.join(here, '../../src/utils/postprocess.js'));
const { buildAdjacencyGraph } = await import(path.join(here, '../../src/utils/graphUtils.js'));

const dir = process.argv[2];
if (!dir) {
    console.error('usage: postprocess_labels.mjs WORK_DIR');
    process.exit(1);
}
const read = (file, T) => {
    const b = fs.readFileSync(path.join(dir, file));
    return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT);
};

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
let n = 0;
for (const m of manifest) {
    const out = path.join(dir, `${m.key}_labels.u8`);
    if (fs.existsSync(out)) { n++; continue; }          // resumable
    const indices = read(`${m.key}_faces.i32`, Int32Array);
    const meshView = { indices, positions: { length: m.nv * 3 }, adjacencyGraph: buildAdjacencyGraph(indices, m.nv) };
    const cached = {
        edgePredictions: Float64Array.from(read(`${m.key}_pred.f32`, Float32Array)),
        faceAdjacencyFlat: read(`${m.key}_adj.i32`, Int32Array),
        numFaces: m.nf,
    };
    const labels = runClientPostprocessing(cached, meshView, m.params);
    const bytes = new Uint8Array(m.nv);
    labels.forEach((l, i) => { if (l === 1 || l > 0.5) bytes[i] = 1; });
    fs.writeFileSync(out, bytes);
    console.log(`[${++n}/${manifest.length}] ${m.key}`);
}
