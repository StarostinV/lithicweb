export class PathFinder {
    constructor(annotatedMesh) {
        this.annotatedMesh = annotatedMesh;
    }

    findShortestPath(startVertex, endVertex) {
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
            for (const neighbor of this.annotatedMesh.adjacencyGraph.get(current)) {
                if (closedSet.has(neighbor)) continue;

                const tentativeGScore = gScore.get(current) + this.getVertexDistance(current, neighbor);

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