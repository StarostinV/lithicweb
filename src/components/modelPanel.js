/**
 * Model Panel Component
 * Manages inference sessions, configuration, and results.
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.CONNECTION_CHANGED` - Updates UI when connection status changes
 * 
 * Emits:
 * - `Events.ANNOTATION_LOADED` - When model inference results are applied (for library auto-save)
 * 
 * ## Memory Optimization
 * 
 * All event subscriptions use namespaces ('modelPanel') for efficient cleanup.
 * The dispose() method removes all subscriptions via offNamespace() to prevent leaks.
 * 
 * @module ModelPanel
 */

import { lithicClient, DEFAULT_INFERENCE_CONFIG, CONFIG_PARAMS } from '../api/lithicClient.js';
import { eventBus, Events } from '../utils/EventBus.js';
import { Annotation } from '../geometry/Annotation.js';

export class ModelPanel {
    constructor(meshView, connectionManager = null) {
        this.meshView = meshView;
        this.connectionManager = connectionManager; // Kept for backward compatibility
        this.evaluationManager = null;
        this.cloudStoragePanel = null;
        this.currentSession = null;
        this.config = { ...DEFAULT_INFERENCE_CONFIG };
        this.isLoading = false;
        
        this.setupUI();
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
            this.onConnectionChange(data);
        }, 'modelPanel');
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     * Call this when the panel is being destroyed.
     */
    dispose() {
        eventBus.offNamespace('modelPanel');
    }

    /**
     * Set the evaluation manager (for deferred initialization).
     * @param {EvaluationManager} evaluationManager
     */
    setEvaluationManager(evaluationManager) {
        this.evaluationManager = evaluationManager;
    }
    
    /**
     * Set the cloud storage panel (for deferred initialization).
     * Used to check if current mesh is already in cloud storage for optimized loading.
     * @param {CloudStoragePanel} cloudStoragePanel
     */
    setCloudStoragePanel(cloudStoragePanel) {
        this.cloudStoragePanel = cloudStoragePanel;
    }

    setupUI() {
        // Setup existing panel elements
        this.settingsBtn = document.getElementById('modelSettingsBtn');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.uploadToServerBtn = document.getElementById('uploadToServerBtn');
        this.runInferenceBtn = document.getElementById('runInferenceBtn');
        this.inferenceStatus = document.getElementById('inferenceStatus');
        this.configContainer = document.getElementById('configContainer');
        
        // Build config UI
        this.buildConfigUI();
    }

    /**
     * Called when connection status changes.
     * @param {Object} [data] - Event data from EventBus
     * @param {boolean} [data.isConnected] - Whether connection is established
     * @param {Object} [data.config] - Connection configuration
     */
    onConnectionChange(data = {}) {
        // Connection manager already updates the UI, but we can do additional
        // model-panel specific updates here if needed
        console.log('[ModelPanel] Connection status changed:', data.isConnected);
    }

    buildConfigUI() {
        if (!this.configContainer) return;

        this.configContainer.innerHTML = '';
        
        for (const [key, meta] of Object.entries(CONFIG_PARAMS)) {
            const wrapper = document.createElement('div');
            wrapper.className = 'config-item';
            
            if (meta.type === 'slider') {
                // Use slider-row-labeled for consistent styling
                wrapper.className = 'slider-row-labeled';
                
                const label = document.createElement('label');
                label.textContent = meta.label;
                label.title = meta.description;
                wrapper.appendChild(label);
                
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.id = `config_${key}`;
                slider.min = meta.min;
                slider.max = meta.max;
                slider.step = meta.step;
                slider.value = this.config[key];
                slider.className = 'styled-slider';
                
                const valueDisplay = document.createElement('span');
                valueDisplay.id = `config_${key}_value`;
                valueDisplay.className = 'slider-value';
                valueDisplay.textContent = this.config[key];
                
                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    valueDisplay.textContent = value;
                    this.config[key] = value;
                });
                
                wrapper.appendChild(slider);
                wrapper.appendChild(valueDisplay);
            } else if (meta.type === 'number') {
                wrapper.className = 'control-row';
                
                const label = document.createElement('label');
                label.textContent = meta.label;
                label.title = meta.description;
                wrapper.appendChild(label);
                
                const input = document.createElement('input');
                input.type = 'number';
                input.id = `config_${key}`;
                input.min = meta.min;
                input.max = meta.max;
                input.step = meta.step;
                input.value = this.config[key];
                input.className = 'control-input';
                
                input.addEventListener('change', (e) => {
                    this.config[key] = parseInt(e.target.value);
                });
                
                wrapper.appendChild(input);
            } else if (meta.type === 'select') {
                wrapper.className = 'control-row';
                
                const label = document.createElement('label');
                label.textContent = meta.label;
                label.title = meta.description;
                wrapper.appendChild(label);
                
                const select = document.createElement('select');
                select.id = `config_${key}`;
                select.className = 'control-select';
                
                meta.options.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.textContent = opt;
                    option.selected = this.config[key] === opt;
                    select.appendChild(option);
                });
                
                select.addEventListener('change', (e) => {
                    this.config[key] = e.target.value;
                });
                
                wrapper.appendChild(select);
            }
            
            this.configContainer.appendChild(wrapper);
        }
    }

    setupEventListeners() {
        // Settings button opens the shared connection modal
        if (this.settingsBtn && this.connectionManager) {
            this.settingsBtn.addEventListener('click', () => {
                this.connectionManager.openModal();
            });
        }

        // Upload and inference
        if (this.uploadToServerBtn) {
            this.uploadToServerBtn.addEventListener('click', () => this.uploadCurrentMesh());
        }
        
        if (this.runInferenceBtn) {
            this.runInferenceBtn.addEventListener('click', () => this.runInference());
        }
    }

    // ============== Session Management (Hidden from UI) ==============

    /**
     * Clear local session state. Call this when session may be invalid.
     */
    clearSession() {
        console.log('[ModelPanel] Clearing session state');
        this.currentSession = null;
    }

    /**
     * Verify that the current session is still valid on the server.
     * Clears local session state if the session has expired or is invalid.
     * @returns {Promise<boolean>} True if session is valid, false otherwise
     */
    async verifySession() {
        if (!this.currentSession) {
            return false;
        }

        try {
            const serverSession = await lithicClient.getSession(this.currentSession.session_id);
            // Update local state from server (in case it diverged)
            this.currentSession.has_data = serverSession.has_data || false;
            this.currentSession.current_filename = serverSession.current_filename || null;
            console.log('[ModelPanel] Session verified:', this.currentSession.session_id);
            return true;
        } catch (e) {
            console.warn('[ModelPanel] Session verification failed:', e.message);
            // Session is invalid or expired - clear local state
            this.clearSession();
            return false;
        }
    }

    async ensureSession() {
        // First verify any existing session is still valid
        if (this.currentSession) {
            const isValid = await this.verifySession();
            if (isValid) {
                console.log('[ModelPanel] Using existing session:', this.currentSession.session_id);
                return true;
            }
            // Session was invalid, will create new one below
        }

        try {
            console.log('[ModelPanel] Creating new session...');
            const session = await lithicClient.createSession(this.config);
            this.currentSession = session;
            console.log('[ModelPanel] Session created:', session.session_id);
            return true;
        } catch (e) {
            console.error('[ModelPanel] Failed to create session:', e);
            this.setStatus('Failed to create session: ' + e.message, 'error');
            return false;
        }
    }

    // ============== Upload & Inference ==============

    async uploadCurrentMesh() {
        if (this.meshView.isNull()) {
            this.setStatus('No mesh loaded in viewer', 'error');
            return;
        }
        
        if (!lithicClient.isConfigured()) {
            this.setStatus('Please configure server settings first', 'error');
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Preparing mesh...', 'info');
        
        try {
            // Ensure we have a session
            if (!await this.ensureSession()) {
                this.setLoading(false);
                return;
            }
            
            // Update config first
            await lithicClient.updateSessionConfig(this.currentSession.session_id, this.config);
            
            // Check if mesh is already in cloud storage (optimized path)
            const cloudMeshInfo = this.cloudStoragePanel?.cloudMeshInfo;
            if (cloudMeshInfo && this.cloudStoragePanel.verifyCloudConnection()) {
                // Mesh is in cloud storage - load from server storage (much faster!)
                console.log(`[ModelPanel] Mesh found in cloud storage: ${cloudMeshInfo.meshId}`);
                this.setStatus('Loading mesh from cloud storage...', 'info');
                
                const loadResult = await lithicClient.loadFileIntoSession(
                    this.currentSession.session_id,
                    cloudMeshInfo.meshId
                );
                console.log('[ModelPanel] Cloud storage load result:', loadResult);
                
                if (loadResult && loadResult.success) {
                    this.currentSession.has_data = true;
                    this.currentSession.current_filename = cloudMeshInfo.meshId;
                    console.log('[ModelPanel] Session loaded from cloud storage');
                }
                
                this.setStatus('Ready! Mesh loaded from cloud. Click "Run Inference" to process.', 'success');
            } else {
                // No cloud connection - upload mesh directly from client (standard path)
                const { vertices, faces } = this.extractMeshData();
                console.log(`[ModelPanel] No cloud storage, uploading mesh: ${vertices.length} vertices, ${faces.length} faces`);
                
                this.setStatus('Uploading mesh to server...', 'info');
                
                const loadResult = await lithicClient.loadMeshDirectly(
                    this.currentSession.session_id,
                    vertices,
                    faces,
                    'mesh'
                );
                console.log('[ModelPanel] Direct upload result:', loadResult);
                
                // Mark session as having data based on successful load response
                if (loadResult && loadResult.success) {
                    this.currentSession.has_data = true;
                    this.currentSession.current_filename = 'mesh';
                    console.log('[ModelPanel] Session marked as having data');
                }
                
                this.setStatus('Ready! Click "Run Inference" to process.', 'success');
            }
        } catch (e) {
            console.error('[ModelPanel] Upload failed:', e);
            // Clear session state if error indicates session is invalid
            if (e.message.includes('404') || e.message.includes('session') || e.message.includes('Session')) {
                this.clearSession();
            }
            this.setStatus('Failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Extract mesh data as arrays for direct server transmission.
     * Returns vertices as [[x,y,z], ...] and faces as [[v0,v1,v2], ...]
     */
    extractMeshData() {
        const positions = this.meshView.positions;
        const indices = this.meshView.indices;
        const numVertices = positions.length / 3;
        const numFaces = indices.length / 3;
        
        // Convert flat position array to array of [x, y, z]
        const vertices = [];
        for (let i = 0; i < numVertices; i++) {
            vertices.push([
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2]
            ]);
        }
        
        // Convert flat index array to array of [v0, v1, v2]
        const faces = [];
        for (let i = 0; i < numFaces; i++) {
            faces.push([
                indices[i * 3],
                indices[i * 3 + 1],
                indices[i * 3 + 2]
            ]);
        }
        
        return { vertices, faces };
    }

    async runInference() {
        if (!lithicClient.isConfigured()) {
            this.setStatus('Please configure server settings first', 'error');
            return;
        }

        console.log('[ModelPanel] runInference called, session:', this.currentSession);
        
        if (!this.currentSession || !this.currentSession.has_data) {
            console.warn('[ModelPanel] No session or no data:', {
                hasSession: !!this.currentSession,
                hasData: this.currentSession?.has_data
            });
            this.setStatus('Please upload a mesh first', 'error');
            return;
        }
        
        this.setLoading(true);
        this.setStatus('Running inference... This may take a while.', 'info');
        
        try {
            // Update config before running
            console.log('[ModelPanel] Updating config...');
            await lithicClient.updateSessionConfig(this.currentSession.session_id, this.config);
            
            // Run inference
            console.log('[ModelPanel] Running inference on session:', this.currentSession.session_id);
            const response = await lithicClient.runInference(this.currentSession.session_id);
            console.log('[ModelPanel] Inference response:', response);
            
            // Automatically apply results
            this.setStatus('Applying results to mesh...', 'info');
            const appliedCount = this.applyResults(response.result);
            
            this.setStatus(`Done! Applied ${appliedCount} edge annotations.`, 'success');
        } catch (e) {
            console.error('[ModelPanel] Inference failed:', e);
            // Clear session state if error indicates session is invalid
            if (e.message.includes('404') || e.message.includes('session') || e.message.includes('Session')) {
                this.clearSession();
            }
            this.setStatus('Inference failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Apply inference results to the mesh view.
     * Creates an Annotation and emits ANNOTATION_LOADED for library auto-save.
     * 
     * @param {Object} result - Inference result from server
     * @param {Array<number>} result.labels - Edge labels (0 or 1)
     * @returns {number} Number of edge vertices applied
     */
    applyResults(result) {
        if (!result) {
            this.setStatus('No inference results to apply', 'error');
            return 0;
        }
        
        // The inference result should contain edge labels
        // Expected format: { labels: [0, 1, 0, 1, ...] } or similar
        const labels = result.labels || result.edge_labels || result.predictions;
        
        if (!labels || !Array.isArray(labels)) {
            this.setStatus('Invalid inference result format', 'error');
            console.error('Inference result:', result);
            return 0;
        }
        
        // Start a draw operation for history tracking
        this.meshView.startDrawOperation('model');
        
        // Build set of edge indices from inference results
        const edgeIndices = new Set();
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === 1 || labels[i] > 0.5) { // Handle both binary and probability outputs
                edgeIndices.add(i);
            }
        }
        
        // Clear current edges and apply new ones
        this.meshView.currentEdgeIndices.forEach(index => {
            this.meshView.edgeLabels[index] = 0;
            this.meshView.colorVertex(index, this.meshView.objectColor);
        });
        this.meshView.currentEdgeIndices.clear();
        
        // Apply inference edges
        edgeIndices.forEach(index => {
            if (index < this.meshView.edgeLabels.length) {
                this.meshView.edgeLabels[index] = 1;
                this.meshView.colorVertex(index, this.meshView.edgeColor);
                this.meshView.currentEdgeIndices.add(index);
            }
        });
        
        // Finish draw operation to record in history (type 'model' -> 'AI segmentation')
        this.meshView.finishDrawOperation();
        
        // Create Annotation object from inference results for library auto-save
        const annotation = new Annotation({
            edgeIndices: edgeIndices,
            arrows: [],
            metadata: {
                name: `Model Prediction ${new Date().toLocaleString()}`,
                source: 'model',
                config: { ...this.config }  // Include model config for reproducibility
            }
        });
        
        // Emit ANNOTATION_LOADED for library auto-save
        eventBus.emit(Events.ANNOTATION_LOADED, {
            annotation: annotation,
            source: 'model'
        });
        
        // Automatically set this state as the prediction in evaluation manager
        if (this.evaluationManager) {
            this.evaluationManager.setPrediction(annotation);
            console.log('[ModelPanel] Auto-assigned prediction from AI inference');
        }
        
        // Update segments if auto-segmentation is enabled
        if (document.getElementById('auto-segments')?.checked) {
            this.meshView.updateSegments();
        }
        
        return edgeIndices.size;
    }

    setStatus(message, type = 'info') {
        if (!this.inferenceStatus) return;
        
        const icons = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle'
        };
        
        this.inferenceStatus.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> <span>${message}</span>`;
        this.inferenceStatus.className = `inference-status ${type}`;
    }

    setLoading(loading) {
        this.isLoading = loading;
        
        const buttons = [
            this.uploadToServerBtn,
            this.runInferenceBtn
        ];
        
        buttons.forEach(btn => {
            if (btn) btn.disabled = loading;
        });
        
        if (this.uploadToServerBtn) {
            this.uploadToServerBtn.innerHTML = loading 
                ? '<i class="fas fa-spinner fa-spin"></i> Processing...'
                : '<i class="fas fa-upload"></i> Upload & Prepare';
        }
        
        if (this.runInferenceBtn) {
            this.runInferenceBtn.innerHTML = loading 
                ? '<i class="fas fa-spinner fa-spin"></i> Running...'
                : '<i class="fas fa-brain"></i> Run Inference';
        }
    }
}
