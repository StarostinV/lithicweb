import * as THREE from 'three';
import { IntersectFinder } from './intersections.js';
import { PathFinder } from './PathFinder.js';
import { createThreeMesh } from '../utils/meshUtils.js';
import { buildAdjacencyGraph } from '../utils/graphUtils.js';
import { MeshSegmenter } from './segmentation.js';
import { ActionHistory } from '../utils/ActionHistory.js';

export class MeshObject {
    constructor(scene, edgeColor, objectColor) {
        this.scene = scene;
        this.mesh = null;
        this.meshColors = null;
        this.edgeColor = edgeColor;
        this.objectColor = objectColor;
        this.intersectFinder = new IntersectFinder(scene);
        this.positions = [];
        this.faceLabels = [];
        this.edgeLabels = [];
        this.indices = [];
        this.adjacencyGraph = null;
        this.segments = [];
        this.faceColors = new Map();
        this.pathFinder = new PathFinder(this);
        this.segmenter = new MeshSegmenter(this);
        this.showSegments = true;
        this.history = new ActionHistory();
        this.isRestoringState = false; // Flag to prevent recording during restore
        this.pendingAction = null; // Store state before draw operation
        this.currentEdgeIndices = new Set(); // Track edge indices in real-time
        this.initialState = new Set(); // Store the loaded mesh's initial state

        this.invertMeshNormals = this.invertMeshNormals.bind(this);

        document.getElementById('invertNormals').addEventListener('click', () => {
            this.invertMeshNormals();
        });

        document.getElementById('update-segments').addEventListener('click', () => {
            if (this.showSegments) {
                this.updateSegments();
            }
        });

        document.getElementById('update-segment-colors').addEventListener('click', () => {
            this.regenerateColors();
        });

        document.getElementById('show-segments').addEventListener('click', () => {
            this.showSegments = !this.showSegments;
            if (!this.showSegments) {
                document.getElementById('update-segment-colors').disabled = true;
            } else {
                document.getElementById('update-segment-colors').disabled = false;
                if (!document.getElementById('auto-segments').checked) {
                    this.updateSegments();
                }
            }
            this.updateSegmentColors();
        });

        document.getElementById('auto-segments').addEventListener('click', () => {
            if (document.getElementById('show-segments').checked) {
                this.updateSegments();
            }
        });
    }

    isNull() {
        return this.mesh === null;
    }

    clear() {
        if (this.mesh) {
            this.scene.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
            this.meshColors = null;
        }
        this.history.clear();
    }

    invertMeshNormals() {
        const indices = this.indices;

        for (let i = 0; i < indices.length; i += 3) {
            const temp = indices[i];
            indices[i] = indices[i + 1];
            indices[i + 1] = temp;
        }

        this.setMesh(this.positions, this.edgeLabels, indices);
    }

    setMesh(positions, labels, indices) {
        // if labels is empty, set all to 0
        if (labels.length === 0) {
            labels = new Uint8Array(positions.length / 3).fill(0);
        }

        this.positions = positions;
        this.edgeLabels = labels;
        this.indices = indices;

        // Remove existing mesh if it exists
        this.clear();

        // Initialize currentEdgeIndices from labels
        this.currentEdgeIndices = new Set();
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === 1) {
                this.currentEdgeIndices.add(i);
            }
        }

        // Save initial state (loaded mesh state)
        this.initialState = new Set(this.currentEdgeIndices);

        // Create new mesh using utility function
        const { mesh, meshColors } = createThreeMesh(
            positions,
            labels,
            indices,
            this.edgeColor,
            this.objectColor
        );

        this.mesh = mesh;
        this.meshColors = meshColors;
        this.scene.light.target = this.mesh;
        this.scene.scene.add(this.mesh);

        // Build adjacency graph after setting the mesh
        this.adjacencyGraph = buildAdjacencyGraph(indices, positions.length / 3);
        this.updateSegments();
        this.checkMeshConnectivity();
    }

    updateSegments() {
        const previousFaceLabels = [...this.faceLabels];
        const newSegments = this.segmenter.segmentMesh();
        const { faceLabels, faceColors } = this.segmenter.updateSegmentColors(newSegments, previousFaceLabels);
        
        this.faceLabels = faceLabels;
        this.faceColors = faceColors;
        this.segments = newSegments;

        if (!this.showSegments) {
            this.colorSegmentsObjectColor();
        }
    }

    getClickedPoint(event) {
        return this.intersectFinder.getClickedPoint(this.mesh, event);
    }

    getClickedFace(event) {
        return this.intersectFinder.getClickedFace(this.mesh, event);
    }

    getClosestVertexIndex(event) {
        const [intersectPoint, faceIndex, closestVertexIndex] = this.intersectFinder.getClosestVertexIndex(this.mesh, event);
        return closestVertexIndex;
    }

    indexToVertex(vertexIndex) {
        return new THREE.Vector3().fromArray(this.mesh.geometry.attributes.position.array.slice(vertexIndex * 3, vertexIndex * 3 + 3));    
    }

    getVerticesWithinRadius(event, radius) {
        return this.intersectFinder.getVerticesWithinRadius(this.mesh, event, radius);
    }

    getAllIntersectionInfo(event) {
        const [intersectPoint, faceIndex, closestVertexIndex] = this.intersectFinder.getClosestVertexIndex(this.mesh, event);
        if (closestVertexIndex === -1) return [-1, -1, -1, -1, -1];
        const vertexNormal = this.getVertexNormal(closestVertexIndex);
        const vertex = this.indexToVertex(closestVertexIndex);
        return [intersectPoint, faceIndex, vertexNormal, closestVertexIndex, vertex]
    }

    getVertexNormal(vertexIndex) {
        if (vertexIndex === -1) {
            return -1;
        }
        const geometry = this.mesh.geometry;

        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
    
        // Access the normals attribute
        const vertexNormal = new THREE.Vector3().fromArray(
            geometry.attributes.normal.array.slice(vertexIndex * 3, vertexIndex * 3 + 3)
        );

        return vertexNormal;
        
    }

    addEdgeVertex(vertexIndex) {
        // Capture state before first modification in a drawing operation
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('draw');
        }
        
        this.edgeLabels[vertexIndex] = 1;
        this.faceLabels[vertexIndex] = 0;
        this.colorVertex(vertexIndex, this.edgeColor);
        
        // Track in real-time (only if not restoring)
        if (!this.isRestoringState) {
            this.currentEdgeIndices.add(vertexIndex);
        }
    }

    addEdgeVertices(vertexIndices) {
        // Capture state before first modification in a drawing operation
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('draw');
        }
        
        vertexIndices.forEach(index => {
            this.edgeLabels[index] = 1;
            this.faceLabels[index] = 0;
            this.colorVertex(index, this.edgeColor);
            
            // Track in real-time (only if not restoring)
            if (!this.isRestoringState) {
                this.currentEdgeIndices.add(index);
            }
        });
    }

    removeEdgeVertex(vertexIndex) {
        // Capture state before first modification in an erase operation
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('erase');
        }
        
        this.edgeLabels[vertexIndex] = 0;
        this.colorVertex(vertexIndex, this.objectColor);
        
        // Track in real-time (only if not restoring)
        if (!this.isRestoringState) {
            this.currentEdgeIndices.delete(vertexIndex);
        }
    }

    removeEdgeVertices(vertexIndices) {
        // Capture state before first modification in an erase operation
        if (!this.isRestoringState && this.pendingAction === null) {
            this.startDrawOperation('erase');
        }
        
        vertexIndices.forEach(index => {
            this.edgeLabels[index] = 0;
            this.colorVertex(index, this.objectColor);
            
            // Track in real-time (only if not restoring)
            if (!this.isRestoringState) {
                this.currentEdgeIndices.delete(index);
            }
        });
    }

    colorVertices(vertexIndices, color) {
        vertexIndices.forEach(index => colorVertex(index, color, this.meshColors));
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }

    colorVertex(vertexIndex, color) {
        colorVertex(vertexIndex, color, this.meshColors);
        this.mesh.geometry.attributes.color.needsUpdate = true;
    }

    onDrawFinished() {
        // Finalize the history action when drawing is complete
        if (!this.isRestoringState && this.pendingAction !== null) {
            this.finishDrawOperation();
        }
        
        if (document.getElementById('auto-segments').checked) {
            this.updateSegments();
        }
    }

    // Start tracking a draw operation
    startDrawOperation(actionType) {
        this.pendingAction = {
            type: actionType,
            // Clone the current set (O(E) where E = number of edges, not O(V))
            previousState: new Set(this.currentEdgeIndices)
        };
    }

    // Finish tracking and save to history
    finishDrawOperation() {
        if (this.pendingAction === null) return;

        // Use the current tracked set (O(1) access, not O(V) iteration)
        const currentState = new Set(this.currentEdgeIndices);
        
        // Only save if there were actual changes
        if (!this.setsEqual(this.pendingAction.previousState, currentState)) {
            this.history.push({
                type: this.pendingAction.type,
                previousState: this.pendingAction.previousState,
                newState: currentState,
                timestamp: Date.now(),
                description: this.pendingAction.type === 'draw' ? 'Draw edges' : 'Erase edges'
            });
        }

        this.pendingAction = null;
    }

    // Restore state from edge indices
    restoreEdgeState(edgeIndices) {
        this.isRestoringState = true;
        
        // Clear all edges (iterate only current edge indices, not all vertices)
        this.currentEdgeIndices.forEach(index => {
            this.edgeLabels[index] = 0;
            this.colorVertex(index, this.objectColor);
        });
        
        // Update tracked set
        this.currentEdgeIndices.clear();
        
        // Restore specified edges
        edgeIndices.forEach(index => {
            this.edgeLabels[index] = 1;
            this.colorVertex(index, this.edgeColor);
            this.currentEdgeIndices.add(index);
        });
        
        this.isRestoringState = false;
    }

    // Undo last action
    undo() {
        const action = this.history.undo();
        if (action) {
            this.restoreEdgeState(action.previousState);
            if (document.getElementById('auto-segments').checked) {
                this.updateSegments();
            }
            return true;
        }
        return false;
    }

    // Redo last undone action
    redo() {
        const action = this.history.redo();
        if (action) {
            this.restoreEdgeState(action.newState);
            if (document.getElementById('auto-segments').checked) {
                this.updateSegments();
            }
            return true;
        }
        return false;
    }

    // Jump to view a specific state without modifying history
    jumpToState(targetIndex) {
        const currentIndex = this.history.getCurrentIndex();
        
        if (targetIndex === currentIndex) {
            return; // Already viewing this state
        }

        // Determine target state
        let targetState = null;
        
        if (targetIndex === 0) {
            // Jump to initial state (loaded mesh state)
            targetState = this.initialState;
        } else if (targetIndex <= this.history.undoStack.length) {
            // Target is in undo stack
            targetState = this.history.undoStack[targetIndex - 1].newState;
        } else {
            // Target is in redo stack
            const redoIndex = targetIndex - this.history.undoStack.length - 1;
            targetState = this.history.redoStack[this.history.redoStack.length - 1 - redoIndex].newState;
        }

        if (targetState) {
            // Update view index (doesn't modify stacks)
            this.history.jumpToViewState(targetIndex);
            
            // Apply the target state visually
            this.restoreEdgeState(targetState);
            
            if (document.getElementById('auto-segments').checked) {
                this.updateSegments();
            }
        }
    }

    // Helper to compare two sets
    setsEqual(setA, setB) {
        if (setA.size !== setB.size) return false;
        for (const item of setA) {
            if (!setB.has(item)) return false;
        }
        return true;
    }

    updateSegmentColors() {
        if (this.showSegments) {
            this.colorSegmentsFaceColor();
        } else {
            this.colorSegmentsObjectColor();
        }
    }

    colorSegmentsFaceColor() {
        this.segments.forEach((segment, index) => {
            segment.forEach(vertexIndex => this.colorVertex(vertexIndex, this.faceColors.get(index + 1)));
        });
    }

    colorSegmentsObjectColor() {
        this.segments.forEach(segment => {
            segment.forEach(vertexIndex => this.colorVertex(vertexIndex, this.objectColor));
        });
    }

    regenerateColors() {
        const usedColors = new Set();
        usedColors.add(this.objectColor);
        const newFaceColors = new Map();

        // Find largest segment ID
        let largestSegmentId = null;
        let maxSize = 0;
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            if (segment.length > maxSize) {
                maxSize = segment.length;
                largestSegmentId = segmentId;
            }
        });

        // Assign new random colors to each segment
        this.segments.forEach((segment, index) => {
            const segmentId = index + 1;
            
            // Keep objectColor for largest segment
            if (segmentId === largestSegmentId) {
                newFaceColors.set(segmentId, this.objectColor);
                return;
            }

            // Generate new random color for other segments
            const color = generateUniqueColor(usedColors);
            usedColors.add(color);
            newFaceColors.set(segmentId, color);

            // Update vertex colors
            segment.forEach(vertexIndex => {
                this.colorVertex(vertexIndex, color);
            });
        });

        this.faceColors = newFaceColors;
    }

    findShortestPath(startVertex, endVertex) {
        return this.pathFinder.findShortestPath(startVertex, endVertex);
    }

    areVerticesConnected(vertex1, vertex2) {
        if (!this.adjacencyGraph) return false;
        return this.adjacencyGraph.get(vertex1).has(vertex2);
    }

    createConnectedPath(vertices) {
        if (!vertices || vertices.length < 2) return vertices;

        const connectedPath = [vertices[0]];
        
        for (let i = 1; i < vertices.length; i++) {
            const currentVertex = vertices[i];
            const previousVertex = vertices[i - 1];

            // check if vertices are valid, i.e. integers within the range of edgeLabels
            if (previousVertex < 0 || previousVertex >= this.edgeLabels.length || currentVertex < 0 || currentVertex >= this.edgeLabels.length) {
                console.warn("Invalid vertex indices in createConnectedPath", previousVertex, currentVertex);
                continue;
            }

            if (this.areVerticesConnected(previousVertex, currentVertex)) {
                // If vertices are directly connected, just add the current vertex
                connectedPath.push(currentVertex);
            } else {
                // Find path between vertices and add all intermediate vertices
                const path = this.pathFinder.findShortestPath(previousVertex, currentVertex);
                // Skip first vertex as it's already in the path
                connectedPath.push(...path.slice(1));
            }
        }

        return connectedPath;
    }

    checkMeshConnectivity() {
        const totalVertices = this.positions.length / 3;
        const usedVertices = new Set(this.indices);
        
        const unusedVertices = [];
        for (let i = 0; i < totalVertices; i++) {
            if (!usedVertices.has(i)) {
                unusedVertices.push(i);
            }
        }

        if (unusedVertices.length > 0) {
            console.warn(`Found ${unusedVertices.length} isolated vertices:`, unusedVertices);
            return false;
        }

        console.log('Mesh is fully connected - all vertices are used in triangles');
        return true;
    }
}


function colorVertex(vertexIndex, color, meshColors) {
    meshColors[vertexIndex * 3] = color.r; // R
    meshColors[vertexIndex * 3 + 1] = color.g; // G
    meshColors[vertexIndex * 3 + 2] = color.b; // B
}

function colorExistsInSet(color, colorSet) {
    for (const existingColor of colorSet) {
        if (color.equals(existingColor)) {
            return true;
        }
    }
    return false;
}

function generateUniqueColor(usedColors) {
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
        // Break loop if we can't find a unique color after many attempts
        if (attempts > maxAttempts) {
            console.warn('Could not generate unique color after ' + maxAttempts + ' attempts');
            break;
        }
    } while (colorExistsInSet(newColor, usedColors));

    return newColor;
}