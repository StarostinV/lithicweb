/**
 * Geometry module exports.
 * 
 * This module provides the core classes for the mesh annotation architecture:
 * 
 * ## Core Classes
 * 
 * - **Annotation**: Lightweight container for annotation data (edgeIndices + arrows + metadata)
 * - **BasicMesh**: Pure geometry container with mesh-level metadata
 * 
 * ## New Architecture
 * 
 * The new architecture separates concerns:
 * 
 * ```
 * BasicMesh (geometry) + Annotation (data) -> MeshView (display/editing)
 * ```
 * 
 * - Annotation is the "compressed" representation (just indices)
 * - MeshView "unzips" annotation to compute segments for display
 * - Multiple MeshViews can share the same BasicMesh (for comparison views)
 * 
 * @example
 * import { Annotation, BasicMesh } from './geometry/index.js';
 * import { MeshView } from './components/MeshView.js';
 * import { AnnotationLibrary } from './utils/AnnotationLibrary.js';
 * 
 * // Create mesh
 * const mesh = new BasicMesh();
 * mesh.setMesh(positions, indices, { author: 'John' });
 * 
 * // Create view
 * const meshView = new MeshView(scene, mesh, { edgeColor, objectColor });
 * 
 * // Load annotation
 * const annotation = Annotation.fromEdgeLabels(labels, arrows, metadata);
 * meshView.loadAnnotation(annotation);
 * 
 * // Save to library
 * const library = new AnnotationLibrary();
 * library.save(meshView.getAnnotation());
 * 
 * @module geometry
 */

// New architecture classes
export { Annotation } from './Annotation.js';
export { BasicMesh } from './BasicMesh.js';

// Supporting classes
export { MeshSegmenter } from './segmentation.js';
export { PathFinder } from './PathFinder.js';
export { IntersectFinder } from './intersections.js';

// Edge angle computation for segmentation
export { 
    computeEdgeAngles, 
    computeVertexMaxAngles,
    getSharpVertices,
    radiansToDegrees 
} from './edgeAngles.js';
