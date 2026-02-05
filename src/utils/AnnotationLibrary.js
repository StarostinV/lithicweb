import { eventBus, Events } from './EventBus.js';
import { Annotation } from '../geometry/Annotation.js';

/**
 * AnnotationLibrary - Stores and manages saved annotations.
 * 
 * Since Annotations are lightweight (just edgeIndices + arrows + metadata),
 * the library can hold many annotations without significant memory concerns.
 * 
 * ## Key Concepts
 * 
 * - All operations return clones to prevent external mutation
 * - EventBus integration for UI updates
 * - Support for GT/Pred evaluation labels
 * - Cloud sync tracking via cloudStateId
 * 
 * ## Event Bus Integration
 * 
 * Emits:
 * - `Events.LIBRARY_CHANGED` - When library changes (save, delete, rename, update, cloud_linked)
 * - `Events.LIBRARY_CLEARED` - When library is cleared
 * 
 * The LibraryPanel subscribes to `Events.ANNOTATION_IMPORTED` (from cloud/model sources)
 * and automatically saves imported annotations to this library.
 * 
 * ## Memory Optimization
 * 
 * - Annotations are lightweight (edgeIndices Set + arrows Array + metadata Object)
 * - All public methods return clones to prevent external mutation
 * - Cloud links tracked in a separate Map for O(1) lookup by cloudStateId
 * 
 * @example
 * const library = new AnnotationLibrary();
 * 
 * // Save current annotation
 * const id = library.save(meshView.getAnnotation());
 * 
 * // Load annotation into view
 * const annotation = library.load(id);
 * meshView.loadAnnotation(annotation);
 * 
 * // List all annotations
 * const all = library.getAll();
 * 
 * // Track cloud sync
 * library.setCloudLink(id, 'cloud-state-123');
 * const synced = library.isCloudSynced(id);  // true
 */
export class AnnotationLibrary {
    constructor() {
        /**
         * Map of annotation ID to Annotation.
         * @type {Map<string, Annotation>}
         */
        this.annotations = new Map();
        
        /**
         * ID of annotation set as Ground Truth.
         * @type {string|null}
         */
        this.groundTruthId = null;
        
        /**
         * ID of annotation set as Prediction.
         * @type {string|null}
         */
        this.predictionId = null;
        
        /**
         * Map of cloud state IDs to annotation IDs.
         * For tracking which annotations are synced with cloud.
         * @type {Map<string, string>}
         */
        this.cloudLinks = new Map();
    }
    
    /**
     * Save an annotation to the library.
     * Stores a clone to prevent external mutation.
     * 
     * @param {Annotation} annotation - Annotation to save
     * @returns {string} The annotation's ID
     */
    save(annotation) {
        const saved = annotation.clone();
        saved.metadata.modifiedAt = Date.now();
        
        // If annotation with this ID already exists, preserve some fields
        if (this.annotations.has(saved.id)) {
            const existing = this.annotations.get(saved.id);
            // Preserve cloud link if it exists
            if (existing.metadata.cloudStateId) {
                saved.metadata.cloudStateId = existing.metadata.cloudStateId;
            }
        }
        
        this.annotations.set(saved.id, saved);
        
        this._emitChange('save', saved.id, saved);
        return saved.id;
    }
    
    /**
     * Load an annotation from the library.
     * Returns a clone to prevent mutation of the stored annotation.
     * 
     * @param {string} id - Annotation ID
     * @returns {Annotation|null} Clone of the annotation, or null if not found
     */
    load(id) {
        const annotation = this.annotations.get(id);
        return annotation ? annotation.clone() : null;
    }
    
    /**
     * Update an existing annotation.
     * 
     * @param {string} id - Annotation ID to update
     * @param {Annotation} annotation - New annotation data
     * @returns {boolean} True if annotation existed and was updated
     */
    update(id, annotation) {
        if (!this.annotations.has(id)) return false;
        
        const updated = annotation.clone();
        updated.id = id;  // Preserve original ID
        updated.metadata.modifiedAt = Date.now();
        
        // Preserve cloud link if it exists
        const existing = this.annotations.get(id);
        if (existing.metadata.cloudStateId) {
            updated.metadata.cloudStateId = existing.metadata.cloudStateId;
        }
        
        this.annotations.set(id, updated);
        
        this._emitChange('update', id, updated);
        return true;
    }
    
    /**
     * Delete an annotation from the library.
     * 
     * @param {string} id - Annotation ID to delete
     * @returns {boolean} True if annotation existed and was deleted
     */
    delete(id) {
        if (!this.annotations.has(id)) return false;
        
        // Clear GT/Pred if this annotation was set
        if (this.groundTruthId === id) {
            this.groundTruthId = null;
        }
        if (this.predictionId === id) {
            this.predictionId = null;
        }
        
        // Remove cloud link
        const annotation = this.annotations.get(id);
        if (annotation.metadata.cloudStateId) {
            this.cloudLinks.delete(annotation.metadata.cloudStateId);
        }
        
        this.annotations.delete(id);
        
        this._emitChange('delete', id);
        return true;
    }
    
    /**
     * Rename an annotation.
     * 
     * @param {string} id - Annotation ID
     * @param {string} newName - New name for the annotation
     * @returns {boolean} True if annotation existed and was renamed
     */
    rename(id, newName) {
        const annotation = this.annotations.get(id);
        if (!annotation) return false;
        
        annotation.metadata.name = newName;
        annotation.metadata.modifiedAt = Date.now();
        
        this._emitChange('rename', id, annotation);
        return true;
    }
    
    /**
     * Get all annotations in the library.
     * Returns clones to prevent mutation.
     * 
     * @returns {Array<Annotation>} Array of annotation clones
     */
    getAll() {
        return [...this.annotations.values()].map(a => a.clone());
    }
    
    /**
     * Get all annotations sorted by modification date (newest first).
     * 
     * @returns {Array<Annotation>} Sorted array of annotation clones
     */
    getAllSorted() {
        return this.getAll().sort((a, b) => 
            (b.metadata.modifiedAt || 0) - (a.metadata.modifiedAt || 0)
        );
    }
    
    /**
     * Get count of annotations in the library.
     * 
     * @returns {number}
     */
    get count() {
        return this.annotations.size;
    }
    
    /**
     * Check if library is empty.
     * 
     * @returns {boolean}
     */
    isEmpty() {
        return this.annotations.size === 0;
    }
    
    /**
     * Check if library has an annotation with the given ID.
     * 
     * @param {string} id - Annotation ID
     * @returns {boolean}
     */
    has(id) {
        return this.annotations.has(id);
    }
    
    /**
     * Clear all annotations from the library.
     * Typically called when loading a new mesh.
     */
    clear() {
        this.annotations.clear();
        this.groundTruthId = null;
        this.predictionId = null;
        this.cloudLinks.clear();
        
        eventBus.emit(Events.LIBRARY_CLEARED, {});
    }
    
    // ========================================
    // Ground Truth / Prediction Management
    // ========================================
    
    /**
     * Set an annotation as Ground Truth.
     * 
     * @param {string} id - Annotation ID to set as GT
     * @returns {boolean} True if annotation exists and was set
     */
    setAsGroundTruth(id) {
        if (!this.annotations.has(id)) return false;
        
        this.groundTruthId = id;
        this._emitChange('gt_set', id);
        return true;
    }
    
    /**
     * Set an annotation as Prediction.
     * 
     * @param {string} id - Annotation ID to set as Prediction
     * @returns {boolean} True if annotation exists and was set
     */
    setAsPrediction(id) {
        if (!this.annotations.has(id)) return false;
        
        this.predictionId = id;
        this._emitChange('pred_set', id);
        return true;
    }
    
    /**
     * Clear the Ground Truth label.
     */
    clearGroundTruth() {
        if (this.groundTruthId !== null) {
            const prevId = this.groundTruthId;
            this.groundTruthId = null;
            this._emitChange('gt_cleared', prevId);
        }
    }
    
    /**
     * Clear the Prediction label.
     */
    clearPrediction() {
        if (this.predictionId !== null) {
            const prevId = this.predictionId;
            this.predictionId = null;
            this._emitChange('pred_cleared', prevId);
        }
    }
    
    /**
     * Get the Ground Truth annotation.
     * 
     * @returns {Annotation|null}
     */
    getGroundTruth() {
        return this.groundTruthId ? this.load(this.groundTruthId) : null;
    }
    
    /**
     * Get the Prediction annotation.
     * 
     * @returns {Annotation|null}
     */
    getPrediction() {
        return this.predictionId ? this.load(this.predictionId) : null;
    }
    
    /**
     * Check if both GT and Prediction are set (ready for evaluation).
     * 
     * @returns {boolean}
     */
    canEvaluate() {
        return this.groundTruthId !== null && this.predictionId !== null;
    }
    
    // ========================================
    // Cloud Sync Support
    // ========================================
    
    /**
     * Link an annotation to a cloud state ID.
     * 
     * @param {string} annotationId - Local annotation ID
     * @param {string} cloudStateId - Cloud state ID
     */
    setCloudLink(annotationId, cloudStateId) {
        const annotation = this.annotations.get(annotationId);
        if (!annotation) return;
        
        annotation.metadata.cloudStateId = cloudStateId;
        this.cloudLinks.set(cloudStateId, annotationId);
        
        this._emitChange('cloud_linked', annotationId);
    }
    
    /**
     * Find annotation by cloud state ID.
     * 
     * @param {string} cloudStateId - Cloud state ID
     * @returns {Annotation|null}
     */
    getByCloudId(cloudStateId) {
        const annotationId = this.cloudLinks.get(cloudStateId);
        return annotationId ? this.load(annotationId) : null;
    }
    
    /**
     * Check if an annotation has been synced to cloud.
     * 
     * @param {string} id - Annotation ID
     * @returns {boolean}
     */
    isCloudSynced(id) {
        const annotation = this.annotations.get(id);
        return annotation?.metadata?.cloudStateId != null;
    }
    
    /**
     * Check if any annotations have unsaved changes (not synced to cloud).
     * 
     * @returns {boolean}
     */
    hasUnsaved() {
        for (const annotation of this.annotations.values()) {
            if (!annotation.metadata.cloudStateId) {
                return true;
            }
        }
        return false;
    }
    
    // ========================================
    // Serialization
    // ========================================
    
    /**
     * Serialize the library for storage.
     * 
     * @returns {Object} Serializable representation
     */
    toSerializable() {
        return {
            annotations: [...this.annotations.values()].map(a => a.toSerializable()),
            groundTruthId: this.groundTruthId,
            predictionId: this.predictionId
        };
    }
    
    /**
     * Load library from serialized data.
     * 
     * @param {Object} data - Serialized library data
     */
    fromSerializable(data) {
        this.clear();
        
        if (data.annotations) {
            for (const annotationData of data.annotations) {
                const annotation = Annotation.fromSerializable(annotationData);
                this.annotations.set(annotation.id, annotation);
                
                // Rebuild cloud links
                if (annotation.metadata.cloudStateId) {
                    this.cloudLinks.set(annotation.metadata.cloudStateId, annotation.id);
                }
            }
        }
        
        this.groundTruthId = data.groundTruthId || null;
        this.predictionId = data.predictionId || null;
        
        this._emitChange('loaded', null);
    }
    
    // ========================================
    // Private Methods
    // ========================================
    
    /**
     * Emit a library change event.
     * 
     * @private
     * @param {string} action - Type of change
     * @param {string|null} id - Affected annotation ID
     * @param {Annotation} [annotation] - Annotation data (if applicable)
     */
    _emitChange(action, id, annotation = null) {
        eventBus.emit(Events.LIBRARY_CHANGED, {
            action,
            id,
            annotation: annotation ? annotation.toSerializable() : null,
            count: this.annotations.size,
            groundTruthId: this.groundTruthId,
            predictionId: this.predictionId
        });
    }
}
