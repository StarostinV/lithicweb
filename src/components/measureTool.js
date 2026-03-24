/**
 * MeasureTool - Interactive distance and angle measurement on meshes.
 *
 * Distance: Click two points to measure Euclidean distance.
 * Angle: Click three points to measure angle at the middle point.
 *
 * @module MeasureTool
 */

import * as THREE from 'three';
import { eventBus, Events } from '../utils/EventBus.js';
import { MODES } from '../utils/mode.js';
import { getEffectiveUnit, getSourceUnit, formatDistanceConverted, formatAngle } from '../utils/units.js';

export class MeasureTool {
    /**
     * @param {MeshView} meshView
     * @param {Mode} mode
     * @param {UserConfig} userConfig
     * @param {Scene} scene
     */
    constructor(meshView, mode, userConfig, scene) {
        this.meshView = meshView;
        this.mode = mode;
        this.userConfig = userConfig;
        this.scene = scene;

        // State
        this._points = [];       // Array of THREE.Vector3
        this._markers = [];      // Array of THREE.Mesh (spheres)
        this._lines = [];        // Array of THREE.Line
        this._arc = null;        // THREE.Line for angle arc
        this._distance = null;
        this._angle = null;

        // 3D label overlay
        this._labelEl = null;
        this._labelVisible = false;

        // DOM elements
        this._resultEl = document.getElementById('measureResult');
        this._resultValueEl = document.getElementById('measureResultValue');
        this._resultLabelEl = document.getElementById('measureResultLabel');
        this._clearBtn = document.getElementById('measureClearBtn');
        this._distanceBtn = document.getElementById('measureDistanceBtn');
        this._angleBtn = document.getElementById('measureAngleBtn');

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onAnimationFrame = this._onAnimationFrame.bind(this);

        this._setupListeners();
        this._setupEventBus();
        this._createLabelOverlay();
    }

    _setupListeners() {
        const canvas = this.scene.canvas;
        if (canvas) {
            canvas.addEventListener('pointerdown', this._onPointerDown);
        }

        document.addEventListener('keydown', this._onKeyDown);

        if (this._clearBtn) {
            this._clearBtn.addEventListener('click', () => this.clear());
        }
        if (this._distanceBtn) {
            this._distanceBtn.addEventListener('click', () => {
                this.mode.setMode(MODES.MEASURE, true);
            });
        }
        if (this._angleBtn) {
            this._angleBtn.addEventListener('click', () => {
                this.mode.setMode(MODES.MEASURE_ANGLE, true);
            });
        }
    }

    _setupEventBus() {
        eventBus.on(Events.MESH_LOADED, () => {
            this.clear();
        }, 'measureTool');

        eventBus.on(Events.CONFIG_CHANGED, (data) => {
            if (data.path?.startsWith('units.') && (this._distance !== null || this._angle !== null)) {
                this._showResult();
            }
        }, 'measureTool');

        eventBus.on(Events.MODE_CHANGED, (data) => {
            this._updateButtonStates();
            // Clear visuals when leaving measure modes
            const wasMeasure = data.previousMode === MODES.MEASURE || data.previousMode === MODES.MEASURE_ANGLE;
            const isMeasure = data.mode === MODES.MEASURE || data.mode === MODES.MEASURE_ANGLE;
            if (wasMeasure && !isMeasure) {
                this.clear();
            }
            // Clear previous measurement when switching between distance and angle
            if (data.mode === MODES.MEASURE || data.mode === MODES.MEASURE_ANGLE) {
                this.clear();
            }
        }, 'measureTool');
    }

    _createLabelOverlay() {
        this._labelEl = document.createElement('div');
        this._labelEl.className = 'measure-label-overlay';
        this._labelEl.style.cssText = `
            position: absolute;
            pointer-events: none;
            background: rgba(0,0,0,0.75);
            color: white;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
            white-space: nowrap;
            z-index: 50;
            display: none;
            transform: translate(-50%, -100%) translateY(-8px);
        `;
        const container = document.querySelector('.canvas-container');
        if (container) container.appendChild(this._labelEl);
    }

    dispose() {
        eventBus.offNamespace('measureTool');
        const canvas = this.scene.canvas;
        if (canvas) canvas.removeEventListener('pointerdown', this._onPointerDown);
        document.removeEventListener('keydown', this._onKeyDown);
        this.clear();
        if (this._labelEl?.parentNode) this._labelEl.parentNode.removeChild(this._labelEl);
    }

    // ── Interaction ───────────────────────────────────────────────────

    _onPointerDown(event) {
        const currentMode = this.mode.currentMode;
        if (currentMode !== MODES.MEASURE && currentMode !== MODES.MEASURE_ANGLE) return;

        // Right-click clears
        if (event.button === 2) {
            this.clear();
            return;
        }
        if (event.button !== 0) return;

        // Get click point on mesh
        const mesh = this.meshView.mesh;
        if (!mesh) return;
        const clickPoint = this.meshView.intersectFinder.getClickedPoint(mesh, event);
        if (clickPoint === -1) return;

        const worldPos = clickPoint.clone();

        if (currentMode === MODES.MEASURE) {
            this._handleDistanceClick(worldPos);
        } else {
            this._handleAngleClick(worldPos);
        }
    }

    _onKeyDown(event) {
        if (event.key === 'Escape') {
            const currentMode = this.mode.currentMode;
            if (currentMode === MODES.MEASURE || currentMode === MODES.MEASURE_ANGLE) {
                this.clear();
            }
        }
    }

    _handleDistanceClick(worldPos) {
        if (this._points.length >= 2) {
            // Third click: replace previous measurement
            this._clearObjects();
            this._points = [];
            this._distance = null;
            this._angle = null;
        }

        this._points.push(worldPos);
        this._markers.push(this._createMarker(worldPos, 0x06b6d4));

        if (this._points.length === 2) {
            this._lines.push(this._createLine(this._points[0], this._points[1], 0x06b6d4));
            this._distance = this._points[0].distanceTo(this._points[1]);
            this._showResult();
            this._startLabelUpdate();
        }
    }

    _handleAngleClick(worldPos) {
        if (this._points.length >= 3) {
            // Fourth click: replace previous
            this._clearObjects();
            this._points = [];
            this._angle = null;
            this._distance = null;
        }

        this._points.push(worldPos);
        const color = 0xf59e0b;
        this._markers.push(this._createMarker(worldPos, color));

        if (this._points.length === 2) {
            // Draw first line segment A -> B
            this._lines.push(this._createLine(this._points[0], this._points[1], color));
        }

        if (this._points.length === 3) {
            // Draw second line segment B -> C
            this._lines.push(this._createLine(this._points[1], this._points[2], color));

            // Compute angle at B
            const A = this._points[0];
            const B = this._points[1];
            const C = this._points[2];
            const ba = new THREE.Vector3().subVectors(A, B).normalize();
            const bc = new THREE.Vector3().subVectors(C, B).normalize();
            const dot = THREE.MathUtils.clamp(ba.dot(bc), -1, 1);
            this._angle = Math.acos(dot);

            // Draw arc at B
            this._arc = this._createArc(B, ba, bc, this._angle, color);

            this._showResult();
            this._startLabelUpdate();
        }
    }

    // ── Three.js Objects ──────────────────────────────────────────────

    _getMarkerRadius() {
        // Scale marker relative to mesh bounding box
        const positions = this.meshView.positions;
        if (!positions || positions.length === 0) return 0.04;

        // Use a rough estimate from first 1000 vertices
        let maxDist = 0;
        const limit = Math.min(positions.length, 3000);
        for (let i = 0; i < limit; i += 3) {
            const d = positions[i] * positions[i] + positions[i + 1] * positions[i + 1] + positions[i + 2] * positions[i + 2];
            if (d > maxDist) maxDist = d;
        }
        return Math.sqrt(maxDist) * 0.008;
    }

    _createMarker(worldPos, color) {
        const radius = this._getMarkerRadius();
        const geometry = new THREE.SphereGeometry(radius, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
        const marker = new THREE.Mesh(geometry, material);
        marker.position.copy(worldPos);
        marker.renderOrder = 999;
        this.scene.scene.add(marker);
        return marker;
    }

    _createLine(pos1, pos2, color) {
        const geometry = new THREE.BufferGeometry().setFromPoints([pos1, pos2]);
        const material = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 999;
        this.scene.scene.add(line);
        return line;
    }

    _createArc(center, dir1, dir2, angle, color) {
        const radius = this._getMarkerRadius() * 4;
        const segments = 24;
        const points = [];

        // Create arc from dir1 toward dir2 around center
        const axis = new THREE.Vector3().crossVectors(dir1, dir2).normalize();
        // If vectors are parallel, pick an arbitrary perpendicular
        if (axis.length() < 0.001) return null;

        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * angle;
            const rotated = dir1.clone().applyAxisAngle(axis, t);
            points.push(new THREE.Vector3().copy(center).addScaledVector(rotated, radius));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 });
        const arc = new THREE.Line(geometry, material);
        arc.renderOrder = 999;
        this.scene.scene.add(arc);
        return arc;
    }

    // ── Result Display ────────────────────────────────────────────────

    _showResult() {
        if (this._distance !== null) {
            const sourceUnit = getSourceUnit(this.meshView.metadata, this.userConfig);
            const displayUnit = getEffectiveUnit(this.meshView.metadata, this.userConfig);
            const text = formatDistanceConverted(this._distance, sourceUnit, displayUnit);

            if (this._resultLabelEl) this._resultLabelEl.textContent = 'Distance';
            if (this._resultValueEl) this._resultValueEl.textContent = text;
            if (this._resultEl) this._resultEl.classList.remove('hidden');
            if (this._labelEl) this._labelEl.textContent = text;
        } else if (this._angle !== null) {
            const text = formatAngle(this._angle);

            if (this._resultLabelEl) this._resultLabelEl.textContent = 'Angle';
            if (this._resultValueEl) this._resultValueEl.textContent = text;
            if (this._resultEl) this._resultEl.classList.remove('hidden');
            if (this._labelEl) this._labelEl.textContent = text;
        }
    }

    _updateButtonStates() {
        if (this._distanceBtn) {
            this._distanceBtn.classList.toggle('active', this.mode.currentMode === MODES.MEASURE);
        }
        if (this._angleBtn) {
            this._angleBtn.classList.toggle('active', this.mode.currentMode === MODES.MEASURE_ANGLE);
        }
    }

    // ── 3D Label Positioning ──────────────────────────────────────────

    _startLabelUpdate() {
        this._labelVisible = true;
        this._updateLabelPosition();
        // Hook into animation loop
        if (!this._rafId) {
            this._rafId = requestAnimationFrame(this._onAnimationFrame);
        }
    }

    _onAnimationFrame() {
        if (!this._labelVisible) {
            this._rafId = null;
            return;
        }
        this._updateLabelPosition();
        this._rafId = requestAnimationFrame(this._onAnimationFrame);
    }

    _updateLabelPosition() {
        if (!this._labelEl || !this._labelVisible) return;

        let worldPoint;
        if (this._distance !== null && this._points.length >= 2) {
            // Midpoint of distance line
            worldPoint = new THREE.Vector3().lerpVectors(this._points[0], this._points[1], 0.5);
        } else if (this._angle !== null && this._points.length >= 3) {
            // Vertex point B
            worldPoint = this._points[1].clone();
        } else {
            this._labelEl.style.display = 'none';
            return;
        }

        // Project to screen
        const projected = worldPoint.clone().project(this.scene.camera);

        // Check if behind camera
        if (projected.z > 1) {
            this._labelEl.style.display = 'none';
            return;
        }

        const canvas = this.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = (projected.x * 0.5 + 0.5) * rect.width;
        const y = (-projected.y * 0.5 + 0.5) * rect.height;

        this._labelEl.style.display = 'block';
        this._labelEl.style.left = `${x}px`;
        this._labelEl.style.top = `${y}px`;
    }

    // ── Clear ─────────────────────────────────────────────────────────

    _clearObjects() {
        for (const marker of this._markers) {
            this.scene.scene.remove(marker);
            marker.geometry.dispose();
            marker.material.dispose();
        }
        for (const line of this._lines) {
            this.scene.scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        if (this._arc) {
            this.scene.scene.remove(this._arc);
            this._arc.geometry.dispose();
            this._arc.material.dispose();
            this._arc = null;
        }
        this._markers = [];
        this._lines = [];
    }

    clear() {
        this._clearObjects();
        this._points = [];
        this._distance = null;
        this._angle = null;
        this._labelVisible = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._labelEl) this._labelEl.style.display = 'none';
        if (this._resultEl) this._resultEl.classList.add('hidden');
    }
}
