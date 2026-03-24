import * as THREE from 'three';
import RotationController from './RotationController.js';

/**
 * Scene - Main Three.js scene manager.
 * 
 * Handles scene setup, rendering, lighting, and rotation controls.
 * Provides access to both camera orbit and object manipulation gizmo.
 * 
 * Lighting system:
 * - Key Light (DirectionalLight): Main directional light, can follow camera
 * - Fill Light (HemisphereLight): Soft sky/ground fill
 * - Ambient Light: Base illumination
 */
export default class Scene {
    constructor() {
        this.scene = new THREE.Scene();
        this.canvas = document.getElementById("renderCanvas");
        this.renderer = this.createRenderer();
        this.camera = this.createCamera();
        
        // Initialize rotation controller (handles both orbit and transform controls)
        this.rotationController = new RotationController(
            this.camera,
            this.canvas,
            this.scene
        );
        
        // Legacy alias for compatibility - points to orbit controls
        this.controls = this.rotationController.orbitControls;
        
        // Lighting state
        this.lightFollowsCamera = false;
        
        this.createLights();

        // Bind the animate method to the class instance
        this.animate = this.animate.bind(this);
    }

    createCamera() {
        // Account for navbar height and sidebar width when calculating initial aspect ratio
        const navbarHeight = 44; // Match CSS --navbar-height
        const sidebarWidth = 380; // Match CSS --sidebar-width
        const width = window.innerWidth - sidebarWidth;
        const height = window.innerHeight - navbarHeight;
        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.set(30, 30, 30);
        return camera;
    }
    
    /**
     * Attaches an object to the transform gizmo.
     * Call this after loading a mesh to enable object manipulation.
     * 
     * @param {THREE.Object3D} object - The object to attach
     */
    attachObjectToGizmo(object) {
        this.rotationController.attachObject(object);
    }
    
    /**
     * Shows or hides the transform gizmo.
     * @param {boolean} visible - Whether gizmo should be visible
     */
    setGizmoVisible(visible) {
        this.rotationController.setGizmoVisible(visible);
    }
    
    /**
     * Fit camera, frustum, and orbit controls to frame a mesh.
     * @param {{center: {x,y,z}, size: {x,y,z}, diagonal: number}} boundingInfo
     */
    fitToMesh(boundingInfo) {
        const { center, diagonal } = boundingInfo;
        this._meshCenter = new THREE.Vector3(center.x, center.y, center.z);
        this._meshDiagonal = diagonal;

        // Camera distance to frame the mesh with some padding
        const fovRad = this.camera.fov * Math.PI / 180;
        const fitDistance = (diagonal / 2) / Math.tan(fovRad / 2);
        const cameraDistance = fitDistance * 1.5;

        // Update frustum for this mesh scale
        this.camera.near = Math.max(diagonal * 0.001, 0.0001);
        this.camera.far = Math.max(diagonal * 100, 10);
        this.camera.updateProjectionMatrix();

        // Orbit controls
        this.rotationController.setOrbitTarget(this._meshCenter);
        this.rotationController.setDistanceLimits(diagonal * 0.01, diagonal * 10);
        this.rotationController.resetCamera(cameraDistance, this._meshCenter);
    }

    /**
     * Resets the camera to default viewing position.
     */
    resetCamera() {
        if (this._meshDiagonal) {
            const fovRad = this.camera.fov * Math.PI / 180;
            const fitDistance = (this._meshDiagonal / 2) / Math.tan(fovRad / 2);
            this.rotationController.resetCamera(fitDistance * 1.5, this._meshCenter);
        } else {
            this.rotationController.resetCamera(50);
        }
    }

    createRenderer() {
        const renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,  // Enable antialiasing for smoother edges
            preserveDrawingBuffer: true  // Required for screenshot capture
        });
        
        // Use device pixel ratio for sharp rendering on high-DPI displays
        renderer.setPixelRatio(window.devicePixelRatio);
        
        // Account for navbar height and sidebar width when setting initial size
        const navbarHeight = 44; // Match CSS --navbar-height
        const sidebarWidth = 380; // Match CSS --sidebar-width
        renderer.setClearColor(0x201944); // Set the background color of the canvas
        renderer.setSize(window.innerWidth - sidebarWidth, window.innerHeight - navbarHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Canvas is already in the HTML, don't append again
        // document.body.appendChild(renderer.domElement);
        renderer.domElement.addEventListener('contextmenu', function(event) {
            event.preventDefault();
        });

        return renderer;
    }

    /**
     * Creates the lighting setup:
     * - Key Light: DirectionalLight for main illumination (can follow camera)
     * - Fill Light: HemisphereLight for soft ambient fill
     * - Ambient Light: Base level illumination
     */
    createLights() {
        // Key Light - DirectionalLight for sharp, directional illumination
        // This is the main light that can follow the camera direction
        this.keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
        this.keyLight.position.set(1, 1, 1).normalize();
        this.scene.add(this.keyLight);

        // Fill Light - HemisphereLight for soft sky/ground fill
        // Provides natural-looking ambient lighting
        this.fillLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        this.fillLight.position.set(0, 1, 0); // Sky direction
        this.scene.add(this.fillLight);

        // Ambient Light - Base illumination to prevent pure black shadows
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(this.ambientLight);

        // Legacy alias for compatibility
        this.light = this.keyLight;
    }

    /**
     * Update key light direction from camera view.
     * Called manually via button or automatically when lightFollowsCamera is true.
     */
    updateLightFromCamera() {
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        // Light comes from camera direction (like a headlamp)
        this.keyLight.position.copy(forward).negate();
    }
    
    /**
     * Set whether the key light should follow the camera.
     * @param {boolean} follow - Whether light follows camera
     */
    setLightFollowsCamera(follow) {
        this.lightFollowsCamera = follow;
        if (follow) {
            this.updateLightFromCamera();
        }
    }
    
    /**
     * Set key light intensity.
     * @param {number} intensity - Light intensity (0-10 typical range)
     */
    setKeyLightIntensity(intensity) {
        this.keyLight.intensity = intensity;
    }
    
    /**
     * Set fill light intensity.
     * @param {number} intensity - Light intensity (0-5 typical range)
     */
    setFillLightIntensity(intensity) {
        this.fillLight.intensity = intensity;
    }
    
    /**
     * Set ambient light intensity.
     * @param {number} intensity - Light intensity (0-2 typical range)
     */
    setAmbientLightIntensity(intensity) {
        this.ambientLight.intensity = intensity;
    }
    
    /**
     * Set key light color.
     * @param {string|number} color - Color as hex string or number
     */
    setKeyLightColor(color) {
        this.keyLight.color.set(color);
    }
    
    /**
     * Set fill light colors (sky and ground).
     * @param {string|number} skyColor - Sky color
     * @param {string|number} groundColor - Ground color
     */
    setFillLightColors(skyColor, groundColor) {
        this.fillLight.color.set(skyColor);
        this.fillLight.groundColor.set(groundColor);
    }
    
    /**
     * Set ambient light color.
     * @param {string|number} color - Color as hex string or number
     */
    setAmbientLightColor(color) {
        this.ambientLight.color.set(color);
    }
    
    /**
     * Set key light direction manually.
     * @param {number} x - X component
     * @param {number} y - Y component  
     * @param {number} z - Z component
     */
    setKeyLightDirection(x, y, z) {
        this.keyLight.position.set(x, y, z).normalize();
    }
    
    /**
     * Apply a lighting preset.
     * @param {string} presetName - Name of the preset
     */
    applyLightingPreset(presetName) {
        switch (presetName) {
            case 'even':
                // Uniform illumination — useful for comparing colors and labels
                this.setKeyLightIntensity(1.5);
                this.setFillLightIntensity(1.5);
                this.setAmbientLightIntensity(0.8);
                this.setKeyLightColor(0xffffff);
                this.setFillLightColors(0xffffff, 0x808080);
                this.setKeyLightDirection(0, 1, 0);
                break;

            case 'relief':
                // Directional key — emphasizes depth and surface detail
                this.setKeyLightIntensity(3.5);
                this.setFillLightIntensity(0.3);
                this.setAmbientLightIntensity(0.1);
                this.setKeyLightColor(0xffffff);
                this.setFillLightColors(0x808080, 0x202020);
                this.setKeyLightDirection(1, 0.5, 0);
                break;

            case 'default':
            default:
                this.setKeyLightIntensity(2.0);
                this.setFillLightIntensity(1.0);
                this.setAmbientLightIntensity(0.3);
                this.setKeyLightColor(0xffffff);
                this.setFillLightColors(0xffffff, 0x444444);
                this.setKeyLightDirection(1, 1, 1);
                break;
        }
    }

    animate() {
        requestAnimationFrame(this.animate);
        
        // Update rotation controller for smooth damping
        this.rotationController.update();
        
        // Update light position if following camera
        if (this.lightFollowsCamera) {
            this.updateLightFromCamera();
        }
        
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Cleans up resources when scene is disposed.
     */
    dispose() {
        this.rotationController.dispose();
    }
}