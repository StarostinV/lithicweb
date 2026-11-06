/**
 * Display mode must survive drawing: with segment colors turned off,
 * adding edges and recomputing segments must not repaint segment colors.
 */
import * as THREE from 'three';
import { MeshView } from '../../../src/components/MeshView.js';

// jsdom lacks crypto.randomUUID, used by the draw-operation history.
if (!globalThis.crypto?.randomUUID) {
    let next = 0;
    globalThis.crypto = globalThis.crypto || {};
    globalThis.crypto.randomUUID = () => `uuid-${next++}`;
}

// Path graph 0-1-2-...-(n-1); no rendering needed, only adjacency + colors.
function makeView(n = 10) {
    const adjacencyGraph = new Map();
    for (let i = 0; i < n; i++) {
        const nb = [];
        if (i > 0) nb.push(i - 1);
        if (i < n - 1) nb.push(i + 1);
        adjacencyGraph.set(i, nb);
    }
    const basicMesh = { positions: new Float32Array(n * 3), indices: [], adjacencyGraph };
    const view = new MeshView({}, basicMesh, {
        edgeColor: new THREE.Color(1, 0, 0),
        objectColor: new THREE.Color(0.5, 0.5, 0.5),
    });
    view._meshColors = new Float32Array(n * 3);
    return view;
}

function colorOf(view, i) {
    const c = view.meshColors;
    return [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]];
}

const rgb = (color) => [color.r, color.g, color.b];

function expectOnlyObjectAndEdge(view, { edgesVisible }) {
    const object = rgb(view.objectColor);
    const edge = rgb(view.edgeColor);
    for (let i = 0; i < view.vertexCount; i++) {
        const want = view.currentEdgeIndices.has(i) && edgesVisible ? edge : object;
        expect(colorOf(view, i)).toEqual(want.map(x => expect.closeTo(x, 5)));
    }
}

describe('MeshView display mode', () => {
    test('segments stay hidden after drawing and segment recomputation', () => {
        const view = makeView();
        view.addEdgeVertices([6]);
        view.updateSegments();
        view.setDisplayMode({ showEdges: true, showSegments: false });
        expectOnlyObjectAndEdge(view, { edgesVisible: true });

        // Draw a new edge splitting off another segment, then recompute
        view.addEdgeVertices([3]);
        view.updateSegments();
        expect(view.segments.length).toBe(3);
        expectOnlyObjectAndEdge(view, { edgesVisible: true });

        view.regenerateColors();
        view.refreshSegmentColors();
        expectOnlyObjectAndEdge(view, { edgesVisible: true });
    });

    test('segment colors are still tracked and come back when re-enabled', () => {
        const view = makeView();
        view.setDisplayMode({ showEdges: true, showSegments: false });
        view.addEdgeVertices([3, 6]);
        view.updateSegments();

        view.setDisplayMode({ showSegments: true });
        const object = rgb(view.objectColor);
        const segmentColored = [...Array(view.vertexCount).keys()]
            .filter(i => !view.currentEdgeIndices.has(i))
            .filter(i => colorOf(view, i).some((x, k) => Math.abs(x - object[k]) > 1e-6));
        expect(segmentColored.length).toBeGreaterThan(0);
        expect(view.faceColors.size).toBe(3);
    });

    test('hidden edges stay hidden while drawing', () => {
        const view = makeView();
        view.setDisplayMode({ showEdges: false, showSegments: false });
        view.addEdgeVertices([2, 7]);
        view.updateSegments();
        expectOnlyObjectAndEdge(view, { edgesVisible: false });
    });

    test('edges are visible while an edge tool is active, even if the mode hides them', () => {
        const view = makeView();
        view.setDisplayMode({ showEdges: false, showSegments: false });
        view.setEdgeEditing(true);
        view.addEdgeVertices([2, 7]);
        view.updateSegments();
        expectOnlyObjectAndEdge(view, { edgesVisible: true });

        // Leaving the tool returns to the chosen mode
        view.setEdgeEditing(false);
        expectOnlyObjectAndEdge(view, { edgesVisible: false });
        view.setEdgeEditing(true);
        expectOnlyObjectAndEdge(view, { edgesVisible: true });
    });
});
