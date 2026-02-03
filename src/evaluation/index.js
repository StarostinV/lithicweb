/**
 * Evaluation module index - exports all evaluation-related classes and functions.
 * @module evaluation
 */

export { linearSumAssignment, computeAssignmentCost, iouToCostMatrix } from './HungarianAlgorithm.js';
export { computeInstanceSegmentationMetrics, summarizeMetrics, classifyVertexErrors } from './MetricsComputer.js';
export { EvaluationManager } from './EvaluationManager.js';
export * from './visualizations/index.js';
