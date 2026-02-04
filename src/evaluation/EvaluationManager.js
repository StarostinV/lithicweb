/**
 * EvaluationManager - Central coordinator for evaluation mode.
 * 
 * Manages the comparison between ground truth and prediction annotations,
 * coordinates metrics computation, and controls visualization modes.
 * 
 * Key responsibilities:
 * - Store GT and Prediction annotations
 * - Compute segments for comparison
 * - Trigger metrics computation
 * - Manage visualization modes
 * - Restore original state when exiting evaluation
 * 
 * ## Event Bus Integration
 * 
 * EvaluationManager emits the following events via the global EventBus:
 * - `Events.EVALUATION_GT_CHANGED` - When ground truth is set/cleared
 *   Data: { isSet: boolean, annotation: Annotation|null, description: string|null }
 * - `Events.EVALUATION_PRED_CHANGED` - When prediction is set/cleared
 *   Data: { isSet: boolean, annotation: Annotation|null, description: string|null }
 * - `Events.EVALUATION_METRICS_COMPUTED` - When metrics are computed
 *   Data: { metrics: object }
 * - `Events.EVALUATION_MODE_CHANGED` - When evaluation mode is entered/exited
 *   Data: { isActive: boolean }
 * 
 * @module EvaluationManager
 */

import * as THREE from 'three';
import { eventBus, Events } from '../utils/EventBus.js';
import { computeInstanceSegmentationMetrics, classifyVertexErrors } from './MetricsComputer.js';
import { MeshSegmenter } from '../geometry/segmentation.js';
import { Annotation } from '../geometry/Annotation.js';

/**
 * @typedef {Object} EvaluationState
 * @property {Annotation} annotation - The annotation object
 * @property {Set<number>} edgeIndices - Set of vertex indices marked as edges (derived from annotation)
 * @property {string} description - Human-readable description
 */

/**
 * Manages evaluation mode state and operations.
 */
export class EvaluationManager {
    /**
     * Create an EvaluationManager.
     * @param {MeshView} meshView - The mesh object to evaluate
     */
    constructor(meshView) {
        /** @type {MeshView} */
        this.meshView = meshView;

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

        // Segmenter for computing segments on arbitrary edge states
        this.segmenter = new MeshSegmenter(meshView);
    }
    
    /**
     * Clean up resources.
     */
    dispose() {
        this.groundTruth = null;
        this.prediction = null;
        this.metricsResult = null;
    }

    /**
     * Emit state change via EventBus.
     * @private
     * @param {string} [eventType='state'] - Type of change
     */
    _notifyListeners(eventType = 'state') {
        if (eventType === 'gt' || eventType === 'state') {
            eventBus.emit(Events.EVALUATION_GT_CHANGED, {
                isSet: this.groundTruth !== null,
                annotation: this.groundTruth?.annotation ?? null,
                description: this.groundTruth?.description ?? null
            });
        }
        
        if (eventType === 'pred' || eventType === 'state') {
            eventBus.emit(Events.EVALUATION_PRED_CHANGED, {
                isSet: this.prediction !== null,
                annotation: this.prediction?.annotation ?? null,
                description: this.prediction?.description ?? null
            });
        }
        
        if (eventType === 'metrics') {
            eventBus.emit(Events.EVALUATION_METRICS_COMPUTED, {
                metrics: this.metricsResult
            });
        }
        
        if (eventType === 'mode') {
            eventBus.emit(Events.EVALUATION_MODE_CHANGED, {
                isActive: this.isInEvaluationMode
            });
        }
    }

    /**
     * Set the ground truth annotation.
     * @param {Annotation} annotation - The annotation to use as GT
     */
    setGroundTruth(annotation) {
        this.groundTruth = {
            annotation: annotation.clone(),
            edgeIndices: new Set(annotation.edgeIndices),
            description: annotation.name || 'Ground Truth'
        };
        
        this.metricsResult = null;
        this._notifyListeners('gt');
    }
    
    /**
     * Set the prediction annotation.
     * @param {Annotation} annotation - The annotation to use as Prediction
     */
    setPrediction(annotation) {
        this.prediction = {
            annotation: annotation.clone(),
            edgeIndices: new Set(annotation.edgeIndices),
            description: annotation.name || 'Prediction'
        };
        
        this.metricsResult = null;
        this._notifyListeners('pred');
    }

    /**
     * Clear the ground truth state.
     */
    clearGroundTruth() {
        this.groundTruth = null;
        this.metricsResult = null;
        this._notifyListeners('gt');
    }

    /**
     * Clear the prediction state.
     */
    clearPrediction() {
        this.prediction = null;
        this.metricsResult = null;
        this._notifyListeners('pred');
    }

    /**
     * Check if both GT and Prediction are set.
     * @returns {boolean}
     */
    canComputeMetrics() {
        return this.groundTruth !== null && this.prediction !== null;
    }

    /**
     * Get the ground truth annotation.
     * @returns {Annotation|null}
     */
    getGroundTruthAnnotation() {
        return this.groundTruth?.annotation ?? null;
    }

    /**
     * Get the prediction annotation.
     * @returns {Annotation|null}
     */
    getPredictionAnnotation() {
        return this.prediction?.annotation ?? null;
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

        this._notifyListeners('metrics');
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
        this.savedState = new Set(this.meshView.currentEdgeIndices);
        this.isInEvaluationMode = true;

        this._notifyListeners('mode');
    }

    /**
     * Exit evaluation mode - restore original state.
     */
    exitEvaluationMode() {
        if (!this.isInEvaluationMode) return;

        // Restore original state
        if (this.savedState) {
            this.meshView.restoreEdgeState(this.savedState);
            if (document.getElementById('auto-segments')?.checked) {
                this.meshView.updateSegments();
            }
        }

        this.isInEvaluationMode = false;
        this.visualizationMode = 'none';
        this.savedState = null;

        this._notifyListeners('mode');
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
        this._notifyListeners('mode');
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
        this._notifyListeners('mode');
    }

    /**
     * Apply the current visualization mode to the mesh.
     * @private
     */
    _applyVisualization() {
        if (!this.metricsResult) return;

        const colors = this._getVisualizationColors();
        const vertexErrors = this.metricsResult.vertexErrors;
        const totalVertices = this.meshView.positions.length / 3;

        // Reset all vertices to base color first
        for (let i = 0; i < totalVertices; i++) {
            this.meshView.colorVertex(i, this.meshView.objectColor);
        }

        // Apply visualization based on mode
        if (this.visualizationMode === 'none') {
            // Just show current state edges
            this.groundTruth?.edgeIndices.forEach(i => {
                this.meshView.colorVertex(i, this.meshView.edgeColor);
            });
        } else if (this.visualizationMode === 'all') {
            // Show all error types with different colors
            vertexErrors.forEach((errorType, vertexIdx) => {
                const color = colors[errorType];
                if (color) {
                    this.meshView.colorVertex(vertexIdx, color);
                }
            });
        } else {
            // Show specific error type
            vertexErrors.forEach((errorType, vertexIdx) => {
                if (errorType === this.visualizationMode) {
                    const color = colors[errorType];
                    if (color) {
                        this.meshView.colorVertex(vertexIdx, color);
                    }
                } else if (errorType === 'matched') {
                    // Always show matched in a subtle way
                    this.meshView.colorVertex(vertexIdx, colors.matchedSubtle);
                }
            });
        }

        // Optionally show GT edges overlay
        if (this.showGtEdgeOverlay && this.groundTruth) {
            this.groundTruth.edgeIndices.forEach(i => {
                this.meshView.colorVertex(i, colors.gtEdge);
            });
        }

        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
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
     * Get an Annotation for a specific history state.
     * @private
     * @param {number} stateIndex - Index in history timeline
     * @returns {Annotation|null} Annotation or null if invalid
     */
    _getAnnotationForState(stateIndex) {
        const history = this.meshView.history;
        
        if (stateIndex === 0) {
            // Initial state - use history's initial annotation or create from initialState
            if (history.initialAnnotation) {
                return history.initialAnnotation.clone();
            }
            return new Annotation({
                edgeIndices: new Set(this.meshView.initialState),
                name: 'Initial State',
                source: 'manual'
            });
        }
        
        // Use history's getAnnotationAtIndex which handles both formats
        const annotation = history.getAnnotationAtIndex(stateIndex);
        if (annotation) {
            return annotation;
        }
        
        // Fallback: create from edge indices
        const edgeIndices = this._getEdgeIndicesForState(stateIndex);
        if (edgeIndices) {
            return new Annotation({
                edgeIndices,
                name: `State #${stateIndex}`,
                source: 'manual'
            });
        }
        
        return null;
    }

    /**
     * Get edge indices for a specific history state.
     * @private
     * @param {number} stateIndex - Index in history timeline
     * @returns {Set<number>|null} Edge indices set or null if invalid
     */
    _getEdgeIndicesForState(stateIndex) {
        // Use history's unified method
        return this.meshView.history.getStateAtIndex(stateIndex);
    }

    /**
     * Compute segment labels for a given edge state.
     * @private
     * @param {Set<number>} edgeIndices - Set of edge vertex indices
     * @returns {number[]} Array of segment labels per vertex
     */
    _computeSegmentLabels(edgeIndices) {
        const totalVertices = this.meshView.positions.length / 3;
        
        // Create temporary edge labels array
        const tempEdgeLabels = new Uint8Array(totalVertices).fill(0);
        edgeIndices.forEach(i => {
            tempEdgeLabels[i] = 1;
        });

        // Save original edge labels
        const originalEdgeLabels = this.meshView.edgeLabels;

        // Temporarily set edge labels for segmentation
        this.meshView.edgeLabels = tempEdgeLabels;

        // Compute segments using flood fill
        const segments = this._floodFillSegments(tempEdgeLabels);

        // Restore original edge labels
        this.meshView.edgeLabels = originalEdgeLabels;

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
        const adjacencyGraph = this.meshView.adjacencyGraph;
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
            groundTruthDescription: this.groundTruth?.description ?? null,
            predictionDescription: this.prediction?.description ?? null,
            hasMetrics: this.metricsResult !== null,
            visualizationMode: this.visualizationMode,
            isInEvaluationMode: this.isInEvaluationMode
        };
    }
}
