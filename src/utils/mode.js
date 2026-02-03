export const MODES = Object.freeze({
    VIEW: 'view',
    DRAW: 'draw',
    ERASE: 'erase',
    ARROW: 'arrow',
    DELETEARROWS: 'deleteArrows',
    DRAWLINES: 'drawLines'
});

// Mode display names for the UI indicator
const MODE_LABELS = {
    [MODES.VIEW]: { label: 'View', icon: 'fa-eye', color: '#6366f1' },
    [MODES.DRAW]: { label: 'Draw', icon: 'fa-pen', color: '#f59e0b' },
    [MODES.ERASE]: { label: 'Erase', icon: 'fa-eraser', color: '#ef4444' },
    [MODES.ARROW]: { label: 'Arrows', icon: 'fa-arrow-right', color: '#10b981' },
    [MODES.DELETEARROWS]: { label: 'Delete Arrows', icon: 'fa-trash-alt', color: '#ef4444' },
    [MODES.DRAWLINES]: { label: 'Lines', icon: 'fa-project-diagram', color: '#8b5cf6' }
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
 */
export class Mode {
    constructor(scene) {
        this.scene = scene;
        this.currentMode = MODES.VIEW;
        this.previousMode = MODES.VIEW;
        this.ctrlHeld = false;
        this.showGizmo = true;  // User preference for gizmo visibility

        this.handleModeSwitch = this.handleModeSwitch.bind(this);
        this.setMode = this.setMode.bind(this);
        this.toPreviousMode = this.toPreviousMode.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);

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
        
        // Initialize UI state to match default mode (VIEW)
        this.update();
    }
    
    _onKeyDown(event) {
        // Alt key - temporarily switch to VIEW mode
        if (event.key === 'Alt') {
            if (this.currentMode !== MODES.VIEW) {
                this.setMode(MODES.VIEW);
            }
        }
        
        // Ctrl key - switch gizmo to translate mode while held
        if (event.key === 'Control' && !this.ctrlHeld) {
            this.ctrlHeld = true;
            if (this.currentMode === MODES.VIEW) {
                this._setGizmoMode('translate');
            }
        }
    }
    
    _onKeyUp(event) {
        // Alt key - return to previous mode
        if (event.key === 'Alt') {
            this.toPreviousMode();
        }
        
        // Ctrl key released - switch gizmo back to rotate mode
        if (event.key === 'Control') {
            this.ctrlHeld = false;
            if (this.currentMode === MODES.VIEW) {
                this._setGizmoMode('rotate');
            }
        }
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
        if (rewritePrevious) {
            this.previousMode = mode;
        } else {
            this.previousMode = this.currentMode;
        }
        this.currentMode = mode;

        this.update();
    }

    update() {
        this.updateCursor();
        this.updateControls();
        this.updateGizmo();
        this.updateToolButtonStates();
        this.updateModeIndicator();
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
        
        // Set appropriate transform mode based on Ctrl state
        if (isViewMode) {
            this._setGizmoMode(this.ctrlHeld ? 'translate' : 'rotate');
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
