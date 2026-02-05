import * as THREE from 'three';
import { eventBus, Events } from '../utils/EventBus.js';
import { DUAL_VIEW_MODES } from './DualViewManager.js';

/**
 * RenderingPanel - Manages rendering controls for publication-ready visualization.
 * 
 * ## Features
 * - Annotation display modes (edges + segments, edges only, segments only, none)
 * - Wireframe mode
 * - Background color selection
 * - Material type selection (Lambert, Phong, Standard PBR)
 * - Metalness and roughness controls
 * - Environment map for reflections
 * - Flat shading toggle
 * - Edge and object color controls
 * 
 * ## EventBus Integration
 * 
 * ### Subscribes to:
 * - `Events.MESH_LOADED` - Applies rendering config to newly loaded meshes
 * - `Events.CONFIG_CHANGED` - Handles external config updates (e.g., import settings)
 * 
 * ### Emits:
 * - `Events.RENDERING_CHANGED` - When any rendering setting changes
 *   Data: { property: string, value: any, source: 'user'|'config' }
 * 
 * ## UserConfig Integration
 * 
 * Rendering settings are persisted to localStorage via UserConfig.
 * Settings are automatically loaded on construction and saved on change.
 * 
 * @example
 * // Create panel with scene, meshView, and userConfig
 * const renderingPanel = new RenderingPanel(scene, meshView, userConfig);
 * 
 * // Listen for rendering changes
 * eventBus.on(Events.RENDERING_CHANGED, (data) => {
 *     console.log(`Rendering ${data.property} changed to ${data.value}`);
 * });
 * 
 * // Clean up when done
 * renderingPanel.dispose();
 */

/**
 * Annotation display modes:
 * - 'full': Show both edge annotations and colored segments
 * - 'edges': Show only edge annotations (segments use object color)
 * - 'segments': Show only colored segments (no edge highlighting)
 * - 'none': Plain mesh with object color only
 */
export const ANNOTATION_MODES = Object.freeze({
    FULL: 'full',
    EDGES: 'edges',
    SEGMENTS: 'segments',
    NONE: 'none'
});

/**
 * EventBus namespace for this panel's subscriptions.
 * Used for cleanup in dispose().
 * @private
 */
const EVENTBUS_NAMESPACE = 'renderingPanel';

export class RenderingPanel {
    /**
     * Create a RenderingPanel.
     * 
     * @param {Object} scene - Scene object with renderer, lights, camera, etc.
     * @param {MeshView} meshView - The MeshView instance for mesh operations
     * @param {UserConfig} [userConfig=null] - Optional UserConfig for persistence
     */
    constructor(scene, meshView, userConfig = null) {
        this.scene = scene;
        this.meshView = meshView;
        this.userConfig = userConfig;
        
        // DualViewManager reference (set via setDualViewManager)
        this.dualViewManager = null;
        
        // Load from userConfig or use defaults
        const renderingConfig = userConfig?.getSection('rendering') || {};
        const lightingConfig = userConfig?.getSection('lighting') || {};
        
        // Rendering state
        this.annotationMode = renderingConfig.annotationMode || ANNOTATION_MODES.FULL;
        this.wireframeMode = renderingConfig.wireframeMode || false;
        this.flatShading = renderingConfig.flatShading || false;
        this.materialType = renderingConfig.materialType || 'lambert';
        this.metalness = renderingConfig.metalness ?? 0.0;
        this.roughness = renderingConfig.roughness ?? 0.5;
        this.envMapIntensity = renderingConfig.envMapIntensity ?? 1.0;
        this.backgroundColor = renderingConfig.backgroundColor || '#201944';
        this.edgeColor = renderingConfig.edgeColor || '#ff9933';
        this.objectColor = renderingConfig.objectColor || '#808080';
        
        // Lighting state
        this.keyLightIntensity = lightingConfig.keyLightIntensity ?? 2.0;
        this.fillLightIntensity = lightingConfig.fillLightIntensity ?? 1.0;
        this.ambientLightIntensity = lightingConfig.ambientLightIntensity ?? 0.3;
        this.keyLightColor = lightingConfig.keyLightColor || '#ffffff';
        this.lightFollowsCamera = lightingConfig.lightFollowsCamera || false;
        this.currentLightingPreset = lightingConfig.currentLightingPreset || 'default';
        
        // Environment map
        this.envMap = null;
        this.pmremGenerator = null;
        
        // Initialize UI controls
        this.initControls();
        this.initLightingControls();
        this.initDualViewControls();
        this.createEnvironmentMap();
        
        // Apply loaded settings to scene (background, lighting)
        this.applyInitialSettings();
        
        // Subscribe to EventBus events
        this._setupEventBusSubscriptions();
    }
    
    /**
     * Set the DualViewManager reference.
     * @param {DualViewManager} dualViewManager - The dual view manager
     */
    setDualViewManager(dualViewManager) {
        this.dualViewManager = dualViewManager;
    }
    
    // ========================================
    // EventBus Integration
    // ========================================
    
    /**
     * Set up EventBus subscriptions for mesh loading and config changes.
     * @private
     */
    _setupEventBusSubscriptions() {
        // When a mesh is loaded, apply the current rendering config
        eventBus.on(Events.MESH_LOADED, (data) => {
            this._onMeshLoaded(data);
        }, EVENTBUS_NAMESPACE);
        
        // When config changes externally (e.g., import settings), update panel
        eventBus.on(Events.CONFIG_CHANGED, (data) => {
            this._onConfigChanged(data);
        }, EVENTBUS_NAMESPACE);
    }
    
    /**
     * Handle mesh loaded event - apply rendering config to the new mesh.
     * 
     * This ensures that when a mesh is loaded, it immediately displays with
     * the user's preferred rendering settings (material, colors, wireframe, etc.).
     * 
     * @private
     * @param {Object} data - Event data from MESH_LOADED
     * @param {string} data.source - 'file' or 'cloud'
     * @param {string} data.filename - Name of the loaded file
     */
    _onMeshLoaded(data) {
        console.log(`[RenderingPanel] Applying rendering config to loaded mesh: ${data.filename}`);
        
        // Small delay to ensure mesh is fully initialized
        // This is needed because MeshView may still be setting up geometry
        requestAnimationFrame(() => {
            this.applyAllRenderingSettings();
        });
    }
    
    /**
     * Handle config changed event - update panel if rendering/lighting config changed.
     * 
     * This allows external config changes (like importing settings) to update
     * the rendering panel and apply the new settings to the current mesh.
     * 
     * @private
     * @param {Object} data - Event data from CONFIG_CHANGED
     * @param {string} data.path - Config path that changed
     * @param {*} data.newValue - New value
     * @param {*} data.oldValue - Previous value
     */
    _onConfigChanged(data) {
        // Only respond to rendering or lighting config changes
        if (data.path === 'rendering' || data.path === 'lighting' || data.path === '*') {
            console.log(`[RenderingPanel] Config changed: ${data.path}, reloading settings`);
            this.loadFromConfig();
        }
    }
    
    /**
     * Emit a rendering changed event.
     * 
     * @private
     * @param {string} property - The property that changed
     * @param {*} value - The new value
     * @param {string} [source='user'] - Source of change: 'user' (UI interaction) or 'config' (programmatic)
     */
    _emitRenderingChanged(property, value, source = 'user') {
        eventBus.emit(Events.RENDERING_CHANGED, {
            property,
            value,
            source
        });
    }
    
    // ========================================
    // Settings Application
    // ========================================
    
    /**
     * Apply all current rendering settings to the mesh and scene.
     * 
     * This method applies the complete rendering configuration:
     * - Background color
     * - Material type with wireframe and flat shading
     * - Edge and object colors
     * - Annotation display mode
     * - Material properties (metalness, roughness, envMap)
     * 
     * Called when:
     * - A mesh is loaded
     * - Settings are imported
     * - Reset to defaults is triggered
     */
    applyAllRenderingSettings() {
        if (this.meshView.isNull()) {
            console.log('[RenderingPanel] No mesh loaded, skipping rendering application');
            return;
        }
        
        console.log('[RenderingPanel] Applying all rendering settings');
        
        // Apply colors to meshView first (they're used by other methods)
        this.meshView.edgeColor.set(this.edgeColor);
        this.meshView.objectColor.set(this.objectColor);
        
        // Apply scene settings
        this.updateBackgroundColor();
        
        // Apply material (includes wireframe and flat shading)
        this.updateMaterial();
        
        // Apply material properties (metalness, roughness, envMap)
        this.updateMaterialProperties();
        
        // Apply annotation display mode (uses edge/object colors)
        this.updateAnnotationDisplay();
        
        // Emit event to notify other components
        this._emitRenderingChanged('all', null, 'config');
    }
    
    /**
     * Apply initially loaded settings to the scene (called once at construction).
     * Only applies settings that don't require a mesh (background, lighting).
     */
    applyInitialSettings() {
        // Apply background color
        this.updateBackgroundColor();
        
        // Apply lighting preset first, then individual values
        if (this.currentLightingPreset !== 'default') {
            this.scene.applyLightingPreset(this.currentLightingPreset);
        }
        
        // Apply individual lighting values
        this.scene.setKeyLightIntensity(this.keyLightIntensity);
        this.scene.setFillLightIntensity(this.fillLightIntensity);
        this.scene.setAmbientLightIntensity(this.ambientLightIntensity);
        this.scene.setKeyLightColor(this.keyLightColor);
        this.scene.setLightFollowsCamera(this.lightFollowsCamera);
    }
    
    // ========================================
    // Config Persistence
    // ========================================
    
    /**
     * Save rendering settings to userConfig.
     */
    saveRenderingConfig() {
        if (!this.userConfig) return;
        
        this.userConfig.setSection('rendering', {
            annotationMode: this.annotationMode,
            wireframeMode: this.wireframeMode,
            flatShading: this.flatShading,
            materialType: this.materialType,
            metalness: this.metalness,
            roughness: this.roughness,
            envMapIntensity: this.envMapIntensity,
            backgroundColor: this.backgroundColor,
            edgeColor: this.edgeColor,
            objectColor: this.objectColor,
        });
    }
    
    /**
     * Save lighting settings to userConfig.
     */
    saveLightingConfig() {
        if (!this.userConfig) return;
        
        this.userConfig.setSection('lighting', {
            keyLightIntensity: this.keyLightIntensity,
            fillLightIntensity: this.fillLightIntensity,
            ambientLightIntensity: this.ambientLightIntensity,
            keyLightColor: this.keyLightColor,
            lightFollowsCamera: this.lightFollowsCamera,
            currentLightingPreset: this.currentLightingPreset,
        });
    }
    
    // ========================================
    // UI Control Initialization
    // ========================================
    
    /**
     * Initialize all rendering control event listeners.
     * @private
     */
    initControls() {
        // Annotation Display Mode
        const annotationModeSelect = document.getElementById('annotationMode');
        if (annotationModeSelect) {
            annotationModeSelect.value = this.annotationMode;
            annotationModeSelect.addEventListener('change', (e) => {
                this.annotationMode = e.target.value;
                this.updateAnnotationDisplay();
                this.saveRenderingConfig();
                this._emitRenderingChanged('annotationMode', this.annotationMode);
            });
        }
        
        // Wireframe Mode
        const wireframeToggle = document.getElementById('wireframeMode');
        if (wireframeToggle) {
            wireframeToggle.checked = this.wireframeMode;
            wireframeToggle.addEventListener('change', (e) => {
                this.wireframeMode = e.target.checked;
                this.updateWireframe();
                this.saveRenderingConfig();
                this._emitRenderingChanged('wireframeMode', this.wireframeMode);
            });
        }
        
        // Flat Shading
        const flatShadingToggle = document.getElementById('flatShading');
        if (flatShadingToggle) {
            flatShadingToggle.checked = this.flatShading;
            flatShadingToggle.addEventListener('change', (e) => {
                this.flatShading = e.target.checked;
                this.updateMaterial();
                this.saveRenderingConfig();
                this._emitRenderingChanged('flatShading', this.flatShading);
            });
        }
        
        // Background Color
        const bgColorPicker = document.getElementById('backgroundColor');
        if (bgColorPicker) {
            bgColorPicker.value = this.backgroundColor;
            bgColorPicker.addEventListener('input', (e) => {
                this.backgroundColor = e.target.value;
                this.updateBackgroundColor();
                this.saveRenderingConfig();
                this._emitRenderingChanged('backgroundColor', this.backgroundColor);
            });
        }
        
        // Background Presets
        const bgPresets = document.querySelectorAll('.bg-preset');
        bgPresets.forEach(preset => {
            preset.addEventListener('click', (e) => {
                const color = e.currentTarget.dataset.color;
                this.backgroundColor = color;
                this.updateBackgroundColor();
                if (bgColorPicker) {
                    bgColorPicker.value = color;
                }
                this.saveRenderingConfig();
                this._emitRenderingChanged('backgroundColor', this.backgroundColor);
            });
        });
        
        // Material Type
        const materialSelect = document.getElementById('materialType');
        if (materialSelect) {
            materialSelect.value = this.materialType;
            materialSelect.addEventListener('change', (e) => {
                this.materialType = e.target.value;
                this.updateMaterial();
                this.updateMaterialControlsVisibility();
                this.saveRenderingConfig();
                this._emitRenderingChanged('materialType', this.materialType);
            });
        }
        
        // Metalness
        const metalnessSlider = document.getElementById('metalness');
        const metalnessValue = document.getElementById('metalnessValue');
        if (metalnessSlider) {
            metalnessSlider.value = this.metalness;
            if (metalnessValue) metalnessValue.textContent = this.metalness.toFixed(2);
            metalnessSlider.addEventListener('input', (e) => {
                this.metalness = parseFloat(e.target.value);
                if (metalnessValue) metalnessValue.textContent = this.metalness.toFixed(2);
                this.updateMaterialProperties();
                this.saveRenderingConfig();
                this._emitRenderingChanged('metalness', this.metalness);
            });
        }
        
        // Roughness
        const roughnessSlider = document.getElementById('roughness');
        const roughnessValue = document.getElementById('roughnessValue');
        if (roughnessSlider) {
            roughnessSlider.value = this.roughness;
            if (roughnessValue) roughnessValue.textContent = this.roughness.toFixed(2);
            roughnessSlider.addEventListener('input', (e) => {
                this.roughness = parseFloat(e.target.value);
                if (roughnessValue) roughnessValue.textContent = this.roughness.toFixed(2);
                this.updateMaterialProperties();
                this.saveRenderingConfig();
                this._emitRenderingChanged('roughness', this.roughness);
            });
        }
        
        // Environment Map Intensity
        const envMapSlider = document.getElementById('envMapIntensity');
        const envMapValue = document.getElementById('envMapIntensityValue');
        if (envMapSlider) {
            envMapSlider.value = this.envMapIntensity;
            if (envMapValue) envMapValue.textContent = this.envMapIntensity.toFixed(2);
            envMapSlider.addEventListener('input', (e) => {
                this.envMapIntensity = parseFloat(e.target.value);
                if (envMapValue) envMapValue.textContent = this.envMapIntensity.toFixed(2);
                this.updateMaterialProperties();
                this.saveRenderingConfig();
                this._emitRenderingChanged('envMapIntensity', this.envMapIntensity);
            });
        }
        
        // Edge Color
        const edgeColorPicker = document.getElementById('edgeColorPicker');
        if (edgeColorPicker) {
            edgeColorPicker.value = this.edgeColor;
            edgeColorPicker.addEventListener('input', (e) => {
                this.edgeColor = e.target.value;
                this.updateColors();
                this.saveRenderingConfig();
                this._emitRenderingChanged('edgeColor', this.edgeColor);
            });
        }
        
        // Object Color
        const objectColorPicker = document.getElementById('objectColorPicker');
        if (objectColorPicker) {
            objectColorPicker.value = this.objectColor;
            objectColorPicker.addEventListener('input', (e) => {
                this.objectColor = e.target.value;
                this.updateColors();
                this.saveRenderingConfig();
                this._emitRenderingChanged('objectColor', this.objectColor);
            });
        }
        
        // Initial visibility update
        this.updateMaterialControlsVisibility();
    }
    
    /**
     * Initialize lighting controls.
     * @private
     */
    initLightingControls() {
        // Key Light Intensity
        const keyLightSlider = document.getElementById('keyLightIntensity');
        const keyLightValue = document.getElementById('keyLightIntensityValue');
        if (keyLightSlider) {
            keyLightSlider.value = this.keyLightIntensity;
            if (keyLightValue) keyLightValue.textContent = this.keyLightIntensity.toFixed(1);
            keyLightSlider.addEventListener('input', (e) => {
                this.keyLightIntensity = parseFloat(e.target.value);
                if (keyLightValue) keyLightValue.textContent = this.keyLightIntensity.toFixed(1);
                this.scene.setKeyLightIntensity(this.keyLightIntensity);
                this.saveLightingConfig();
            });
        }
        
        // Fill Light Intensity
        const fillLightSlider = document.getElementById('fillLightIntensity');
        const fillLightValue = document.getElementById('fillLightIntensityValue');
        if (fillLightSlider) {
            fillLightSlider.value = this.fillLightIntensity;
            if (fillLightValue) fillLightValue.textContent = this.fillLightIntensity.toFixed(1);
            fillLightSlider.addEventListener('input', (e) => {
                this.fillLightIntensity = parseFloat(e.target.value);
                if (fillLightValue) fillLightValue.textContent = this.fillLightIntensity.toFixed(1);
                this.scene.setFillLightIntensity(this.fillLightIntensity);
                this.saveLightingConfig();
            });
        }
        
        // Ambient Light Intensity
        const ambientLightSlider = document.getElementById('ambientLightIntensity');
        const ambientLightValue = document.getElementById('ambientLightIntensityValue');
        if (ambientLightSlider) {
            ambientLightSlider.value = this.ambientLightIntensity;
            if (ambientLightValue) ambientLightValue.textContent = this.ambientLightIntensity.toFixed(1);
            ambientLightSlider.addEventListener('input', (e) => {
                this.ambientLightIntensity = parseFloat(e.target.value);
                if (ambientLightValue) ambientLightValue.textContent = this.ambientLightIntensity.toFixed(1);
                this.scene.setAmbientLightIntensity(this.ambientLightIntensity);
                this.saveLightingConfig();
            });
        }
        
        // Key Light Color
        const keyLightColorPicker = document.getElementById('keyLightColor');
        if (keyLightColorPicker) {
            keyLightColorPicker.value = this.keyLightColor;
            keyLightColorPicker.addEventListener('input', (e) => {
                this.keyLightColor = e.target.value;
                this.scene.setKeyLightColor(this.keyLightColor);
                this.saveLightingConfig();
            });
        }
        
        // Light Follows Camera Toggle
        const lightFollowsCameraToggle = document.getElementById('lightFollowsCamera');
        if (lightFollowsCameraToggle) {
            lightFollowsCameraToggle.checked = this.lightFollowsCamera;
            lightFollowsCameraToggle.addEventListener('change', (e) => {
                this.lightFollowsCamera = e.target.checked;
                this.scene.setLightFollowsCamera(this.lightFollowsCamera);
                this.saveLightingConfig();
            });
        }
        
        // Set Light from Camera Button
        const setLightFromCameraBtn = document.getElementById('setLightFromCamera');
        if (setLightFromCameraBtn) {
            setLightFromCameraBtn.addEventListener('click', () => {
                this.scene.updateLightFromCamera();
            });
        }
        
        // Lighting Presets
        const lightingPresetSelect = document.getElementById('lightingPreset');
        if (lightingPresetSelect) {
            lightingPresetSelect.value = this.currentLightingPreset;
            lightingPresetSelect.addEventListener('change', (e) => {
                this.currentLightingPreset = e.target.value;
                this.scene.applyLightingPreset(this.currentLightingPreset);
                this.syncLightingUIFromScene();
                this.saveLightingConfig();
            });
        }
    }
    
    /**
     * Initialize dual view controls.
     * @private
     */
    initDualViewControls() {
        // Dual View Toggle
        this.dualViewToggle = document.getElementById('renderDualViewToggle');
        this.dualViewEnabled = document.getElementById('renderDualViewEnabled');
        
        // Handle toggle row click
        this.dualViewToggle?.addEventListener('click', (e) => {
            const toggleSwitch = this.dualViewToggle.querySelector('.toggle-switch');
            const isOnToggleSwitch = toggleSwitch && (toggleSwitch.contains(e.target) || e.target === toggleSwitch);
            
            // Only toggle if clicking outside the toggle-switch area
            if (!isOnToggleSwitch && this.dualViewEnabled) {
                this.dualViewEnabled.checked = !this.dualViewEnabled.checked;
                this._toggleDualView();
            }
        });
        
        // Handle checkbox change directly
        this.dualViewEnabled?.addEventListener('change', () => {
            this._toggleDualView();
        });
        
        // Listen to dual view changes from other sources (e.g., evaluation panel)
        eventBus.on(Events.DUAL_VIEW_CHANGED, (data) => {
            this._onDualViewChanged(data);
        }, EVENTBUS_NAMESPACE);
    }
    
    /**
     * Toggle dual view mode on/off.
     * @private
     */
    _toggleDualView() {
        if (!this.dualViewManager) {
            console.warn('[RenderingPanel] DualViewManager not set');
            return;
        }
        
        const enabled = this.dualViewEnabled?.checked || false;
        
        if (enabled) {
            // Check if mesh is loaded
            if (this.meshView.isNull()) {
                alert('Please load a mesh first before enabling dual view.');
                if (this.dualViewEnabled) {
                    this.dualViewEnabled.checked = false;
                }
                return;
            }
            
            this.dualViewManager.enable(DUAL_VIEW_MODES.GENERAL);
            this.dualViewToggle?.classList.add('active');
        } else {
            this.dualViewManager.disable();
            this.dualViewToggle?.classList.remove('active');
        }
    }
    
    /**
     * Handle dual view changed event from EventBus.
     * Updates UI state to match external changes.
     * @private
     * @param {Object} data - Event data
     */
    _onDualViewChanged(data) {
        // Only sync checkbox if it's a general mode change or disable
        const isGeneralMode = data.mode === DUAL_VIEW_MODES.GENERAL;
        
        if (this.dualViewEnabled) {
            // Only sync checkbox if it's a general mode change or disable
            if (!data.enabled || isGeneralMode) {
                this.dualViewEnabled.checked = data.enabled && isGeneralMode;
            }
        }
        
        if (data.enabled && isGeneralMode) {
            this.dualViewToggle?.classList.add('active');
        } else {
            this.dualViewToggle?.classList.remove('active');
        }
    }
    
    /**
     * Sync lighting UI controls with current scene state after applying a preset.
     */
    syncLightingUIFromScene() {
        // Update sliders and values from scene
        const keyLightSlider = document.getElementById('keyLightIntensity');
        const keyLightValue = document.getElementById('keyLightIntensityValue');
        if (keyLightSlider && this.scene.keyLight) {
            this.keyLightIntensity = this.scene.keyLight.intensity;
            keyLightSlider.value = this.keyLightIntensity;
            if (keyLightValue) keyLightValue.textContent = this.keyLightIntensity.toFixed(1);
        }
        
        const fillLightSlider = document.getElementById('fillLightIntensity');
        const fillLightValue = document.getElementById('fillLightIntensityValue');
        if (fillLightSlider && this.scene.fillLight) {
            this.fillLightIntensity = this.scene.fillLight.intensity;
            fillLightSlider.value = this.fillLightIntensity;
            if (fillLightValue) fillLightValue.textContent = this.fillLightIntensity.toFixed(1);
        }
        
        const ambientLightSlider = document.getElementById('ambientLightIntensity');
        const ambientLightValue = document.getElementById('ambientLightIntensityValue');
        if (ambientLightSlider && this.scene.ambientLight) {
            this.ambientLightIntensity = this.scene.ambientLight.intensity;
            ambientLightSlider.value = this.ambientLightIntensity;
            if (ambientLightValue) ambientLightValue.textContent = this.ambientLightIntensity.toFixed(1);
        }
        
        // Update color picker
        const keyLightColorPicker = document.getElementById('keyLightColor');
        if (keyLightColorPicker && this.scene.keyLight) {
            this.keyLightColor = '#' + this.scene.keyLight.color.getHexString();
            keyLightColorPicker.value = this.keyLightColor;
        }
    }
    
    // ========================================
    // Environment Map
    // ========================================
    
    /**
     * Create a simple environment map for reflections.
     * Uses a gradient cubemap for subtle reflections.
     * @private
     */
    createEnvironmentMap() {
        // Create PMREM generator for environment map processing
        this.pmremGenerator = new THREE.PMREMGenerator(this.scene.renderer);
        this.pmremGenerator.compileEquirectangularShader();
        
        // Create a simple gradient environment
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // Create a gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, '#87CEEB'); // Sky blue
        gradient.addColorStop(0.5, '#FFFFFF'); // White
        gradient.addColorStop(1, '#E0E0E0'); // Light gray
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        
        // Generate environment map
        this.envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
        texture.dispose();
    }
    
    // ========================================
    // Rendering Update Methods
    // ========================================
    
    /**
     * Update annotation display based on current mode.
     * Handles edges, segments, and their combinations.
     * 
     * Annotation modes:
     * - 'full': Show both edge annotations and colored segments
     * - 'edges': Show only edge annotations (segments use object color)
     * - 'segments': Show only colored segments (no edge highlighting)
     * - 'none': Plain mesh with object color only
     */
    updateAnnotationDisplay() {
        if (this.meshView.isNull()) return;
        
        const mesh = this.meshView.mesh;
        if (!mesh?.geometry?.attributes?.color) return;
        
        const colors = mesh.geometry.attributes.color.array;
        const edgeLabels = this.meshView.edgeLabels;
        const faceLabels = this.meshView.faceLabels;
        const faceColors = this.meshView.faceColors;
        
        const edgeColor = new THREE.Color(this.edgeColor);
        const objectColor = new THREE.Color(this.objectColor);
        
        const showEdges = this.annotationMode === ANNOTATION_MODES.FULL || 
                          this.annotationMode === ANNOTATION_MODES.EDGES;
        const showSegments = this.annotationMode === ANNOTATION_MODES.FULL || 
                             this.annotationMode === ANNOTATION_MODES.SEGMENTS;
        
        // Update meshView's internal showSegments state to stay in sync
        this.meshView.showSegments = showSegments;
        
        // First pass: set base colors for all vertices
        for (let i = 0; i < edgeLabels.length; i++) {
            // Default to object color
            let color = objectColor;
            
            // Apply segment color if segments are shown
            if (showSegments && faceLabels[i] > 0) {
                const segmentColor = faceColors.get(faceLabels[i]);
                if (segmentColor) {
                    color = segmentColor;
                }
            }
            
            // Apply edge color on top if edges are shown and vertex is an edge
            if (showEdges && edgeLabels[i] === 1) {
                color = edgeColor;
            }
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        mesh.geometry.attributes.color.needsUpdate = true;
    }
    
    /**
     * Toggle wireframe mode on the mesh material.
     */
    updateWireframe() {
        if (this.meshView.isNull()) return;
        
        const mesh = this.meshView.mesh;
        if (!mesh?.material) return;
        
        mesh.material.wireframe = this.wireframeMode;
        mesh.material.needsUpdate = true;
    }
    
    /**
     * Update the background color of the scene.
     */
    updateBackgroundColor() {
        this.scene.renderer.setClearColor(this.backgroundColor);
    }
    
    /**
     * Update the mesh material type.
     * Creates a new material with the selected type and current settings.
     */
    updateMaterial() {
        if (this.meshView.isNull()) return;
        
        const mesh = this.meshView.mesh;
        if (!mesh) return;
        
        const oldMaterial = mesh.material;
        
        // Create new material based on type
        let newMaterial;
        const commonProps = {
            vertexColors: true,
            wireframe: this.wireframeMode,
            flatShading: this.flatShading,
        };
        
        switch (this.materialType) {
            case 'phong':
                newMaterial = new THREE.MeshPhongMaterial({
                    ...commonProps,
                    shininess: 30,
                    specular: new THREE.Color(0x444444),
                });
                break;
                
            case 'standard':
                newMaterial = new THREE.MeshStandardMaterial({
                    ...commonProps,
                    metalness: this.metalness,
                    roughness: this.roughness,
                    envMap: this.envMap,
                    envMapIntensity: this.envMapIntensity,
                });
                break;
                
            case 'lambert':
            default:
                newMaterial = new THREE.MeshLambertMaterial(commonProps);
                break;
        }
        
        mesh.material = newMaterial;
        if (oldMaterial) {
            oldMaterial.dispose();
        }
        
        // Recompute normals if flat shading changed
        if (this.flatShading && mesh.geometry) {
            mesh.geometry.computeVertexNormals();
        }
    }
    
    /**
     * Update material properties (metalness, roughness, env map intensity).
     * Only applies to Standard material.
     */
    updateMaterialProperties() {
        if (this.meshView.isNull()) return;
        if (this.materialType !== 'standard') return;
        
        const material = this.meshView.mesh?.material;
        if (!material) return;
        
        material.metalness = this.metalness;
        material.roughness = this.roughness;
        material.envMapIntensity = this.envMapIntensity;
        material.needsUpdate = true;
    }
    
    /**
     * Update edge and object colors on the mesh.
     * Updates meshView's color references and re-applies annotation display.
     */
    updateColors() {
        if (this.meshView.isNull()) return;
        
        // Update colors in place so all references (including faceColors) stay in sync
        this.meshView.edgeColor.set(this.edgeColor);
        this.meshView.objectColor.set(this.objectColor);
        
        // Re-apply annotation display with new colors
        this.updateAnnotationDisplay();
    }
    
    /**
     * Show/hide PBR material controls based on material type.
     */
    updateMaterialControlsVisibility() {
        const pbrControls = document.getElementById('pbrControls');
        if (pbrControls) {
            pbrControls.style.display = this.materialType === 'standard' ? 'block' : 'none';
        }
    }
    
    // ========================================
    // Reset and Load Methods
    // ========================================
    
    /**
     * Reset all rendering settings to defaults.
     * Updates UI, applies settings, and saves to config.
     */
    resetToDefaults() {
        // Rendering defaults
        this.annotationMode = ANNOTATION_MODES.FULL;
        this.wireframeMode = false;
        this.flatShading = false;
        this.materialType = 'lambert';
        this.metalness = 0.0;
        this.roughness = 0.5;
        this.envMapIntensity = 1.0;
        this.backgroundColor = '#201944';
        this.edgeColor = '#ff9933';
        this.objectColor = '#808080';
        
        // Lighting defaults
        this.keyLightIntensity = 2.0;
        this.fillLightIntensity = 1.0;
        this.ambientLightIntensity = 0.3;
        this.keyLightColor = '#ffffff';
        this.lightFollowsCamera = false;
        this.currentLightingPreset = 'default';
        
        // Update all UI elements
        this.syncUIFromState();
        
        // Apply all rendering settings
        this.updateBackgroundColor();
        this.applyAllRenderingSettings();
        this.updateMaterialControlsVisibility();
        
        // Apply lighting settings
        this.scene.applyLightingPreset('default');
        this.scene.setLightFollowsCamera(false);
        
        // Save to userConfig
        this.saveRenderingConfig();
        this.saveLightingConfig();
        
        // Emit event
        this._emitRenderingChanged('all', null, 'user');
    }
    
    /**
     * Load settings from userConfig and apply them.
     * Called when settings are imported externally.
     */
    loadFromConfig() {
        if (!this.userConfig) return;
        
        const renderingConfig = this.userConfig.getSection('rendering');
        const lightingConfig = this.userConfig.getSection('lighting');
        
        // Update internal state
        this.annotationMode = renderingConfig.annotationMode || ANNOTATION_MODES.FULL;
        this.wireframeMode = renderingConfig.wireframeMode || false;
        this.flatShading = renderingConfig.flatShading || false;
        this.materialType = renderingConfig.materialType || 'lambert';
        this.metalness = renderingConfig.metalness ?? 0.0;
        this.roughness = renderingConfig.roughness ?? 0.5;
        this.envMapIntensity = renderingConfig.envMapIntensity ?? 1.0;
        this.backgroundColor = renderingConfig.backgroundColor || '#201944';
        this.edgeColor = renderingConfig.edgeColor || '#ff9933';
        this.objectColor = renderingConfig.objectColor || '#808080';
        
        this.keyLightIntensity = lightingConfig.keyLightIntensity ?? 2.0;
        this.fillLightIntensity = lightingConfig.fillLightIntensity ?? 1.0;
        this.ambientLightIntensity = lightingConfig.ambientLightIntensity ?? 0.3;
        this.keyLightColor = lightingConfig.keyLightColor || '#ffffff';
        this.lightFollowsCamera = lightingConfig.lightFollowsCamera || false;
        this.currentLightingPreset = lightingConfig.currentLightingPreset || 'default';
        
        // Update all UI elements
        this.syncUIFromState();
        
        // Apply all settings
        this.applyInitialSettings();
        this.applyAllRenderingSettings();
        this.updateMaterialControlsVisibility();
    }
    
    /**
     * Sync all UI elements with current internal state.
     */
    syncUIFromState() {
        // Checkboxes
        const checkboxes = {
            wireframeMode: this.wireframeMode,
            flatShading: this.flatShading,
            lightFollowsCamera: this.lightFollowsCamera,
        };
        Object.entries(checkboxes).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.checked = value;
        });
        
        // Dropdowns
        const dropdowns = {
            annotationMode: this.annotationMode,
            materialType: this.materialType,
            lightingPreset: this.currentLightingPreset,
        };
        Object.entries(dropdowns).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        });
        
        // Sliders
        const sliders = {
            metalness: { value: this.metalness, decimals: 2 },
            roughness: { value: this.roughness, decimals: 2 },
            envMapIntensity: { value: this.envMapIntensity, decimals: 2 },
            keyLightIntensity: { value: this.keyLightIntensity, decimals: 1 },
            fillLightIntensity: { value: this.fillLightIntensity, decimals: 1 },
            ambientLightIntensity: { value: this.ambientLightIntensity, decimals: 1 },
        };
        Object.entries(sliders).forEach(([id, { value, decimals }]) => {
            const slider = document.getElementById(id);
            const valueEl = document.getElementById(id + 'Value');
            if (slider) slider.value = value;
            if (valueEl) valueEl.textContent = value.toFixed(decimals);
        });
        
        // Color pickers
        const colorPickers = {
            backgroundColor: this.backgroundColor,
            edgeColorPicker: this.edgeColor,
            objectColorPicker: this.objectColor,
            keyLightColor: this.keyLightColor,
        };
        Object.entries(colorPickers).forEach(([id, value]) => {
            const picker = document.getElementById(id);
            if (picker) picker.value = value;
        });
    }
    
    // ========================================
    // Lifecycle Methods
    // ========================================
    
    /**
     * Called when panel is shown.
     * Can be used for any refresh operations needed on panel show.
     */
    onShow() {
        // Sync UI with current state in case anything changed externally
        this.syncUIFromState();
    }
    
    /**
     * Clean up resources and unsubscribe from EventBus.
     * Should be called when the panel is destroyed.
     */
    dispose() {
        // Clean up EventBus subscriptions using namespace
        eventBus.offNamespace(EVENTBUS_NAMESPACE);
        
        // Clean up Three.js resources
        if (this.envMap) {
            this.envMap.dispose();
            this.envMap = null;
        }
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }
    }
    
    // ========================================
    // Public Getters
    // ========================================
    
    /**
     * Get the current annotation mode.
     * @returns {string} Current annotation mode ('full', 'edges', 'segments', 'none')
     */
    getAnnotationMode() {
        return this.annotationMode;
    }
    
    /**
     * Get the current edge color.
     * @returns {string} Edge color as hex string
     */
    getEdgeColor() {
        return this.edgeColor;
    }
    
    /**
     * Get the current object color.
     * @returns {string} Object color as hex string
     */
    getObjectColor() {
        return this.objectColor;
    }
    
    /**
     * Get all current rendering settings as an object.
     * @returns {Object} Current rendering settings
     */
    getRenderingSettings() {
        return {
            annotationMode: this.annotationMode,
            wireframeMode: this.wireframeMode,
            flatShading: this.flatShading,
            materialType: this.materialType,
            metalness: this.metalness,
            roughness: this.roughness,
            envMapIntensity: this.envMapIntensity,
            backgroundColor: this.backgroundColor,
            edgeColor: this.edgeColor,
            objectColor: this.objectColor,
        };
    }
    
    /**
     * Get all current lighting settings as an object.
     * @returns {Object} Current lighting settings
     */
    getLightingSettings() {
        return {
            keyLightIntensity: this.keyLightIntensity,
            fillLightIntensity: this.fillLightIntensity,
            ambientLightIntensity: this.ambientLightIntensity,
            keyLightColor: this.keyLightColor,
            lightFollowsCamera: this.lightFollowsCamera,
            currentLightingPreset: this.currentLightingPreset,
        };
    }
}
