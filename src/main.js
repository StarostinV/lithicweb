import * as THREE from 'three';
import { exportAnnotations } from './loaders/meshExporter.js';
import { MODES, Mode } from './utils/mode.js';
import {ArrowDrawer} from './components/arrow.js';
import {MeshObject} from './geometry/meshObject.js';
import Scene from './components/scene.js';
import DrawLines from './components/drawLines.js';
import MeshLoader from './loaders/meshLoader.js';
import DrawBrush from './components/drawBrush.js';

//colors
const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

// scene
const scene = new Scene();

// control mode
const mode = new Mode(scene);

// Mesh object
const meshObject = new MeshObject(scene, drawColor, objectColor);

// Arrow drawer
const arrowDrawer = new ArrowDrawer(scene.canvas, meshObject, mode);

const drawLines = new DrawLines(scene, meshObject, mode);

const drawBrush = new DrawBrush(scene, mode, meshObject);

const meshLoader = new MeshLoader(meshObject, arrowDrawer);


document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(meshObject.mesh, meshObject.meshColors, arrowDrawer);
});



function showHidePanel(panelId) {
    const panels = document.querySelectorAll('.panel');
    const panel = document.getElementById(panelId);

    panels.forEach(p => {
        p.classList.add('hidden');
    });

    panel.classList.remove('hidden');
}

// Event listeners for buttons
document.getElementById('viewPanelBtn').addEventListener('click', () => {
    showHidePanel('viewPanel');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('drawPanelBtn').addEventListener('click', () => {
    showHidePanel('drawPanel');
    mode.setMode(MODES.DRAW, true);
});

document.getElementById('arrowPanelBtn').addEventListener('click', () => {
    showHidePanel('arrowPanel');
    mode.setMode(MODES.ARROW, true);
});


scene.animate();

window.addEventListener('resize', () => {
    scene.camera.aspect = window.innerWidth / window.innerHeight;
    scene.camera.updateProjectionMatrix();
    scene.renderer.setSize(window.innerWidth, window.innerHeight);
});
