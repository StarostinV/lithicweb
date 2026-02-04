/**
 * BaseVisualization - Abstract base class for evaluation visualizations.
 * 
 * Provides common functionality for all visualization modes and defines
 * the interface that concrete visualizations must implement.
 * 
 * @module BaseVisualization
 */

import * as THREE from 'three';

/**
 * Standard color palette for evaluation visualizations.
 * Designed for accessibility and clear differentiation.
 */
export const EVALUATION_COLORS = Object.freeze({
    /** Green - correctly matched vertices */
    matched: new THREE.Color(0.2, 0.8, 0.2),
    
    /** Light green - subtle indication of matched areas */
    matchedSubtle: new THREE.Color(0.6, 0.85, 0.6),
    
    /** Orange - over-segmentation (GT split across multiple preds) */
    overseg: new THREE.Color(1.0, 0.5, 0.0),
    
    /** Purple/Magenta - under-segmentation (pred merges multiple GTs) */
    underseg: new THREE.Color(0.8, 0.2, 0.8),
    
    /** Red - missing GT (false negatives) */
    missingGt: new THREE.Color(0.9, 0.2, 0.2),
    
    /** Yellow - missing pred/hallucinations (false positives) */
    missingPred: new THREE.Color(1.0, 0.85, 0.0),
    
    /** Light blue - boundary errors in matched pairs */
    boundary: new THREE.Color(0.5, 0.7, 0.9),
    
    /** Cyan - GT edge overlay */
    gtEdge: new THREE.Color(0.0, 0.9, 0.9),
    
    /** White - pred edge overlay */
    predEdge: new THREE.Color(1.0, 1.0, 1.0),
    
    /** Gray - neutral/background */
    neutral: new THREE.Color(0.5, 0.5, 0.5)
});

/**
 * Abstract base class for evaluation visualizations.
 * 
 * Concrete subclasses must implement:
 * - apply(metricsResult): Apply the visualization to the mesh
 * - getDescription(): Return a human-readable description
 * - getColorLegend(): Return color legend entries
 */
export class BaseVisualization {
    /**
     * Create a visualization.
     * @param {MeshView} meshView - The mesh object to visualize
     * @param {EvaluationManager} evaluationManager - The evaluation manager
     */
    constructor(meshView, evaluationManager) {
        if (new.target === BaseVisualization) {
            throw new Error('BaseVisualization is abstract and cannot be instantiated directly');
        }
        
        /** @type {MeshView} */
        this.meshView = meshView;
        
        /** @type {EvaluationManager} */
        this.evaluationManager = evaluationManager;
        
        /** @type {boolean} */
        this.isApplied = false;
    }

    /**
     * Apply the visualization to the mesh.
     * Must be implemented by subclasses.
     * 
     * @abstract
     * @param {Object} metricsResult - Result from MetricsComputer
     */
    apply(metricsResult) {
        throw new Error('apply() must be implemented by subclass');
    }

    /**
     * Get a human-readable description of this visualization.
     * Must be implemented by subclasses.
     * 
     * @abstract
     * @returns {string}
     */
    getDescription() {
        throw new Error('getDescription() must be implemented by subclass');
    }

    /**
     * Get the color legend for this visualization.
     * Must be implemented by subclasses.
     * 
     * @abstract
     * @returns {Array<{color: THREE.Color, label: string}>}
     */
    getColorLegend() {
        throw new Error('getColorLegend() must be implemented by subclass');
    }

    /**
     * Get the unique identifier for this visualization mode.
     * @returns {string}
     */
    getId() {
        return this.constructor.name.replace('Visualization', '').toLowerCase();
    }

    /**
     * Reset all vertex colors to the base object color.
     */
    resetColors() {
        const totalVertices = this.meshView.positions.length / 3;
        for (let i = 0; i < totalVertices; i++) {
            this.meshView.colorVertex(i, this.meshView.objectColor);
        }
        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
        this.isApplied = false;
    }

    /**
     * Color a set of vertices with a specific color.
     * @param {Iterable<number>} indices - Vertex indices to color
     * @param {THREE.Color} color - Color to apply
     */
    colorVertices(indices, color) {
        for (const idx of indices) {
            this.meshView.colorVertex(idx, color);
        }
        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
    }

    /**
     * Color vertices based on a map of index to color.
     * @param {Map<number, THREE.Color>} colorMap - Map of vertex index to color
     */
    applyColorMap(colorMap) {
        colorMap.forEach((color, idx) => {
            this.meshView.colorVertex(idx, color);
        });
        this.meshView.mesh.geometry.attributes.color.needsUpdate = true;
    }

    /**
     * Get vertices belonging to specific error types.
     * @param {Map<number, string>} vertexErrors - Map of vertex index to error type
     * @param {string[]} errorTypes - Error types to filter
     * @returns {Set<number>} Vertex indices matching the error types
     */
    getVerticesByErrorType(vertexErrors, errorTypes) {
        const result = new Set();
        const typeSet = new Set(errorTypes);
        vertexErrors.forEach((errorType, idx) => {
            if (typeSet.has(errorType)) {
                result.add(idx);
            }
        });
        return result;
    }

    /**
     * Generate distinct colors for multiple segments.
     * @param {number} count - Number of colors needed
     * @returns {THREE.Color[]} Array of distinct colors
     */
    generateDistinctColors(count) {
        const colors = [];
        const goldenRatio = 0.618033988749895;
        let hue = Math.random();
        
        for (let i = 0; i < count; i++) {
            hue = (hue + goldenRatio) % 1;
            const color = new THREE.Color();
            color.setHSL(hue, 0.7, 0.5);
            colors.push(color);
        }
        
        return colors;
    }
}

/**
 * Factory function to create visualization instances.
 * @param {string} mode - Visualization mode identifier
 * @param {MeshView} meshView - The mesh object
 * @param {EvaluationManager} evaluationManager - The evaluation manager
 * @returns {BaseVisualization|null} Visualization instance or null if mode unknown
 */
export function createVisualization(mode, meshView, evaluationManager) {
    // Import here to avoid circular dependencies
    const visualizations = {
        matched: () => import('./MatchedVisualization.js').then(m => new m.MatchedVisualization(meshView, evaluationManager)),
        overseg: () => import('./OverSegVisualization.js').then(m => new m.OverSegVisualization(meshView, evaluationManager)),
        underseg: () => import('./UnderSegVisualization.js').then(m => new m.UnderSegVisualization(meshView, evaluationManager)),
        missingGt: () => import('./MissingGTVisualization.js').then(m => new m.MissingGTVisualization(meshView, evaluationManager)),
        missingPred: () => import('./MissingPredVisualization.js').then(m => new m.MissingPredVisualization(meshView, evaluationManager)),
        all: () => import('./AllErrorsVisualization.js').then(m => new m.AllErrorsVisualization(meshView, evaluationManager))
    };
    
    if (visualizations[mode]) {
        return visualizations[mode]();
    }
    
    console.warn(`Unknown visualization mode: ${mode}`);
    return null;
}
