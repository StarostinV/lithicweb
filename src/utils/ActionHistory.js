export class ActionHistory {
    constructor(maxHistorySize = 100) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.listeners = [];
        this.currentViewIndex = 0; // Track which state we're viewing (0 = initial)
    }

    push(action) {
        // Add timestamp if not present
        if (!action.timestamp) {
            action.timestamp = Date.now();
        }

        // If we're viewing an old state, truncate future states
        if (this.currentViewIndex < this.undoStack.length) {
            this.undoStack = this.undoStack.slice(0, this.currentViewIndex);
            this.redoStack = [];
        }

        this.undoStack.push(action);
        
        // Limit stack size for memory efficiency
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }
        
        this.redoStack = []; // Clear redo stack when new action is performed
        this.currentViewIndex = this.undoStack.length; // Update view to latest
        this.notifyListeners();
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners();
        return action;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        this.currentViewIndex = this.undoStack.length;
        this.notifyListeners();
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
        this.notifyListeners();
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
        this.notifyListeners();
    }

    getUndoStack() {
        return [...this.undoStack];
    }

    getRedoStack() {
        return [...this.redoStack];
    }

    // Listener pattern for UI updates
    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    notifyListeners() {
        this.listeners.forEach(callback => callback(this));
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