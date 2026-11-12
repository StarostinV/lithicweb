/**
 * Main-thread entry to the Artifact3-D scar segmentation: runs the pipeline in
 * a Web Worker so the page stays responsive, relays progress, and cancels by
 * terminating the worker.
 *
 * @module artifact3d/client
 */

/**
 * @typedef {Object} Artifact3DRun
 * @property {Promise<{faceLabels: Int32Array, nScars: number, timings: Object, info: Object}>} promise
 *   resolves with one 1-based scar label per input face; rejects with an Error
 *   named 'CancelledError' after cancel()
 * @property {() => void} cancel stop the run (terminates the worker)
 */

/**
 * @param {ArrayLike<number>} positions flat (n,3) mesh positions
 * @param {ArrayLike<number>} indices flat (m,3) face indices
 * @param {import('./pipeline.js').Artifact3DParams} params
 * @param {{onProgress?: (p: {stage: string, label: string, fraction: number, overall: number, detail?: string}) => void,
 *          createWorker?: () => Worker}} [opts]
 * @returns {Artifact3DRun}
 */
export function runArtifact3DInWorker(positions, indices, params, { onProgress = null, createWorker = null } = {}) {
    const worker = createWorker
        ? createWorker()
        : new Worker(new URL('./worker.js', import.meta.url));
    let settle = null;
    const promise = new Promise((resolve, reject) => {
        settle = { resolve, reject };
        worker.onmessage = (event) => {
            const msg = event.data || {};
            if (msg.type === 'progress') {
                if (onProgress) onProgress(msg);
            } else if (msg.type === 'result') {
                worker.terminate();
                resolve(msg);
            } else if (msg.type === 'error') {
                worker.terminate();
                reject(new Error(msg.message));
            }
        };
        worker.onerror = (e) => {
            worker.terminate();
            reject(new Error(e?.message || 'Artifact3-D worker failed'));
        };
    });
    // copies: the mesh view keeps its own buffers
    const pos = Float32Array.from(positions);
    const idx = Uint32Array.from(indices);
    worker.postMessage({ type: 'run', positions: pos, indices: idx, params }, [pos.buffer, idx.buffer]);
    const cancel = () => {
        worker.terminate();
        const err = new Error('Artifact3-D segmentation cancelled');
        err.name = 'CancelledError';
        settle.reject(err);
    };
    return { promise, cancel };
}
