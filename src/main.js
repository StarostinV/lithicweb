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
    exportAnnotations(meshObject.mesh, meshObject.meshColors, arrowDrawer, meshLoader);
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

document.getElementById('historyPanelBtn').addEventListener('click', () => {
    showHidePanel('historyPanel');
});

// History panel controls
setupHistoryUI(meshObject);

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

// Setup history UI controls
function setupHistoryUI(meshObject) {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const historyList = document.getElementById('historyList');
    const historyStats = document.getElementById('historyStats');

    // Update UI when history changes
    const updateHistoryUI = (history) => {
        // Update button states
        undoBtn.disabled = !history.canUndo();
        redoBtn.disabled = !history.canRedo();

        // Update stats
        const undoCount = history.getUndoStack().length;
        const redoCount = history.getRedoStack().length;
        const memoryKB = (history.getMemoryUsage() / 1024).toFixed(2);
        historyStats.textContent = `History: ${undoCount} actions | Memory: ${memoryKB} KB`;

        // Update history list
        updateHistoryList(history);
    };

    const updateHistoryList = (history) => {
        const undoStack = history.getUndoStack();
        const redoStack = history.getRedoStack();

        if (undoStack.length === 0 && redoStack.length === 0) {
            historyList.innerHTML = '<p class="text-sm text-gray-500 italic">No actions yet</p>';
            return;
        }

        historyList.innerHTML = '';

        // Show undo stack (most recent first)
        [...undoStack].reverse().forEach((action, index) => {
            const item = createHistoryItem(action, 'undo', undoStack.length - index - 1);
            historyList.appendChild(item);
        });

        // Show current state indicator
        if (undoStack.length > 0 || redoStack.length > 0) {
            const currentState = document.createElement('div');
            currentState.className = 'text-xs font-bold text-blue-600 py-1 px-2 bg-blue-100 rounded';
            currentState.innerHTML = '<i class="fas fa-arrow-right"></i> Current State';
            historyList.appendChild(currentState);
        }

        // Show redo stack
        [...redoStack].reverse().forEach((action, index) => {
            const item = createHistoryItem(action, 'redo', redoStack.length - index - 1);
            historyList.appendChild(item);
        });
    };

    const createHistoryItem = (action, type, index) => {
        const item = document.createElement('div');
        item.className = `text-xs p-2 rounded ${type === 'redo' ? 'bg-gray-100 text-gray-400' : 'bg-white border border-gray-300'}`;
        
        const timestamp = new Date(action.timestamp).toLocaleTimeString();
        const edgeCount = action.newState ? action.newState.size : 0;
        const icon = action.type === 'draw' ? '<i class="fas fa-pen"></i>' : '<i class="fas fa-eraser"></i>';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <div class="font-semibold">${icon} ${action.description || action.type}</div>
                    <div class="text-gray-500">${timestamp} | ${edgeCount} edges</div>
                </div>
            </div>
        `;
        
        return item;
    };

    // Listen to history changes
    meshObject.history.addListener(updateHistoryUI);

    // Button click handlers
    undoBtn.addEventListener('click', () => {
        meshObject.undo();
    });

    redoBtn.addEventListener('click', () => {
        meshObject.redo();
    });

    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
            meshObject.history.clear();
        }
    });

    // Initial UI update
    updateHistoryUI(meshObject.history);
}
