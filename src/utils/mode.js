export const MODES = Object.freeze({
    VIEW: 'view',
    DRAW: 'draw',
    ERASE: 'erase',
    ARROW: 'arrow',
    DELETEARROWS: 'deleteArrows',
    DRAWLINES: 'drawLines'
});

/**
 * Mode - Manages application interaction modes and integrates with rotation controls.
 * 
 * Modes: VIEW, DRAW, ERASE, ARROW, DELETEARROWS, DRAWLINES
 * 
 * In VIEW mode:
 * - Gizmo is shown for object manipulation
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

        this.handleModeSwitch = this.handleModeSwitch.bind(this);
        this.setMode = this.setMode.bind(this);
        this.toPreviousMode = this.toPreviousMode.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);

        ['view', 'draw', 'drawLines', 'erase', 'arrow', 'deleteArrows'].forEach(modeType => {
            document.getElementById(`${modeType}Mode`).addEventListener('click', this.handleModeSwitch);
        });

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
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
        updatePanelBtnStates(this.getPanel());
    }

    updateControls() {
        if (this.currentMode === MODES.VIEW) {
            this.scene.controls.enabled = true;
        } else {
            this.scene.controls.enabled = false;
        }
    }
    
    /**
     * Updates gizmo visibility based on current mode.
     * Gizmo is shown in VIEW mode, hidden otherwise.
     */
    updateGizmo() {
        const isViewMode = this.currentMode === MODES.VIEW;
        this.scene.setGizmoVisible(isViewMode);
        
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

    getPanel() {
        if (this.currentMode === MODES.VIEW) {
            return 'view';
        }
        if (this.currentMode === MODES.DRAW || this.currentMode === MODES.ERASE || this.currentMode === MODES.DRAWLINES) {
            return 'draw';
        }
        if (this.currentMode === MODES.ARROW || this.currentMode === MODES.DELETEARROWS) {
            return 'arrow';
        }
    }

    handleModeSwitch(event) {
        console.log('handleModeSwitch', event.target.id);
        this.setMode(event.target.id.replace('Mode', ''), true);        
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

function updatePanelBtnStates(modePanel) {
    const buttons = document.querySelectorAll('.toggle-button');
    buttons.forEach(button => {
        button.classList.remove('bg-blue-500', 'text-white');
        if (button.id === `${modePanel}PanelBtn`) {
            button.classList.add('bg-blue-500', 'text-white');
        } else {
            button.classList.add('bg-gray-300', 'text-gray-700');
        }
    });
}
