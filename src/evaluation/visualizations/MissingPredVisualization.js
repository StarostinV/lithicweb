/**
 * MissingPredVisualization - Shows false positive (hallucination) errors.
 * 
 * Highlights prediction instances that have no significant GT coverage,
 * indicating regions that were incorrectly predicted (hallucinations).
 * 
 * @module MissingPredVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization for missing prediction (false positive/hallucination) errors.
 */
export class MissingPredVisualization extends BaseVisualization {
    /**
     * Apply missing prediction visualization.
     * Shows prediction instances that have no or insufficient GT coverage in yellow.
     * 
     * @param {Object} metricsResult - Metrics result with missingPredDetails
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { missingPredDetails, predSegmentLabels, vertexErrors } = metricsResult;
        
        if (!missingPredDetails || missingPredDetails.length === 0) {
            console.log('No hallucination errors detected');
            this._showNoErrorsState();
            return;
        }

        const totalVertices = this.meshObject.positions.length / 3;
        
        // First, show matched areas subtly
        vertexErrors.forEach((errorType, idx) => {
            if (errorType === 'matched') {
                this.meshObject.colorVertex(idx, EVALUATION_COLORS.matchedSubtle);
            }
        });

        // Build set of hallucinated pred IDs
        const missingPredIds = new Set(missingPredDetails.map(d => d.predId));

        // Color vertices belonging to hallucinated predictions
        for (let i = 0; i < totalVertices; i++) {
            const predId = predSegmentLabels[i];
            if (missingPredIds.has(predId)) {
                // Intensity based on how spurious it is
                const detail = missingPredDetails.find(d => d.predId === predId);
                if (detail && detail.bestCoverage < 0.05) {
                    // Complete hallucination - bright yellow
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.missingPred);
                } else {
                    // Partial hallucination - darker yellow
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.missingPred.clone().multiplyScalar(0.7));
                }
            }
        }

        // Show GT edges for reference
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.gtEdge);
            });
        }

        // Show pred edges to see what was predicted
        if (this.evaluationManager.prediction) {
            this.evaluationManager.prediction.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.predEdge);
            });
        }

        this.meshObject.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = true;
    }

    /**
     * Show state when no errors of this type exist.
     * @private
     */
    _showNoErrorsState() {
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.gtEdge);
            });
        }
        this.meshObject.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = true;
    }

    /**
     * Get description of this visualization.
     * @returns {string}
     */
    getDescription() {
        return 'Shows false positive errors (hallucinations) - prediction instances that have no or insufficient GT coverage. These are regions incorrectly predicted as segments.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.missingPred, label: 'Hallucination (FP)' },
            { color: EVALUATION_COLORS.matchedSubtle, label: 'Correctly Matched' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' },
            { color: EVALUATION_COLORS.predEdge, label: 'Pred Edges' }
        ];
    }
}
