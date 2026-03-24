/**
 * ScarGraphContext - Shared scar graph infrastructure for panels.
 *
 * Provides graph initialization, backward indices, surface points,
 * label overlay, highlight management, colormap application, and
 * camera focus. Used by AnalysisPanel (and in the future, ScarOrderPanel).
 *
 * @module geometry/ScarGraphContext
 */

import * as THREE from 'three';
import { buildScarGraph } from './ScarGraph.js';
import { sampleColormap, colormapHexColors } from '../utils/colormaps.js';

const LABEL_OFFSET_PX = 45;
const LABEL_MIN_DIST = 32;
const LABEL_REPULSION_ITERS = 4;

export class ScarGraphContext {
    /**
     * @param {import('../components/MeshView.js').MeshView} meshView
     */
    constructor(meshView) {
        this.meshView = meshView;
        this.scarGraph = null;
        this._stale = true;

        // Backward indices
        this._labelToScarId = new Map();
        this._scarIdToVertices = new Map();
        this._adjacencySet = new Set();

        // Surface point data for labels and camera focus
        this._scarSurfaceData = new Map(); // scarId → { position: Vector3, normal: Vector3 }

        // Label overlay state
        this._labelElements = new Map();
        this._lineElements = new Map();
        this._labelRAF = null;
        this._overlayEl = null;
        this._svgEl = null;

        // Highlight state
        this._highlights = [];
    }

    // ========================================
    // Core graph
    // ========================================

    get isInitialized() {
        return this.scarGraph !== null && !this._stale;
    }

    get labelToScarId() { return this._labelToScarId; }
    get scarIdToVertices() { return this._scarIdToVertices; }
    get adjacencySet() { return this._adjacencySet; }
    get scarSurfaceData() { return this._scarSurfaceData; }

    /**
     * Build scar graph and backward indices from current MeshView state.
     * @returns {boolean} true if graph was built successfully
     */
    initialize() {
        const mv = this.meshView;
        if (!mv.segments || mv.segments.length < 2) {
            return false;
        }

        this.scarGraph = buildScarGraph(
            mv.faceLabels,
            mv.currentEdgeIndices,
            mv.adjacencyGraph,
            mv.vertexCount,
            mv.positions,
            mv.indices
        );

        this._labelToScarId.clear();
        this._scarIdToVertices.clear();
        this._adjacencySet.clear();

        for (const scar of this.scarGraph.scars) {
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            this._labelToScarId.set(label, scar.scarId);
        }

        const wl = this.scarGraph.workingLabels;
        for (let v = 0; v < wl.length; v++) {
            if (wl[v] === 0) continue;
            const scarId = this._labelToScarId.get(wl[v]);
            if (scarId === undefined) continue;
            if (!this._scarIdToVertices.has(scarId)) this._scarIdToVertices.set(scarId, []);
            this._scarIdToVertices.get(scarId).push(v);
        }

        for (const edge of this.scarGraph.edges) {
            const a = Math.min(edge.scarA, edge.scarB);
            const b = Math.max(edge.scarA, edge.scarB);
            this._adjacencySet.add(`${a}_${b}`);
        }

        this.computeSurfacePoints();
        this._stale = false;
        return true;
    }

    /**
     * Resolve a vertex index to a scarId.
     * @param {number} vertexIndex
     * @returns {number|undefined} scarId or undefined
     */
    vertexToScarId(vertexIndex) {
        if (!this.scarGraph) return undefined;
        const label = this.scarGraph.workingLabels[vertexIndex];
        if (!label) return undefined;
        return this._labelToScarId.get(label);
    }

    /**
     * Check if two scars are adjacent.
     */
    areAdjacent(a, b) {
        return this._adjacencySet.has(`${Math.min(a, b)}_${Math.max(a, b)}`);
    }

    markStale() {
        this._stale = true;
    }

    // ========================================
    // Surface points
    // ========================================

    computeSurfacePoints() {
        this._scarSurfaceData.clear();
        if (!this.scarGraph) return;

        const positions = this.meshView.positions;
        if (!positions || positions.length === 0) return;

        for (const scar of this.scarGraph.scars) {
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (!vertices || vertices.length === 0) continue;

            let cx = 0, cy = 0, cz = 0;
            for (const v of vertices) {
                cx += positions[v * 3];
                cy += positions[v * 3 + 1];
                cz += positions[v * 3 + 2];
            }
            cx /= vertices.length;
            cy /= vertices.length;
            cz /= vertices.length;

            let bestDist = Infinity;
            let bestV = vertices[0];
            for (const v of vertices) {
                const dx = positions[v * 3] - cx;
                const dy = positions[v * 3 + 1] - cy;
                const dz = positions[v * 3 + 2] - cz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bestDist) { bestDist = d; bestV = v; }
            }

            const normal = this.meshView.basicMesh.getVertexNormal(bestV);
            const nx = normal?.x || 0, ny = normal?.y || 0, nz = normal?.z || 0;
            const offset = 0.15;

            this._scarSurfaceData.set(scar.scarId, {
                position: new THREE.Vector3(
                    positions[bestV * 3] + nx * offset,
                    positions[bestV * 3 + 1] + ny * offset,
                    positions[bestV * 3 + 2] + nz * offset
                ),
                normal: new THREE.Vector3(nx, ny, nz),
            });
        }
    }

    // ========================================
    // Highlight management
    // ========================================

    /**
     * Highlight a scar by drawing its boundary edges — vertices that
     * belong to this scar but are adjacent to a different scar.
     * @param {number} scarId
     * @param {THREE.Color} color - Color for the boundary outline
     */
    highlightScar(scarId, color) {
        if (!this.scarGraph) return;
        const boundaryVerts = this._getScarBoundaryVertices(scarId);
        if (boundaryVerts.length === 0) return;

        this._highlights.push({ scarId, vertices: boundaryVerts });
        this.meshView.colorVertices(boundaryVerts, color);
    }

    /**
     * Find boundary vertices of a scar — those adjacent to a different scar.
     * @param {number} scarId
     * @returns {number[]}
     */
    _getScarBoundaryVertices(scarId) {
        const vertices = this._scarIdToVertices.get(scarId);
        if (!vertices || vertices.length === 0) return [];

        const adjacencyGraph = this.meshView.adjacencyGraph;
        const wl = this.scarGraph.workingLabels;
        const scarLabel = wl[this.scarGraph.scars[scarId]?.representativeVertex];
        if (!scarLabel) return [];

        const boundary = [];
        for (const v of vertices) {
            const neighbors = adjacencyGraph.get(v);
            if (!neighbors) continue;
            for (const n of neighbors) {
                if (wl[n] !== scarLabel) {
                    boundary.push(v);
                    break;
                }
            }
        }
        return boundary;
    }

    /**
     * Restore all highlighted scars to their segment colors from faceColors.
     */
    restoreAllHighlights() {
        if (!this.scarGraph) { this._highlights = []; return; }

        for (const { scarId, vertices } of this._highlights) {
            const label = this.scarGraph.workingLabels[this.scarGraph.scars[scarId]?.representativeVertex];
            const color = this.meshView.faceColors.get(label);
            if (color && vertices.length > 0) {
                this.meshView.colorVertices(vertices, color);
            }
        }
        this._highlights = [];
    }

    // ========================================
    // Color management
    // ========================================

    /**
     * Recolor all scar vertices using their segment colors from faceColors.
     * This makes eroded edge vertices adopt the segment color.
     */
    recolorAllScars() {
        if (!this.scarGraph) return;
        for (const scar of this.scarGraph.scars) {
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            const color = this.meshView.faceColors.get(label);
            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (color && vertices) this.meshView.colorVertices(vertices, color);
        }
    }

    /**
     * Restore normal MeshView coloring: segment colors + edge colors.
     */
    restoreNormalView() {
        if (!this.meshView.showSegments) {
            this.meshView.setShowSegments(false);
        } else {
            this.meshView.segments.forEach((segment, index) => {
                const segmentId = index + 1;
                const color = this.meshView.faceColors.get(segmentId) || this.meshView.objectColor;
                segment.forEach(vertexIndex => {
                    this.meshView.colorVertex(vertexIndex, color);
                });
            });
        }
        for (const index of this.meshView.currentEdgeIndices) {
            this.meshView.colorVertex(index, this.meshView.edgeColor);
        }
    }

    /**
     * Apply a colormap to scars based on a value map.
     * @param {string} colormapName - Colormap key
     * @param {Map<number, number>} scarToT - scarId → [0,1] position
     * @param {Set<number>} [exclude] - scarIds to skip (e.g. custom-colored scars)
     */
    applyColormap(colormapName, scarToT, exclude) {
        if (!this.scarGraph) return;
        for (const scar of this.scarGraph.scars) {
            if (exclude && exclude.has(scar.scarId)) continue;
            const t = scarToT.get(scar.scarId);
            if (t === undefined) continue;
            const color = new THREE.Color(...sampleColormap(colormapName, t));

            // Update faceColors so restores stay consistent
            const label = this.scarGraph.workingLabels[scar.representativeVertex];
            if (label) this.meshView.faceColors.set(label, color);

            const vertices = this._scarIdToVertices.get(scar.scarId);
            if (vertices) this.meshView.colorVertices(vertices, color);
        }
    }

    /**
     * Color a single scar with a specific color.
     * Updates faceColors as the source of truth so restores are consistent.
     * @param {number} scarId
     * @param {THREE.Color} color
     */
    colorScar(scarId, color) {
        if (!this.scarGraph) return;
        const scar = this.scarGraph.scars[scarId];
        if (!scar) return;

        // Update faceColors so all future restores use this color
        const label = this.scarGraph.workingLabels[scar.representativeVertex];
        if (label) this.meshView.faceColors.set(label, color.clone());

        const vertices = this._scarIdToVertices.get(scarId);
        if (vertices) this.meshView.colorVertices(vertices, color);
    }

    /**
     * Get the segment color for a scar from faceColors.
     * @param {number} scarId
     * @returns {string} hex color string
     */
    getScarSegmentColor(scarId) {
        if (!this.scarGraph) return '#888';
        const scar = this.scarGraph.scars[scarId];
        if (!scar) return '#888';
        const label = this.scarGraph.workingLabels[scar.representativeVertex];
        const color = this.meshView.faceColors.get(label);
        return color ? `#${color.getHexString()}` : '#888';
    }

    // ========================================
    // Label overlay
    // ========================================

    /**
     * Create label elements on the overlay.
     * @param {HTMLElement} overlayEl - Container for label badges
     * @param {SVGElement} svgEl - SVG for connection lines
     * @param {function} labelDataProvider - (scarId) => { text: string, color: string } | null
     */
    createLabels(overlayEl, svgEl, labelDataProvider) {
        this.removeLabels();
        this._overlayEl = overlayEl;
        this._svgEl = svgEl;
        if (!overlayEl || !svgEl || !this.scarGraph) return;

        for (const scar of this.scarGraph.scars) {
            const data = labelDataProvider(scar.scarId);
            if (!data) continue;
            if (!this._scarSurfaceData.has(scar.scarId)) continue;

            const el = document.createElement('div');
            el.className = 'scar-label';
            el.innerHTML = `<span class="scar-label-badge" style="background:${data.color}">${data.text}</span>`;
            el.style.display = 'none';
            overlayEl.appendChild(el);
            this._labelElements.set(scar.scarId, el);

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', data.color);
            line.style.display = 'none';
            svgEl.appendChild(line);
            this._lineElements.set(scar.scarId, line);
        }
    }

    removeLabels() {
        for (const el of this._labelElements.values()) el.remove();
        this._labelElements.clear();
        for (const el of this._lineElements.values()) el.remove();
        this._lineElements.clear();
    }

    _updateLabelPositions() {
        if (!this._overlayEl || this._labelElements.size === 0) return;

        const camera = this.meshView.scene?.camera;
        const canvas = this.meshView.scene?.canvas;
        const mesh = this.meshView.threeMesh;
        if (!camera || !canvas || !mesh) return;

        const rect = canvas.getBoundingClientRect();
        const canvasCx = rect.width / 2;
        const canvasCy = rect.height / 2;
        const tempVec = new THREE.Vector3();
        const tempNormal = new THREE.Vector3();
        const tempToCamera = new THREE.Vector3();

        // Phase 1: compute anchor + label positions, check visibility
        const labelData = [];

        for (const [scarId] of this._labelElements) {
            const data = this._scarSurfaceData.get(scarId);
            if (!data) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            tempVec.copy(data.position).applyMatrix4(mesh.matrixWorld);

            // Back-face check
            tempNormal.copy(data.normal).transformDirection(mesh.matrixWorld);
            tempToCamera.copy(camera.position).sub(tempVec).normalize();
            if (tempNormal.dot(tempToCamera) < 0.05) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            const worldPos = tempVec.clone();
            tempVec.project(camera);

            if (tempVec.z > 1 || tempVec.z < 0 ||
                tempVec.x < -1.2 || tempVec.x > 1.2 ||
                tempVec.y < -1.2 || tempVec.y > 1.2) {
                labelData.push({ scarId, visible: false });
                continue;
            }

            const anchorX = (tempVec.x + 1) * rect.width / 2;
            const anchorY = (-tempVec.y + 1) * rect.height / 2;

            let dx = anchorX - canvasCx;
            let dy = anchorY - canvasCy;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 1) { dx /= len; dy /= len; }
            else { dx = 1; dy = 0; }

            labelData.push({
                scarId,
                visible: true,
                anchorX,
                anchorY,
                labelX: anchorX + dx * LABEL_OFFSET_PX,
                labelY: anchorY + dy * LABEL_OFFSET_PX,
            });
        }

        // Phase 2: repulsion to prevent overlap
        const visible = labelData.filter(d => d.visible);
        for (let iter = 0; iter < LABEL_REPULSION_ITERS; iter++) {
            for (let i = 0; i < visible.length; i++) {
                for (let j = i + 1; j < visible.length; j++) {
                    const a = visible[i], b = visible[j];
                    const dx = b.labelX - a.labelX;
                    const dy = b.labelY - a.labelY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < LABEL_MIN_DIST && dist > 0.1) {
                        const push = (LABEL_MIN_DIST - dist) / 2;
                        const nx = dx / dist, ny = dy / dist;
                        a.labelX -= nx * push;
                        a.labelY -= ny * push;
                        b.labelX += nx * push;
                        b.labelY += ny * push;
                    }
                }
            }
        }

        // Phase 3: apply to DOM
        for (const d of labelData) {
            const el = this._labelElements.get(d.scarId);
            const line = this._lineElements.get(d.scarId);

            if (!d.visible) {
                if (el) el.style.display = 'none';
                if (line) line.style.display = 'none';
                continue;
            }

            if (el) {
                el.style.display = '';
                el.style.left = `${d.labelX}px`;
                el.style.top = `${d.labelY}px`;
            }
            if (line) {
                line.style.display = '';
                line.setAttribute('x1', String(d.anchorX));
                line.setAttribute('y1', String(d.anchorY));
                line.setAttribute('x2', String(d.labelX));
                line.setAttribute('y2', String(d.labelY));
            }
        }
    }

    startLabelLoop() {
        if (this._labelRAF) return;
        const update = () => {
            this._updateLabelPositions();
            this._labelRAF = requestAnimationFrame(update);
        };
        this._labelRAF = requestAnimationFrame(update);
    }

    stopLabelLoop() {
        if (this._labelRAF) {
            cancelAnimationFrame(this._labelRAF);
            this._labelRAF = null;
        }
    }

    // ========================================
    // Camera
    // ========================================

    /**
     * Rotate camera so the given scar faces the viewer.
     * @param {number} scarId
     */
    focusCameraOnScar(scarId) {
        const data = this._scarSurfaceData.get(scarId);
        const mesh = this.meshView.threeMesh;
        if (!data || !mesh) return;

        const camera = this.meshView.scene.camera;
        const controls = this.meshView.scene.controls;

        const worldNormal = data.normal.clone().transformDirection(mesh.matrixWorld).normalize();
        const target = controls.target.clone();
        const dist = camera.position.distanceTo(target);

        camera.position.copy(target).addScaledVector(worldNormal, dist);
        controls.update();
    }

    // ========================================
    // Lifecycle
    // ========================================

    clear() {
        this.stopLabelLoop();
        this.removeLabels();
        this.restoreAllHighlights();
        this.scarGraph = null;
        this._labelToScarId.clear();
        this._scarIdToVertices.clear();
        this._adjacencySet.clear();
        this._scarSurfaceData.clear();
        this._stale = true;
    }

    dispose() {
        this.clear();
    }
}
