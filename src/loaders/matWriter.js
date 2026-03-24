/**
 * Minimal MAT Level 5 binary file writer.
 *
 * Supports writing numeric arrays (double, uint16) to MATLAB .mat files.
 * Only implements the subset needed for mesh export: no structs, cell arrays,
 * sparse arrays, or compression.
 *
 * Format reference: MATLAB Level 5 MAT-File Format specification and
 * the mat-for-js reader source.
 *
 * @module loaders/matWriter
 */

// MAT data type constants (miXXX)
const MI_INT8 = 1;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;

// MATLAB array class constants (mxXXX)
const MX_DOUBLE_CLASS = 6;
const MX_UINT16_CLASS = 11;

const TYPE_INFO = {
    double: { bytesPerElement: 8, miType: MI_DOUBLE, mxClass: MX_DOUBLE_CLASS },
    uint16: { bytesPerElement: 2, miType: MI_UINT16, mxClass: MX_UINT16_CLASS },
};

/**
 * Round up to the nearest 8-byte boundary.
 * @param {number} n
 * @returns {number}
 */
function round8(n) {
    return n % 8 === 0 ? n : n + (8 - n % 8);
}

/**
 * Calculate the total size of a data element (8-byte tag + padded data).
 * @param {number} dataBytes - Size of the data payload in bytes
 * @returns {number}
 */
function dataElementSize(dataBytes) {
    return 8 + round8(dataBytes);
}

/**
 * Calculate the total byte size of a matrix variable's subelements.
 * @param {number} nameLength - Length of the variable name in characters
 * @param {number} numElements - Total number of data elements (rows * cols)
 * @param {number} bytesPerElement - Bytes per data element (8 for double, 2 for uint16)
 * @returns {number}
 */
function matrixContentSize(nameLength, numElements, bytesPerElement) {
    return (
        dataElementSize(8) +                              // array flags (2 x uint32 = 8 bytes)
        dataElementSize(8) +                              // dimensions (2 x int32 = 8 bytes)
        dataElementSize(nameLength) +                     // name (ASCII chars)
        dataElementSize(numElements * bytesPerElement)    // real data
    );
}

/**
 * Write a MAT Level 5 file containing the specified numeric variables.
 *
 * Each variable is specified as:
 *   { name, data (flat row-major), rows, cols, type: 'double'|'uint16' }
 *
 * Data is provided in row-major order and automatically transposed to
 * MATLAB's column-major storage format.
 *
 * @param {Array<{name: string, data: ArrayLike<number>, rows: number, cols: number, type: string}>} variables
 * @returns {ArrayBuffer} The complete MAT file as a binary buffer
 */
export function writeMatFile(variables) {
    // Calculate total buffer size
    let totalSize = 128; // file header
    for (const v of variables) {
        const info = TYPE_INFO[v.type];
        if (!info) throw new Error(`Unsupported type: ${v.type}`);
        const content = matrixContentSize(v.name.length, v.rows * v.cols, info.bytesPerElement);
        totalSize += 8 + content; // matrix element tag (8) + subelements
    }

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // === 128-byte file header ===
    // Bytes 0-115: descriptive text (padded with spaces)
    const headerText = 'MATLAB 5.0 MAT-file, Created by LithicWeb';
    for (let i = 0; i < 116; i++) {
        view.setUint8(i, i < headerText.length ? headerText.charCodeAt(i) : 0x20);
    }
    // Bytes 116-123: subsystem data offset (zeros — already initialized)
    // Bytes 124-125: version
    view.setUint16(124, 0x0100, true);
    // Bytes 126-127: endian indicator ('MI' = 0x4D49 for little-endian)
    view.setUint16(126, 0x4D49, true);
    offset = 128;

    // === Write each variable as a miMATRIX data element ===
    for (const v of variables) {
        const info = TYPE_INFO[v.type];
        const contentSize = matrixContentSize(v.name.length, v.rows * v.cols, info.bytesPerElement);

        // Matrix element tag: type=14 (miMATRIX), length=contentSize
        view.setInt32(offset, MI_MATRIX, true);
        view.setInt32(offset + 4, contentSize, true);
        offset += 8;

        // --- Subelement 1: Array Flags (miUINT32, 8 bytes of data) ---
        // Tag
        view.setInt32(offset, MI_UINT32, true);
        view.setInt32(offset + 4, 8, true);
        // Data: byte 0 = mxClass, byte 1 = flags, bytes 2-7 = zeros
        view.setUint8(offset + 8, info.mxClass);
        // flags byte (offset+9) stays 0: no complex, global, or logical flags
        offset += 16; // 8 tag + 8 data (already 8-aligned)

        // --- Subelement 2: Dimensions (miINT32) ---
        view.setInt32(offset, MI_INT32, true);
        view.setInt32(offset + 4, 8, true);       // 2 dims * 4 bytes = 8
        view.setInt32(offset + 8, v.rows, true);
        view.setInt32(offset + 12, v.cols, true);
        offset += 16; // 8 tag + 8 data (already 8-aligned)

        // --- Subelement 3: Array Name (miINT8) ---
        view.setInt32(offset, MI_INT8, true);
        view.setInt32(offset + 4, v.name.length, true);
        for (let i = 0; i < v.name.length; i++) {
            view.setUint8(offset + 8 + i, v.name.charCodeAt(i));
        }
        offset += 8 + round8(v.name.length);

        // --- Subelement 4: Real Part data ---
        // Data is written in column-major order (MATLAB convention).
        // Input is row-major: data[row * cols + col]
        // Output is column-major: position[col * rows + row]
        const numElements = v.rows * v.cols;
        const dataBytes = numElements * info.bytesPerElement;
        view.setInt32(offset, info.miType, true);
        view.setInt32(offset + 4, dataBytes, true);
        const dataStart = offset + 8;

        if (v.type === 'double') {
            for (let col = 0; col < v.cols; col++) {
                for (let row = 0; row < v.rows; row++) {
                    const srcIdx = row * v.cols + col;
                    const dstIdx = col * v.rows + row;
                    view.setFloat64(dataStart + dstIdx * 8, v.data[srcIdx], true);
                }
            }
        } else if (v.type === 'uint16') {
            for (let col = 0; col < v.cols; col++) {
                for (let row = 0; row < v.rows; row++) {
                    const srcIdx = row * v.cols + col;
                    const dstIdx = col * v.rows + row;
                    view.setUint16(dataStart + dstIdx * 2, v.data[srcIdx], true);
                }
            }
        }

        offset += 8 + round8(dataBytes);
    }

    return buffer;
}
