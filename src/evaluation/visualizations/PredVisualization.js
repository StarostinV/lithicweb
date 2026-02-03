/**
 * PredVisualization - Shows the Prediction state.
 * 
 * Displays the prediction annotation with its segmentation,
 * useful for inspecting what the model predicted.
 * 
 * @module PredVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization showing the Prediction state.
 */
export class PredVisualization extends BaseVisualization {
    /**
     * Apply Prediction visualization.
     * Shows the prediction segmentation with colored segments.
     * 
     * @param {Object} metricsResult - Metrics result with predSegmentLabels
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { predSegmentLabels, predIds } = metricsResult;
        
        if (!predSegmentLabels) {
            console.warn('No Pred segment labels in metrics result');
            return;
        }

        const totalVertices = this.meshObject.positions.length / 3;
        
        // Generate colors for each Pred segment
        const segmentColors = this.generateDistinctColors(predIds.length);
        const colorMap = new Map();
        predIds.forEach((id, idx) => {
            colorMap.set(id, segmentColors[idx]);
        });

        // Color vertices by their Pred segment
        for (let i = 0; i < totalVertices; i++) {
            const segmentId = predSegmentLabels[i];
            if (segmentId !== 0 && colorMap.has(segmentId)) {
                this.meshObject.colorVertex(i, colorMap.get(segmentId));
            }
        }

        // Show Pred edges prominently
        if (this.evaluationManager.prediction) {
            this.evaluationManager.prediction.edgeIndices.forEach(i => {
                this.meshObject.colorVertex(i, EVALUATION_COLORS.predEdge);
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
        return 'Shows the Prediction annotation state with colored segments and edge boundaries.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.predEdge, label: 'Pred Edges' },
            { color: EVALUATION_COLORS.neutral, label: 'Pred Segments (various colors)' }
        ];
    }
}
