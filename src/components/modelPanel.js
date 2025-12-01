/**
 * Model Panel Component
 * Manages inference sessions, configuration, and results
 */

import { lithicClient, DEFAULT_INFERENCE_CONFIG, CONFIG_PARAMS } from '../api/lithicClient.js';

export class ModelPanel {
    constructor(meshObject) {
        this.meshObject = meshObject;
        this.currentSession = null;
        this.config = { ...DEFAULT_INFERENCE_CONFIG };
        this.isLoading = false;
        
        this.setupUI();
        this.setupEventListeners();
        this.updateConnectionStatus();
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
            <div class="modal-content" style="max-width: 500px;">
                <span class="close" id="closeSettingsModal">&times;</span>
                <h2 class="text-xl font-bold mb-4"><i class="fas fa-cog"></i> Server Settings</h2>
                <div class="flex flex-col space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                        <input type="text" id="serverUrlInput" 
                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://uninvadable-northerly-fredia.ngrok-free.dev">
                        <p class="text-xs text-gray-500 mt-1">Include http:// or https:// (use http:// for localhost)</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">Collaborator Token</label>
                        <input type="password" id="apiTokenInput"
                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Your collaborator token">
                        <button id="toggleTokenVisibility" class="text-sm text-blue-600 mt-1 hover:underline">Show token</button>
                    </div>
                    <div class="flex space-x-2">
                        <button id="testConnectionBtn" 
                            class="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400">
                            <i class="fas fa-plug"></i> Test Connection
                        </button>
                        <button id="saveSettingsBtn"
                            class="flex-1 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            <i class="fas fa-save"></i> Save Settings
                        </button>
                    </div>
                    <div id="settingsTestResult" class="text-sm p-2 rounded hidden"></div>
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
            wrapper.className = 'mb-3';
            
            const label = document.createElement('label');
            label.className = 'block text-sm font-medium text-gray-700 mb-1';
            label.textContent = meta.label;
            label.title = meta.description;
            wrapper.appendChild(label);
            
            if (meta.type === 'slider') {
                const container = document.createElement('div');
                container.className = 'flex items-center space-x-2';
                
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.id = `config_${key}`;
                slider.min = meta.min;
                slider.max = meta.max;
                slider.step = meta.step;
                slider.value = this.config[key];
                slider.className = 'flex-1';
                
                const valueDisplay = document.createElement('span');
                valueDisplay.id = `config_${key}_value`;
                valueDisplay.className = 'text-sm text-gray-600 w-12 text-right';
                valueDisplay.textContent = this.config[key];
                
                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    valueDisplay.textContent = value;
                    this.config[key] = value;
                });
                
                container.appendChild(slider);
                container.appendChild(valueDisplay);
                wrapper.appendChild(container);
            } else if (meta.type === 'number') {
                const input = document.createElement('input');
                input.type = 'number';
                input.id = `config_${key}`;
                input.min = meta.min;
                input.max = meta.max;
                input.step = meta.step;
                input.value = this.config[key];
                input.className = 'w-full px-2 py-1 border border-gray-300 rounded text-sm';
                
                input.addEventListener('change', (e) => {
                    this.config[key] = parseInt(e.target.value);
                });
                
                wrapper.appendChild(input);
            } else if (meta.type === 'select') {
                const select = document.createElement('select');
                select.id = `config_${key}`;
                select.className = 'w-full px-2 py-1 border border-gray-300 rounded text-sm';
                
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
                toggleBtn.textContent = isPassword ? 'Hide token' : 'Show token';
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
            resultDiv.textContent = 'Please enter both server URL and API token';
            resultDiv.className = 'text-sm p-2 rounded bg-yellow-100 text-yellow-800';
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
        
        resultDiv.textContent = result.message;
        resultDiv.className = result.success 
            ? 'text-sm p-2 rounded bg-green-100 text-green-800'
            : 'text-sm p-2 rounded bg-red-100 text-red-800';
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
        
        resultDiv.textContent = 'Settings saved!';
        resultDiv.className = 'text-sm p-2 rounded bg-green-100 text-green-800';
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
            this.connectionStatus.innerHTML = `<i class="fas fa-circle text-green-500"></i> Connected`;
            this.connectionStatus.className = 'text-sm text-green-700';
            this.connectionStatus.title = serverUrl;
        } else {
            this.connectionStatus.innerHTML = '<i class="fas fa-circle text-red-500"></i> Not configured';
            this.connectionStatus.className = 'text-sm text-red-700';
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
        
        // Update segments if auto-segmentation is enabled
        if (document.getElementById('auto-segments')?.checked) {
            this.meshObject.updateSegments();
        }
        
        return edgeIndices.size;
    }

    setStatus(message, type = 'info') {
        if (!this.inferenceStatus) return;
        
        const colors = {
            info: 'text-blue-700 bg-blue-50',
            success: 'text-green-700 bg-green-50',
            error: 'text-red-700 bg-red-50',
            warning: 'text-yellow-700 bg-yellow-50'
        };
        
        this.inferenceStatus.textContent = message;
        this.inferenceStatus.className = `text-sm p-2 rounded ${colors[type] || colors.info}`;
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
