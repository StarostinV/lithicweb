export class ActionHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }

    push(action) {
        this.undoStack.push(action);
        this.redoStack = []; // Clear redo stack when new action is performed
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        return action;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        return action;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
} 