import * as THREE from 'three';
import {getFaceVertices} from '../geometry/intersections';
import { eventBus, Events } from '../utils/EventBus.js';


/**
 * DrawLines - Handles ridge/edge drawing mode for annotation.
 *
 * Allows users to draw line segments on the mesh surface by clicking start
 * and end points. Lines are rendered in real-time and converted to edge
 * vertices along the mesh surface when completed.
 *
 * Features:
 * - Left-click to start/end line segments
 * - Right-click to cancel current line
 * - Automatic snapping to nearby annotated vertices for seamless connections
 * - Path interpolation between start and end points
 */
export default class DrawLines {
    /**
     * Default snap distance as a fraction of the mesh diagonal.
     * @type {number}
     */
    static SNAP_FRACTION = 0.003;

    /**
     * Default resolution as a fraction of the mesh diagonal.
     * @type {number}
     */
    static RESOLUTION_FRACTION = 0.001;

    /**
     * Create a DrawLines handler.
     *
     * @param {Object} scene - Scene object with canvas, camera, etc.
     * @param {MeshView} meshView - The MeshView instance for mesh operations
     * @param {string} mode - Current interaction mode (reactive reference)
     */
    constructor(scene, meshView, mode) {
        this.scene = scene;
        this.meshView = meshView;
        this.mode = mode;
        this.line = null;
        this.isDrawing = false;
        this.resolution = 0.05;

        // Store vertex indices and local positions for annotation
        this.startVertexIndex = null;
        this.endVertexIndex = null;
        this.startPointLocal = null;  // Local space for BVH queries
        this.endPointLocal = null;    // Local space for BVH queries

        /**
         * Distance threshold for snapping to annotated vertices.
         * Set to 0 to disable snapping.
         * @type {number}
         */
        this.snapDistance = 0.15;

        this.leftClick = this.leftClick.bind(this);
        this.rightClick = this.rightClick.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);

        this.scene.canvas.addEventListener('pointerdown', (event) => {
            if (this.mode != 'drawLines') return;
            if (event.button === 0) this.leftClick(event);
            if (event.button === 2) this.rightClick(event);
        });

        this.scene.canvas.addEventListener('pointermove', this.handleMouseMove);

        // Scale snap/resolution to mesh size on load
        eventBus.on(Events.MESH_LOADED, () => this._scaleToMesh(), 'DrawLines');
    }

    /**
     * Scale snap distance, resolution, and preview offset to mesh size.
     * @private
     */
    _scaleToMesh() {
        const info = this.meshView.basicMesh?.computeBoundingInfo();
        if (!info) return;
        const d = info.diagonal;
        this.snapDistance = d * DrawLines.SNAP_FRACTION;
        this.resolution = d * DrawLines.RESOLUTION_FRACTION;
    }

    leftClick(event) {
        const vertexIndex = this.meshView.getClosestVertexIndex(event);
        if (vertexIndex === -1) {
            this.clear();
            return;
        }

        // Apply snapping to nearby annotated vertices for seamless connections
        const snappedVertexIndex = this._getSnappedVertex(vertexIndex);

        if (!this.isDrawing) {
            this.startLine(snappedVertexIndex);
        } else if (this.line) {
            this.colorVerticesAlongLine();
            this.clear();
            this.meshView.onDrawFinished();
            this.startLine(snappedVertexIndex);
        }
    }

    /**
     * Get the vertex index to use, potentially snapped to a nearby annotated vertex.
     * 
     * When starting or ending a line segment near an existing annotation edge,
     * this method returns the nearby annotated vertex to ensure seamless connections.
     * 
     * @param {number} vertexIndex - The original vertex index from the click
     * @returns {number} The snapped vertex index (original or nearby annotated vertex)
     * @private
     */
    _getSnappedVertex(vertexIndex) {
        // Skip snapping if disabled
        if (this.snapDistance <= 0) {
            return vertexIndex;
        }
        
        // Check if already on an annotated vertex
        if (this.meshView.currentEdgeIndices.has(vertexIndex)) {
            return vertexIndex;
        }
        
        // Look for nearby annotated vertices to snap to
        const nearest = this.meshView.findNearestAnnotatedVertex(vertexIndex, this.snapDistance);
        if (nearest) {
            return nearest.index;
        }
        
        return vertexIndex;
    }

    rightClick(event) {
        if (this.isDrawing) {
            this.clear();
        }
    }

    handleMouseMove(event) {
        if (this.mode != 'drawLines') return;
        if (this.isDrawing) {
            const vertexIndex = this.meshView.getClosestVertexIndex(event);
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
        this.startPointLocal = this.meshView.indexToVertex(vertexIndex);
        
        // Convert to world space for rendering
        const mesh = this.meshView.mesh;
        mesh.updateMatrixWorld(true);
        const startPointWorld = this.startPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        
        // Create a new geometry in world space
        const geometry = new THREE.BufferGeometry().setFromPoints([startPointWorld, startPointWorld.clone()]);

        // Create a new material
        const material = new THREE.LineBasicMaterial({ color: this.meshView.edgeColor });

        // Create a new line
        this.line = new THREE.Line(geometry, material);

        // Add the line to the scene
        this.scene.scene.add(this.line);

        this.isDrawing = true;
    }

    updateLine(vertexIndex) {
        this.endVertexIndex = vertexIndex;
        // Store local position for BVH queries during annotation
        this.endPointLocal = this.meshView.indexToVertex(vertexIndex);
        
        // Convert both points to world space for rendering
        const mesh = this.meshView.mesh;
        mesh.updateMatrixWorld(true);
        const startPointWorld = this.startPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        const endPointWorld = this.endPointLocal.clone().applyMatrix4(mesh.matrixWorld);
        
        // Update the line geometry in world space
        this.line.geometry.setFromPoints([startPointWorld, endPointWorld]);
    }

    dispose() {
        eventBus.offNamespace('DrawLines');
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
            return this.meshView.mesh.geometry.boundsTree.closestPointToPoint(point).faceIndex;
        });

        const vertexIndices = faceIndices.flatMap(faceIndex => getFaceVertices(this.meshView.mesh, faceIndex).slice(0, 3));

        // Create a connected path ensuring all vertices are reachable
        const connectedPath = this.meshView.createConnectedPath(vertexIndices);

        this.meshView.addEdgeVertices(connectedPath);
    }
}