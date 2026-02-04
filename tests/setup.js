/**
 * @fileoverview Jest Test Environment Setup
 * 
 * This file runs before each test file and configures the test environment.
 * It provides polyfills and global helpers needed for testing browser-based
 * code in a Node.js/jsdom environment.
 * 
 * ## What This File Does
 * 
 * 1. **Global Mocks**: Sets up mock objects for browser globals used in production
 * 2. **Polyfills**: Provides TextEncoder/TextDecoder for PLY parsing
 * 3. **Test Helpers**: Defines global utility functions for common test operations
 * 
 * ## Usage
 * 
 * All exports from this file are available globally in test files without
 * needing to import them:
 * 
 * ```javascript
 * // In any test file:
 * const text = await blobToText(someBlob);
 * const buffer = await blobToArrayBuffer(someBlob);
 * ```
 * 
 * @see jest.config.js - References this file in setupFilesAfterEnv
 */

// =============================================================================
// GLOBAL MOCKS
// =============================================================================

/**
 * Mock for the global debug variable used throughout the application.
 * In production, this stores debug information; in tests, it's an empty object.
 * 
 * @global
 * @type {Object}
 */
global.debugGlobalVar = {};

// =============================================================================
// CONSOLE CONFIGURATION
// =============================================================================

/**
 * Optionally suppress console warnings during tests.
 * Uncomment the line below to silence warnings (useful for cleaner test output).
 * Comment it out when debugging to see all warnings.
 */
// global.console.warn = jest.fn();

// =============================================================================
// POLYFILLS
// =============================================================================

/**
 * TextEncoder and TextDecoder polyfills.
 * 
 * These are needed because:
 * - PLY parsing converts ArrayBuffer to string and vice versa
 * - Node.js provides these in the 'util' module, not globally
 * - jsdom environment doesn't provide complete implementations
 * 
 * @see src/loaders/customPLYLoader.js - Uses these for binary/ASCII conversion
 */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// =============================================================================
// TEST HELPER FUNCTIONS
// =============================================================================

/**
 * Reads a Blob object as text content.
 * 
 * This helper exists because jsdom's Blob implementation doesn't include
 * the modern `text()` method. It uses FileReader internally for compatibility.
 * 
 * ## Example Usage
 * 
 * ```javascript
 * test('should export valid PLY', async () => {
 *     const blob = exportMeshToBlob(positions, indices, metadata);
 *     const text = await blobToText(blob);
 *     
 *     expect(text).toContain('ply');
 *     expect(text).toContain('format ascii 1.0');
 * });
 * ```
 * 
 * @global
 * @async
 * @param {Blob} blob - The Blob object to read
 * @returns {Promise<string>} The blob content as a UTF-8 string
 * @throws {Error} If the FileReader encounters an error
 * 
 * @example
 * // Reading an exported PLY blob
 * const blob = exportMeshToBlob(positions, indices, {});
 * const plyContent = await blobToText(blob);
 * expect(plyContent).toMatch(/^ply/);
 */
global.blobToText = async function(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
};

/**
 * Reads a Blob object as an ArrayBuffer.
 * 
 * Useful when you need to test binary data or pass blob content
 * to functions that expect ArrayBuffer input (like PLY loaders).
 * 
 * ## Example Usage
 * 
 * ```javascript
 * test('should create valid binary data', async () => {
 *     const blob = createBinaryBlob();
 *     const buffer = await blobToArrayBuffer(blob);
 *     const view = new DataView(buffer);
 *     
 *     expect(view.getFloat32(0, true)).toBeCloseTo(1.5);
 * });
 * ```
 * 
 * @global
 * @async
 * @param {Blob} blob - The Blob object to read
 * @returns {Promise<ArrayBuffer>} The blob content as an ArrayBuffer
 * @throws {Error} If the FileReader encounters an error
 * 
 * @example
 * // Converting blob to buffer for binary parsing
 * const blob = someBinaryBlob;
 * const buffer = await blobToArrayBuffer(blob);
 * const geometry = loader.parse(buffer);
 */
global.blobToArrayBuffer = async function(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
};
