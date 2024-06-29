export const MODES = Object.freeze({
    VIEW: 'view',
    DRAW: 'draw',
    ERASE: 'erase',
    ARROW: 'arrow',
    DELETEARROWS: 'deleteArrows',
    DRAWLINES: 'drawLines'
});

export class Mode {
    constructor() {
        this.currentMode = MODES.VIEW;
        this.previousMode = MODES.VIEW;
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
    }

    getMode() {
        return this.currentMode;
    }

    getPreviousMode() {
        return this.previousMode;
    }

    toPreviousMode() {
        this.currentMode = this.previousMode;
    }

    toString() {
        return this.currentMode;
    }

}
