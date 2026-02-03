/**
 * Model Panel Component
 * Manages inference sessions, configuration, and results
 */

import { lithicClient, DEFAULT_INFERENCE_CONFIG, CONFIG_PARAMS } from '../api/lithicClient.js';

export class ModelPanel {
    constructor(meshObject, evaluationManager = null) {
        this.meshObject = meshObject;
        this.evaluationManager = evaluationManager;
        this.currentSession = null;
        this.config = { ...DEFAULT_INFERENCE_CONFIG };
        this.isLoading = false;
        
        this.setupUI();
        this.setupEventListeners();
        this.updateConnectionStatus();
    }

    /**
     * Set the evaluation manager (for deferred initialization).
     * @param {EvaluationManager} evaluationManager
     */
    setEvaluationManager(evaluationManager) {
        this.evaluationManager = evaluationManager;
    }

    setupUI() {
        // Create settings modal if it doesn't exist
        this.createSettingsModal();
        
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

    createSettingsModal() {
        // Check if modal already exists
        if (document.getElementById('settingsModal')) return;

        const modal = document.createElement('div');
        modal.id = 'settingsModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content settings-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-cog"></i> Server Settings</h2>
                    <button class="modal-close" id="closeSettingsModal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Server URL</label>
                        <input type="text" id="serverUrlInput" class="form-input"
                            placeholder="https://your-server.ngrok-free.dev">
                        <p class="form-hint">Include http:// or https:// (use http:// for localhost)</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Collaborator Token</label>
                        <div class="input-with-action">
                            <input type="password" id="apiTokenInput" class="form-input"
                                placeholder="Your collaborator token">
                            <button id="toggleTokenVisibility" class="input-action-btn" type="button">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button id="testConnectionBtn" class="btn btn-secondary">
                            <i class="fas fa-plug"></i> Test Connection
                        </button>
                        <button id="saveSettingsBtn" class="btn btn-primary">
                            <i class="fas fa-save"></i> Save Settings
                        </button>
                    </div>
                    <div id="settingsTestResult" class="settings-result hidden"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
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
        // Settings modal
        const settingsModal = document.getElementById('settingsModal');
        const closeBtn = document.getElementById('closeSettingsModal');
        
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                this.openSettingsModal();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                settingsModal.style.display = 'none';
            });
        }
        
        // Close modal on outside click
        window.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });

        // Toggle token visibility
        const toggleBtn = document.getElementById('toggleTokenVisibility');
        const tokenInput = document.getElementById('apiTokenInput');
        if (toggleBtn && tokenInput) {
            toggleBtn.addEventListener('click', () => {
                const isPassword = tokenInput.type === 'password';
                tokenInput.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword 
                    ? '<i class="fas fa-eye-slash"></i>' 
                    : '<i class="fas fa-eye"></i>';
            });
        }

        // Test connection
        const testBtn = document.getElementById('testConnectionBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testConnection());
        }

        // Save settings
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }

        // Upload and inference
        if (this.uploadToServerBtn) {
            this.uploadToServerBtn.addEventListener('click', () => this.uploadCurrentMesh());
        }
        
        if (this.runInferenceBtn) {
            this.runInferenceBtn.addEventListener('click', () => this.runInference());
        }
    }

    openSettingsModal() {
        const modal = document.getElementById('settingsModal');
        const serverInput = document.getElementById('serverUrlInput');
        const tokenInput = document.getElementById('apiTokenInput');
        const resultDiv = document.getElementById('settingsTestResult');
        
        // Load current settings
        const { serverUrl, apiToken } = lithicClient.getConfig();
        if (serverInput) serverInput.value = serverUrl;
        if (tokenInput) tokenInput.value = apiToken;
        if (resultDiv) {
            resultDiv.classList.add('hidden');
        }
        
        modal.style.display = 'flex';
    }

    async testConnection() {
        const serverInput = document.getElementById('serverUrlInput');
        const tokenInput = document.getElementById('apiTokenInput');
        const resultDiv = document.getElementById('settingsTestResult');
        const testBtn = document.getElementById('testConnectionBtn');
        
        const serverUrl = serverInput.value.trim();
        const apiToken = tokenInput.value.trim();
        
        if (!serverUrl || !apiToken) {
            resultDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Please enter both server URL and API token';
            resultDiv.className = 'settings-result warning';
            resultDiv.classList.remove('hidden');
            return;
        }
        
        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        
        // Temporarily configure client
        const oldConfig = lithicClient.getConfig();
        lithicClient.configure(serverUrl, apiToken);
        
        const result = await lithicClient.testConnection();
        
        // Restore old config if test failed
        if (!result.success) {
            lithicClient.configure(oldConfig.serverUrl, oldConfig.apiToken);
        }
        
        const icon = result.success ? 'fa-check-circle' : 'fa-times-circle';
        resultDiv.innerHTML = `<i class="fas ${icon}"></i> ${result.message}`;
        resultDiv.className = result.success 
            ? 'settings-result success'
            : 'settings-result error';
        resultDiv.classList.remove('hidden');
        
        testBtn.disabled = false;
        testBtn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }

    async saveSettings() {
        const serverInput = document.getElementById('serverUrlInput');
        const tokenInput = document.getElementById('apiTokenInput');
        const resultDiv = document.getElementById('settingsTestResult');
        
        const serverUrl = serverInput.value.trim();
        const apiToken = tokenInput.value.trim();
        
        lithicClient.configure(serverUrl, apiToken);
        
        resultDiv.innerHTML = '<i class="fas fa-check-circle"></i> Settings saved!';
        resultDiv.className = 'settings-result success';
        resultDiv.classList.remove('hidden');
        
        this.updateConnectionStatus();
        
        // Close modal after a short delay
        setTimeout(() => {
            document.getElementById('settingsModal').style.display = 'none';
        }, 1000);
    }

    updateConnectionStatus() {
        if (!this.connectionStatus) return;
        
        if (lithicClient.isConfigured()) {
            const { serverUrl } = lithicClient.getConfig();
            this.connectionStatus.innerHTML = `<i class="fas fa-circle status-dot connected"></i> <span>Connected</span>`;
            this.connectionStatus.className = 'connection-status connected';
            this.connectionStatus.title = serverUrl;
        } else {
            this.connectionStatus.innerHTML = '<i class="fas fa-circle status-dot disconnected"></i> <span>Not configured</span>';
            this.connectionStatus.className = 'connection-status';
        }
    }

    // ============== Session Management (Hidden from UI) ==============

    async ensureSession() {
        if (this.currentSession) {
            console.log('[ModelPanel] Using existing session:', this.currentSession.session_id);
            return true;
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
        if (this.meshObject.isNull()) {
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
            
            // Extract mesh data as arrays (no disk storage, direct to RAM)
            const { vertices, faces } = this.extractMeshData();
            console.log(`[ModelPanel] Extracted mesh: ${vertices.length} vertices, ${faces.length} faces`);
            
            this.setStatus('Sending mesh to server...', 'info');
            
            // Update config and load mesh directly into session (no disk storage)
            await lithicClient.updateSessionConfig(this.currentSession.session_id, this.config);
            
            const loadResult = await lithicClient.loadMeshDirectly(
                this.currentSession.session_id,
                vertices,
                faces,
                'mesh'
            );
            console.log('[ModelPanel] Load result:', loadResult);
            
            // Mark session as having data based on successful load response
            // This is more reliable than re-fetching session through ngrok
            if (loadResult && loadResult.success) {
                this.currentSession.has_data = true;
                this.currentSession.current_filename = 'mesh';
                console.log('[ModelPanel] Session marked as having data');
            }
            
            this.setStatus('Ready! Click "Run Inference" to process.', 'success');
        } catch (e) {
            console.error('[ModelPanel] Upload failed:', e);
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
        const positions = this.meshObject.positions;
        const indices = this.meshObject.indices;
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

    /**
     * Export current mesh as PLY format (kept for future use with disk storage).
     */
    exportMeshToPLY() {
        // Export current mesh as PLY format
        const positions = this.meshObject.positions;
        const indices = this.meshObject.indices;
        const numVertices = positions.length / 3;
        const numFaces = indices.length / 3;
        
        // Build PLY header
        let ply = 'ply\n';
        ply += 'format ascii 1.0\n';
        ply += `element vertex ${numVertices}\n`;
        ply += 'property float x\n';
        ply += 'property float y\n';
        ply += 'property float z\n';
        ply += `element face ${numFaces}\n`;
        ply += 'property list uchar int vertex_indices\n';
        ply += 'end_header\n';
        
        // Add vertices
        for (let i = 0; i < numVertices; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            ply += `${x} ${y} ${z}\n`;
        }
        
        // Add faces
        for (let i = 0; i < numFaces; i++) {
            const a = indices[i * 3];
            const b = indices[i * 3 + 1];
            const c = indices[i * 3 + 2];
            ply += `3 ${a} ${b} ${c}\n`;
        }
        
        return new Blob([ply], { type: 'text/plain' });
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
            this.setStatus('Inference failed: ' + e.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

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
        this.meshObject.startDrawOperation('model');
        
        // Build set of edge indices from inference results
        const edgeIndices = new Set();
        for (let i = 0; i < labels.length; i++) {
            if (labels[i] === 1 || labels[i] > 0.5) { // Handle both binary and probability outputs
                edgeIndices.add(i);
            }
        }
        
        // Clear current edges and apply new ones
        this.meshObject.currentEdgeIndices.forEach(index => {
            this.meshObject.edgeLabels[index] = 0;
            this.meshObject.colorVertex(index, this.meshObject.objectColor);
        });
        this.meshObject.currentEdgeIndices.clear();
        
        // Apply inference edges
        edgeIndices.forEach(index => {
            if (index < this.meshObject.edgeLabels.length) {
                this.meshObject.edgeLabels[index] = 1;
                this.meshObject.colorVertex(index, this.meshObject.edgeColor);
                this.meshObject.currentEdgeIndices.add(index);
            }
        });
        
        // Finish draw operation to record in history (type 'model' -> 'AI segmentation')
        this.meshObject.finishDrawOperation();
        
        // Automatically set this state as the prediction in evaluation manager
        if (this.evaluationManager) {
            const currentIndex = this.meshObject.history.getCurrentIndex();
            this.evaluationManager.setPrediction(currentIndex, 'AI Prediction');
            console.log('[ModelPanel] Auto-assigned prediction label to state', currentIndex);
        }
        
        // Update segments if auto-segmentation is enabled
        if (document.getElementById('auto-segments')?.checked) {
            this.meshObject.updateSegments();
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
