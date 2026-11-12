/**
 * Web Worker running the Artifact3-D pipeline off the main thread.
 *
 * Protocol (one run per worker; cancel = worker.terminate() from client.js):
 *   in:  { type: 'run', positions: Float32Array, indices: Uint32Array, params }
 *   out: { type: 'progress', stage, label, fraction, overall, detail }
 *        { type: 'result', faceLabels: Int32Array, nScars, timings, info }
 *        { type: 'error', message }
 *
 * @module artifact3d/worker
 */

import { segmentArtifact3D } from './pipeline.js';

let lastPost = 0;
let lastStage = null;

self.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type !== 'run') return;
    try {
        const res = await segmentArtifact3D(msg.positions, msg.indices, msg.params || {}, {
            onProgress: (p) => {
                // throttle: every stage change, otherwise at most ~20 messages/s
                const t = Date.now();
                if (p.stage === lastStage && t - lastPost < 50 && p.fraction < 1) return;
                lastStage = p.stage;
                lastPost = t;
                self.postMessage({ type: 'progress', ...p });
            },
        });
        res.info.params = undefined;
        self.postMessage({ type: 'result', ...res }, [res.faceLabels.buffer]);
    } catch (e) {
        self.postMessage({ type: 'error', message: e?.message || String(e) });
    }
};
