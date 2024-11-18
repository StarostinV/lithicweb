import DynamicTypedArray from '../utils/DynamicTypedArray.js';
import * as THREE from 'three';

export class MeshSegmenter {
    constructor(annotatedMesh) {
        this.annotatedMesh = annotatedMesh;
    }

    segmentMesh() {
        if (!this.annotatedMesh.adjacencyGraph) return [];

        // Use TypedArrays for better performance
        const totalVertices = this.annotatedMesh.positions.length / 3;
        const visited = new Uint8Array(totalVertices).fill(0);
        const segments = [];
        
        // Process chunks of vertices in parallel
        const chunkSize = 10000; // Adjust based on your needs
        
        for (let startIdx = 0; startIdx < totalVertices; startIdx += chunkSize) {
            const endIdx = Math.min(startIdx + chunkSize, totalVertices);
            
            // Process each chunk
            for (let vertex = startIdx; vertex < endIdx; vertex++) {
                // Skip if visited or not labeled
                if (visited[vertex] || this.annotatedMesh.edgeLabels[vertex] !== 0) continue;
                const segment = this.floodFillOptimized(vertex, visited);
                if (segment.length > 0) {
                    segments.push(segment);
                }
            }
        }
        
        return segments;
    }

    floodFillOptimized(startVertex, visited) {
        const segment = new DynamicTypedArray();
        const queue = new DynamicTypedArray(10000);
        
        queue.push(startVertex);
        let queueStart = 0;
        
        while (queueStart < queue.size) {
            const vertex = queue.array[queueStart++];
            
            if (visited[vertex]) continue;
            visited[vertex] = 1;
            
            if (this.annotatedMesh.edgeLabels[vertex] === 0) {
                segment.push(vertex);
                
                // Process neighbors
                const neighbors = this.annotatedMesh.adjacencyGraph.get(vertex);
                for (const neighbor of neighbors) {
                    if (!visited[neighbor] && this.annotatedMesh.edgeLabels[neighbor] === 0) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        return segment.getUsedPortion();
    }

    updateSegmentColors(segments, previousFaceLabels = []) {
        const faceLabels = new Array(this.annotatedMesh.positions.length / 3).fill(0);
        const faceColors = new Map();
        const usedColors = new Set([this.annotatedMesh.objectColor]);

        // Find largest segment
        let largestSegmentIndex = 0;
        let maxSize = 0;
        segments.forEach((segment, index) => {
            if (segment.length > maxSize) {
                maxSize = segment.length;
                largestSegmentIndex = index;
            }
        });

        segments.forEach((segment, index) => {
            const segmentId = index + 1;
            
            // For largest segment, use objectColor
            if (index === largestSegmentIndex) {
                faceColors.set(segmentId, this.annotatedMesh.objectColor);
                segment.forEach(vertexIndex => {
                    faceLabels[vertexIndex] = segmentId;
                    this.annotatedMesh.colorVertex(vertexIndex, this.annotatedMesh.objectColor);
                });
                return;
            }

            // Try to match with previous segments
            let color = this.findBestMatchingColor(segment, previousFaceLabels, usedColors);
            
            usedColors.add(color);
            faceColors.set(segmentId, color);
            segment.forEach(vertexIndex => {
                faceLabels[vertexIndex] = segmentId;
                this.annotatedMesh.colorVertex(vertexIndex, color);
            });
        });

        return { faceLabels, faceColors };
    }

    findBestMatchingColor(segment, previousFaceLabels, usedColors) {
        if (previousFaceLabels.length === 0) {
            return generateUniqueColor(usedColors);
        }

        // Sample some vertices to find best matching previous segment
        const sampleSize = Math.min(100, segment.length);
        const samples = new Set(segment.slice(0, sampleSize));
        
        const previousIds = new Set(previousFaceLabels);
        previousIds.delete(0);  // Ignore unlabeled vertices
        
        let bestMatchId = null;
        let bestMatchScore = 0;
        
        for (const prevId of previousIds) {
            let matchScore = 0;
            samples.forEach(vertexIndex => {
                if (previousFaceLabels[vertexIndex] === prevId) {
                    matchScore++;
                }
            });
            
            if (matchScore > bestMatchScore) {
                bestMatchScore = matchScore;
                bestMatchId = prevId;
            }
        }

        if (bestMatchId && this.annotatedMesh.faceColors.has(bestMatchId)) {
            const previousColor = this.annotatedMesh.faceColors.get(bestMatchId);
            if (!colorExistsInSet(previousColor, usedColors)) {
                return previousColor;
            }
        }

        return generateUniqueColor(usedColors);
    }
}

function colorExistsInSet(color, colorSet) {
    for (const existingColor of colorSet) {
        if (color.equals(existingColor)) {
            return true;
        }
    }
    return false;
}

function generateUniqueColor(usedColors) {
    let newColor;
    let attempts = 0;
    const maxAttempts = 100;

    do {
        newColor = new THREE.Color(
            Math.random(),
            Math.random(),
            Math.random()
        );
        attempts++;
        if (attempts > maxAttempts) {
            console.warn('Could not generate unique color after ' + maxAttempts + ' attempts');
            break;
        }
    } while (colorExistsInSet(newColor, usedColors));

    return newColor;
} 