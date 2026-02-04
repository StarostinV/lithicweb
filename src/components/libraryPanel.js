/**
 * LibraryPanel - UI component for managing saved annotations.
 * 
 * The library is the single source of truth for saved annotations and tags.
 * Users can manually save annotations using the "Save" button, and annotations
 * loaded from external sources (cloud, model) are auto-saved to the library.
 * 
 * Features:
 * - Save current annotation to library
 * - Load annotations into the view
 * - Rename/delete saved annotations
 * - Assign GT/Pred tags for evaluation
 * - Auto-save annotations loaded from cloud/model sources
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.LIBRARY_CHANGED` - Updates UI when library changes
 * - `Events.LIBRARY_CLEARED` - Clears UI when library is cleared
 * - `Events.EVALUATION_GT_CHANGED` - Updates GT indicators
 * - `Events.EVALUATION_PRED_CHANGED` - Updates Pred indicators
 * - `Events.ANNOTATION_LOADED` - Auto-saves annotations loaded from external sources
 * 
 * ## Memory Optimization
 * 
 * All event subscriptions use namespaces ('libraryPanel') for efficient cleanup.
 * The dispose() method removes all subscriptions via offNamespace() to prevent leaks.
 * 
 * @module LibraryPanel
 */

import { escapeHtml, formatTimestamp } from '../utils/sanitize.js';
import { eventBus, Events } from '../utils/EventBus.js';

export class LibraryPanel {
    /**
     * Create a LibraryPanel.
     * 
     * @param {MeshView} meshView - The mesh view for loading annotations
     * @param {AnnotationLibrary} library - The annotation library
     * @param {EvaluationManager} [evaluationManager=null] - Optional evaluation manager
     */
    constructor(meshView, library, evaluationManager = null) {
        this.meshView = meshView;
        this.library = library;
        this.evaluationManager = evaluationManager;
        this.cloudStoragePanel = null; // Set via setCloudStoragePanel()
        
        // UI Elements
        this.saveBtn = document.getElementById('saveToLibraryBtn');
        this.clearBtn = document.getElementById('clearLibraryBtn');
        this.libraryList = document.getElementById('libraryList');
        this.libraryStats = document.getElementById('libraryStats');
        this.gtStatus = document.getElementById('libraryGtStatus');
        this.predStatus = document.getElementById('libraryPredStatus');

        this.setupEventListeners();
        this._setupEventBusSubscriptions();
        this.updateUI();
    }
    
    /**
     * Setup EventBus subscriptions.
     * 
     * Memory optimization: All subscriptions use the 'libraryPanel' namespace
     * for efficient cleanup via offNamespace() in dispose().
     * 
     * @private
     */
    _setupEventBusSubscriptions() {
        // Listen to library changes
        eventBus.on(Events.LIBRARY_CHANGED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        eventBus.on(Events.LIBRARY_CLEARED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        // Listen to evaluation GT/Pred changes to update UI
        eventBus.on(Events.EVALUATION_GT_CHANGED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        eventBus.on(Events.EVALUATION_PRED_CHANGED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        // Listen to annotations loaded from external sources (cloud, model, import)
        // Auto-save them to the library for tracking and evaluation workflows
        eventBus.on(Events.ANNOTATION_LOADED, (data) => {
            this._handleAnnotationLoaded(data);
        }, 'libraryPanel');
        
        // Listen to mesh loaded/uploaded events to refresh UI
        // This updates the cloud upload button visibility when mesh sync status changes
        eventBus.on(Events.MESH_LOADED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        eventBus.on(Events.MESH_UPLOADED, () => {
            this.updateUI();
        }, 'libraryPanel');
        
        // Listen to state saved events to update cloud sync status
        eventBus.on(Events.STATE_SAVED, () => {
            this.updateUI();
        }, 'libraryPanel');
    }
    
    /**
     * Handle annotations loaded from external sources.
     * Automatically saves them to the library and tracks cloud links if applicable.
     * 
     * This allows loaded annotations to be:
     * - Visible in the library panel
     * - Tagged as GT/Pred for evaluation
     * - Tracked for cloud sync status
     * 
     * @param {Object} data - Event data
     * @param {Annotation} data.annotation - The loaded annotation object
     * @param {string} data.source - Source: 'cloud', 'model', or 'import'
     * @param {Object} [data.cloudInfo] - Cloud-specific info (if source is 'cloud')
     * @param {string} [data.cloudInfo.meshId] - Cloud mesh ID
     * @param {string} [data.cloudInfo.stateId] - Cloud state ID
     * @private
     */
    _handleAnnotationLoaded(data) {
        const { annotation, source, cloudInfo } = data;
        
        if (!annotation) {
            console.warn('[LibraryPanel] Received ANNOTATION_LOADED without annotation object');
            return;
        }
        
        console.log(`[LibraryPanel] Auto-saving annotation from ${source}:`, annotation.name);
        
        // Check if this cloud annotation already exists in the library
        if (source === 'cloud' && cloudInfo?.stateId) {
            const existing = this.library.getByCloudId(cloudInfo.stateId);
            if (existing) {
                console.log('[LibraryPanel] Annotation already in library (cloud ID match), updating');
                // Update the existing annotation with new data
                this.library.update(existing.id, annotation);
                return;
            }
        }
        
        // Save the annotation to library
        // The library will clone it internally to prevent mutation
        const id = this.library.save(annotation);
        
        // If loaded from cloud, track the cloud link
        if (source === 'cloud' && cloudInfo?.stateId) {
            this.library.setCloudLink(id, cloudInfo.stateId);
            console.log(`[LibraryPanel] Cloud link set: ${id} -> ${cloudInfo.stateId}`);
        }
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     */
    dispose() {
        eventBus.offNamespace('libraryPanel');
    }

    /**
     * Set the evaluation manager (for deferred initialization).
     * @param {EvaluationManager} evaluationManager
     */
    setEvaluationManager(evaluationManager) {
        this.evaluationManager = evaluationManager;
    }
    
    /**
     * Set the cloud storage panel (for cloud upload functionality).
     * @param {CloudStoragePanel} cloudStoragePanel
     */
    setCloudStoragePanel(cloudStoragePanel) {
        this.cloudStoragePanel = cloudStoragePanel;
    }
    
    /**
     * Check if the current mesh is synced to cloud.
     * @returns {boolean} True if mesh has cloud connection
     */
    isMeshCloudSynced() {
        return this.cloudStoragePanel?.cloudMeshInfo != null;
    }
    
    /**
     * Get the current cloud mesh ID.
     * @returns {string|null} The cloud mesh ID or null
     */
    getCloudMeshId() {
        return this.cloudStoragePanel?.cloudMeshInfo?.meshId || null;
    }

    setupEventListeners() {
        // Save to library button
        this.saveBtn?.addEventListener('click', () => {
            this.saveCurrentAnnotation();
        });

        // Clear library button
        this.clearBtn?.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all saved annotations? This cannot be undone.')) {
                this.library.clear();
            }
        });
    }

    /**
     * Save the current annotation to the library.
     */
    saveCurrentAnnotation() {
        const annotation = this.meshView.getAnnotation();
        if (annotation.isEmpty()) {
            alert('Cannot save an empty annotation.');
            return;
        }
        
        // Prompt for name
        const currentName = annotation.name || 'Untitled';
        const name = prompt('Enter a name for this annotation:', currentName);
        if (name === null) return; // Cancelled
        
        annotation.name = name || currentName;
        const id = this.library.save(annotation);
        
        // Link to current history state if applicable
        const currentIndex = this.meshView.history.getCurrentIndex();
        if (currentIndex > 0) {
            this.meshView.history.setLibraryLink(currentIndex, id);
        }
    }

    /**
     * Load an annotation from the library into the view.
     * @param {string} id - Annotation ID
     */
    loadAnnotation(id) {
        const annotation = this.library.load(id);
        if (!annotation) {
            console.warn('Annotation not found:', id);
            return;
        }
        
        // Start a library-load operation in history
        this.meshView.startDrawOperation('library-load', `Load: ${annotation.name}`);
        
        // Apply the annotation state
        this.meshView._restoreEdgeState(annotation.edgeIndices);
        
        // Finish the operation
        this.meshView.finishDrawOperation();
        
        // Update segments
        const autoSegments = document.getElementById('auto-segments');
        if (autoSegments?.checked) {
            this.meshView.updateSegments();
        }
    }

    /**
     * Update the UI to reflect current library state.
     */
    updateUI() {
        // Update stats
        const count = this.library.count;
        this.libraryStats.innerHTML = `<i class="fas fa-layer-group"></i> ${count} annotation${count !== 1 ? 's' : ''}`;
        
        // Update GT/Pred status indicators
        if (this.library.groundTruthId) {
            this.gtStatus?.classList.remove('hidden');
        } else {
            this.gtStatus?.classList.add('hidden');
        }
        
        if (this.library.predictionId) {
            this.predStatus?.classList.remove('hidden');
        } else {
            this.predStatus?.classList.add('hidden');
        }
        
        // Update list
        this.updateLibraryList();
    }

    /**
     * Update the library list display.
     */
    updateLibraryList() {
        if (this.library.isEmpty()) {
            this.libraryList.innerHTML = `
                <div class="library-empty">
                    <i class="fas fa-bookmark"></i>
                    <p>No saved annotations</p>
                    <p class="text-muted">Protected states are automatically saved here</p>
                </div>
            `;
            return;
        }

        this.libraryList.innerHTML = '';
        
        // Get all annotations sorted by modification date
        const annotations = this.library.getAllSorted();
        
        for (const annotation of annotations) {
            const item = this.createLibraryItem(annotation);
            this.libraryList.appendChild(item);
        }
    }

    /**
     * Create a library item element.
     * @param {Annotation} annotation
     * @returns {HTMLElement}
     */
    createLibraryItem(annotation) {
        const item = document.createElement('div');
        const isGT = this.library.groundTruthId === annotation.id;
        const isPred = this.library.predictionId === annotation.id;
        const isCloudSynced = this.library.isCloudSynced(annotation.id);
        const meshIsCloudSynced = this.isMeshCloudSynced();
        const canUploadToCloud = meshIsCloudSynced && !isCloudSynced;
        
        item.className = `library-item ${isGT || isPred ? 'library-item-labeled' : ''}`;
        item.dataset.id = annotation.id;
        
        // Format timestamp nicely
        const timestamp = formatTimestamp(annotation.metadata.modifiedAt || annotation.metadata.createdAt);
        const edgeCount = annotation.edgeCount;
        const sourceIcon = this._getSourceIcon(annotation.source);
        const cloudIcon = isCloudSynced ? '<i class="fas fa-cloud text-blue-400 ml-1" title="Synced to cloud"></i>' : '';
        
        // Cloud upload button - shown when mesh is synced but annotation is not
        const cloudUploadBtn = canUploadToCloud 
            ? `<button class="library-item-btn cloud-upload-btn" title="Upload to cloud">
                   <i class="fas fa-cloud-upload-alt"></i>
               </button>`
            : '';
        
        item.innerHTML = `
            <div class="library-item-content">
                <div class="library-item-header">
                    <span class="library-item-name">${sourceIcon} ${escapeHtml(annotation.name)}${cloudIcon}</span>
                    <div class="library-item-actions">
                        ${cloudUploadBtn}
                        <button class="library-item-btn load-btn" title="Load annotation">
                            <i class="fas fa-upload"></i>
                        </button>
                        <button class="library-item-btn rename-btn" title="Rename">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="library-item-btn delete-btn" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="library-item-meta">
                    <span>${timestamp}</span>
                    <span>${edgeCount} edges</span>
                </div>
                <div class="library-item-labels">
                    ${this._createEvalButtons(annotation.id, isGT, isPred)}
                </div>
            </div>
        `;
        
        // Setup event handlers
        this._setupItemHandlers(item, annotation);
        
        return item;
    }

    /**
     * Get icon for annotation source.
     * @private
     */
    _getSourceIcon(source) {
        switch (source) {
            case 'model': return '<i class="fas fa-brain text-purple-500"></i>';
            case 'cloud': return '<i class="fas fa-cloud-download-alt text-blue-500"></i>';
            default: return '<i class="fas fa-pen text-gray-500"></i>';
        }
    }

    /**
     * Create GT/Pred toggle buttons.
     * @private
     */
    _createEvalButtons(id, isGT, isPred) {
        const gtBtnClass = isGT ? 'eval-btn gt-btn active' : 'eval-btn gt-btn';
        const predBtnClass = isPred ? 'eval-btn pred-btn active' : 'eval-btn pred-btn';
        
        return `
            <button class="${gtBtnClass}" data-id="${id}" data-type="gt" title="Set as Ground Truth">
                GT
            </button>
            <button class="${predBtnClass}" data-id="${id}" data-type="pred" title="Set as Prediction">
                Pred
            </button>
        `;
    }

    /**
     * Setup event handlers for a library item.
     * @private
     */
    _setupItemHandlers(item, annotation) {
        const id = annotation.id;
        
        // Cloud upload button
        item.querySelector('.cloud-upload-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.uploadAnnotationToCloud(id);
        });
        
        // Load button
        item.querySelector('.load-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.loadAnnotation(id);
        });
        
        // Rename button
        item.querySelector('.rename-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const newName = prompt('Enter new name:', annotation.name);
            if (newName !== null && newName.trim()) {
                this.library.rename(id, newName.trim());
            }
        });
        
        // Delete button
        item.querySelector('.delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${annotation.name}"?`)) {
                this.library.delete(id);
            }
        });
        
        // GT button
        item.querySelector('.gt-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._handleGTClick(id);
        });
        
        // Pred button
        item.querySelector('.pred-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._handlePredClick(id);
        });
        
        // Click on item loads it
        item.querySelector('.library-item-content')?.addEventListener('click', () => {
            this.loadAnnotation(id);
        });
    }

    /**
     * Handle GT button click.
     * Updates library state and notifies EvaluationManager.
     * @private
     */
    _handleGTClick(id) {
        if (this.library.groundTruthId === id) {
            // Toggle off
            this.library.clearGroundTruth();
            if (this.evaluationManager) {
                this.evaluationManager.clearGroundTruth();
            }
        } else {
            // Set as GT
            const annotation = this.library.load(id);
            if (annotation) {
                this.library.setAsGroundTruth(id);
                if (this.evaluationManager) {
                    this.evaluationManager.setGroundTruth(annotation);
                }
            }
        }
        this.updateUI();
    }

    /**
     * Handle Pred button click.
     * Updates library state and notifies EvaluationManager.
     * @private
     */
    _handlePredClick(id) {
        if (this.library.predictionId === id) {
            // Toggle off
            this.library.clearPrediction();
            if (this.evaluationManager) {
                this.evaluationManager.clearPrediction();
            }
        } else {
            // Set as Pred
            const annotation = this.library.load(id);
            if (annotation) {
                this.library.setAsPrediction(id);
                if (this.evaluationManager) {
                    this.evaluationManager.setPrediction(annotation);
                }
            }
        }
        this.updateUI();
    }
    
    /**
     * Upload an annotation from the library to the cloud.
     * Only works if the current mesh is synced to cloud.
     * 
     * @param {string} id - The annotation ID to upload
     */
    async uploadAnnotationToCloud(id) {
        // Check prerequisites
        if (!this.cloudStoragePanel) {
            console.warn('[LibraryPanel] Cloud storage panel not configured');
            alert('Cloud storage is not available.');
            return;
        }
        
        if (!this.isMeshCloudSynced()) {
            alert('Cannot upload: The current mesh is not synced to cloud. Please upload the mesh first via Cloud Storage panel.');
            return;
        }
        
        // Get the annotation
        const annotation = this.library.load(id);
        if (!annotation) {
            console.warn('[LibraryPanel] Annotation not found:', id);
            return;
        }
        
        // Check if already synced
        if (this.library.isCloudSynced(id)) {
            alert('This annotation is already synced to cloud.');
            return;
        }
        
        console.log(`[LibraryPanel] Uploading annotation "${annotation.name}" to cloud...`);
        
        try {
            // Get the cloud mesh ID
            const meshId = this.getCloudMeshId();
            
            // Build metadata for the annotation
            // Include annotation metadata but exclude internal fields
            const metadata = { ...annotation.metadata };
            delete metadata.cloudStateId; // Will be set after upload
            
            // Import lithicClient dynamically to avoid circular dependency
            const { lithicClient } = await import('../api/lithicClient.js');
            
            // Upload to cloud
            const result = await lithicClient.saveState(
                meshId,
                [...annotation.edgeIndices],
                annotation.name,
                '', // description
                metadata
            );
            
            console.log('[LibraryPanel] Upload successful:', result);
            
            // Link the annotation to the cloud state
            this.library.setCloudLink(id, result.state_id);
            
            // Refresh cloud storage panel if it's visible
            if (this.cloudStoragePanel.selectedMeshId === meshId) {
                await this.cloudStoragePanel.loadStates(meshId);
            }
            await this.cloudStoragePanel.refreshMeshList();
            
            // Update UI to show cloud sync status
            this.updateUI();
            
        } catch (error) {
            console.error('[LibraryPanel] Failed to upload annotation:', error);
            alert(`Failed to upload annotation: ${error.message}`);
        }
    }

}
