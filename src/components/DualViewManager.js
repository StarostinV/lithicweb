/**
 * DualViewManager - Manages dual-view mode for both general use and evaluation.
 * 
 * Provides synchronized camera views with independent rendering/visualization
 * for comparing ground truth vs prediction, or different visualization modes.
 * 
 * Key features:
 * - Viewport splitting (left/right)
 * - Camera synchronization between views
 * - General mode: same mesh displayed in both views with active view selection
 * - Evaluation mode: independent visualization modes per view
 * - Seamless integration with both rendering and evaluation panels
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.MESH_LOADED` - Disables dual view when new mesh is loaded
 * - `Events.ANNOTATION_ACTIVE_CHANGED` - Updates active view's label when annotation name changes
 * 
 * Emits:
 * - `Events.DUAL_VIEW_CHANGED` - When dual view is enabled/disabled
 *   Data: { enabled: boolean, mode: string, activeView?: string }
 * - `Events.DUAL_VIEW_ACTIVE_CHANGED` - When active view changes
 *   Data: { activeView: 'left'|'right' }
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
 * Dual view modes
 */
export const DUAL_VIEW_MODES = Object.freeze({
    GENERAL: 'general',
    EVALUATION: 'evaluation'
});

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
        this.mode = DUAL_VIEW_MODES.GENERAL; // 'general' or 'evaluation'
        this.activeView = 'left'; // Which view is active for interactions
        
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
        this._onCanvasClick = this._onCanvasClick.bind(this);
        
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
        
        // Listen for annotation name changes to update the active view's label
        // This ensures the view label stays in sync when:
        // - Annotation is loaded from library
        // - Annotation is saved with a new name
        // - Annotation is renamed
        // - Annotated PLY is loaded
        eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, (data) => {
            if (this.enabled && this.mode === DUAL_VIEW_MODES.GENERAL && data?.name) {
                this._updateActiveViewLabel(data.name);
            }
        }, EVENTBUS_NAMESPACE);
    }
    
    /**
     * Update the active view's label with a new name.
     * Called when ANNOTATION_ACTIVE_CHANGED is emitted.
     * 
     * @param {string} name - The new annotation name
     * @private
     */
    _updateActiveViewLabel(name) {
        if (this.activeView === 'left') {
            this.leftViewConfig.label = name;
        } else {
            this.rightViewConfig.label = name;
        }
        this._updateActiveViewUI();
    }
    
    /**
     * Enable dual-view mode.
     * Creates secondary camera and sets up viewport splitting.
     * 
     * @param {string} [mode='general'] - Mode: 'general' or 'evaluation'
     */
    enable(mode = DUAL_VIEW_MODES.GENERAL) {
        if (this.enabled) return;
        
        this.mode = mode;
        console.log(`[DualViewManager] Enabling dual-view mode (${mode})`);
        this.enabled = true;
        this.activeView = 'left'; // Reset to left view as active
        
        // Store original camera aspect for restoration
        this._originalCameraAspect = this.scene.camera.aspect;
        
        // Create secondary camera (clone of primary)
        this._createSecondaryCamera();
        
        // Sync camera immediately
        this._onOrbitChange();
        
        // Initialize color buffers for general mode
        if (mode === DUAL_VIEW_MODES.GENERAL) {
            this._initializeGeneralModeColors();
        }
        
        // Create UI elements
        this._createUIElements();
        
        // Hide floating undo/redo controls (not needed in dual view)
        this._hideFloatingControls();
        
        // Store original animate function and override with dual-view render
        this._originalAnimate = this.scene.animate;
        this._setupDualViewRendering();
        
        // Add window resize handler and canvas click handler
        window.addEventListener('resize', this._onWindowResize);
        this.scene.canvas.addEventListener('click', this._onCanvasClick);
        
        // Emit event
        eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: true, mode: this.mode, activeView: this.activeView });
    }
    
    /**
     * Initialize color buffers for general mode.
     * Both views start with the same colors, then diverge as user annotates.
     * @private
     */
    _initializeGeneralModeColors() {
        const colors = this.meshView.meshColors;
        if (!colors) return;
        
        // Clone current colors for both views
        this.leftViewColors = new Float32Array(colors);
        this.rightViewColors = new Float32Array(colors);
        
        // Capture current annotation name for both views
        const annotation = this.meshView.getAnnotation();
        const annotationName = annotation?.name || 'Untitled';
        this.leftViewConfig.label = annotationName;
        this.rightViewConfig.label = annotationName;
        
        console.log('[DualViewManager] Initialized general mode color buffers');
    }
    
    /**
     * Shorten a label to fit in the UI.
     * @private
     * @param {string} label - The label to shorten
     * @param {number} [maxLength=18] - Maximum length before truncating
     * @returns {string} Shortened label
     */
    _shortenLabel(label, maxLength = 18) {
        if (!label || label.length <= maxLength) return label;
        return label.substring(0, maxLength - 1) + '…';
    }
    
    /**
     * Disable dual-view mode.
     * Restores single-view rendering.
     */
    disable() {
        if (!this.enabled) return;
        
        console.log('[DualViewManager] Disabling dual-view mode');
        
        // In general mode, restore the active view's colors to the mesh
        if (this.mode === DUAL_VIEW_MODES.GENERAL) {
            this._restoreActiveViewColors();
        }
        
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
        this.scene.canvas.removeEventListener('click', this._onCanvasClick);
        
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
        eventBus.emit(Events.DUAL_VIEW_CHANGED, { enabled: false, mode: this.mode });
    }
    
    /**
     * Restore the active view's colors to the mesh when disabling.
     * This ensures the single-view shows the state of the active view.
     * @private
     */
    _restoreActiveViewColors() {
        const meshColors = this.meshView.meshColors;
        if (!meshColors) return;
        
        const sourceBuffer = this.activeView === 'left' ? this.leftViewColors : this.rightViewColors;
        if (sourceBuffer) {
            meshColors.set(sourceBuffer);
            
            const mesh = this.meshView.mesh;
            if (mesh?.geometry?.attributes?.color) {
                mesh.geometry.attributes.color.needsUpdate = true;
            }
        }
    }
    
    /**
     * Toggle dual-view mode.
     * @param {string} [mode='general'] - Mode for enabling: 'general' or 'evaluation'
     * @returns {boolean} New enabled state
     */
    toggle(mode = DUAL_VIEW_MODES.GENERAL) {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable(mode);
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
     * Get the current dual view mode.
     * @returns {string} 'general' or 'evaluation'
     */
    getMode() {
        return this.mode;
    }
    
    /**
     * Get the currently active view.
     * @returns {string} 'left' or 'right'
     */
    getActiveView() {
        return this.activeView;
    }
    
    /**
     * Set the active view for interactions.
     * @param {'left'|'right'} view - Which view to make active
     */
    setActiveView(view) {
        if (view !== 'left' && view !== 'right') return;
        if (this.activeView === view) return;
        
        // In general mode, sync current colors before switching
        if (this.mode === DUAL_VIEW_MODES.GENERAL && this.leftViewColors) {
            // Save current mesh colors to the old active view's buffer
            this._syncActiveViewColors();
            
            // Switch active view
            this.activeView = view;
            
            // Apply new active view's colors to mesh (so new annotations build on this state)
            this._applyActiveViewColorsToMesh();
        } else {
            this.activeView = view;
        }
        
        this._updateActiveViewUI();
        
        // Emit event for other components
        eventBus.emit(Events.DUAL_VIEW_ACTIVE_CHANGED, { activeView: view });
    }
    
    /**
     * Set the label for a view.
     * @param {'left'|'right'} view - Which view to update
     * @param {string} label - The new label text
     */
    setViewLabel(view, label) {
        if (view === 'left') {
            this.leftViewConfig.label = label;
        } else {
            this.rightViewConfig.label = label;
        }
        this._updateActiveViewUI();
    }
    
    /**
     * Apply the active view's colors to the mesh.
     * Used when switching active views.
     * @private
     */
    _applyActiveViewColorsToMesh() {
        const meshColors = this.meshView.meshColors;
        if (!meshColors) return;
        
        const sourceBuffer = this.activeView === 'left' ? this.leftViewColors : this.rightViewColors;
        if (sourceBuffer) {
            meshColors.set(sourceBuffer);
            
            const mesh = this.meshView.mesh;
            if (mesh?.geometry?.attributes?.color) {
                mesh.geometry.attributes.color.needsUpdate = true;
            }
        }
    }
    
    /**
     * Update the UI to reflect the active view.
     * @private
     */
    _updateActiveViewUI() {
        const leftLabel = this.viewLabels.left;
        const rightLabel = this.viewLabels.right;
        
        if (this.mode !== DUAL_VIEW_MODES.GENERAL) return;
        
        const leftName = this._shortenLabel(this.leftViewConfig.label) || 'View A';
        const rightName = this._shortenLabel(this.rightViewConfig.label) || 'View B';
        
        if (leftLabel) {
            leftLabel.classList.toggle('active', this.activeView === 'left');
            leftLabel.innerHTML = this.activeView === 'left' 
                ? `<i class="fas fa-check-circle"></i> ${leftName}` 
                : `<i class="fas fa-circle"></i> ${leftName}`;
            leftLabel.title = this.leftViewConfig.label || 'View A';
        }
        if (rightLabel) {
            rightLabel.classList.toggle('active', this.activeView === 'right');
            rightLabel.innerHTML = this.activeView === 'right' 
                ? `<i class="fas fa-check-circle"></i> ${rightName}` 
                : `<i class="fas fa-circle"></i> ${rightName}`;
            rightLabel.title = this.rightViewConfig.label || 'View B';
        }
    }
    
    /**
     * Handle canvas click to determine which view was clicked.
     * @private
     * @param {MouseEvent} event
     */
    _onCanvasClick(event) {
        if (!this.enabled || this.mode !== DUAL_VIEW_MODES.GENERAL) return;
        
        const canvas = this.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const midpoint = rect.width * this.splitRatio;
        
        const clickedView = x < midpoint ? 'left' : 'right';
        this.setActiveView(clickedView);
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
        
        // Check if we have per-view colors (both general and evaluation modes)
        const usePerViewColors = this.leftViewColors && this.leftViewColors.length > 0;
        
        // In general mode, sync any changes from MeshView to the active view's buffer
        if (this.mode === DUAL_VIEW_MODES.GENERAL && usePerViewColors) {
            this._syncActiveViewColors();
        }
        
        // ---- Render Left View ----
        // Update camera aspect for left view
        this.scene.camera.aspect = leftWidth / height;
        this.scene.camera.updateProjectionMatrix();
        
        renderer.setViewport(0, 0, leftWidth, height);
        renderer.setScissor(0, 0, leftWidth, height);
        
        // Apply left view colors
        if (usePerViewColors) {
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
        if (usePerViewColors) {
            this._applyViewColors('right');
        }
        
        renderer.render(threeScene, rightCamera);
        
        // Disable scissor test and reset viewport
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
        
        // Restore the active view's colors to the mesh so subsequent drawing
        // operations modify the correct view's buffer
        if (usePerViewColors && this.mode === DUAL_VIEW_MODES.GENERAL) {
            this._applyViewColors(this.activeView);
        }
    }
    
    /**
     * Sync current mesh colors to the active view's buffer.
     * This captures any drawing changes made to MeshView.
     * @private
     */
    _syncActiveViewColors() {
        const meshColors = this.meshView.meshColors;
        if (!meshColors) return;
        
        const targetBuffer = this.activeView === 'left' ? this.leftViewColors : this.rightViewColors;
        if (targetBuffer) {
            targetBuffer.set(meshColors);
        }
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
        
        // Determine if labels should be clickable (general mode)
        const isGeneral = this.mode === DUAL_VIEW_MODES.GENERAL;
        const labelClass = isGeneral ? 'dual-view-label dual-view-label-btn' : 'dual-view-label';
        
        // Create left label
        this.viewLabels.left = document.createElement('div');
        this.viewLabels.left.className = `${labelClass} dual-view-label-left`;
        if (isGeneral) {
            const leftName = this._shortenLabel(this.leftViewConfig.label) || 'View A';
            this.viewLabels.left.classList.add('active'); // Left is active by default
            this.viewLabels.left.innerHTML = `<i class="fas fa-check-circle"></i> ${leftName}`;
            this.viewLabels.left.title = this.leftViewConfig.label || 'Click to make this the active view';
            this.viewLabels.left.addEventListener('click', () => this.setActiveView('left'));
        } else {
            this.viewLabels.left.textContent = this._getModeLabel(this.leftViewConfig.vizMode);
        }
        container.appendChild(this.viewLabels.left);
        
        // Create right label
        this.viewLabels.right = document.createElement('div');
        this.viewLabels.right.className = `${labelClass} dual-view-label-right`;
        if (isGeneral) {
            const rightName = this._shortenLabel(this.rightViewConfig.label) || 'View B';
            this.viewLabels.right.innerHTML = `<i class="fas fa-circle"></i> ${rightName}`;
            this.viewLabels.right.title = this.rightViewConfig.label || 'Click to make this the active view';
            this.viewLabels.right.addEventListener('click', () => this.setActiveView('right'));
        } else {
            this.viewLabels.right.textContent = this._getModeLabel(this.rightViewConfig.vizMode);
        }
        container.appendChild(this.viewLabels.right);
        
        // Add dual-view class to canvas container
        container.classList.add('dual-view-active');
        
        // Add mode-specific class
        if (isGeneral) {
            container.classList.add('dual-view-general');
        } else {
            container.classList.add('dual-view-evaluation');
        }
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
        container.classList.remove('dual-view-general');
        container.classList.remove('dual-view-evaluation');
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
