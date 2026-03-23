/**
 * ScarOrdering - Manages temporal ordering of lithic scars via pairwise comparisons.
 *
 * Stores pairwise "younger/older" comparisons in a directed acyclic graph (DAG),
 * where edges point from younger scars to older scars. Provides cycle detection,
 * topological sorting, and serialization for persistence.
 *
 * Comparisons can come from two sources:
 * - **expert**: User-provided orderings that take priority
 * - **preseed**: Heuristic-derived orderings that are automatically removed to resolve cycles
 *
 * The DAG is maintained via two adjacency maps:
 * - `_adjacency`: younger → Set<older> (forward edges)
 * - `_reverse`: older → Set<younger> (backward edges)
 *
 * @example
 * const ordering = new ScarOrdering(scarGraph);
 * ordering.preseedFromGraph(scarGraph);
 * ordering.addComparison(scarA, scarB, 'expert');
 * const order = ordering.getTopologicalOrder(); // youngest first
 */
export class ScarOrdering {
    /**
     * Create a new ScarOrdering.
     *
     * @param {Object|null} [scarGraph=null] - Result from buildScarGraph(), containing scars and edges arrays
     */
    constructor(scarGraph = null) {
        /** @type {Object|null} The scar graph with scars and edges arrays */
        this.scarGraph = scarGraph;

        /**
         * Array of pairwise comparisons.
         * @type {Array<{younger: number, older: number, source: string}>}
         */
        this.comparisons = [];

        /**
         * Forward adjacency: younger scarId → Set of older scarIds.
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._adjacency = new Map();

        /**
         * Reverse adjacency: older scarId → Set of younger scarIds.
         * @type {Map<number, Set<number>>}
         * @private
         */
        this._reverse = new Map();
    }

    /**
     * Add a pairwise comparison declaring that one scar is younger than another.
     *
     * Prevents cycles: if adding the edge would create a cycle, preseed edges
     * along the cycle path are removed and the comparison is retried. If the
     * cycle consists entirely of expert edges, the comparison is rejected.
     *
     * @param {number} younger - Scar ID of the younger (more recent) scar
     * @param {number} older - Scar ID of the older scar
     * @param {string} [source='expert'] - Source of the comparison: 'expert' or 'preseed'
     * @returns {{success: boolean, alreadyExists?: boolean, error?: string, message?: string, cyclePath?: Array}}
     */
    addComparison(younger, older, source = 'expert') {
        // Self-comparison check
        if (younger === older) {
            return { success: false, error: 'self', message: 'Cannot compare a scar with itself' };
        }

        // Already exists check
        const adj = this._adjacency.get(younger);
        if (adj && adj.has(older)) {
            return { success: true, alreadyExists: true };
        }

        // Cycle detection: DFS from older following _adjacency to see if younger is reachable
        if (this._pathExists(older, younger)) {
            // Find the cycle path via BFS
            const cyclePath = this._findPath(older, younger);

            // The full cycle includes the new edge being added
            const newEdge = { younger, older, source };
            const fullCycle = [...cyclePath, newEdge];

            // Find preseed edges in the cycle path (NOT the new edge itself)
            const preseedEdges = cyclePath.filter(c => c.source === 'preseed');

            if (preseedEdges.length > 0) {
                // Remove preseed edges from the cycle path
                for (const edge of preseedEdges) {
                    this.removeComparison(edge.younger, edge.older);
                }
                // Retry the comparison
                return this.addComparison(younger, older, source);
            }

            // All edges in the cycle path are expert — reject
            return {
                success: false,
                error: 'cycle',
                message: 'This comparison contradicts existing expert comparisons',
                cyclePath
            };
        }

        // No cycle — add the comparison
        this.comparisons.push({ younger, older, source });

        if (!this._adjacency.has(younger)) {
            this._adjacency.set(younger, new Set());
        }
        this._adjacency.get(younger).add(older);

        if (!this._reverse.has(older)) {
            this._reverse.set(older, new Set());
        }
        this._reverse.get(older).add(younger);

        return { success: true };
    }

    /**
     * Remove a pairwise comparison.
     *
     * @param {number} younger - Scar ID of the younger scar
     * @param {number} older - Scar ID of the older scar
     * @returns {boolean} True if the comparison was found and removed
     */
    removeComparison(younger, older) {
        const index = this.comparisons.findIndex(
            c => c.younger === younger && c.older === older
        );
        if (index === -1) {
            return false;
        }

        this.comparisons.splice(index, 1);

        const adj = this._adjacency.get(younger);
        if (adj) {
            adj.delete(older);
            if (adj.size === 0) {
                this._adjacency.delete(younger);
            }
        }

        const rev = this._reverse.get(older);
        if (rev) {
            rev.delete(younger);
            if (rev.size === 0) {
                this._reverse.delete(older);
            }
        }

        return true;
    }

    /**
     * Check if a path exists from one node to another via DFS.
     *
     * @param {number} from - Starting scar ID
     * @param {number} to - Target scar ID
     * @returns {boolean} True if to is reachable from from via _adjacency edges
     * @private
     */
    _pathExists(from, to) {
        const visited = new Set();
        const stack = [from];

        while (stack.length > 0) {
            const node = stack.pop();
            if (node === to) {
                return true;
            }
            if (visited.has(node)) {
                continue;
            }
            visited.add(node);

            const neighbors = this._adjacency.get(node);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        stack.push(neighbor);
                    }
                }
            }
        }

        return false;
    }

    /**
     * Find the shortest path from one node to another via BFS.
     *
     * Returns the comparison objects along the path, allowing callers
     * to inspect edge sources and identify preseed edges.
     *
     * @param {number} from - Starting scar ID
     * @param {number} to - Target scar ID
     * @returns {Array<{younger: number, older: number, source: string}>} Comparisons along the path, or empty array
     * @private
     */
    _findPath(from, to) {
        const visited = new Set();
        const queue = [from];
        // parentMap: node → { parentNode, comparison }
        const parentMap = new Map();
        visited.add(from);

        while (queue.length > 0) {
            const node = queue.shift();
            if (node === to) {
                // Reconstruct path
                const path = [];
                let current = to;
                while (parentMap.has(current)) {
                    const { parentNode, comparison } = parentMap.get(current);
                    path.unshift(comparison);
                    current = parentNode;
                }
                return path;
            }

            const neighbors = this._adjacency.get(node);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        // Find the comparison object for this edge
                        const comparison = this.comparisons.find(
                            c => c.younger === node && c.older === neighbor
                        );
                        parentMap.set(neighbor, { parentNode: node, comparison });
                        queue.push(neighbor);
                    }
                }
            }
        }

        return [];
    }

    /**
     * Compute a topological ordering of all scars that appear in comparisons.
     *
     * Uses Kahn's algorithm. Returns youngest scars first (most recently created),
     * oldest scars last. When multiple scars have the same in-degree, they are
     * sorted by scar ID for determinism.
     *
     * @returns {Array<number>} Scar IDs in topological order (youngest first)
     */
    getTopologicalOrder() {
        // Collect all nodes
        const allNodes = new Set();
        for (const comp of this.comparisons) {
            allNodes.add(comp.younger);
            allNodes.add(comp.older);
        }

        if (allNodes.size === 0) {
            return [];
        }

        // Compute in-degree for each node.
        // In _adjacency, edges go younger → older.
        // In-degree of node X = number of edges pointing INTO X via _adjacency
        //   = number of nodes Y where _adjacency[Y] contains X
        //   = _reverse[X].size (how many scars are younger than X)
        // Nodes with in-degree 0 = nothing is younger than them = youngest scars
        const inDegree = new Map();
        for (const node of allNodes) {
            const rev = this._reverse.get(node);
            inDegree.set(node, rev ? rev.size : 0);
        }

        // Initialize queue with in-degree 0 nodes, sorted for determinism
        const queue = [];
        for (const node of allNodes) {
            if (inDegree.get(node) === 0) {
                queue.push(node);
            }
        }
        queue.sort((a, b) => a - b);

        const result = [];

        while (queue.length > 0) {
            const node = queue.shift();
            result.push(node);

            // For each neighbor of node in _adjacency (node → older)
            const neighbors = this._adjacency.get(node);
            if (neighbors) {
                const candidates = [];
                for (const neighbor of neighbors) {
                    const deg = inDegree.get(neighbor) - 1;
                    inDegree.set(neighbor, deg);
                    if (deg === 0) {
                        candidates.push(neighbor);
                    }
                }
                // Sort candidates for determinism and insert into queue
                candidates.sort((a, b) => a - b);
                for (const c of candidates) {
                    queue.push(c);
                }
            }
        }

        return result;
    }

    /**
     * Get a copy of all comparisons.
     *
     * @returns {Array<{younger: number, older: number, source: string}>} Copy of the comparisons array
     */
    getComparisons() {
        return this.comparisons.map(c => ({ ...c }));
    }

    /**
     * Get all comparisons involving a specific scar.
     *
     * @param {number} scarId - The scar ID to look up
     * @returns {{asYounger: Array, asOlder: Array}} Comparisons where the scar appears as younger or older
     */
    getComparisonsForScar(scarId) {
        return {
            asYounger: this.comparisons.filter(c => c.younger === scarId),
            asOlder: this.comparisons.filter(c => c.older === scarId)
        };
    }

    /**
     * Check if all scars in comparisons have a unique position in the topological order.
     *
     * @returns {boolean} True if the topological order covers all compared scars without ties
     */
    isFullyOrdered() {
        const allNodes = new Set();
        for (const comp of this.comparisons) {
            allNodes.add(comp.younger);
            allNodes.add(comp.older);
        }

        const order = this.getTopologicalOrder();
        return order.length === allNodes.size;
    }

    /**
     * Preseed comparisons from a scar graph using a size-based heuristic.
     *
     * For each edge in the graph, the smaller scar (fewer vertices) is assumed
     * to be younger. Comparisons that would create cycles are silently skipped.
     *
     * @param {Object} scarGraph - Scar graph with scars and edges arrays
     * @param {Object} [options={}] - Reserved for future options
     */
    preseedFromGraph(scarGraph, options = {}) {
        if (!scarGraph || !scarGraph.edges || !scarGraph.scars) {
            return;
        }

        // Build a lookup from scarId to vertex count
        const vertexCounts = new Map();
        for (const scar of scarGraph.scars) {
            vertexCounts.set(scar.scarId, scar.vertexCount);
        }

        for (const edge of scarGraph.edges) {
            const countA = vertexCounts.get(edge.scarA);
            const countB = vertexCounts.get(edge.scarB);

            if (countA === undefined || countB === undefined) {
                continue;
            }

            // Smaller scar is likely younger
            let younger, older;
            if (countA <= countB) {
                younger = edge.scarA;
                older = edge.scarB;
            } else {
                younger = edge.scarB;
                older = edge.scarA;
            }

            // Silently skip if it would create a cycle or is a self-comparison
            this.addComparison(younger, older, 'preseed');
        }
    }

    /**
     * Remove all preseed comparisons and rebuild the adjacency maps.
     *
     * Expert comparisons are preserved. The internal adjacency structures
     * are rebuilt from scratch using only the remaining comparisons.
     */
    clearPreseedComparisons() {
        const expertComparisons = this.comparisons.filter(c => c.source !== 'preseed');

        // Reset state
        this.comparisons = [];
        this._adjacency = new Map();
        this._reverse = new Map();

        // Replay expert comparisons
        for (const comp of expertComparisons) {
            this.addComparison(comp.younger, comp.older, comp.source);
        }
    }

    /**
     * Serialize to a plain object for JSON storage.
     *
     * @returns {{version: number, scars: Array, edges: Array, comparisons: Array}} Serializable metadata
     */
    toMetadata() {
        return {
            version: 1,
            scars: this.scarGraph?.scars?.map(s => ({
                scarId: s.scarId,
                representativeVertex: s.representativeVertex,
                vertexCount: s.vertexCount
            })) || [],
            edges: this.scarGraph?.edges?.map(e => ({
                scarA: e.scarA,
                scarB: e.scarB,
                sharpness: Math.round(e.sharpness * 10000) / 10000,
                roughness: Math.round(e.roughness * 10000) / 10000,
                boundarySize: e.boundarySize
            })) || [],
            comparisons: this.comparisons.map(c => ({
                younger: c.younger,
                older: c.older,
                source: c.source
            }))
        };
    }

    /**
     * Create a ScarOrdering from serialized metadata.
     *
     * Replays all stored comparisons via addComparison to rebuild the DAG.
     *
     * @param {Object} data - Serialized metadata from toMetadata()
     * @param {Object|null} [scarGraph=null] - Optional scar graph to use instead of the one in data
     * @returns {ScarOrdering} Restored ScarOrdering instance
     */
    static fromMetadata(data, scarGraph = null) {
        const ordering = new ScarOrdering(scarGraph || { scars: data.scars, edges: data.edges });
        for (const comp of data.comparisons) {
            ordering.addComparison(comp.younger, comp.older, comp.source);
        }
        return ordering;
    }
}
