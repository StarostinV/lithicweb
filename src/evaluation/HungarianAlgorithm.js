/**
 * Hungarian Algorithm (Kuhn-Munkres) for solving the linear sum assignment problem.
 * 
 * This module provides an O(n³) implementation for finding the optimal assignment
 * that minimizes the total cost in a bipartite matching problem.
 * 
 * @module HungarianAlgorithm
 */

/**
 * Solve the linear sum assignment problem using the Hungarian algorithm.
 * 
 * Given a cost matrix where cost[i][j] represents the cost of assigning
 * row i to column j, find the assignment that minimizes total cost.
 * 
 * @param {number[][]} costMatrix - n x m cost matrix (can be rectangular)
 * @returns {{rowInd: number[], colInd: number[], cost: number}} 
 *          - rowInd: array of row indices in the optimal assignment
 *          - colInd: array of column indices (colInd[i] is assigned to rowInd[i])
 *          - cost: total cost of the optimal assignment
 * 
 * @example
 * const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
 * const result = linearSumAssignment(cost);
 * // result.rowInd = [0, 1, 2], result.colInd = [1, 0, 2], result.cost = 1+2+2 = 5
 */
export function linearSumAssignment(costMatrix) {
    if (!costMatrix || costMatrix.length === 0) {
        return { rowInd: [], colInd: [], cost: 0 };
    }

    const nRows = costMatrix.length;
    const nCols = costMatrix[0].length;

    // Handle edge cases
    if (nRows === 0 || nCols === 0) {
        return { rowInd: [], colInd: [], cost: 0 };
    }

    // Make a square matrix by padding with large values if needed
    const n = Math.max(nRows, nCols);
    const LARGE = Number.MAX_SAFE_INTEGER / 2;
    
    // Create padded cost matrix
    const cost = [];
    for (let i = 0; i < n; i++) {
        cost[i] = [];
        for (let j = 0; j < n; j++) {
            if (i < nRows && j < nCols) {
                cost[i][j] = costMatrix[i][j];
            } else {
                cost[i][j] = LARGE;
            }
        }
    }

    // Run Hungarian algorithm on square matrix
    const assignment = hungarianCore(cost, n);

    // Extract valid assignments (those within original matrix bounds)
    const rowInd = [];
    const colInd = [];
    let totalCost = 0;

    for (let i = 0; i < n; i++) {
        const j = assignment[i];
        if (i < nRows && j < nCols) {
            rowInd.push(i);
            colInd.push(j);
            totalCost += costMatrix[i][j];
        }
    }

    return { rowInd, colInd, cost: totalCost };
}

/**
 * Core Hungarian algorithm implementation for square matrices.
 * Uses the standard potential-based approach with augmenting paths.
 * 
 * @private
 * @param {number[][]} cost - n x n cost matrix
 * @param {number} n - matrix dimension
 * @returns {number[]} assignment array where assignment[i] = j means row i is assigned to column j
 */
function hungarianCore(cost, n) {
    // u[i] = potential for row i
    // v[j] = potential for column j
    // p[j] = row assigned to column j (0 means unassigned, we use 1-indexing internally)
    // way[j] = previous column in augmenting path
    
    const u = new Array(n + 1).fill(0);
    const v = new Array(n + 1).fill(0);
    const p = new Array(n + 1).fill(0);  // p[j] = row assigned to column j (1-indexed)
    const way = new Array(n + 1).fill(0);

    // Process each row
    for (let i = 1; i <= n; i++) {
        // p[0] is a virtual column that starts the augmenting path
        p[0] = i;
        let j0 = 0;  // Current column in path (0 = virtual starting column)
        
        const minv = new Array(n + 1).fill(Infinity);
        const used = new Array(n + 1).fill(false);

        // Find augmenting path
        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;

            // Find minimum reduced cost among unused columns
            for (let j = 1; j <= n; j++) {
                if (!used[j]) {
                    // Reduced cost = cost[i0-1][j-1] - u[i0] - v[j]
                    const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if (minv[j] < delta) {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }

            // Update potentials
            for (let j = 0; j <= n; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }

            j0 = j1;
        } while (p[j0] !== 0);

        // Reconstruct augmenting path and update assignment
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0 !== 0);
    }

    // Convert to 0-indexed assignment array
    const assignment = new Array(n);
    for (let j = 1; j <= n; j++) {
        if (p[j] !== 0) {
            assignment[p[j] - 1] = j - 1;
        }
    }

    return assignment;
}

/**
 * Compute the cost of a given assignment.
 * Useful for verification and debugging.
 * 
 * @param {number[][]} costMatrix - The cost matrix
 * @param {number[]} rowInd - Row indices of assignment
 * @param {number[]} colInd - Column indices of assignment
 * @returns {number} Total cost of the assignment
 */
export function computeAssignmentCost(costMatrix, rowInd, colInd) {
    let total = 0;
    for (let i = 0; i < rowInd.length; i++) {
        total += costMatrix[rowInd[i]][colInd[i]];
    }
    return total;
}

/**
 * Create a cost matrix from IoU matrix for assignment.
 * Since Hungarian minimizes cost, we use 1 - IoU as cost.
 * 
 * @param {number[][]} iouMatrix - IoU values between GT and predicted segments
 * @returns {number[][]} Cost matrix (1 - IoU)
 */
export function iouToCostMatrix(iouMatrix) {
    return iouMatrix.map(row => row.map(iou => 1.0 - iou));
}
