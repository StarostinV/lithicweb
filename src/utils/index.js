/**
 * Utils module exports.
 * 
 * This module provides utility classes for the mesh annotation application:
 * 
 * - **AnnotationLibrary**: Stores and manages saved annotations
 * - **ActionHistory**: Undo/redo history management
 * - **EventBus**: Centralized pub/sub event system
 * 
 * @module utils
 */

export { AnnotationLibrary } from './AnnotationLibrary.js';
export { ActionHistory } from './ActionHistory.js';
export { eventBus, Events } from './EventBus.js';
export { logger } from './logger.js';
export { default as DynamicTypedArray } from './DynamicTypedArray.js';
export { default as UserConfig } from './UserConfig.js';
export { buildAdjacencyGraph, computeCentroid, computeBoundingBox } from './graphUtils.js';
export { createThreeMesh } from './meshUtils.js';
export { sanitize } from './sanitize.js';
