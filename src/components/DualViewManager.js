/**
 * DualViewManager - Manages dual-view comparison mode for evaluation.
 * 
 * Provides synchronized camera views with independent rendering/visualization
 * for comparing ground truth vs prediction, or different visualization modes.
 * 
 * Key features:
 * - Viewport splitting (left/right)
 * - Camera synchronization between views
 * - Independent visualization modes per view
 * - Seamless integration with evaluation panel
 * 
 * @module DualViewManager
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { eventBus, Events } from '../utils/EventBus.js';

/**
 * Namespace for EventBus subscriptions.
 * @private
 */
const EVENTBUS_NAMESPACE = 'dualViewManager';

/**
 * DualViewManager handles split-screen comparison rendering.
 */
export class DualViewManager {
    /**
     * Create a DualViewManager.
     * 
     * @param {Object} scene - Scene object with renderer, camera, etc.
     * @param {MeshView} meshView - The main MeshView instance
     */
    constructor(scene, meshView) {
        this.scene = scene;
        this.meshView = meshView;
        
        // Dual view state
        this.enabled = false;
        this.splitRatio = 0.5; // Left view takes 50% of width
        
        // Secondary camera for right view
        this.camera2 = null;
        this.orbitControls2 = null;
        
        // View configurations
        this.leftViewConfig = {
            vizMode: 'gt',
            label: 'Ground Truth'
        };
        this.rightViewConfig = {
            vizMode: 'pred',
            label: 'Prediction'
        };
        
        // Store original colors for each view
        this.leftViewColors = null;
        this.rightViewColors = null;
        
        // Visualization instances for each view
        this.leftVisualization = null;
        this.rightVisualization = null;
        
        // UI elements
        this.viewLabels = { left: null, right: null };
        this.divider = null;
        this.floatingControls = null;
        
        // Bind methods
        this._onOrbitChange = this._onOrbitChange.bind(this);
        this._onWindowResize = this._onWindowResize.bind(this);
        
        // Set up event listeners
        this._setupEventBusSubscriptions();
    }
    
    /**
     * Set up EventBus subscriptions.
     * @private
     */
    _setupEventBusSubscriptions() {
        // Listen for mesh loads to reset state
        eventBus.on(Events.MESH_LOADED, () => {
            if (this.enabled) {
                this.disable();
            }
        }, EVENTBUS_NAMESPACE);
    }
    
    /**
     * Enable dual-view mode.
     * Creates secondary camera and sets up viewport splitting.
     */
    enable() {
        if (this.enabled) return;
        
        console.log('[DualViewManager] Enabling dual-view mode');
        this.enabled = true;
        
        // Store original camera aspect for restoration
        this._originalCameraAspect = this.scene.camera.aspect;
        
        // Create secondary camera (clone of primary)
        this._createSecondaryCamera();
        
        // Sync camera immediately
        this._onOrbitChange();
        
        // Create UI elements
        this._createUIElements();
        
        // Hide floating undo/redo controls (not needed in dual view)
        this._hideFloatingControls();
        
        // Store original animate function and override with dual-view render
        this._originalAnimate = this.scene.animate;
        this._setupDualViewRendering();
        
        // Add window resize handler
        window.addEventListener('resize', this._onWindowResize);
        
        // Emit event
        eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: true });
    }
    
    /**
     * Disable dual-view mode.
     * Restores single-view rendering.
     */
    disable() {
        if (!this.enabled) return;
        
        console.log('[DualViewManager] Disabling dual-view mode');
        this.enabled = false;
        
        // Restore original animate function
        if (this._originalAnimate) {
            this.scene.animate = this._originalAnimate;
        }
        
        // Clean up secondary camera
        this._disposeSecondaryCamera();
        
        // Remove UI elements
        this._removeUIElements();
        
        // Show floating undo/redo controls again
        this._showFloatingControls();
        
        // Remove event listeners
        window.removeEventListener('resize', this._onWindowResize);
        
        // Reset renderer viewport and scissor
        const renderer = this.scene.renderer;
        const size = new THREE.Vector2();
        renderer.getSize(size);
        
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
        
        // Restore camera aspect ratio
        if (this._originalCameraAspect) {
            this.scene.camera.aspect = this._originalCameraAspect;
        } else {
            this.scene.camera.aspect = size.x / size.y;
        }
        this.scene.camera.updateProjectionMatrix();
        
        // Memory cleanup - release large buffers
        this._cleanupMemory();
        
        // Emit event
        eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: false });
    }
    
    /**
     * Toggle dual-view mode.
     * @returns {boolean} New enabled state
     */
    toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
        return this.enabled;
    }
    
    /**
     * Check if dual-view is enabled.
     * @returns {boolean}
     */
    isEnabled() {
        return this.enabled;
    }
    
    /**
     * Set visualization mode for left view.
     * @param {string} mode - Visualization mode
     */
    setLeftViewMode(mode) {
        this.leftViewConfig.vizMode = mode;
        this._updateViewLabel('left', mode);
    }
    
    /**
     * Set visualization mode for right view.
     * @param {string} mode - Visualization mode
     */
    setRightViewMode(mode) {
        this.rightViewConfig.vizMode = mode;
        this._updateViewLabel('right', mode);
    }
    
    /**
     * Get visualization mode for left view.
     * @returns {string}
     */
    getLeftViewMode() {
        return this.leftViewConfig.vizMode;
    }
    
    /**
     * Get visualization mode for right view.
     * @returns {string}
     */
    getRightViewMode() {
        return this.rightViewConfig.vizMode;
    }
    
    /**
     * Set visualizations and metrics for rendering.
     * Called by EvaluationPanel when metrics are computed or viz mode changes.
     * 
     * @param {Object} options
     * @param {BaseVisualization} options.leftVisualization - Left view visualization
     * @param {BaseVisualization} options.rightVisualization - Right view visualization
     * @param {Object} options.metrics - Computed metrics
     */
    setVisualizations({ leftVisualization, rightVisualization, metrics }) {
        this.leftVisualization = leftVisualization;
        this.rightVisualization = rightVisualization;
        this.metrics = metrics;
        
        // Pre-compute colors for both views
        if (this.enabled && metrics) {
            this._computeViewColors();
        }
    }
    
    /**
     * Create secondary camera as a clone of the primary.
     * @private
     */
    _createSecondaryCamera() {
        const primary = this.scene.camera;
        
        // Create secondary camera with same parameters
        this.camera2 = new THREE.PerspectiveCamera(
            primary.fov,
            primary.aspect,
            primary.near,
            primary.far
        );
        
        // Copy position and rotation
        this.camera2.position.copy(primary.position);
        this.camera2.rotation.copy(primary.rotation);
        this.camera2.zoom = primary.zoom;
        
        // Create orbit controls for secondary camera (shared canvas)
        // Note: We don't enable these - they just sync with primary
        this.orbitControls2 = new OrbitControls(this.camera2, this.scene.canvas);
        this.orbitControls2.enabled = false; // Disabled - we sync manually
        this.orbitControls2.target.copy(this.scene.rotationController.getOrbitTarget());
        
        // Listen to primary orbit controls changes
        this.scene.controls.addEventListener('change', this._onOrbitChange);
    }
    
    /**
     * Dispose secondary camera and controls.
     * @private
     */
    _disposeSecondaryCamera() {
        if (this.orbitControls2) {
            this.orbitControls2.dispose();
            this.orbitControls2 = null;
        }
        
        this.camera2 = null;
        
        // Remove orbit listener
        this.scene.controls.removeEventListener('change', this._onOrbitChange);
    }
    
    /**
     * Handle orbit controls change - sync secondary camera.
     * @private
     */
    _onOrbitChange() {
        if (!this.camera2) return;
        
        const primary = this.scene.camera;
        
        // Sync position, rotation, and zoom
        this.camera2.position.copy(primary.position);
        this.camera2.rotation.copy(primary.rotation);
        this.camera2.zoom = primary.zoom;
        this.camera2.updateProjectionMatrix();
        
        // Sync orbit target
        if (this.orbitControls2) {
            this.orbitControls2.target.copy(this.scene.rotationController.getOrbitTarget());
        }
    }
    
    /**
     * Handle window resize.
     * @private
     */
    _onWindowResize() {
        // Cameras will be updated in the render loop
    }
    
    /**
     * Set up dual-view rendering.
     * Overrides the scene's animate function.
     * @private
     */
    _setupDualViewRendering() {
        const self = this;
        const scene = this.scene;
        
        // Store mesh colors for swapping
        this._backupMeshColors();
        
        // Override animate function
        scene.animate = function() {
            requestAnimationFrame(scene.animate);
            
            // Update rotation controller for smooth damping
            scene.rotationController.update();
            
            // Update light position if following camera
            if (scene.lightFollowsCamera) {
                scene.updateLightFromCamera();
            }
            
            if (self.enabled) {
                self._renderDualView();
            } else {
                scene.renderer.render(scene.scene, scene.camera);
            }
        };
    }
    
    /**
     * Backup mesh colors for restoring after visualization swaps.
     * @private
     */
    _backupMeshColors() {
        const colors = this.meshView.meshColors;
        if (colors) {
            this._originalColors = new Float32Array(colors);
        }
    }
    
    /**
     * Compute and cache colors for both views.
     * @private
     */
    _computeViewColors() {
        const vertexCount = this.meshView.vertexCount;
        
        // Initialize color buffers
        this.leftViewColors = new Float32Array(vertexCount * 3);
        this.rightViewColors = new Float32Array(vertexCount * 3);
        
        // Apply left visualization and capture colors
        if (this.leftVisualization && this.metrics) {
            this.leftVisualization.apply(this.metrics);
            const colors = this.meshView.meshColors;
            if (colors) {
                this.leftViewColors.set(colors);
            }
        }
        
        // Apply right visualization and capture colors
        if (this.rightVisualization && this.metrics) {
            this.rightVisualization.apply(this.metrics);
            const colors = this.meshView.meshColors;
            if (colors) {
                this.rightViewColors.set(colors);
            }
        }
    }
    
    /**
     * Apply colors to mesh for a specific view.
     * @private
     * @param {'left'|'right'} view - Which view's colors to apply
     */
    _applyViewColors(view) {
        const colors = view === 'left' ? this.leftViewColors : this.rightViewColors;
        if (!colors || !this.meshView.meshColors) return;
        
        this.meshView.meshColors.set(colors);
        
        const mesh = this.meshView.mesh;
        if (mesh?.geometry?.attributes?.color) {
            mesh.geometry.attributes.color.needsUpdate = true;
        }
    }
    
    /**
     * Render dual-view with viewport splitting.
     * @private
     */
    _renderDualView() {
        const renderer = this.scene.renderer;
        const threeScene = this.scene.scene;
        
        // Get canvas dimensions using getSize() for correct dimensions
        const size = new THREE.Vector2();
        renderer.getSize(size);
        const width = size.x;
        const height = size.y;
        
        // Calculate viewport dimensions
        const leftWidth = Math.floor(width * this.splitRatio);
        const rightWidth = width - leftWidth;
        
        // Clear the entire canvas first
        renderer.setScissorTest(false);
        renderer.clear();
        
        // Enable scissor test for clean separation
        renderer.setScissorTest(true);
        
        // ---- Render Left View ----
        // Update camera aspect for left view
        this.scene.camera.aspect = leftWidth / height;
        this.scene.camera.updateProjectionMatrix();
        
        renderer.setViewport(0, 0, leftWidth, height);
        renderer.setScissor(0, 0, leftWidth, height);
        
        // Apply left view colors
        if (this.leftViewColors && this.leftViewColors.length > 0) {
            this._applyViewColors('left');
        }
        
        renderer.render(threeScene, this.scene.camera);
        
        // ---- Render Right View ----
        // Use secondary camera for right view
        const rightCamera = this.camera2 || this.scene.camera;
        rightCamera.aspect = rightWidth / height;
        rightCamera.updateProjectionMatrix();
        
        renderer.setViewport(leftWidth, 0, rightWidth, height);
        renderer.setScissor(leftWidth, 0, rightWidth, height);
        
        // Apply right view colors
        if (this.rightViewColors && this.rightViewColors.length > 0) {
            this._applyViewColors('right');
        }
        
        renderer.render(threeScene, rightCamera);
        
        // Disable scissor test and reset viewport
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
    }
    
    /**
     * Create UI elements for dual-view mode (labels, divider).
     * @private
     */
    _createUIElements() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        
        // Create divider
        this.divider = document.createElement('div');
        this.divider.className = 'dual-view-divider';
        container.appendChild(this.divider);
        
        // Create left label
        this.viewLabels.left = document.createElement('div');
        this.viewLabels.left.className = 'dual-view-label dual-view-label-left';
        this.viewLabels.left.textContent = this._getModeLabel(this.leftViewConfig.vizMode);
        container.appendChild(this.viewLabels.left);
        
        // Create right label
        this.viewLabels.right = document.createElement('div');
        this.viewLabels.right.className = 'dual-view-label dual-view-label-right';
        this.viewLabels.right.textContent = this._getModeLabel(this.rightViewConfig.vizMode);
        container.appendChild(this.viewLabels.right);
        
        // Add dual-view class to canvas container
        container.classList.add('dual-view-active');
    }
    
    /**
     * Remove UI elements.
     * @private
     */
    _removeUIElements() {
        const container = document.querySelector('.canvas-container');
        if (!container) return;
        
        if (this.divider) {
            this.divider.remove();
            this.divider = null;
        }
        
        if (this.viewLabels.left) {
            this.viewLabels.left.remove();
            this.viewLabels.left = null;
        }
        
        if (this.viewLabels.right) {
            this.viewLabels.right.remove();
            this.viewLabels.right = null;
        }
        
        container.classList.remove('dual-view-active');
    }
    
    /**
     * Update view label text.
     * @private
     * @param {'left'|'right'} view - Which view
     * @param {string} mode - Visualization mode
     */
    _updateViewLabel(view, mode) {
        const label = this.viewLabels[view];
        if (label) {
            label.textContent = this._getModeLabel(mode);
        }
    }
    
    /**
     * Get human-readable label for a visualization mode.
     * @private
     * @param {string} mode - Visualization mode
     * @returns {string}
     */
    _getModeLabel(mode) {
        const labels = {
            'gt': 'Ground Truth',
            'pred': 'Prediction',
            'matched': 'Matched',
            'overseg': 'Over-segmentation',
            'underseg': 'Under-segmentation',
            'missingGt': 'Missing GT',
            'missingPred': 'Hallucinated',
            'all': 'All Errors'
        };
        return labels[mode] || mode;
    }
    
    /**
     * Hide floating undo/redo controls during dual view.
     * @private
     */
    _hideFloatingControls() {
        this.floatingControls = document.querySelector('.floating-controls');
        if (this.floatingControls) {
            this._floatingControlsOriginalDisplay = this.floatingControls.style.display;
            this.floatingControls.style.display = 'none';
        }
    }
    
    /**
     * Show floating undo/redo controls when exiting dual view.
     * @private
     */
    _showFloatingControls() {
        if (this.floatingControls) {
            this.floatingControls.style.display = this._floatingControlsOriginalDisplay || '';
            this.floatingControls = null;
        }
    }
    
    /**
     * Clean up memory by releasing large buffers.
     * Called when disabling dual view to free memory.
     * @private
     */
    _cleanupMemory() {
        // Release color buffers (these can be large for complex meshes)
        if (this.leftViewColors) {
            this.leftViewColors = null;
        }
        if (this.rightViewColors) {
            this.rightViewColors = null;
        }
        if (this._originalColors) {
            this._originalColors = null;
        }
        
        // Clear visualization references
        this.leftVisualization = null;
        this.rightVisualization = null;
        this.metrics = null;
        
        // Clear stored aspect ratio
        this._originalCameraAspect = null;
        this._floatingControlsOriginalDisplay = null;
        
        console.log('[DualViewManager] Memory cleaned up');
    }
    
    /**
     * Refresh visualizations for both views.
     * Call this when metrics are recomputed or visualization modes change.
     */
    refresh() {
        if (!this.enabled) return;
        
        if (this.metrics) {
            this._computeViewColors();
        }
    }
    
    /**
     * Clean up resources.
     */
    dispose() {
        this.disable();
        eventBus.offNamespace(EVENTBUS_NAMESPACE);
    }
}
