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
        // Store vertex indices and local positions for annotation
        this.startVertexIndex = null;
        this.endVertexIndex = null;
        this.startPointLocal = null;  // Local space for BVH queries
        this.endPointLocal = null;    // Local space for BVH queries

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
            this.meshObject.onDrawFinished();
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
        this.startVertexIndex = null;
        this.endVertexIndex = null;
        this.startPointLocal = null;
        this.endPointLocal = null;
    }

    startLine(vertexIndex) {
        this.startVertexIndex = vertexIndex;
        // Store local position for BVH queries during annotation
        this.startPointLocal = this.meshObject.indexToVertex(vertexIndex);
        
        // Convert to world space for rendering
        const mesh = this.meshObject.mesh;
        mesh.updateMatrixWorld(true);
        const startPointWorld = this.startPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        
        // Create a new geometry in world space
        const geometry = new THREE.BufferGeometry().setFromPoints([startPointWorld, startPointWorld.clone()]);

        // Create a new material
        const material = new THREE.LineBasicMaterial({ color: this.meshObject.edgeColor });

        // Create a new line
        this.line = new THREE.Line(geometry, material);

        // Add the line to the scene
        this.scene.scene.add(this.line);

        this.isDrawing = true;
    }

    updateLine(vertexIndex) {
        this.endVertexIndex = vertexIndex;
        // Store local position for BVH queries during annotation
        this.endPointLocal = this.meshObject.indexToVertex(vertexIndex);
        
        // Convert both points to world space for rendering
        const mesh = this.meshObject.mesh;
        mesh.updateMatrixWorld(true);
        const startPointWorld = this.startPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        const endPointWorld = this.endPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        
        // Update the line geometry in world space
        this.line.geometry.setFromPoints([startPointWorld, endPointWorld]);
    }

    dispose() {
        // Dispose of the geometry and material of the line
        if (this.line) {
            this.line.geometry.dispose();
            this.line.material.dispose();
        }
    }

    colorVerticesAlongLine() {
        // Use local space positions for BVH queries
        if ((!this.startPointLocal) || (!this.endPointLocal)) return;

        // generate linspace between start and end points based on resolution (in local space)
        const numPoints = Math.floor(this.startPointLocal.distanceTo(this.endPointLocal) / this.resolution);

        const points = new Array(numPoints).fill().map((_, i) => {
            return new THREE.Vector3().lerpVectors(this.startPointLocal, this.endPointLocal, i / numPoints);
        });

        // find the vertices that are closest to the points (BVH operates in local space)
        const faceIndices = points.map(point => {
            return this.meshObject.mesh.geometry.boundsTree.closestPointToPoint(point).faceIndex;
        });

        const vertexIndices = faceIndices.flatMap(faceIndex => getFaceVertices(this.meshObject.mesh, faceIndex).slice(0, 3));

        // Create a connected path ensuring all vertices are reachable
        const connectedPath = this.meshObject.createConnectedPath(vertexIndices);

        this.meshObject.addEdgeVertices(connectedPath);
    }
}