/**
 * HistoryPanel - UI component for managing annotation history.
 * 
 * Displays the history timeline with undo/redo capabilities.
 * Tags (GT/Pred) and renaming are managed in the Library Panel.
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.HISTORY_CHANGED` - Updates UI when history changes
 * 
 * @module HistoryPanel
 */

import { escapeHtml } from '../utils/sanitize.js';
import { eventBus, Events } from '../utils/EventBus.js';

export class HistoryPanel {
    /**
     * Create a HistoryPanel.
     * @param {MeshView} meshView - The mesh view with history
     */
    constructor(meshView) {
        this.meshView = meshView;
        
        // UI Elements
        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.historyList = document.getElementById('historyList');
        this.historyStats = document.getElementById('historyStats');
        
        // Floating buttons for tablet users
        this.floatingUndoBtn = document.getElementById('floatingUndoBtn');
        this.floatingRedoBtn = document.getElementById('floatingRedoBtn');

        this.setupEventListeners();
        this._setupEventBusSubscriptions();
        this.updateUI(meshView.history);
    }
    
    /**
     * Setup EventBus subscriptions.
     * @private
     */
    _setupEventBusSubscriptions() {
        eventBus.on(Events.HISTORY_CHANGED, () => {
            this.updateUI(this.meshView.history);
        }, 'historyPanel');
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     */
    dispose() {
        eventBus.offNamespace('historyPanel');
    }

    setupEventListeners() {
        // Undo button (panel)
        this.undoBtn.addEventListener('click', () => {
            this.meshView.undo();
        });

        // Redo button (panel)
        this.redoBtn.addEventListener('click', () => {
            this.meshView.redo();
        });

        // Floating undo button
        this.floatingUndoBtn.addEventListener('click', () => {
            this.meshView.undo();
        });

        // Floating redo button
        this.floatingRedoBtn.addEventListener('click', () => {
            this.meshView.redo();
        });

        // Clear history button
        this.clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
                this.meshView.history.clear();
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
        
        item.className = `history-item ${isCurrent ? 'current' : ''}`;
        
        // Get initial state edge count
        const initialEdgeCount = this.meshView.initialState ? this.meshView.initialState.size : 0;
        const edgeText = initialEdgeCount === 0 ? 'No annotations' : 'Loaded state';
        
        item.innerHTML = `
            <div class="history-item-content">
                <div class="history-item-header">
                    <span class="history-item-name"><i class="fas fa-circle"></i> Initial State</span>
                    ${isCurrent ? '<i class="fas fa-check-circle history-item-indicator"></i>' : ''}
                </div>
                <div class="history-item-meta">
                    <span>${edgeText}</span>
                    <span>${initialEdgeCount} edges</span>
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            this.meshView.jumpToState(stateIndex);
        });
        
        return item;
    }

    /**
     * Create a history item for a specific action.
     * @private
     */
    createHistoryItem(action, stateIndex, isCurrent) {
        const item = document.createElement('div');
        const hasLibraryLink = !!action.libraryId;
        
        item.className = `history-item ${isCurrent ? 'current' : ''}`;
        
        const timestamp = new Date(action.timestamp).toLocaleTimeString();
        // Support both new (annotation) and legacy (newState) formats
        const edgeCount = action.annotation 
            ? action.annotation.edgeCount 
            : (action.newState ? action.newState.size : 0);
        
        let icon = '<i class="fas fa-pen text-gray-500"></i>';
        if (action.type === 'erase') {
            icon = '<i class="fas fa-eraser text-gray-500"></i>';
        } else if (action.type === 'model') {
            icon = '<i class="fas fa-brain text-purple-500"></i>';
        } else if (action.type === 'cloud') {
            icon = '<i class="fas fa-cloud-download-alt text-blue-500"></i>';
        } else if (action.type === 'library-load') {
            icon = '<i class="fas fa-bookmark text-amber-500"></i>';
        }
        
        const displayName = escapeHtml(action.customDescription || action.description || action.type);
        const libraryIcon = hasLibraryLink ? '<i class="fas fa-bookmark text-amber-500" title="Saved to library"></i>' : '';
        
        item.innerHTML = `
            <div class="history-item-content">
                <div class="history-item-header">
                    <span class="history-item-name">${icon} ${displayName}${libraryIcon}</span>
                    ${isCurrent ? '<i class="fas fa-check-circle history-item-indicator"></i>' : ''}
                </div>
                <div class="history-item-meta">
                    <span>${escapeHtml(timestamp)}</span>
                    <span>${edgeCount} edges</span>
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            this.meshView.jumpToState(stateIndex);
        });
        
        return item;
    }
}
