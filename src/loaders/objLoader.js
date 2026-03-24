/**
 * OBJ file parser — geometry only.
 *
 * Supports:
 * - Vertex positions (v)
 * - Faces in all common formats: f v, f v/vt, f v/vt/vn, f v//vn
 * - Quads and n-gons (triangulated via fan)
 *
 * UVs and normals in face references are ignored — we only extract
 * position indices.  Normals are recomputed by Three.js.
 */

/**
 * Parse an OBJ file string and return positions + triangle indices.
 *
 * @param {string} text - OBJ file contents
 * @returns {{ positions: Float32Array, indices: number[] }}
 */
export function parseOBJ(text) {
    const rawPositions = [];
    const outIndices = [];

    const len = text.length;
    let pos = 0;

    while (pos < len) {
        let eol = text.indexOf('\n', pos);
        if (eol === -1) eol = len;

        // Skip leading whitespace
        let start = pos;
        while (start < eol && (text.charCodeAt(start) === 32 || text.charCodeAt(start) === 9)) start++;
        pos = eol + 1;

        if (start >= eol) continue;
        const c0 = text.charCodeAt(start);
        if (c0 === 35) continue;  // '#'

        if (c0 === 118) {  // 'v'
            const c1 = text.charCodeAt(start + 1);
            if (c1 === 32 || c1 === 9) {
                parseVertex3(text, start + 2, eol, rawPositions);
            }
        } else if (c0 === 102) {  // 'f'
            const c1 = text.charCodeAt(start + 1);
            if (c1 === 32 || c1 === 9) {
                parseFace(text, start + 2, eol, outIndices);
            }
        }
    }

    return {
        positions: new Float32Array(rawPositions),
        indices: outIndices,
    };
}

/** Parse "x y z" floats and push to arr. */
function parseVertex3(text, offset, eol, arr) {
    while (offset < eol && (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) === 9)) offset++;
    let end = offset;
    while (end < eol && text.charCodeAt(end) !== 32 && text.charCodeAt(end) !== 9) end++;
    const x = +text.substring(offset, end);

    offset = end + 1;
    while (offset < eol && (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) === 9)) offset++;
    end = offset;
    while (end < eol && text.charCodeAt(end) !== 32 && text.charCodeAt(end) !== 9) end++;
    const y = +text.substring(offset, end);

    offset = end + 1;
    while (offset < eol && (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) === 9)) offset++;
    end = offset;
    while (end < eol && text.charCodeAt(end) !== 32 && text.charCodeAt(end) !== 9) end++;
    const z = +text.substring(offset, end);

    arr.push(x, y, z);
}

/**
 * Parse a face line — extracts only position indices, ignores UV/normal refs.
 * Triangulates quads/n-gons via fan.
 */
function parseFace(text, offset, eol, outIndices) {
    const faceVerts = [];

    while (offset < eol) {
        while (offset < eol && (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) === 9)) offset++;
        if (offset >= eol) break;

        // Read digits until '/' or whitespace
        let end = offset;
        while (end < eol && text.charCodeAt(end) !== 47 && text.charCodeAt(end) !== 32 && text.charCodeAt(end) !== 9 && text.charCodeAt(end) !== 13) end++;

        const vi = parseInt(text.substring(offset, end), 10) - 1;
        faceVerts.push(vi);

        // Skip rest of token (e.g. "/2/3")
        while (end < eol && text.charCodeAt(end) !== 32 && text.charCodeAt(end) !== 9) end++;
        offset = end;
    }

    for (let i = 1; i < faceVerts.length - 1; i++) {
        outIndices.push(faceVerts[0], faceVerts[i], faceVerts[i + 1]);
    }
}
