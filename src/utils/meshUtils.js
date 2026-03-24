import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { standardizePositions } from '../geometry/standardizePositions.js';

// ========================================
// Fine-grained mesh creation utilities
// ========================================

/**
 * Create a BufferGeometry from positions and indices.
 * Does NOT include colors - those are view-specific.
 * Includes BVH for efficient raycasting.
 *
 * @param {Float32Array} positions - Vertex positions (x, y, z triplets)
 * @param {Array} indices - Face indices (triangles)
 * @returns {THREE.BufferGeometry} Geometry with positions, normals, and BVH
 */
export function createGeometry(positions, indices) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(standardizePositions(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Create BVH for efficient raycasting
    const bvh = new MeshBVH(geometry);
    geometry.boundsTree = bvh;

    return geometry;
}

/**
 * Create a color buffer filled with a single color.
 * 
 * @param {number} vertexCount - Number of vertices
 * @param {THREE.Color} color - Default color
 * @returns {Float32Array} Color buffer (r, g, b triplets)
 */
export function createColorBuffer(vertexCount, color) {
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    return colors;
}

/**
 * Create a color buffer from edge labels.
 * 
 * @param {Uint8Array|Array} labels - Edge labels (1 = edge, 0 = not edge)
 * @param {THREE.Color} edgeColor - Color for edge vertices
 * @param {THREE.Color} objectColor - Color for non-edge vertices
 * @returns {Float32Array} Color buffer
 */
export function createColorBufferFromLabels(labels, edgeColor, objectColor) {
    const colors = new Float32Array(labels.length * 3);
    for (let i = 0; i < labels.length; i++) {
        const color = labels[i] === 1 ? edgeColor : objectColor;
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    return colors;
}

/**
 * Create a Three.js mesh from geometry with a color buffer.
 *
 * @param {THREE.BufferGeometry} geometry - The geometry (will be used directly, not cloned)
 * @param {Float32Array} colorBuffer - Color buffer to use
 * @returns {THREE.Mesh} The Three.js mesh
 */
export function createMeshFromGeometry(geometry, colorBuffer) {
    // Clone geometry so each mesh can have its own color attribute
    const meshGeometry = geometry.clone();
    meshGeometry.setAttribute('color', new THREE.BufferAttribute(colorBuffer, 3));

    // Copy BVH reference to cloned geometry
    if (geometry.boundsTree) {
        meshGeometry.boundsTree = geometry.boundsTree;
    }

    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
    });

    const mesh = new THREE.Mesh(meshGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
}
