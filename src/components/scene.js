import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


export default class Scene {
    constructor() {
        this.scene = new THREE.Scene();
        this.canvas = document.getElementById("renderCanvas");
        this.renderer = this.createRenderer();
        this.camera = this.createCamera();
        this.controls = this.createControls();
        this.light = this.createLights();

        // Bind the animate method to the class instance
        this.animate = this.animate.bind(this);

    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(30, 30, 30);
        return camera;
    }

    createControls() {
        const controls = new OrbitControls(this.camera, this.canvas);
        controls.target.set(0, 0, 0);
        controls.update();
        controls.zoomSpeed = 1.2;
        return controls;
    }

    createRenderer() {
        const renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
        renderer.setClearColor(0x201944); // Set the background color of the canvas to light gray
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap; // You can use other types too
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

        return light;
    }

    updateLightDirection() {
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.negate();
        this.light.position.copy(forward);
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.renderer.render(this.scene, this.camera);
    }
    
};