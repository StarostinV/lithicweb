import { standardizePositions } from './standardizePositions.js';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';


export class MeshObject {
    constructor(scene, drawColor, objectColor, light) {
        this.scene = scene;
        this.mesh = null;
        this.meshColors = null;
        this.drawColor = drawColor;
        this.objectColor = objectColor;
        this.light = light;
    }

    isNull() {
        return this.mesh === null;
    }

    clear() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
            this.meshColors = null;
        }
    }

    setMesh(geometry) {
        let positions = geometry.attributes.position.array;
        positions = standardizePositions(positions); // Apply standardization
        const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
        const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);

        // Remove existing mesh if it exists
        this.clear();

        // Create new BufferGeometry and set attributes
        const standardizedGeometry = new THREE.BufferGeometry();
        standardizedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        standardizedGeometry.setIndex(indices);
        standardizedGeometry.computeVertexNormals();

        this.meshColors = new Float32Array(positions.length);
        if (labels.length > 0) {
            for (let i = 0; i < labels.length; i++) {
                if (labels[i] === 1) {
                    this.meshColors[i * 3] = this.drawColor.r;
                    this.meshColors[i * 3 + 1] = this.drawColor.g;
                    this.meshColors[i * 3 + 2] = this.drawColor.b;
                } else {
                    this.meshColors[i * 3] = this.objectColor.r;
                    this.meshColors[i * 3 + 1] = this.objectColor.g;
                    this.meshColors[i * 3 + 2] = this.objectColor.b;
                }
            }
        } else {
            for (let i = 0; i < this.meshColors.length; i += 3) {
                this.meshColors[i] = this.objectColor.r;
                this.meshColors[i + 1] = this.objectColor.g;
                this.meshColors[i + 2] = this.objectColor.b;
            }
        }


        standardizedGeometry.setAttribute('color', new THREE.BufferAttribute(this.meshColors, 3));

        let material = new THREE.MeshLambertMaterial({
            vertexColors: true, // Enable per-vertex coloring
        });

        // Create mesh with the new geometry and material
        this.mesh = new THREE.Mesh(standardizedGeometry, material);

        this.mesh.castShadow = true; // Enable shadow casting for this object
        this.mesh.receiveShadow = true; // Enable shadow receiving for this object
        this.light.target = this.mesh;

        const bvh = new MeshBVH(standardizedGeometry);
        standardizedGeometry.boundsTree = bvh;
        this.scene.add(this.mesh);
    }
}