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
                errorMessage = errorData.detail || errorMessage;
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
        return this.request(`/inference/sessions/${sessionId}`);
    }

    /**
     * Delete a session
     */
    async deleteSession(sessionId) {
        return this.request(`/inference/sessions/${sessionId}`, {
            method: 'DELETE'
        });
    }

    /**
     * Update session configuration
     */
    async updateSessionConfig(sessionId, config) {
        return this.request(`/inference/sessions/${sessionId}/config`, {
            method: 'PATCH',
            body: JSON.stringify(config)
        });
    }

    // ============== File Endpoints ==============

    /**
     * Upload a PLY file
     */
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        return this.request('/files/upload', {
            method: 'POST',
            body: formData
        });
    }

    /**
     * List all files
     */
    async listFiles() {
        return this.request('/files/');
    }

    /**
     * Get file metadata
     */
    async getFileMetadata(filename) {
        return this.request(`/files/${filename}/metadata`);
    }

    /**
     * Delete a file
     */
    async deleteFile(filename) {
        return this.request(`/files/${filename}`, {
            method: 'DELETE'
        });
    }

    // ============== Inference Endpoints ==============

    /**
     * Load data from stored file into session
     */
    async loadFileIntoSession(sessionId, filename) {
        return this.request(`/inference/sessions/${sessionId}/load-file`, {
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
        return this.request(`/inference/sessions/${sessionId}/load-direct`, {
            method: 'POST',
            body: JSON.stringify({ vertices, faces, name })
        });
    }

    /**
     * Run inference on session data
     */
    async runInference(sessionId) {
        return this.request(`/inference/sessions/${sessionId}/run`, {
            method: 'POST'
        });
    }
}

// Singleton instance
export const lithicClient = new LithicClient();

// Default inference config values (from server defaults)
export const DEFAULT_INFERENCE_CONFIG = {
    n_angles: 6,
    max_steps: 5000,
    gamma: 0.95,
    edge_threshold: 0.5,
    thresholds: [0.5, 0.8],
    resolution: [512, 512],
    zoom: 1.0,
    norm: 'minmax'
};

// Config parameter metadata for UI generation
// Only showing essential parameters; others use defaults
export const CONFIG_PARAMS = {
    edge_threshold: {
        label: 'Edge Threshold',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Threshold for edge detection'
    },
    n_angles: {
        label: 'Rotation Angles',
        type: 'number',
        min: 1,
        max: 360,
        step: 1,
        description: 'Number of rotation angles for inference'
    },
    zoom: {
        label: 'Zoom',
        type: 'slider',
        min: 1.0,
        max: 2.0,
        step: 0.1,
        description: 'Zoom factor for rendering'
    }
};

