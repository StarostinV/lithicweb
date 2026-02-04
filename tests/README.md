# Test Suite Documentation

This directory contains the automated test suite for the 3D Annotation Tool.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Running Tests](#running-tests)
- [Test Categories](#test-categories)
- [Writing New Tests](#writing-new-tests)
- [Fixtures](#fixtures)
- [Test Helpers](#test-helpers)
- [CI/CD Integration](#cicd-integration)

---

## Overview

The test suite uses [Jest](https://jestjs.io/) as the testing framework with the following configuration:

- **Environment**: jsdom (for DOM APIs and Three.js compatibility)
- **Transform**: babel-jest (ES modules support)
- **Coverage**: Enabled with lcov, text, and HTML reporters

### Key Testing Principles

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test how components work together
3. **Round-Trip Tests**: Verify data consistency through load/save cycles

---

## Directory Structure

```
tests/
├── README.md                 # This documentation file
├── setup.js                  # Jest setup file (runs before all tests)
├── fixtures/                 # Test data files
│   └── ply/
│       └── test_annotated_mesh.ply   # Binary PLY fixture for integration tests
├── unit/                     # Unit tests (isolated component testing)
│   └── loaders/
│       ├── customPLYLoader.test.js   # PLY parsing tests
│       └── meshExporter.test.js      # PLY export tests
└── integration/              # Integration tests (component interaction)
    └── loaders/
        └── roundTrip.test.js         # Load/export/reload consistency tests
```

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Running Specific Tests

```bash
# Run a specific test file
npx jest tests/unit/loaders/customPLYLoader.test.js

# Run tests matching a pattern
npx jest --testNamePattern="metadata"

# Run only unit tests
npx jest tests/unit/

# Run only integration tests
npx jest tests/integration/
```

### Coverage Reports

After running `npm run test:coverage`, reports are generated in:

- **Terminal**: Summary printed to console
- **HTML**: `coverage/lcov-report/index.html` (open in browser)
- **LCOV**: `coverage/lcov.info` (for CI tools like Codecov)

---

## Test Categories

### 1. Unit Tests (`tests/unit/`)

Unit tests verify individual functions work correctly in isolation.

#### `customPLYLoader.test.js`

Tests the PLY file parsing functionality:

| Test Group | Description |
|------------|-------------|
| ASCII Format Parsing | Parsing vertices, faces, quads, labels, arrows from ASCII PLY |
| Metadata Parsing | String, numeric, boolean, and JSON metadata extraction |
| Binary Format Parsing | Little-endian and big-endian binary PLY parsing |
| Edge Cases | Empty files, point clouds, missing elements |

#### `meshExporter.test.js`

Tests the PLY file export functionality:

| Test Group | Description |
|------------|-------------|
| serializeMetadata | Converting metadata objects to PLY comment strings |
| exportMeshToBlob | Generating valid PLY file blobs |

### 2. Integration Tests (`tests/integration/`)

Integration tests verify components work correctly together.

#### `roundTrip.test.js`

Tests data consistency through the full cycle: **Load → Export → Load**

| Test Group | Description |
|------------|-------------|
| ASCII PLY Round-Trip | Geometry and metadata preservation with ASCII format |
| Binary PLY Fixture Round-Trip | Using real binary PLY file from fixtures |
| Metadata Edge Cases | Special characters, empty values, zero values |

---

## Writing New Tests

### Test File Template

```javascript
/**
 * @fileoverview [Brief description of what this test file covers]
 * 
 * Test Coverage:
 * - [Feature/function 1]
 * - [Feature/function 2]
 * 
 * @see [Link to source file being tested]
 */

import { functionToTest } from '../../../src/path/to/module.js';

describe('ModuleName', () => {
    // Setup/teardown if needed
    beforeEach(() => {
        // Runs before each test
    });

    afterEach(() => {
        // Cleanup after each test
    });

    describe('functionToTest', () => {
        /**
         * @test Verifies [what the test checks]
         * @given [Initial conditions]
         * @when [Action taken]
         * @then [Expected result]
         */
        test('should [expected behavior] when [condition]', () => {
            // Arrange
            const input = 'test data';
            
            // Act
            const result = functionToTest(input);
            
            // Assert
            expect(result).toBe('expected output');
        });
    });
});
```

### Best Practices

1. **Descriptive Test Names**: Use `should [behavior] when [condition]` format
2. **AAA Pattern**: Arrange, Act, Assert structure
3. **One Assertion Focus**: Each test should verify one behavior
4. **Independent Tests**: Tests should not depend on each other
5. **Meaningful Fixtures**: Use realistic test data

---

## Fixtures

### Location

Test fixtures are stored in `tests/fixtures/` organized by type.

### PLY Fixtures (`tests/fixtures/ply/`)

| File | Format | Purpose |
|------|--------|---------|
| `test_annotated_mesh.ply` | Binary (little-endian) | Real mesh for integration testing |

### Creating New Fixtures

For **ASCII PLY**, embed directly in tests (self-documenting):

```javascript
const plyData = `ply
format ascii 1.0
comment metadata author Test
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;
```

For **Binary PLY**, add files to `tests/fixtures/ply/` and reference via `fs.readFileSync()`.

---

## Test Helpers

### Global Helpers (from `setup.js`)

These are available in all test files without importing:

#### `blobToText(blob)`

Reads a Blob as text (jsdom compatibility).

```javascript
const blob = exportMeshToBlob(positions, indices, metadata);
const text = await blobToText(blob);
expect(text).toContain('ply');
```

#### `blobToArrayBuffer(blob)`

Reads a Blob as ArrayBuffer.

```javascript
const blob = someFunctionReturningBlob();
const buffer = await blobToArrayBuffer(blob);
```

#### `debugGlobalVar`

Mock for the global debug variable used in production code.

### Local Helpers

Define test-specific helpers within test files:

```javascript
/**
 * Compare Float32Arrays with floating-point tolerance
 * @param {Float32Array} arr1 - First array
 * @param {Float32Array} arr2 - Second array  
 * @param {number} tolerance - Maximum allowed difference
 * @returns {boolean} True if arrays are approximately equal
 */
function arraysApproximatelyEqual(arr1, arr2, tolerance = 1e-6) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (Math.abs(arr1[i] - arr2[i]) > tolerance) {
            return false;
        }
    }
    return true;
}
```

---

## CI/CD Integration

### GitHub Actions

Tests run automatically on:
- Push to `master` branch
- Pull requests to `master` branch

The workflow (`.github/workflows/build.yml`):

1. **Test Job**: Runs `npm test`, uploads coverage
2. **Build Job**: Runs only if tests pass

### Coverage Thresholds

Current coverage targets (as of initial setup):

| Module | Target | Notes |
|--------|--------|-------|
| `customPLYLoader.js` | 90%+ | Core parsing logic |
| `meshExporter.js` | 40%+ | DOM-dependent functions excluded |

---

## Troubleshooting

### Common Issues

#### "Blob.text is not a function"

**Cause**: jsdom's Blob implementation is incomplete.

**Solution**: Use `blobToText(blob)` helper instead of `blob.text()`.

#### "THREE.LoaderUtils: decodeText() has been deprecated"

**Cause**: Three.js deprecation warning (not an error).

**Solution**: This is a warning only; tests still pass. Future update needed in `customPLYLoader.js` to use `TextDecoder` directly.

#### Tests timing out

**Cause**: Async test not properly awaited.

**Solution**: Ensure all async operations use `await` and test is marked `async`:

```javascript
test('async test', async () => {
    const result = await asyncFunction();
    expect(result).toBeDefined();
});
```

---

## Adding Tests for New Features

When adding a new feature, follow this checklist:

- [ ] Create unit tests for new functions
- [ ] Add integration tests if the feature interacts with other components
- [ ] Add fixtures if needed for realistic test data
- [ ] Update this README if adding new test categories
- [ ] Ensure tests pass locally before pushing
- [ ] Check coverage hasn't decreased significantly
