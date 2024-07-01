import {MODES} from '../utils/mode.js';


export default class DrawBrush {
    constructor(scene, mode, meshObject) {
        this.scene = scene;
        this.mode = mode;
        this.meshObject = meshObject;
        this.isDrawing = false;

        this.leftClickDown = this.mouseDown.bind(this);
        this.mouseMove = this.mouseMove.bind(this);
        this.leftClickUp = this.mouseUp.bind(this);

        scene.canvas.addEventListener('pointerdown', (event) => this.mouseDown(event));
        scene.canvas.addEventListener('pointermove', (event) => this.mouseMove(event));
        scene.canvas.addEventListener('pointerup', (event) => this.mouseUp(event));
    }

    mouseDown(event) {
        if (event.button !== 0 || this.meshObject.isNull()) return;

        if (this.mode == MODES.DRAW || this.mode == MODES.ERASE) {  
            this.isDrawing = true;  
            this.draw(event);
        }
    }

    mouseUp(event) {
        if (event.button !== 0) return;
        this.isDrawing = false;
    }

    mouseMove(event) {
        if (this.meshObject.isNull() || !this.isDrawing) return;

        this.draw(event);
    }

    draw(event) {
        if (this.meshObject.isNull() || !this.isDrawing) return;

        let color;

        if (this.mode == MODES.DRAW) {
            color = this.meshObject.drawColor;
        } else if (this.mode == MODES.ERASE) {
            color = this.meshObject.objectColor;
        } else {
            return;
        }

        const closestVertexIndex = this.meshObject.getClosestVertexIndex(event);
    
        if (closestVertexIndex !== -1) {
            this.meshObject.colorVertex(closestVertexIndex, color);
        }
    }
}