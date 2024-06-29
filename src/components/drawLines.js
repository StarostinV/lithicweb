import * as THREE from 'three';
import {getFaceVertices} from '../geometry/intersections';


export default class DrawLines {
    constructor(scene, meshObject, mode, resolution = 0.05) {
        this.scene = scene;
        this.meshObject = meshObject;
        this.mode = mode;
        this.line = null;
        this.isDrawing = false;
        this.resolution = resolution;
        this.startPoint = null;
        this.endPoint = null;

        this.leftClick = this.leftClick.bind(this);
        this.rightClick = this.rightClick.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);

        this.scene.canvas.addEventListener('pointerdown', (event) => {
        if (this.mode != 'drawLines') return;
            if (event.button === 0) this.leftClick(event);
            if (event.button === 2) this.rightClick(event);
        });

        this.scene.canvas.addEventListener('pointermove', this.handleMouseMove);
    }

    leftClick(event) {
        const vertexIndex = this.meshObject.getClosestVertexIndex(event);
        if (vertexIndex === -1) {
            this.clear();
            return;
        }

        if (!this.isDrawing) {
            this.startLine(vertexIndex);
        } else if (this.line) {
            this.colorVerticesAlongLine();
            this.clear();
            this.startLine(vertexIndex);
        }
    }

    rightClick(event) {
        if (this.isDrawing) {
            this.clear();
        }
    }

    handleMouseMove(event) {
        if (this.mode != 'drawLines') return;
        if (this.isDrawing) {
            const vertexIndex = this.meshObject.getClosestVertexIndex(event);
            if (vertexIndex === -1) return;
            this.updateLine(vertexIndex);
        }
    }

    clear() {
        if (this.line) {
            this.scene.scene.remove(this.line);
            this.line.geometry.dispose();
            this.line.material.dispose();
        }
        this.line = null;
        this.isDrawing = false;
        this.startPoint = null;
        this.endPoint = null;
    }

    startLine(vertexIndex) {
        this.startPoint = this.meshObject.indexToVertex(vertexIndex);
        // Create a new geometry
        const geometry = new THREE.BufferGeometry().setFromPoints([this.startPoint, this.startPoint.clone()]);

        // Create a new material
        const material = new THREE.LineBasicMaterial({ color: this.meshObject.drawColor });

        // Create a new line
        this.line = new THREE.Line(geometry, material);

        // Add the line to the scene
        this.scene.scene.add(this.line);

        this.isDrawing = true;
    }

    updateLine(vertexIndex) {
        this.endPoint = this.meshObject.indexToVertex(vertexIndex);
        // Update the start and end points of the line
        this.line.geometry.setFromPoints([this.startPoint, this.endPoint]);
    }

    dispose() {
        // Dispose of the geometry and material of the line
        if (this.line) {
            this.line.geometry.dispose();
            this.line.material.dispose();
        }
    }

    colorVerticesAlongLine() {
        if ((!this.startPoint) || (!this.endPoint)) return;

        // generate linspace between start and end points based on resolution
        const numPoints = Math.floor(this.startPoint.distanceTo(this.endPoint) / this.resolution);

        const points = new Array(numPoints).fill().map((_, i) => {
            return new THREE.Vector3().lerpVectors(this.startPoint, this.endPoint, i / numPoints);
        });

        // find the vertices that are closest to the points
        const faceIndices = points.map(point => {
            return this.meshObject.mesh.geometry.boundsTree.closestPointToPoint(point).faceIndex;
        });

        // apply getFaceVertices, take first 3 results and flatten:
        const vertices = faceIndices.flatMap(faceIndex => getFaceVertices(this.meshObject.mesh, faceIndex).slice(0, 3));

        this.meshObject.colorVertices(vertices, this.meshObject.drawColor);
    }
}