/**
 * MatchedVisualization - Shows correctly matched vertices.
 * 
 * Highlights vertices that belong to correctly matched GT-Prediction pairs,
 * with intensity based on the overlap quality.
 * 
 * @module MatchedVisualization
 */

import { BaseVisualization, EVALUATION_COLORS } from './BaseVisualization.js';

/**
 * Visualization for correctly matched segments.
 */
export class MatchedVisualization extends BaseVisualization {
    /**
     * Apply matched visualization.
     * Shows green for correctly matched intersection areas,
     * with boundary regions in a lighter shade.
     * 
     * @param {Object} metricsResult - Metrics result with vertexErrors map
     */
    apply(metricsResult) {
        this.resetColors();
        
        const { vertexErrors, boundaryErrors, gtSegmentLabels, predSegmentLabels } = metricsResult;
        
        if (!vertexErrors) {
            console.warn('No vertex errors in metrics result');
            return;
        }

        // Build map of matched GT-Pred pairs
        const matchedPairs = new Map();
        boundaryErrors.forEach(be => {
            matchedPairs.set(be.gtId, be.predId);
        });

        // Color vertices based on match status
        const totalVertices = this.meshObject.positions.length / 3;
        
        for (let i = 0; i < totalVertices; i++) {
            const gtId = gtSegmentLabels[i];
            const predId = predSegmentLabels[i];
            const errorType = vertexErrors.get(i);

            if (errorType === 'matched') {
                // Vertex is in the intersection of a matched pair
                this.meshObject.colorVertex(i, EVALUATION_COLORS.matched);
            } else if (errorType === 'boundary') {
                // Vertex is in a matched pair but not in intersection
                // Determine if it's GT-only or Pred-only
                if (matchedPairs.has(gtId) && matchedPairs.get(gtId) !== predId) {
                    // GT vertex not covered by matched pred (under-detection)
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.boundary);
                } else if (predId !== 0 && gtId === 0) {
                    // Pred vertex not in any GT (over-detection)
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.boundary);
                } else {
                    this.meshObject.colorVertex(i, EVALUATION_COLORS.matchedSubtle);
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
     * Get description of this visualization.
     * @returns {string}
     */
    getDescription() {
        return 'Shows correctly matched segments. Green indicates vertices where GT and prediction overlap correctly. Light green shows boundary regions of matched pairs.';
    }

    /**
     * Get the color legend.
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        return [
            { color: EVALUATION_COLORS.matched, label: 'Correctly Matched' },
            { color: EVALUATION_COLORS.matchedSubtle, label: 'Matched (boundary)' },
            { color: EVALUATION_COLORS.boundary, label: 'Boundary Error' },
            { color: EVALUATION_COLORS.gtEdge, label: 'GT Edges' }
        ];
    }
}
