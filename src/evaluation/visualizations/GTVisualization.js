/**
 * GTVisualization - Shows the Ground Truth state.
 * 
 * Displays the ground truth annotation with its segmentation,
 * useful for inspecting what the reference annotation looks like.
 * 
 * @module GTVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization showing the Ground Truth state.
 */
export class GTVisualization extends BaseVisualization {
    /**
     * Apply GT visualization.
     * Shows the ground truth segmentation with colored segments.
     * 
     * @param {Object} metricsResult - Metrics result with gtSegmentLabels
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { gtSegmentLabels, gtIds } = metricsResult;
        
        if (!gtSegmentLabels) {
            console.warn('No GT segment labels in metrics result');
            return;
        }

        const totalVertices = this.meshView.positions.length / 3;
        
        // Generate colors for each GT segment
        const segmentColors = this.generateDistinctColors(gtIds.length);
        const colorMap = new Map();
        gtIds.forEach((id, idx) => {
            colorMap.set(id, segmentColors[idx]);
        });

        // Color vertices by their GT segment
        for (let i = 0; i < totalVertices; i++) {
            const segmentId = gtSegmentLabels[i];
            if (segmentId !== 0 && colorMap.has(segmentId)) {
                this.meshView.colorVertex(i, colorMap.get(segmentId));
            }
        }

        // Show GT edges prominently
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
        return 'Shows the Ground Truth annotation state with colored segments and edge boundaries.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' },
            { color: EVALUATION_COLORS.neutral, label: 'GT Segments (various colors)' }
        ];
    }
}
