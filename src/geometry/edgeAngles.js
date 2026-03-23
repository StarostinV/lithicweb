/**
 * Edge angle computation for mesh segmentation.
 * 
 * Computes dihedral angles (angles between adjacent faces sharing an edge)
 * and assigns the maximum incident angle to each vertex.
 * 
 * Optimized for large meshes (1M+ vertices) with:
 * - Pre-allocated typed arrays
 * - Single-pass face normal computation
 * - Efficient edge hashing using canonical ordering
 * - Minimal object allocation
 * 
 * @module geometry/edgeAngles
 */

/**
 * Create a canonical edge key from two vertex indices.
 * Orders vertices so (a,b) and (b,a) produce the same key.
 * 
 * @param {number} v1 - First vertex index
 * @param {number} v2 - Second vertex index
 * @returns {string} Canonical edge key
 */
export function edgeKey(v1, v2) {
    return v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
}

/**
 * Compute the cross product of two vectors (b-a) x (c-a).
 * Returns the result in the provided output array.
 * 
 * @param {Float32Array} positions - Vertex positions array
 * @param {number} a - First vertex index
 * @param {number} b - Second vertex index  
 * @param {number} c - Third vertex index
 * @param {Float32Array} out - Output array for the cross product (length 3)
 */
function crossProduct(positions, a, b, c, out) {
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    
    // Vector b - a
    const bax = positions[b * 3] - ax;
    const bay = positions[b * 3 + 1] - ay;
    const baz = positions[b * 3 + 2] - az;
    
    // Vector c - a
    const cax = positions[c * 3] - ax;
    const cay = positions[c * 3 + 1] - ay;
    const caz = positions[c * 3 + 2] - az;
    
    // Cross product (b-a) x (c-a)
    out[0] = bay * caz - baz * cay;
    out[1] = baz * cax - bax * caz;
    out[2] = bax * cay - bay * cax;
}

/**
 * Normalize a vector in place.
 * 
 * @param {Float32Array} v - Vector to normalize (length 3)
 * @returns {number} The original length of the vector
 */
function normalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len > 1e-10) {
        v[0] /= len;
        v[1] /= len;
        v[2] /= len;
    }
    return len;
}

/**
 * Compute the dot product of two vectors stored in arrays.
 * 
 * @param {Float32Array} normals - Array containing both normals
 * @param {number} i1 - Index of first normal (multiply by 3 for offset)
 * @param {number} i2 - Index of second normal (multiply by 3 for offset)
 * @returns {number} Dot product
 */
function dotProduct(normals, i1, i2) {
    const offset1 = i1 * 3;
    const offset2 = i2 * 3;
    return normals[offset1] * normals[offset2] + 
           normals[offset1 + 1] * normals[offset2 + 1] + 
           normals[offset1 + 2] * normals[offset2 + 2];
}

/**
 * Compute dihedral angles for all edges and assign maximum angle to each vertex.
 * 
 * The dihedral angle is the angle between two adjacent faces sharing an edge.
 * For mesh segmentation, vertices on sharp features will have high maximum angles.
 * 
 * Time complexity: O(F + E) where F = faces, E = edges
 * Space complexity: O(F + E + V) for normals, edge map, and output
 * 
 * @param {Float32Array|number[]} positions - Vertex positions as flat array [x0,y0,z0, x1,y1,z1, ...]
 * @param {Uint32Array|number[]} indices - Triangle indices as flat array [i0,i1,i2, i3,i4,i5, ...]
 * @returns {{
 *   vertexMaxAngles: Float32Array,
 *   edgeAngles: Map<string, number>,
 *   faceNormals: Float32Array
 * }} Object containing:
 *   - vertexMaxAngles: Maximum dihedral angle (in radians) at each vertex
 *   - edgeAngles: Map from edge key to dihedral angle
 *   - faceNormals: Pre-computed face normals (3 floats per face)
 */
export function computeEdgeAngles(positions, indices) {
    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;
    
    // Pre-allocate arrays
    const faceNormals = new Float32Array(faceCount * 3);
    const vertexMaxAngles = new Float32Array(vertexCount);
    const tempNormal = new Float32Array(3);
    
    // Map from edge key -> [faceIndex1, faceIndex2]
    // Using Map for O(1) lookup
    const edgeToFaces = new Map();
    
    // Pass 1: Compute face normals and build edge-to-faces mapping
    for (let f = 0; f < faceCount; f++) {
        const baseIdx = f * 3;
        const v0 = indices[baseIdx];
        const v1 = indices[baseIdx + 1];
        const v2 = indices[baseIdx + 2];
        
        // Compute face normal
        crossProduct(positions, v0, v1, v2, tempNormal);
        normalize(tempNormal);
        
        faceNormals[f * 3] = tempNormal[0];
        faceNormals[f * 3 + 1] = tempNormal[1];
        faceNormals[f * 3 + 2] = tempNormal[2];
        
        // Register edges for this face
        const edges = [
            edgeKey(v0, v1),
            edgeKey(v1, v2),
            edgeKey(v2, v0)
        ];
        
        for (const key of edges) {
            if (!edgeToFaces.has(key)) {
                edgeToFaces.set(key, [f]);
            } else {
                edgeToFaces.get(key).push(f);
            }
        }
    }
    
    // Pass 2: Compute dihedral angles for each edge
    const edgeAngles = new Map();
    
    for (const [key, faces] of edgeToFaces) {
        let angle = 0;
        
        if (faces.length === 2) {
            // Interior edge - compute dihedral angle between the two faces
            const f1 = faces[0];
            const f2 = faces[1];
            
            // Dot product of the two face normals
            const dot = dotProduct(faceNormals, f1, f2);
            
            // Clamp to [-1, 1] to handle numerical precision issues
            const clampedDot = Math.max(-1, Math.min(1, dot));
            
            // Dihedral angle: π - acos(n1·n2) gives the "exterior" angle
            // acos(n1·n2) gives the angle between normals
            // For a flat surface, normals are parallel (dot=1), angle=0
            // For a 90° edge, normals are perpendicular (dot=0), angle=π/2
            angle = Math.acos(clampedDot);
        } else if (faces.length === 1) {
            // Boundary edge - no adjacent face
            // Assign π (180°) to mark it as a sharp feature
            angle = Math.PI;
        }
        // faces.length > 2 indicates non-manifold mesh; treat as 0
        
        edgeAngles.set(key, angle);
    }
    
    // Pass 3: Assign maximum edge angle to each vertex
    for (const [key, angle] of edgeAngles) {
        // Parse the edge key to get vertex indices
        const [v1Str, v2Str] = key.split('_');
        const v1 = parseInt(v1Str, 10);
        const v2 = parseInt(v2Str, 10);
        
        // Update max angle for both vertices
        if (angle > vertexMaxAngles[v1]) {
            vertexMaxAngles[v1] = angle;
        }
        if (angle > vertexMaxAngles[v2]) {
            vertexMaxAngles[v2] = angle;
        }
    }
    
    return {
        vertexMaxAngles,
        edgeAngles,
        faceNormals
    };
}

/**
 * Compute only vertex max angles (memory-efficient version).
 * 
 * This is a streamlined version that doesn't return the intermediate
 * edge angles map, reducing memory usage for very large meshes.
 * 
 * @param {Float32Array|number[]} positions - Vertex positions as flat array
 * @param {Uint32Array|number[]} indices - Triangle indices as flat array
 * @returns {Float32Array} Maximum dihedral angle (in radians) at each vertex
 */
export function computeVertexMaxAngles(positions, indices) {
    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;
    
    const faceNormals = new Float32Array(faceCount * 3);
    const vertexMaxAngles = new Float32Array(vertexCount);
    const tempNormal = new Float32Array(3);
    const edgeToFaces = new Map();
    
    // Pass 1: Compute face normals and build edge-to-faces mapping
    for (let f = 0; f < faceCount; f++) {
        const baseIdx = f * 3;
        const v0 = indices[baseIdx];
        const v1 = indices[baseIdx + 1];
        const v2 = indices[baseIdx + 2];
        
        crossProduct(positions, v0, v1, v2, tempNormal);
        normalize(tempNormal);
        
        faceNormals[f * 3] = tempNormal[0];
        faceNormals[f * 3 + 1] = tempNormal[1];
        faceNormals[f * 3 + 2] = tempNormal[2];
        
        // Register edges with their face and vertices
        const edges = [
            [v0, v1],
            [v1, v2],
            [v2, v0]
        ];
        
        for (const [a, b] of edges) {
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!edgeToFaces.has(key)) {
                edgeToFaces.set(key, { faces: [f], v1: Math.min(a, b), v2: Math.max(a, b) });
            } else {
                edgeToFaces.get(key).faces.push(f);
            }
        }
    }
    
    // Pass 2: Compute angles and update vertex max directly
    for (const { faces, v1, v2 } of edgeToFaces.values()) {
        let angle = 0;
        
        if (faces.length === 2) {
            const f1 = faces[0];
            const f2 = faces[1];
            const dot = dotProduct(faceNormals, f1, f2);
            const clampedDot = Math.max(-1, Math.min(1, dot));
            angle = Math.acos(clampedDot);
        } else if (faces.length === 1) {
            angle = Math.PI;
        }
        
        if (angle > vertexMaxAngles[v1]) {
            vertexMaxAngles[v1] = angle;
        }
        if (angle > vertexMaxAngles[v2]) {
            vertexMaxAngles[v2] = angle;
        }
    }
    
    return vertexMaxAngles;
}

/**
 * Convert radians to degrees.
 * @param {number} radians - Angle in radians
 * @returns {number} Angle in degrees
 */
export function radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
}

/**
 * Get vertices with angles above a threshold (feature detection).
 * 
 * @param {Float32Array} vertexMaxAngles - Max angles per vertex (from computeVertexMaxAngles)
 * @param {number} thresholdRadians - Angle threshold in radians (e.g., Math.PI/6 for 30°)
 * @returns {Uint32Array} Indices of vertices above threshold
 */
export function getSharpVertices(vertexMaxAngles, thresholdRadians) {
    // First pass: count vertices above threshold
    let count = 0;
    for (let i = 0; i < vertexMaxAngles.length; i++) {
        if (vertexMaxAngles[i] >= thresholdRadians) {
            count++;
        }
    }
    
    // Second pass: collect indices
    const result = new Uint32Array(count);
    let idx = 0;
    for (let i = 0; i < vertexMaxAngles.length; i++) {
        if (vertexMaxAngles[i] >= thresholdRadians) {
            result[idx++] = i;
        }
    }
    
    return result;
}
