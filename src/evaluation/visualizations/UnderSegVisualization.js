/**
 * UnderSegVisualization - Shows under-segmentation errors.
 * 
 * Highlights prediction instances that incorrectly merge multiple GT instances.
 * Each GT instance within the merged prediction is shown in a different color.
 * 
 * @module UnderSegVisualization
 */

import * as THREE from 'three';
import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization for under-segmentation errors.
 */
export class UnderSegVisualization extends BaseVisualization {
    /**
     * Apply under-segmentation visualization.
     * Shows predictions that merge multiple GT instances,
     * with each GT region in a different color.
     * 
     * @param {Object} metricsResult - Metrics result with undersegDetails
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { undersegDetails, gtSegmentLabels, predSegmentLabels, vertexErrors } = metricsResult;
        
        if (!undersegDetails || undersegDetails.length === 0) {
            console.log('No under-segmentation errors detected');
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

        // For each under-segmented prediction, color the merged GT regions
        undersegDetails.forEach(detail => {
            const predId = detail.predId;
            const gtIds = detail.gtIds;
            
            // Generate distinct colors for each GT region within the merged pred
            const regionColors = this.generateDistinctColors(gtIds.length);
            
            // Create map from GT ID to color
            const gtColorMap = new Map();
            gtIds.forEach((gtId, idx) => {
                gtColorMap.set(gtId, regionColors[idx]);
            });

            // Color vertices belonging to this prediction
            for (let i = 0; i < totalVertices; i++) {
                if (predSegmentLabels[i] === predId) {
                    const gtId = gtSegmentLabels[i];
                    if (gtColorMap.has(gtId)) {
                        this.meshObject.colorVertex(i, gtColorMap.get(gtId));
                    } else {
                        // Part of pred that doesn't correspond to significant GT
                        this.meshObject.colorVertex(i, EVALUATION_COLORS.underseg);
                    }
                }
            }
        });

        // Show GT edges to highlight where splits should have occurred
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
        return 'Shows under-segmentation errors where a single prediction incorrectly merges multiple GT instances. Each GT region within the merged prediction is shown in a different color.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.underseg, label: 'Under-segmented Pred' },
            { color: new THREE.Color(0.9, 0.4, 0.4), label: 'Merged GT 1' },
            { color: new THREE.Color(0.4, 0.9, 0.4), label: 'Merged GT 2' },
            { color: new THREE.Color(0.4, 0.4, 0.9), label: 'Merged GT 3+' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges (missing)' }
        ];
    }
}
