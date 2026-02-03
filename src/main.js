import * as THREE from 'three';
import { exportAnnotations } from './loaders/meshExporter.js';
import { MODES, Mode } from './utils/mode.js';
import {ArrowDrawer} from './components/arrow.js';
import {MeshObject} from './geometry/meshObject.js';
import Scene from './components/scene.js';
import DrawLines from './components/drawLines.js';
import MeshLoader from './loaders/meshLoader.js';
import DrawBrush from './components/drawBrush.js';
import { HistoryPanel } from './components/historyPanel.js';
import { ModelPanel } from './components/modelPanel.js';
import { EvaluationManager } from './evaluation/EvaluationManager.js';
import { EvaluationPanel } from './components/evaluationPanel.js';

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

// Evaluation manager (must be created before panels that depend on it)
const evaluationManager = new EvaluationManager(meshObject);

// History panel (with evaluation manager for GT/Pred labels)
const historyPanel = new HistoryPanel(meshObject);
historyPanel.setEvaluationManager(evaluationManager);

// Model panel (AI inference) - with evaluation manager to auto-assign predictions
const modelPanel = new ModelPanel(meshObject);
modelPanel.setEvaluationManager(evaluationManager);

// Evaluation panel
const evaluationPanel = new EvaluationPanel(meshObject, evaluationManager);

document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(meshObject.mesh, meshObject.meshColors, arrowDrawer, meshLoader);
});

// Track current panel for evaluation mode management
let currentPanelId = 'viewPanel';

function showHidePanel(panelId, callbacks = {}) {
    const panels = document.querySelectorAll('.panel');
    const panel = document.getElementById(panelId);

    // Handle leaving previous panel
    if (currentPanelId === 'evaluationPanel' && panelId !== 'evaluationPanel') {
        // Exiting evaluation panel - restore normal state
        evaluationPanel.onHide();
    }

    panels.forEach(p => {
        p.classList.add('hidden');
    });

    panel.classList.remove('hidden');
    
    // Handle entering new panel
    if (panelId === 'evaluationPanel') {
        evaluationPanel.onShow();
    }
    
    currentPanelId = panelId;
    
    // Execute any callbacks
    if (callbacks.onShow) {
        callbacks.onShow();
    }
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

document.getElementById('modelPanelBtn').addEventListener('click', () => {
    showHidePanel('modelPanel');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('historyPanelBtn').addEventListener('click', () => {
    showHidePanel('historyPanel');
    // Keep current mode when viewing history
});

document.getElementById('evaluationPanelBtn').addEventListener('click', () => {
    showHidePanel('evaluationPanel');
    // Evaluation uses VIEW mode for camera controls
    mode.setMode(MODES.VIEW, true);
});

// Keyboard shortcuts for undo/redo
window.addEventListener('keydown', (event) => {
    // Ctrl+Z for undo
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        meshObject.undo();
    }
    // Ctrl+Shift+Z or Ctrl+Y for redo
    else if ((event.ctrlKey && event.shiftKey && event.key === 'Z') || (event.ctrlKey && event.key === 'y')) {
        event.preventDefault();
        meshObject.redo();
    }
});

scene.animate();

window.addEventListener('resize', () => {
    scene.camera.aspect = window.innerWidth / window.innerHeight;
    scene.camera.updateProjectionMatrix();
    scene.renderer.setSize(window.innerWidth, window.innerHeight);
});

// Export for debugging
window.debugGlobalVar.evaluationManager = evaluationManager;
window.debugGlobalVar.meshObject = meshObject;
