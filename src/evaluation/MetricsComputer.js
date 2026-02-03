/**
 * Metrics computation for instance segmentation evaluation.
 * 
 * This module provides comprehensive metrics including:
 * - Standard metrics: TP, FP, FN, Precision, Recall, F1, IoU
 * - Panoptic Quality metrics: PQ, RQ, SQ
 * - Detailed error analysis: over-segmentation, under-segmentation, missing segments
 * 
 * Based on the Python reference implementation for instance segmentation evaluation.
 * 
 * @module MetricsComputer
 */

import { linearSumAssignment } from './HungarianAlgorithm.js';

/**
 * Represents a specific segmentation error.
 * @typedef {Object} SegmentationError
 * @property {string} errorType - Type: 'overseg', 'underseg', 'missingGt', 'missingPred', 'boundary'
 * @property {number[]} gtIds - Involved GT instance IDs
 * @property {number[]} predIds - Involved prediction instance IDs  
 * @property {number} vertexCount - Number of affected vertices
 * @property {Object} details - Type-specific details
 */

/**
 * Compute comprehensive instance segmentation metrics with detailed error analysis.
 * 
 * @param {number[]} gtLabels - Ground truth instance labels per vertex (0 = background/edge)
 * @param {number[]} predLabels - Predicted instance labels per vertex (0 = background/edge)
 * @param {Object} options - Configuration options
 * @param {number} [options.iouThresh=0.5] - Minimum IoU for a match to count as TP
 * @param {number} [options.ignoreLabel=0] - Background/edge label to ignore
 * @param {number} [options.oversegThresh=0.1] - Min fraction of GT for significant coverage
 * @param {number} [options.undersegThresh=0.1] - Min fraction of pred for significant coverage
 * @returns {Object} Comprehensive metrics result
 */
export function computeInstanceSegmentationMetrics(gtLabels, predLabels, options = {}) {
    const {
        iouThresh = 0.5,
        ignoreLabel = 0,
        oversegThresh = 0.1,
        undersegThresh = 0.1
    } = options;

    // Filter to non-background vertices
    const validIndices = [];
    for (let i = 0; i < gtLabels.length; i++) {
        if (gtLabels[i] !== ignoreLabel || predLabels[i] !== ignoreLabel) {
            validIndices.push(i);
        }
    }

    const gt = validIndices.map(i => gtLabels[i]);
    const pr = validIndices.map(i => predLabels[i]);

    // Get unique instance IDs (excluding background)
    const gtIdsSet = new Set(gt.filter(id => id !== ignoreLabel));
    const prIdsSet = new Set(pr.filter(id => id !== ignoreLabel));
    const gtIds = Array.from(gtIdsSet).sort((a, b) => a - b);
    const prIds = Array.from(prIdsSet).sort((a, b) => a - b);

    const nGt = gtIds.length;
    const nPr = prIds.length;

    // Handle empty case
    if (nGt === 0 && nPr === 0) {
        return createEmptyResult();
    }

    // Compute areas (vertex counts per instance)
    const gtAreas = new Map();
    const prAreas = new Map();
    for (const id of gtIds) gtAreas.set(id, 0);
    for (const id of prIds) prAreas.set(id, 0);

    for (let i = 0; i < gt.length; i++) {
        if (gt[i] !== ignoreLabel) {
            gtAreas.set(gt[i], gtAreas.get(gt[i]) + 1);
        }
        if (pr[i] !== ignoreLabel) {
            prAreas.set(pr[i], prAreas.get(pr[i]) + 1);
        }
    }

    // Build index maps
    const gtIndex = new Map();
    const prIndex = new Map();
    gtIds.forEach((id, idx) => gtIndex.set(id, idx));
    prIds.forEach((id, idx) => prIndex.set(id, idx));

    // Build intersection matrix
    const inter = Array(nGt).fill(null).map(() => Array(nPr).fill(0));
    
    for (let i = 0; i < gt.length; i++) {
        const gId = gt[i];
        const pId = pr[i];
        if (gId !== ignoreLabel && pId !== ignoreLabel) {
            const gIdx = gtIndex.get(gId);
            const pIdx = prIndex.get(pId);
            inter[gIdx][pIdx]++;
        }
    }

    // Compute area vectors
    const gtAreaVec = gtIds.map(id => gtAreas.get(id));
    const prAreaVec = prIds.map(id => prAreas.get(id));

    // Compute IoU matrix and coverage matrices
    const iouMatrix = Array(nGt).fill(null).map(() => Array(nPr).fill(0));
    const gtCoverage = Array(nGt).fill(null).map(() => Array(nPr).fill(0));
    const prCoverage = Array(nGt).fill(null).map(() => Array(nPr).fill(0));

    for (let i = 0; i < nGt; i++) {
        for (let j = 0; j < nPr; j++) {
            const intersection = inter[i][j];
            const union = gtAreaVec[i] + prAreaVec[j] - intersection;
            iouMatrix[i][j] = union > 0 ? intersection / union : 0;
            gtCoverage[i][j] = gtAreaVec[i] > 0 ? intersection / gtAreaVec[i] : 0;
            prCoverage[i][j] = prAreaVec[j] > 0 ? intersection / prAreaVec[j] : 0;
        }
    }

    // Hungarian matching
    const costMatrix = iouMatrix.map(row => row.map(iou => 1.0 - iou));
    const { rowInd, colInd } = linearSumAssignment(costMatrix);

    // Filter matches by IoU threshold
    const matchedGtIdx = [];
    const matchedPrIdx = [];
    const matchedIouValues = [];

    for (let k = 0; k < rowInd.length; k++) {
        const i = rowInd[k];
        const j = colInd[k];
        const iou = iouMatrix[i][j];
        if (iou >= iouThresh) {
            matchedGtIdx.push(i);
            matchedPrIdx.push(j);
            matchedIouValues.push(iou);
        }
    }

    const matchedGtSet = new Set(matchedGtIdx);
    const matchedPrSet = new Set(matchedPrIdx);

    // Standard metrics
    const TP = matchedIouValues.length;
    const FP = nPr - TP;
    const FN = nGt - TP;

    const precision = (TP + FP) > 0 ? TP / (TP + FP) : (nPr === 0 ? 1.0 : 0.0);
    const recall = (TP + FN) > 0 ? TP / (TP + FN) : (nGt === 0 ? 1.0 : 0.0);
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0.0;

    const meanIou = TP > 0 ? matchedIouValues.reduce((a, b) => a + b, 0) / TP : NaN;

    // Panoptic Quality metrics
    const denom = TP + 0.5 * FP + 0.5 * FN;
    const PQ = denom > 0 ? matchedIouValues.reduce((a, b) => a + b, 0) / denom : 1.0;
    const RQ = denom > 0 ? TP / denom : 1.0;
    const SQ = TP > 0 ? matchedIouValues.reduce((a, b) => a + b, 0) / TP : NaN;

    // Error analysis
    const errors = [];

    // Over-segmentation analysis
    const oversegDetails = [];
    for (let gtIdx = 0; gtIdx < nGt; gtIdx++) {
        const gtId = gtIds[gtIdx];
        const coveringPrIdx = [];
        for (let prIdx = 0; prIdx < nPr; prIdx++) {
            if (gtCoverage[gtIdx][prIdx] >= oversegThresh) {
                coveringPrIdx.push(prIdx);
            }
        }

        if (coveringPrIdx.length > 1) {
            const prInvolved = coveringPrIdx.map(idx => prIds[idx]);
            const fractions = coveringPrIdx.map(idx => gtCoverage[gtIdx][idx]);
            const totalCoverage = fractions.reduce((a, b) => a + b, 0);
            const affectedVertices = coveringPrIdx.reduce((sum, idx) => sum + inter[gtIdx][idx], 0);

            oversegDetails.push({
                gtId,
                gtArea: gtAreas.get(gtId),
                predIds: prInvolved,
                predFractions: fractions,
                totalCoverage,
                numFragments: prInvolved.length
            });

            errors.push({
                errorType: 'overseg',
                gtIds: [gtId],
                predIds: prInvolved,
                vertexCount: affectedVertices,
                details: { fractions }
            });
        }
    }

    // Under-segmentation analysis
    const undersegDetails = [];
    for (let prIdx = 0; prIdx < nPr; prIdx++) {
        const prId = prIds[prIdx];
        const coveredGtIdx = [];
        for (let gtIdx = 0; gtIdx < nGt; gtIdx++) {
            if (prCoverage[gtIdx][prIdx] >= undersegThresh) {
                coveredGtIdx.push(gtIdx);
            }
        }

        if (coveredGtIdx.length > 1) {
            const gtInvolved = coveredGtIdx.map(idx => gtIds[idx]);
            const fractions = coveredGtIdx.map(idx => prCoverage[idx][prIdx]);
            const affectedVertices = coveredGtIdx.reduce((sum, idx) => sum + inter[idx][prIdx], 0);

            undersegDetails.push({
                predId: prId,
                predArea: prAreas.get(prId),
                gtIds: gtInvolved,
                gtFractions: fractions,
                numMerged: gtInvolved.length
            });

            errors.push({
                errorType: 'underseg',
                gtIds: gtInvolved,
                predIds: [prId],
                vertexCount: affectedVertices,
                details: { fractions }
            });
        }
    }

    // Missing GT analysis (GT with no significant prediction)
    const missingGtDetails = [];
    for (let gtIdx = 0; gtIdx < nGt; gtIdx++) {
        const gtId = gtIds[gtIdx];
        let maxCoverage = 0;
        for (let prIdx = 0; prIdx < nPr; prIdx++) {
            maxCoverage = Math.max(maxCoverage, gtCoverage[gtIdx][prIdx]);
        }

        if (maxCoverage < oversegThresh) {
            missingGtDetails.push({
                gtId,
                area: gtAreas.get(gtId),
                bestCoverage: maxCoverage
            });

            errors.push({
                errorType: 'missingGt',
                gtIds: [gtId],
                predIds: [],
                vertexCount: gtAreas.get(gtId),
                details: { bestCoverage: maxCoverage }
            });
        }
    }

    // Missing Pred analysis (hallucinations - pred with no GT)
    const missingPredDetails = [];
    for (let prIdx = 0; prIdx < nPr; prIdx++) {
        const prId = prIds[prIdx];
        let maxCoverage = 0;
        for (let gtIdx = 0; gtIdx < nGt; gtIdx++) {
            maxCoverage = Math.max(maxCoverage, prCoverage[gtIdx][prIdx]);
        }

        if (maxCoverage < undersegThresh) {
            missingPredDetails.push({
                predId: prId,
                area: prAreas.get(prId),
                bestCoverage: maxCoverage
            });

            errors.push({
                errorType: 'missingPred',
                gtIds: [],
                predIds: [prId],
                vertexCount: prAreas.get(prId),
                details: { bestCoverage: maxCoverage }
            });
        }
    }

    // Boundary errors for matched pairs
    const boundaryErrors = [];
    for (let k = 0; k < matchedGtIdx.length; k++) {
        const gtIdx = matchedGtIdx[k];
        const prIdx = matchedPrIdx[k];
        const gtId = gtIds[gtIdx];
        const prId = prIds[prIdx];
        const intersection = inter[gtIdx][prIdx];
        const gtOnly = gtAreas.get(gtId) - intersection;
        const prOnly = prAreas.get(prId) - intersection;

        boundaryErrors.push({
            gtId,
            predId: prId,
            iou: matchedIouValues[k],
            intersection,
            gtOnly,
            predOnly: prOnly,
            gtArea: gtAreas.get(gtId),
            predArea: prAreas.get(prId)
        });
    }

    // Aggregate error statistics
    const totalVertices = gt.length;

    const oversegVertices = errors
        .filter(e => e.errorType === 'overseg')
        .reduce((sum, e) => sum + e.vertexCount, 0);
    const undersegVertices = errors
        .filter(e => e.errorType === 'underseg')
        .reduce((sum, e) => sum + e.vertexCount, 0);
    const missingGtVertices = errors
        .filter(e => e.errorType === 'missingGt')
        .reduce((sum, e) => sum + e.vertexCount, 0);
    const missingPredVertices = errors
        .filter(e => e.errorType === 'missingPred')
        .reduce((sum, e) => sum + e.vertexCount, 0);

    const matchedIntersection = boundaryErrors.reduce((sum, be) => sum + be.intersection, 0);

    return {
        // Standard metrics
        TP,
        FP,
        FN,
        precision,
        recall,
        f1,
        meanIou,
        PQ,
        RQ,
        SQ,

        // Instance counts
        nGtInstances: nGt,
        nPredInstances: nPr,

        // Error counts
        nOversegGt: oversegDetails.length,
        nUndersegPred: undersegDetails.length,
        nMissingGt: missingGtDetails.length,
        nMissingPred: missingPredDetails.length,

        // Vertex-level breakdown
        oversegVertices,
        undersegVertices,
        missingGtVertices,
        missingPredVertices,
        matchedVertices: matchedIntersection,
        totalVertices,

        // Fractions
        oversegFrac: totalVertices > 0 ? oversegVertices / totalVertices : 0,
        undersegFrac: totalVertices > 0 ? undersegVertices / totalVertices : 0,
        missingGtFrac: totalVertices > 0 ? missingGtVertices / totalVertices : 0,
        missingPredFrac: totalVertices > 0 ? missingPredVertices / totalVertices : 0,

        // Detailed lists
        oversegDetails,
        undersegDetails,
        missingGtDetails,
        missingPredDetails,
        boundaryErrors,
        errors,

        // Raw data for visualization
        iouMatrix,
        gtCoverageMatrix: gtCoverage,
        prCoverageMatrix: prCoverage,
        gtIds,
        predIds: prIds,
        
        // Matching info for visualization
        matchedGtIdx,
        matchedPrIdx,
        matchedIouValues,
        
        // Area maps
        gtAreas: Object.fromEntries(gtAreas),
        predAreas: Object.fromEntries(prAreas),
        
        // Index maps
        gtIndex: Object.fromEntries(gtIndex),
        predIndex: Object.fromEntries(prIndex),
        
        // Intersection matrix
        intersectionMatrix: inter
    };
}

/**
 * Create an empty metrics result for edge cases.
 * @private
 * @returns {Object} Empty result structure
 */
function createEmptyResult() {
    return {
        TP: 0,
        FP: 0,
        FN: 0,
        precision: 1.0,
        recall: 1.0,
        f1: 1.0,
        meanIou: NaN,
        PQ: 1.0,
        RQ: 1.0,
        SQ: NaN,
        nGtInstances: 0,
        nPredInstances: 0,
        nOversegGt: 0,
        nUndersegPred: 0,
        nMissingGt: 0,
        nMissingPred: 0,
        oversegVertices: 0,
        undersegVertices: 0,
        missingGtVertices: 0,
        missingPredVertices: 0,
        matchedVertices: 0,
        totalVertices: 0,
        oversegFrac: 0,
        undersegFrac: 0,
        missingGtFrac: 0,
        missingPredFrac: 0,
        oversegDetails: [],
        undersegDetails: [],
        missingGtDetails: [],
        missingPredDetails: [],
        boundaryErrors: [],
        errors: [],
        iouMatrix: [],
        gtCoverageMatrix: [],
        prCoverageMatrix: [],
        gtIds: [],
        predIds: [],
        matchedGtIdx: [],
        matchedPrIdx: [],
        matchedIouValues: [],
        gtAreas: {},
        predAreas: {},
        gtIndex: {},
        predIndex: {},
        intersectionMatrix: []
    };
}

/**
 * Generate a human-readable summary of segmentation metrics.
 * 
 * @param {Object} result - Metrics result from computeInstanceSegmentationMetrics
 * @returns {string} Formatted summary string
 */
export function summarizeMetrics(result) {
    const lines = [
        '=== Instance Segmentation Summary ===',
        `GT instances: ${result.nGtInstances}, Pred instances: ${result.nPredInstances}`,
        `TP: ${result.TP}, FP: ${result.FP}, FN: ${result.FN}`,
        `Precision: ${result.precision.toFixed(3)}, Recall: ${result.recall.toFixed(3)}, F1: ${result.f1.toFixed(3)}`,
        `PQ: ${result.PQ.toFixed(3)}, RQ: ${result.RQ.toFixed(3)}, SQ: ${isNaN(result.SQ) ? 'N/A' : result.SQ.toFixed(3)}`,
        '',
        '=== Error Breakdown ===',
        `Over-segmentation: ${result.nOversegGt} GT instances split (${(result.oversegFrac * 100).toFixed(1)}% vertices)`,
        `Under-segmentation: ${result.nUndersegPred} pred instances merge multiple GT (${(result.undersegFrac * 100).toFixed(1)}% vertices)`,
        `Missing GT (false negatives): ${result.nMissingGt} instances (${(result.missingGtFrac * 100).toFixed(1)}% vertices)`,
        `Hallucinated pred (false positives): ${result.nMissingPred} instances (${(result.missingPredFrac * 100).toFixed(1)}% vertices)`
    ];
    return lines.join('\n');
}

/**
 * Compute per-vertex error classification for visualization.
 * 
 * @param {number[]} gtLabels - Ground truth labels
 * @param {number[]} predLabels - Prediction labels
 * @param {Object} metricsResult - Result from computeInstanceSegmentationMetrics
 * @returns {Map<number, string>} Map from vertex index to error type
 */
export function classifyVertexErrors(gtLabels, predLabels, metricsResult) {
    const vertexErrors = new Map();
    const ignoreLabel = 0;

    // Build sets of vertices for each error type
    const oversegGtIds = new Set(metricsResult.oversegDetails.map(d => d.gtId));
    const undersegPredIds = new Set(metricsResult.undersegDetails.map(d => d.predId));
    const missingGtIds = new Set(metricsResult.missingGtDetails.map(d => d.gtId));
    const missingPredIds = new Set(metricsResult.missingPredDetails.map(d => d.predId));

    // Build matched pairs map
    const matchedGtToPred = new Map();
    const matchedPredToGt = new Map();
    for (let k = 0; k < metricsResult.matchedGtIdx.length; k++) {
        const gtId = metricsResult.gtIds[metricsResult.matchedGtIdx[k]];
        const predId = metricsResult.predIds[metricsResult.matchedPrIdx[k]];
        matchedGtToPred.set(gtId, predId);
        matchedPredToGt.set(predId, gtId);
    }

    // Classify each vertex
    for (let i = 0; i < gtLabels.length; i++) {
        const gtId = gtLabels[i];
        const predId = predLabels[i];

        // Skip background/edges
        if (gtId === ignoreLabel && predId === ignoreLabel) {
            continue;
        }

        // Missing GT (false negative)
        if (missingGtIds.has(gtId)) {
            vertexErrors.set(i, 'missingGt');
            continue;
        }

        // Missing Pred (hallucination/false positive)
        if (missingPredIds.has(predId)) {
            vertexErrors.set(i, 'missingPred');
            continue;
        }

        // Over-segmentation
        if (oversegGtIds.has(gtId)) {
            vertexErrors.set(i, 'overseg');
            continue;
        }

        // Under-segmentation
        if (undersegPredIds.has(predId)) {
            vertexErrors.set(i, 'underseg');
            continue;
        }

        // Matched correctly
        if (matchedGtToPred.has(gtId) && matchedPredToGt.has(predId)) {
            if (gtId === ignoreLabel || predId === ignoreLabel) {
                // Boundary error within matched pair
                vertexErrors.set(i, 'boundary');
            } else if (matchedGtToPred.get(gtId) === predId) {
                vertexErrors.set(i, 'matched');
            } else {
                vertexErrors.set(i, 'boundary');
            }
            continue;
        }

        // Default: boundary/other error
        vertexErrors.set(i, 'boundary');
    }

    return vertexErrors;
}
