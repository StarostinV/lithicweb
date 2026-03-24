import * as THREE from 'three';
import {MODES} from '../utils/mode.js';
import { eventBus, Events } from '../utils/EventBus.js';
import Slider from './slider.js';

/**
 * DrawBrush - Handles brush-based drawing and erasing on the mesh.
 * 
 * Features:
 * - Single vertex drawing with shortest path connection (DRAW mode)
 * - Brush mode for area-based drawing
 * - Ridge mode - dedicated drawing mode that follows sharp mesh features
 */
export default class DrawBrush {
    constructor(scene, mode, meshView) {
        this.scene = scene;
        this.mode = mode;
        this.meshView = meshView;
        this.isDrawing = false;
        this.useBrush = false;
        this.brushRadius = 0.5;
        this.previousVertex = null;
        
        // Ridge mode state
        this.ridgeStrength = 10;
        this.previewLineRidge = null;    // Orange line - ridge path preview
        this.previewStartMarker = null;  // Start point marker
        this.currentEndVertex = null;    // Track current end vertex for release

        this.leftClickDown = this.mouseDown.bind(this);
        this.mouseMove = this.mouseMove.bind(this);
        this.leftClickUp = this.mouseUp.bind(this);

        scene.canvas.addEventListener('pointerdown', (event) => this.mouseDown(event));
        scene.canvas.addEventListener('pointermove', (event) => this.mouseMove(event));
        scene.canvas.addEventListener('pointerup', (event) => this.mouseUp(event));

        this.brushBtn = document.getElementById('useBrush');
        this.slideBrush = new Slider("BrushSize", this.brushRadius, 0.1, 3, (value) => {this.brushRadius = value;});

        this.brushBtn.addEventListener('click', () => {
            this.useBrush = !this.useBrush;
            this.updateHTML();
        });

        // Ridge mode controls
        this._setupRidgeControls();
        
        // Listen for mode changes to show/hide ridge controls
        this._setupEventListeners();

        this.updateHTML();
    }
    
    /**
     * Setup ridge mode UI controls.
     * @private
     */
    _setupRidgeControls() {
        this.ridgeModeBtn = document.getElementById('ridgeMode');
        this.ridgeControlsContainer = document.getElementById('ridgeControls');
        this.ridgeStrengthSlider = document.getElementById('ridgeStrength');
        this.ridgeStrengthValue = document.getElementById('ridgeStrengthValue');
        
        // Ridge mode button
        if (this.ridgeModeBtn) {
            this.ridgeModeBtn.addEventListener('click', () => {
                this.mode.setMode(MODES.RIDGE);
            });
        }
        
        // Ridge strength slider
        if (this.ridgeStrengthSlider) {
            this.ridgeStrengthSlider.addEventListener('input', (e) => {
                this.ridgeStrength = parseFloat(e.target.value);
                if (this.ridgeStrengthValue) {
                    this.ridgeStrengthValue.textContent = Math.round(this.ridgeStrength);
                }
                this._syncPathFinderSettings();
            });
        }
    }
    
    /**
     * Setup EventBus listeners.
     * @private
     */
    _setupEventListeners() {
        // Show/hide ridge controls based on mode
        eventBus.on(Events.MODE_CHANGED, (data) => {
            this._updateRidgeControlsVisibility(data.mode);
            if (data.mode === MODES.RIDGE) {
                this._ensureAnglesComputed();
            }
        }, 'DrawBrush');
        
        // Reset when mesh changes and scale brush to mesh size
        eventBus.on(Events.MESH_LOADED, () => {
            this._clearPreviewLines();
            this._scaleBrushToMesh();
        }, 'DrawBrush');
    }
    
    /**
     * Update ridge controls visibility based on current mode.
     * @private
     */
    _updateRidgeControlsVisibility(currentMode) {
        if (this.ridgeControlsContainer) {
            this.ridgeControlsContainer.style.display = currentMode === MODES.RIDGE ? 'block' : 'none';
        }
    }
    
    /**
     * Scale brush radius and slider range to match loaded mesh size.
     * @private
     */
    _scaleBrushToMesh() {
        const info = this.meshView.basicMesh?.computeBoundingInfo();
        if (!info) return;
        const d = info.diagonal;
        this.brushRadius = d * 0.01;
        if (this.slideBrush?.slider?.noUiSlider) {
            this.slideBrush.slider.noUiSlider.updateOptions({
                range: { min: d * 0.002, max: d * 0.06 },
                start: [this.brushRadius]
            });
        }
    }

    /**
     * Ensure angles are computed (on demand).
     * @private
     * @returns {boolean} True if angles are available
     */
    _ensureAnglesComputed() {
        const basicMesh = this.meshView.basicMesh;
        if (!basicMesh || basicMesh.isNull()) return false;
        
        // BasicMesh.getVertexMaxAngles() computes on first call and caches
        const angles = basicMesh.getVertexMaxAngles();
        if (!angles) return false;
        
        // Pass to PathFinder if not already set
        if (this.meshView.pathFinder && !this.meshView.pathFinder.canFollowRidges()) {
            this.meshView.pathFinder.setVertexMaxAngles(angles);
            this._syncPathFinderSettings();
        }
        
        return true;
    }
    
    /**
     * Sync settings to the PathFinder.
     * @private
     */
    _syncPathFinderSettings() {
        if (this.meshView.pathFinder) {
            this.meshView.pathFinder.setRidgeStrength(this.ridgeStrength);
        }
    }

    updateHTML() {
        this.brushBtn.innerText = this.useBrush ? 'Disable brush' : 'Enable brush';
        if (this.useBrush) {
            this.slideBrush.show();
        } else { 
            this.slideBrush.hide();
        }
    }

    mouseDown(event) {
        if (event.button !== 0 || this.meshView.isNull()) return;

        // Handle DRAW, ERASE, and RIDGE modes
        if (this.mode == MODES.DRAW || this.mode == MODES.ERASE) {  
            this.isDrawing = true;  
            this.draw(event);
        } else if (this.mode == MODES.RIDGE) {
            // Ensure angles are computed before starting ridge draw
            if (!this._ensureAnglesComputed()) {
                console.warn('DrawBrush: Could not compute angles for ridge mode');
                return;
            }
            this.isDrawing = true;
            this.drawRidge(event);
        }
    }

    mouseUp(event) {
        if (event.button !== 0) return;
        if (this.isDrawing) {
            // If in ridge mode, commit the path on release
            if (this.mode == MODES.RIDGE && this.previousVertex !== null && this.currentEndVertex !== null) {
                this._commitRidgePath();
            }
            
            this.meshView.onDrawFinished();
            this.isDrawing = false;
            this.previousVertex = null;
            this.currentEndVertex = null;
            
            // Clear preview lines on mouse up
            this._clearPreviewLines();
        }
    }

    mouseMove(event) {
        if (this.meshView.isNull() || !this.isDrawing) return;

        if (this.mode == MODES.DRAW || this.mode == MODES.ERASE) {
            this.draw(event);
        } else if (this.mode == MODES.RIDGE) {
            this.drawRidge(event);
        }
    }

    draw(event) {
        if (this.meshView.isNull() || !this.isDrawing) return;
        
        // Only handle DRAW and ERASE modes here
        if (this.mode != MODES.DRAW && this.mode != MODES.ERASE) return;

        if (this.useBrush) {
            this.drawBrush(event);
        } else {
            this.drawVertex(event);
        }
    }

    drawVertex(event) {
        const closestVertexIndex = this.meshView.getClosestVertexIndex(event);

        if (closestVertexIndex === -1) return;

        if (this.previousVertex === null) {
            this.previousVertex = closestVertexIndex;
            if (this.mode == MODES.DRAW) {
                this.meshView.addEdgeVertex(closestVertexIndex);
            } else if (this.mode == MODES.ERASE) {
                this.meshView.removeEdgeVertex(closestVertexIndex);
            }
            return;
        }

        // Normal shortest path
        const path = this.meshView.findShortestPath(this.previousVertex, closestVertexIndex);
        
        if (this.mode == MODES.DRAW) {
            this.meshView.addEdgeVertices(path);
        } else if (this.mode == MODES.ERASE) {
            this.meshView.removeEdgeVertices(path);
        }

        this.previousVertex = closestVertexIndex;
    }
    
    /**
     * Handle ridge mode drawing - shows preview while dragging, commits on release.
     * @param {PointerEvent} event
     */
    drawRidge(event) {
        const closestVertexIndex = this.meshView.getClosestVertexIndex(event);

        if (closestVertexIndex === -1) return;

        if (this.previousVertex === null) {
            this.previousVertex = closestVertexIndex;
            this._createStartMarker(closestVertexIndex);
            return;
        }

        // Update preview line while dragging
        this.currentEndVertex = closestVertexIndex;
        this._renderRidgePreview(this.previousVertex, closestVertexIndex);
    }
    
    /**
     * Commit the ridge-following path as an actual annotation.
     * Called on mouse release.
     * @private
     */
    _commitRidgePath() {
        if (this.previousVertex === null || this.currentEndVertex === null) return;
        
        const ridgePath = this.meshView.pathFinder.findRidgeFollowingPath(
            this.previousVertex, 
            this.currentEndVertex
        );
        
        if (ridgePath.length > 0) {
            this.meshView.addEdgeVertices(ridgePath);
        }
    }

    drawBrush(event) {
        const vertexIndices = this.meshView.getVerticesWithinRadius(event, this.brushRadius);

        if (vertexIndices.length === 0) return;

        if (this.mode == MODES.DRAW) {
            this.meshView.addEdgeVertices(vertexIndices);
        } else if (this.mode == MODES.ERASE) {
            this.meshView.removeEdgeVertices(vertexIndices);
        }
    }
    
    // ========================================
    // Ridge Preview Visualization Methods
    // ========================================
    
    /**
     * Render the ridge-following path preview while dragging.
     * @private
     */
    _renderRidgePreview(startVertex, endVertex) {
        const ridgePath = this.meshView.pathFinder.findRidgeFollowingPath(startVertex, endVertex);
        
        // Clear existing preview line (keep start marker)
        if (this.previewLineRidge) {
            this.scene.scene.remove(this.previewLineRidge);
            this.previewLineRidge.geometry.dispose();
            this.previewLineRidge.material.dispose();
            this.previewLineRidge = null;
        }
        
        // Create preview line
        this._createPreviewLine(ridgePath);
    }
    
    /**
     * Create a preview line from a path of vertex indices.
     * @private
     */
    _createPreviewLine(path) {
        if (!path || path.length < 2) return;
        
        const mesh = this.meshView.mesh;
        if (!mesh) return;
        
        mesh.updateMatrixWorld(true);
        
        // Convert vertex indices to world positions
        const points = [];
        const info = this.meshView.basicMesh?.computeBoundingInfo();
        const offset = info ? info.diagonal * 0.0006 : 0.03;
        
        for (const vertexIndex of path) {
            const localPos = this.meshView.indexToVertex(vertexIndex);
            if (localPos) {
                // Get vertex normal for offset
                const normal = this.meshView.getVertexNormal(vertexIndex);
                if (normal && normal !== -1) {
                    localPos.addScaledVector(normal, offset);
                }
                const worldPos = localPos.clone().applyMatrix4(mesh.matrixWorld);
                points.push(worldPos);
            }
        }
        
        if (points.length < 2) return;
        
        // Create line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ 
            color: 0xff6600,  // Orange for ridge path
            linewidth: 3,
            depthTest: false,  // Always visible
            transparent: true,
            opacity: 0.9
        });
        
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 999;  // Render on top
        
        this.scene.scene.add(line);
        this.previewLineRidge = line;
    }
    
    /**
     * Create a marker at the start point.
     * @private
     */
    _createStartMarker(vertexIndex) {
        this._clearPreviewLines();
        
        const mesh = this.meshView.mesh;
        if (!mesh) return;
        
        mesh.updateMatrixWorld(true);
        
        const localPos = this.meshView.indexToVertex(vertexIndex);
        if (!localPos) return;

        const info = this.meshView.basicMesh?.computeBoundingInfo();
        const d = info ? info.diagonal : 1;

        const normal = this.meshView.getVertexNormal(vertexIndex);
        if (normal && normal !== -1) {
            localPos.addScaledVector(normal, d * 0.001);
        }

        const worldPos = localPos.clone().applyMatrix4(mesh.matrixWorld);

        // Create sphere marker
        const geometry = new THREE.SphereGeometry(d * 0.003, 16, 16);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x14b8a6,  // Teal to match the mode color
            depthTest: false
        });
        
        const marker = new THREE.Mesh(geometry, material);
        marker.position.copy(worldPos);
        marker.renderOrder = 999;
        
        this.scene.scene.add(marker);
        this.previewStartMarker = marker;
    }
    
    /**
     * Clear all preview visualization lines.
     * @private
     */
    _clearPreviewLines() {
        if (this.previewLineRidge) {
            this.scene.scene.remove(this.previewLineRidge);
            this.previewLineRidge.geometry.dispose();
            this.previewLineRidge.material.dispose();
            this.previewLineRidge = null;
        }
        
        if (this.previewStartMarker) {
            this.scene.scene.remove(this.previewStartMarker);
            this.previewStartMarker.geometry.dispose();
            this.previewStartMarker.material.dispose();
            this.previewStartMarker = null;
        }
    }
    
    /**
     * Dispose of resources.
     */
    dispose() {
        this._clearPreviewLines();
        eventBus.off(Events.MODE_CHANGED, 'DrawBrush');
        eventBus.off(Events.MESH_LOADED, 'DrawBrush');
    }
}
