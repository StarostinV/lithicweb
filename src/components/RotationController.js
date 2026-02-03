/**
 * RotationController - Manages 3D rotation controls for camera and object manipulation.
 * 
 * This module provides two complementary rotation systems:
 * 1. OrbitControls - Camera rotation around the scene (always available)
 * 2. TransformControls - Direct object manipulation with visual gizmo (toggleable)
 * 
 * Key features:
 * - Gimbal lock prevention through polar angle limits
 * - Smooth damping for better UX
 * - Toggle between camera orbit and object manipulation modes
 * - Configurable sensitivity and constraints
 * 
 * @module RotationController
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * Configuration defaults for rotation controls.
 * These values prevent gimbal lock and provide smooth interaction.
 */
const DEFAULT_CONFIG = {
    // OrbitControls settings
    orbit: {
        enableDamping: true,          // Smooth movement with inertia
        dampingFactor: 0.08,          // Damping strength (lower = more inertia)
        rotateSpeed: 1.0,             // Mouse rotation sensitivity
        zoomSpeed: 1.2,               // Scroll zoom sensitivity
        panSpeed: 0.8,                // Right-click pan sensitivity
        
        // Polar angle limits to prevent gimbal lock
        // Larger margins prevent the "stuck at poles" issue more effectively
        minPolarAngle: 0.1,           // ~5.7° from top pole
        maxPolarAngle: Math.PI - 0.1, // ~5.7° from bottom pole
        
        // Optional azimuth (horizontal) limits - disabled by default
        minAzimuthAngle: -Infinity,
        maxAzimuthAngle: Infinity,
        
        // Distance limits
        minDistance: 1,
        maxDistance: 500,
        
        // Enable all rotation axes
        enableRotate: true,
        enableZoom: true,
        enablePan: true,
    },
    
    // TransformControls settings (object manipulation gizmo)
    transform: {
        mode: 'rotate',               // 'translate', 'rotate', or 'scale'
        size: 1.2,                    // Gizmo size (slightly larger for better visibility)
        space: 'world',               // 'world' or 'local' coordinate space
        showX: true,
        showY: true,
        showZ: true,
    }
};

/**
 * RotationController manages camera orbit and object transformation controls.
 * 
 * Usage:
 * ```javascript
 * const controller = new RotationController(camera, canvas, scene);
 * controller.attachObject(mesh);     // Enable object manipulation
 * controller.setGizmoVisible(true);  // Show rotation gizmo
 * ```
 */
export default class RotationController {
    /**
     * Creates a new RotationController instance.
     * 
     * @param {THREE.Camera} camera - The Three.js camera
     * @param {HTMLCanvasElement} canvas - The render canvas element
     * @param {THREE.Scene} scene - The Three.js scene
     * @param {Object} config - Optional configuration overrides
     */
    constructor(camera, canvas, scene, config = {}) {
        this.camera = camera;
        this.canvas = canvas;
        this.scene = scene;
        this.attachedObject = null;
        this.gizmoVisible = false;
        
        // Merge user config with defaults
        this.config = this._mergeConfig(DEFAULT_CONFIG, config);
        
        // Initialize controls
        this.orbitControls = this._createOrbitControls();
        this.transformControls = this._createTransformControls();
        
        // Bind methods for event handlers
        this._onDraggingChanged = this._onDraggingChanged.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        
        // Set up event listeners
        this._setupEventListeners();
    }
    
    /**
     * Deep merges configuration objects.
     * @private
     */
    _mergeConfig(defaults, overrides) {
        const result = { ...defaults };
        for (const key in overrides) {
            if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
                result[key] = { ...defaults[key], ...overrides[key] };
            } else {
                result[key] = overrides[key];
            }
        }
        return result;
    }
    
    /**
     * Creates and configures OrbitControls with gimbal lock prevention.
     * @private
     * @returns {OrbitControls} Configured orbit controls
     */
    _createOrbitControls() {
        const controls = new OrbitControls(this.camera, this.canvas);
        const cfg = this.config.orbit;
        
        // Apply all configuration
        controls.enableDamping = cfg.enableDamping;
        controls.dampingFactor = cfg.dampingFactor;
        controls.rotateSpeed = cfg.rotateSpeed;
        controls.zoomSpeed = cfg.zoomSpeed;
        controls.panSpeed = cfg.panSpeed;
        
        // Critical: Polar angle limits prevent gimbal lock at poles
        controls.minPolarAngle = cfg.minPolarAngle;
        controls.maxPolarAngle = cfg.maxPolarAngle;
        
        // Azimuth limits (horizontal rotation)
        controls.minAzimuthAngle = cfg.minAzimuthAngle;
        controls.maxAzimuthAngle = cfg.maxAzimuthAngle;
        
        // Distance limits
        controls.minDistance = cfg.minDistance;
        controls.maxDistance = cfg.maxDistance;
        
        // Enable/disable features
        controls.enableRotate = cfg.enableRotate;
        controls.enableZoom = cfg.enableZoom;
        controls.enablePan = cfg.enablePan;
        
        // Set initial target
        controls.target.set(0, 0, 0);
        controls.update();
        
        return controls;
    }
    
    /**
     * Creates TransformControls for object manipulation.
     * @private
     * @returns {TransformControls} Configured transform controls
     */
    _createTransformControls() {
        const controls = new TransformControls(this.camera, this.canvas);
        const cfg = this.config.transform;
        
        // Apply configuration
        controls.setMode(cfg.mode);
        controls.setSize(cfg.size);
        controls.setSpace(cfg.space);
        controls.showX = cfg.showX;
        controls.showY = cfg.showY;
        controls.showZ = cfg.showZ;
        
        // Add to scene but keep invisible initially
        this.scene.add(controls);
        controls.visible = false;
        
        return controls;
    }
    
    /**
     * Sets up event listeners for control coordination.
     * @private
     */
    _setupEventListeners() {
        // Disable orbit controls while using transform controls
        this.transformControls.addEventListener('dragging-changed', this._onDraggingChanged);
        
        // Keyboard shortcuts for transform modes
        window.addEventListener('keydown', this._onKeyDown);
    }
    
    /**
     * Handles transform control drag state changes.
     * Disables orbit controls during object manipulation.
     * @private
     */
    _onDraggingChanged(event) {
        this.orbitControls.enabled = !event.value;
    }
    
    /**
     * Handles keyboard shortcuts for transform controls.
     * - X/Y/Z: Constrain to axis
     * - Space: Toggle coordinate space (world/local)
     * - Escape: Reset axis constraints
     * 
     * Note: Transform mode (rotate/translate) is controlled by Ctrl key in Mode class.
     * @private
     */
    _onKeyDown(event) {
        // Only handle if gizmo is visible and no input is focused
        if (!this.gizmoVisible || event.target.tagName === 'INPUT') return;
        
        switch (event.key.toLowerCase()) {
            case 'x':
                this.transformControls.showX = true;
                this.transformControls.showY = false;
                this.transformControls.showZ = false;
                break;
            case 'y':
                this.transformControls.showX = false;
                this.transformControls.showY = true;
                this.transformControls.showZ = false;
                break;
            case 'z':
                this.transformControls.showX = false;
                this.transformControls.showY = false;
                this.transformControls.showZ = true;
                break;
            case ' ':
                // Toggle between world and local space
                if (this.gizmoVisible) {
                    event.preventDefault();
                    const newSpace = this.transformControls.space === 'world' ? 'local' : 'world';
                    this.transformControls.setSpace(newSpace);
                }
                break;
            case 'escape':
                // Reset axis constraints
                this.transformControls.showX = true;
                this.transformControls.showY = true;
                this.transformControls.showZ = true;
                break;
        }
    }
    
    // =========================================================================
    // Public API - OrbitControls (Camera)
    // =========================================================================
    
    /**
     * Enables or disables orbit controls.
     * @param {boolean} enabled - Whether orbit controls should be enabled
     */
    setOrbitEnabled(enabled) {
        this.orbitControls.enabled = enabled;
    }
    
    /**
     * Returns whether orbit controls are enabled.
     * @returns {boolean}
     */
    isOrbitEnabled() {
        return this.orbitControls.enabled;
    }
    
    /**
     * Sets the orbit target (center point for camera rotation).
     * @param {THREE.Vector3|{x: number, y: number, z: number}} target - Target position
     */
    setOrbitTarget(target) {
        if (target instanceof THREE.Vector3) {
            this.orbitControls.target.copy(target);
        } else {
            this.orbitControls.target.set(target.x, target.y, target.z);
        }
        this.orbitControls.update();
    }
    
    /**
     * Gets the current orbit target.
     * @returns {THREE.Vector3}
     */
    getOrbitTarget() {
        return this.orbitControls.target.clone();
    }
    
    /**
     * Sets orbit rotation speed.
     * @param {number} speed - Rotation speed multiplier
     */
    setRotateSpeed(speed) {
        this.orbitControls.rotateSpeed = speed;
    }
    
    /**
     * Configures polar angle limits to control vertical rotation range.
     * Values close to 0 and PI can cause gimbal lock issues.
     * 
     * @param {number} min - Minimum polar angle in radians (default: 0.01)
     * @param {number} max - Maximum polar angle in radians (default: PI - 0.01)
     */
    setPolarLimits(min, max) {
        this.orbitControls.minPolarAngle = Math.max(0.001, min);
        this.orbitControls.maxPolarAngle = Math.min(Math.PI - 0.001, max);
    }
    
    /**
     * Resets camera to default position looking at target.
     * @param {number} distance - Distance from target (default: 50)
     */
    resetCamera(distance = 50) {
        // Position camera at 45 degrees
        const angle = Math.PI / 4;
        this.camera.position.set(
            distance * Math.sin(angle),
            distance * Math.sin(angle),
            distance * Math.cos(angle)
        );
        this.orbitControls.update();
    }
    
    // =========================================================================
    // Public API - TransformControls (Object Gizmo)
    // =========================================================================
    
    /**
     * Attaches an object to the transform controls.
     * The gizmo will appear on this object when visible.
     * 
     * @param {THREE.Object3D} object - The object to attach
     */
    attachObject(object) {
        this.attachedObject = object;
        this.transformControls.attach(object);
    }
    
    /**
     * Detaches the currently attached object.
     */
    detachObject() {
        this.attachedObject = null;
        this.transformControls.detach();
    }
    
    /**
     * Shows or hides the transform gizmo.
     * @param {boolean} visible - Whether gizmo should be visible
     */
    setGizmoVisible(visible) {
        this.gizmoVisible = visible;
        this.transformControls.visible = visible;
        this.transformControls.enabled = visible;
    }
    
    /**
     * Toggles gizmo visibility.
     * @returns {boolean} New visibility state
     */
    toggleGizmo() {
        this.setGizmoVisible(!this.gizmoVisible);
        return this.gizmoVisible;
    }
    
    /**
     * Returns whether the gizmo is currently visible.
     * @returns {boolean}
     */
    isGizmoVisible() {
        return this.gizmoVisible;
    }
    
    /**
     * Sets the transform mode.
     * Note: Scale mode is disabled to prevent mesh distortion.
     * @param {'translate'|'rotate'} mode - Transform mode
     */
    setTransformMode(mode) {
        if (['translate', 'rotate'].includes(mode)) {
            this.transformControls.setMode(mode);
        }
    }
    
    /**
     * Gets the current transform mode.
     * @returns {string}
     */
    getTransformMode() {
        return this.transformControls.mode;
    }
    
    /**
     * Sets the coordinate space for transformations.
     * @param {'world'|'local'} space - Coordinate space
     */
    setTransformSpace(space) {
        if (['world', 'local'].includes(space)) {
            this.transformControls.setSpace(space);
        }
    }
    
    /**
     * Sets the gizmo size.
     * @param {number} size - Size multiplier
     */
    setGizmoSize(size) {
        this.transformControls.setSize(size);
    }
    
    // =========================================================================
    // Lifecycle Methods
    // =========================================================================
    
    /**
     * Updates the controls. Call this in your animation loop.
     * Required for damping to work properly.
     */
    update() {
        // OrbitControls needs update() called for damping
        if (this.orbitControls.enableDamping) {
            this.orbitControls.update();
        }
    }
    
    /**
     * Cleans up event listeners and controls.
     * Call this when disposing of the controller.
     */
    dispose() {
        // Remove event listeners
        this.transformControls.removeEventListener('dragging-changed', this._onDraggingChanged);
        window.removeEventListener('keydown', this._onKeyDown);
        
        // Dispose controls
        this.orbitControls.dispose();
        this.transformControls.dispose();
        
        // Remove transform controls from scene
        this.scene.remove(this.transformControls);
    }
}
