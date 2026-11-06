/**
 * Annotation PLY presets: neurolithic keeps the canonical layout, meshlab
 * writes only what MeshLab understands (display colors, in sRGB).
 */
import * as THREE from 'three';
import { buildAnnotationPLY, PLY_EXPORT_PRESETS, plyPresetName } from '../../../src/loaders/meshExporter.js';

function split(buffer) {
    const bytes = new Uint8Array(buffer);
    const text = new TextDecoder('latin1').decode(bytes);
    const end = text.indexOf('end_header\n') + 'end_header\n'.length;
    return { header: text.slice(0, end), body: new DataView(buffer, end) };
}

const data = (colors) => ({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    edgeIndices: new Set([1]),
    arrows: [{ startIndex: 0, endIndex: 2 }],
    metadata: { type: 'blade', big: { s: 'x'.repeat(600) } },
    colors,
});

test('neurolithic layout: labels, arrow element, metadata comments, no colors', () => {
    const { header } = split(buildAnnotationPLY(data(), PLY_EXPORT_PRESETS.neurolithic));
    expect(header).toContain('property int labels\n');
    expect(header).toContain('element arrow 1\n');
    expect(header).toContain('comment metadata type blade\n');
    expect(header).not.toContain('red');
});

test('meshlab layout: sRGB vertex colors only, short header', () => {
    const edge = new THREE.Color('#ff9933');     // stored linear, like MeshView colors
    const gray = new THREE.Color('#808080');
    const colors = new Float32Array([...gray.toArray(), ...edge.toArray(), ...gray.toArray()]);
    const { header, body } = split(buildAnnotationPLY(data(colors), PLY_EXPORT_PRESETS.meshlab));

    expect(header).not.toMatch(/labels|arrow|comment|quality/);
    expect(header).toContain('property uchar red\nproperty uchar green\nproperty uchar blue\n');
    expect(Math.max(...header.split('\n').map(l => l.length))).toBeLessThan(500);

    const stride = 12 + 3;
    const rgb = (v) => [0, 1, 2].map(k => body.getUint8(v * stride + 12 + k));
    expect(rgb(1)).toEqual([0xff, 0x99, 0x33]);   // matches what the picker shows
    expect(rgb(0)).toEqual([0x80, 0x80, 0x80]);
});

test('quality carries the edge label', () => {
    const colors = new Float32Array(9);
    const opts = { ...PLY_EXPORT_PRESETS.meshlab, quality: true };
    const { header, body } = split(buildAnnotationPLY(data(colors), opts));
    expect(header).toContain('property float quality\n');
    const q = [0, 1, 2].map(v => body.getFloat32(v * 19 + 15, true));
    expect(q).toEqual([0, 1, 0]);
});

test('color export without colors is an error, not a silent black mesh', () => {
    expect(() => buildAnnotationPLY(data(null), PLY_EXPORT_PRESETS.meshlab)).toThrow();
});

test('preset names', () => {
    expect(plyPresetName(PLY_EXPORT_PRESETS.neurolithic)).toBe('neurolithic');
    expect(plyPresetName(PLY_EXPORT_PRESETS.meshlab)).toBe('meshlab');
    expect(plyPresetName({ ...PLY_EXPORT_PRESETS.meshlab, quality: true })).toBe('custom');
});

test('our own loader reads both presets back', async () => {
    const { default: CustomPLYLoader } = await import('../../../src/loaders/customPLYLoader.js');
    const loader = new CustomPLYLoader();
    const colors = new Float32Array(9).fill(0.5);

    const neuro = loader.parse(buildAnnotationPLY(data(colors), PLY_EXPORT_PRESETS.neurolithic));
    expect(Array.from(neuro.attributes.labels.array)).toEqual([0, 1, 0]);
    expect(neuro.userData.metadata.type).toBe('blade');

    const meshlab = loader.parse(buildAnnotationPLY(data(colors), PLY_EXPORT_PRESETS.meshlab));
    expect(meshlab.attributes.position.count).toBe(3);
    expect(meshlab.index.count).toBe(3);
});
