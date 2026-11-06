/**
 * Exported edge labels must come from the annotation state, not from vertex
 * colors (which depend on the display mode and the chosen edge color).
 */
import { exportAnnotations } from '../../../src/loaders/meshExporter.js';

async function captureExport(edgeIndices) {
    let blob = null;
    URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    const mesh = {
        geometry: {
            attributes: { position: { array: new Float32Array(4 * 3) } },
            index: { array: new Uint32Array([0, 1, 2, 1, 2, 3]) },
        },
    };
    exportAnnotations(mesh, edgeIndices, { arrows: [] }, { currentFileName: 't', metadata: {} });
    const bytes = new Uint8Array(await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(blob);
    }));
    const marker = new TextEncoder().encode('end_header\n');
    let start = -1;
    for (let i = 0; i + marker.length <= bytes.length && start < 0; i++) {
        if (marker.every((b, k) => bytes[i + k] === b)) start = i + marker.length;
    }
    const view = new DataView(bytes.buffer, start);
    return [0, 1, 2, 3].map(v => view.getInt32(v * 16 + 12, true));
}

test('labels follow edgeIndices regardless of colors', async () => {
    expect(await captureExport(new Set([1, 3]))).toEqual([0, 1, 0, 1]);
    expect(await captureExport(new Set())).toEqual([0, 0, 0, 0]);
});
