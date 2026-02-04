/**
 * OverSegVisualization - Shows over-segmentation errors.
 * 
 * Highlights GT instances that have been split across multiple predictions.
 * Each fragment is shown in a different color to visualize the split.
 * 
 * @module OverSegVisualization
 */

import * as THREE from 'three';
import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization for over-segmentation errors.
 */
export class OverSegVisualization extends BaseVisualization {
    /**
     * Apply over-segmentation visualization.
     * Shows GT instances that are split across multiple predictions,
     * with each prediction fragment in a different color.
     * 
     * @param {Object} metricsResult - Metrics result with oversegDetails
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { oversegDetails, gtSegmentLabels, predSegmentLabels, vertexErrors } = metricsResult;
        
        if (!oversegDetails || oversegDetails.length === 0) {
            // No over-segmentation, show message and return
            console.log('No over-segmentation errors detected');
            this._showNoErrorsState();
            return;
        }

        const totalVertices = this.meshView.positions.length / 3;
        
        // First, show matched areas subtly
        vertexErrors.forEach((errorType, idx) => {
            if (errorType === 'matched') {
                this.meshView.colorVertex(idx, EVALUATION_COLORS.matchedSubtle);
            }
        });

        // For each over-segmented GT instance, color the fragments
        oversegDetails.forEach(detail => {
            const gtId = detail.gtId;
            const predIds = detail.predIds;
            
            // Generate distinct colors for each prediction fragment
            const fragmentColors = this.generateDistinctColors(predIds.length);
            
            // Create map from pred ID to color
            const predColorMap = new Map();
            predIds.forEach((predId, idx) => {
                predColorMap.set(predId, fragmentColors[idx]);
            });

            // Color vertices belonging to this GT instance
            for (let i = 0; i < totalVertices; i++) {
                if (gtSegmentLabels[i] === gtId) {
                    const predId = predSegmentLabels[i];
                    if (predColorMap.has(predId)) {
                        this.meshView.colorVertex(i, predColorMap.get(predId));
                    } else {
                        // Part of GT not covered by any significant pred
                        this.meshView.colorVertex(i, EVALUATION_COLORS.overseg);
                    }
                }
            }
        });

        // Show GT edges to highlight boundaries
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshView.colorVertex(i, EVALUATION_COLORS.gtEdge);
            });
        }

        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = true;
    }

    /**
     * Show state when no errors of this type exist.
     * @private
     */
    _showNoErrorsState() {
        // Show GT edges only
        if (this.evaluationManager.groundTruth) {
            this.evaluationManager.groundTruth.edgeIndices.forEach(i => {
                this.meshView.colorVertex(i, EVALUATION_COLORS.gtEdge);
            });
        }
        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = true;
    }

    /**
     * Get description of this visualization.
     * @returns {string}
     */
    getDescription() {
        return 'Shows over-segmentation errors where a single GT instance is incorrectly split across multiple predictions. Each prediction fragment is shown in a different color.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.overseg, label: 'Over-segmented GT' },
            { color: new THREE.Color(0.9, 0.4, 0.4), label: 'Fragment 1' },
            { color: new THREE.Color(0.4, 0.9, 0.4), label: 'Fragment 2' },
            { color: new THREE.Color(0.4, 0.4, 0.9), label: 'Fragment 3+' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' }
        ];
    }
}
