import { eventBus, Events } from './EventBus.js';

/**
 * ActionHistory manages undo/redo history for mesh annotation operations.
 * 
 * ## Terminology Note: "State" vs "Annotation"
 * 
 * In this codebase, "state" and "annotation" are used interchangeably in certain contexts:
 * - A "state" represents a snapshot of edge annotations at a point in time
 * - "State metadata" is metadata specific to an annotation (e.g., evaluation metrics)
 * - This is different from "mesh metadata" which belongs to the mesh itself
 * 
 * The term "state" is used internally (stateMetadata, stateIndex) for historical reasons,
 * but conceptually these represent **annotation states** with their **annotation metadata**.
 * 
 * When saving to cloud storage:
 * - "state" = "annotation" (the edge annotations being saved)
 * - "stateMetadata" = "annotation metadata" (metadata specific to that annotation)
 * 
 * ## Event Bus Integration
 * 
 * ActionHistory emits the following events via the global EventBus:
 * - `Events.HISTORY_CHANGED` - When history changes (push, undo, redo, clear, etc.)
 *   Data: { action: 'push'|'undo'|'redo'|'clear'|'jump'|'update', currentIndex: number, totalStates: number }
 * 
 * Components can subscribe to these events instead of using addListener():
 * ```javascript
 * import { eventBus, Events } from '../utils/EventBus.js';
 * eventBus.on(Events.HISTORY_CHANGED, (data) => {
 *     console.log('History changed:', data.action);
 * });
 * ```
 */
export class ActionHistory {
    constructor(maxHistorySize = 100) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.listeners = [];
        this.currentViewIndex = 0; // Track which state we're viewing (0 = initial)
        
        /**
         * Annotation metadata for the initial state (index 0).
         * Each action has its own stateMetadata property for its annotation metadata.
         * 
         * Note: "stateMetadata" = "annotation metadata" (metadata specific to an annotation,
         * such as evaluation metrics). This is distinct from mesh metadata.
         * @type {Object}
         */
        this.initialStateMetadata = {};
    }

    /**
     * Check if an action is protected from deletion.
     * Protected actions: model predictions, cloud-loaded states, labeled (GT/Pred), or renamed states.
     * @param {Object} action - The action to check
     * @returns {boolean} True if protected
     */
    isActionProtected(action) {
        if (!action) return false;
        // Explicitly protected (GT/Pred labeled)
        if (action.protected) return true;
        // Model predictions are auto-protected
        if (action.type === 'model') return true;
        // Cloud-loaded states are auto-protected
        if (action.type === 'cloud') return true;
        // Renamed states are protected
        if (action.customDescription) return true;
        return false;
    }

    push(action) {
        // Add timestamp if not present
        if (!action.timestamp) {
            action.timestamp = Date.now();
        }
        
        // Initialize empty annotation metadata for new actions
        // Annotation metadata (stateMetadata) is unique per state and NOT carried to new states
        if (!action.stateMetadata) {
            action.stateMetadata = {};
        }

        // If we're viewing an old state, handle truncation with protection
        if (this.currentViewIndex < this.undoStack.length) {
            // Collect protected states that would be truncated
            const protectedStates = [];
            for (let i = this.currentViewIndex; i < this.undoStack.length; i++) {
                if (this.isActionProtected(this.undoStack[i])) {
                    protectedStates.push(this.undoStack[i]);
                }
            }
            // Also collect protected states from redo stack
            for (const redoAction of this.redoStack) {
                if (this.isActionProtected(redoAction)) {
                    protectedStates.push(redoAction);
                }
            }
            
            // Truncate to current view position
            this.undoStack = this.undoStack.slice(0, this.currentViewIndex);
            this.redoStack = [];
            
            // Push the new action
            this.undoStack.push(action);
            
            // Re-add protected states after the new action
            for (const protectedAction of protectedStates) {
                this.undoStack.push(protectedAction);
            }
        } else {
            this.undoStack.push(action);
            this.redoStack = []; // Clear redo stack when new action is performed
        }
        
        // Limit stack size for memory efficiency (but don't remove protected states)
        while (this.undoStack.length > this.maxHistorySize) {
            // Find first non-protected state to remove
            let removed = false;
            for (let i = 0; i < this.undoStack.length - 1; i++) {
                if (!this.isActionProtected(this.undoStack[i])) {
                    this.undoStack.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            // If all states are protected, just break to avoid infinite loop
            if (!removed) break;
        }
        
        this.currentViewIndex = this.undoStack.length; // Update view to latest
        this.notifyListeners('push');
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners('undo');
        return action;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners('redo');
        return action;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    // Jump to view a specific state without modifying stacks
    // Just updates the view index, doesn't move actions between stacks
    jumpToViewState(targetIndex) {
        const totalStates = this.undoStack.length + this.redoStack.length + 1;
        
        if (targetIndex < 0 || targetIndex >= totalStates) {
            return false;
        }

        if (targetIndex === this.currentViewIndex) {
            return false; // Already viewing this state
        }

        this.currentViewIndex = targetIndex;
        this.notifyListeners('jump');
        return true;
    }

    // Get the current view index (position in the timeline we're viewing)
    getCurrentIndex() {
        return this.currentViewIndex;
    }

    // Get total number of states (including current)
    getTotalStates() {
        return this.undoStack.length + this.redoStack.length + 1;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.currentViewIndex = 0;
        this.initialStateMetadata = {};
        this.notifyListeners('clear');
    }

    getUndoStack() {
        return [...this.undoStack];
    }

    getRedoStack() {
        return [...this.redoStack];
    }

    /**
     * Get action at a specific state index.
     * @param {number} stateIndex - State index (1-based, 0 is initial state)
     * @returns {Object|null} The action or null if invalid index
     */
    getActionAtIndex(stateIndex) {
        if (stateIndex === 0) return null; // Initial state has no action
        
        if (stateIndex <= this.undoStack.length) {
            return this.undoStack[stateIndex - 1];
        }
        
        const redoIndex = stateIndex - this.undoStack.length - 1;
        if (redoIndex < this.redoStack.length) {
            return this.redoStack[this.redoStack.length - 1 - redoIndex];
        }
        
        return null;
    }

    /**
     * Set protection status for a state.
     * @param {number} stateIndex - State index (1-based)
     * @param {boolean} isProtected - Whether to protect the state
     */
    setProtected(stateIndex, isProtected) {
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            action.protected = isProtected;
            this.notifyListeners('update');
        }
    }

    /**
     * Rename a state (also protects it).
     * @param {number} stateIndex - State index (1-based)
     * @param {string} newDescription - New description for the state
     */
    renameState(stateIndex, newDescription) {
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            action.customDescription = newDescription;
            this.notifyListeners('update');
        }
    }

    /**
     * Clear custom description (but keep original description).
     * @param {number} stateIndex - State index (1-based)
     */
    clearCustomDescription(stateIndex) {
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            delete action.customDescription;
            this.notifyListeners('update');
        }
    }

    /**
     * Get the display description for a state.
     * @param {number} stateIndex - State index (1-based)
     * @returns {string} The description to display
     */
    getDisplayDescription(stateIndex) {
        const action = this.getActionAtIndex(stateIndex);
        if (!action) return 'Initial State';
        return action.customDescription || action.description || action.type;
    }

    /**
     * Check if a state is protected.
     * @param {number} stateIndex - State index (1-based, 0 is always unprotected)
     * @returns {boolean}
     */
    isStateProtected(stateIndex) {
        if (stateIndex === 0) return false;
        const action = this.getActionAtIndex(stateIndex);
        return this.isActionProtected(action);
    }

    // Listener pattern for UI updates
    
    /**
     * Add a listener for history changes.
     * 
     * @deprecated Prefer using EventBus for new code:
     * ```javascript
     * import { eventBus, Events } from '../utils/EventBus.js';
     * eventBus.on(Events.HISTORY_CHANGED, (data) => {
     *     // data.action, data.currentIndex, data.totalStates
     * });
     * ```
     * 
     * @param {Function} callback - Called with (history) when history changes
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    /**
     * Notify all listeners of history change.
     * Emits both to legacy listeners and the global EventBus.
     * @param {string} [actionType='update'] - Type of change: 'push', 'undo', 'redo', 'clear', 'jump', 'update'
     */
    notifyListeners(actionType = 'update') {
        // Legacy listener pattern (for backward compatibility)
        this.listeners.forEach(callback => callback(this));
        
        // EventBus pattern (preferred for new code)
        eventBus.emit(Events.HISTORY_CHANGED, {
            action: actionType,
            currentIndex: this.currentViewIndex,
            totalStates: this.getTotalStates()
        });
    }

    // ========================================
    // State Metadata Methods
    // ========================================
    
    /**
     * Get annotation metadata for a specific state/annotation.
     * 
     * Note: "stateMetadata" = "annotation metadata" - metadata specific to an annotation,
     * such as evaluation metrics. This is distinct from mesh metadata which is shared.
     * Annotation metadata is unique per state and NOT shared across states.
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @returns {Object} The annotation metadata object (empty {} if none)
     */
    getStateMetadata(stateIndex) {
        if (stateIndex === 0) {
            return this.initialStateMetadata;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            return action.stateMetadata || {};
        }
        
        return {};
    }
    
    /**
     * Set a specific key in annotation metadata for a state.
     * 
     * Note: "stateMetadata" = "annotation metadata" (see class documentation).
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {string} key - The metadata key
     * @param {*} value - The value to set
     */
    setStateMetadataKey(stateIndex, key, value) {
        if (stateIndex === 0) {
            this.initialStateMetadata[key] = value;
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            if (!action.stateMetadata) {
                action.stateMetadata = {};
            }
            action.stateMetadata[key] = value;
            this.notifyListeners('update');
        }
    }
    
    /**
     * Delete a key from annotation metadata for a state.
     * 
     * Note: "stateMetadata" = "annotation metadata" (see class documentation).
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {string} key - The metadata key to delete
     * @returns {boolean} True if the key existed and was deleted
     */
    deleteStateMetadataKey(stateIndex, key) {
        let metadata;
        if (stateIndex === 0) {
            metadata = this.initialStateMetadata;
        } else {
            const action = this.getActionAtIndex(stateIndex);
            if (!action || !action.stateMetadata) return false;
            metadata = action.stateMetadata;
        }
        
        if (key in metadata) {
            delete metadata[key];
            this.notifyListeners('update');
            return true;
        }
        return false;
    }
    
    /**
     * Update multiple keys in annotation metadata for a state.
     * 
     * Note: "stateMetadata" = "annotation metadata" (see class documentation).
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {Object} updates - Object containing key-value pairs to update
     */
    updateStateMetadata(stateIndex, updates) {
        if (stateIndex === 0) {
            this.initialStateMetadata = { ...this.initialStateMetadata, ...updates };
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            if (!action.stateMetadata) {
                action.stateMetadata = {};
            }
            Object.assign(action.stateMetadata, updates);
            this.notifyListeners('update');
        }
    }
    
    /**
     * Clear all annotation metadata for a state.
     * 
     * Note: "stateMetadata" = "annotation metadata" (see class documentation).
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     */
    clearStateMetadata(stateIndex) {
        if (stateIndex === 0) {
            this.initialStateMetadata = {};
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            action.stateMetadata = {};
            this.notifyListeners('update');
        }
    }

    // Get memory usage estimate in bytes
    getMemoryUsage() {
        let totalIndices = 0;
        [...this.undoStack, ...this.redoStack].forEach(action => {
            if (action.edgeIndices) {
                totalIndices += action.edgeIndices.size || action.edgeIndices.length || 0;
            }
        });
        // Each index is approximately 4 bytes (Uint32)
        return totalIndices * 4;
    }
} 