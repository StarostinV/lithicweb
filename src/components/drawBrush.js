import {MODES} from '../utils/mode.js';
import Slider from './slider.js';

export default class DrawBrush {
    constructor(scene, mode, meshObject) {
        this.scene = scene;
        this.mode = mode;
        this.meshObject = meshObject;
        this.isDrawing = false;
        this.useBrush = false;
        this.brushRadius = 0.5;
        this.previousVertex = null;

        this.leftClickDown = this.mouseDown.bind(this);
        this.mouseMove = this.mouseMove.bind(this);
        this.leftClickUp = this.mouseUp.bind(this);

        scene.canvas.addEventListener('pointerdown', (event) => this.mouseDown(event));
        scene.canvas.addEventListener('pointermove', (event) => this.mouseMove(event));
        scene.canvas.addEventListener('pointerup', (event) => this.mouseUp(event));

        this.brushBtn = document.getElementById('useBrush');

        this.slideBrush = new Slider("BrushSize", this.brushRadius, 0.1, 3, (value) => {this.brushRadius = value;});

        this.brushBtn.addEventListener('click', () => {
            this.useBrush = !this.useBrush;
            this.updateHTML();

        });

        this.updateHTML();

    }

    updateHTML() {
        this.brushBtn.innerText = this.useBrush ? 'Disable brush' : 'Enable brush';
        if (this.useBrush) {
            this.slideBrush.show();
        } else { 
            this.slideBrush.hide();
        }
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
        if (this.isDrawing) {
            this.meshObject.onDrawFinished();
            this.isDrawing = false;
            this.previousVertex = null;
        }
    }

    mouseMove(event) {
        if (this.meshObject.isNull() || !this.isDrawing) return;

        this.draw(event);
    }

    draw(event) {
        if (this.meshObject.isNull() || !this.isDrawing) return;
        
        // if mode is not in draw or erase, return
        if (this.mode != MODES.DRAW && this.mode != MODES.ERASE) return;

        // if useBrush, call drawBrush, otherwise call drawVertex
        if (this.useBrush) {
            this.drawBrush(event);
        } else {
            this.drawVertex(event);
        }
    }

    drawVertex(event) {
        const closestVertexIndex = this.meshObject.getClosestVertexIndex(event);

        if (closestVertexIndex === -1) return;

        if (this.previousVertex === null) {
            this.previousVertex = closestVertexIndex;
            if (this.mode == MODES.DRAW) {
                this.meshObject.addEdgeVertex(closestVertexIndex);
            } else if (this.mode == MODES.ERASE) {
                this.meshObject.removeEdgeVertex(closestVertexIndex);
            }
            return;
        }

        const path = this.meshObject.findShortestPath(this.previousVertex, closestVertexIndex);
        
        if (this.mode == MODES.DRAW) {
            this.meshObject.addEdgeVertices(path);
        } else if (this.mode == MODES.ERASE) {
            this.meshObject.removeEdgeVertices(path);
        }

        this.previousVertex = closestVertexIndex;
    }

    drawBrush(event) {
        console.log('drawBrush');
        const vertexIndices = this.meshObject.getVerticesWithinRadius(event, this.brushRadius);

        if (vertexIndices.length === 0) return;

        if (this.mode == MODES.DRAW) {
            this.meshObject.addEdgeVertices(vertexIndices);
        } else if (this.mode == MODES.ERASE) {
            this.meshObject.removeEdgeVertices(vertexIndices);
        }
    }
}