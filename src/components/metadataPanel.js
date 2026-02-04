/**
 * MetadataPanel - UI component for viewing and editing mesh metadata.
 * 
 * ## Metadata Types
 * 
 * There are two types of metadata in this application:
 * 
 * 1. **Mesh Metadata** (shared metadata):
 *    - Belongs to the mesh itself
 *    - Persisted across all annotation states
 *    - Examples: author, description, mesh source, creation date
 *    - Stored in meshObject.metadata and meshLoader.metadata
 * 
 * 2. **Annotation Metadata** (state metadata):
 *    - Belongs to a specific annotation state
 *    - Unique per history state, NOT shared across states
 *    - Examples: evaluation metrics (precision, recall, F1), model parameters
 *    - Stored per-action in the history system
 *    - Note: Called "state metadata" in code for historical reasons
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.MESH_LOADED` - Updates UI when a mesh is loaded
 * - `Events.HISTORY_CHANGED` - Updates annotation metadata display when history changes
 * 
 * Provides a visual interface to:
 * - View mesh metadata (persisted across all states)
 * - View annotation metadata (unique per history state, e.g., evaluation metrics)
 * - Add new metadata entries
 * - Edit existing values
 * - Delete metadata entries
 * - See metadata loaded from PLY files
 * 
 * @module MetadataPanel
 */

import { eventBus, Events } from '../utils/EventBus.js';

export class MetadataPanel {
    /**
     * Create a MetadataPanel.
     * @param {MeshObject} meshObject - The mesh object containing metadata
     * @param {MeshLoader} meshLoader - The mesh loader for file-level metadata
     */
    constructor(meshObject, meshLoader) {
        this.meshObject = meshObject;
        this.meshLoader = meshLoader;
        
        // UI Elements - Mesh Metadata (shared across all states)
        this.metadataList = document.getElementById('metadataList');
        this.addMetadataBtn = document.getElementById('addMetadataBtn');
        this.addStateMetadataBtn = document.getElementById('addStateMetadataBtn');
        this.newKeyInput = document.getElementById('newMetadataKey');
        this.newValueInput = document.getElementById('newMetadataValue');
        this.metadataStatus = document.getElementById('metadataStatus');
        this.commentsSection = document.getElementById('commentsSection');
        this.commentsList = document.getElementById('commentsList');
        
        // UI Elements - Annotation Metadata (state-specific, unique per annotation)
        this.stateMetadataSection = document.getElementById('stateMetadataSection');
        this.stateMetadataList = document.getElementById('stateMetadataList');
        this.stateMetadataBadge = document.getElementById('stateMetadataBadge');
        
        this.setupEventListeners();
        this._setupEventBusSubscriptions();
        this.updateUI();
    }
    
    /**
     * Setup EventBus subscriptions.
     * Uses namespace for easy cleanup in dispose().
     * @private
     */
    _setupEventBusSubscriptions() {
        // Subscribe to mesh load events to auto-update when a new file is loaded
        eventBus.on(Events.MESH_LOADED, () => {
            this.updateUI();
        }, 'metadataPanel');
        
        // Subscribe to history changes to update annotation metadata display
        eventBus.on(Events.HISTORY_CHANGED, () => {
            this.updateStateMetadataUI();
        }, 'metadataPanel');
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     * Call this when the panel is being destroyed.
     */
    dispose() {
        eventBus.offNamespace('metadataPanel');
    }

    /**
     * Setup event listeners for the panel.
     */
    setupEventListeners() {
        // Add new shared metadata button
        this.addMetadataBtn.addEventListener('click', () => {
            this.addNewMetadata('shared');
        });
        
        // Add new state metadata button
        this.addStateMetadataBtn.addEventListener('click', () => {
            this.addNewMetadata('state');
        });
        
        // Allow Enter key in inputs to add shared metadata (default behavior)
        this.newKeyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addNewMetadata('shared');
            }
        });
        
        this.newValueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addNewMetadata('shared');
            }
        });
    }
    
    /**
     * Add new metadata from input fields.
     * @param {string} type - 'shared' for persistent metadata, 'state' for state-specific metadata
     */
    addNewMetadata(type = 'shared') {
        const key = this.newKeyInput.value.trim();
        const valueStr = this.newValueInput.value.trim();
        
        if (!key) {
            this.showStatus('Please enter a key', 'error');
            return;
        }
        
        // Validate key (no whitespace)
        if (/\s/.test(key)) {
            this.showStatus('Key cannot contain whitespace', 'error');
            return;
        }
        
        // Parse value - try JSON first, then number, then boolean, else string
        let value = this.parseValue(valueStr);
        
        if (type === 'state') {
            // Add to current state's metadata
            this.meshObject.setCurrentStateMetadata(key, value);
            this.showStatus(`Added "${key}" to state metadata`, 'success');
        } else {
            // Add to shared/persistent metadata
            this.meshLoader.setMetadata(key, value);
            this.showStatus(`Added "${key}" to shared metadata`, 'success');
        }
        
        // Clear inputs
        this.newKeyInput.value = '';
        this.newValueInput.value = '';
        
        this.updateUI();
    }
    
    /**
     * Parse a string value into the appropriate type.
     * @param {string} str - The string to parse
     * @returns {*} Parsed value
     */
    parseValue(str) {
        // Empty string
        if (str === '') return '';
        
        // Try JSON (for objects/arrays)
        if ((str.startsWith('{') && str.endsWith('}')) || 
            (str.startsWith('[') && str.endsWith(']'))) {
            try {
                return JSON.parse(str);
            } catch (e) {
                // Fall through to string
            }
        }
        
        // Boolean
        if (str === 'true') return true;
        if (str === 'false') return false;
        
        // Number
        const num = Number(str);
        if (!isNaN(num) && str !== '') {
            return num;
        }
        
        // String
        return str;
    }
    
    /**
     * Format a value for display.
     * @param {*} value - The value to format
     * @returns {string} Formatted string
     */
    formatValue(value) {
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }
    
    /**
     * Get the CSS class for a value type.
     * @param {*} value - The value
     * @returns {string} CSS class name
     */
    getValueTypeClass(value) {
        if (typeof value === 'object') return 'type-object';
        if (typeof value === 'number') return 'type-number';
        if (typeof value === 'boolean') return 'type-boolean';
        return 'type-string';
    }
    
    /**
     * Get the type label for display.
     * @param {*} value - The value
     * @returns {string} Type label
     */
    getTypeLabel(value) {
        if (Array.isArray(value)) return 'array';
        if (value === null) return 'null';
        return typeof value;
    }
    
    /**
     * Show a status message.
     * @param {string} message - The message to show
     * @param {string} type - 'success', 'error', or 'info'
     */
    showStatus(message, type = 'info') {
        this.metadataStatus.textContent = message;
        this.metadataStatus.className = `metadata-status ${type}`;
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.metadataStatus.textContent = '';
            this.metadataStatus.className = 'metadata-status';
        }, 3000);
    }
    
    /**
     * Update the entire UI to reflect current metadata.
     */
    updateUI() {
        this.updateMetadataList();
        this.updateCommentsList();
        this.updateStateMetadataUI();
    }
    
    /**
     * Refresh the panel (called when panel becomes visible).
     */
    onShow() {
        this.updateUI();
    }
    
    /**
     * Update the metadata list display.
     */
    updateMetadataList() {
        const metadata = this.meshLoader.getAllMetadata();
        const keys = Object.keys(metadata);
        
        if (keys.length === 0) {
            this.metadataList.innerHTML = `
                <div class="metadata-empty">
                    <i class="fas fa-inbox"></i>
                    <p>No metadata</p>
                    <p class="text-xs text-gray-400">Add metadata below or load a PLY file with metadata</p>
                </div>
            `;
            return;
        }
        
        this.metadataList.innerHTML = '';
        
        keys.sort().forEach(key => {
            const value = metadata[key];
            const item = this.createMetadataItem(key, value);
            this.metadataList.appendChild(item);
        });
    }
    
    /**
     * Create a metadata item element.
     * @param {string} key - The metadata key
     * @param {*} value - The metadata value
     * @returns {HTMLElement} The item element
     */
    createMetadataItem(key, value) {
        const item = document.createElement('div');
        item.className = 'metadata-item';
        
        const typeClass = this.getValueTypeClass(value);
        const typeLabel = this.getTypeLabel(value);
        const displayValue = this.formatValue(value);
        const isLongValue = displayValue.length > 50 || displayValue.includes('\n');
        
        item.innerHTML = `
            <div class="metadata-item-header">
                <div class="metadata-key">
                    <span class="key-name">${this.escapeHtml(key)}</span>
                    <span class="type-badge ${typeClass}">${typeLabel}</span>
                </div>
                <div class="metadata-actions">
                    <button class="metadata-edit-btn" data-key="${this.escapeHtml(key)}" title="Edit value">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="metadata-delete-btn" data-key="${this.escapeHtml(key)}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="metadata-value ${typeClass} ${isLongValue ? 'long-value' : ''}">
                ${this.escapeHtml(displayValue)}
            </div>
        `;
        
        // Setup button handlers
        const editBtn = item.querySelector('.metadata-edit-btn');
        const deleteBtn = item.querySelector('.metadata-delete-btn');
        
        editBtn.addEventListener('click', () => this.startEdit(item, key, value));
        deleteBtn.addEventListener('click', () => this.deleteMetadata(key));
        
        return item;
    }
    
    /**
     * Start inline editing of a metadata value.
     * @param {HTMLElement} item - The item element
     * @param {string} key - The metadata key
     * @param {*} currentValue - The current value
     */
    startEdit(item, key, currentValue) {
        const valueDiv = item.querySelector('.metadata-value');
        const currentDisplay = this.formatValue(currentValue);
        const isObject = typeof currentValue === 'object';
        
        // Create edit UI
        const editContainer = document.createElement('div');
        editContainer.className = 'metadata-edit-container';
        
        if (isObject) {
            editContainer.innerHTML = `
                <textarea class="metadata-edit-textarea">${this.escapeHtml(currentDisplay)}</textarea>
                <div class="metadata-edit-actions">
                    <button class="save-btn"><i class="fas fa-check"></i> Save</button>
                    <button class="cancel-btn"><i class="fas fa-times"></i> Cancel</button>
                </div>
            `;
        } else {
            editContainer.innerHTML = `
                <input type="text" class="metadata-edit-input" value="${this.escapeHtml(String(currentValue))}">
                <div class="metadata-edit-actions">
                    <button class="save-btn"><i class="fas fa-check"></i> Save</button>
                    <button class="cancel-btn"><i class="fas fa-times"></i> Cancel</button>
                </div>
            `;
        }
        
        valueDiv.replaceWith(editContainer);
        
        const inputEl = editContainer.querySelector('input, textarea');
        const saveBtn = editContainer.querySelector('.save-btn');
        const cancelBtn = editContainer.querySelector('.cancel-btn');
        
        inputEl.focus();
        if (inputEl.tagName === 'INPUT') {
            inputEl.select();
        }
        
        const finishEdit = (save) => {
            if (save) {
                const newValueStr = inputEl.value;
                const newValue = this.parseValue(newValueStr);
                this.meshLoader.setMetadata(key, newValue);
                this.showStatus(`Updated "${key}"`, 'success');
            }
            this.updateUI();
        };
        
        saveBtn.addEventListener('click', () => finishEdit(true));
        cancelBtn.addEventListener('click', () => finishEdit(false));
        
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !isObject) {
                e.preventDefault();
                finishEdit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        });
    }
    
    /**
     * Delete a metadata entry.
     * @param {string} key - The key to delete
     */
    deleteMetadata(key) {
        this.meshLoader.deleteMetadata(key);
        this.showStatus(`Deleted "${key}"`, 'info');
        this.updateUI();
    }
    
    /**
     * Update the comments list display.
     */
    updateCommentsList() {
        const comments = this.meshLoader.getComments();
        
        if (comments.length === 0) {
            this.commentsSection.classList.add('hidden');
            return;
        }
        
        this.commentsSection.classList.remove('hidden');
        this.commentsList.innerHTML = '';
        
        comments.forEach(comment => {
            const item = document.createElement('div');
            item.className = 'comment-item';
            item.textContent = comment;
            this.commentsList.appendChild(item);
        });
    }
    
    /**
     * Update the state-specific metadata UI.
     */
    updateStateMetadataUI() {
        // Skip if UI elements don't exist
        if (!this.stateMetadataSection || !this.stateMetadataList) {
            return;
        }
        
        const currentIndex = this.meshObject.getCurrentStateIndex();
        const stateMetadata = this.meshObject.getCurrentStateMetadata();
        const keys = Object.keys(stateMetadata);
        
        // Always show the section
        this.stateMetadataSection.classList.remove('hidden');
        
        // Update the section badge with current state name
        if (this.stateMetadataBadge) {
            const stateDesc = this.meshObject.history.getDisplayDescription(currentIndex);
            this.stateMetadataBadge.textContent = `(${stateDesc})`;
        }
        
        if (keys.length === 0) {
            this.stateMetadataList.innerHTML = `
                <div class="metadata-empty state-metadata-empty">
                    <i class="fas fa-layer-group"></i>
                    <p>No annotation-specific metadata</p>
                    <p class="text-xs text-gray-400">Evaluation metrics will appear here when computed</p>
                </div>
            `;
            return;
        }
        
        this.stateMetadataList.innerHTML = '';
        
        keys.sort().forEach(key => {
            const value = stateMetadata[key];
            const item = this.createStateMetadataItem(key, value);
            this.stateMetadataList.appendChild(item);
        });
    }
    
    /**
     * Create a state-metadata item element.
     * @param {string} key - The metadata key
     * @param {*} value - The metadata value
     * @returns {HTMLElement} The item element
     */
    createStateMetadataItem(key, value) {
        // Special rendering for evaluation data
        if (key === 'evaluation' && typeof value === 'object' && value !== null) {
            return this.createEvaluationMetadataItem(key, value);
        }
        
        const item = document.createElement('div');
        item.className = 'metadata-item state-metadata-item';
        
        const typeClass = this.getValueTypeClass(value);
        const typeLabel = this.getTypeLabel(value);
        const displayValue = this.formatValue(value);
        const isLongValue = displayValue.length > 50 || displayValue.includes('\n');
        
        item.innerHTML = `
            <div class="metadata-item-header">
                <div class="metadata-key">
                    <span class="key-name">${this.escapeHtml(key)}</span>
                    <span class="type-badge ${typeClass}">${typeLabel}</span>
                    <span class="state-badge">state-specific</span>
                </div>
                <div class="metadata-actions">
                    <button class="metadata-delete-btn state-meta-delete" data-key="${this.escapeHtml(key)}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="metadata-value ${typeClass} ${isLongValue ? 'long-value' : ''}">
                ${this.escapeHtml(displayValue)}
            </div>
        `;
        
        // Setup delete button handler
        const deleteBtn = item.querySelector('.state-meta-delete');
        deleteBtn.addEventListener('click', () => this.deleteStateMetadata(key));
        
        return item;
    }
    
    /**
     * Create a special evaluation metrics item with table view.
     * @param {string} key - The metadata key ('evaluation')
     * @param {Object} value - The evaluation data object
     * @returns {HTMLElement} The item element
     */
    createEvaluationMetadataItem(key, value) {
        const item = document.createElement('div');
        item.className = 'metadata-item state-metadata-item evaluation-item';
        
        // Format timestamp nicely
        const computedAt = value.general?.computedAt 
            ? new Date(value.general.computedAt).toLocaleString() 
            : 'Unknown';
        
        // Build the table view HTML
        const tableHtml = this.buildEvaluationTable(value);
        const rawJson = this.formatValue(value);
        
        item.innerHTML = `
            <div class="metadata-item-header">
                <div class="metadata-key">
                    <span class="key-name"><i class="fas fa-chart-bar"></i> ${this.escapeHtml(key)}</span>
                    <span class="type-badge type-object">metrics</span>
                    <span class="state-badge">state-specific</span>
                </div>
                <div class="metadata-actions">
                    <button class="eval-view-toggle" title="Toggle table/raw view">
                        <i class="fas fa-code"></i>
                    </button>
                    <button class="metadata-delete-btn state-meta-delete" data-key="${this.escapeHtml(key)}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="eval-computed-at">
                <i class="fas fa-clock"></i> Computed: ${this.escapeHtml(computedAt)}
                ${value.general?.gtStateIndex !== undefined ? ` | GT: State #${value.general.gtStateIndex}` : ''}
            </div>
            <div class="eval-table-view">
                ${tableHtml}
            </div>
            <div class="eval-raw-view hidden">
                <pre class="metadata-value type-object long-value">${this.escapeHtml(rawJson)}</pre>
            </div>
        `;
        
        // Setup toggle button handler
        const toggleBtn = item.querySelector('.eval-view-toggle');
        const tableView = item.querySelector('.eval-table-view');
        const rawView = item.querySelector('.eval-raw-view');
        
        toggleBtn.addEventListener('click', () => {
            tableView.classList.toggle('hidden');
            rawView.classList.toggle('hidden');
            const icon = toggleBtn.querySelector('i');
            if (rawView.classList.contains('hidden')) {
                icon.className = 'fas fa-code';
                toggleBtn.title = 'Show raw JSON';
            } else {
                icon.className = 'fas fa-table';
                toggleBtn.title = 'Show table view';
            }
        });
        
        // Setup delete button handler
        const deleteBtn = item.querySelector('.state-meta-delete');
        deleteBtn.addEventListener('click', () => this.deleteStateMetadata(key));
        
        return item;
    }
    
    /**
     * Build HTML table for evaluation metrics.
     * @param {Object} data - The evaluation data
     * @returns {string} HTML string for the table
     */
    buildEvaluationTable(data) {
        const sections = [];
        
        // Detection metrics section
        if (data.detection) {
            const d = data.detection;
            sections.push(`
                <div class="eval-section">
                    <div class="eval-section-title">Detection</div>
                    <div class="eval-metrics-row">
                        <div class="eval-metric">
                            <span class="eval-metric-value success">${d.TP ?? '-'}</span>
                            <span class="eval-metric-label">TP</span>
                        </div>
                        <div class="eval-metric">
                            <span class="eval-metric-value danger">${d.FP ?? '-'}</span>
                            <span class="eval-metric-label">FP</span>
                        </div>
                        <div class="eval-metric">
                            <span class="eval-metric-value warning">${d.FN ?? '-'}</span>
                            <span class="eval-metric-label">FN</span>
                        </div>
                    </div>
                    <div class="eval-metrics-row">
                        <div class="eval-metric">
                            <span class="eval-metric-value">${this.formatPercent(d.precision)}</span>
                            <span class="eval-metric-label">Precision</span>
                        </div>
                        <div class="eval-metric">
                            <span class="eval-metric-value">${this.formatPercent(d.recall)}</span>
                            <span class="eval-metric-label">Recall</span>
                        </div>
                        <div class="eval-metric highlight">
                            <span class="eval-metric-value">${this.formatPercent(d.f1)}</span>
                            <span class="eval-metric-label">F1</span>
                        </div>
                    </div>
                </div>
            `);
        }
        
        // Panoptic quality section
        if (data.panoptic) {
            const p = data.panoptic;
            sections.push(`
                <div class="eval-section">
                    <div class="eval-section-title">Panoptic Quality</div>
                    <div class="eval-metrics-row">
                        <div class="eval-metric highlight">
                            <span class="eval-metric-value">${this.formatPercent(p.PQ)}</span>
                            <span class="eval-metric-label">PQ</span>
                        </div>
                        <div class="eval-metric">
                            <span class="eval-metric-value">${this.formatPercent(p.RQ)}</span>
                            <span class="eval-metric-label">RQ</span>
                        </div>
                        <div class="eval-metric">
                            <span class="eval-metric-value">${this.formatPercent(p.SQ)}</span>
                            <span class="eval-metric-label">SQ</span>
                        </div>
                    </div>
                </div>
            `);
        }
        
        // Error breakdown section
        if (data.errors) {
            const e = data.errors;
            sections.push(`
                <div class="eval-section">
                    <div class="eval-section-title">Error Breakdown</div>
                    <div class="eval-errors-list">
                        <div class="eval-error-row">
                            <span class="eval-error-label">Over-segmentation</span>
                            <span class="eval-error-value">${e.nOversegGt ?? 0} GT split (${this.formatPercent(e.oversegFrac)})</span>
                        </div>
                        <div class="eval-error-row">
                            <span class="eval-error-label">Under-segmentation</span>
                            <span class="eval-error-value">${e.nUndersegPred ?? 0} merged (${this.formatPercent(e.undersegFrac)})</span>
                        </div>
                        <div class="eval-error-row">
                            <span class="eval-error-label">Missing GT</span>
                            <span class="eval-error-value">${e.nMissingGt ?? 0} missed (${this.formatPercent(e.missingGtFrac)})</span>
                        </div>
                        <div class="eval-error-row">
                            <span class="eval-error-label">Hallucinated</span>
                            <span class="eval-error-value">${e.nMissingPred ?? 0} spurious (${this.formatPercent(e.missingPredFrac)})</span>
                        </div>
                    </div>
                </div>
            `);
        }
        
        // General info (instances)
        if (data.general) {
            const g = data.general;
            sections.push(`
                <div class="eval-section eval-section-small">
                    <div class="eval-info-row">
                        <span><i class="fas fa-bullseye"></i> GT: ${g.nGtInstances ?? '-'} segments</span>
                        <span><i class="fas fa-crosshairs"></i> Pred: ${g.nPredInstances ?? '-'} segments</span>
                    </div>
                </div>
            `);
        }
        
        // Thresholds
        if (data.thresholds) {
            const t = data.thresholds;
            sections.push(`
                <div class="eval-section eval-section-small">
                    <div class="eval-info-row thresholds">
                        <span>IoU: ${t.iouThresh ?? '-'}</span>
                        <span>Overseg: ${t.oversegThresh ?? '-'}</span>
                        <span>Underseg: ${t.undersegThresh ?? '-'}</span>
                    </div>
                </div>
            `);
        }
        
        return sections.join('');
    }
    
    /**
     * Format a decimal as percentage string.
     * @param {number} value - The value (0-1)
     * @returns {string} Formatted percentage
     */
    formatPercent(value) {
        if (value === undefined || value === null || isNaN(value)) return '-';
        return (value * 100).toFixed(1) + '%';
    }
    
    /**
     * Delete a state-metadata entry.
     * @param {string} key - The key to delete
     */
    deleteStateMetadata(key) {
        this.meshObject.deleteCurrentStateMetadata(key);
        this.showStatus(`Deleted state metadata "${key}"`, 'info');
        this.updateStateMetadataUI();
    }
    
    /**
     * Escape HTML special characters.
     * @param {string} str - The string to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
