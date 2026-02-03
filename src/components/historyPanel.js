/**
 * HistoryPanel - UI component for managing annotation history.
 * 
 * Displays the history timeline with undo/redo capabilities and
 * allows labeling states as Ground Truth or Prediction for evaluation.
 * 
 * @module HistoryPanel
 */

export class HistoryPanel {
    /**
     * Create a HistoryPanel.
     * @param {MeshObject} meshObject - The mesh object with history
     * @param {EvaluationManager} [evaluationManager=null] - Optional evaluation manager
     */
    constructor(meshObject, evaluationManager = null) {
        this.meshObject = meshObject;
        this.evaluationManager = evaluationManager;
        
        // UI Elements
        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.historyList = document.getElementById('historyList');
        this.historyStats = document.getElementById('historyStats');
        
        // Floating buttons for tablet users
        this.floatingUndoBtn = document.getElementById('floatingUndoBtn');
        this.floatingRedoBtn = document.getElementById('floatingRedoBtn');

        // Evaluation labels - only one of each allowed at a time
        this.groundTruthIndex = null;
        this.predictionIndex = null;

        this.setupEventListeners();
        this.updateUI(meshObject.history);
    }

    /**
     * Set the evaluation manager (for deferred initialization).
     * @param {EvaluationManager} evaluationManager
     */
    setEvaluationManager(evaluationManager) {
        this.evaluationManager = evaluationManager;
        
        // Listen to evaluation manager changes to update UI
        if (this.evaluationManager) {
            this.evaluationManager.addListener((state) => {
                this.groundTruthIndex = state.groundTruth?.stateIndex ?? null;
                this.predictionIndex = state.prediction?.stateIndex ?? null;
                this.updateUI(this.meshObject.history);
            });
        }
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
                // Clear evaluation labels too
                if (this.evaluationManager) {
                    this.evaluationManager.clearGroundTruth();
                    this.evaluationManager.clearPrediction();
                }
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

    /**
     * Create the initial state history item.
     * @private
     */
    createInitialStateItem(stateIndex, isCurrent) {
        const item = document.createElement('div');
        const isGT = this.groundTruthIndex === stateIndex;
        const isPred = this.predictionIndex === stateIndex;
        // Initial state is protected if it has GT or Pred label
        const isProtected = isGT || isPred;
        
        item.className = `text-xs p-2 rounded mb-1 cursor-pointer transition-all ${
            isCurrent 
                ? 'bg-blue-500 text-white border-2 border-blue-700 shadow-md' 
                : isProtected
                    ? 'bg-amber-50 border border-amber-300 hover:bg-amber-100 hover:border-amber-400'
                    : 'bg-white border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
        }`;
        
        // Get initial state edge count
        const initialEdgeCount = this.meshObject.initialState ? this.meshObject.initialState.size : 0;
        const edgeText = initialEdgeCount === 0 ? 'No annotations' : 'Loaded state';
        const protectedIcon = isProtected ? `<i class="fas fa-lock text-amber-600 ml-1" title="Protected state"></i>` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1 history-item-content">
                    <div class="font-semibold"><i class="fas fa-circle"></i> Initial State${protectedIcon}</div>
                    <div class="${isCurrent ? 'text-blue-100' : 'text-gray-500'}">${edgeText} | ${initialEdgeCount} edges</div>
                    ${this._createEvalLabels(isGT, isPred)}
                </div>
                <div class="flex items-center gap-1">
                    ${this._createEvalButtons(stateIndex, isGT, isPred, isCurrent)}
                    ${isCurrent ? '<i class="fas fa-check-circle text-white ml-1"></i>' : ''}
                </div>
            </div>
        `;
        
        // Make content clickable (but not the buttons)
        const content = item.querySelector('.history-item-content');
        content.addEventListener('click', (e) => {
            if (!e.target.closest('.eval-btn')) {
                this.meshObject.jumpToState(stateIndex);
            }
        });

        // Setup eval button handlers
        this._setupEvalButtonHandlers(item, stateIndex);
        
        return item;
    }

    /**
     * Create a history item for a specific action.
     * @private
     */
    createHistoryItem(action, stateIndex, isCurrent) {
        const item = document.createElement('div');
        const isGT = this.groundTruthIndex === stateIndex;
        const isPred = this.predictionIndex === stateIndex;
        const isProtected = this.meshObject.history.isStateProtected(stateIndex);
        
        item.className = `text-xs p-2 rounded mb-1 cursor-pointer transition-all ${
            isCurrent 
                ? 'bg-blue-500 text-white border-2 border-blue-700 shadow-md' 
                : isProtected
                    ? 'bg-amber-50 border border-amber-300 hover:bg-amber-100 hover:border-amber-400'
                    : 'bg-white border border-gray-300 hover:bg-blue-50 hover:border-blue-300'
        }`;
        
        const timestamp = new Date(action.timestamp).toLocaleTimeString();
        const edgeCount = action.newState ? action.newState.size : 0;
        let icon = '<i class="fas fa-pen"></i>';
        if (action.type === 'erase') {
            icon = '<i class="fas fa-eraser"></i>';
        } else if (action.type === 'model') {
            icon = '<i class="fas fa-brain text-purple-600"></i>';
        }
        
        // Use custom description if available
        const displayName = action.customDescription || action.description || action.type;
        const protectedIcon = isProtected ? `<i class="fas fa-lock text-amber-600 ml-1" title="Protected state"></i>` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1 history-item-content">
                    <div class="font-semibold history-item-name">${icon} <span class="state-name">${displayName}</span>${protectedIcon}</div>
                    <div class="${isCurrent ? 'text-blue-100' : 'text-gray-500'}">${timestamp} | ${edgeCount} edges</div>
                    ${this._createEvalLabels(isGT, isPred)}
                </div>
                <div class="flex items-center gap-1">
                    <button class="rename-btn text-gray-400 hover:text-blue-500 p-1" data-state="${stateIndex}" title="Rename state">
                        <i class="fas fa-edit text-xs"></i>
                    </button>
                    ${this._createEvalButtons(stateIndex, isGT, isPred, isCurrent)}
                    ${isCurrent ? '<i class="fas fa-check-circle text-white ml-1"></i>' : ''}
                </div>
            </div>
        `;
        
        // Make content clickable (but not the buttons)
        const content = item.querySelector('.history-item-content');
        content.addEventListener('click', (e) => {
            if (!e.target.closest('.eval-btn') && !e.target.closest('.rename-btn') && !e.target.closest('.state-name-input')) {
                this.meshObject.jumpToState(stateIndex);
            }
        });

        // Setup eval button handlers
        this._setupEvalButtonHandlers(item, stateIndex);
        
        // Setup rename button handler
        this._setupRenameHandler(item, stateIndex, action);
        
        return item;
    }

    /**
     * Setup rename button click handler.
     * @private
     */
    _setupRenameHandler(item, stateIndex, action) {
        const renameBtn = item.querySelector('.rename-btn');
        const nameSpan = item.querySelector('.state-name');
        
        if (renameBtn && nameSpan) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._startRenameEdit(item, stateIndex, action, nameSpan);
            });
            
            // Also allow double-click on name to edit
            nameSpan.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._startRenameEdit(item, stateIndex, action, nameSpan);
            });
        }
    }

    /**
     * Start inline editing of state name.
     * @private
     */
    _startRenameEdit(item, stateIndex, action, nameSpan) {
        const currentName = action.customDescription || action.description || action.type;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'state-name-input text-xs px-1 py-0 border border-blue-400 rounded w-24 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-gray-900';
        
        nameSpan.replaceWith(input);
        input.focus();
        input.select();
        
        const finishEdit = (save) => {
            if (save && input.value.trim() && input.value.trim() !== (action.description || action.type)) {
                this.meshObject.history.renameState(stateIndex, input.value.trim());
            } else if (save && input.value.trim() === (action.description || action.type)) {
                // Clearing back to original name - remove custom description
                this.meshObject.history.clearCustomDescription(stateIndex);
            }
            // UI will refresh via listener
        };
        
        input.addEventListener('blur', () => finishEdit(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
                this.updateUI(this.meshObject.history); // Refresh to restore original
            }
        });
    }

    /**
     * Create evaluation label badges (shown when state is labeled).
     * @private
     */
    _createEvalLabels(isGT, isPred) {
        const labels = [];
        if (isGT) {
            labels.push('<span class="eval-label gt-label">GT</span>');
        }
        if (isPred) {
            labels.push('<span class="eval-label pred-label">Pred</span>');
        }
        return labels.length > 0 ? `<div class="eval-labels mt-1">${labels.join(' ')}</div>` : '';
    }

    /**
     * Create evaluation toggle buttons.
     * @private
     */
    _createEvalButtons(stateIndex, isGT, isPred, isCurrent) {
        const gtBtnClass = isGT 
            ? 'eval-btn gt-btn active' 
            : `eval-btn gt-btn ${isCurrent ? 'text-white' : ''}`;
        const predBtnClass = isPred 
            ? 'eval-btn pred-btn active' 
            : `eval-btn pred-btn ${isCurrent ? 'text-white' : ''}`;
        
        return `
            <button class="${gtBtnClass}" data-state="${stateIndex}" data-type="gt" title="Set as Ground Truth">
                GT
            </button>
            <button class="${predBtnClass}" data-state="${stateIndex}" data-type="pred" title="Set as Prediction">
                Pred
            </button>
        `;
    }

    /**
     * Setup click handlers for eval buttons in an item.
     * @private
     */
    _setupEvalButtonHandlers(item, stateIndex) {
        const gtBtn = item.querySelector('.gt-btn');
        const predBtn = item.querySelector('.pred-btn');

        if (gtBtn) {
            gtBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handleGTClick(stateIndex);
            });
        }

        if (predBtn) {
            predBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handlePredClick(stateIndex);
            });
        }
    }

    /**
     * Handle GT button click.
     * @private
     */
    _handleGTClick(stateIndex) {
        if (!this.evaluationManager) {
            console.warn('EvaluationManager not set');
            return;
        }

        if (this.groundTruthIndex === stateIndex) {
            // Toggle off
            this.evaluationManager.clearGroundTruth();
        } else {
            // Set new GT
            this.evaluationManager.setGroundTruth(stateIndex, `State #${stateIndex}`);
        }
    }

    /**
     * Handle Prediction button click.
     * @private
     */
    _handlePredClick(stateIndex) {
        if (!this.evaluationManager) {
            console.warn('EvaluationManager not set');
            return;
        }

        if (this.predictionIndex === stateIndex) {
            // Toggle off
            this.evaluationManager.clearPrediction();
        } else {
            // Set new prediction
            this.evaluationManager.setPrediction(stateIndex, `State #${stateIndex}`);
        }
    }

    /**
     * Get the current ground truth index.
     * @returns {number|null}
     */
    getGroundTruthIndex() {
        return this.groundTruthIndex;
    }

    /**
     * Get the current prediction index.
     * @returns {number|null}
     */
    getPredictionIndex() {
        return this.predictionIndex;
    }
}
