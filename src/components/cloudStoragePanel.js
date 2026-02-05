/**
 * CloudStoragePanel - UI component for managing cloud storage (meshes and annotations).
 * 
 * ## Terminology
 * 
 * - **Mesh**: The 3D geometry (vertices, faces) stored as a PLY file
 * - **Annotation**: A set of edge labels/annotations for a mesh (called "state" in code)
 * - **Annotation Metadata**: Metadata specific to an annotation (e.g., evaluation metrics)
 * - **Mesh Metadata**: Metadata belonging to the mesh itself (shared across annotations)
 * 
 * Note: In the codebase, "state" often refers to "annotation" for historical reasons.
 * 
 * Features:
 * - List meshes stored on the server
 * - View annotations for each mesh
 * - Save current annotation to cloud (with its annotation metadata)
 * - Load annotations from cloud
 * - Upload new meshes
 * - Download meshes and annotations
 * 
 * Cloud Mesh Tracking:
 * - When a local file is opened, cloud connection resets (cloudMeshInfo = null)
 * - When a mesh is uploaded to cloud, cloudMeshInfo is set
 * - When a mesh is loaded from cloud, cloudMeshInfo is set
 * - When saving an annotation, we verify the mesh matches before saving
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.CONNECTION_CHANGED` - Refreshes mesh list when connection is established
 * - `Events.MESH_LOADED` - Resets cloud connection when local file is loaded
 * 
 * Emits:
 * - `Events.MESH_LOADED` - When a mesh is loaded from cloud storage
 * - `Events.MESH_UPLOADED` - When a mesh is uploaded to cloud storage
 * - `Events.STATE_SAVED` - When an annotation state is saved to cloud
 * - `Events.STATE_LOADED` - When an annotation state is loaded from cloud (cloud-specific)
 * - `Events.ANNOTATION_IMPORTED` - When annotation is loaded from cloud (for library auto-save)
 * - `Events.ANNOTATION_ACTIVE_CHANGED` - When annotation is applied to view (for UI updates)
 * 
 * ## Memory Optimization
 * 
 * All event subscriptions use namespaces ('cloudStoragePanel') for efficient cleanup.
 * The dispose() method removes all subscriptions via offNamespace() to prevent leaks.
 * 
 * @module CloudStoragePanel
 */

import { lithicClient } from '../api/lithicClient.js';
import { exportMeshToBlob } from '../loaders/meshExporter.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { Annotation } from '../geometry/Annotation.js';
import { formatMetadataValue } from '../utils/sanitize.js';

export class CloudStoragePanel {
    /**
     * Create a CloudStoragePanel.
     * @param {MeshView} meshView - The mesh object with annotations
     * @param {MeshLoader} meshLoader - The mesh loader for loading PLY files
     * @param {ConnectionManager} [connectionManager] - Connection manager (legacy, now optional)
     */
    constructor(meshView, meshLoader, connectionManager = null) {
        this.meshView = meshView;
        this.meshLoader = meshLoader;
        this.connectionManager = connectionManager; // Kept for backward compatibility
        
        // State
        this.meshes = [];
        this.selectedMeshId = null;
        this.states = [];
        this.isLoading = false;
        this.searchFilter = '';
        
        /**
         * Cloud mesh connection info. Tracks which cloud mesh the current viewer mesh is linked to.
         * null when no cloud connection (local file loaded).
         * @type {{meshId: string, numVertices: number, numFaces: number, meshMetadata: Object|null}|null}
         */
        this.cloudMeshInfo = null;
        
        // UI Elements
        this.container = document.getElementById('cloudStoragePanel');
        this.meshList = document.getElementById('cloudMeshList');
        this.stateList = document.getElementById('cloudStateList');
        this.statusEl = document.getElementById('cloudStorageStatus');
        this.refreshBtn = document.getElementById('refreshCloudStorageBtn');
        this.uploadMeshBtn = document.getElementById('uploadMeshToCloudBtn');
        this.saveStateBtn = document.getElementById('saveStateToCloudBtn');
        this.meshUploadInput = document.getElementById('cloudMeshUploadInput');
        this.meshSearchInput = document.getElementById('cloudMeshSearch');
        this.meshSearchClear = document.getElementById('cloudMeshSearchClear');
        
        // Save Annotation Modal elements
        this.saveAnnotationModal = document.getElementById('saveAnnotationModal');
        this.saveAnnotationStatus = document.getElementById('saveAnnotationStatus');
        this.saveAnnotationMeshName = document.getElementById('saveAnnotationMeshName');
        this.saveAnnotationMeshHelp = document.getElementById('saveAnnotationMeshHelp');
        this.saveAnnotationName = document.getElementById('saveAnnotationName');
        this.saveAnnotationMetadataCount = document.getElementById('saveAnnotationMetadataCount');
        this.saveAnnotationMetadataPreview = document.getElementById('saveAnnotationMetadataPreview');
        this.saveAnnotationConfirmText = document.getElementById('saveAnnotationConfirmText');
        this.saveAnnotationConfirmBtn = document.getElementById('saveAnnotationConfirmBtn');
        this.saveAnnotationCancelBtn = document.getElementById('saveAnnotationCancelBtn');
        this.saveAnnotationModalClose = document.getElementById('saveAnnotationModalClose');
        // Mesh metadata elements (shown when uploading mesh)
        this.saveMeshMetadataSection = document.getElementById('saveMeshMetadataSection');
        this.saveMeshMetadataCount = document.getElementById('saveMeshMetadataCount');
        this.saveMeshMetadataPreview = document.getElementById('saveMeshMetadataPreview');
        
        this.setupEventListeners();
        this._setupEventBusSubscriptions();
    }
    
    /**
     * Setup EventBus subscriptions.
     * Uses namespace for easy cleanup in dispose().
     * @private
     */
    _setupEventBusSubscriptions() {
        // Listen to connection changes via EventBus
        eventBus.on(Events.CONNECTION_CHANGED, (data) => {
            if (data.isConnected) {
                this.refreshMeshList();
            }
        }, 'cloudStoragePanel');
        
        // Listen to local file loads to reset cloud connection
        eventBus.on(Events.MESH_LOADED, (data) => {
            // Only reset if this was a local file load (not from cloud)
            // Cloud loads have source: 'cloud', local file loads have source: 'file'
            if (data.source === 'file' && !this._loadingFromCloud) {
                console.log('[CloudStorage] Local file loaded, resetting cloud connection');
                this.clearCloudConnection();
            }
        }, 'cloudStoragePanel');
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     * Call this when the panel is being destroyed.
     */
    dispose() {
        eventBus.offNamespace('cloudStoragePanel');
    }
    
    /**
     * Set the cloud mesh connection info.
     * @param {string} meshId - The cloud mesh ID
     * @param {number} numVertices - Number of vertices in the mesh
     * @param {number} numFaces - Number of faces in the mesh
     * @param {Object|null} meshMetadata - Optional mesh metadata from server
     */
    setCloudConnection(meshId, numVertices, numFaces, meshMetadata = null) {
        this.cloudMeshInfo = {
            meshId: meshId,
            numVertices: numVertices,
            numFaces: numFaces,
            meshMetadata: meshMetadata
        };
        console.log('[CloudStorage] Cloud connection set:', this.cloudMeshInfo);
        if (meshMetadata) {
            console.log('[CloudStorage] Mesh metadata from server:', meshMetadata);
        }
        this.updateCloudConnectionUI();
    }
    
    /**
     * Get the current mesh metadata from cloud connection.
     * @returns {Object|null} The mesh metadata or null if not connected
     */
    getCloudMeshMetadata() {
        return this.cloudMeshInfo?.meshMetadata || null;
    }
    
    /**
     * Clear the cloud mesh connection (e.g., when loading a local file).
     */
    clearCloudConnection() {
        this.cloudMeshInfo = null;
        console.log('[CloudStorage] Cloud connection cleared');
        this.updateCloudConnectionUI();
    }
    
    /**
     * Check if current mesh matches the cloud connection.
     * @returns {boolean} True if mesh matches or no cloud connection
     */
    verifyCloudConnection() {
        if (!this.cloudMeshInfo) {
            return false; // No cloud connection
        }
        
        // Verify vertex and face counts match
        const currentVertices = this.meshView.positions.length / 3;
        const currentFaces = this.meshView.indices.length / 3;
        
        const matches = (
            currentVertices === this.cloudMeshInfo.numVertices &&
            currentFaces === this.cloudMeshInfo.numFaces
        );
        
        if (!matches) {
            console.warn('[CloudStorage] Mesh mismatch detected!', {
                expected: this.cloudMeshInfo,
                actual: { numVertices: currentVertices, numFaces: currentFaces }
            });
        }
        
        return matches;
    }
    
    /**
     * Update UI to reflect cloud connection status.
     */
    updateCloudConnectionUI() {
        // Update the save button appearance based on connection
        if (this.saveStateBtn) {
            if (this.cloudMeshInfo) {
                this.saveStateBtn.classList.add('cloud-connected');
                this.saveStateBtn.title = `Save annotation to: ${this.cloudMeshInfo.meshId}`;
            } else {
                this.saveStateBtn.classList.remove('cloud-connected');
                this.saveStateBtn.title = 'Save annotation (will upload mesh first)';
            }
        }
        
        // Re-render mesh list to update current indicator
        this.renderMeshList();
    }

    setupEventListeners() {
        // Refresh button
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.refreshMeshList());
        }
        
        // Upload mesh button
        if (this.uploadMeshBtn) {
            this.uploadMeshBtn.addEventListener('click', () => {
                if (this.meshUploadInput) {
                    this.meshUploadInput.click();
                }
            });
        }
        
        // Mesh upload input
        if (this.meshUploadInput) {
            this.meshUploadInput.addEventListener('change', (e) => this.handleMeshUpload(e));
        }
        
        // Mesh search input
        if (this.meshSearchInput) {
            this.meshSearchInput.addEventListener('input', (e) => this.handleSearchInput(e));
        }
        
        // Mesh search clear button
        if (this.meshSearchClear) {
            this.meshSearchClear.addEventListener('click', () => this.clearSearch());
        }
        
        // Save state button
        if (this.saveStateBtn) {
            this.saveStateBtn.addEventListener('click', () => this.showSaveAnnotationModal());
        }
        
        // Save Annotation Modal event listeners
        if (this.saveAnnotationModalClose) {
            this.saveAnnotationModalClose.addEventListener('click', () => this.closeSaveAnnotationModal());
        }
        
        if (this.saveAnnotationCancelBtn) {
            this.saveAnnotationCancelBtn.addEventListener('click', () => this.closeSaveAnnotationModal());
        }
        
        if (this.saveAnnotationConfirmBtn) {
            this.saveAnnotationConfirmBtn.addEventListener('click', () => this.handleSaveAnnotationConfirm());
        }
        
        // Close modal when clicking outside
        if (this.saveAnnotationModal) {
            this.saveAnnotationModal.addEventListener('click', (e) => {
                if (e.target === this.saveAnnotationModal) {
                    this.closeSaveAnnotationModal();
                }
            });
        }
    }

    /**
     * Called when the panel is shown.
     */
    onShow() {
        if (lithicClient.isConfigured()) {
            this.refreshMeshList();
        } else {
            this.setStatus('Not connected. Configure server connection first.', 'warning');
        }
    }
    
    /**
     * Handle search input changes.
     * @param {Event} e - Input event
     */
    handleSearchInput(e) {
        this.searchFilter = e.target.value.toLowerCase().trim();
        this.updateSearchUI();
        this.renderMeshList();
    }
    
    /**
     * Clear the search filter.
     */
    clearSearch() {
        this.searchFilter = '';
        if (this.meshSearchInput) {
            this.meshSearchInput.value = '';
        }
        this.updateSearchUI();
        this.renderMeshList();
    }
    
    /**
     * Update the search UI state (show/hide clear button).
     */
    updateSearchUI() {
        const searchContainer = this.meshSearchInput?.parentElement;
        if (searchContainer) {
            if (this.searchFilter) {
                searchContainer.classList.add('has-value');
            } else {
                searchContainer.classList.remove('has-value');
            }
        }
    }
    
    /**
     * Get meshes filtered by search term.
     * @returns {Array} Filtered meshes
     */
    getFilteredMeshes() {
        if (!this.searchFilter) {
            return this.meshes;
        }
        return this.meshes.filter(mesh => {
            const name = (mesh.original_name || mesh.filename || '').toLowerCase();
            return name.includes(this.searchFilter);
        });
    }

    /**
     * Refresh the list of meshes from the server.
     */
    async refreshMeshList() {
        if (!lithicClient.isConfigured()) {
            this.setStatus('Not connected to server', 'error');
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Loading meshes...', 'info');
        
        try {
            const response = await lithicClient.listFiles();
            this.meshes = response.files || [];
            
            // Log mesh metadata from server
            const meshesWithMetadata = this.meshes.filter(m => m.mesh_metadata);
            console.log(`[CloudStorage] Loaded ${this.meshes.length} meshes, ${meshesWithMetadata.length} have mesh_metadata`);
            if (meshesWithMetadata.length > 0) {
                console.log('[CloudStorage] Sample mesh_metadata:', meshesWithMetadata[0].mesh_metadata);
            }
            
            this.renderMeshList();
            this.setStatus(`${this.meshes.length} mesh${this.meshes.length !== 1 ? 'es' : ''} found`, 'success');
        } catch (e) {
            console.error('[CloudStorage] Failed to load meshes:', e);
            this.setStatus('Failed to load meshes: ' + e.message, 'error');
            this.meshes = [];
            this.renderMeshList();
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Render the mesh list.
     */
    renderMeshList() {
        if (!this.meshList) return;
        
        if (this.meshes.length === 0) {
            this.meshList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <p>No meshes stored yet</p>
                    <p class="text-xs text-gray-500">Upload a mesh to get started</p>
                </div>
            `;
            return;
        }
        
        const filteredMeshes = this.getFilteredMeshes();
        
        if (filteredMeshes.length === 0) {
            this.meshList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No meshes match "${this.escapeHtml(this.searchFilter)}"</p>
                    <p class="text-xs text-gray-500">${this.meshes.length} mesh${this.meshes.length !== 1 ? 'es' : ''} total</p>
                </div>
            `;
            return;
        }
        
        this.meshList.innerHTML = filteredMeshes.map(mesh => this.createMeshItem(mesh)).join('');
        
        // Setup click handlers
        this.meshList.querySelectorAll('.cloud-mesh-item').forEach(item => {
            const meshId = item.dataset.meshId;
            
            // Expand/collapse states
            item.querySelector('.mesh-item-header')?.addEventListener('click', () => {
                this.toggleMeshExpanded(meshId);
            });
            
            // Save to library button
            item.querySelector('.save-to-library-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.saveToLibrary(meshId);
            });
            
            // Load mesh button
            item.querySelector('.load-mesh-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.loadMesh(meshId);
            });
            
            // Delete mesh button
            item.querySelector('.delete-mesh-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteMesh(meshId);
            });
        });
        
        // If a mesh is currently expanded, load its states
        if (this.selectedMeshId) {
            this.loadStates(this.selectedMeshId);
        }
    }

    /**
     * Create HTML for a mesh item.
     */
    createMeshItem(mesh) {
        const isExpanded = this.selectedMeshId === mesh.filename;
        const isCurrentMesh = this.cloudMeshInfo?.meshId === mesh.filename;
        const date = new Date(mesh.uploaded_at).toLocaleDateString();
        const sizeKB = (mesh.size_bytes / 1024).toFixed(0);
        const sizeMB = (mesh.size_bytes / (1024 * 1024)).toFixed(1);
        const sizeStr = mesh.size_bytes > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
        const hasAnnotations = mesh.state_count > 0;
        
        return `
            <div class="cloud-mesh-item ${isExpanded ? 'expanded' : ''} ${isCurrentMesh ? 'current' : ''}" data-mesh-id="${mesh.filename}">
                <div class="mesh-item-header">
                    <div class="mesh-item-icon">
                        <i class="fas fa-cube"></i>
                    </div>
                    <div class="mesh-item-info">
                        <div class="mesh-item-name">${mesh.original_name}</div>
                        <div class="mesh-item-meta">
                            ${mesh.num_vertices.toLocaleString()} vertices · ${sizeStr} · ${date}
                        </div>
                        ${hasAnnotations ? `<div class="mesh-item-meta"><span class="state-count">${mesh.state_count} annotation(s)</span></div>` : ''}
                    </div>
                    <div class="mesh-item-actions">
                        <button class="icon-btn save-to-library-btn" title="Save mesh & annotations to library">
                            <i class="fas fa-bookmark"></i>
                        </button>
                        <button class="icon-btn load-mesh-btn" title="Load mesh">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="icon-btn delete-mesh-btn" title="Delete mesh">
                            <i class="fas fa-trash"></i>
                        </button>
                        <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'} expand-icon"></i>
                    </div>
                </div>
                <div class="mesh-item-states" id="states-${mesh.filename}">
                    ${isExpanded ? this.renderStatesPlaceholder(mesh.filename) : ''}
                </div>
            </div>
        `;
    }

    /**
     * Toggle mesh expanded state to show/hide states.
     */
    async toggleMeshExpanded(meshId) {
        if (this.selectedMeshId === meshId) {
            // Collapse
            this.selectedMeshId = null;
            this.states = [];
            this.renderMeshList();
        } else {
            // Expand and load states
            this.selectedMeshId = meshId;
            this.renderMeshList();
            await this.loadStates(meshId);
        }
    }

    /**
     * Render placeholder while loading states.
     */
    renderStatesPlaceholder(meshId) {
        return `<div class="states-loading"><i class="fas fa-spinner fa-spin"></i> Loading states...</div>`;
    }

    /**
     * Load states for a mesh.
     */
    async loadStates(meshId) {
        const statesContainer = document.getElementById(`states-${meshId}`);
        if (!statesContainer) return;
        
        try {
            console.log('[CloudStorage] Loading states for mesh:', meshId);
            const response = await lithicClient.listStates(meshId);
            console.log('[CloudStorage] States response:', response);
            this.states = response.states || [];
            console.log('[CloudStorage] Loaded', this.states.length, 'states');
            this.renderStatesList(meshId, statesContainer);
        } catch (e) {
            console.error('[CloudStorage] Failed to load states:', e);
            statesContainer.innerHTML = `<div class="states-error">Failed to load states</div>`;
        }
    }

    /**
     * Render the states list for a mesh.
     */
    renderStatesList(meshId, container) {
        if (this.states.length === 0) {
            container.innerHTML = `
                <div class="states-empty">
                    <p>No saved states</p>
                    <p class="text-xs text-gray-500">Load this mesh and save a state</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div class="states-list">
                ${this.states.map(state => this.createStateItem(meshId, state)).join('')}
            </div>
        `;
        
        // Setup state item handlers
        container.querySelectorAll('.cloud-state-item').forEach(item => {
            const stateId = item.dataset.stateId;
            
            // Load state
            item.querySelector('.load-state-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.loadState(meshId, stateId);
            });
            
            // Delete state
            item.querySelector('.delete-state-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteState(meshId, stateId);
            });
        });
    }

    /**
     * Create HTML for a state item.
     */
    createStateItem(meshId, state) {
        const date = new Date(state.created_at).toLocaleDateString();
        const time = new Date(state.created_at).toLocaleTimeString();
        
        return `
            <div class="cloud-state-item" data-state-id="${state.state_id}">
                <div class="state-item-icon">
                    <i class="fas fa-layer-group"></i>
                </div>
                <div class="state-item-info">
                    <div class="state-item-name">${state.name || state.state_id}</div>
                    <div class="state-item-meta">${state.edge_count.toLocaleString()} edges · ${date} ${time}</div>
                </div>
                <div class="state-item-actions">
                    <button class="icon-btn load-state-btn" title="Load state">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="icon-btn delete-state-btn" title="Delete state">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Handle mesh file upload (supports multiple files).
     * Separates mesh geometry from annotation (labels) and uploads them separately.
     */
    async handleMeshUpload(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;
        
        // Validate file types
        const invalidFiles = files.filter(f => !f.name.toLowerCase().endsWith('.ply'));
        if (invalidFiles.length > 0) {
            this.setStatus(`Only PLY files are supported. Invalid: ${invalidFiles.map(f => f.name).join(', ')}`, 'error');
            return;
        }
        
        this.setLoading(true);
        const totalFiles = files.length;
        let successCount = 0;
        let annotationCount = 0;
        
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                this.setStatus(`Processing ${i + 1}/${totalFiles}: ${file.name}...`, 'info');
                
                try {
                    const result = await this.uploadMeshFileWithAnnotation(file);
                    successCount++;
                    if (result.hasAnnotation) {
                        annotationCount++;
                    }
                } catch (e) {
                    console.error(`[CloudStorage] Failed to upload ${file.name}:`, e);
                    // Continue with other files
                }
            }
            
            // Summary status
            if (successCount === totalFiles) {
                let msg = `${successCount} mesh${successCount !== 1 ? 'es' : ''} uploaded`;
                if (annotationCount > 0) {
                    msg += ` with ${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}`;
                }
                this.setStatus(msg + '!', 'success');
            } else {
                this.setStatus(`Uploaded ${successCount}/${totalFiles} meshes`, successCount > 0 ? 'warning' : 'error');
            }
            
            await this.refreshMeshList();
        } catch (e) {
            console.error('[CloudStorage] Upload failed:', e);
            this.setStatus('Upload failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
            // Reset file input
            event.target.value = '';
        }
    }
    
    /**
     * Upload a single mesh file, separating mesh from annotation.
     * - Parses the PLY file to extract geometry and labels
     * - Uploads mesh geometry (without labels) to cloud
     * - If labels exist, saves them as an annotation named "annotation"
     * 
     * @param {File} file - The PLY file to upload
     * @returns {Promise<{meshId: string, hasAnnotation: boolean}>} Upload result
     */
    async uploadMeshFileWithAnnotation(file) {
        // Read and parse the PLY file
        const arrayBuffer = await file.arrayBuffer();
        const { positions, labels, indices, metadata } = this.parsePLYFile(arrayBuffer);
        
        // Check if there are any annotations (non-zero labels)
        const hasAnnotation = labels && labels.length > 0 && labels.some(l => l !== 0);
        
        // Create a PLY blob with just geometry (no labels)
        const meshBlob = exportMeshToBlob(positions, indices, metadata);
        const meshFile = new File([meshBlob], file.name, { type: 'application/octet-stream' });
        
        // Upload the mesh
        const uploadResult = await lithicClient.uploadFile(meshFile);
        const meshId = uploadResult.filename;
        
        // If the PLY file had metadata, save it to the server
        if (metadata && Object.keys(metadata).length > 0) {
            console.log(`[CloudStorage] Saving mesh metadata for ${file.name}:`, metadata);
            try {
                await lithicClient.updateMeshMetadata(meshId, metadata);
            } catch (e) {
                console.warn(`[CloudStorage] Failed to save mesh metadata for ${file.name}:`, e);
            }
        }
        
        // If there are annotations, save them as a state
        if (hasAnnotation) {
            // Convert labels array to edge indices (indices where label is non-zero)
            const edgeIndices = [];
            for (let i = 0; i < labels.length; i++) {
                if (labels[i] !== 0) {
                    edgeIndices.push(i);
                }
            }
            
            // Save the annotation state
            await lithicClient.saveState(
                meshId,
                edgeIndices,
                'annotation',  // Name the state "annotation"
                '',
                {}  // No additional metadata for now
            );
            
            console.log(`[CloudStorage] Saved annotation with ${edgeIndices.length} edges for ${file.name}`);
        }
        
        return { meshId, hasAnnotation };
    }
    
    /**
     * Parse a PLY file to extract geometry, labels, and metadata.
     * Uses the same PLY loader as the mesh loader.
     * 
     * @param {ArrayBuffer} data - PLY file content
     * @returns {{positions: Float32Array, labels: Array, indices: Array, metadata: Object}}
     */
    parsePLYFile(data) {
        const loader = new (this.meshLoader.loader.constructor)();
        const geometry = loader.parse(data);
        
        const positions = geometry.attributes.position.array;
        const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);
        
        // Extract labels if present
        let labels = [];
        const labelIds = geometry.attributes.labelid ? geometry.attributes.labelid.array : [];
        
        if (labelIds.length > 0 && !geometry.attributes.labels) {
            // Calculate edge labels from label IDs
            labels = this.calculateVertexEdgeLabelsFromLabelIds(indices, labelIds);
        } else if (geometry.attributes.labels) {
            labels = Array.from(geometry.attributes.labels.array);
        }
        
        const metadata = geometry.userData.metadata || {};
        
        return { positions, labels, indices, metadata };
    }
    
    /**
     * Calculate vertex edge labels from face label IDs.
     * A vertex is an edge vertex if adjacent faces have different labels.
     * 
     * @param {Array} indices - Face indices
     * @param {Array} labelIds - Per-vertex label IDs
     * @returns {Array} Per-vertex edge labels (0 or 1)
     */
    calculateVertexEdgeLabelsFromLabelIds(indices, labelIds) {
        if (indices.length === 0 || labelIds.length === 0) return [];
        
        const vertexEdgeLabels = new Array(labelIds.length).fill(0);
        
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

    /**
     * Load a mesh from cloud storage.
     */
    async loadMesh(meshId) {
        if (!lithicClient.isConfigured()) {
            this.setStatus('Not connected to server', 'error');
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Loading mesh...', 'info');
        
        try {
            // Get metadata for the mesh
            const meta = this.meshes.find(m => m.filename === meshId);
            if (!meta) {
                throw new Error('Mesh metadata not found');
            }
            
            // Get the download URL and fetch the file
            const url = `${lithicClient.serverUrl}/files/${encodeURIComponent(meshId)}/download`;
            const response = await fetch(url, {
                headers: {
                    'X-API-Key': lithicClient.apiToken
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Download failed: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            const filename = meta.original_name || 'mesh.ply';
            
            // Convert response to blob and then to File
            const blob = await response.blob();
            const file = new File([blob], filename, { type: 'application/octet-stream' });
            
            // Set flag to prevent clearing cloud connection when meshLoader fires its listener
            this._loadingFromCloud = true;
            
            // Load into the viewer using meshLoader
            await this.meshLoader.loadFile(file);
            
            // Clear the flag
            this._loadingFromCloud = false;
            
            // Log mesh metadata that was loaded from the PLY file
            const loadedMeshMetadata = this.meshLoader.getAllMetadata();
            console.log('[CloudStorage] Mesh metadata loaded from PLY file:', loadedMeshMetadata);
            console.log('[CloudStorage] Mesh metadata from server (mesh_metadata):', meta.mesh_metadata);
            
            // Merge server's mesh_metadata into meshLoader's metadata
            // This makes the CSV data (stored on server) available alongside PLY file metadata
            if (meta.mesh_metadata && typeof meta.mesh_metadata === 'object') {
                console.log('[CloudStorage] Merging server mesh_metadata into meshLoader');
                this.meshLoader.updateMetadata(meta.mesh_metadata);
            }
            
            // Set cloud connection with mesh info from metadata (including server mesh_metadata)
            this.setCloudConnection(meshId, meta.num_vertices, meta.num_faces, meta.mesh_metadata);
            
            // Update file name display in navbar
            const fileNameDisplay = document.getElementById('fileName');
            if (fileNameDisplay) {
                fileNameDisplay.textContent = filename;
                fileNameDisplay.title = `Cloud: ${meshId}`;
            }
            
            this.setStatus('Mesh loaded successfully!', 'success');
            
            // Emit event for other components
            eventBus.emit(Events.MESH_LOADED, {
                source: 'cloud',
                meshId: meshId,
                filename: filename
            });
        } catch (e) {
            this._loadingFromCloud = false;
            console.error('[CloudStorage] Load mesh failed:', e);
            this.setStatus('Failed to load mesh: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Delete a mesh from cloud storage.
     */
    async deleteMesh(meshId) {
        const mesh = this.meshes.find(m => m.filename === meshId);
        const name = mesh?.original_name || meshId;
        
        if (!confirm(`Delete "${name}" and all its states? This cannot be undone.`)) {
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Deleting mesh...', 'info');
        
        try {
            await lithicClient.deleteFile(meshId);
            
            // Clear cloud connection if we deleted the connected mesh
            if (this.cloudMeshInfo?.meshId === meshId) {
                this.clearCloudConnection();
            }
            
            this.setStatus('Mesh deleted', 'success');
            await this.refreshMeshList();
        } catch (e) {
            console.error('[CloudStorage] Delete failed:', e);
            this.setStatus('Delete failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Load a state from cloud storage.
     * 
     * After loading, emits:
     * - `Events.STATE_LOADED` - for cloud-specific tracking
     * - `Events.ANNOTATION_IMPORTED` - for library auto-save
     * - `Events.ANNOTATION_ACTIVE_CHANGED` - for UI updates (label, etc.)
     */
    async loadState(meshId, stateId) {
        // Check if the correct mesh is loaded
        if (this.cloudMeshInfo?.meshId !== meshId) {
            const mesh = this.meshes.find(m => m.filename === meshId);
            const name = mesh?.original_name || meshId;
            
            if (confirm(`This state is for "${name}". Load the mesh first?`)) {
                await this.loadMesh(meshId);
                // Verify mesh loaded successfully
                if (this.cloudMeshInfo?.meshId !== meshId) {
                    this.setStatus('Failed to load mesh', 'error');
                    return;
                }
            } else {
                return;
            }
        }
        
        this.setLoading(true);
        this.setStatus('Loading state...', 'info');
        
        try {
            console.log('[CloudStorage] Loading state:', meshId, stateId);
            const stateData = await lithicClient.loadState(meshId, stateId);
            console.log('[CloudStorage] State data received:', stateData);
            console.log('[CloudStorage] State metadata from server:', stateData.metadata);
            
            // Create Annotation object from cloud data
            // This is the canonical representation that will be saved to library
            const annotation = this._createAnnotationFromCloudState(stateData, stateId);
            
            // Apply the state to the mesh view
            this.applyState(stateData);
            
            this.setStatus('State loaded successfully!', 'success');
            
            // Emit STATE_LOADED for cloud-specific tracking
            eventBus.emit(Events.STATE_LOADED, {
                meshId: meshId,
                stateId: stateId,
                metadata: stateData.metadata
            });
            
            // Emit ANNOTATION_IMPORTED for library auto-save
            eventBus.emit(Events.ANNOTATION_IMPORTED, {
                annotation: annotation,
                source: 'cloud',
                cloudInfo: {
                    meshId: meshId,
                    stateId: stateId
                }
            });
            
            // Emit ANNOTATION_ACTIVE_CHANGED for UI updates (label, etc.)
            eventBus.emit(Events.ANNOTATION_ACTIVE_CHANGED, {
                name: annotation.name,
                source: 'cloud'
            });
        } catch (e) {
            console.error('[CloudStorage] Load state failed:', e);
            this.setStatus('Failed to load state: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }
    
    /**
     * Save a cloud mesh and all its annotations to the local library.
     * This downloads the mesh, loads all its annotations, saves them to the library,
     * and switches to the library panel for seamless workflow.
     * 
     * @param {string} meshId - The cloud mesh ID to save to library
     */
    async saveToLibrary(meshId) {
        if (!lithicClient.isConfigured()) {
            this.setStatus('Not connected to server', 'error');
            return;
        }
        
        const mesh = this.meshes.find(m => m.filename === meshId);
        if (!mesh) {
            this.setStatus('Mesh not found', 'error');
            return;
        }
        
        const meshName = mesh.original_name || meshId;
        
        this.setLoading(true);
        this.setStatus(`Saving "${meshName}" to library...`, 'info');
        
        try {
            // Step 1: Load the mesh into the viewer
            await this.loadMesh(meshId);
            
            // Verify mesh loaded successfully
            if (this.cloudMeshInfo?.meshId !== meshId) {
                throw new Error('Failed to load mesh');
            }
            
            // Step 2: Fetch all annotations for this mesh
            const statesResponse = await lithicClient.listStates(meshId);
            const states = statesResponse.states || [];
            
            console.log(`[CloudStorage] Saving ${states.length} annotations to library for mesh: ${meshName}`);
            
            // Step 3: Load and save each annotation to the library
            let savedCount = 0;
            for (const state of states) {
                try {
                    // Fetch the full state data
                    const stateData = await lithicClient.loadState(meshId, state.state_id);
                    
                    // Create annotation object
                    const annotation = this._createAnnotationFromCloudState(stateData, state.state_id);
                    
                    // Emit ANNOTATION_IMPORTED to auto-save to library
                    // Note: We do NOT emit ANNOTATION_ACTIVE_CHANGED here because
                    // these annotations are being saved to library, not applied to the view
                    eventBus.emit(Events.ANNOTATION_IMPORTED, {
                        annotation: annotation,
                        source: 'cloud',
                        cloudInfo: {
                            meshId: meshId,
                            stateId: state.state_id
                        }
                    });
                    
                    savedCount++;
                } catch (e) {
                    console.warn(`[CloudStorage] Failed to load annotation ${state.state_id}:`, e);
                }
            }
            
            // Step 4: Update status and switch to library panel
            const annotationMsg = savedCount > 0 
                ? ` with ${savedCount} annotation${savedCount !== 1 ? 's' : ''}`
                : '';
            this.setStatus(`Saved "${meshName}"${annotationMsg} to library!`, 'success');
            
            // Step 5: Switch to the library panel
            eventBus.emit(Events.SWITCH_PANEL, { panelId: 'libraryPanel' });
            
        } catch (e) {
            console.error('[CloudStorage] Save to library failed:', e);
            this.setStatus('Failed to save to library: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Create an Annotation object from cloud state data.
     * This creates a lightweight, serializable annotation for use by the library and other components.
     * 
     * @param {Object} stateData - State data from cloud
     * @param {Array<number>} stateData.edge_indices - Edge vertex indices
     * @param {Object} [stateData.metadata] - Cloud state metadata
     * @param {string} stateId - Cloud state ID
     * @returns {Annotation} Annotation object
     * @private
     */
    _createAnnotationFromCloudState(stateData, stateId) {
        const edgeIndices = new Set(stateData.edge_indices || []);
        const name = stateData.metadata?.name || stateData.name || 'Cloud annotation';
        
        // Build annotation metadata from cloud state metadata
        const metadata = {
            name: name,
            source: 'cloud',
            cloudStateId: stateId,
            ...(stateData.metadata || {})
        };
        
        return new Annotation({
            edgeIndices: edgeIndices,
            arrows: [], // Cloud states don't currently store arrows
            metadata: metadata
        });
    }

    /**
     * Apply a loaded state to the mesh.
     * @param {Object} stateData - The state data to apply
     * @param {Array<number>} stateData.edge_indices - Array of edge indices to apply
     * @param {Object} [stateData.metadata] - Optional metadata for the state
     */
    applyState(stateData) {
        if (!stateData || !Array.isArray(stateData.edge_indices)) {
            console.error('[CloudStorage] Invalid state data received:', stateData);
            this.setStatus('Failed to apply state: invalid data format', 'error');
            return;
        }
        const edgeIndices = new Set(stateData.edge_indices);
        
        // Start a draw operation for history tracking
        const description = stateData.metadata?.name || stateData.name || 'Cloud state';
        this.meshView.startDrawOperation('cloud');
        this.meshView.pendingAction.description = `Loaded: ${description}`;
        
        // Clear current edges
        this.meshView.currentEdgeIndices.forEach(index => {
            this.meshView.edgeLabels[index] = 0;
            this.meshView.colorVertex(index, this.meshView.objectColor);
        });
        this.meshView.currentEdgeIndices.clear();
        
        // Apply loaded edges
        edgeIndices.forEach(index => {
            if (index < this.meshView.edgeLabels.length) {
                this.meshView.edgeLabels[index] = 1;
                this.meshView.colorVertex(index, this.meshView.edgeColor);
                this.meshView.currentEdgeIndices.add(index);
            }
        });
        
        // Finish draw operation
        this.meshView.finishDrawOperation();
        
        // Apply loaded annotation metadata to the current state and workingAnnotation
        if (stateData.metadata && typeof stateData.metadata === 'object') {
            console.log('[CloudStorage] Applying annotation metadata:', stateData.metadata);
            this.meshView.updateCurrentStateMetadata(stateData.metadata);
            
            // Also update workingAnnotation metadata so getAnnotation() returns correct name
            if (this.meshView.workingAnnotation) {
                Object.assign(this.meshView.workingAnnotation.metadata, stateData.metadata);
            }
        }
        
        // Update segments if auto-segmentation is enabled
        if (document.getElementById('auto-segments')?.checked) {
            this.meshView.updateSegments();
        }
    }

    /**
     * Delete a state from cloud storage.
     */
    async deleteState(meshId, stateId) {
        const state = this.states.find(s => s.state_id === stateId);
        const name = state?.name || stateId;
        
        if (!confirm(`Delete state "${name}"?`)) {
            return;
        }
        
        this.setLoading(true);
        
        try {
            await lithicClient.deleteState(meshId, stateId);
            this.setStatus('State deleted', 'success');
            await this.loadStates(meshId);
            await this.refreshMeshList(); // Update state counts
        } catch (e) {
            console.error('[CloudStorage] Delete state failed:', e);
            this.setStatus('Delete failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Show the save annotation modal.
     */
    showSaveAnnotationModal() {
        // Check if we have a mesh loaded
        if (this.meshView.isNull()) {
            this.setStatus('No mesh loaded', 'error');
            return;
        }
        
        if (!lithicClient.isConfigured()) {
            this.setStatus('Not connected to server', 'error');
            return;
        }
        
        // Determine if we have a cloud connection and if mesh matches
        const hasCloudConnection = this.cloudMeshInfo !== null;
        const meshMatches = hasCloudConnection && this.verifyCloudConnection();
        
        // If cloud connected but mesh doesn't match, treat as not connected
        const effectivelyConnected = hasCloudConnection && meshMatches;
        
        // Update status indicator
        this.updateSaveAnnotationStatusUI(effectivelyConnected);
        
        // Update mesh name field
        this.updateMeshNameField(effectivelyConnected);
        
        // Set default annotation name
        const defaultAnnotationName = `Annotation ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
        this.saveAnnotationName.value = defaultAnnotationName;
        
        // Update metadata previews
        this.updateMeshMetadataPreview(effectivelyConnected);
        this.updateAnnotationMetadataPreview();
        
        // Update confirm button text
        if (effectivelyConnected) {
            this.saveAnnotationConfirmText.textContent = 'Save Annotation';
        } else {
            this.saveAnnotationConfirmText.textContent = 'Upload & Save';
        }
        
        // Show the modal
        this.saveAnnotationModal.style.display = 'flex';
    }
    
    /**
     * Close the save annotation modal.
     */
    closeSaveAnnotationModal() {
        this.saveAnnotationModal.style.display = 'none';
    }
    
    /**
     * Update the status indicator in the save annotation modal.
     * @param {boolean} isConnected - Whether mesh is connected to cloud
     */
    updateSaveAnnotationStatusUI(isConnected) {
        const statusEl = this.saveAnnotationStatus;
        if (!statusEl) return;
        
        if (isConnected) {
            statusEl.className = 'save-annotation-status cloud-connected';
            const meshName = this.meshes.find(m => m.filename === this.cloudMeshInfo.meshId)?.original_name || this.cloudMeshInfo.meshId;
            statusEl.innerHTML = `
                <div class="status-icon">
                    <i class="fas fa-cloud"></i>
                </div>
                <div class="status-text">
                    <span class="status-title">Mesh is in cloud</span>
                    <span class="status-subtitle">Saving to: ${meshName}</span>
                </div>
            `;
        } else {
            statusEl.className = 'save-annotation-status not-connected';
            statusEl.innerHTML = `
                <div class="status-icon">
                    <i class="fas fa-cloud-upload-alt"></i>
                </div>
                <div class="status-text">
                    <span class="status-title">Mesh not in cloud</span>
                    <span class="status-subtitle">Will upload mesh first</span>
                </div>
            `;
        }
    }
    
    /**
     * Update the mesh name field based on cloud connection.
     * @param {boolean} isConnected - Whether mesh is connected to cloud
     */
    updateMeshNameField(isConnected) {
        if (!this.saveAnnotationMeshName) return;
        
        if (isConnected) {
            // Mesh is in cloud - show read-only name
            const meshName = this.meshes.find(m => m.filename === this.cloudMeshInfo.meshId)?.original_name || this.cloudMeshInfo.meshId;
            this.saveAnnotationMeshName.value = meshName;
            this.saveAnnotationMeshName.classList.add('readonly');
            this.saveAnnotationMeshName.readOnly = true;
            this.saveAnnotationMeshHelp.textContent = 'Mesh is already stored in cloud.';
        } else {
            // Mesh is local - editable name
            const currentFileName = this.meshLoader.currentFileName || 'Untitled Mesh';
            this.saveAnnotationMeshName.value = currentFileName;
            this.saveAnnotationMeshName.classList.remove('readonly');
            this.saveAnnotationMeshName.readOnly = false;
            this.saveAnnotationMeshHelp.textContent = 'This name will be used when uploading the mesh to cloud storage.';
        }
    }
    
    /**
     * Update the mesh metadata preview in the save annotation modal.
     * Only shown when the mesh needs to be uploaded.
     * @param {boolean} isConnected - Whether mesh is already in cloud
     */
    updateMeshMetadataPreview(isConnected) {
        if (!this.saveMeshMetadataSection) return;
        
        // Only show mesh metadata section when mesh needs to be uploaded
        if (isConnected) {
            this.saveMeshMetadataSection.style.display = 'none';
            return;
        }
        
        this.saveMeshMetadataSection.style.display = 'block';
        
        // Get mesh metadata
        const meshMetadata = this.meshLoader.getAllMetadata();
        const entries = Object.entries(meshMetadata);
        
        // Update count badge
        if (this.saveMeshMetadataCount) {
            this.saveMeshMetadataCount.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
        }
        
        if (entries.length === 0) {
            this.saveMeshMetadataPreview.innerHTML = '<div class="metadata-empty">No mesh metadata</div>';
            return;
        }
        
        // Build preview HTML
        const html = this.buildMetadataPreviewHTML(entries);
        this.saveMeshMetadataPreview.innerHTML = html;
    }
    
    /**
     * Update the annotation metadata preview in the save annotation modal.
     * Shows the annotation metadata (state-specific metadata) that will be saved.
     */
    updateAnnotationMetadataPreview() {
        if (!this.saveAnnotationMetadataPreview) return;
        
        // Get current annotation metadata (state-specific metadata)
        const annotationMetadata = this.meshView.getCurrentStateMetadata();
        const entries = Object.entries(annotationMetadata);
        
        // Update count badge
        if (this.saveAnnotationMetadataCount) {
            this.saveAnnotationMetadataCount.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
        }
        
        if (entries.length === 0) {
            this.saveAnnotationMetadataPreview.innerHTML = '<div class="metadata-empty">No annotation metadata</div>';
            return;
        }
        
        // Build preview HTML
        const html = this.buildMetadataPreviewHTML(entries);
        this.saveAnnotationMetadataPreview.innerHTML = html;
    }
    
    /**
     * Build HTML for metadata preview from entries.
     * @param {Array} entries - Array of [key, value] pairs
     * @returns {string} HTML string
     */
    buildMetadataPreviewHTML(entries) {
        return entries.map(([key, value]) => {
            // Use centralized formatter which handles timestamps
            const displayValue = formatMetadataValue(key, value);
            return `
                <div class="metadata-preview-item">
                    <span class="metadata-preview-key">${this.escapeHtml(key)}</span>
                    <span class="metadata-preview-value">${this.escapeHtml(displayValue)}</span>
                </div>
            `;
        }).join('');
    }
    
    /**
     * Escape HTML special characters.
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    /**
     * Handle save annotation confirm button click.
     */
    async handleSaveAnnotationConfirm() {
        const annotationName = this.saveAnnotationName.value.trim() || `Annotation ${new Date().toLocaleString()}`;
        const meshName = this.saveAnnotationMeshName.value.trim();
        
        const hasCloudConnection = this.cloudMeshInfo !== null;
        const meshMatches = hasCloudConnection && this.verifyCloudConnection();
        const effectivelyConnected = hasCloudConnection && meshMatches;
        
        // Close modal first
        this.closeSaveAnnotationModal();
        
        if (effectivelyConnected) {
            // Directly save the annotation
            await this.saveCurrentState(annotationName);
        } else {
            // Need to upload mesh first
            await this.uploadCurrentMeshAndSaveState(meshName, annotationName);
        }
    }
    
    /**
     * Show dialog to save current state (legacy method, now redirects to modal).
     * @deprecated Use showSaveAnnotationModal instead
     */
    showSaveStateDialog() {
        this.showSaveAnnotationModal();
    }

    /**
     * Upload the currently loaded mesh to cloud storage.
     * @param {string} [customName] - Optional custom name for the mesh (without .ply extension)
     * @returns {Promise<string|null>} The mesh ID if successful, null otherwise
     */
    async uploadCurrentMesh(customName) {
        if (this.meshView.isNull()) {
            this.setStatus('No mesh loaded', 'error');
            return null;
        }
        
        this.setLoading(true);
        this.setStatus('Uploading current mesh...', 'info');
        
        try {
            // Export current mesh to PLY blob
            const plyBlob = this.exportMeshToPLY();
            const baseName = customName || this.meshLoader.currentFileName || 'mesh';
            const filename = baseName.endsWith('.ply') ? baseName : baseName + '.ply';
            const file = new File([plyBlob], filename, { type: 'application/octet-stream' });
            
            const result = await lithicClient.uploadFile(file);
            console.log('[CloudStorage] Upload result:', result);
            
            const meshId = result.filename;
            
            // If we have mesh metadata in meshLoader, save it to the server
            const currentMeshMetadata = this.meshLoader.getAllMetadata();
            console.log('[CloudStorage] Current meshLoader metadata:', currentMeshMetadata);
            
            if (Object.keys(currentMeshMetadata).length > 0) {
                console.log('[CloudStorage] Saving mesh metadata to server...');
                try {
                    await lithicClient.updateMeshMetadata(meshId, currentMeshMetadata);
                    console.log('[CloudStorage] Mesh metadata saved successfully');
                } catch (e) {
                    console.warn('[CloudStorage] Failed to save mesh metadata:', e);
                    // Don't fail the upload, just warn
                }
            }
            
            // Set cloud connection with current mesh info
            const numVertices = this.meshView.positions.length / 3;
            const numFaces = this.meshView.indices.length / 3;
            this.setCloudConnection(meshId, numVertices, numFaces, currentMeshMetadata);
            
            this.setStatus('Mesh uploaded!', 'success');
            await this.refreshMeshList();
            
            // Emit event for other components
            eventBus.emit(Events.MESH_UPLOADED, {
                meshId: result.filename,
                numVertices: numVertices,
                numFaces: numFaces
            });
            
            return result.filename;
        } catch (e) {
            console.error('[CloudStorage] Upload failed:', e);
            this.setStatus('Upload failed: ' + e.message, 'error');
            return null;
        } finally {
            this.setLoading(false);
        }
    }
    
    /**
     * Upload the current mesh and then save the current state.
     * Used when saving a state for a mesh that's not yet in cloud storage.
     * @param {string} [meshName] - Optional custom mesh name for upload
     * @param {string} [annotationName] - Optional annotation name (will prompt if not provided)
     */
    async uploadCurrentMeshAndSaveState(meshName, annotationName) {
        // First, upload the mesh
        const meshId = await this.uploadCurrentMesh(meshName);
        
        if (!meshId) {
            // Upload failed, error already shown
            return;
        }
        
        // If annotation name not provided, prompt for it
        if (!annotationName) {
            const name = prompt('Enter a name for this annotation:', `Annotation ${new Date().toLocaleString()}`);
            if (name === null) {
                this.setStatus('Mesh uploaded. Annotation save cancelled.', 'info');
                return;
            }
            annotationName = name;
        }
        
        // Now save the state
        await this.saveCurrentState(annotationName);
    }

    /**
     * Export current mesh to PLY format with mesh metadata.
     * Uses the shared exportMeshToBlob function from meshExporter.
     * @returns {Blob} PLY file as a Blob
     */
    exportMeshToPLY() {
        const positions = this.meshView.positions;
        const indices = this.meshView.indices;
        
        // Get mesh metadata to include in the PLY file
        const meshMetadata = this.meshLoader.getAllMetadata();
        
        return exportMeshToBlob(positions, indices, meshMetadata);
    }

    /**
     * Save current annotation state to cloud.
     */
    async saveCurrentState(name) {
        if (!this.cloudMeshInfo) {
            this.setStatus('No cloud mesh connection', 'error');
            return;
        }
        
        if (!lithicClient.isConfigured()) {
            this.setStatus('Not connected to server', 'error');
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Saving annotation...', 'info');
        
        try {
            // Get current edge indices
            const edgeIndices = Array.from(this.meshView.currentEdgeIndices);
            
            // Get current annotation metadata (state-specific metadata)
            const annotationMetadata = this.meshView.getCurrentStateMetadata();
            
            const meshId = this.cloudMeshInfo.meshId;
            console.log('[CloudStorage] Saving annotation to mesh:', meshId);
            console.log('[CloudStorage] Edge count:', edgeIndices.length);
            console.log('[CloudStorage] Annotation metadata being sent:', JSON.stringify(annotationMetadata, null, 2));
            
            const result = await lithicClient.saveState(
                meshId,
                edgeIndices,
                name,
                '',
                annotationMetadata
            );
            
            console.log('[CloudStorage] Save result:', result);
            this.setStatus('Annotation saved!', 'success');
            
            // Emit event for other components
            eventBus.emit(Events.STATE_SAVED, {
                meshId: meshId,
                stateId: result.state_id,
                name: name,
                edgeCount: edgeIndices.length
            });
            
            // Refresh states if this mesh is expanded
            if (this.selectedMeshId === meshId) {
                await this.loadStates(meshId);
            }
            await this.refreshMeshList(); // Update state counts
        } catch (e) {
            console.error('[CloudStorage] Save annotation failed:', e);
            this.setStatus('Save failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Set the status message.
     */
    setStatus(message, type = 'info') {
        if (!this.statusEl) return;
        
        const icons = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle'
        };
        
        this.statusEl.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> <span>${message}</span>`;
        this.statusEl.className = `cloud-storage-status ${type}`;
    }

    /**
     * Set loading state.
     */
    setLoading(loading) {
        this.isLoading = loading;
        
        if (this.refreshBtn) {
            this.refreshBtn.disabled = loading;
            this.refreshBtn.innerHTML = loading 
                ? '<i class="fas fa-spinner fa-spin"></i>'
                : '<i class="fas fa-sync-alt"></i>';
        }
        
        if (this.uploadMeshBtn) {
            this.uploadMeshBtn.disabled = loading;
        }
        
        if (this.saveStateBtn) {
            this.saveStateBtn.disabled = loading;
        }
    }
}
