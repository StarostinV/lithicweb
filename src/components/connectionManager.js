/**
 * Connection Manager Component
 * Manages server connection state, settings modal, and status display.
 * This is shared across the application for consistent connection handling.
 * 
 * ## Event Bus Integration
 * 
 * ConnectionManager emits the following events via the global EventBus:
 * - `Events.CONNECTION_CHANGED` - When connection status changes
 *   Data: { isConnected: boolean, config: { serverUrl, apiToken } }
 * - `Events.CONNECTION_MODAL_OPENED` - When the settings modal is opened
 * 
 * Components can subscribe to these events instead of using addListener():
 * ```javascript
 * import { eventBus, Events } from '../utils/EventBus.js';
 * eventBus.on(Events.CONNECTION_CHANGED, (data) => {
 *     if (data.isConnected) { ... }
 * });
 * ```
 * 
 * @module ConnectionManager
 */

import { lithicClient } from '../api/lithicClient.js';
import { eventBus, Events } from '../utils/EventBus.js';

export class ConnectionManager {
    constructor() {
        this.listeners = [];
        this.isConnected = false;
        
        this.createSettingsModal();
        this.setupEventListeners();
        this.updateConnectionStatus();
    }

    /**
     * Add a listener to be called when connection status changes.
     * 
     * @deprecated Prefer using EventBus for new code:
     * ```javascript
     * import { eventBus, Events } from '../utils/EventBus.js';
     * eventBus.on(Events.CONNECTION_CHANGED, (data) => {
     *     // data.isConnected, data.config
     * });
     * ```
     * 
     * @param {Function} callback - Called with (isConnected, config)
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Notify all listeners of connection status change.
     * Emits both to legacy listeners and the global EventBus.
     */
    notifyListeners() {
        const config = lithicClient.getConfig();
        
        // Legacy listener pattern (for backward compatibility)
        this.listeners.forEach(cb => cb(this.isConnected, config));
        
        // EventBus pattern (preferred for new code)
        eventBus.emit(Events.CONNECTION_CHANGED, {
            isConnected: this.isConnected,
            config: config
        });
    }

    createSettingsModal() {
        // Check if modal already exists
        if (document.getElementById('connectionModal')) return;

        const modal = document.createElement('div');
        modal.id = 'connectionModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content settings-modal">
                <div class="modal-header">
                    <h2><i class="fas fa-plug"></i> Server Connection</h2>
                    <button class="modal-close" id="closeConnectionModal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Server URL</label>
                        <input type="text" id="connectionServerUrlInput" class="form-input"
                            placeholder="https://your-server.ngrok-free.dev">
                        <p class="form-hint">Include http:// or https:// (use http:// for localhost)</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Collaborator Token</label>
                        <div class="input-with-action">
                            <input type="password" id="connectionApiTokenInput" class="form-input"
                                placeholder="Your collaborator token">
                            <button id="connectionToggleTokenVisibility" class="input-action-btn" type="button">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button id="connectionTestBtn" class="btn btn-secondary">
                            <i class="fas fa-plug"></i> Test Connection
                        </button>
                        <button id="connectionSaveBtn" class="btn btn-primary">
                            <i class="fas fa-save"></i> Save & Connect
                        </button>
                    </div>
                    <div id="connectionTestResult" class="settings-result hidden"></div>
                    
                    <div class="connection-info-section">
                        <div class="section-divider">
                            <span>About</span>
                        </div>
                        <p class="connection-info-text">
                            Connect to a LithicServer instance to enable AI inference, 
                            file storage, and other cloud features.
                        </p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    setupEventListeners() {
        const modal = document.getElementById('connectionModal');
        const closeBtn = document.getElementById('closeConnectionModal');
        
        // Close modal button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
        
        // Close modal on outside click
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Toggle token visibility
        const toggleBtn = document.getElementById('connectionToggleTokenVisibility');
        const tokenInput = document.getElementById('connectionApiTokenInput');
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
        const testBtn = document.getElementById('connectionTestBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testConnection());
        }

        // Save settings
        const saveBtn = document.getElementById('connectionSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }
        
        // Navbar connect button
        const navbarConnectBtn = document.getElementById('navbarConnectBtn');
        if (navbarConnectBtn) {
            navbarConnectBtn.addEventListener('click', () => this.openModal());
        }
    }

    /**
     * Open the connection settings modal.
     * Emits Events.CONNECTION_MODAL_OPENED via EventBus.
     */
    openModal() {
        const modal = document.getElementById('connectionModal');
        const serverInput = document.getElementById('connectionServerUrlInput');
        const tokenInput = document.getElementById('connectionApiTokenInput');
        const resultDiv = document.getElementById('connectionTestResult');
        
        // Load current settings
        const { serverUrl, apiToken } = lithicClient.getConfig();
        if (serverInput) serverInput.value = serverUrl;
        if (tokenInput) tokenInput.value = apiToken;
        if (resultDiv) {
            resultDiv.classList.add('hidden');
        }
        
        modal.style.display = 'flex';
        
        // Emit event for components that want to react to modal opening
        eventBus.emit(Events.CONNECTION_MODAL_OPENED);
    }

    async testConnection() {
        const serverInput = document.getElementById('connectionServerUrlInput');
        const tokenInput = document.getElementById('connectionApiTokenInput');
        const resultDiv = document.getElementById('connectionTestResult');
        const testBtn = document.getElementById('connectionTestBtn');
        
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
        const serverInput = document.getElementById('connectionServerUrlInput');
        const tokenInput = document.getElementById('connectionApiTokenInput');
        const resultDiv = document.getElementById('connectionTestResult');
        
        const serverUrl = serverInput.value.trim();
        const apiToken = tokenInput.value.trim();
        
        lithicClient.configure(serverUrl, apiToken);
        
        // Test the connection after saving
        const result = await lithicClient.testConnection();
        this.isConnected = result.success;
        
        if (result.success) {
            resultDiv.innerHTML = '<i class="fas fa-check-circle"></i> Connected successfully!';
            resultDiv.className = 'settings-result success';
        } else {
            resultDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Settings saved, but connection failed: ${result.message}`;
            resultDiv.className = 'settings-result warning';
        }
        resultDiv.classList.remove('hidden');
        
        this.updateConnectionStatus();
        this.notifyListeners();
        
        // Close modal after a short delay if successful
        if (result.success) {
            setTimeout(() => {
                document.getElementById('connectionModal').style.display = 'none';
            }, 1000);
        }
    }

    /**
     * Update all connection status indicators in the UI.
     */
    updateConnectionStatus() {
        const configured = lithicClient.isConfigured();
        const { serverUrl } = lithicClient.getConfig();
        
        // Update navbar button
        const navbarBtn = document.getElementById('navbarConnectBtn');
        const navbarStatus = document.getElementById('navbarConnectionStatus');
        
        if (navbarBtn && navbarStatus) {
            if (configured) {
                navbarStatus.innerHTML = '<i class="fas fa-circle status-dot connected"></i>';
                navbarBtn.title = `Connected to ${serverUrl}`;
                navbarBtn.classList.add('connected');
            } else {
                navbarStatus.innerHTML = '<i class="fas fa-circle status-dot disconnected"></i>';
                navbarBtn.title = 'Not connected - Click to configure';
                navbarBtn.classList.remove('connected');
            }
        }
        
        // Also update the model panel's connection status indicator if it exists
        const modelPanelStatus = document.getElementById('connectionStatus');
        if (modelPanelStatus) {
            if (configured) {
                modelPanelStatus.innerHTML = '<i class="fas fa-circle status-dot connected"></i>';
                modelPanelStatus.className = 'connection-indicator connected';
                modelPanelStatus.title = `Connected: ${serverUrl}`;
            } else {
                modelPanelStatus.innerHTML = '<i class="fas fa-circle status-dot disconnected"></i>';
                modelPanelStatus.className = 'connection-indicator';
                modelPanelStatus.title = 'Not configured';
            }
        }
        
        this.isConnected = configured;
    }

    /**
     * Check if currently connected/configured.
     */
    isConfigured() {
        return lithicClient.isConfigured();
    }

    /**
     * Get the current configuration.
     */
    getConfig() {
        return lithicClient.getConfig();
    }
}
