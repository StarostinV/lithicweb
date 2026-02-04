/**
 * EvaluationManager - Central coordinator for evaluation mode.
 * 
 * Manages the comparison between ground truth and prediction states,
 * coordinates metrics computation, and controls visualization modes.
 * 
 * Key responsibilities:
 * - Store GT and Prediction state references
 * - Compute segments for comparison states
 * - Trigger metrics computation
 * - Manage visualization modes
 * - Restore original state when exiting evaluation
 * 
 * @module EvaluationManager
 */

import * as THREE from 'three';
import { computeInstanceSegmentationMetrics, classifyVertexErrors } from './MetricsComputer.js';
import { MeshSegmenter } from '../geometry/segmentation.js';

/**
 * @typedef {Object} EvaluationState
 * @property {Set<number>} edgeIndices - Set of vertex indices marked as edges
 * @property {number} stateIndex - Index in history timeline
 * @property {string} description - Human-readable description
 */

/**
 * Manages evaluation mode state and operations.
 */
export class EvaluationManager {
    /**
     * Create an EvaluationManager.
     * @param {MeshObject} meshObject - The mesh object to evaluate
     */
    constructor(meshObject) {
        /** @type {MeshObject} */
        this.meshObject = meshObject;

        /** @type {EvaluationState|null} */
        this.groundTruth = null;

        /** @type {EvaluationState|null} */
        this.prediction = null;

        /** @type {Object|null} */
        this.metricsResult = null;

        /** @type {string} */
        this.visualizationMode = 'none';

        /** @type {boolean} */
        this.showGtEdgeOverlay = false;

        /** @type {boolean} */
        this.isInEvaluationMode = false;

        /** @type {Set<number>|null} - Saved state before entering evaluation */
        this.savedState = null;

        /** @type {Function[]} */
        this.listeners = [];

        // Segmenter for computing segments on arbitrary edge states
        this.segmenter = new MeshSegmenter(meshObject);
        
        /** @type {Function|null} - Reference to history listener for cleanup */
        this._historyListenerCallback = null;
        
        // Listen to history changes to clear stale evaluation labels
        this._setupHistoryListener();
    }
    
    /**
     * Setup listener for history changes.
     * Clears evaluation labels when history is cleared (e.g., new mesh loaded).
     * @private
     */
    _setupHistoryListener() {
        let previousTotalStates = this.meshObject.history.getTotalStates();
        
        // Store reference for cleanup in dispose()
        this._historyListenerCallback = (history) => {
            const currentTotal = history.getTotalStates();
            
            // If history was cleared (total states reset to 1 = initial state only)
            // and we had previous states, clear evaluation labels
            if (currentTotal === 1 && previousTotalStates > 1) {
                console.log('[EvaluationManager] History cleared, resetting evaluation labels');
                this.groundTruth = null;
                this.prediction = null;
                this.metricsResult = null;
                this._notifyListeners();
            }
            
            previousTotalStates = currentTotal;
        };
        
        this.meshObject.history.addListener(this._historyListenerCallback);
    }
    
    /**
     * Clean up resources and listeners.
     * Call this before discarding the EvaluationManager instance.
     */
    dispose() {
        // Remove history listener to prevent memory leaks
        if (this._historyListenerCallback) {
            this.meshObject.history.removeListener(this._historyListenerCallback);
            this._historyListenerCallback = null;
        }
        
        // Clear all state
        this.groundTruth = null;
        this.prediction = null;
        this.metricsResult = null;
        this.listeners = [];
    }

    /**
     * Add a listener for state changes.
     * @param {Function} callback - Called when evaluation state changes
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove a listener.
     * @param {Function} callback - The callback to remove
     */
    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    /**
     * Notify all listeners of state change.
     * @private
     */
    _notifyListeners() {
        const state = {
            groundTruth: this.groundTruth,
            prediction: this.prediction,
            metricsResult: this.metricsResult,
            visualizationMode: this.visualizationMode,
            isInEvaluationMode: this.isInEvaluationMode
        };
        this.listeners.forEach(cb => cb(state));
    }

    /**
     * Set the ground truth state from a history state index.
     * @param {number} stateIndex - Index in history timeline (0 = initial state)
     * @param {string} [description] - Optional description
     */
    setGroundTruth(stateIndex, description = null) {
        const edgeIndices = this._getEdgeIndicesForState(stateIndex);
        if (edgeIndices) {
            // Unprotect previous GT state if it was only protected for being GT
            if (this.groundTruth && this.groundTruth.stateIndex !== stateIndex) {
                this._updateProtectionForState(this.groundTruth.stateIndex);
            }
            
            this.groundTruth = {
                edgeIndices: new Set(edgeIndices),
                stateIndex,
                description: description || `State #${stateIndex}`
            };
            
            // Protect the new GT state
            this.meshObject.history.setProtected(stateIndex, true);
            
            this.metricsResult = null; // Invalidate cached metrics
            this._notifyListeners();
        }
    }

    /**
     * Set the prediction state from a history state index.
     * @param {number} stateIndex - Index in history timeline (0 = initial state)
     * @param {string} [description] - Optional description
     */
    setPrediction(stateIndex, description = null) {
        const edgeIndices = this._getEdgeIndicesForState(stateIndex);
        if (edgeIndices) {
            // Unprotect previous Pred state if it was only protected for being Pred
            if (this.prediction && this.prediction.stateIndex !== stateIndex) {
                this._updateProtectionForState(this.prediction.stateIndex);
            }
            
            this.prediction = {
                edgeIndices: new Set(edgeIndices),
                stateIndex,
                description: description || `State #${stateIndex}`
            };
            
            // Protect the new Pred state
            this.meshObject.history.setProtected(stateIndex, true);
            
            this.metricsResult = null; // Invalidate cached metrics
            this._notifyListeners();
        }
    }

    /**
     * Update protection status for a state when a label is removed.
     * Only unprotects if the state has no other reason to be protected.
     * @private
     * @param {number} stateIndex - State index to check
     */
    _updateProtectionForState(stateIndex) {
        if (stateIndex === 0) return; // Initial state can't be protected
        
        const action = this.meshObject.history.getActionAtIndex(stateIndex);
        if (!action) return;
        
        // Check if state still needs protection for other reasons
        const isStillGT = this.groundTruth?.stateIndex === stateIndex;
        const isStillPred = this.prediction?.stateIndex === stateIndex;
        const isModel = action.type === 'model';
        const isRenamed = !!action.customDescription;
        
        // Only unprotect if no other reason exists
        if (!isStillGT && !isStillPred && !isModel && !isRenamed) {
            this.meshObject.history.setProtected(stateIndex, false);
        }
    }

    /**
     * Clear the ground truth state.
     */
    clearGroundTruth() {
        const prevIndex = this.groundTruth?.stateIndex;
        this.groundTruth = null;
        this.metricsResult = null;
        
        // Update protection for the previously labeled state
        if (prevIndex !== undefined && prevIndex !== null) {
            this._updateProtectionForState(prevIndex);
        }
        
        this._notifyListeners();
    }

    /**
     * Clear the prediction state.
     */
    clearPrediction() {
        const prevIndex = this.prediction?.stateIndex;
        this.prediction = null;
        this.metricsResult = null;
        
        // Update protection for the previously labeled state
        if (prevIndex !== undefined && prevIndex !== null) {
            this._updateProtectionForState(prevIndex);
        }
        
        this._notifyListeners();
    }

    /**
     * Check if both GT and Prediction are set.
     * @returns {boolean}
     */
    canComputeMetrics() {
        return this.groundTruth !== null && this.prediction !== null;
    }

    /**
     * Get the ground truth state index.
     * @returns {number|null}
     */
    getGroundTruthIndex() {
        return this.groundTruth ? this.groundTruth.stateIndex : null;
    }

    /**
     * Get the prediction state index.
     * @returns {number|null}
     */
    getPredictionIndex() {
        return this.prediction ? this.prediction.stateIndex : null;
    }

    /**
     * Compute metrics comparing GT and Prediction.
     * @param {Object} options - Metric computation options
     * @param {number} [options.iouThresh=0.5] - IoU threshold for matching
     * @param {number} [options.oversegThresh=0.1] - Over-segmentation threshold
     * @param {number} [options.undersegThresh=0.1] - Under-segmentation threshold
     * @returns {Object|null} Metrics result or null if cannot compute
     */
    computeMetrics(options = {}) {
        if (!this.canComputeMetrics()) {
            console.warn('Cannot compute metrics: GT or Prediction not set');
            return null;
        }

        const {
            iouThresh = 0.5,
            oversegThresh = 0.1,
            undersegThresh = 0.1
        } = options;

        // Compute segment labels for GT and Prediction states
        const gtSegmentLabels = this._computeSegmentLabels(this.groundTruth.edgeIndices);
        const predSegmentLabels = this._computeSegmentLabels(this.prediction.edgeIndices);

        // Compute metrics
        this.metricsResult = computeInstanceSegmentationMetrics(
            gtSegmentLabels,
            predSegmentLabels,
            { iouThresh, oversegThresh, undersegThresh }
        );

        // Add segment label arrays for visualization
        this.metricsResult.gtSegmentLabels = gtSegmentLabels;
        this.metricsResult.predSegmentLabels = predSegmentLabels;

        // Compute vertex error classification
        this.metricsResult.vertexErrors = classifyVertexErrors(
            gtSegmentLabels,
            predSegmentLabels,
            this.metricsResult
        );

        this._notifyListeners();
        return this.metricsResult;
    }

    /**
     * Get the current metrics result.
     * @returns {Object|null}
     */
    getMetrics() {
        return this.metricsResult;
    }

    /**
     * Enter evaluation mode - save current state and apply visualization.
     */
    enterEvaluationMode() {
        if (this.isInEvaluationMode) return;

        // Save current mesh state
        this.savedState = new Set(this.meshObject.currentEdgeIndices);
        this.isInEvaluationMode = true;

        this._notifyListeners();
    }

    /**
     * Exit evaluation mode - restore original state.
     */
    exitEvaluationMode() {
        if (!this.isInEvaluationMode) return;

        // Restore original state
        if (this.savedState) {
            this.meshObject.restoreEdgeState(this.savedState);
            if (document.getElementById('auto-segments')?.checked) {
                this.meshObject.updateSegments();
            }
        }

        this.isInEvaluationMode = false;
        this.visualizationMode = 'none';
        this.savedState = null;

        this._notifyListeners();
    }

    /**
     * Set the visualization mode.
     * @param {string} mode - One of: 'none', 'matched', 'overseg', 'underseg', 'missingGt', 'missingPred', 'all'
     */
    setVisualizationMode(mode) {
        this.visualizationMode = mode;
        if (this.isInEvaluationMode && this.metricsResult) {
            this._applyVisualization();
        }
        this._notifyListeners();
    }

    /**
     * Toggle GT edge overlay visibility.
     * @param {boolean} show
     */
    setShowGtEdgeOverlay(show) {
        this.showGtEdgeOverlay = show;
        if (this.isInEvaluationMode) {
            this._applyVisualization();
        }
        this._notifyListeners();
    }

    /**
     * Apply the current visualization mode to the mesh.
     * @private
     */
    _applyVisualization() {
        if (!this.metricsResult) return;

        const colors = this._getVisualizationColors();
        const vertexErrors = this.metricsResult.vertexErrors;
        const totalVertices = this.meshObject.positions.length / 3;

        // Reset all vertices to base color first
        for (let i = 0; i < totalVertices; i++) {
            this.meshObject.colorVertex(i, this.meshObject.objectColor);
        }

        // Apply visualization based on mode
        if (this.visualizationMode === 'none') {
            // Just show current state edges
            this.groundTruth?.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, this.meshObject.edgeColor);
            });
        } else if (this.visualizationMode === 'all') {
            // Show all error types with different colors
            vertexErrors.forEach((errorType, vertexIdx) => {
                const color = colors[errorType];
                if (color) {
                    this.meshObject.colorVertex(vertexIdx, color);
                }
            });
        } else {
            // Show specific error type
            vertexErrors.forEach((errorType, vertexIdx) => {
                if (errorType === this.visualizationMode) {
                    const color = colors[errorType];
                    if (color) {
                        this.meshObject.colorVertex(vertexIdx, color);
                    }
                } else if (errorType === 'matched') {
                    // Always show matched in a subtle way
                    this.meshObject.colorVertex(vertexIdx, colors.matchedSubtle);
                }
            });
        }

        // Optionally show GT edges overlay
        if (this.showGtEdgeOverlay && this.groundTruth) {
            this.groundTruth.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, colors.gtEdge);
            });
        }

        this.meshObject.mesh.geometry.attributes.color.needsUpdate = true;
    }

    /**
     * Get color scheme for visualization.
     * @private
     * @returns {Object} Color map
     */
    _getVisualizationColors() {
        return {
            matched: new THREE.Color(0.2, 0.8, 0.2),        // Green - correct
            matchedSubtle: new THREE.Color(0.6, 0.8, 0.6),  // Light green
            overseg: new THREE.Color(1.0, 0.6, 0.0),        // Orange - over-segmentation
            underseg: new THREE.Color(0.8, 0.2, 0.8),       // Purple - under-segmentation
            missingGt: new THREE.Color(1.0, 0.2, 0.2),      // Red - false negative
            missingPred: new THREE.Color(1.0, 0.8, 0.2),    // Yellow - false positive
            boundary: new THREE.Color(0.6, 0.6, 0.8),       // Light blue - boundary error
            gtEdge: new THREE.Color(0.0, 0.8, 0.8)          // Cyan - GT edge overlay
        };
    }

    /**
     * Get edge indices for a specific history state.
     * @private
     * @param {number} stateIndex - Index in history timeline
     * @returns {Set<number>|null} Edge indices set or null if invalid
     */
    _getEdgeIndicesForState(stateIndex) {
        const history = this.meshObject.history;

        if (stateIndex === 0) {
            // Initial state
            return new Set(this.meshObject.initialState);
        }

        if (stateIndex <= history.undoStack.length) {
            // State in undo stack
            return new Set(history.undoStack[stateIndex - 1].newState);
        }

        // State in redo stack
        const redoIndex = stateIndex - history.undoStack.length - 1;
        if (redoIndex < history.redoStack.length) {
            const redoStack = history.getRedoStack();
            return new Set(redoStack[redoStack.length - 1 - redoIndex].newState);
        }

        console.warn('Invalid state index:', stateIndex);
        return null;
    }

    /**
     * Compute segment labels for a given edge state.
     * @private
     * @param {Set<number>} edgeIndices - Set of edge vertex indices
     * @returns {number[]} Array of segment labels per vertex
     */
    _computeSegmentLabels(edgeIndices) {
        const totalVertices = this.meshObject.positions.length / 3;
        
        // Create temporary edge labels array
        const tempEdgeLabels = new Uint8Array(totalVertices).fill(0);
        edgeIndices.forEach(i => {
            tempEdgeLabels[i] = 1;
        });

        // Save original edge labels
        const originalEdgeLabels = this.meshObject.edgeLabels;

        // Temporarily set edge labels for segmentation
        this.meshObject.edgeLabels = tempEdgeLabels;

        // Compute segments using flood fill
        const segments = this._floodFillSegments(tempEdgeLabels);

        // Restore original edge labels
        this.meshObject.edgeLabels = originalEdgeLabels;

        // Convert segments to per-vertex labels
        const segmentLabels = new Array(totalVertices).fill(0);
        segments.forEach((segment, idx) => {
            const segmentId = idx + 1;
            segment.forEach(vertexIdx => {
                segmentLabels[vertexIdx] = segmentId;
            });
        });

        return segmentLabels;
    }

    /**
     * Flood fill segmentation for a given edge state.
     * @private
     * @param {Uint8Array} edgeLabels - Edge labels (1 = edge, 0 = not edge)
     * @returns {number[][]} Array of segments (each segment is array of vertex indices)
     */
    _floodFillSegments(edgeLabels) {
        const adjacencyGraph = this.meshObject.adjacencyGraph;
        if (!adjacencyGraph) return [];

        const totalVertices = edgeLabels.length;
        const visited = new Uint8Array(totalVertices).fill(0);
        const segments = [];

        for (let vertex = 0; vertex < totalVertices; vertex++) {
            // Skip if visited or is an edge
            if (visited[vertex] || edgeLabels[vertex] !== 0) continue;

            const segment = [];
            const queue = [vertex];
            let queueStart = 0;

            while (queueStart < queue.length) {
                const v = queue[queueStart++];

                if (visited[v]) continue;
                visited[v] = 1;

                if (edgeLabels[v] === 0) {
                    segment.push(v);

                    // Add neighbors
                    const neighbors = adjacencyGraph.get(v);
                    if (neighbors) {
                        for (const neighbor of neighbors) {
                            if (!visited[neighbor] && edgeLabels[neighbor] === 0) {
                                queue.push(neighbor);
                            }
                        }
                    }
                }
            }

            if (segment.length > 0) {
                segments.push(segment);
            }
        }

        return segments;
    }

    /**
     * Get a summary of the current evaluation state.
     * @returns {Object}
     */
    getSummary() {
        return {
            hasGroundTruth: this.groundTruth !== null,
            hasPrediction: this.prediction !== null,
            groundTruthIndex: this.groundTruth?.stateIndex ?? null,
            predictionIndex: this.prediction?.stateIndex ?? null,
            hasMetrics: this.metricsResult !== null,
            visualizationMode: this.visualizationMode,
            isInEvaluationMode: this.isInEvaluationMode
        };
    }
}
