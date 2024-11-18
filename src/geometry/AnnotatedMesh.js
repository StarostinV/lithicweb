import { BasicMesh } from './BasicMesh.js';
import { PathFinder } from './PathFinder.js';
import { MeshSegmenter } from './segmentation.js';

export class AnnotatedMesh extends BasicMesh {
    constructor(scene, edgeColor, objectColor) {
        super(scene);
        this.edgeColor = edgeColor;
        this.objectColor = objectColor;
        this.meshColors = null;
        this.edgeLabels = [];
        this.faceLabels = [];
        this.segments = [];
        this.faceColors = new Map();
        this.pathFinder = new PathFinder(this);
        this.segmenter = new MeshSegmenter(this);

        this.setupEventListeners();
    }

    clear() {
        super.clear();
        this.segments = [];
        this.faceLabels = [];
        this.edgeLabels = [];
        this.meshColors = null;
        this.faceColors.clear();
    }

    setupEventListeners() {
        document.getElementById('invertNormals').addEventListener('click', () => {
            this.invertMeshNormals();
        });

        document.getElementById('update-segments').addEventListener('click', () => {
            this.updateSegments();
        });

        document.getElementById('update-segment-colors').addEventListener('click', () => {
            this.regenerateColors();
        });
    }

    setMesh(positions, labels, indices) {
        if (labels.length === 0) {
            labels = new Uint8Array(positions.length / 3).fill(0);
        }

        this.edgeLabels = labels;
        super.setMesh(positions, indices);
        this.updateSegments();
    }

    updateSegments() {
        const previousFaceLabels = [...this.faceLabels];
        const newSegments = this.segmenter.segmentMesh();
        const { faceLabels, faceColors } = this.segmenter.updateSegmentColors(
            newSegments, 
            previousFaceLabels
        );
        
        this.faceLabels = faceLabels;
        this.faceColors = faceColors;
        this.segments = newSegments;
    }

    addEdgeVertex(vertexIndex) {
        this.edgeLabels[vertexIndex] = 1;
        this.colorVertex(vertexIndex, this.edgeColor);
    }

    addEdgeVertices(vertexIndices) {
        vertexIndices.forEach(index => {
            this.edgeLabels[index] = 1;
            this.colorVertex(index, this.edgeColor);
        });
    }

    removeEdgeVertex(vertexIndex) {
        this.edgeLabels[vertexIndex] = 0;
        this.colorVertex(vertexIndex, this.objectColor);
    }

    removeEdgeVertices(vertexIndices) {
        vertexIndices.forEach(index => {
            this.edgeLabels[index] = 0;
            this.colorVertex(index, this.objectColor);
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
        if (document.getElementById('auto-segments').checked) {
            this.updateSegments();
        }
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