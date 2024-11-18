import * as THREE from 'three';
import { createThreeMesh } from '../utils/meshUtils.js';
import { buildAdjacencyGraph } from '../utils/graphUtils.js';
import { IntersectFinder } from './intersections.js';

export class BasicMesh {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.positions = [];
        this.indices = [];
        this.adjacencyGraph = null;
        this.intersectFinder = new IntersectFinder(scene);
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
        }
    }

    setMesh(positions, indices) {
        this.positions = positions;
        this.indices = indices;

        // Remove existing mesh if it exists
        this.clear();

        // Create new mesh using utility function
        const { mesh } = createThreeMesh(positions, indices);

        this.mesh = mesh;
        this.scene.light.target = this.mesh;
        this.scene.scene.add(this.mesh);

        // Build adjacency graph after setting the mesh
        this.adjacencyGraph = buildAdjacencyGraph(indices, positions.length / 3);
        this.checkMeshConnectivity();
    }

    invertMeshNormals() {
        const indices = this.indices;
        for (let i = 0; i < indices.length; i += 3) {
            const temp = indices[i];
            indices[i] = indices[i + 1];
            indices[i + 1] = temp;
        }
        this.setMesh(this.positions, indices);
    }

    // Geometric query methods
    getClickedPoint(event) {
        return this.intersectFinder.getClickedPoint(this.mesh, event);
    }

    getClickedFace(event) {
        return this.intersectFinder.getClickedFace(this.mesh, event);
    }

    getClosestVertexIndex(event) {
        const [, , closestVertexIndex] = this.intersectFinder.getClosestVertexIndex(this.mesh, event);
        return closestVertexIndex;
    }

    indexToVertex(vertexIndex) {
        return new THREE.Vector3().fromArray(
            this.mesh.geometry.attributes.position.array.slice(vertexIndex * 3, vertexIndex * 3 + 3)
        );    
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
        if (vertexIndex === -1) return -1;
        
        const geometry = this.mesh.geometry;
        if (!geometry.attributes.normal) {
            geometry.computeVertexNormals();
        }
    
        return new THREE.Vector3().fromArray(
            geometry.attributes.normal.array.slice(vertexIndex * 3, vertexIndex * 3 + 3)
        );
    }

    areVerticesConnected(vertex1, vertex2) {
        if (!this.adjacencyGraph) return false;
        return this.adjacencyGraph.get(vertex1).has(vertex2);
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