import * as THREE from 'three';
import { createGeometry } from '../utils/meshUtils.js';
import { buildAdjacencyGraph } from '../utils/graphUtils.js';
import { computeVertexMaxAngles as computeAngles } from './edgeAngles.js';

/**
 * BasicMesh - Pure geometry container with mesh-level metadata.
 * 
 * Holds:
 * - Geometry: positions, indices, adjacencyGraph, geometry
 * - Mesh metadata: author, scan_date, source info (shared by all annotations)
 * - Geometric query methods
 * - Cached computed properties (e.g., vertex max angles)
 * 
 * This class does NOT hold annotation data (edgeLabels, arrows, etc.) - 
 * that lives in the Annotation class and is managed by MeshView.
 * 
 * @example
 * const mesh = new BasicMesh();
 * mesh.setMesh(positions, indices, { author: 'John', scanDate: '2024-01-01' });
 * mesh.setMetadata('version', '1.0');
 */
export class BasicMesh {
    constructor() {
        this.geometry = null;
        this.positions = [];
        this.indices = [];
        this.adjacencyGraph = null;
        
        /**
         * Mesh-level metadata (shared by all annotations on this mesh).
         * Examples: author, scan_date, source_file, mesh_version
         * This is distinct from annotation metadata which is per-annotation.
         * @type {Object}
         */
        this.metadata = {};
        
        /**
         * Cached vertex max angles (computed on demand).
         * @type {Float32Array|null}
         * @private
         */
        this._vertexMaxAngles = null;

        /**
         * Cached bounding info (computed on demand, invalidated on setMesh).
         * @type {{center: {x,y,z}, size: {x,y,z}, diagonal: number}|null}
         * @private
         */
        this._boundingInfo = null;

    }

    isNull() {
        return this.geometry === null;
    }

    /**
     * Clear the mesh and reset state.
     */
    clear() {
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        this.adjacencyGraph = null;
        this.metadata = {};
        this._vertexMaxAngles = null;
        this._boundingInfo = null;
    }

    /**
     * Set the mesh geometry.
     *
     * @param {Float32Array} positions - Vertex positions (x, y, z triplets)
     * @param {Array} indices - Face indices (triangles)
     * @param {Object} [metadata={}] - Optional mesh-level metadata
     */
    setMesh(positions, indices, metadata = {}) {
        this.positions = positions;
        this.indices = indices;

        // Remove existing mesh if it exists
        this.clear();

        // Set metadata after clear() since clear() resets it
        this.metadata = { ...metadata };

        // Create new geometry (view will create a mesh from it)
        this.geometry = createGeometry(positions, indices);

        // Build adjacency graph after setting the mesh
        this.adjacencyGraph = buildAdjacencyGraph(indices, positions.length / 3);
        this.checkMeshConnectivity();
    }
    
    // ========================================
    // Mesh Metadata Methods
    // ========================================
    
    /**
     * Get a specific metadata value by key.
     * @param {string} key - The metadata key to retrieve
     * @returns {*} The metadata value, or undefined if not found
     */
    getMetadata(key) {
        return this.metadata[key];
    }
    
    /**
     * Set a specific metadata value.
     * @param {string} key - The metadata key to set
     * @param {*} value - The value to set
     */
    setMetadata(key, value) {
        this.metadata[key] = value;
    }
    
    /**
     * Get all metadata as an object.
     * @returns {Object} Copy of all metadata key-value pairs
     */
    getAllMetadata() {
        return { ...this.metadata };
    }
    
    /**
     * Update multiple metadata values at once.
     * @param {Object} updates - Object containing key-value pairs to update
     */
    updateMetadata(updates) {
        this.metadata = { ...this.metadata, ...updates };
    }
    
    /**
     * Clear all metadata.
     */
    clearMetadata() {
        this.metadata = {};
    }
    
    /**
     * Delete a specific metadata key.
     * @param {string} key - The metadata key to delete
     * @returns {boolean} True if the key existed and was deleted
     */
    deleteMetadata(key) {
        if (key in this.metadata) {
            delete this.metadata[key];
            return true;
        }
        return false;
    }
    
    /**
     * Check if a metadata key exists.
     * @param {string} key - The metadata key to check
     * @returns {boolean} True if the key exists
     */
    hasMetadata(key) {
        return key in this.metadata;
    }

    invertMeshNormals() {
        const indices = this.indices;
        const currentMetadata = { ...this.metadata };
        for (let i = 0; i < indices.length; i += 3) {
            const temp = indices[i];
            indices[i] = indices[i + 1];
            indices[i + 1] = temp;
        }
        this.setMesh(this.positions, indices, currentMetadata);
    }

    indexToVertex(vertexIndex) {
        if (!this.geometry?.attributes?.position) return null;
        return new THREE.Vector3().fromBufferAttribute(
            this.geometry.attributes.position,
            vertexIndex
        );    
    }

    getVertexNormal(vertexIndex) {
        if (vertexIndex === -1 || !this.geometry) return -1;
        
        if (!this.geometry.attributes.normal) {
            this.geometry.computeVertexNormals();
        }
    
        return new THREE.Vector3().fromArray(
            this.geometry.attributes.normal.array.slice(vertexIndex * 3, vertexIndex * 3 + 3)
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
    
    // ========================================
    // Computed Geometry Properties (Cached)
    // ========================================
    
    /**
     * Get the maximum dihedral angle at each vertex.
     * Computed on first call and cached for subsequent calls.
     * 
     * The dihedral angle is the angle between adjacent faces sharing an edge.
     * Vertices on sharp features will have high maximum angles.
     * 
     * @returns {Float32Array|null} Maximum angle (in radians) at each vertex, or null if no mesh
     */
    getVertexMaxAngles() {
        if (this.isNull()) return null;
        
        // Return cached result if available
        if (this._vertexMaxAngles !== null) {
            return this._vertexMaxAngles;
        }
        
        // Compute and cache
        console.time('BasicMesh: computeVertexMaxAngles');
        this._vertexMaxAngles = computeAngles(this.positions, this.indices);
        console.timeEnd('BasicMesh: computeVertexMaxAngles');
        
        return this._vertexMaxAngles;
    }
    
    /**
     * Check if vertex max angles have been computed and cached.
     * @returns {boolean} True if angles are cached
     */
    hasVertexMaxAngles() {
        return this._vertexMaxAngles !== null;
    }
    
    /**
     * Clear the cached vertex max angles (forces recomputation on next call).
     */
    clearVertexMaxAnglesCache() {
        this._vertexMaxAngles = null;
    }

    /**
     * Compute bounding box info from positions.
     * Cached — invalidated when setMesh() is called.
     *
     * @returns {{center: {x: number, y: number, z: number}, size: {x: number, y: number, z: number}, diagonal: number}}
     */
    computeBoundingInfo() {
        if (this._boundingInfo) return this._boundingInfo;

        const positions = this.positions;
        if (!positions || positions.length === 0) {
            this._boundingInfo = {
                center: { x: 0, y: 0, z: 0 },
                size: { x: 0, y: 0, z: 0 },
                diagonal: 1
            };
            return this._boundingInfo;
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i], y = positions[i + 1], z = positions[i + 2];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        const sx = maxX - minX;
        const sy = maxY - minY;
        const sz = maxZ - minZ;
        let diagonal = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (diagonal < 1e-10) diagonal = 1;

        this._boundingInfo = {
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
            size: { x: sx, y: sy, z: sz },
            diagonal
        };
        return this._boundingInfo;
    }
} 