/**
 * LithicServer API Client
 * Handles all communication with the lithicserver backend
 */

const STORAGE_KEY = 'lithicjs_settings';

class LithicClient {
    constructor() {
        this.serverUrl = '';
        this.apiToken = '';
        this.loadSettings();
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const settings = JSON.parse(stored);
                this.serverUrl = settings.serverUrl || '';
                this.apiToken = settings.apiToken || '';
            }
        } catch (e) {
            console.warn('Failed to load lithicjs settings:', e);
        }
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                serverUrl: this.serverUrl,
                apiToken: this.apiToken
            }));
        } catch (e) {
            console.warn('Failed to save lithicjs settings:', e);
        }
    }

    /**
     * Configure the client with server URL and API token
     */
    configure(serverUrl, apiToken) {
        // Normalize URL
        let url = serverUrl.trim();
        
        // Add protocol if missing (default to http for localhost)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // Default to http for localhost/127.0.0.1, otherwise https
            if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) {
                url = 'http://' + url;
            } else {
                url = 'https://' + url;
            }
        }
        
        // Remove trailing slash
        this.serverUrl = url.replace(/\/+$/, '');
        this.apiToken = apiToken;
        this.saveSettings();
    }

    /**
     * Check if client is configured
     */
    isConfigured() {
        return Boolean(this.serverUrl && this.apiToken);
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return {
            serverUrl: this.serverUrl,
            apiToken: this.apiToken
        };
    }

    /**
     * Make an authenticated API request
     */
    async request(endpoint, options = {}) {
        if (!this.isConfigured()) {
            throw new Error('LithicClient not configured. Please set server URL and API token.');
        }

        const url = `${this.serverUrl}${endpoint}`;
        const headers = {
            'X-API-Key': this.apiToken,
            ...options.headers
        };

        // Add JSON content-type for requests with body
        if (options.body && !(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers
            });
        } catch (e) {
            // Network errors (CORS, SSL, connection refused, etc.)
            if (e.message.includes('Failed to fetch')) {
                // Check if it might be a protocol mismatch
                const isHttps = this.serverUrl.startsWith('https://');
                const isLocalhost = this.serverUrl.includes('localhost') || this.serverUrl.includes('127.0.0.1');
                
                let hint = '';
                if (isHttps && isLocalhost) {
                    hint = ' Try using http:// instead of https:// for localhost.';
                } else if (!isHttps && window.location.protocol === 'https:') {
                    hint = ' Your page is HTTPS but server is HTTP (mixed content blocked). Try serving your page over HTTP or use HTTPS for the server.';
                }
                
                throw new Error(`Network error: Cannot connect to ${this.serverUrl}.${hint}`);
            }
            throw e;
        }

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                const detail = errorData.detail;
                if (typeof detail === 'string') {
                    errorMessage = detail;
                } else if (detail) {
                    errorMessage = JSON.stringify(detail);
                }
            } catch (e) {
                // Ignore JSON parse errors
            }
            throw new Error(errorMessage);
        }

        // Handle empty responses
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }
        return response;
    }

    // ============== Health Endpoints ==============

    /**
     * Check server health
     */
    async checkHealth() {
        const response = await this.request('/health');
        return response;
    }

    /**
     * Test connection with current settings
     */
    async testConnection() {
        try {
            await this.checkHealth();
            return { success: true, message: 'Connection successful' };
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    // ============== Session Endpoints ==============

    /**
     * Create a new inference session
     */
    async createSession(config = null) {
        return this.request('/inference/sessions', {
            method: 'POST',
            body: config ? JSON.stringify({ config }) : JSON.stringify({})
        });
    }

    /**
     * List all sessions for current user
     */
    async listSessions() {
        return this.request('/inference/sessions');
    }

    /**
     * Get a specific session
     */
    async getSession(sessionId) {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}`);
    }

    /**
     * Delete a session
     */
    async deleteSession(sessionId) {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        });
    }

    /**
     * Update session configuration
     */
    async updateSessionConfig(sessionId, config) {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}/config`, {
            method: 'PATCH',
            body: JSON.stringify(config)
        });
    }

    // ============== File Endpoints ==============

    /**
     * Upload a PLY file (creates a new mesh folder)
     */
    async uploadFile(file, description = '') {
        const formData = new FormData();
        formData.append('file', file);
        if (description) {
            formData.append('description', description);
        }
        
        return this.request('/files/upload', {
            method: 'POST',
            body: formData
        });
    }

    /**
     * List all meshes for current user
     */
    async listFiles() {
        return this.request('/files/');
    }

    /**
     * Get mesh metadata
     */
    async getFileMetadata(meshId) {
        return this.request(`/files/${encodeURIComponent(meshId)}/metadata`);
    }

    /**
     * Download mesh PLY file
     */
    async downloadFile(meshId) {
        const response = await this.request(`/files/${encodeURIComponent(meshId)}/download`);
        return response;
    }

    /**
     * Rename a mesh (display name only)
     */
    async renameFile(meshId, newName) {
        return this.request(`/files/${encodeURIComponent(meshId)}/rename`, {
            method: 'PATCH',
            body: JSON.stringify({ new_name: newName })
        });
    }

    /**
     * Delete a mesh and all its states
     */
    async deleteFile(meshId) {
        return this.request(`/files/${encodeURIComponent(meshId)}`, {
            method: 'DELETE'
        });
    }

    /**
     * Update mesh metadata (additional metadata like CSV data)
     * @param {string} meshId - The mesh folder ID
     * @param {Object} meshMetadata - The metadata dictionary to set
     * @returns {Promise<FileMetadataResponse>}
     */
    async updateMeshMetadata(meshId, meshMetadata) {
        return this.request(`/files/${encodeURIComponent(meshId)}/mesh-metadata`, {
            method: 'PATCH',
            body: JSON.stringify({ mesh_metadata: meshMetadata })
        });
    }

    // ============== State Management Endpoints ==============

    /**
     * List all states for a mesh
     * @param {string} meshId - The mesh folder ID
     * @returns {Promise<{mesh_id: string, states: Array, total_count: number}>}
     */
    async listStates(meshId) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states`);
    }

    /**
     * Save an annotation state for a mesh
     * @param {string} meshId - The mesh folder ID
     * @param {Array<number>} edgeIndices - Array of vertex indices that are edges
     * @param {string} name - Display name for the state
     * @param {string} description - Optional description
     * @param {Object} metadata - Optional additional metadata
     * @returns {Promise<{state_id: string, name: string, created_at: string, edge_count: number}>}
     */
    async saveState(meshId, edgeIndices, name = '', description = '', metadata = null) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states`, {
            method: 'POST',
            body: JSON.stringify({
                edge_indices: edgeIndices,
                name: name,
                description: description,
                metadata: metadata
            })
        });
    }

    /**
     * Load a state with full data (edge indices and metadata)
     * @param {string} meshId - The mesh folder ID
     * @param {string} stateId - The state ID
     * @returns {Promise<{state_id: string, edge_indices: Array<number>, metadata: Object}>}
     */
    async loadState(meshId, stateId) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states/${encodeURIComponent(stateId)}`);
    }

    /**
     * Get state metadata only (without edge indices)
     * @param {string} meshId - The mesh folder ID
     * @param {string} stateId - The state ID
     */
    async getStateMetadata(meshId, stateId) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states/${encodeURIComponent(stateId)}/metadata`);
    }

    /**
     * Rename a state
     * @param {string} meshId - The mesh folder ID
     * @param {string} stateId - The state ID
     * @param {string} newName - New display name
     */
    async renameState(meshId, stateId, newName) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states/${encodeURIComponent(stateId)}/rename`, {
            method: 'PATCH',
            body: JSON.stringify({ new_name: newName })
        });
    }

    /**
     * Delete a state
     * @param {string} meshId - The mesh folder ID
     * @param {string} stateId - The state ID
     */
    async deleteState(meshId, stateId) {
        return this.request(`/files/${encodeURIComponent(meshId)}/states/${encodeURIComponent(stateId)}`, {
            method: 'DELETE'
        });
    }

    // ============== Inference Endpoints ==============

    /**
     * Load data from stored file into session
     */
    async loadFileIntoSession(sessionId, filename) {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}/load-file`, {
            method: 'POST',
            body: JSON.stringify({ filename })
        });
    }

    /**
     * Load mesh data directly into session (no disk storage).
     * This is a simplified workflow that keeps mesh data in RAM only.
     * 
     * @param {string} sessionId - Session ID
     * @param {Array<Array<number>>} vertices - Array of [x, y, z] vertices
     * @param {Array<Array<number>>} faces - Array of [v0, v1, v2] face indices
     * @param {string} name - Optional name for reference
     */
    async loadMeshDirectly(sessionId, vertices, faces, name = 'mesh') {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}/load-direct`, {
            method: 'POST',
            body: JSON.stringify({ vertices, faces, name })
        });
    }

    /**
     * Run inference on session data
     * @param {string} sessionId
     * @param {Object} [options]
     * @param {boolean} [options.returnModelOutput=false] - If true, return raw per-face predictions instead of vertex labels
     */
    async runInference(sessionId, { returnModelOutput = false } = {}) {
        return this.request(`/inference/sessions/${encodeURIComponent(sessionId)}/run`, {
            method: 'POST',
            body: JSON.stringify({ return_model_output: returnModelOutput })
        });
    }

    // ============== Dataset Endpoints (Fast Verification) ==============

    /**
     * List all datasets for the current user
     * @returns {Promise<{datasets: Array, total_count: number}>}
     */
    async listDatasets() {
        return this.request('/datasets/');
    }

    /**
     * List all meshes in a dataset with their verification verdicts
     * @param {string} datasetId
     * @returns {Promise<{dataset_id: string, meshes: Array, total_count: number, verified_count: number}>}
     */
    async listDatasetMeshes(datasetId) {
        return this.request(`/datasets/${encodeURIComponent(datasetId)}/meshes`);
    }

    /**
     * Download a dataset mesh PLY file as a Blob
     * @param {string} datasetId
     * @param {string} meshId
     * @returns {Promise<Blob>}
     */
    async downloadDatasetMesh(datasetId, meshId) {
        const url = `${this.serverUrl}/datasets/${encodeURIComponent(datasetId)}/meshes/${encodeURIComponent(meshId)}/download`;
        const response = await fetch(url, {
            headers: { 'X-API-Key': this.apiToken }
        });
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }
        return response.blob();
    }

    /**
     * Get precomputed model output for a dataset mesh.
     * Returns the same shape as inference with returnModelOutput=true.
     * @param {string} datasetId
     * @param {string} meshId
     * @returns {Promise<{edge_predictions: number[], face_adjacency: number[], num_faces: number}>}
     */
    async getDatasetModelOutput(datasetId, meshId) {
        return this.request(
            `/datasets/${encodeURIComponent(datasetId)}/meshes/${encodeURIComponent(meshId)}/model-output`
        );
    }

    /**
     * List verification states for a dataset mesh
     * @param {string} datasetId
     * @param {string} meshId
     * @returns {Promise<{mesh_id: string, states: Array, total_count: number}>}
     */
    async listDatasetMeshStates(datasetId, meshId) {
        return this.request(
            `/datasets/${encodeURIComponent(datasetId)}/meshes/${encodeURIComponent(meshId)}/states`
        );
    }

    /**
     * Load a single dataset mesh state with full data (edge indices and metadata)
     * @param {string} datasetId
     * @param {string} meshId
     * @param {string} stateId
     * @returns {Promise<{state_id: string, edge_indices: number[], metadata: Object}>}
     */
    async loadDatasetMeshState(datasetId, meshId, stateId) {
        return this.request(
            `/datasets/${encodeURIComponent(datasetId)}/meshes/${encodeURIComponent(meshId)}/states/${encodeURIComponent(stateId)}`
        );
    }

    /**
     * Save a verification state for a dataset mesh
     * @param {string} datasetId
     * @param {string} meshId
     * @param {number[]} edgeIndices
     * @param {string} name
     * @param {string} description
     * @param {Object} metadata - Should include { verdict: 'accept'|'reject', ... }
     * @returns {Promise<{state_id: string, name: string, created_at: string, edge_count: number}>}
     */
    async saveDatasetMeshState(datasetId, meshId, edgeIndices, name = '', description = '', metadata = null) {
        return this.request(
            `/datasets/${encodeURIComponent(datasetId)}/meshes/${encodeURIComponent(meshId)}/states`,
            {
                method: 'POST',
                body: JSON.stringify({
                    edge_indices: edgeIndices,
                    name,
                    description,
                    metadata,
                })
            }
        );
    }
}

// Singleton instance
export const lithicClient = new LithicClient();

// Default inference config values (from server defaults)
export const DEFAULT_INFERENCE_CONFIG = {
    n_angles: 6,
    max_steps: 5000,
    gamma: 0.95,
    min_segment_size: 50,
    thresholds: [0.5, 0.8],
    resolution: [512, 512],
    zoom: 1.0,
    norm: 'minmax',
    union_find_max_merge_cost: 0.45,
    union_find_max_segment_size: null,
    union_find_merge_cost: 'max'
};

// Config parameter metadata for UI generation
// Parameters are categorized: 'nn' requires server round-trip, 'postprocess' can rerun locally
export const CONFIG_PARAMS = {
    n_angles: {
        label: 'Rotation Angles',
        type: 'number',
        min: 1,
        max: 360,
        step: 1,
        description: 'Number of rotation angles for inference',
        category: 'nn'
    },
    zoom: {
        label: 'Zoom',
        type: 'slider',
        min: 1.0,
        max: 2.0,
        step: 0.1,
        description: 'Zoom factor for rendering',
        category: 'nn'
    },
    union_find_max_merge_cost: {
        label: 'Max Merge Cost',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Cost threshold for merging segments (lower = fewer merges, more segments)',
        category: 'postprocess'
    },
    min_segment_size: {
        label: 'Min Segment Size',
        type: 'number',
        min: 10,
        max: 300,
        step: 1,
        description: 'Minimum number of faces per segment',
        category: 'postprocess'
    },
    union_find_merge_cost: {
        label: 'Merge Cost Function',
        type: 'select',
        options: ['max', 'mean', 'min'],
        description: 'How to compute merge cost between faces (max = conservative)',
        category: 'postprocess'
    }
};

