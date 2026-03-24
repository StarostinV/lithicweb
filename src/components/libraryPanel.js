/**
 * LibraryPanel - UI component for managing saved annotations.
 * 
 * The library is the single source of truth for saved annotations and tags.
 * Users can manually save annotations using the "Save" button, and annotations
 * imported from external sources (cloud, model) are auto-saved to the library.
 * 
 * Features:
 * - Save current annotation to library
 * - Load annotations into the view
 * - Rename/delete saved annotations
 * - Assign GT/Pred tags for evaluation
 * - Auto-save annotations imported from cloud/model sources
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.LIBRARY_CHANGED` - Updates UI when library changes
 * - `Events.LIBRARY_CLEARED` - Clears UI when library is cleared
 * - `Events.EVALUATION_GT_CHANGED` - Updates GT indicators
 * - `Events.EVALUATION_PRED_CHANGED` - Updates Pred indicators
 * - `Events.ANNOTATION_IMPORTED` - Auto-saves annotations from external sources (cloud/model)
 * 
 * Emits:
 * - `Events.ANNOTATION_ACTIVE_CHANGED` - When annotation is loaded from library or renamed
 * 
 * ## Memory Optimization
 * 
 * All event subscriptions use namespaces ('libraryPanel') for efficient cleanup.
 * The dispose() method removes all subscriptions via offNamespace() to prevent leaks.
 * 
 * @module LibraryPanel
 */

import { escapeHtml, formatTimestamp, formatMetadataValue } from '../utils/sanitize.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { confirmUnsavedChanges } from '../utils/confirmUnsavedChanges.js';

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

        // Floating action buttons
        this.floatingSaveBtn = document.getElementById('floatingSaveBtn');
        this.normalizeBtn = document.getElementById('normalizeBtn');

        // Save-to-library modal elements
        this.saveModal = document.getElementById('saveToLibraryModal');
        this.saveModalClose = document.getElementById('saveToLibraryModalClose');
        this.saveModalName = document.getElementById('librarySaveName');
        this.saveModalMetadataPreview = document.getElementById('librarySaveMetadataPreview');
        this.saveModalMetadataCount = document.getElementById('librarySaveMetadataCount');
        this.saveModalCloudSection = document.getElementById('librarySaveCloudSection');
        this.saveModalAlsoCloud = document.getElementById('librarySaveAlsoCloud');
        this.saveModalCancelBtn = document.getElementById('librarySaveCancelBtn');
        this.saveModalConfirmBtn = document.getElementById('librarySaveConfirmBtn');
        this._saveModalResolve = null; // Promise resolver for modal

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
        
        // Listen to annotations imported from external sources (cloud, model, import)
        // Auto-save them to the library for tracking and evaluation workflows
        eventBus.on(Events.ANNOTATION_IMPORTED, (data) => {
            this._handleAnnotationImported(data);
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

        // Update floating save button state when edges change
        eventBus.on(Events.STATE_CHANGED, () => {
            this._updateFloatingSaveBtn();
        }, 'libraryPanel');

        eventBus.on(Events.HISTORY_CHANGED, () => {
            this._updateFloatingSaveBtn();
        }, 'libraryPanel');
    }
    
    /**
     * Handle annotations imported from external sources.
     * Automatically saves them to the library and tracks cloud links if applicable.
     * 
     * This allows imported annotations to be:
     * - Visible in the library panel
     * - Tagged as GT/Pred for evaluation
     * - Tracked for cloud sync status
     * 
     * NOTE: This is only called for ANNOTATION_IMPORTED events (external sources).
     * Library-sourced annotations do NOT trigger this - they emit ANNOTATION_ACTIVE_CHANGED instead.
     * 
     * @param {Object} data - Event data
     * @param {Annotation} data.annotation - The imported annotation object
     * @param {string} data.source - Source: 'cloud', 'model', or 'import'
     * @param {Object} [data.cloudInfo] - Cloud-specific info (if source is 'cloud')
     * @param {string} [data.cloudInfo.meshId] - Cloud mesh ID
     * @param {string} [data.cloudInfo.stateId] - Cloud state ID
     * @private
     */
    _handleAnnotationImported(data) {
        const { annotation, source, cloudInfo } = data;
        
        if (!annotation) {
            console.warn('[LibraryPanel] Received ANNOTATION_IMPORTED without annotation object');
            return;
        }
        
        console.log(`[LibraryPanel] Auto-saving imported annotation from ${source}:`, annotation.name);
        
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

        // Floating save button
        this.floatingSaveBtn?.addEventListener('click', () => {
            this.saveCurrentAnnotation();
        });

        // Normalize button
        this.normalizeBtn?.addEventListener('click', () => {
            this.meshView.normalizeAnnotation();
        });

        // Clear library button
        this.clearBtn?.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all saved annotations? This cannot be undone.')) {
                this.library.clear();
            }
        });

        // Save modal buttons
        this.saveModalConfirmBtn?.addEventListener('click', () => {
            const resolve = this._saveModalResolve;
            if (!resolve) return;
            const name = this.saveModalName.value.trim();
            const alsoCloud = this.saveModalAlsoCloud?.checked || false;
            this._closeSaveModal();
            resolve({ name, alsoCloud });
        });
        this.saveModalCancelBtn?.addEventListener('click', () => {
            const resolve = this._saveModalResolve;
            this._closeSaveModal();
            if (resolve) resolve(null);
        });
        this.saveModalClose?.addEventListener('click', () => {
            const resolve = this._saveModalResolve;
            this._closeSaveModal();
            if (resolve) resolve(null);
        });
        // Close on backdrop click
        this.saveModal?.addEventListener('click', (e) => {
            if (e.target === this.saveModal) {
                const resolve = this._saveModalResolve;
                this._closeSaveModal();
                if (resolve) resolve(null);
            }
        });
        // Enter key in name input confirms
        this.saveModalName?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.saveModalConfirmBtn?.click();
            }
        });
    }

    /**
     * Save the current annotation to the library.
     *
     * Opens a modal dialog for the user to set the name and optionally save to cloud.
     * This always creates a NEW library entry ("Save As" semantics).
     *
     * After saving, updates workingAnnotation to link to the new library entry
     * and emits ANNOTATION_ACTIVE_CHANGED so the UI label reflects the new name.
     */
    async saveCurrentAnnotation() {
        let annotation = this.meshView.getAnnotation();
        if (annotation.isEmpty()) {
            alert('Cannot save an empty annotation.');
            return;
        }

        // Open save modal and wait for user input
        const result = await this._openSaveModal(annotation);
        if (!result) return; // Cancelled

        const finalName = result.name || annotation.name || 'Untitled';

        // IMPORTANT: If this annotation ID already exists in the library, we want to
        // create a NEW entry rather than update the existing one. This is "Save As"
        // semantics - the user has modified the annotation and wants to save their
        // current work as a new entry, not overwrite the original.
        if (this.library.has(annotation.id)) {
            // Generate a new ID by cloning with new ID
            annotation = annotation.cloneWithNewId();
        }

        annotation.name = finalName;
        const id = this.library.save(annotation);

        // Link workingAnnotation to the library entry
        if (this.meshView.workingAnnotation) {
            this.meshView.workingAnnotation.id = id;
            this.meshView.workingAnnotation.metadata.name = finalName;
        }

        // Mark current state as saved — reset the baseline for unsaved changes detection
        this.meshView.markAsSaved();

        // Clear history — clean slate for new edits on this saved annotation
        this.meshView.history.clear();

        // Emit ANNOTATION_ACTIVE_CHANGED to update the UI label
        eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
            name: finalName,
            source: 'library'
        });

        // Also save to cloud if requested
        if (result.alsoCloud && this.isMeshCloudSynced()) {
            this.uploadAnnotationToCloud(id);
        }
    }

    /**
     * Open the save-to-library modal dialog.
     * @param {Annotation} annotation - The annotation to save
     * @returns {Promise<{name: string, alsoCloud: boolean}|null>} Resolves with user input or null if cancelled
     * @private
     */
    _openSaveModal(annotation) {
        return new Promise((resolve) => {
            this._saveModalResolve = resolve;

            // Set default name with timestamp
            const now = new Date();
            const dateStr = now.toLocaleDateString();
            const timeStr = now.toLocaleTimeString();
            const currentName = annotation.name || `Annotation ${dateStr} ${timeStr}`;
            this.saveModalName.value = currentName;

            // Populate metadata preview
            this._populateSaveMetadataPreview(annotation);

            // Show/hide cloud section
            if (this.saveModalCloudSection) {
                const meshIsCloud = this.isMeshCloudSynced();
                this.saveModalCloudSection.style.display = meshIsCloud ? '' : 'none';
                if (this.saveModalAlsoCloud) {
                    this.saveModalAlsoCloud.checked = false;
                }
            }

            // Show modal
            this.saveModal.style.display = 'flex';
            this.saveModalName.focus();
            this.saveModalName.select();
        });
    }

    /**
     * Close the save-to-library modal.
     * @private
     */
    _closeSaveModal() {
        if (this.saveModal) {
            this.saveModal.style.display = 'none';
        }
        this._saveModalResolve = null;
    }

    /**
     * Populate the metadata preview in the save modal.
     * @param {Annotation} annotation
     * @private
     */
    _populateSaveMetadataPreview(annotation) {
        if (!this.saveModalMetadataPreview) return;

        const metadata = annotation.metadata || {};
        // Filter out internal/built-in fields
        const displayKeys = Object.keys(metadata).filter(k =>
            !['name', 'source', 'createdAt', 'modifiedAt', 'cloudStateId'].includes(k)
        );

        if (displayKeys.length === 0) {
            this.saveModalMetadataPreview.innerHTML = '<div class="metadata-empty">No additional metadata</div>';
            if (this.saveModalMetadataCount) {
                this.saveModalMetadataCount.textContent = '0 entries';
            }
            return;
        }

        let html = '';
        for (const key of displayKeys) {
            const raw = metadata[key];
            let display;
            if (typeof raw === 'object' && raw !== null) {
                // Compact JSON preview — truncate to keep one-liner
                const json = JSON.stringify(raw);
                display = json.length > 60 ? json.slice(0, 57) + '...' : json;
            } else {
                display = formatMetadataValue(key, raw);
                if (display.length > 80) {
                    display = display.slice(0, 77) + '...';
                }
            }
            html += `<div class="metadata-preview-item">
                <span class="metadata-key">${escapeHtml(key)}</span>
                <span class="metadata-value">${escapeHtml(display)}</span>
            </div>`;
        }
        this.saveModalMetadataPreview.innerHTML = html;

        if (this.saveModalMetadataCount) {
            this.saveModalMetadataCount.textContent = `${displayKeys.length} ${displayKeys.length === 1 ? 'entry' : 'entries'}`;
        }
    }

    /**
     * Update the floating save button enabled state.
     * @private
     */
    _updateFloatingSaveBtn() {
        const hasContent = this.meshView.currentEdgeIndices?.size > 0;
        if (this.floatingSaveBtn) {
            this.floatingSaveBtn.disabled = !hasContent;
        }
        if (this.normalizeBtn) {
            this.normalizeBtn.disabled = !hasContent;
        }
    }

    /**
     * Load an annotation from the library into the view.
     * Checks for unsaved changes first and prompts the user.
     *
     * @param {string} id - Annotation ID
     * @param {boolean} [skipConfirmation=false] - Skip unsaved changes check
     */
    async loadAnnotation(id, skipConfirmation = false) {
        // Check for unsaved changes
        if (!skipConfirmation) {
            const result = await confirmUnsavedChanges(this.meshView);
            if (result === 'cancel') return;
            if (result === 'save') {
                await this.saveCurrentAnnotation();
            }
        }

        const annotation = this.library.load(id);
        if (!annotation) {
            console.warn('Annotation not found:', id);
            return;
        }

        // Update workingAnnotation (THE source of truth)
        if (this.meshView.workingAnnotation) {
            this.meshView.workingAnnotation.id = annotation.id;
            this.meshView.workingAnnotation.metadata = { ...annotation.metadata };
        }

        // Record to history for undo/redo
        this.meshView.startDrawOperation('library-load');
        this.meshView._restoreEdgeState(annotation.edgeIndices);
        this.meshView.finishDrawOperation();

        // Update segments
        const autoSegments = document.getElementById('auto-segments');
        if (autoSegments?.checked) {
            this.meshView.updateSegments();
        }

        // Emit event to update UI
        eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
            name: annotation.name,
            source: 'library'
        });
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
                const trimmedName = newName.trim();
                
                // Update library (persistent storage)
                this.library.rename(id, trimmedName);
                
                // If renaming the currently loaded annotation, update workingAnnotation
                // (THE source of truth for current state)
                if (this.meshView.workingAnnotation?.id === id) {
                    this.meshView.workingAnnotation.metadata.name = trimmedName;
                    
                    // Emit event to update the annotation label
                    eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                        name: trimmedName,
                        source: 'library'
                    });
                }
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
