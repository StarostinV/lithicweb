import * as THREE from 'three';

export class ArrowDrawer {
    constructor(canvas, meshObject, intersectFinder, mode) {
        this.meshObject = meshObject;
        this.canvas = canvas;
        this.intersectFinder = intersectFinder;
        this.mode = mode;
        this.isDrawing = false;
        this.arrow = null;

        // Bind event listeners to ensure 'this' context is correct
        this.handleDrawing = this.handleDrawing.bind(this);
        this.startDrawing = this.startDrawing.bind(this);
        this.removeArrow = this.removeArrow.bind(this);

        // Add event listeners
        this.canvas.addEventListener('pointerdown', (event) => {
            if (this.mode.getMode() === 'arrow') {
                if (event.button === 0) {
                    this.startDrawing(event);
                } else {
                    this.removeArrow();
                }
            }
        });

        this.canvas.addEventListener('pointermove', this.handleDrawing);
    }

    mesh() {
        return this.meshObject.mesh;
    }

    startDrawing(event) {
        const firstVertex = this.intersectFinder.getClickedPoint(this.mesh(), event);
        if (firstVertex === -1) return;
        this.isDrawing = true;

        this.startPoint = new THREE.Vector3().fromArray(firstVertex);

        this.arrow = new THREE.ArrowHelper(
            new THREE.Vector3(),   // initial direction
            this.startPoint,       // initial start point
            0,                     // initial length
            0xff0000               // color
        );

        this.mesh().add(this.arrow);
    }

    removeArrow() {
        if (this.arrow) {
            this.mesh().remove(this.arrow);
            this.arrow = null;
        }
        this.isDrawing = false;
    }

    handleDrawing(event) {
        if (!this.mesh() || !this.isDrawing || !this.arrow) return;

        const closestVertexIndex = this.intersectFinder.getClosestVertexIndex(this.mesh(), event);

        if (closestVertexIndex !== -1) {
            this.updateArrow(closestVertexIndex);
        }
    }

    updateArrow(vertexIndex) {
        const endPoint = new THREE.Vector3().fromArray(this.mesh().geometry.attributes.position.array.slice(vertexIndex * 3, vertexIndex * 3 + 3));
        const direction = new THREE.Vector3().subVectors(endPoint, this.startPoint).normalize();
        const distance = this.startPoint.distanceTo(endPoint);

        this.arrow.setDirection(direction);
        this.arrow.setLength(distance);
    }
}
