import { standardizePositions } from './standardizePositions.js';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { IntersectFinder } from './intersections.js';

export class MeshObject {
    constructor(scene, drawColor, objectColor) {
        this.scene = scene;
        this.mesh = null;
        this.meshColors = null;
        this.drawColor = drawColor;
        this.objectColor = objectColor;
        this.intersectFinder = new IntersectFinder(scene);
        this.positions = [];
        this.labels = [];
        this.indices = [];
        this.adjacencyGraph = null;
        this.segments = [];

        this.invertMeshNormals = this.invertMeshNormals.bind(this);

        document.getElementById('invertNormals').addEventListener('click', () => {
            this.invertMeshNormals();
        });

        document.getElementById('update-segments').addEventListener('click', () => {
            this.updateSegments();
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

        this.setMesh(this.positions, this.labels, indices);
    }

    setMesh(positions, labels, indices) {
        this.positions = positions;
        this.labels = labels;
        this.indices = indices;

        // Remove existing mesh if it exists
        this.clear();

        // Create new BufferGeometry and set attributes
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(standardizePositions(this.positions), 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        this.meshColors = createMeshColors(this.positions.length, labels, this.drawColor, this.objectColor);

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
        this.segments = [];
        // this.updateSegments();
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
        this.segments = this.segmentMesh();
        this.segments.forEach((segment) => {
            const color = new THREE.Color(Math.random(), Math.random(), Math.random());
            this.colorVertices(segment, color);
        });
    }

    segmentMesh() {
        if (!this.adjacencyGraph) return [];

        const visited = new Set();
        const segments = [];
        
        // Start flood-fill from each unvisited labeled vertex
        for (let vertex = 0; vertex < this.positions.length / 3; vertex++) {
            if (visited.has(vertex) || this.labels[vertex] !== 0) continue;
            
            const segment = this.floodFill(vertex, visited);
            if (segment.length > 0) {
                segments.push(segment);
            }
        }
        
        return segments;
    }

    floodFill(startVertex, visited) {
        const segment = [];
        const queue = [startVertex];
        
        while (queue.length > 0) {
            const vertex = queue.shift();
            
            if (visited.has(vertex)) continue;
            visited.add(vertex);
            
            if (this.labels[vertex] === 0) {
                segment.push(vertex);
                
                // Add unvisited labeled neighbors to queue
                for (const neighbor of this.adjacencyGraph.get(vertex)) {
                    if (!visited.has(neighbor) && this.labels[neighbor] === 0) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        return segment;
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

    labelVertices(vertexIndices, label) {
        vertexIndices.forEach(index => {
            this.labels[index] = label;
            colorVertex(index, color, this.meshColors);
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