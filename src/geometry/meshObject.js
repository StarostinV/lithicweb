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

    setMesh(positions, labels, indices) {

        // Remove existing mesh if it exists
        this.clear();

        // Create new BufferGeometry and set attributes
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        this.meshColors = createMeshColors(positions.length, labels, this.drawColor, this.objectColor);

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