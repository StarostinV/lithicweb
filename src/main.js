import * as THREE from 'three';
import { exportAnnotations } from './loaders/meshExporter.js';
import { handleModeSwitch, updateButtonStates } from './components/modeHandlers.js';
import CustomPLYLoader from './loaders/customPLYLoader.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { MODES, Mode } from './utils/mode.js';
import {ArrowDrawer} from './components/arrow.js';
import {MeshObject} from './geometry/meshObject.js';
import Scene from './components/scene.js';
import DrawLines from './components/drawLines.js';
import MeshLoader from './loaders/meshLoader.js';

// Accelerate raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;

//colors
const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

// scene
const scene = new Scene();

// control mode
const mode = new Mode();

// Mesh object
const meshObject = new MeshObject(scene, drawColor, objectColor);

// Arrow drawer
const arrowDrawer = new ArrowDrawer(scene.canvas, meshObject, mode);

const drawLines = new DrawLines(scene, meshObject, mode);

const meshLoader = new MeshLoader(meshObject, arrowDrawer);

// variables
let isDrawing = false;


document.getElementById('invertNormals').addEventListener('click', () => {
    meshObject.invertMeshNormals();
});

document.getElementById('fileInput').addEventListener('change', (event) => {
    meshLoader.load(event);
});

['view', 'draw', 'drawLines', 'erase', 'arrow', 'deleteArrows'].forEach(modeType => {
    document.getElementById(`${modeType}Mode`).addEventListener('click', (event) => {
        handleModeSwitch(event, mode, scene.controls);
    });
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(meshObject.mesh, meshObject.meshColors, arrowDrawer);
});


scene.canvas.addEventListener('pointerdown', (event) => {
    if (meshObject.isNull()) return;

    if (event.button === 0 && (mode == MODES.DRAW || mode == MODES.ERASE)) {    
        const closestVertexIndex = meshObject.getClosestVertexIndex(event);
    
        if (closestVertexIndex !== -1) {
            isDrawing = true;
            const targetColor = mode == 'draw' ? drawColor : objectColor;
            meshObject.colorVertex(closestVertexIndex, targetColor);
        }
    } else if (event.button === 2 && (mode != MODES.VIEW)) {
        mode.setMode(MODES.VIEW);
        scene.controls.enabled = true;
        updateButtonStates(mode);
    }
});

scene.canvas.addEventListener('pointermove', (event) => {
    if (meshObject.isNull() || !isDrawing || mode == MODES.VIEW) return;

    const closestVertexIndex = meshObject.getClosestVertexIndex(event);

    if (closestVertexIndex !== -1) {
        const targetColor = mode == 'draw' ? drawColor : objectColor;
        meshObject.colorVertex(closestVertexIndex, targetColor);
    }
});

scene.canvas.addEventListener('pointerup', (event) => {
    isDrawing = false;

    if (event.button === 2 && mode == MODES.VIEW) {
        mode.toPreviousMode();
    }

    if (mode != MODES.VIEW) {
        scene.controls.enabled = false;
        updateButtonStates(mode);
    }

});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        if (mode != MODES.VIEW) {
            mode.setMode(MODES.VIEW);
            scene.controls.enabled = true;
            updateButtonStates(mode);
        }
        
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode.toPreviousMode();
        if (mode != MODES.VIEW) {
            scene.controls.enabled = false;
            updateButtonStates(mode);
        }
    }
});


scene.animate();

window.addEventListener('resize', () => {
    scene.camera.aspect = window.innerWidth / window.innerHeight;
    scene.camera.updateProjectionMatrix();
    scene.renderer.setSize(window.innerWidth, window.innerHeight);
});
