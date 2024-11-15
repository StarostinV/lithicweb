import { standardizePositions } from './standardizePositions.js';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { IntersectFinder } from './intersections.js';

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

        this.invertMeshNormals = this.invertMeshNormals.bind(this);

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
        this.positions = positions;
        this.edgeLabels = labels;
        this.indices = indices;

        // Remove existing mesh if it exists
        this.clear();

        // Create new BufferGeometry and set attributes
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(standardizePositions(this.positions), 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        this.meshColors = createMeshColors(this.positions.length, labels, this.edgeColor, this.objectColor);

        geometry.setAttribute('color', new THREE.BufferAttribute(this.meshColors, 3));

        let material = new THREE.MeshLambertMaterial({
            vertexColors: true, // Enable per-vertex coloring
            // transparent: true, // Enable transparency
            // opacity: 0.95, // Fully opaque initially
        });

        // Create mesh with the new geometry and material
        this.mesh = new THREE.Mesh(geometry, material);

        this.mesh.castShadow = true; // Enable shadow casting for this object
        this.mesh.receiveShadow = true; // Enable shadow receiving for this object
        this.scene.light.target = this.mesh;

        const bvh = new MeshBVH(geometry);
        geometry.boundsTree = bvh;
        this.scene.scene.add(this.mesh);

        // Build adjacency graph after setting the mesh
        this.buildAdjacencyGraph();
        this.updateSegments();
    }

    buildAdjacencyGraph() {
        const graph = new Map();
        
        // Create vertices entries
        for (let i = 0; i < this.positions.length / 3; i++) {
            graph.set(i, new Set());
        }
        
        // Add edges from triangles
        for (let i = 0; i < this.indices.length; i += 3) {
            const v1 = this.indices[i];
            const v2 = this.indices[i + 1];
            const v3 = this.indices[i + 2];
            
            graph.get(v1).add(v2).add(v3);
            graph.get(v2).add(v1).add(v3);
            graph.get(v3).add(v1).add(v2);
        }
        
        this.adjacencyGraph = graph;
    }

    updateSegments() {
        const previousFaceLabels = [...this.faceLabels];
        const newSegments = this.segmentMesh();
        
        // Find largest segment
        let largestSegmentIndex = 0;
        let maxSize = 0;
        newSegments.forEach((segment, index) => {
            if (segment.length > maxSize) {
                maxSize = segment.length;
                largestSegmentIndex = index;
            }
        });

        // Keep track of used colors
        const usedColors = new Set();
        usedColors.add(this.objectColor);

        // Update face colors map and labels
        const newFaceColors = new Map();
        newSegments.forEach((segment, index) => {
            const segmentId = index + 1;
            
            // For largest segment, use objectColor and ensure all vertices are colored properly
            if (index === largestSegmentIndex) {
                newFaceColors.set(segmentId, this.objectColor);
                segment.forEach(vertexIndex => {
                    this.faceLabels[vertexIndex] = segmentId;
                    this.colorVertex(vertexIndex, this.objectColor);
                });
                return;
            }

            // Try to match with previous segments
            let bestMatchId = null;
            let bestMatchScore = 0;
            
            if (previousFaceLabels.length > 0) {
                // Sample some vertices from current segment to find best matching previous segment
                const sampleSize = Math.min(100, segment.length);
                const samples = new Set(segment.slice(0, sampleSize));
                
                const previousIds = new Set(previousFaceLabels);
                previousIds.delete(0);  // Ignore unlabeled vertices
                
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
            }

            // Use previous color if good match found and color not already used, otherwise generate new color
            let color;
            if (bestMatchId && this.faceColors.has(bestMatchId)) {
                const previousColor = this.faceColors.get(bestMatchId);
                if (!colorExistsInSet(previousColor, usedColors)) {
                    color = previousColor;
                } else {
                    color = generateUniqueColor(usedColors);
                }
            } else {
                color = generateUniqueColor(usedColors);
            }
            
            usedColors.add(color);
            newFaceColors.set(segmentId, color);
            segment.forEach(vertexIndex => {
                this.faceLabels[vertexIndex] = segmentId;
                this.colorVertex(vertexIndex, color);
            });
        });

        this.faceColors = newFaceColors;
        this.segments = newSegments;
    }

    segmentMesh() {
        if (!this.adjacencyGraph) return [];

        // Use TypedArrays for better performance
        const visited = new Uint8Array(this.positions.length / 3);
        const segments = [];
        
        // Process chunks of vertices in parallel
        const chunkSize = 10000; // Adjust based on your needs
        const totalVertices = this.positions.length / 3;
        
        for (let startIdx = 0; startIdx < totalVertices; startIdx += chunkSize) {
            const endIdx = Math.min(startIdx + chunkSize, totalVertices);
            
            // Process each chunk
            for (let vertex = startIdx; vertex < endIdx; vertex++) {
                // Skip if visited or not labeled
                if (visited[vertex] || this.edgeLabels[vertex] !== 0) continue;
                
                const segment = this.floodFillOptimized(vertex, visited);
                if (segment.length > 0) {
                    segments.push(segment);
                }
            }
        }
        
        return segments;
    }

    floodFillOptimized(startVertex, visited) {
        // Pre-allocate arrays for better performance
        let segment = new Uint32Array(1000); // Changed to let
        let segmentSize = 0;
        
        // Use typed array for queue with larger initial size
        let queueArray = new Uint32Array(10000); // Changed to let, increased size
        let queueStart = 0;
        let queueEnd = 1;
        queueArray[0] = startVertex;
        
        while (queueStart < queueEnd) {
            const vertex = queueArray[queueStart++];
            
            if (visited[vertex]) continue;
            visited[vertex] = 1;
            
            if (this.edgeLabels[vertex] === 0) { // Note: changed to 0 to match your unlabeled vertices
                // Expand segment array if needed
                if (segmentSize >= segment.length) {
                    const newSegment = new Uint32Array(segment.length * 2);
                    newSegment.set(segment);
                    segment = newSegment;
                }
                segment[segmentSize++] = vertex;
                
                // Process neighbors
                const neighbors = this.adjacencyGraph.get(vertex);
                for (const neighbor of neighbors) {
                    if (!visited[neighbor] && this.edgeLabels[neighbor] === 0) {
                        // Expand queue if needed
                        if (queueEnd >= queueArray.length) {
                            const newQueue = new Uint32Array(queueArray.length * 2);
                            newQueue.set(queueArray);
                            queueArray = newQueue;
                        }
                        queueArray[queueEnd++] = neighbor;
                    }
                }
            }
        }
        
        // Return only the used portion of the segment array
        return new Uint32Array(segment.buffer, 0, segmentSize);
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
}


function colorVertex(vertexIndex, color, meshColors) {
    meshColors[vertexIndex * 3] = color.r; // R
    meshColors[vertexIndex * 3 + 1] = color.g; // G
    meshColors[vertexIndex * 3 + 2] = color.b; // B
}


function createMeshColors(length, labels, drawColor, objectColor) {
    const meshColors = new Float32Array(length);
    if (labels.length > 0) {
        for (let i = 0; i < length; i++) {
            if (labels[i] === 1) {
                meshColors[i * 3] = drawColor.r;
                meshColors[i * 3 + 1] = drawColor.g;
                meshColors[i * 3 + 2] = drawColor.b;
            } else {
                meshColors[i * 3] = objectColor.r;
                meshColors[i * 3 + 1] = objectColor.g;
                meshColors[i * 3 + 2] = objectColor.b;
            }
        }
    } else {
        for (let i = 0; i < length; i += 3) {
            meshColors[i] = objectColor.r;
            meshColors[i + 1] = objectColor.g;
            meshColors[i + 2] = objectColor.b;
        }
    }
    return meshColors;
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