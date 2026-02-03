/**
 * MissingGTVisualization - Shows false negative errors.
 * 
 * Highlights GT instances that have no significant prediction coverage,
 * indicating regions that were missed by the prediction.
 * 
 * @module MissingGTVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization for missing GT (false negative) errors.
 */
export class MissingGTVisualization extends BaseVisualization {
    /**
     * Apply missing GT visualization.
     * Shows GT instances that have no or insufficient prediction coverage in red.
     * 
     * @param {Object} metricsResult - Metrics result with missingGtDetails
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { missingGtDetails, gtSegmentLabels, vertexErrors } = metricsResult;
        
        if (!missingGtDetails || missingGtDetails.length === 0) {
            console.log('No missing GT errors detected');
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

        // Build set of missing GT IDs
        const missingGtIds = new Set(missingGtDetails.map(d => d.gtId));

        // Color vertices belonging to missing GT instances
        for (let i = 0; i < totalVertices; i++) {
            const gtId = gtSegmentLabels[i];
            if (missingGtIds.has(gtId)) {
                // Intensity based on how badly it was missed
                const detail = missingGtDetails.find(d => d.gtId === gtId);
                if (detail && detail.bestCoverage < 0.05) {
                    // Completely missed - bright red
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.missingGt);
                } else {
                    // Partially missed - darker red
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.missingGt.clone().multiplyScalar(0.7));
                }
            }
        }

        // Show GT edges
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.gtEdge);
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
        return 'Shows false negative errors - GT instances that have no or insufficient prediction coverage. These are regions that should have been segmented but were missed.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.missingGt, label: 'Missing GT (FN)' },
            { color: EVALUATION_COLORS.matchedSubtle, label: 'Correctly Matched' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' }
        ];
    }
}
