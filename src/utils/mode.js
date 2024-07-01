export const MODES = Object.freeze({
    VIEW: 'view',
    DRAW: 'draw',
    ERASE: 'erase',
    ARROW: 'arrow',
    DELETEARROWS: 'deleteArrows',
    DRAWLINES: 'drawLines'
});

export class Mode {
    constructor(scene) {
        this.scene = scene;
        this.currentMode = MODES.VIEW;
        this.previousMode = MODES.VIEW;

        this.handleModeSwitch = this.handleModeSwitch.bind(this);
        this.setMode = this.setMode.bind(this);
        this.toPreviousMode = this.toPreviousMode.bind(this);

        ['view', 'draw', 'drawLines', 'erase', 'arrow', 'deleteArrows'].forEach(modeType => {
            document.getElementById(`${modeType}Mode`).addEventListener('click', this.handleModeSwitch);
        });


        window.addEventListener('keydown', (event) => {
            if (event.key === 'Alt') {
                this.setMode(MODES.VIEW);   
            }
        });
        
        window.addEventListener('keyup', (event) => {
            if (event.key === 'Alt') {
                this.toPreviousMode();
            }
        });
        
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
        updatePanelBtnStates(this.getPanel());
    }

    updateControls() {
        if (this.currentMode === MODES.VIEW) {
            console.log('Before Change:', this.scene.controls.enabled);

            this.scene.controls.enabled = true;

            console.log('After Change:', this.scene.controls.enabled);

            
            console.log('controls enabled');
        } else {
            console.log('Before Change:', this.scene.controls.enabled);

            this.scene.controls.enabled = false;
            console.log('After Change:', this.scene.controls.enabled);

            console.log('controls disabled');
        }
    }

    getMode() {
        return this.currentMode;
    }

    getPreviousMode() {
        return this.previousMode;
    }

    toPreviousMode() {
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
