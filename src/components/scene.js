import * as THREE from 'three';
import RotationController from './RotationController.js';
import Slider from './slider';

/**
 * Scene - Main Three.js scene manager.
 * 
 * Handles scene setup, rendering, lighting, and rotation controls.
 * Provides access to both camera orbit and object manipulation gizmo.
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
        
        this.createLights();
        this.updateLightIntensity = this.updateLightIntensity.bind(this);

        this.sliderLight = new Slider("Light", 2, 0, 10, (value) => {this.updateLightIntensity(value, this.light)});
        this.sliderAmbientLight = new Slider("AmbientLight", 2, 0, 50, (value) => {this.updateLightIntensity(value, this.ambientLight)});

        // Bind the animate method to the class instance
        this.animate = this.animate.bind(this);
        this.updateLightDirection = this.updateLightDirection.bind(this);
        document.getElementById('updateLight').addEventListener('click', this.updateLightDirection);
        document.getElementById('updateLight2').addEventListener('click', this.updateLightDirection);
    }

    updateLightIntensity(value, light) {
        light.intensity = value;
    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
     * Resets the camera to default viewing position.
     */
    resetCamera() {
        this.rotationController.resetCamera(50);
    }

    createRenderer() {
        const renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas,
            antialias: true  // Enable antialiasing for smoother edges
        });
        
        // Use device pixel ratio for sharp rendering on high-DPI displays
        renderer.setPixelRatio(window.devicePixelRatio);
        
        renderer.setClearColor(0x201944); // Set the background color of the canvas
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);
        renderer.domElement.addEventListener('contextmenu', function(event) {
            event.preventDefault();
        });

        return renderer;
    }

    createLights() {
        const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
        light.position.set(0, 20, 0); // Position of the light source
        this.scene.add(light);

        const ambientLight = new THREE.AmbientLight(0x0c0c0c, 1);
        this.scene.add(ambientLight);

        this.light = light;
        this.ambientLight = ambientLight;
    }

    updateLightDirection() {
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.negate();
        this.light.position.copy(forward);
    }

    animate() {
        requestAnimationFrame(this.animate);
        
        // Update rotation controller for smooth damping
        this.rotationController.update();
        
        this.renderer.render(this.scene, this.camera);
    }
    
    /**
     * Cleans up resources when scene is disposed.
     */
    dispose() {
        this.rotationController.dispose();
    }
}