import CustomPLYLoader from "./customPLYLoader";
import { read as readmat } from "mat-for-js"
import { eventBus, Events } from '../utils/EventBus.js';

/**
 * Keys that belong to annotation metadata (everything else is mesh metadata).
 * Used by separateMetadata() to split combined PLY metadata into mesh vs annotation parts.
 */
const ANNOTATION_METADATA_KEYS = [
    'annotation-metadata',  // New explicit key for nested annotation metadata
    'state-metadata',       // Legacy key (backward compatibility)
    'evaluation',           // Evaluation metrics
    'model_params',         // Model inference parameters
    'annotator',            // Who created this annotation
    'annotation_date',      // When annotation was created
    'annotation_source'     // Source of annotation (manual, model, cloud)
];

/**
 * Separate combined metadata from PLY file into mesh metadata and annotation metadata.
 * 
 * Mesh metadata: author, scan_date, source_file, etc. - shared by all annotations
 * Annotation metadata: evaluation metrics, model params, etc. - unique per annotation
 * 
 * @param {Object} combined - Combined metadata from PLY file
 * @returns {Object} { meshMetadata, annotationMetadata }
 */
export function separateMetadata(combined) {
    const meshMetadata = {};
    const annotationMetadata = {};
    
    for (const [key, value] of Object.entries(combined)) {
        if (key === 'annotation-metadata' || key === 'state-metadata') {
            // Nested annotation metadata object - spread its contents
            if (typeof value === 'object' && value !== null) {
                Object.assign(annotationMetadata, value);
            }
        } else if (ANNOTATION_METADATA_KEYS.includes(key)) {
            annotationMetadata[key] = value;
        } else {
            meshMetadata[key] = value;
        }
    }
    
    return { meshMetadata, annotationMetadata };
}

/**
 * Combine mesh metadata and annotation metadata for export to PLY.
 * 
 * @param {Object} meshMetadata - Mesh-level metadata
 * @param {Object} annotationMetadata - Annotation-specific metadata
 * @returns {Object} Combined metadata for PLY export
 */
export function combineMetadata(meshMetadata, annotationMetadata) {
    const combined = { ...meshMetadata };
    
    // Only add annotation metadata if there's something to add
    if (annotationMetadata && Object.keys(annotationMetadata).length > 0) {
        combined['annotation-metadata'] = annotationMetadata;
    }
    
    return combined;
}


/**
 * MeshLoader handles loading mesh files (PLY, MAT) and managing their metadata.
 * 
 * Metadata is stored separately from geometry and can be:
 * - Loaded from PLY file comments
 * - Modified programmatically via getMetadata/setMetadata/updateMetadata
 * - Exported back to PLY files via meshExporter
 * 
 * ## Event Bus Integration
 * 
 * MeshLoader emits the following events via the global EventBus:
 * - `Events.MESH_LOADED` - When a mesh is loaded from a local file
 *   Data: { source: 'file', filename: string, metadata: object }
 * 
 * Components can subscribe to these events instead of using addLoadListener():
 * ```javascript
 * import { eventBus, Events } from '../utils/EventBus.js';
 * eventBus.on(Events.MESH_LOADED, (data) => {
 *     if (data.source === 'file') {
 *         console.log('File loaded:', data.filename);
 *     }
 * });
 * ```
 * 
 * @example
 * // Access metadata after loading
 * const author = meshLoader.getMetadata('author');
 * 
 * // Modify metadata
 * meshLoader.setMetadata('author', 'John Doe');
 * meshLoader.updateMetadata({ version: '2.0', modified: true });
 */
export default class MeshLoader {
    constructor(meshObject, arrowDrawer) {
        this.meshObject = meshObject;
        this.arrowDrawer = arrowDrawer;
        this.loader = new CustomPLYLoader();
        this.currentFileName = null;
        
        /**
         * Metadata loaded from the mesh file or set programmatically.
         * @type {Object}
         */
        this.metadata = {};
        
        /**
         * Raw comments from the PLY file (non-metadata comments).
         * @type {string[]}
         */
        this.comments = [];
        
        /**
         * Listeners to be notified when a file is loaded.
         * @type {Function[]}
         */
        this.loadListeners = [];

        this.load = this.load.bind(this);

        document.getElementById('fileInput').addEventListener('change', (event) => {
            this.load(event);
        });
        
    }
    
    /**
     * Add a listener to be notified when a file is loaded.
     * The listener receives an object with { fileName, metadata, comments }.
     * 
     * @deprecated Prefer using EventBus for new code:
     * ```javascript
     * import { eventBus, Events } from '../utils/EventBus.js';
     * eventBus.on(Events.MESH_LOADED, (data) => {
     *     if (data.source === 'file') {
     *         // data.filename, data.metadata
     *     }
     * });
     * ```
     * 
     * @param {Function} listener - Callback function
     */
    addLoadListener(listener) {
        this.loadListeners.push(listener);
    }
    
    /**
     * Remove a load listener.
     * @param {Function} listener - The listener to remove
     */
    removeLoadListener(listener) {
        const index = this.loadListeners.indexOf(listener);
        if (index > -1) {
            this.loadListeners.splice(index, 1);
        }
    }
    
    /**
     * Notify all listeners that a file was loaded.
     * Emits both to legacy listeners and the global EventBus.
     * @private
     */
    notifyLoadListeners() {
        const data = {
            fileName: this.currentFileName,
            metadata: this.metadata,
            comments: this.comments
        };
        
        // Legacy listener pattern (for backward compatibility)
        this.loadListeners.forEach(listener => listener(data));
        
        // EventBus pattern (preferred for new code)
        eventBus.emit(Events.MESH_LOADED, {
            source: 'file',
            filename: this.currentFileName,
            metadata: this.metadata
        });
    }
    
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
     * @param {*} value - The value to set (can be string, number, boolean, object, or array)
     */
    setMetadata(key, value) {
        this.metadata[key] = value;
        // Also update meshObject's metadata if it exists
        if (this.meshObject && this.meshObject.metadata) {
            this.meshObject.metadata[key] = value;
        }
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
        // Also update meshObject's metadata if it exists
        if (this.meshObject && this.meshObject.metadata) {
            this.meshObject.metadata = { ...this.meshObject.metadata, ...updates };
        }
    }
    
    /**
     * Clear all metadata.
     */
    clearMetadata() {
        this.metadata = {};
        if (this.meshObject && this.meshObject.metadata) {
            this.meshObject.metadata = {};
        }
    }
    
    /**
     * Delete a specific metadata key.
     * @param {string} key - The metadata key to delete
     */
    deleteMetadata(key) {
        delete this.metadata[key];
        if (this.meshObject && this.meshObject.metadata) {
            delete this.meshObject.metadata[key];
        }
    }
    
    /**
     * Get all raw comments from the PLY file (non-metadata comments).
     * @returns {string[]} Array of comment strings
     */
    getComments() {
        return [...this.comments];
    }

    /**
     * Load a mesh file from a file input event.
     * Supports PLY and MAT file formats.
     * 
     * @param {Event} event - File input change event
     */
    load(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.loadFile(file);
    }
    
    /**
     * Load a mesh from a File object directly.
     * Supports PLY and MAT file formats.
     * 
     * @param {File} file - The File object to load
     * @returns {Promise<void>} Resolves when the file is loaded
     */
    loadFile(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject(new Error('No file provided'));
                return;
            }
            
            this.currentFileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        
            const reader = new FileReader();
            reader.onload = (event) => {
                const data = event.target.result;
                let positions, labels, indices, arrows, metadata, comments; 

                if (file.name.endsWith('.ply')) {
                    ({ positions, labels, indices, arrows, metadata, comments } = this.readPLY(data));
                    debugGlobalVar['ply'] = {
                        positions: positions,
                        labels: labels,
                        indices: indices,
                        arrows: arrows,
                        metadata: metadata,
                        comments: comments
                    }
                } else if (file.name.endsWith('.mat')) {
                    ({ positions, labels, indices, arrows, metadata, comments } = this.readMAT(data));
                } else {
                    reject(new Error('Unsupported file format'));
                    return;
                }

                if (positions.length === 0) {
                    reject(new Error('No data found in the file'));
                    return;
                }
                
                // Store metadata and comments
                this.metadata = metadata || {};
                this.comments = comments || [];
            
                this.meshObject.setMesh(positions, labels, indices, this.metadata);
                this.arrowDrawer.clear();
                this.arrowDrawer.load(arrows);
                
                // Apply state-metadata to initial state if present in loaded metadata
                if (this.metadata['state-metadata']) {
                    this.meshObject.history.updateStateMetadata(0, this.metadata['state-metadata']);
                    delete this.metadata['state-metadata'];
                }
                
                // Notify listeners that a file was loaded
                this.notifyLoadListeners();
                resolve();
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
        
            reader.readAsArrayBuffer(file);
        });
    }
    
    /**
     * Parse PLY file data and extract geometry, labels, arrows, and metadata.
     * 
     * @param {ArrayBuffer} data - PLY file content as ArrayBuffer
     * @returns {Object} Parsed data containing positions, labels, indices, arrows, metadata, and comments
     */
    readPLY(data) {
        const geometry = this.loader.parse(data);

        const labelIds = geometry.attributes.labelid ? geometry.attributes.labelid.array : [];
        const positions = geometry.attributes.position.array;
        const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);
        let labels;

        if (labelIds.length > 0 && !geometry.attributes.labels  ) {
            labels = calculateVertexEdgeLabelsFromLabelIds(indices, labelIds);
        } else {
            labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
        }

        const arrows = geometry.userData.arrows ? geometry.userData.arrows : [];
        
        // Extract metadata and comments from geometry userData
        const metadata = geometry.userData.metadata || {};
        const comments = geometry.userData.comments || [];

        return {
            positions,
            labels,
            indices,
            arrows,
            metadata,
            comments
        };
    }

    /**
     * Parse MAT file data and extract geometry and labels.
     * Note: MAT files do not support metadata, so empty metadata is returned.
     * 
     * @param {ArrayBuffer} data - MAT file content as ArrayBuffer
     * @returns {Object} Parsed data containing positions, labels, indices, arrows, metadata, and comments
     */
    readMAT(data) {
        const mat = readmat(data).data;

        const positions = new Float32Array((mat['v'] || mat['vertices'] || []).flat());
        const indices = (mat['f'] || mat['faces'] || []).flat();
        const faceLabels = new Uint16Array((mat['GL'] || []).flat());

        if (indices.length !== 0) {
            indices.forEach((index, i) => {
                indices[i] = index - 1;
            });
        }

        const labels = calculateVertexEdgeLabels(indices, faceLabels);

        debugGlobalVar['mat'] = {
            positions: positions,
            labels: labels,
            indices: indices,
            arrows: [],
            metadata: {},
            comments: []
        }
        return {
            positions: positions,
            labels: labels,
            indices: indices,
            arrows: [],
            metadata: {},  // MAT files don't support metadata
            comments: []   // MAT files don't support comments
        }
    }
}


function calculateVertexEdgeLabelsFromLabelIds(indices, labelIds) {
    if (indices.length === 0 || labelIds.length === 0) return [];

    const vertexEdgeLabels = new Uint8Array(labelIds.length);

    // Process each triangle
    for (let i = 0; i < indices.length; i += 3) {
        const vertex1Label = labelIds[indices[i]];
        const vertex2Label = labelIds[indices[i + 1]];
        const vertex3Label = labelIds[indices[i + 2]];

        // If any vertex in the triangle has a different label than others,
        // mark all vertices in this triangle as edge vertices
        if (vertex1Label !== vertex2Label || vertex2Label !== vertex3Label || vertex1Label !== vertex3Label) {
            vertexEdgeLabels[indices[i]] = 1;
            vertexEdgeLabels[indices[i + 1]] = 1;
            vertexEdgeLabels[indices[i + 2]] = 1;
        }
    }

    return vertexEdgeLabels;
}


function calculateVertexEdgeLabels(indices, faceLabels) {
    if (indices.length === 0) return [];
    if (faceLabels.length === 0) return [];

    const vertexCount = indices.reduce((max, idx) => Math.max(max, idx), 0) + 1;
    const vertexEdgeLabels = new Uint8Array(vertexCount);

    // Create an array to count the occurrences of each label for each vertex
    const vertexLabelCounts = new Array(vertexCount).fill(0).map(() => ({}));

    for (let i = 0; i < indices.length; i += 3) {
        const faceLabel = faceLabels[Math.floor(i / 3)];
        const vertex1 = indices[i];
        const vertex2 = indices[i + 1];
        const vertex3 = indices[i + 2];

        vertexLabelCounts[vertex1][faceLabel] = (vertexLabelCounts[vertex1][faceLabel] || 0) + 1;
        vertexLabelCounts[vertex2][faceLabel] = (vertexLabelCounts[vertex2][faceLabel] || 0) + 1;
        vertexLabelCounts[vertex3][faceLabel] = (vertexLabelCounts[vertex3][faceLabel] || 0) + 1;
    }

    vertexLabelCounts.forEach((labelCounts, vertex) => {
        const uniqueLabels = Object.keys(labelCounts).length;
        vertexEdgeLabels[vertex] = uniqueLabels > 1 ? 1 : 0;
    });

    return vertexEdgeLabels;
}
