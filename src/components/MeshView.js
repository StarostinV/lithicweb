import * as THREE from 'three';
import { Annotation } from '../geometry/Annotation.js';
import { IntersectFinder } from '../geometry/intersections.js';
import { PathFinder } from '../geometry/PathFinder.js';
import { normalizeEdges } from '../geometry/faceUnionFind.js';
import { ActionHistory } from '../utils/ActionHistory.js';
import { eventBus, Events } from '../utils/EventBus.js';
import DynamicTypedArray from '../utils/DynamicTypedArray.js';
import { createColorBuffer, createMeshFromGeometry } from '../utils/meshUtils.js';

/**
 * MeshView - Composes Mesh + Annotation for display and editing.
 * 
 * This is the "view controller" that:
 * - Holds a reference to a BasicMesh (geometry)
 * - Holds a working Annotation (being edited)
 * - "Unzips" the annotation by computing segments/faceLabels on demand
 * - Manages Three.js rendering (colors, arrow objects)
 * - Manages ActionHistory for undo/redo
 * - Can be extended for comparison views (multiple MeshViews sharing same Mesh)
 * 
 * ## Key Concepts
 * 
 * - **Annotation** is lightweight (just edgeIndices + arrows + metadata)
 * - **MeshView** computes the expensive stuff (segments, colors) when displaying
 * - Multiple MeshViews can share the same BasicMesh geometry
 * 
 * @example
 * const mesh = new BasicMesh();
 * const meshView = new MeshView(scene, mesh, { edgeColor, objectColor });
 * 
 * // Load annotation into view
 * meshView.loadAnnotation(annotation);
 * 
 * // Edit and get back annotation
 * meshView.addEdgeVertex(123);
 * const updated = meshView.getAnnotation();
 */
export class MeshView {
    /**
     * Create a MeshView.
     * 
     * @param {Object} scene - Scene object with scene, light, canvas, etc.
     * @param {BasicMesh} mesh - The mesh geometry container
     * @param {Object} options - View options
     * @param {THREE.Color} options.edgeColor - Color for edge vertices
     * @param {THREE.Color} options.objectColor - Default color for mesh
     */
    constructor(scene, mesh, options = {}) {
        this.scene = scene;
        this.basicMesh = mesh;                   // Geometry container (BasicMesh)
        this._threeMesh = null;
        this._meshColors = null;
        this.annotationLibrary = null;           // Set externally for auto-sync
        this.intersectFinder = new IntersectFinder(scene);
        this.pathFinder = new PathFinder(this);
        
        // The annotation being edited (lightweight)
        this.workingAnnotation = null;
        
        // Computed state ("unzipped" from annotation)
        this.segments = [];
        this.faceLabels = [];
        this.faceColors = new Map();
        this.arrowObjects = [];                  // Three.js arrow groups
        
        // Editing state
        this.history = new ActionHistory();
        this.edgeColor = options.edgeColor || new THREE.Color(1, 0.6, 0.2);
        this.objectColor = options.objectColor || new THREE.Color(0.8, 0.8, 0.8);
        this.showSegments = true;
        
        // Edit tracking
        this.pendingAction = null;
        this.isRestoringState = false;
        this.currentEdgeIndices = new Set();     // Real-time tracking during edit
        this.initialState = new Set();           // State when annotation was loaded
        this.edgeLabels = new Uint8Array(0);
        
        // Arrow rendering config
        this.arrowOffset = 0.2;
        this.arrowColor = 0xff0000;
        this.arrowShaftRadius = 0.02;
        this.arrowHeadRadius = 0.05;
        this.arrowHeadLength = 0.2;
    }
    
    /**
     * Get the Three.js mesh object (from BasicMesh).
     * @returns {THREE.Mesh|null}
     */
    get threeMesh() {
        return this._threeMesh;
    }

    /**
     * Backward-compatible Three.js mesh accessor.
     * @returns {THREE.Mesh|null}
     */
    get mesh() {
        return this._threeMesh;
    }
    
    /**
     * Get the mesh colors buffer (from BasicMesh).
     * @returns {Float32Array|null}
     */
    get meshColors() {
        return this._meshColors;
    }
    
    /**
     * Get the vertex count.
     * @returns {number}
     */
    get vertexCount() {
        return this.basicMesh?.positions?.length / 3 || 0;
    }

    /**
     * Backward-compatible geometry accessors.
     */
    get positions() {
        return this.basicMesh?.positions || [];
    }

    get indices() {
        return this.basicMesh?.indices || [];
    }

    get adjacencyGraph() {
        return this.basicMesh?.adjacencyGraph || null;
    }

    get metadata() {
        return this.basicMesh?.metadata || {};
    }

    set metadata(value) {
        if (this.basicMesh) {
            this.basicMesh.metadata = value;
        }
    }

    isNull() {
        return !this.basicMesh || this.basicMesh.isNull();
    }

    /**
     * Ensure the Three.js mesh exists for this view.
     * 
     * @private
     * @returns {boolean} True if the mesh is available
     */
    _ensureThreeMesh() {
        if (this._threeMesh) return true;
        if (!this.basicMesh?.geometry) return false;

        const colorBuffer = createColorBuffer(this.vertexCount, this.objectColor);
        this._meshColors = colorBuffer;
        this._threeMesh = createMeshFromGeometry(this.basicMesh.geometry, colorBuffer);

        this.scene.light.target = this._threeMesh;
        this.scene.scene.add(this._threeMesh);

        if (this.scene.attachObjectToGizmo) {
            this.scene.attachObjectToGizmo(this._threeMesh);
        }

        return true;
    }

    /**
     * Dispose of the Three.js mesh and colors for this view.
     * 
     * @private
     */
    _disposeThreeMesh() {
        if (!this._threeMesh) return;
        
        this.scene.scene.remove(this._threeMesh);
        this._threeMesh.geometry.dispose();
        this._threeMesh.material.dispose();
        this._threeMesh = null;
        this._meshColors = null;
    }
    
    // ========================================
    // Annotation Loading/Saving
    // ========================================

    /**
     * Set mesh geometry and initialize view state.
     * 
     * @param {Float32Array} positions - Vertex positions
     * @param {Uint8Array|Array} labels - Edge labels (1 = edge, 0 = not edge)
     * @param {Array} indices - Face indices
     * @param {Object} [metadata={}] - Mesh-level metadata
     * @param {Object} [annotationOptions={}] - Annotation options (name, source, etc.)
     */
    setMesh(positions, labels, indices, metadata = {}, annotationOptions = {}) {
        const vertexCount = positions.length / 3;
        let edgeLabels = labels;

        if (!edgeLabels || edgeLabels.length === 0) {
            edgeLabels = new Uint8Array(vertexCount).fill(0);
        }

        this._disposeThreeMesh();
        this.basicMesh.setMesh(positions, indices, metadata);
        this._ensureThreeMesh();

        // Fit camera to mesh and scale rendering params
        const boundingInfo = this.basicMesh.computeBoundingInfo();
        if (this.scene.fitToMesh) {
            this.scene.fitToMesh(boundingInfo);
        }
        const d = boundingInfo.diagonal;
        this.arrowOffset = d * 0.004;
        this.arrowShaftRadius = d * 0.0004;
        this.arrowHeadRadius = d * 0.001;
        this.arrowHeadLength = d * 0.004;

        this.edgeLabels = new Uint8Array(edgeLabels);
        this.currentEdgeIndices.clear();
        for (let i = 0; i < this.edgeLabels.length; i++) {
            if (this.edgeLabels[i] === 1) {
                this.currentEdgeIndices.add(i);
            }
        }
        this.initialState = new Set(this.currentEdgeIndices);
        
        // Create initial annotation with provided options (name, source, etc.)
        this.workingAnnotation = Annotation.fromEdgeLabels(this.edgeLabels, [], annotationOptions);
        this.history.clear();
        this.history.setInitialAnnotation(this.workingAnnotation);

        this._applyEdgesToMesh();
        this._computeSegments();
        this._applySegmentColors();
    }
    
    /**
     * Load an annotation into this view for display and editing.
     * This "unzips" the annotation by computing segments and applying colors.
     * 
     * @param {Annotation} annotation - The annotation to load
     */
    loadAnnotation(annotation) {
        if (!this._ensureThreeMesh()) {
            console.warn('MeshView.loadAnnotation called before mesh geometry is set.');
            return;
        }
        // Clone to avoid mutating the original
        this.workingAnnotation = annotation.clone();
        
        // Copy edge indices for real-time tracking
        this.currentEdgeIndices = new Set(annotation.edgeIndices);
        this.initialState = new Set(annotation.edgeIndices);
        this.edgeLabels = new Uint8Array(this.vertexCount).fill(0);
        for (const index of this.currentEdgeIndices) {
            this.edgeLabels[index] = 1;
        }
        
        // Clear history and set initial annotation
        this.history.clear();
        this.history.setInitialAnnotation(annotation);
        
        // "Unzip" - compute derived state
        this._applyEdgesToMesh();
        this._computeSegments();
        this._applySegmentColors();
        this._createArrowObjects();
    }
    
    /**
     * Get the current state as a lightweight Annotation.
     * Call this to save the current editing state.
     * 
     * Architecture:
     * - workingAnnotation is THE source of truth for metadata (id, name, etc.)
     * - currentEdgeIndices is the real-time edge state (updated during drawing)
     * - History is just storage of past snapshots for undo/redo
     * 
     * @returns {Annotation} New Annotation with current state
     */
    getAnnotation() {
        const metadata = this.workingAnnotation?.metadata
            ? JSON.parse(JSON.stringify(this.workingAnnotation.metadata))
            : {};
        metadata.modifiedAt = Date.now();
        
        return new Annotation({
            id: this.workingAnnotation?.id,
            edgeIndices: new Set(this.currentEdgeIndices),
            arrows: this._getArrowData(),
            metadata
        });
    }
    
    /**
     * Mark the current edge state as the saved baseline.
     * After calling this, hasUnsavedChanges() returns false until the user edits.
     */
    markAsSaved() {
        this.initialState = new Set(this.currentEdgeIndices);
    }

    /**
     * Check if the current state differs from the loaded annotation.
     *
     * @returns {boolean} True if there are unsaved changes
     */
    hasUnsavedChanges() {
        if (!this.workingAnnotation) return false;
        
        // Compare edge indices
        if (this.currentEdgeIndices.size !== this.initialState.size) {
            return true;
        }
        for (const index of this.currentEdgeIndices) {
            if (!this.initialState.has(index)) {
                return true;
            }
        }
        
        // Compare arrows
        const currentArrows = this._getArrowData();
        if (currentArrows.length !== this.workingAnnotation.arrows.length) {
            return true;
        }
        
        return false;
    }
    
    // ========================================
    // Edge Editing Operations
    // ========================================
    
    /**
     * Add a vertex to the edge set.
     * 
     * @param {number} vertexIndex - Vertex index to mark as edge
     */
    addEdgeVertex(vertexIndex) {
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('draw');
        }
        
        this.currentEdgeIndices.add(vertexIndex);
        if (this.edgeLabels?.length) {
            this.edgeLabels[vertexIndex] = 1;
        }
        this.colorVertex(vertexIndex, this.edgeColor);
        
        // Clear face label for this vertex
        if (this.faceLabels[vertexIndex]) {
            this.faceLabels[vertexIndex] = 0;
        }
    }
    
    /**
     * Add multiple vertices to the edge set.
     * 
     * @param {Array<number>|Set<number>} vertexIndices - Vertex indices to mark as edges
     */
    addEdgeVertices(vertexIndices) {
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('draw');
        }
        
        for (const index of vertexIndices) {
            this.currentEdgeIndices.add(index);
            if (this.edgeLabels?.length) {
                this.edgeLabels[index] = 1;
            }
            this.colorVertex(index, this.edgeColor);
            if (this.faceLabels[index]) {
                this.faceLabels[index] = 0;
            }
        }
    }
    
    /**
     * Remove a vertex from the edge set.
     * 
     * @param {number} vertexIndex - Vertex index to unmark as edge
     */
    removeEdgeVertex(vertexIndex) {
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('erase');
        }
        
        this.currentEdgeIndices.delete(vertexIndex);
        if (this.edgeLabels?.length) {
            this.edgeLabels[vertexIndex] = 0;
        }
        this.colorVertex(vertexIndex, this.objectColor);
    }
    
    /**
     * Remove multiple vertices from the edge set.
     * 
     * @param {Array<number>|Set<number>} vertexIndices - Vertex indices to unmark as edges
     */
    removeEdgeVertices(vertexIndices) {
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('erase');
        }
        
        for (const index of vertexIndices) {
            this.currentEdgeIndices.delete(index);
            if (this.edgeLabels?.length) {
                this.edgeLabels[index] = 0;
            }
            this.colorVertex(index, this.objectColor);
        }
    }
    
    /**
     * Start tracking a draw/erase operation for history.
     * 
     * @param {string} actionType - Type of action: 'draw', 'erase', 'model', 'cloud'
     * @param {string} [description] - Optional custom description
     */
    startDrawOperation(actionType, description = null) {
        this.pendingAction = {
            type: actionType,
            previousState: new Set(this.currentEdgeIndices),
            description: description
        };
    }
    
    /**
     * Finish tracking and save to history.
     */
    /**
     * Finish tracking and save snapshot to history for undo/redo.
     * 
     * Architecture: History stores snapshots of edge state. 
     * Metadata comes from workingAnnotation (the source of truth).
     */
    finishDrawOperation() {
        if (this.pendingAction === null) return;

        const actionType = this.pendingAction.type;
        const currentState = new Set(this.currentEdgeIndices);

        // Only save if there were actual changes
        if (!this._setsEqual(this.pendingAction.previousState, currentState)) {
            // Create history snapshot (edges + arrows only, no metadata)
            const action = this.history.createAction({
                edgeIndices: currentState,
                arrows: this._getArrowData(),
                type: actionType,
                description: this.pendingAction.description,
            });

            // Store previous state for undo compatibility
            action.previousState = this.pendingAction.previousState;
            action.newState = currentState;

            this.history.push(action);
        }

        this.pendingAction = null;

        // External loads (not user edits) reset the saved baseline
        // so hasUnsavedChanges() returns false until the user draws/erases
        if (actionType !== 'draw' && actionType !== 'erase') {
            this.markAsSaved();
        }
    }
    
    /**
     * Called when a draw operation is complete.
     * Updates segments if auto-segments is enabled.
     */
    onDrawFinished() {
        if (!this.isRestoringState && this.pendingAction !== null) {
            this.finishDrawOperation();
        }
        
        const autoSegments = document.getElementById('auto-segments');
        if (autoSegments?.checked) {
            this.updateSegments();
        }
    }

    /**
     * Restore edge state (public wrapper for compatibility).
     * 
     * @param {Set<number>} edgeIndices - Edge indices to restore
     */
    restoreEdgeState(edgeIndices) {
        this._restoreEdgeState(edgeIndices);
    }

    // ========================================
    // Raycasting / Intersection Helpers
    // ========================================

    getClickedPoint(event) {
        if (!this._threeMesh) return -1;
        return this.intersectFinder.getClickedPoint(this._threeMesh, event);
    }

    getClickedFace(event) {
        if (!this._threeMesh) return -1;
        return this.intersectFinder.getClickedFace(this._threeMesh, event);
    }

    getClosestVertexIndex(event) {
        if (!this._threeMesh) return -1;
        const [, , closestVertexIndex] = this.intersectFinder.getClosestVertexIndex(this._threeMesh, event);
        return closestVertexIndex;
    }

    getVerticesWithinRadius(event, radius) {
        if (!this._threeMesh) return [];
        return this.intersectFinder.getVerticesWithinRadius(this._threeMesh, event, radius);
    }

    /**
     * Find the nearest annotated (edge) vertex to a given vertex position.
     * 
     * This is used for snapping new annotation lines to existing annotated vertices,
     * ensuring seamless connections between annotation segments.
     * 
     * @param {number} vertexIndex - The reference vertex index to search from
     * @param {number} maxDistance - Maximum distance threshold in local mesh units
     * @returns {{index: number, distance: number}|null} The nearest annotated vertex info, or null if none within threshold
     */
    findNearestAnnotatedVertex(vertexIndex, maxDistance) {
        if (this.currentEdgeIndices.size === 0) return null;
        
        const referencePosition = this.indexToVertex(vertexIndex);
        if (!referencePosition) return null;
        
        let nearestIndex = null;
        let nearestDistanceSq = maxDistance * maxDistance;
        
        for (const annotatedIndex of this.currentEdgeIndices) {
            // Skip if it's the same vertex
            if (annotatedIndex === vertexIndex) continue;
            
            const annotatedPosition = this.indexToVertex(annotatedIndex);
            if (!annotatedPosition) continue;
            
            const distanceSq = referencePosition.distanceToSquared(annotatedPosition);
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearestIndex = annotatedIndex;
            }
        }
        
        if (nearestIndex !== null) {
            return {
                index: nearestIndex,
                distance: Math.sqrt(nearestDistanceSq)
            };
        }
        
        return null;
    }

    getAllIntersectionInfo(event) {
        if (!this._threeMesh) return [-1, -1, -1, -1, -1];
        const [intersectPoint, faceIndex, closestVertexIndex] = this.intersectFinder.getClosestVertexIndex(this._threeMesh, event);
        if (closestVertexIndex === -1) return [-1, -1, -1, -1, -1];
        const vertexNormal = this.getVertexNormal(closestVertexIndex);
        const vertex = this.indexToVertex(closestVertexIndex);
        return [intersectPoint, faceIndex, vertexNormal, closestVertexIndex, vertex];
    }

    /**
     * Convert a vertex index to a Vector3 (compatibility).
     * 
     * @param {number} vertexIndex
     * @returns {THREE.Vector3|null}
     */
    indexToVertex(vertexIndex) {
        return this.basicMesh?.indexToVertex(vertexIndex) || null;
    }

    /**
     * Get a vertex normal by index (compatibility).
     * 
     * @param {number} vertexIndex
     * @returns {THREE.Vector3|number}
     */
    getVertexNormal(vertexIndex) {
        return this.basicMesh?.getVertexNormal(vertexIndex) ?? -1;
    }

    /**
     * Invert mesh normals and refresh view state.
     */
    invertMeshNormals() {
        if (!this.basicMesh) return;
        this.basicMesh.invertMeshNormals();
        this._disposeThreeMesh();
        this._ensureThreeMesh();
        this._applyEdgesToMesh();
        this._computeSegments();
        this._applySegmentColors();
    }

    /**
     * Find the shortest path between two vertices (compatibility).
     * 
     * @param {number} startVertex
     * @param {number} endVertex
     * @returns {Array<number>}
     */
    findShortestPath(startVertex, endVertex) {
        return this.pathFinder.findShortestPath(startVertex, endVertex);
    }

    /**
     * Check if two vertices are connected in the adjacency graph.
     * 
     * @param {number} vertex1
     * @param {number} vertex2
     * @returns {boolean}
     */
    areVerticesConnected(vertex1, vertex2) {
        if (!this.adjacencyGraph) return false;
        return this.adjacencyGraph.get(vertex1).has(vertex2);
    }

    /**
     * Create a connected path from an array of vertices.
     * 
     * @param {Array<number>} vertices
     * @returns {Array<number>}
     */
    createConnectedPath(vertices) {
        if (!vertices || vertices.length < 2) return vertices;

        const connectedPath = [vertices[0]];
        const totalVertices = this.vertexCount;
        
        for (let i = 1; i < vertices.length; i++) {
            const currentVertex = vertices[i];
            const previousVertex = vertices[i - 1];

            if (previousVertex < 0 || previousVertex >= totalVertices || currentVertex < 0 || currentVertex >= totalVertices) {
                console.warn("Invalid vertex indices in createConnectedPath", previousVertex, currentVertex);
                continue;
            }

            if (this.areVerticesConnected(previousVertex, currentVertex)) {
                connectedPath.push(currentVertex);
            } else {
                const path = this.pathFinder.findShortestPath(previousVertex, currentVertex);
                connectedPath.push(...path.slice(1));
            }
        }

        return connectedPath;
    }
    
    // ========================================
    // History Operations
    // ========================================
    
    /**
     * Undo the last action.
     * 
     * History is storage - when you undo, you load the previous snapshot
     * into workingAnnotation (edges AND metadata).
     * 
     * @returns {boolean} True if undo was successful
     */
    undo() {
        const action = this.history.undo();
        if (action) {
            // Get the current state after undo
            const currentIndex = this.history.getCurrentIndex();
            
            // Restore edges
            let stateToRestore;
            if (action.previousState) {
                stateToRestore = action.previousState;
            } else {
                stateToRestore = currentIndex === 0 
                    ? this.initialState 
                    : this.history.getStateAtIndex(currentIndex);
            }
            this._restoreEdgeState(stateToRestore);

            const autoSegments = document.getElementById('auto-segments');
            if (autoSegments?.checked) {
                this.updateSegments();
            }
            return true;
        }
        return false;
    }

    /**
     * Redo the last undone action.
     *
     * History is storage - when you redo, you load the next snapshot
     * into workingAnnotation (edges AND metadata).
     * 
     * @returns {boolean} True if redo was successful
     */
    redo() {
        const action = this.history.redo();
        if (action) {
            // Restore edges from the action
            let stateToRestore;
            if (action.annotation) {
                stateToRestore = new Set(action.annotation.edgeIndices);
            } else if (action.newState) {
                stateToRestore = action.newState;
            }
            
            if (stateToRestore) {
                this._restoreEdgeState(stateToRestore);

                const autoSegments = document.getElementById('auto-segments');
                if (autoSegments?.checked) {
                    this.updateSegments();
                }
                return true;
            }
        }
        return false;
    }
    
    /**
     * Jump to view a specific state without modifying history.
     * 
     * History is storage - jumping to a state loads that snapshot
     * into workingAnnotation (edges AND metadata).
     * 
     * @param {number} targetIndex - State index to jump to (0 = initial)
     */
    jumpToState(targetIndex) {
        const currentIndex = this.history.getCurrentIndex();
        
        if (targetIndex === currentIndex) {
            return;
        }
        
        // Get edge state from history
        let targetState = null;
        if (targetIndex === 0) {
            targetState = this.initialState;
        } else {
            targetState = this.history.getStateAtIndex(targetIndex);
        }
        
        if (targetState) {
            this.history.jumpToViewState(targetIndex);
            this._restoreEdgeState(targetState);

            const autoSegments = document.getElementById('auto-segments');
            if (autoSegments?.checked) {
                this.updateSegments();
            }
        }
    }
    
    /**
     * Restore edge state from a set of indices.
     * 
     * @private
     * @param {Set<number>} edgeIndices - Edge indices to restore
     */
    _restoreEdgeState(edgeIndices) {
        this.isRestoringState = true;
        
        // Clear current edges
        for (const index of this.currentEdgeIndices) {
            this.colorVertex(index, this.objectColor);
            if (this.edgeLabels?.length) {
                this.edgeLabels[index] = 0;
            }
        }
        this.currentEdgeIndices.clear();
        
        // Restore specified edges
        for (const index of edgeIndices) {
            this.currentEdgeIndices.add(index);
            if (this.edgeLabels?.length) {
                this.edgeLabels[index] = 1;
            }
            this.colorVertex(index, this.edgeColor);
        }
        
        this.isRestoringState = false;
    }
    
    // ========================================
    // Segment Computation
    // ========================================
    
    /**
     * Update segments by recomputing from current edge state.
     */
    updateSegments() {
        const previousFaceLabels = [...this.faceLabels];
        this._computeSegments();
        this._updateSegmentColors(previousFaceLabels);
    }

    /**
     * Normalize the current annotation edges: erode thick edges and
     * reassign clean, thin boundaries at segment borders.
     * @param {Object} [options]
     * @param {number} [options.minSegmentSize=1] - Remove vertex-level segments smaller than this
     * @param {number} [options.maxIterations=3] - Maximum normalization iterations
     * @returns {{converged: boolean, iterations: number}|undefined}
     */
    normalizeAnnotation({ minSegmentSize = 1, maxIterations = 3 } = {}) {
        if (!this.currentEdgeIndices?.size || !this.adjacencyGraph) return;

        // Ensure segments are computed so faceLabels has per-vertex segment IDs
        if (this.segments.length === 0) {
            this._computeSegments();
            // Assign temporary labels for segments
            this.faceLabels = new Array(this.vertexCount).fill(0);
            this.segments.forEach((segment, index) => {
                const segmentId = index + 1;
                segment.forEach(v => { this.faceLabels[v] = segmentId; });
            });
        }

        // Run the two-stage edge cleanup
        const { edgeLabels: cleanEdgeLabels, converged, iterations } = normalizeEdges(
            this.faceLabels, this.currentEdgeIndices,
            this.adjacencyGraph, this.vertexCount, this.indices,
            minSegmentSize, maxIterations
        );

        // Record as history operation
        this.startDrawOperation('normalize');

        // Clear old edges
        this.currentEdgeIndices.forEach(index => {
            this.edgeLabels[index] = 0;
            this.colorVertex(index, this.objectColor);
        });
        this.currentEdgeIndices.clear();

        // Apply new clean edges
        for (let v = 0; v < cleanEdgeLabels.length; v++) {
            if (cleanEdgeLabels[v] === 1) {
                this.edgeLabels[v] = 1;
                this.colorVertex(v, this.edgeColor);
                this.currentEdgeIndices.add(v);
            }
        }

        this.finishDrawOperation();
        this.updateSegments();

        return { converged, iterations };
    }

    /**
     * Compute segments from current edge state using flood-fill.
     * 
     * @private
     */
    _computeSegments() {
        if (!this.basicMesh?.adjacencyGraph) {
            this.segments = [];
            return;
        }
        
        const totalVertices = this.vertexCount;
        const visited = new Uint8Array(totalVertices).fill(0);
        const segments = [];
        
        for (let vertex = 0; vertex < totalVertices; vertex++) {
            if (visited[vertex] || this.currentEdgeIndices.has(vertex)) continue;
            
            const segment = this._floodFill(vertex, visited);
            if (segment.length > 0) {
                segments.push(segment);
            }
        }
        
        this.segments = segments;
    }
    
    /**
     * Flood-fill from a starting vertex to find a segment.
     * 
     * @private
     * @param {number} startVertex - Starting vertex index
     * @param {Uint8Array} visited - Visited array
     * @returns {Array<number>} Array of vertex indices in the segment
     */
    _floodFill(startVertex, visited) {
        const segment = new DynamicTypedArray();
        const queue = new DynamicTypedArray(10000);
        
        queue.push(startVertex);
        let queueStart = 0;
        
        while (queueStart < queue.size) {
            const vertex = queue.array[queueStart++];
            
            if (visited[vertex]) continue;
            visited[vertex] = 1;
            
            if (!this.currentEdgeIndices.has(vertex)) {
                segment.push(vertex);
                
                const neighbors = this.basicMesh.adjacencyGraph.get(vertex);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!visited[neighbor] && !this.currentEdgeIndices.has(neighbor)) {
                            queue.push(neighbor);
                        }
                    }
                }
            }
        }
        
        return segment.getUsedPortion();
    }
    
    /**
     * Update segment colors, trying to preserve colors from previous state.
     * 
     * @private
     * @param {Array<number>} previousFaceLabels - Previous face labels for color matching
     */
    _updateSegmentColors(previousFaceLabels = []) {
        const totalVertices = this.vertexCount;
        this.faceLabels = new Array(totalVertices).fill(0);
        const newFaceColors = new Map();
        const usedColors = new Set([this.objectColor]);
        
        // Find largest segment
        let largestSegmentIndex = 0;
        let maxSize = 0;
        this.segments.forEach((segment, index) => {
            if (segment.length > maxSize) {
                maxSize = segment.length;
                largestSegmentIndex = index;
            }
        });
        
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            
            // Largest segment uses object color
            if (index === largestSegmentIndex) {
                newFaceColors.set(segmentId, this.objectColor);
                segment.forEach(vertexIndex => {
                    this.faceLabels[vertexIndex] = segmentId;
                    this.colorVertex(vertexIndex, this.objectColor);
                });
                return;
            }
            
            // Try to match with previous segments
            let color = this._findBestMatchingColor(segment, previousFaceLabels, usedColors);
            
            usedColors.add(color);
            newFaceColors.set(segmentId, color);
            segment.forEach(vertexIndex => {
                this.faceLabels[vertexIndex] = segmentId;
                this.colorVertex(vertexIndex, color);
            });
        });
        
        this.faceColors = newFaceColors;
    }
    
    /**
     * Find the best matching color for a segment based on previous state.
     * 
     * @private
     */
    _findBestMatchingColor(segment, previousFaceLabels, usedColors) {
        if (previousFaceLabels.length === 0) {
            return this._generateUniqueColor(usedColors);
        }
        
        const sampleSize = Math.min(100, segment.length);
        const samples = new Set(segment.slice(0, sampleSize));
        
        const previousIds = new Set(previousFaceLabels);
        previousIds.delete(0);
        
        let bestMatchId = null;
        let bestMatchScore = 0;
        
        for (const prevId of previousIds) {
            let matchScore = 0;
            samples.forEach(vertexIndex => {
                if (previousFaceLabels[vertexIndex] === prevId) {
                    matchScore++;
                }
            });
            
            if (matchScore > bestMatchScore) {
                bestMatchScore = matchScore;
                bestMatchId = prevId;
            }
        }
        
        if (bestMatchId && this.faceColors.has(bestMatchId)) {
            const previousColor = this.faceColors.get(bestMatchId);
            if (!this._colorExistsInSet(previousColor, usedColors)) {
                return previousColor;
            }
        }
        
        return this._generateUniqueColor(usedColors);
    }
    
    /**
     * Reassign random colors to all segments.
     * Largest segment keeps the object color; others get new unique randoms.
     */
    refreshSegmentColors() {
        if (!this.segments || this.segments.length === 0) return;
        this._updateSegmentColors([]); // empty previous → all fresh colors
        // Re-apply edge colors on top
        for (const index of this.currentEdgeIndices) {
            this.colorVertex(index, this.edgeColor);
        }
    }

    // ========================================
    // Color Operations
    // ========================================

    /**
     * Color a single vertex.
     * 
     * @param {number} vertexIndex - Vertex index
     * @param {THREE.Color} color - Color to apply
     */
    colorVertex(vertexIndex, color) {
        const meshColors = this._meshColors;
        if (!meshColors) return;
        
        meshColors[vertexIndex * 3] = color.r;
        meshColors[vertexIndex * 3 + 1] = color.g;
        meshColors[vertexIndex * 3 + 2] = color.b;
        
        if (this._threeMesh?.geometry?.attributes?.color) {
            this._threeMesh.geometry.attributes.color.needsUpdate = true;
        }
    }
    
    /**
     * Color multiple vertices.
     * 
     * @param {Array<number>|Set<number>} vertexIndices - Vertex indices
     * @param {THREE.Color} color - Color to apply
     */
    colorVertices(vertexIndices, color) {
        const meshColors = this._meshColors;
        if (!meshColors) return;
        
        for (const index of vertexIndices) {
            meshColors[index * 3] = color.r;
            meshColors[index * 3 + 1] = color.g;
            meshColors[index * 3 + 2] = color.b;
        }
        
        if (this._threeMesh?.geometry?.attributes?.color) {
            this._threeMesh.geometry.attributes.color.needsUpdate = true;
        }
    }
    
    /**
     * Apply current edge indices to mesh colors.
     * 
     * @private
     */
    _applyEdgesToMesh() {
        if (!this._meshColors) return;
        const totalVertices = this.vertexCount;
        
        // First, color everything object color
        for (let i = 0; i < totalVertices; i++) {
            this.colorVertex(i, this.objectColor);
        }
        
        // Then color edges
        for (const index of this.currentEdgeIndices) {
            this.colorVertex(index, this.edgeColor);
        }
    }
    
    /**
     * Apply segment colors after computing segments.
     * 
     * @private
     */
    _applySegmentColors() {
        this._updateSegmentColors([]);
    }
    
    /**
     * Toggle segment color display.
     * 
     * @param {boolean} show - Whether to show segment colors
     */
    setShowSegments(show) {
        this.showSegments = show;
        
        if (show) {
            this._colorSegmentsFaceColor();
        } else {
            this._colorSegmentsObjectColor();
        }
    }
    
    /**
     * Color segments with their face colors.
     * 
     * @private
     */
    _colorSegmentsFaceColor() {
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            const color = this.faceColors.get(segmentId) || this.objectColor;
            segment.forEach(vertexIndex => {
                this.colorVertex(vertexIndex, color);
            });
        });
    }
    
    /**
     * Color all segments with object color.
     * 
     * @private
     */
    _colorSegmentsObjectColor() {
        this.segments.forEach(segment => {
            segment.forEach(vertexIndex => {
                this.colorVertex(vertexIndex, this.objectColor);
            });
        });
    }
    
    /**
     * Regenerate random colors for all segments.
     */
    regenerateColors() {
        const usedColors = new Set([this.objectColor]);
        const newFaceColors = new Map();
        
        // Find largest segment
        let largestSegmentId = null;
        let maxSize = 0;
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            if (segment.length > maxSize) {
                maxSize = segment.length;
                largestSegmentId = segmentId;
            }
        });
        
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            
            if (segmentId === largestSegmentId) {
                newFaceColors.set(segmentId, this.objectColor);
                return;
            }
            
            const color = this._generateUniqueColor(usedColors);
            usedColors.add(color);
            newFaceColors.set(segmentId, color);
            
            segment.forEach(vertexIndex => {
                this.colorVertex(vertexIndex, color);
            });
        });
        
        this.faceColors = newFaceColors;
    }
    
    // ========================================
    // Arrow Operations
    // ========================================
    
    /**
     * Create Three.js arrow objects from annotation arrows.
     * 
     * @private
     */
    _createArrowObjects() {
        this._clearArrowObjects();
        
        if (!this.workingAnnotation?.arrows) return;
        if (!this._threeMesh) return;
        
        for (const arrow of this.workingAnnotation.arrows) {
            const arrowObj = this._createArrowObject(arrow.startIndex, arrow.endIndex);
            if (arrowObj) {
                this.arrowObjects.push(arrowObj);
                this.threeMesh?.add(arrowObj.group);
            }
        }
    }
    
    /**
     * Create a single arrow object.
     * 
     * @private
     * @param {number} startIndex - Start vertex index
     * @param {number} endIndex - End vertex index
     * @returns {Object|null} Arrow object with group and data
     */
    _createArrowObject(startIndex, endIndex) {
        if (!this.basicMesh) return null;
        
        const startPoint = this.basicMesh.indexToVertex(startIndex);
        const endPoint = this.basicMesh.indexToVertex(endIndex);
        const startNormal = this.basicMesh.getVertexNormal(startIndex);
        const endNormal = this.basicMesh.getVertexNormal(endIndex);
        
        if (!startPoint || !endPoint) return null;
        
        const start = startPoint.clone().addScaledVector(startNormal, this.arrowOffset);
        const end = endPoint.clone().addScaledVector(endNormal, this.arrowOffset);
        
        const direction = new THREE.Vector3().subVectors(end, start);
        const distance = direction.length();
        direction.normalize();
        
        if (distance < this.arrowHeadLength * 0.05) return null;

        // Create arrow group
        const group = new THREE.Group();

        // Shaft
        const shaftLength = Math.max(distance - this.arrowHeadLength, this.arrowShaftRadius);
        const shaftGeometry = new THREE.CylinderGeometry(
            this.arrowShaftRadius, this.arrowShaftRadius, shaftLength, 8
        );
        const shaftMaterial = new THREE.MeshBasicMaterial({ color: this.arrowColor });
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.position.set(0, shaftLength / 2, 0);
        group.add(shaft);
        
        // Head
        const headGeometry = new THREE.ConeGeometry(
            this.arrowHeadRadius, this.arrowHeadLength, 8
        );
        const headMaterial = new THREE.MeshBasicMaterial({ color: this.arrowColor });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.position.set(0, distance - this.arrowHeadLength / 2, 0);
        group.add(head);
        
        // Position and orient
        group.position.copy(start);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        
        return {
            group,
            startIndex,
            endIndex,
            shaft
        };
    }
    
    /**
     * Clear all arrow objects from the scene.
     * 
     * @private
     */
    _clearArrowObjects() {
        for (const arrowObj of this.arrowObjects) {
            if (arrowObj.group) {
                arrowObj.group.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
                arrowObj.group.parent?.remove(arrowObj.group);
            }
        }
        this.arrowObjects = [];
    }
    
    /**
     * Add an arrow to the annotation.
     * 
     * @param {number} startIndex - Start vertex index
     * @param {number} endIndex - End vertex index
     */
    addArrow(startIndex, endIndex) {
        const arrowObj = this._createArrowObject(startIndex, endIndex);
        if (arrowObj) {
            this.arrowObjects.push(arrowObj);
            this.threeMesh?.add(arrowObj.group);
        }
    }
    
    /**
     * Remove an arrow by index.
     * 
     * @param {number} index - Arrow index
     */
    removeArrow(index) {
        if (index < 0 || index >= this.arrowObjects.length) return;
        
        const arrowObj = this.arrowObjects[index];
        if (arrowObj.group) {
            arrowObj.group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            arrowObj.group.parent?.remove(arrowObj.group);
        }
        
        this.arrowObjects.splice(index, 1);
    }
    
    /**
     * Get arrow data for serialization.
     * 
     * @private
     * @returns {Array<{startIndex: number, endIndex: number}>}
     */
    _getArrowData() {
        return this.arrowObjects.map(obj => ({
            startIndex: obj.startIndex,
            endIndex: obj.endIndex
        }));
    }
    
    // ========================================
    // Utility Methods
    // ========================================
    
    /**
     * Generate a unique color not in the used set.
     * 
     * @private
     */
    _generateUniqueColor(usedColors) {
        let newColor;
        let attempts = 0;
        const maxAttempts = 100;
        
        do {
            newColor = new THREE.Color(
                Math.random(),
                Math.random(),
                Math.random()
            );
            attempts++;
            if (attempts > maxAttempts) {
                console.warn('Could not generate unique color');
                break;
            }
        } while (this._colorExistsInSet(newColor, usedColors));
        
        return newColor;
    }
    
    /**
     * Check if a color exists in a set.
     * 
     * @private
     */
    _colorExistsInSet(color, colorSet) {
        for (const existingColor of colorSet) {
            if (color.equals(existingColor)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Compare two sets for equality.
     * 
     * @private
     */
    _setsEqual(setA, setB) {
        if (setA.size !== setB.size) return false;
        for (const item of setA) {
            if (!setB.has(item)) return false;
        }
        return true;
    }
    
    /**
     * Clear the view state.
     */
    clear() {
        this._clearArrowObjects();
        this._disposeThreeMesh();
        this.segments = [];
        this.faceLabels = [];
        this.faceColors.clear();
        this.currentEdgeIndices.clear();
        this.initialState.clear();
        this.edgeLabels = new Uint8Array(0);
        this.workingAnnotation = null;
        this.history.clear();
    }
    
    /**
     * Dispose of resources.
     */
    dispose() {
        this.clear();
    }
    
    // ========================================
    // State Metadata (for compatibility)
    // ========================================
    
    /**
     * Get the current state index.
     * @returns {number}
     */
    getCurrentStateIndex() {
        return this.history.getCurrentIndex();
    }
    
    /**
     * Get metadata for the current state.
     * @returns {Object}
     */
    getCurrentStateMetadata() {
        // Read from workingAnnotation (source of truth), not history
        return this.workingAnnotation?.metadata || {};
    }
    
    /**
     * Get metadata for a specific state.
     * @param {number} stateIndex
     * @returns {Object}
     */
    getStateMetadata(stateIndex) {
        return this.history.getStateMetadata(stateIndex);
    }
    
    /**
     * Set metadata for the current annotation.
     * 
     * Architecture: workingAnnotation.metadata is THE source of truth.
     * This updates it directly. History snapshots are storage, not live state.
     * 
     * @param {string} key - Metadata key
     * @param {*} value - Metadata value
     */
    setCurrentStateMetadata(key, value) {
        if (this.workingAnnotation) {
            this.workingAnnotation.metadata[key] = value;
            this.workingAnnotation.metadata.modifiedAt = Date.now();
            this._syncMetadataToLibrary();
        }
    }

    /**
     * Update multiple metadata keys for the current annotation.
     * @param {Object} updates - Key-value pairs to update
     */
    updateCurrentStateMetadata(updates) {
        if (this.workingAnnotation) {
            Object.assign(this.workingAnnotation.metadata, updates);
            this.workingAnnotation.metadata.modifiedAt = Date.now();
            this._syncMetadataToLibrary();
        }
    }

    /**
     * Delete a metadata key from the current annotation.
     * @param {string} key - Key to delete
     * @returns {boolean} True if key existed and was deleted
     */
    deleteCurrentStateMetadata(key) {
        if (this.workingAnnotation && key in this.workingAnnotation.metadata) {
            delete this.workingAnnotation.metadata[key];
            this.workingAnnotation.metadata.modifiedAt = Date.now();
            this._syncMetadataToLibrary();
            return true;
        }
        return false;
    }

    /**
     * Sync current annotation metadata to the library entry (if one exists).
     * @private
     */
    _syncMetadataToLibrary() {
        if (!this.annotationLibrary || !this.workingAnnotation) return;
        const id = this.workingAnnotation.id;
        if (this.annotationLibrary.has(id)) {
            this.annotationLibrary.update(id, this.getAnnotation());
        }
    }
}
