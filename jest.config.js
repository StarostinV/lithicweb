/**
 * @fileoverview Jest Configuration for 3D Annotation Tool
 * 
 * This configuration sets up Jest for testing a webpack-based browser application
 * that uses Three.js for 3D rendering and ES modules for code organization.
 * 
 * ## Key Configuration Choices
 * 
 * ### Test Environment: jsdom
 * We use jsdom to provide browser-like APIs (DOM, Blob, FileReader) needed for:
 * - Three.js geometry operations
 * - PLY file parsing/exporting
 * - Any code that touches the DOM
 * 
 * ### Transform: babel-jest
 * Babel transforms ES module syntax (import/export) to CommonJS for Node.js.
 * The @babel/preset-env handles modern JavaScript features.
 * 
 * ### Transform Ignore Patterns
 * Three.js uses ES modules, so we explicitly tell Jest to transform it
 * (normally node_modules is ignored).
 * 
 * ## Usage
 * 
 * ```bash
 * # Run all tests
 * npm test
 * 
 * # Watch mode (re-runs on changes)
 * npm run test:watch
 * 
 * # With coverage report
 * npm run test:coverage
 * ```
 * 
 * @see https://jestjs.io/docs/configuration - Full Jest config reference
 * @see tests/setup.js - Setup file that runs before tests
 * @see tests/README.md - Test suite documentation
 */

module.exports = {
    // =========================================================================
    // TEST ENVIRONMENT
    // =========================================================================
    
    /**
     * Use jsdom environment for browser-like APIs.
     * This provides: document, window, Blob, FileReader, etc.
     * Required for testing code that uses DOM or Three.js.
     */
    testEnvironment: 'jsdom',
    
    // =========================================================================
    // TEST FILE DISCOVERY
    // =========================================================================
    
    /**
     * Pattern to find test files.
     * Matches any .test.js file in the tests/ directory tree.
     */
    testMatch: [
        '<rootDir>/tests/**/*.test.js'
    ],
    
    /**
     * File extensions Jest will look for (in order of precedence).
     */
    moduleFileExtensions: ['js', 'json'],
    
    // =========================================================================
    // CODE TRANSFORMATION
    // =========================================================================
    
    /**
     * Transform ES modules to CommonJS using babel-jest.
     * The preset-env configuration handles modern JS syntax.
     */
    transform: {
        '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }]
    },
    
    /**
     * Don't transform node_modules EXCEPT for Three.js.
     * Three.js uses ES modules and must be transformed.
     * 
     * Pattern explanation:
     * - node_modules/(?!(three)/) = ignore node_modules except 'three' folder
     */
    transformIgnorePatterns: [
        'node_modules/(?!(three)/)'
    ],
    
    // =========================================================================
    // TEST SETUP
    // =========================================================================
    
    /**
     * Setup file that runs after Jest environment is set up but before tests.
     * Used for: global mocks, polyfills, helper functions.
     * 
     * @see tests/setup.js
     */
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    
    // =========================================================================
    // CODE COVERAGE
    // =========================================================================
    
    /**
     * Which source files to include in coverage analysis.
     * Excludes main.js (entry point with side effects).
     */
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/main.js'
    ],
    
    /**
     * Directory for coverage report output.
     */
    coverageDirectory: 'coverage',
    
    /**
     * Coverage report formats:
     * - text: Summary in terminal
     * - lcov: Standard format for CI tools (Codecov, Coveralls)
     * - html: Interactive HTML report (coverage/lcov-report/index.html)
     */
    coverageReporters: ['text', 'lcov', 'html'],
    
    // =========================================================================
    // OUTPUT & DEBUGGING
    // =========================================================================
    
    /**
     * Show individual test results in output.
     */
    verbose: true,
    
    /**
     * Clear mock state between tests for isolation.
     */
    clearMocks: true,
    
    // =========================================================================
    // MODULE RESOLUTION
    // =========================================================================
    
    /**
     * Path aliases for cleaner imports.
     * Allows: import { foo } from '@/utils/foo.js'
     * Instead of: import { foo } from '../../../src/utils/foo.js'
     */
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    }
};
