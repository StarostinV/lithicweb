// Styles
import './styles/main.css';

import * as THREE from 'three';
import { exportAnnotations } from './loaders/meshExporter.js';
import { MODES, Mode } from './utils/mode.js';
import { eventBus, Events } from './utils/EventBus.js';
import {ArrowDrawer} from './components/arrow.js';
import { BasicMesh } from './geometry/BasicMesh.js';
import Scene from './components/scene.js';
import DrawLines from './components/drawLines.js';
import MeshLoader from './loaders/meshLoader.js';
import DrawBrush from './components/drawBrush.js';
import { HistoryPanel } from './components/historyPanel.js';
import { LibraryPanel } from './components/libraryPanel.js';
import { ModelPanel } from './components/modelPanel.js';
import { MetadataPanel } from './components/metadataPanel.js';
import { ConnectionManager } from './components/connectionManager.js';
import { EvaluationManager } from './evaluation/EvaluationManager.js';
import { EvaluationPanel } from './components/evaluationPanel.js';
import { DualViewManager } from './components/DualViewManager.js';
import { RenderingPanel } from './components/renderingPanel.js';
import { SettingsPanel } from './components/settingsPanel.js';
import { UserConfig } from './utils/UserConfig.js';
import { CloudStoragePanel } from './components/cloudStoragePanel.js';
import { initUI } from './components/uiSetup.js';
import { MeshView } from './components/MeshView.js';
import { AnnotationLibrary } from './utils/AnnotationLibrary.js';


// User configuration (persisted to localStorage)
const userConfig = new UserConfig();

// scene
const scene = new Scene();

// control mode
const mode = new Mode(scene);

// Mesh (geometry) + View (rendering + editing)
const basicMesh = new BasicMesh();
const meshView = new MeshView(scene, basicMesh);

// Arrow drawer
const arrowDrawer = new ArrowDrawer(scene.canvas, meshView, mode);

const drawLines = new DrawLines(scene, meshView, mode);

const drawBrush = new DrawBrush(scene, mode, meshView);

const meshLoader = new MeshLoader(meshView, arrowDrawer);

// Annotation library (stores saved annotations)
const annotationLibrary = new AnnotationLibrary();

// Evaluation manager (must be created before panels that depend on it)
const evaluationManager = new EvaluationManager(meshView);

// Dual view manager for side-by-side comparison
const dualViewManager = new DualViewManager(scene, meshView);

// Clear library, evaluation, and metadata when a new mesh is loaded
eventBus.on(Events.MESH_LOADED, () => {
    console.log('[main] Mesh loaded - clearing library, evaluation, and resetting metadata');
    annotationLibrary.clear();
    evaluationManager.clearGroundTruth();
    evaluationManager.clearPrediction();
    // Note: meshLoader.metadata is already set by the loader when loading from file/cloud
    // This ensures any stale metadata is cleared if a mesh load fails or loads with no metadata
}, 'main');

// History panel (simple undo/redo timeline)
const historyPanel = new HistoryPanel(meshView);

// Library panel (saved annotations management, GT/Pred tags)
const libraryPanel = new LibraryPanel(meshView, annotationLibrary);
libraryPanel.setEvaluationManager(evaluationManager);

// Connection manager (shared across app for server connection)
const connectionManager = new ConnectionManager();

// Model panel (AI inference) - with evaluation manager to auto-assign predictions
const modelPanel = new ModelPanel(meshView, connectionManager);
modelPanel.setEvaluationManager(evaluationManager);

// Evaluation panel
const evaluationPanel = new EvaluationPanel(meshView, evaluationManager);
evaluationPanel.setDualViewManager(dualViewManager);

// Metadata panel
const metadataPanel = new MetadataPanel(meshView, meshLoader);

// Cloud storage panel
const cloudStoragePanel = new CloudStoragePanel(meshView, meshLoader, connectionManager);

// Wire up cloud storage panel to model panel for optimized mesh loading
modelPanel.setCloudStoragePanel(cloudStoragePanel);

// Wire up cloud storage panel to library panel for cloud upload functionality
libraryPanel.setCloudStoragePanel(cloudStoragePanel);

// Rendering panel (view mode controls) - with userConfig for persistence
const renderingPanel = new RenderingPanel(scene, meshView, userConfig);
renderingPanel.setDualViewManager(dualViewManager);

// Settings panel (settings management)
const settingsPanel = new SettingsPanel(userConfig, renderingPanel);

// Reset rendering button
document.getElementById('resetRenderingBtn').addEventListener('click', () => {
    renderingPanel.resetToDefaults();
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    // Include current state's metadata under the 'state-metadata' key
    const stateMetadata = meshView.getCurrentStateMetadata();
    const additionalMetadata = Object.keys(stateMetadata).length > 0 
        ? { 'state-metadata': stateMetadata } 
        : {};
    exportAnnotations(meshView.mesh, meshView.meshColors, arrowDrawer, meshLoader, additionalMetadata);
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
    
    // If sidebar is collapsed, open it to show the panel
    const sideMenu = document.getElementById('sideMenu');
    if (sideMenu && sideMenu.classList.contains('sidebar-collapsed')) {
        const canvasContainer = document.querySelector('.canvas-container');
        const sidebarShowBtn = document.getElementById('sidebarShowBtn');
        const sidebarToggle = document.getElementById('sidebarToggle');
        
        sideMenu.classList.remove('sidebar-collapsed');
        canvasContainer?.classList.remove('canvas-fullscreen');
        sidebarShowBtn?.classList.remove('visible');
        sidebarToggle?.classList.remove('sidebar-hidden');
        document.body.classList.remove('sidebar-collapsed');
        localStorage.setItem('lithicjs_sidebar_collapsed', 'false');
        
        // Trigger resize to update Three.js canvas
        window.dispatchEvent(new Event('resize'));
    }
    
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

// Cached DOM elements for annotation tab synchronization (initialized lazily)
const annotationElements = {
    edgeTab: null,
    arrowTab: null,
    edgeSection: null,
    arrowSection: null,
    segmentSection: null,
    modeTabs: null,
    initialized: false
};

/**
 * Initialize cached annotation elements.
 * Called lazily on first use to ensure DOM is ready.
 */
function initAnnotationElements() {
    if (annotationElements.initialized) return;
    annotationElements.edgeTab = document.querySelector('.mode-tab[data-mode="edges"]');
    annotationElements.arrowTab = document.querySelector('.mode-tab[data-mode="arrows"]');
    annotationElements.edgeSection = document.getElementById('edgeAnnotationSection');
    annotationElements.arrowSection = document.getElementById('arrowAnnotationSection');
    annotationElements.segmentSection = document.getElementById('segmentationSection');
    annotationElements.modeTabs = document.querySelectorAll('.mode-tab');
    annotationElements.initialized = true;
}

// Sync annotation tabs when tool buttons are clicked directly
function syncAnnotationTabWithMode(mode) {
    // Initialize cached elements on first call
    initAnnotationElements();
    
    const { edgeTab, arrowTab, edgeSection, arrowSection, segmentSection, modeTabs } = annotationElements;
    
    if (!edgeTab || !arrowTab) return;
    
    const isEdgeMode = [MODES.DRAW, MODES.ERASE, MODES.DRAWLINES, MODES.RIDGE].includes(mode);
    const isArrowMode = [MODES.ARROW, MODES.DELETEARROWS].includes(mode);
    
    // Update tab active state
    modeTabs.forEach(t => t.classList.remove('active'));
    
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

// Hook into mode changes to sync tabs using EventBus
eventBus.on(Events.MODE_CHANGED, (data) => {
    syncAnnotationTabWithMode(data.mode);
}, 'main');

// Handle panel switch requests from other components (e.g., cloud storage -> library)
eventBus.on(Events.SWITCH_PANEL, (data) => {
    const { panelId } = data;
    if (!panelId) return;
    
    // Map panel IDs to their button IDs and onShow callbacks
    const panelConfig = {
        'viewPanel': { btnId: 'viewPanelBtn', onShow: null },
        'annotationPanel': { btnId: 'annotationPanelBtn', onShow: null },
        'modelPanel': { btnId: 'modelPanelBtn', onShow: null },
        'historyPanel': { btnId: 'historyPanelBtn', onShow: null },
        'libraryPanel': { btnId: 'libraryPanelBtn', onShow: null },
        'metadataPanel': { btnId: 'metadataPanelBtn', onShow: () => metadataPanel.onShow() },
        'evaluationPanel': { btnId: 'evaluationPanelBtn', onShow: null },
        'cloudStoragePanel': { btnId: 'cloudStoragePanelBtn', onShow: () => cloudStoragePanel.onShow() },
        'settingsPanel': { btnId: 'settingsPanelBtn', onShow: () => settingsPanel.onShow() }
    };
    
    const config = panelConfig[panelId];
    if (!config) {
        console.warn('[main] Unknown panel ID for switch:', panelId);
        return;
    }
    
    showHidePanel(panelId, config.onShow ? { onShow: config.onShow } : {});
    setActiveNavBtn(config.btnId);
    
    // Switch to view mode (consistent with manual panel switching)
    if (panelId !== 'annotationPanel') {
        mode.setMode(MODES.VIEW, true);
    }
}, 'main');

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

document.getElementById('libraryPanelBtn').addEventListener('click', () => {
    showHidePanel('libraryPanel');
    setActiveNavBtn('libraryPanelBtn');
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

document.getElementById('cloudStoragePanelBtn').addEventListener('click', () => {
    showHidePanel('cloudStoragePanel', {
        onShow: () => cloudStoragePanel.onShow()
    });
    setActiveNavBtn('cloudStoragePanelBtn');
    mode.setMode(MODES.VIEW, true);
});

document.getElementById('settingsPanelBtn').addEventListener('click', () => {
    showHidePanel('settingsPanel', {
        onShow: () => settingsPanel.onShow()
    });
    setActiveNavBtn('settingsPanelBtn');
    mode.setMode(MODES.VIEW, true);
});

// Keyboard shortcuts for undo/redo
window.addEventListener('keydown', (event) => {
    // Ctrl+Z for undo
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        meshView.undo();
    }
    // Ctrl+Shift+Z or Ctrl+Y for redo
    else if ((event.ctrlKey && event.shiftKey && event.key === 'Z') || (event.ctrlKey && event.key === 'y')) {
        event.preventDefault();
        meshView.redo();
    }
});

// =====================================================
// Annotation Label (top-left of canvas)
// Shows current annotation name, clicks open library panel
// =====================================================
const annotationLabel = document.getElementById('annotationLabel');
const annotationLabelText = document.getElementById('annotationLabelText');

/**
 * Shorten text to fit in the UI label.
 * @param {string} text - Text to shorten
 * @param {number} maxLength - Maximum length before truncating
 * @returns {string} Shortened text
 */
function shortenLabelText(text, maxLength = 20) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 1) + '…';
}

/**
 * Update the annotation label with current annotation name.
 */
function updateAnnotationLabel() {
    const annotation = meshView.getAnnotation();
    const name = annotation?.name || 'Untitled';
    annotationLabelText.textContent = shortenLabelText(name);
    annotationLabel.title = `${name} - Click to open Annotation Library`;
}

// Update label on annotation-related events
// NOTE: Only subscribe to events that actually change the current annotation:
// - MESH_LOADED: New mesh loaded, creates initial annotation with mesh/file name
// - ANNOTATION_ACTIVE_CHANGED: Current annotation changed (loaded from library, renamed, etc.)
// Do NOT subscribe to:
// - ANNOTATION_IMPORTED: This is for library auto-save, not UI updates
// - LIBRARY_CHANGED: Library changes don't change the current working annotation
// - STATE_LOADED: Use ANNOTATION_ACTIVE_CHANGED for UI updates instead
eventBus.on(Events.ANNOTATION_ACTIVE_CHANGED, updateAnnotationLabel, 'main');
eventBus.on(Events.MESH_LOADED, updateAnnotationLabel, 'main');

// Click to open library panel
annotationLabel.addEventListener('click', () => {
    eventBus.emit(Events.SWITCH_PANEL, { panelId: 'libraryPanel' });
});

// Initialize UI components (file input, modal, sidebar resize, annotation tabs)
initUI();

scene.animate();

// Handle window resize - account for navbar height and sidebar width
function updateRendererSize() {
    // Read dimensions from actual DOM elements (with fallbacks)
    const navbar = document.querySelector('.navbar');
    const sidebar = document.getElementById('sideMenu');
    const navbarHeight = navbar?.offsetHeight || 64;
    
    // Check if sidebar is collapsed - if so, use full width
    const isSidebarCollapsed = sidebar?.classList.contains('sidebar-collapsed');
    const sidebarWidth = isSidebarCollapsed ? 0 : (sidebar?.offsetWidth || 380);
    
    // Canvas is sized to visible area (excluding sidebar if visible)
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
window.debugGlobalVar.connectionManager = connectionManager;
window.debugGlobalVar.evaluationManager = evaluationManager;
window.debugGlobalVar.dualViewManager = dualViewManager;
window.debugGlobalVar.meshView = meshView;
window.debugGlobalVar.basicMesh = basicMesh;
window.debugGlobalVar.meshLoader = meshLoader;
window.debugGlobalVar.metadataPanel = metadataPanel;
window.debugGlobalVar.cloudStoragePanel = cloudStoragePanel;
window.debugGlobalVar.renderingPanel = renderingPanel;
window.debugGlobalVar.settingsPanel = settingsPanel;
window.debugGlobalVar.annotationLibrary = annotationLibrary;
window.debugGlobalVar.libraryPanel = libraryPanel;
window.debugGlobalVar.scene = scene;
window.debugGlobalVar.userConfig = userConfig;
