/**
 * Annotation - Lightweight, serializable container for annotation data.
 * 
 * This is the "compressed" representation of an annotation. It holds only:
 * - edgeIndices: Set of vertex indices marked as edges
 * - arrows: Array of directional arrows between vertices
 * - metadata: Annotation-specific metadata (name, source, evaluation metrics, etc.)
 * 
 * It does NOT hold computed state like segments or faceLabels - those are
 * computed on-demand by MeshView when displaying the annotation.
 * 
 * ## Metadata Types
 * 
 * There are two types of metadata in the system:
 * - **Mesh metadata** (in BasicMesh.metadata): author, scan_date, source_file - shared by all annotations
 * - **Annotation metadata** (in Annotation.metadata): name, source, evaluation metrics - unique per annotation
 * 
 * When loading from PLY files, these are separated. When saving, they are combined.
 * 
 * @example
 * // Create from PLY data
 * const annotation = Annotation.fromEdgeLabels(labels, arrows, { name: 'Manual annotation' });
 * 
 * // Clone before modifying
 * const copy = annotation.clone();
 * 
 * // Serialize for cloud sync
 * const data = annotation.toSerializable();
 */
export class Annotation {
    /**
     * Create a new Annotation.
     * 
     * @param {Object} options - Annotation options
     * @param {string} [options.id] - Unique identifier (auto-generated if not provided)
     * @param {Set<number>|Array<number>} [options.edgeIndices] - Vertex indices marked as edges
     * @param {Array<{startIndex: number, endIndex: number}>} [options.arrows] - Directional arrows
     * @param {string} [options.name='Untitled'] - Display name
     * @param {string} [options.source='manual'] - Source: 'manual', 'model', or 'cloud'
     * @param {number} [options.createdAt] - Creation timestamp
     * @param {number} [options.modifiedAt] - Last modification timestamp
     * @param {Object} [options.metadata] - Additional metadata
     */
    constructor(options = {}) {
        this.id = options.id || crypto.randomUUID();
        
        // Compressed annotation data
        this.edgeIndices = new Set(options.edgeIndices || []);
        this.arrows = (options.arrows || []).map(a => ({ ...a })); // deep copy
        
        // Metadata - annotation-specific (NOT mesh metadata)
        this.metadata = {
            name: options.name || 'Untitled',
            source: options.source || 'manual', // 'manual' | 'model' | 'cloud'
            createdAt: options.createdAt || Date.now(),
            modifiedAt: options.modifiedAt || Date.now(),
            ...(options.metadata || {})
        };
    }
    
    /**
     * Create a deep clone of this annotation.
     * The clone keeps the same ID for tracking purposes.
     * 
     * @returns {Annotation} A deep copy of this annotation
     */
    clone() {
        return new Annotation({
            id: this.id,  // Keep same ID for tracking
            edgeIndices: new Set(this.edgeIndices),
            arrows: this.arrows.map(a => ({ ...a })),
            metadata: JSON.parse(JSON.stringify(this.metadata))
        });
    }
    
    /**
     * Clone this annotation with a new ID.
     * Use for "save as" operations where you want a distinct annotation.
     * 
     * @returns {Annotation} A deep copy with a new unique ID
     */
    cloneWithNewId() {
        const cloned = this.clone();
        cloned.id = crypto.randomUUID();
        cloned.metadata.createdAt = Date.now();
        cloned.metadata.modifiedAt = Date.now();
        return cloned;
    }
    
    /**
     * Check if this annotation has any content.
     * 
     * @returns {boolean} True if annotation has no edges and no arrows
     */
    isEmpty() {
        return this.edgeIndices.size === 0 && this.arrows.length === 0;
    }
    
    /**
     * Get the number of edge vertices in this annotation.
     * 
     * @returns {number} Number of vertices marked as edges
     */
    get edgeCount() {
        return this.edgeIndices.size;
    }
    
    /**
     * Get the number of arrows in this annotation.
     * 
     * @returns {number} Number of arrows
     */
    get arrowCount() {
        return this.arrows.length;
    }
    
    /**
     * Get the display name of this annotation.
     * 
     * @returns {string} The annotation name
     */
    get name() {
        return this.metadata.name;
    }
    
    /**
     * Set the display name of this annotation.
     * 
     * @param {string} value - New name
     */
    set name(value) {
        this.metadata.name = value;
        this.metadata.modifiedAt = Date.now();
    }
    
    /**
     * Get the source of this annotation.
     * 
     * @returns {string} Source: 'manual', 'model', or 'cloud'
     */
    get source() {
        return this.metadata.source;
    }
    
    /**
     * Convert to a plain object for serialization (cloud sync, export, localStorage).
     * 
     * @returns {Object} Plain object representation
     */
    toSerializable() {
        return {
            id: this.id,
            edgeIndices: [...this.edgeIndices],
            arrows: this.arrows.map(a => ({ ...a })),
            metadata: { ...this.metadata }
        };
    }
    
    /**
     * Create an Annotation from a serialized object.
     * 
     * @param {Object} data - Serialized annotation data
     * @param {string} data.id - Annotation ID
     * @param {Array<number>} data.edgeIndices - Edge vertex indices
     * @param {Array<{startIndex: number, endIndex: number}>} data.arrows - Arrows
     * @param {Object} data.metadata - Annotation metadata
     * @returns {Annotation} New Annotation instance
     */
    static fromSerializable(data) {
        return new Annotation({
            id: data.id,
            edgeIndices: data.edgeIndices,
            arrows: data.arrows,
            metadata: data.metadata
        });
    }
    
    /**
     * Create an empty annotation with a given name.
     * 
     * @param {string} [name='Untitled'] - Display name
     * @returns {Annotation} New empty annotation
     */
    static empty(name = 'Untitled') {
        return new Annotation({ name });
    }
    
    /**
     * Create an Annotation from edge labels array (for loading from PLY files).
     * 
     * @param {Uint8Array|Array<number>} labels - Edge labels (1 = edge, 0 = not edge)
     * @param {Array<{startIndex: number, endIndex: number}>} [arrows=[]] - Arrow data
     * @param {Object} [metadata={}] - Annotation metadata
     * @returns {Annotation} New Annotation instance
     */
    static fromEdgeLabels(labels, arrows = [], metadata = {}) {
        const edgeIndices = new Set();
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === 1) {
                edgeIndices.add(i);
            }
        }
        return new Annotation({ 
            edgeIndices, 
            arrows,
            metadata
        });
    }
    
    /**
     * Convert edge indices to a labels array (for exporting to PLY files).
     * 
     * @param {number} vertexCount - Total number of vertices in the mesh
     * @returns {Uint8Array} Labels array (1 = edge, 0 = not edge)
     */
    toEdgeLabels(vertexCount) {
        const labels = new Uint8Array(vertexCount).fill(0);
        this.edgeIndices.forEach(index => {
            if (index < vertexCount) {
                labels[index] = 1;
            }
        });
        return labels;
    }
    
    /**
     * Check if two annotations have the same edge state.
     * Does not compare metadata or arrows.
     * 
     * @param {Annotation} other - Another annotation to compare
     * @returns {boolean} True if edge indices are identical
     */
    hasSameEdges(other) {
        if (this.edgeIndices.size !== other.edgeIndices.size) {
            return false;
        }
        for (const index of this.edgeIndices) {
            if (!other.edgeIndices.has(index)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Check if two annotations are equal (same edges and arrows).
     * Does not compare metadata (except for deep equality check).
     * 
     * @param {Annotation} other - Another annotation to compare
     * @returns {boolean} True if edges and arrows are identical
     */
    equals(other) {
        if (!this.hasSameEdges(other)) {
            return false;
        }
        
        if (this.arrows.length !== other.arrows.length) {
            return false;
        }
        
        // Compare arrows (order matters)
        for (let i = 0; i < this.arrows.length; i++) {
            const a = this.arrows[i];
            const b = other.arrows[i];
            if (a.startIndex !== b.startIndex || a.endIndex !== b.endIndex) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Get a specific metadata value.
     * 
     * @param {string} key - Metadata key
     * @returns {*} Metadata value or undefined
     */
    getMetadata(key) {
        return this.metadata[key];
    }
    
    /**
     * Set a specific metadata value.
     * 
     * @param {string} key - Metadata key
     * @param {*} value - Metadata value
     */
    setMetadata(key, value) {
        this.metadata[key] = value;
        this.metadata.modifiedAt = Date.now();
    }
    
    /**
     * Update multiple metadata values at once.
     * 
     * @param {Object} updates - Key-value pairs to update
     */
    updateMetadata(updates) {
        Object.assign(this.metadata, updates);
        this.metadata.modifiedAt = Date.now();
    }
    
    /**
     * Delete a metadata key.
     * 
     * @param {string} key - Key to delete
     * @returns {boolean} True if key existed and was deleted
     */
    deleteMetadata(key) {
        if (key in this.metadata && key !== 'name' && key !== 'source' && key !== 'createdAt' && key !== 'modifiedAt') {
            delete this.metadata[key];
            this.metadata.modifiedAt = Date.now();
            return true;
        }
        return false;
    }
}
