export class HistoryPanel {
    constructor(meshObject) {
        this.meshObject = meshObject;
        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.historyList = document.getElementById('historyList');
        this.historyStats = document.getElementById('historyStats');
        
        // Floating buttons for tablet users
        this.floatingUndoBtn = document.getElementById('floatingUndoBtn');
        this.floatingRedoBtn = document.getElementById('floatingRedoBtn');

        this.setupEventListeners();
        this.updateUI(meshObject.history);
    }

    setupEventListeners() {
        // Listen to history changes
        this.meshObject.history.addListener((history) => this.updateUI(history));

        // Undo button (panel)
        this.undoBtn.addEventListener('click', () => {
            this.meshObject.undo();
        });

        // Redo button (panel)
        this.redoBtn.addEventListener('click', () => {
            this.meshObject.redo();
        });

        // Floating undo button
        this.floatingUndoBtn.addEventListener('click', () => {
            this.meshObject.undo();
        });

        // Floating redo button
        this.floatingRedoBtn.addEventListener('click', () => {
            this.meshObject.redo();
        });

        // Clear history button
        this.clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
                this.meshObject.history.clear();
            }
        });
    }

    updateUI(history) {
        // Update button states (both panel and floating buttons)
        const canUndo = history.canUndo();
        const canRedo = history.canRedo();
        
        this.undoBtn.disabled = !canUndo;
        this.redoBtn.disabled = !canRedo;
        this.floatingUndoBtn.disabled = !canUndo;
        this.floatingRedoBtn.disabled = !canRedo;

        // Update stats
        const undoCount = history.getUndoStack().length;
        // const redoCount = history.getRedoStack().length;
        // const memoryKB = (history.getMemoryUsage() / 1024).toFixed(2);
        // this.historyStats.textContent = `History: ${undoCount} actions | Memory: ${memoryKB} KB`;
        this.historyStats.textContent = `History: ${undoCount} actions`;

        // Update history list
        this.updateHistoryList(history);
    }

    updateHistoryList(history) {
        const undoStack = history.getUndoStack();
        const redoStack = history.getRedoStack();
        const currentIndex = history.getCurrentIndex();

        if (undoStack.length === 0 && redoStack.length === 0) {
            this.historyList.innerHTML = '<p class="text-sm text-gray-500 italic">No actions yet</p>';
            return;
        }

        this.historyList.innerHTML = '';

        // Build all states from newest to oldest (reversed order)
        const allStates = [];

        // Add redo stack (future states, newest first)
        [...redoStack].reverse().forEach((action, reverseIndex) => {
            const stateIndex = undoStack.length + 1 + reverseIndex;
            const isCurrent = stateIndex === currentIndex;
            allStates.push(this.createHistoryItem(action, stateIndex, isCurrent));
        });

        // Add undo stack (past states, newest first)
        [...undoStack].reverse().forEach((action, reverseIndex) => {
            const stateIndex = undoStack.length - reverseIndex;
            const isCurrent = stateIndex === currentIndex;
            allStates.push(this.createHistoryItem(action, stateIndex, isCurrent));
        });

        // Add initial state at the end (bottom of list)
        if (undoStack.length > 0 || redoStack.length > 0) {
            const initialState = this.createInitialStateItem(0, currentIndex === 0);
            allStates.push(initialState);
        }

        // Append all states to the list
        allStates.forEach(item => this.historyList.appendChild(item));
    }

    createInitialStateItem(stateIndex, isCurrent) {
        const item = document.createElement('div');
        item.className = `text-xs p-2 rounded mb-1 cursor-pointer transition-all ${
            isCurrent 
                ? 'bg-blue-500 text-white border-2 border-blue-700 shadow-md' 
                : 'bg-white border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
        }`;
        
        // Get initial state edge count
        const initialEdgeCount = this.meshObject.initialState ? this.meshObject.initialState.size : 0;
        const edgeText = initialEdgeCount === 0 ? 'No annotations' : 'Loaded state';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <div class="font-semibold"><i class="fas fa-circle"></i> Initial State</div>
                    <div class="${isCurrent ? 'text-blue-100' : 'text-gray-500'}">${edgeText} | ${initialEdgeCount} edges</div>
                </div>
                ${isCurrent ? '<i class="fas fa-check-circle text-white"></i>' : ''}
            </div>
        `;
        
        // Make clickable
        item.addEventListener('click', () => {
            this.meshObject.jumpToState(stateIndex);
        });
        
        return item;
    }

    createHistoryItem(action, stateIndex, isCurrent) {
        const item = document.createElement('div');
        item.className = `text-xs p-2 rounded mb-1 cursor-pointer transition-all ${
            isCurrent 
                ? 'bg-blue-500 text-white border-2 border-blue-700 shadow-md' 
                : 'bg-white border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
        }`;
        
        const timestamp = new Date(action.timestamp).toLocaleTimeString();
        const edgeCount = action.newState ? action.newState.size : 0;
        const icon = action.type === 'draw' ? '<i class="fas fa-pen"></i>' : '<i class="fas fa-eraser"></i>';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <div class="font-semibold">${icon} ${action.description || action.type}</div>
                    <div class="${isCurrent ? 'text-blue-100' : 'text-gray-500'}">${timestamp} | ${edgeCount} edges</div>
                </div>
                ${isCurrent ? '<i class="fas fa-check-circle text-white"></i>' : ''}
            </div>
        `;
        
        // Make clickable
        item.addEventListener('click', () => {
            this.meshObject.jumpToState(stateIndex);
        });
        
        return item;
    }
}

