export class ActionHistory {
    constructor(maxHistorySize = 100) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.listeners = [];
    }

    push(action) {
        // Add timestamp if not present
        if (!action.timestamp) {
            action.timestamp = Date.now();
        }

        this.undoStack.push(action);
        
        // Limit stack size for memory efficiency
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }
        
        this.redoStack = []; // Clear redo stack when new action is performed
        this.notifyListeners();
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.notifyListeners();
        return action;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        this.notifyListeners();
        return action;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
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