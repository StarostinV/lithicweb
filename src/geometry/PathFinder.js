/**
 * PathFinder - A* pathfinding on mesh surface with optional angle-based ridge following.
 * 
 * Provides two pathfinding modes:
 * 1. Standard shortest path (Euclidean distance)
 * 2. Ridge-following path (prefers high dihedral angle vertices)
 */
export class PathFinder {
    constructor(annotatedMesh) {
        this.annotatedMesh = annotatedMesh;
        
        // Ridge-following configuration
        this.vertexMaxAngles = null;  // Float32Array from edge angle computation
        this.ridgeStrength = 3.0;     // How strongly to prefer ridges (0 = ignore, 10 = strong)
        this.maxAngle = Math.PI;      // Maximum angle for normalization
    }
    
    /**
     * Set the vertex max angles for ridge-following pathfinding.
     * @param {Float32Array} angles - Max dihedral angle at each vertex (radians)
     */
    setVertexMaxAngles(angles) {
        this.vertexMaxAngles = angles;
        
        // Find max angle for normalization
        if (angles) {
            this.maxAngle = 0;
            for (let i = 0; i < angles.length; i++) {
                if (angles[i] > this.maxAngle) {
                    this.maxAngle = angles[i];
                }
            }
            if (this.maxAngle < 0.001) this.maxAngle = Math.PI;
        }
    }
    
    /**
     * Set the ridge-following strength.
     * @param {number} strength - 0 (disabled) to 50+ (very strong preference for ridges)
     */
    setRidgeStrength(strength) {
        this.ridgeStrength = Math.max(0, strength);
    }
    
    /**
     * Check if ridge-following is available (angles have been computed).
     * @returns {boolean}
     */
    canFollowRidges() {
        return this.vertexMaxAngles !== null && this.ridgeStrength > 0;
    }

    /**
     * Find the shortest path between two vertices.
     * @param {number} startVertex - Start vertex index
     * @param {number} endVertex - End vertex index
     * @returns {Array<number>} Array of vertex indices forming the path
     */
    findShortestPath(startVertex, endVertex) {
        return this._findPath(startVertex, endVertex, false);
    }
    
    /**
     * Find a path that follows ridges (high dihedral angle vertices).
     * Falls back to shortest path if angles haven't been computed.
     * @param {number} startVertex - Start vertex index
     * @param {number} endVertex - End vertex index
     * @returns {Array<number>} Array of vertex indices forming the path
     */
    findRidgeFollowingPath(startVertex, endVertex) {
        if (!this.canFollowRidges()) {
            return this.findShortestPath(startVertex, endVertex);
        }
        return this._findPath(startVertex, endVertex, true);
    }
    
    /**
     * Internal A* pathfinding with optional ridge-following.
     * @private
     */
    _findPath(startVertex, endVertex, useRidgeFollowing) {
        if (!this.annotatedMesh.adjacencyGraph || startVertex === endVertex) {
            return [startVertex];
        }

        const openSet = new PriorityQueue();
        const closedSet = new Set();
        const gScore = new Map();
        const fScore = new Map();
        const cameFrom = new Map();

        // Initialize start node
        gScore.set(startVertex, 0);
        fScore.set(startVertex, this.heuristic(startVertex, endVertex));
        openSet.enqueue(startVertex, fScore.get(startVertex));

        while (!openSet.isEmpty()) {
            const current = openSet.dequeue();

            if (current === endVertex) {
                return this.reconstructPath(cameFrom, current);
            }

            closedSet.add(current);

            // Check neighbors
            const neighbors = this.annotatedMesh.adjacencyGraph.get(current);
            if (!neighbors) continue;
            
            for (const neighbor of neighbors) {
                if (closedSet.has(neighbor)) continue;

                // Calculate edge cost
                let edgeCost;
                if (useRidgeFollowing) {
                    edgeCost = this._getRidgeAwareCost(current, neighbor);
                } else {
                    edgeCost = this.getVertexDistance(current, neighbor);
                }
                
                const tentativeGScore = gScore.get(current) + edgeCost;

                if (!gScore.has(neighbor) || tentativeGScore < gScore.get(neighbor)) {
                    cameFrom.set(neighbor, current);
                    gScore.set(neighbor, tentativeGScore);
                    const f = tentativeGScore + this.heuristic(neighbor, endVertex);
                    fScore.set(neighbor, f);

                    if (!openSet.contains(neighbor)) {
                        openSet.enqueue(neighbor, f);
                    }
                }
            }
        }

        return [];
    }
    
    /**
     * Calculate edge cost with ridge-following bias.
     * Lower cost for high-angle vertices (ridges), higher cost for flat areas.
     * 
     * Formula: distance * (1 + strength * (1 - normalizedAngle))
     * - At ridges (high angle): normalizedAngle ≈ 1, multiplier ≈ 1 (cheap)
     * - At flat areas (low angle): normalizedAngle ≈ 0, multiplier = 1 + strength (expensive)
     * 
     * @private
     */
    _getRidgeAwareCost(fromVertex, toVertex) {
        const distance = this.getVertexDistance(fromVertex, toVertex);
        
        if (!this.vertexMaxAngles || this.ridgeStrength === 0) {
            return distance;
        }
        
        // Get normalized angle at the target vertex (0 = flat, 1 = sharp ridge)
        const angle = this.vertexMaxAngles[toVertex] || 0;
        const normalizedAngle = angle / this.maxAngle;
        
        // Penalize moving to low-angle (flat) vertices
        // High angle = low penalty, Low angle = high penalty
        const anglePenalty = 1 - normalizedAngle;
        const costMultiplier = 1 + this.ridgeStrength * anglePenalty;
        
        return distance * costMultiplier;
    }

    heuristic(vertexIndex1, vertexIndex2) {
        // Using 3D Euclidean distance as heuristic
        const pos1 = this.annotatedMesh.indexToVertex(vertexIndex1);
        const pos2 = this.annotatedMesh.indexToVertex(vertexIndex2);
        return pos1.distanceTo(pos2);
    }

    getVertexDistance(vertexIndex1, vertexIndex2) {
        const pos1 = this.annotatedMesh.indexToVertex(vertexIndex1);
        const pos2 = this.annotatedMesh.indexToVertex(vertexIndex2);
        return pos1.distanceTo(pos2);
    }

    reconstructPath(cameFrom, current) {
        const path = [current];
        while (cameFrom.has(current)) {
            current = cameFrom.get(current);
            path.unshift(current);
        }
        return path;
    }
}

// Simple priority queue implementation
class PriorityQueue {
    constructor() {
        this.values = [];
    }

    enqueue(value, priority) {
        this.values.push({ value, priority });
        this.sort();
    }

    dequeue() {
        return this.values.shift().value;
    }

    sort() {
        this.values.sort((a, b) => a.priority - b.priority);
    }

    isEmpty() {
        return this.values.length === 0;
    }

    contains(value) {
        return this.values.some(v => v.value === value);
    }
} 