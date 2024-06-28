import { exportAnnotations } from './loaders/meshExporter.js';
import { handleModeSwitch, handleDrawing, updateButtonStates } from './components/modeHandlers.js';
import CustomPLYLoader from './loaders/customPLYLoader.js';
import { updateLightDirection } from './utils/updateLight.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { IntersectFinder } from './geometry/intersections.js';
import { MODES, Mode } from './utils/mode.js';
import {ArrowDrawer} from './components/arrow.js';
import {MeshObject} from './geometry/meshObject.js';

// Accelerate raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;

//colors
const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

// renderer
const canvas = document.getElementById("renderCanvas");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setClearColor(0x201944); // Set the background color of the canvas to light gray
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // You can use other types too
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('contextmenu', function(event) {
    event.preventDefault();
});

// scene
const scene = new THREE.Scene();

// camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(30, 30, 30);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.update();
controls.zoomSpeed = 1.2;


// light
const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
light.position.set(0, 20, 0); // Position of the light source
scene.add(light);

const ambientLight = new THREE.AmbientLight(0x0c0c0c, 1);
scene.add(ambientLight);


// raycasting
const intersectFinder = new IntersectFinder(camera, canvas);

// control mode
const mode = new Mode();

// Mesh object
const meshObject = new MeshObject(scene, drawColor, objectColor, light);


// Arrow drawer
const arrowDrawer = new ArrowDrawer(canvas, meshObject, intersectFinder, mode);

// variables
let isDrawing = false;

document.getElementById('updateLight').addEventListener('click', () => updateLightDirection(camera, light));

document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const data = event.target.result;

            const loader = new CustomPLYLoader();
            const geometry = loader.parse(data);

            meshObject.setMesh(geometry);
        };
        reader.readAsArrayBuffer(file);
    }
});

['view', 'draw', 'erase', 'arrow'].forEach(modeType => {
    document.getElementById(`${modeType}Mode`).addEventListener('click', (event) => {
        handleModeSwitch(event, mode, controls);
    });
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(meshObject.mesh, meshObject.meshColors);
});


canvas.addEventListener('pointerdown', (event) => {
    if (meshObject.isNull()) return;

    if (event.button === 0 && (mode == MODES.DRAW || mode == MODES.ERASE)) {    
        const closestVertexIndex = intersectFinder.getClosestVertexIndex(meshObject.mesh, event);
    
        if (closestVertexIndex !== -1) {
            isDrawing = true;
            handleDrawing(closestVertexIndex, mode, meshObject.mesh, meshObject.meshColors, drawColor, objectColor);
        }
    } else if (event.button === 2 && (mode == MODES.DRAW || mode == MODES.ERASE)) {
        mode.setMode(MODES.VIEW);
        controls.enabled = true;
        updateButtonStates(mode);
    }
});

canvas.addEventListener('pointermove', (event) => {
    if (meshObject.isNull() || !isDrawing || mode == MODES.VIEW) return;

    const closestVertexIndex = intersectFinder.getClosestVertexIndex(meshObject.mesh, event);

    if (closestVertexIndex !== -1) {
        handleDrawing(closestVertexIndex, mode, meshObject.mesh, meshObject.meshColors, drawColor, objectColor);
    }
});

canvas.addEventListener('pointerup', (event) => {
    isDrawing = false;

    if (event.button === 2 && mode == MODES.VIEW) {
        console.log("pointerup", mode);
        mode.toPreviousMode();
    }

    if (mode != MODES.VIEW) {
        controls.enabled = false;
        updateButtonStates(mode);
    }

});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        if (mode == MODES.DRAW || mode == MODES.ERASE) {
            mode.setMode(MODES.VIEW);
            controls.enabled = true;
            updateButtonStates(mode);
        }
        
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode.toPreviousMode();
        if (mode != MODES.VIEW) {
            controls.enabled = false;
            updateButtonStates(mode);
        }
    }
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
