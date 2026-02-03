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
import { MetadataPanel } from './components/metadataPanel.js';
import { EvaluationManager } from './evaluation/EvaluationManager.js';
import { EvaluationPanel } from './components/evaluationPanel.js';
import { RenderingPanel } from './components/renderingPanel.js';
import { UserConfig } from './utils/UserConfig.js';

//colors
const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

// User configuration (persisted to localStorage)
const userConfig = new UserConfig();

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

// Metadata panel
const metadataPanel = new MetadataPanel(meshObject, meshLoader);

// Rendering panel (view mode controls) - with userConfig for persistence
const renderingPanel = new RenderingPanel(scene, meshObject, userConfig);

// Reset rendering button
document.getElementById('resetRenderingBtn').addEventListener('click', () => {
    renderingPanel.resetToDefaults();
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    // Include current state's metadata under the 'state-metadata' key
    const stateMetadata = meshObject.getCurrentStateMetadata();
    const additionalMetadata = Object.keys(stateMetadata).length > 0 
        ? { 'state-metadata': stateMetadata } 
        : {};
    exportAnnotations(meshObject.mesh, meshObject.meshColors, arrowDrawer, meshLoader, additionalMetadata);
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
// Note: Annotation tab preserves the current mode (Photoshop-like tool switching).
// All other tabs automatically switch to View mode for mesh interaction.
document.getElementById('viewPanelBtn').addEventListener('click', () => {
    showHidePanel('viewPanel');
    setActiveNavBtn('viewPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

// Annotation panel - preserves current mode (tools control mode here)
document.getElementById('annotationPanelBtn').addEventListener('click', () => {
    showHidePanel('annotationPanel');
    setActiveNavBtn('annotationPanelBtn');
    // Don't change mode - let tool buttons control it
});

// Helper to manage active nav button state
function setActiveNavBtn(activeBtnId) {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(activeBtnId);
    if (activeBtn) activeBtn.classList.add('active');
}

// Sync annotation tabs when tool buttons are clicked directly
function syncAnnotationTabWithMode(mode) {
    const edgeTab = document.querySelector('.mode-tab[data-mode="edges"]');
    const arrowTab = document.querySelector('.mode-tab[data-mode="arrows"]');
    const edgeSection = document.getElementById('edgeAnnotationSection');
    const arrowSection = document.getElementById('arrowAnnotationSection');
    const segmentSection = document.getElementById('segmentationSection');
    
    if (!edgeTab || !arrowTab) return;
    
    const isEdgeMode = [MODES.DRAW, MODES.ERASE, MODES.DRAWLINES].includes(mode);
    const isArrowMode = [MODES.ARROW, MODES.DELETEARROWS].includes(mode);
    
    // Update tab active state
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    
    if (isEdgeMode) {
        edgeTab.classList.add('active');
        edgeSection?.classList.remove('hidden');
        arrowSection?.classList.add('hidden');
        segmentSection?.classList.add('hidden');
    } else if (isArrowMode) {
        arrowTab.classList.add('active');
        edgeSection?.classList.add('hidden');
        arrowSection?.classList.remove('hidden');
        segmentSection?.classList.add('hidden');
    }
}

// Hook into mode changes to sync tabs
const originalSetMode = mode.setMode.bind(mode);
mode.setMode = function(newMode, rewritePrevious = false) {
    originalSetMode(newMode, rewritePrevious);
    syncAnnotationTabWithMode(newMode);
};

document.getElementById('modelPanelBtn').addEventListener('click', () => {
    showHidePanel('modelPanel');
    setActiveNavBtn('modelPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('historyPanelBtn').addEventListener('click', () => {
    showHidePanel('historyPanel');
    setActiveNavBtn('historyPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('metadataPanelBtn').addEventListener('click', () => {
    showHidePanel('metadataPanel', {
        onShow: () => metadataPanel.onShow()
    });
    setActiveNavBtn('metadataPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('evaluationPanelBtn').addEventListener('click', () => {
    showHidePanel('evaluationPanel');
    setActiveNavBtn('evaluationPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('settingsPanelBtn').addEventListener('click', () => {
    showHidePanel('settingsPanel');
    setActiveNavBtn('settingsPanelBtn');
    mode.setMode(MODES.VIEW, true);
    updateSettingsSummary();
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

// ===== SETTINGS PANEL FUNCTIONALITY =====

/**
 * Update the settings summary display in the Settings panel.
 */
function updateSettingsSummary() {
    const renderingConfig = userConfig.getSection('rendering');
    const lightingConfig = userConfig.getSection('lighting');
    
    const renderingSummaryEl = document.getElementById('renderingSettingsSummary');
    const lightingSummaryEl = document.getElementById('lightingSettingsSummary');
    
    if (renderingSummaryEl) {
        renderingSummaryEl.innerHTML = `
            <div class="settings-item">
                <span class="settings-item-key">Annotation Mode</span>
                <span class="settings-item-value">${renderingConfig.annotationMode}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Material</span>
                <span class="settings-item-value">${renderingConfig.materialType}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Wireframe</span>
                <span class="settings-item-value">${renderingConfig.wireframeMode ? 'On' : 'Off'}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Flat Shading</span>
                <span class="settings-item-value">${renderingConfig.flatShading ? 'On' : 'Off'}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Background</span>
                <span class="settings-item-value">
                    <span class="settings-item-color" style="background-color: ${renderingConfig.backgroundColor}"></span>
                    ${renderingConfig.backgroundColor}
                </span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Edge Color</span>
                <span class="settings-item-value">
                    <span class="settings-item-color" style="background-color: ${renderingConfig.edgeColor}"></span>
                    ${renderingConfig.edgeColor}
                </span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Object Color</span>
                <span class="settings-item-value">
                    <span class="settings-item-color" style="background-color: ${renderingConfig.objectColor}"></span>
                    ${renderingConfig.objectColor}
                </span>
            </div>
        `;
    }
    
    if (lightingSummaryEl) {
        lightingSummaryEl.innerHTML = `
            <div class="settings-item">
                <span class="settings-item-key">Preset</span>
                <span class="settings-item-value">${lightingConfig.currentLightingPreset}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Key Light</span>
                <span class="settings-item-value">${lightingConfig.keyLightIntensity?.toFixed(1) || '2.0'}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Fill Light</span>
                <span class="settings-item-value">${lightingConfig.fillLightIntensity?.toFixed(1) || '1.0'}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Ambient</span>
                <span class="settings-item-value">${lightingConfig.ambientLightIntensity?.toFixed(1) || '0.3'}</span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Light Color</span>
                <span class="settings-item-value">
                    <span class="settings-item-color" style="background-color: ${lightingConfig.keyLightColor}"></span>
                    ${lightingConfig.keyLightColor}
                </span>
            </div>
            <div class="settings-item">
                <span class="settings-item-key">Follow Camera</span>
                <span class="settings-item-value">${lightingConfig.lightFollowsCamera ? 'On' : 'Off'}</span>
            </div>
        `;
    }
}

// Export settings button
document.getElementById('exportSettingsBtn').addEventListener('click', () => {
    userConfig.exportToFile('lithicjs-settings.json');
});

// Import settings input
document.getElementById('importSettingsInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        await userConfig.importFromFile(file);
        // Reload settings into rendering panel
        renderingPanel.loadFromConfig();
        // Update summary display
        updateSettingsSummary();
        // Show success message
        alert('Settings imported successfully!');
    } catch (error) {
        console.error('Failed to import settings:', error);
        alert('Failed to import settings: ' + error.message);
    }
    
    // Reset file input
    e.target.value = '';
});

// Reset all settings button
document.getElementById('resetAllSettingsBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        userConfig.reset();
        renderingPanel.loadFromConfig();
        updateSettingsSummary();
    }
});

// Clear local storage button
document.getElementById('clearStorageBtn').addEventListener('click', () => {
    if (confirm('This will clear all saved settings from browser storage. Continue?')) {
        localStorage.removeItem('lithicjs_user_config');
        userConfig.reset();
        renderingPanel.loadFromConfig();
        updateSettingsSummary();
        alert('Local storage cleared.');
    }
});

// Listen for config changes to update summary
userConfig.addListener('*', () => {
    // Only update if settings panel is visible
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
        updateSettingsSummary();
    }
});

scene.animate();

// Handle window resize - account for navbar height and sidebar width
function updateRendererSize() {
    const navbarHeight = 64; // Match CSS --navbar-height
    const sidebarWidth = 380; // Match CSS --sidebar-width
    
    // Canvas is sized to visible area (excluding sidebar)
    const width = window.innerWidth - sidebarWidth;
    const height = window.innerHeight - navbarHeight;
    
    // Clear any view offset that might have been set
    scene.camera.clearViewOffset();
    
    scene.camera.aspect = width / height;
    scene.camera.updateProjectionMatrix();
    scene.renderer.setSize(width, height);
}

window.addEventListener('resize', updateRendererSize);

// Initial size update
updateRendererSize();

// Export for debugging
window.debugGlobalVar.evaluationManager = evaluationManager;
window.debugGlobalVar.meshObject = meshObject;
window.debugGlobalVar.meshLoader = meshLoader;
window.debugGlobalVar.metadataPanel = metadataPanel;
window.debugGlobalVar.renderingPanel = renderingPanel;
window.debugGlobalVar.scene = scene;
window.debugGlobalVar.userConfig = userConfig;
