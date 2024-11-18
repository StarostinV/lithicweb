/**
 * Creates an adjacency graph from mesh indices
 * @param {Array|TypedArray} indices - Array of triangle indices
 * @param {number} vertexCount - Total number of vertices in the mesh
 * @returns {Map} Adjacency graph where each vertex maps to a Set of its neighbors
 */
export function buildAdjacencyGraph(indices, vertexCount) {
    const graph = new Map();
    
    // Create vertices entries
    for (let i = 0; i < vertexCount; i++) {
        graph.set(i, new Set());
    }
    
    // Add edges from triangles
    for (let i = 0; i < indices.length; i += 3) {
        const v1 = indices[i];
        const v2 = indices[i + 1];
        const v3 = indices[i + 2];
        
        graph.get(v1).add(v2).add(v3);
        graph.get(v2).add(v1).add(v3);
        graph.get(v3).add(v1).add(v2);
    }
    
    return graph;
} 