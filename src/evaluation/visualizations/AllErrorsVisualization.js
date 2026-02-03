/**
 * AllErrorsVisualization - Shows all error types in a combined view.
 * 
 * Provides an overview of all segmentation errors with a unified color scheme,
 * allowing quick assessment of overall segmentation quality.
 * 
 * @module AllErrorsVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization showing all error types simultaneously.
 */
export class AllErrorsVisualization extends BaseVisualization {
    /**
     * Apply combined visualization showing all error types.
     * Uses consistent color coding for each error type.
     * 
     * @param {Object} metricsResult - Metrics result with vertexErrors map
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { vertexErrors } = metricsResult;
        
        if (!vertexErrors || vertexErrors.size === 0) {
            console.log('No vertex errors to visualize');
            this._showNoErrorsState();
            return;
        }

        // Color each vertex based on its error type
        vertexErrors.forEach((errorType, vertexIdx) => {
            let color;
            switch (errorType) {
                case 'matched':
                    color = EVALUATION_COLORS.matched;
                    break;
                case 'overseg':
                    color = EVALUATION_COLORS.overseg;
                    break;
                case 'underseg':
                    color = EVALUATION_COLORS.underseg;
                    break;
                case 'missingGt':
                    color = EVALUATION_COLORS.missingGt;
                    break;
                case 'missingPred':
                    color = EVALUATION_COLORS.missingPred;
                    break;
                case 'boundary':
                    color = EVALUATION_COLORS.boundary;
                    break;
                default:
                    color = EVALUATION_COLORS.neutral;
            }
            this.meshObject.colorVertex(vertexIdx, color);
        });

        // Show GT edges as overlay
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.gtEdge);
            });
        }

        this.meshObject.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = true;
    }

    /**
     * Show state when no errors exist.
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
        return 'Overview of all segmentation errors. Each error type is shown in a distinct color for quick quality assessment.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.matched, label: 'Correctly Matched' },
            { color: EVALUATION_COLORS.overseg, label: 'Over-segmentation' },
            { color: EVALUATION_COLORS.underseg, label: 'Under-segmentation' },
            { color: EVALUATION_COLORS.missingGt, label: 'Missing GT (FN)' },
            { color: EVALUATION_COLORS.missingPred, label: 'Hallucination (FP)' },
            { color: EVALUATION_COLORS.boundary, label: 'Boundary Error' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' }
        ];
    }
}
