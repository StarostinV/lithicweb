import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { standardizePositions } from '../geometry/standardizePositions.js';

export function createThreeMesh(positions, labels, indices, edgeColor, objectColor) {
    // Create new BufferGeometry and set attributes
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(standardizePositions(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const meshColors = createMeshColors(positions.length, labels, edgeColor, objectColor);
    geometry.setAttribute('color', new THREE.BufferAttribute(meshColors, 3));

    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
    });

    // Create mesh with the new geometry and material
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Create BVH
    const bvh = new MeshBVH(geometry);
    geometry.boundsTree = bvh;

    return { mesh, meshColors };
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
