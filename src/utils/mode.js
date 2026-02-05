import { eventBus, Events } from './EventBus.js';

export const MODES = Object.freeze({
    VIEW: 'view',
    DRAW: 'draw',
    ERASE: 'erase',
    ARROW: 'arrow',
    DELETEARROWS: 'deleteArrows',
    DRAWLINES: 'drawLines',
    RIDGE: 'ridge'
});

/**
 * Drawing/annotation modes that require single-view rendering.
 * These are disabled when dual view mode is active.
 */
const DRAWING_MODES = new Set([
    MODES.DRAW,
    MODES.ERASE,
    MODES.ARROW,
    MODES.DELETEARROWS,
    MODES.DRAWLINES,
    MODES.RIDGE
]);

// Mode display names for the UI indicator
const MODE_LABELS = {
    [MODES.VIEW]: { label: 'View', icon: 'fa-eye', color: '#6366f1' },
    [MODES.DRAW]: { label: 'Draw', icon: 'fa-pen', color: '#f59e0b' },
    [MODES.ERASE]: { label: 'Erase', icon: 'fa-eraser', color: '#ef4444' },
    [MODES.ARROW]: { label: 'Arrows', icon: 'fa-arrow-right', color: '#10b981' },
    [MODES.DELETEARROWS]: { label: 'Delete Arrows', icon: 'fa-trash-alt', color: '#ef4444' },
    [MODES.DRAWLINES]: { label: 'Lines', icon: 'fa-project-diagram', color: '#8b5cf6' },
    [MODES.RIDGE]: { label: 'Ridge', icon: 'fa-mountain', color: '#14b8a6' }
};

/**
 * Mode - Manages application interaction modes and integrates with rotation controls.
 * 
 * Modes: VIEW, DRAW, ERASE, ARROW, DELETEARROWS, DRAWLINES
 * 
 * In VIEW mode:
 * - Gizmo is shown for object manipulation (can be toggled off)
 * - Default: Rotate mode
 * - Hold Ctrl: Move (translate) mode
 * 
 * Hold Alt from any mode to temporarily enter VIEW mode with gizmo.
 * 
 * ## Event Bus Integration
 * 
 * Mode emits the following events via the global EventBus:
 * - `Events.MODE_CHANGED` - When interaction mode changes
 *   Data: { mode: string, previousMode: string, rewritePrevious: boolean }
 * 
 * Components can subscribe to these events instead of using addModeChangeListener():
 * ```javascript
 * import { eventBus, Events } from '../utils/EventBus.js';
 * eventBus.on(Events.MODE_CHANGED, (data) => {
 *     console.log('Mode changed to:', data.mode);
 * });
 * ```
 */
export class Mode {
    constructor(scene) {
        this.scene = scene;
        this.currentMode = MODES.VIEW;
        this.previousMode = MODES.VIEW;
        this.ctrlHeld = false;
        this.showGizmo = true;  // User preference for gizmo visibility
        this.modeChangeListeners = [];  // Listeners for mode changes
        this.transformMode = 'rotate';  // 'rotate' or 'translate'
        this.dualViewActive = false;  // Track if dual view is active (blocks drawing modes)

        this.handleModeSwitch = this.handleModeSwitch.bind(this);
        this.setMode = this.setMode.bind(this);
        this.toPreviousMode = this.toPreviousMode.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onDualViewChanged = this._onDualViewChanged.bind(this);

        // Add event listeners to mode buttons (if they exist)
        ['view', 'draw', 'drawLines', 'erase', 'arrow', 'deleteArrows'].forEach(modeType => {
            const element = document.getElementById(`${modeType}Mode`);
            if (element) {
                element.addEventListener('click', this.handleModeSwitch);
            }
        });
        
        // Add event listeners for view mode buttons in annotation panels
        ['viewModeEdge', 'viewModeArrow'].forEach(btnId => {
            const element = document.getElementById(btnId);
            if (element) {
                element.addEventListener('click', () => this.setMode(MODES.VIEW, true));
            }
        });

        // Gizmo visibility toggle
        const showGizmoToggle = document.getElementById('showGizmo');
        if (showGizmoToggle) {
            showGizmoToggle.addEventListener('change', (e) => {
                this.showGizmo = e.target.checked;
                this.updateGizmo();
            });
        }

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        
        // Listen for dual view changes to disable drawing modes
        eventBus.on(Events.DUAL_VIEW_CHANGED, this._onDualViewChanged);
        
        // Make mode indicator clickable - toggle between view and previous tool
        const modeIndicator = document.getElementById('modeIndicator');
        if (modeIndicator) {
            modeIndicator.addEventListener('click', () => {
                if (this.currentMode === MODES.VIEW) {
                    // In view mode - switch to previous tool (default to DRAW if no previous)
                    if (this.previousMode !== MODES.VIEW) {
                        this.toPreviousMode();
                    } else {
                        // No previous tool yet - default to Draw
                        this.setMode(MODES.DRAW, true);
                    }
                } else {
                    // In any tool mode - switch to view
                    this.setMode(MODES.VIEW);
                }
            });
        }
        
        // Make transform mode indicator clickable - toggle between rotate and move
        const transformModeIndicator = document.getElementById('transformModeIndicator');
        if (transformModeIndicator) {
            transformModeIndicator.addEventListener('click', () => {
                this.toggleTransformMode();
            });
        }
        
        // Initialize UI state to match default mode (VIEW)
        this.update();
    }
    
    /**
     * Toggles the transform mode between 'rotate' and 'translate'.
     */
    toggleTransformMode() {
        this.transformMode = this.transformMode === 'rotate' ? 'translate' : 'rotate';
        this._setGizmoMode(this.transformMode);
        this.updateTransformModeIndicator();
    }
    
    /**
     * Sets the transform mode explicitly.
     * @param {'rotate'|'translate'} mode - The transform mode
     */
    setTransformMode(mode) {
        if (mode === 'rotate' || mode === 'translate') {
            this.transformMode = mode;
            this._setGizmoMode(mode);
            this.updateTransformModeIndicator();
        }
    }
    
    _onKeyDown(event) {
        // Alt key - temporarily switch to VIEW mode
        if (event.key === 'Alt') {
            if (this.currentMode !== MODES.VIEW) {
                this.setMode(MODES.VIEW);
            }
        }
        
        // Ctrl key - temporarily switch to the opposite transform mode while held
        if (event.key === 'Control' && !this.ctrlHeld) {
            this.ctrlHeld = true;
            if (this.currentMode === MODES.VIEW) {
                // Switch to opposite of the persistent transform mode
                const tempMode = this.transformMode === 'rotate' ? 'translate' : 'rotate';
                this._setGizmoMode(tempMode);
            }
        }
    }
    
    _onKeyUp(event) {
        // Alt key - return to previous mode
        if (event.key === 'Alt') {
            this.toPreviousMode();
        }
        
        // Ctrl key released - switch gizmo back to the persistent transform mode
        if (event.key === 'Control') {
            this.ctrlHeld = false;
            if (this.currentMode === MODES.VIEW) {
                this._setGizmoMode(this.transformMode);
            }
        }
    }
    
    /**
     * Handle dual view state changes.
     * Forces VIEW mode when dual view is enabled since drawing requires single-view coordinates.
     * @private
     */
    _onDualViewChanged(data) {
        this.dualViewActive = data.enabled;
        
        if (data.enabled && DRAWING_MODES.has(this.currentMode)) {
            // Force switch to VIEW mode when dual view is enabled
            this.setMode(MODES.VIEW, true);
        }
        
        // Update UI to reflect tool availability
        this._updateDrawingToolsAvailability();
    }
    
    /**
     * Updates the visual state of drawing tool buttons based on dual view state.
     * Disables drawing tools when dual view is active.
     * @private
     */
    _updateDrawingToolsAvailability() {
        const toolButtons = document.querySelectorAll('.tool-btn');
        toolButtons.forEach(btn => {
            // Check if this button triggers a drawing mode
            const modeId = btn.id.replace('Mode', '');
            const isDrawingTool = DRAWING_MODES.has(modeId);
            
            if (isDrawingTool) {
                if (this.dualViewActive) {
                    btn.classList.add('disabled');
                    btn.setAttribute('title', 'Drawing tools are disabled in dual view mode');
                } else {
                    btn.classList.remove('disabled');
                    btn.removeAttribute('title');
                }
            }
        });
    }
    
    /**
     * Sets the gizmo transform mode.
     * @private
     */
    _setGizmoMode(mode) {
        if (this.scene.rotationController) {
            this.scene.rotationController.setTransformMode(mode);
        }
    }

    setMode(mode, rewritePrevious = false) {
        if (!Object.values(MODES).includes(mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }
        
        // Block drawing modes when dual view is active
        if (this.dualViewActive && DRAWING_MODES.has(mode)) {
            console.warn(`Mode '${mode}' is disabled while dual view is active`);
            return;
        }
        
        if (rewritePrevious) {
            this.previousMode = mode;
        } else {
            this.previousMode = this.currentMode;
        }
        this.currentMode = mode;

        this.update();
        this._notifyModeChangeListeners(mode, rewritePrevious);
    }

    /**
     * Add a listener for mode changes.
     * 
     * @deprecated Prefer using EventBus for new code:
     * ```javascript
     * import { eventBus, Events } from '../utils/EventBus.js';
     * eventBus.on(Events.MODE_CHANGED, (data) => {
     *     // data.mode, data.previousMode, data.rewritePrevious
     * });
     * ```
     * 
     * @param {Function} callback - Called with (newMode, rewritePrevious) when mode changes
     */
    addModeChangeListener(callback) {
        this.modeChangeListeners.push(callback);
    }

    /**
     * Remove a mode change listener.
     * @param {Function} callback - The callback to remove
     */
    removeModeChangeListener(callback) {
        this.modeChangeListeners = this.modeChangeListeners.filter(l => l !== callback);
    }

    /**
     * Notify all mode change listeners.
     * Emits both to legacy listeners and the global EventBus.
     * @private
     */
    _notifyModeChangeListeners(newMode, rewritePrevious) {
        // Legacy listener pattern (for backward compatibility)
        this.modeChangeListeners.forEach(cb => cb(newMode, rewritePrevious));
        
        // EventBus pattern (preferred for new code)
        eventBus.emit(Events.MODE_CHANGED, {
            mode: newMode,
            previousMode: this.previousMode,
            rewritePrevious: rewritePrevious
        });
    }

    update() {
        this.updateCursor();
        this.updateControls();
        this.updateGizmo();
        this.updateToolButtonStates();
        this.updateModeIndicator();
        this.updateTransformModeIndicator();
        // Note: Nav button highlighting is now handled by setActiveNavBtn in main.js
        // Mode changes no longer affect which tab appears active
    }
    
    /**
     * Updates the visual state of tool buttons to show which mode is active.
     */
    updateToolButtonStates() {
        // Tool buttons in the annotation panel
        const toolButtons = document.querySelectorAll('.tool-btn');
        toolButtons.forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Activate the correct button based on current mode
        const modeToButtonIds = {
            [MODES.VIEW]: ['viewModeEdge', 'viewModeArrow'],
            [MODES.DRAW]: ['drawMode'],
            [MODES.DRAWLINES]: ['drawLinesMode'],
            [MODES.RIDGE]: ['ridgeMode'],
            [MODES.ERASE]: ['eraseMode'],
            [MODES.ARROW]: ['arrowMode'],
            [MODES.DELETEARROWS]: ['deleteArrowsMode']
        };
        
        const activeButtonIds = modeToButtonIds[this.currentMode] || [];
        activeButtonIds.forEach(btnId => {
            const activeBtn = document.getElementById(btnId);
            if (activeBtn) {
                activeBtn.classList.add('active');
            }
        });
    }
    
    /**
     * Updates the mode indicator in the UI to show current interaction mode.
     */
    updateModeIndicator() {
        const indicator = document.getElementById('modeIndicator');
        if (!indicator) return;
        
        const modeInfo = MODE_LABELS[this.currentMode];
        if (modeInfo) {
            indicator.innerHTML = `<i class="fas ${modeInfo.icon}"></i> ${modeInfo.label}`;
            indicator.style.setProperty('--mode-color', modeInfo.color);
        }
    }
    
    /**
     * Updates the transform mode indicator (Rotate/Move) visibility and content.
     * Only visible in VIEW mode.
     */
    updateTransformModeIndicator() {
        const indicator = document.getElementById('transformModeIndicator');
        if (!indicator) return;
        
        // Only show in VIEW mode
        if (this.currentMode === MODES.VIEW) {
            indicator.classList.add('visible');
        } else {
            indicator.classList.remove('visible');
        }
        
        // Update content based on transform mode
        if (this.transformMode === 'rotate') {
            indicator.innerHTML = `<i class="fas fa-sync-alt"></i> Rotate`;
            indicator.classList.remove('move-mode');
        } else {
            indicator.innerHTML = `<i class="fas fa-arrows-alt"></i> Move`;
            indicator.classList.add('move-mode');
        }
    }

    updateControls() {
        if (this.currentMode === MODES.VIEW) {
            this.scene.controls.enabled = true;
        } else {
            this.scene.controls.enabled = false;
        }
    }
    
    /**
     * Updates gizmo visibility based on current mode and user preference.
     * Gizmo is shown in VIEW mode if user hasn't disabled it.
     */
    updateGizmo() {
        const isViewMode = this.currentMode === MODES.VIEW;
        // Show gizmo only if in view mode AND user wants to see it
        this.scene.setGizmoVisible(isViewMode && this.showGizmo);
        
        // Set appropriate transform mode based on Ctrl state (temporary override) or persistent setting
        if (isViewMode) {
            if (this.ctrlHeld) {
                // Ctrl temporarily switches to opposite mode
                const tempMode = this.transformMode === 'rotate' ? 'translate' : 'rotate';
                this._setGizmoMode(tempMode);
            } else {
                this._setGizmoMode(this.transformMode);
            }
        }
    }

    getMode() {
        return this.currentMode;
    }

    getPreviousMode() {
        return this.previousMode;
    }

    toPreviousMode() {
        console.log('toPreviousMode', this.currentMode, this.previousMode);
        this.currentMode = this.previousMode;
        this.update();
    }

    toString() {
        return this.currentMode;
    }

    updateCursor() {
        updateCursor(this.currentMode);
    }

    handleModeSwitch(event) {
        // Use currentTarget to get the button element, not the icon/span inside it
        const button = event.currentTarget;
        console.log('handleModeSwitch', button.id);
        this.setMode(button.id.replace('Mode', ''), true);        
    }

}


function updateCursor(mode) {
    const body = document.body;
    body.classList.remove('view-cursor', 'draw-cursor', 'erase-cursor');
    if (mode == 'draw') {
        body.classList.add('draw-cursor');
    } else if (mode == 'erase') {
        body.classList.add('erase-cursor');
    } else {
        body.classList.add('view-cursor');
    }
}

// Note: Nav button highlighting is now handled solely by setActiveNavBtn() in main.js.
// The mode no longer affects which navigation tab appears active.
// This provides Photoshop-like behavior where tools and panels are independent.
