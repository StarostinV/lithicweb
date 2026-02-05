import { eventBus, Events } from './EventBus.js';
import { Annotation } from '../geometry/Annotation.js';

/**
 * Action - Wrapper around an Annotation representing a history action.
 * 
 * Each Action stores the annotation state AFTER the action was performed.
 * The previous state can be obtained from the preceding action in the stack.
 * 
 * @typedef {Object} Action
 * @property {Annotation} annotation - The annotation state after this action
 * @property {string} type - Action type: 'draw', 'erase', 'model', 'cloud', 'library-load'
 * @property {string} description - Auto-generated description
 * @property {string} [customDescription] - User-provided name
 * @property {number} timestamp - When the action was performed
 * @property {string} [libraryId] - If saved to library, the library annotation ID
 */

/**
 * ActionHistory manages undo/redo history for mesh annotation operations.
 * 
 * ## Annotation-Based Architecture
 * 
 * Each action in the history stores a complete Annotation object representing
 * the state AFTER that action. This makes it easy to:
 * - Jump to any state directly
 * - Save states to the library
 * - Compare states for evaluation
 * 
 * ## Event Bus Integration
 * 
 * ActionHistory emits the following events via the global EventBus:
 * - `Events.HISTORY_CHANGED` - When history changes
 *   Data: { action: 'push'|'undo'|'redo'|'clear'|'jump'|'update', currentIndex: number, totalStates: number }
 */
export class ActionHistory {
    /**
     * Create an ActionHistory.
     * 
     * @param {Object} options - Configuration options
     * @param {number} [options.maxHistorySize=100] - Maximum history size
     */
    constructor(options = {}) {
        const { maxHistorySize = 100 } = options;
        
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.currentViewIndex = 0;
        
        /**
         * The initial annotation state (before any actions).
         * @type {Annotation}
         */
        this.initialAnnotation = Annotation.empty('Initial State');
    }

    /**
     * Create an action from the current state.
     * 
     * @param {Object} params - Action parameters
     * @param {Set<number>} params.edgeIndices - Current edge indices
     * @param {Array} [params.arrows=[]] - Current arrows
     * @param {string} params.type - Action type
     * @param {string} [params.description] - Action description
     * @param {Object} [params.metadata={}] - Additional annotation metadata
     * @returns {Action} The created action
     */
    createAction({ edgeIndices, arrows = [], type, description, metadata = {} }) {
        // Determine the annotation name - prioritize existing metadata.name over description
        // This prevents overwriting original annotation names with action descriptions like "Load: ..."
        const annotationName = metadata.name || description || this._getDefaultDescription(type);
        const actionDescription = description || this._getDefaultDescription(type);
        
        const annotation = new Annotation({
            edgeIndices: new Set(edgeIndices),
            arrows: arrows.map(a => ({ ...a })),
            source: type === 'model' ? 'model' : type === 'cloud' ? 'cloud' : 'manual',
            metadata: {
                ...metadata,
                name: annotationName,
            }
        });
        
        return {
            annotation,
            type,
            description: actionDescription,
            timestamp: Date.now(),
        };
    }

    /**
     * Get default description for an action type.
     * @private
     */
    _getDefaultDescription(type) {
        switch (type) {
            case 'draw': return 'Draw edges';
            case 'erase': return 'Erase edges';
            case 'model': return 'AI segmentation';
            case 'cloud': return 'Cloud state';
            case 'library-load': return 'Load from library';
            default: return type;
        }
    }

    /**
     * Push an action to the history.
     * 
     * @param {Action|Object} action - The action to push
     */
    push(action) {
        // Ensure timestamp
        if (!action.timestamp) {
            action.timestamp = Date.now();
        }
        
        // Convert old-style action to new style if needed
        if (!action.annotation && action.newState) {
            action = this._convertLegacyAction(action);
        }
        
        // Ensure annotation exists
        if (!action.annotation) {
            console.warn('ActionHistory.push: action missing annotation');
            return;
        }

        // Clear redo stack on new action (standard undo/redo behavior)
        this.redoStack = [];
        
        // Push the new action
        this.undoStack.push(action);
        
        // Limit stack size
        while (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }
        
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners('push');
    }

    /**
     * Convert a legacy action format to the new Annotation-based format.
     * @private
     */
    _convertLegacyAction(legacyAction) {
        const annotation = new Annotation({
            edgeIndices: new Set(legacyAction.newState || []),
            arrows: [],
            source: legacyAction.type === 'model' ? 'model' : 
                    legacyAction.type === 'cloud' ? 'cloud' : 'manual',
            metadata: {
                name: legacyAction.customDescription || legacyAction.description || legacyAction.type,
                ...(legacyAction.stateMetadata || {})
            }
        });
        
        return {
            annotation,
            type: legacyAction.type,
            description: legacyAction.description,
            customDescription: legacyAction.customDescription,
            timestamp: legacyAction.timestamp || Date.now(),
            // Keep legacy fields for compatibility during transition
            previousState: legacyAction.previousState,
            newState: legacyAction.newState,
        };
    }

    /**
     * Undo the last action.
     * 
     * @returns {Action|null} The undone action, or null if nothing to undo
     */
    undo() {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners('undo');
        return action;
    }

    /**
     * Redo the last undone action.
     * 
     * @returns {Action|null} The redone action, or null if nothing to redo
     */
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

    /**
     * Jump to view a specific state without modifying stacks.
     * 
     * @param {number} targetIndex - State index (0 = initial)
     * @returns {boolean} True if jump was successful
     */
    jumpToViewState(targetIndex) {
        const totalStates = this.undoStack.length + this.redoStack.length + 1;
        
        if (targetIndex < 0 || targetIndex >= totalStates) {
            return false;
        }

        if (targetIndex === this.currentViewIndex) {
            return false;
        }

        this.currentViewIndex = targetIndex;
        this.notifyListeners('jump');
        return true;
    }

    /**
     * Get the current view index.
     * @returns {number}
     */
    getCurrentIndex() {
        return this.currentViewIndex;
    }

    /**
     * Get total number of states (including initial).
     * @returns {number}
     */
    getTotalStates() {
        return this.undoStack.length + this.redoStack.length + 1;
    }

    /**
     * Clear all history.
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.currentViewIndex = 0;
        this.initialAnnotation = Annotation.empty('Initial State');
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
     * 
     * @param {number} stateIndex - State index (1-based, 0 is initial state)
     * @returns {Action|null} The action or null if invalid index
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
     * Get the annotation at a specific state index.
     * 
     * @param {number} stateIndex - State index (0 = initial)
     * @returns {Annotation|null} Clone of the annotation, or null
     */
    getAnnotationAtIndex(stateIndex) {
        if (stateIndex === 0) {
            return this.initialAnnotation.clone();
        }
        
        const action = this.getActionAtIndex(stateIndex);
        return action?.annotation?.clone() || null;
    }

    /**
     * Get the edge state at a specific index (for compatibility).
     * 
     * @param {number} stateIndex - State index (0 = initial)
     * @returns {Set<number>|null} Edge indices set
     */
    getStateAtIndex(stateIndex) {
        if (stateIndex === 0) {
            return new Set(this.initialAnnotation.edgeIndices);
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            // Support both new and legacy format
            if (action.annotation) {
                return new Set(action.annotation.edgeIndices);
            }
            if (action.newState) {
                return new Set(action.newState);
            }
        }
        
        return null;
    }

    /**
     * Get the display description for a state.
     * 
     * @param {number} stateIndex - State index (1-based)
     * @returns {string} The description to display
     */
    getDisplayDescription(stateIndex) {
        if (stateIndex === 0) return 'Initial State';
        const action = this.getActionAtIndex(stateIndex);
        if (!action) return 'Initial State';
        return action.customDescription || action.description || action.type;
    }

    /**
     * Link an action to a library annotation ID.
     * 
     * @param {number} stateIndex - State index (1-based)
     * @param {string} libraryId - The library annotation ID
     */
    setLibraryLink(stateIndex, libraryId) {
        const action = this.getActionAtIndex(stateIndex);
        if (action) {
            action.libraryId = libraryId;
            if (action.annotation) {
                action.annotation.setMetadata('libraryId', libraryId);
            }
            this.notifyListeners('update');
        }
    }

    /**
     * Get the library ID for a state.
     * 
     * @param {number} stateIndex - State index (1-based)
     * @returns {string|null}
     */
    getLibraryLink(stateIndex) {
        const action = this.getActionAtIndex(stateIndex);
        return action?.libraryId || null;
    }

    /**
     * Notify of history change via EventBus.
     * @param {string} [actionType='update'] - Type of change
     */
    notifyListeners(actionType = 'update') {
        eventBus.emit(Events.HISTORY_CHANGED, {
            action: actionType,
            currentIndex: this.currentViewIndex,
            totalStates: this.getTotalStates()
        });
    }

    // ========================================
    // State Metadata Methods (Annotation-based)
    // ========================================
    
    /**
     * Get annotation metadata for a specific state.
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @returns {Object} The annotation metadata object
     */
    getStateMetadata(stateIndex) {
        if (stateIndex === 0) {
            return this.initialAnnotation.metadata;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action?.annotation) {
            return action.annotation.metadata;
        }
        
        // Legacy support
        if (action?.stateMetadata) {
            return action.stateMetadata;
        }
        
        return {};
    }
    
    /**
     * Set a specific key in annotation metadata for a state.
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {string} key - The metadata key
     * @param {*} value - The value to set
     */
    setStateMetadataKey(stateIndex, key, value) {
        if (stateIndex === 0) {
            this.initialAnnotation.setMetadata(key, value);
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action?.annotation) {
            action.annotation.setMetadata(key, value);
            this.notifyListeners('update');
        } else if (action) {
            // Legacy support
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
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {string} key - The metadata key to delete
     * @returns {boolean} True if the key existed and was deleted
     */
    deleteStateMetadataKey(stateIndex, key) {
        if (stateIndex === 0) {
            return this.initialAnnotation.deleteMetadata(key);
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action?.annotation) {
            const result = action.annotation.deleteMetadata(key);
            if (result) this.notifyListeners('update');
            return result;
        }
        
        // Legacy support
        if (action?.stateMetadata && key in action.stateMetadata) {
            delete action.stateMetadata[key];
            this.notifyListeners('update');
            return true;
        }
        
        return false;
    }
    
    /**
     * Update multiple keys in annotation metadata for a state.
     * 
     * @param {number} stateIndex - State index (0 for initial state)
     * @param {Object} updates - Object containing key-value pairs to update
     */
    updateStateMetadata(stateIndex, updates) {
        if (stateIndex === 0) {
            this.initialAnnotation.updateMetadata(updates);
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action?.annotation) {
            action.annotation.updateMetadata(updates);
            this.notifyListeners('update');
        } else if (action) {
            // Legacy support
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
     * @param {number} stateIndex - State index (0 for initial state)
     */
    clearStateMetadata(stateIndex) {
        if (stateIndex === 0) {
            // Reset to defaults only
            this.initialAnnotation.metadata = {
                name: 'Initial State',
                source: 'manual',
                createdAt: this.initialAnnotation.metadata.createdAt,
                modifiedAt: Date.now()
            };
            this.notifyListeners('update');
            return;
        }
        
        const action = this.getActionAtIndex(stateIndex);
        if (action?.annotation) {
            const name = action.annotation.name;
            const source = action.annotation.source;
            const createdAt = action.annotation.metadata.createdAt;
            action.annotation.metadata = {
                name,
                source,
                createdAt,
                modifiedAt: Date.now()
            };
            this.notifyListeners('update');
        } else if (action) {
            // Legacy support
            action.stateMetadata = {};
            this.notifyListeners('update');
        }
    }

    /**
     * Set the initial annotation state.
     * 
     * @param {Annotation} annotation - The initial annotation
     */
    setInitialAnnotation(annotation) {
        this.initialAnnotation = annotation.clone();
        this.initialAnnotation.name = 'Initial State';
    }

    /**
     * Get memory usage estimate in bytes.
     * @returns {number}
     */
    getMemoryUsage() {
        let totalIndices = 0;
        [...this.undoStack, ...this.redoStack].forEach(action => {
            if (action.annotation) {
                totalIndices += action.annotation.edgeCount;
            } else if (action.newState) {
                // Legacy format
                totalIndices += action.newState.size || 0;
            }
        });
        // Each index is approximately 4 bytes (Uint32)
        return totalIndices * 4;
    }
}
