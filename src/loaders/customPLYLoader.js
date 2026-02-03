import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

/**
 * Metadata prefix used to identify metadata comments in PLY files.
 * Format: "comment metadata <key> <value>"
 * 
 * For JSON values (objects/arrays), format is:
 * "comment metadata:json <key> <json_value>"
 */
const METADATA_PREFIX = 'metadata ';
const METADATA_JSON_PREFIX = 'metadata:json ';

/**
 * Custom PLY loader that extends THREE.js PLYLoader with support for:
 * - Standard PLY elements (vertices, faces)
 * - Custom elements (arrows, labels)
 * - Metadata stored in PLY comments
 * 
 * Metadata Convention:
 * - Simple key-value: "comment metadata author John Doe"
 * - JSON values: "comment metadata:json settings {"scale":1.5,"visible":true}"
 * 
 * Parsed metadata is available in geometry.userData.metadata
 * Raw comments are available in geometry.userData.comments
 */
class CustomPLYLoader extends PLYLoader {
    parse(data) {
        /**
         * Parse the PLY header to extract format, elements, properties, comments, and metadata.
         * @param {string} data - The PLY file content as a string
         * @returns {Object} Parsed header containing format, elements, comments, and metadata
         */
        function parseHeader(data) {
            const patternHeader = /^ply([\s\S]*)end_header\s/;
            let headerText = '';
            let headerLength = 0;
            const result = patternHeader.exec(data);

            if (result !== null) {
                headerText = result[1];
                headerLength = new Blob([result[0]]).size;
            }

            const header = {
                comments: [],      // Raw comments (non-metadata)
                metadata: {},      // Parsed metadata key-value pairs
                elements: [],
                headerLength: headerLength,
                objInfo: ''
            };
            const lines = headerText.split('\n');
            let currentElement;

            /**
             * Parse a PLY property definition line.
             * @param {string[]} propertyValues - Property definition tokens
             * @param {Object} propertyNameMapping - Optional name remapping
             * @returns {Object} Parsed property object
             */
            function make_ply_element_property(propertyValues, propertyNameMapping) {
                const property = {
                    type: propertyValues[0]
                };

                if (property.type === 'list') {
                    property.name = propertyValues[3];
                    property.countType = propertyValues[1];
                    property.itemType = propertyValues[2];
                } else {
                    property.name = propertyValues[1];
                }

                if (property.name in propertyNameMapping) {
                    property.name = propertyNameMapping[property.name];
                }

                return property;
            }

            /**
             * Parse a comment line, extracting metadata if present.
             * Metadata format: "metadata <key> <value>" or "metadata:json <key> <json>"
             * @param {string} commentText - The comment text (without "comment" prefix)
             * @param {Object} header - Header object to populate
             */
            function parseComment(commentText, header) {
                if (commentText.startsWith(METADATA_JSON_PREFIX)) {
                    // JSON metadata: "metadata:json key {json_value}"
                    const content = commentText.substring(METADATA_JSON_PREFIX.length);
                    const spaceIndex = content.indexOf(' ');
                    if (spaceIndex !== -1) {
                        const key = content.substring(0, spaceIndex);
                        const jsonValue = content.substring(spaceIndex + 1);
                        try {
                            header.metadata[key] = JSON.parse(jsonValue);
                        } catch (e) {
                            console.warn(`Failed to parse JSON metadata for key "${key}":`, e);
                            // Store as string if JSON parsing fails
                            header.metadata[key] = jsonValue;
                        }
                    }
                } else if (commentText.startsWith(METADATA_PREFIX)) {
                    // Simple metadata: "metadata key value"
                    const content = commentText.substring(METADATA_PREFIX.length);
                    const spaceIndex = content.indexOf(' ');
                    if (spaceIndex !== -1) {
                        const key = content.substring(0, spaceIndex);
                        const value = content.substring(spaceIndex + 1);
                        // Try to parse as number or boolean, otherwise keep as string
                        header.metadata[key] = parseMetadataValue(value);
                    } else {
                        // Key with no value (treat as boolean true)
                        header.metadata[content] = true;
                    }
                } else {
                    // Regular comment (non-metadata)
                    header.comments.push(commentText);
                }
            }

            /**
             * Parse a metadata value string into appropriate type.
             * @param {string} value - The value string to parse
             * @returns {string|number|boolean} Parsed value
             */
            function parseMetadataValue(value) {
                // Check for boolean
                if (value === 'true') return true;
                if (value === 'false') return false;
                
                // Check for number
                const num = Number(value);
                if (!isNaN(num) && value.trim() !== '') {
                    return num;
                }
                
                // Return as string
                return value;
            }

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line === '') continue;
                const lineValues = line.split(/\s+/);
                const lineType = lineValues.shift();
                line = lineValues.join(' ');

                switch (lineType) {
                    case 'format':
                        header.format = lineValues[0];
                        header.version = lineValues[1];
                        break;
                    case 'comment':
                        parseComment(line, header);
                        break;
                    case 'element':
                        if (currentElement !== undefined) {
                            header.elements.push(currentElement);
                        }
                        currentElement = {};
                        currentElement.name = lineValues[0];
                        currentElement.count = parseInt(lineValues[1]);
                        currentElement.properties = [];
                        break;
                    case 'property':
                        currentElement.properties.push(make_ply_element_property(lineValues, scope.propertyNameMapping));
                        break;
                    case 'obj_info':
                        header.objInfo = line;
                        break;
                    default:
                        console.log('unhandled', lineType, lineValues);
                }
            }

            if (currentElement !== undefined) {
                header.elements.push(currentElement);
            }

            return header;
        }

        function parseASCIINumber(n, type) {
            switch (type) {
                case 'char':
                case 'uchar':
                case 'short':
                case 'ushort':
                case 'int':
                case 'uint':
                case 'int8':
                case 'uint8':
                case 'int16':
                case 'uint16':
                case 'int32':
                case 'uint32':
                    return parseInt(n);
                case 'float':
                case 'double':
                case 'float32':
                case 'float64':
                    return parseFloat(n);
            }
        }

        function parseASCIIElement(properties, line) {
            const values = line.split(/\s+/);
            const element = {};

            for (let i = 0; i < properties.length; i++) {
                if (properties[i].type === 'list') {
                    const list = [];
                    const n = parseASCIINumber(values.shift(), properties[i].countType);
                    for (let j = 0; j < n; j++) {
                        list.push(parseASCIINumber(values.shift(), properties[i].itemType));
                    }
                    element[properties[i].name] = list;
                } else {
                    element[properties[i].name] = parseASCIINumber(values.shift(), properties[i].type);
                }
            }

            return element;
        }

        /**
         * Parse ASCII format PLY data.
         * @param {string} data - The PLY file content
         * @param {Object} header - Parsed header
         * @returns {THREE.BufferGeometry} Parsed geometry
         */
        function parseASCII(data, header) {
            const buffer = {
                indices: [],
                vertices: [],
                normals: [],
                uvs: [],
                faceVertexUvs: [],
                colors: [],
                labels: [],
                labelIds: [],
                arrows: []
            };
            let result;
            const patternBody = /end_header\s([\s\S]*)$/;
            let body = '';

            if ((result = patternBody.exec(data)) !== null) {
                body = result[1];
            }

            const lines = body.split('\n');
            let currentElement = 0;
            let currentElementCount = 0;

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line === '') {
                    continue;
                }

                if (currentElementCount >= header.elements[currentElement].count) {
                    currentElement++;
                    currentElementCount = 0;
                }

                const element = parseASCIIElement(header.elements[currentElement].properties, line);
                handleElement(buffer, header.elements[currentElement].name, element);
                currentElementCount++;
            }

            return postProcess(buffer, header);
        }

        function binaryRead(dataview, at, type, little_endian) {
            switch (type) {
                case 'int8':
                case 'char':
                    return [dataview.getInt8(at), 1];
                case 'uint8':
                case 'uchar':
                    return [dataview.getUint8(at), 1];
                case 'int16':
                case 'short':
                    return [dataview.getInt16(at, little_endian), 2];
                case 'uint16':
                case 'ushort':
                    return [dataview.getUint16(at, little_endian), 2];
                case 'int32':
                case 'int':
                    return [dataview.getInt32(at, little_endian), 4];
                case 'uint32':
                case 'uint':
                    return [dataview.getUint32(at, little_endian), 4];
                case 'float32':
                case 'float':
                    return [dataview.getFloat32(at, little_endian), 4];
                case 'float64':
                case 'double':
                    return [dataview.getFloat64(at, little_endian), 8];
            }
        }

        function binaryReadElement(dataview, at, properties, little_endian) {
            const element = {};
            let result, read = 0;

            for (let i = 0; i < properties.length; i++) {
                if (properties[i].type === 'list') {
                    const list = [];
                    result = binaryRead(dataview, at + read, properties[i].countType, little_endian);
                    const n = result[0];
                    read += result[1];
                    for (let j = 0; j < n; j++) {
                        result = binaryRead(dataview, at + read, properties[i].itemType, little_endian);
                        list.push(result[0]);
                        read += result[1];
                    }
                    element[properties[i].name] = list;
                } else {
                    result = binaryRead(dataview, at + read, properties[i].type, little_endian);
                    element[properties[i].name] = result[0];
                    read += result[1];
                }
            }

            return [element, read];
        }


        /**
         * Parse binary format PLY data (little or big endian).
         * @param {ArrayBuffer} data - The PLY file content as binary
         * @param {Object} header - Parsed header
         * @returns {THREE.BufferGeometry} Parsed geometry
         */
        function parseBinary(data, header) {
            const buffer = {
                indices: [],
                vertices: [],
                normals: [],
                uvs: [],
                faceVertexUvs: [],
                colors: [],
                labels: [],
                labelIds: [],
                arrows: []
            };
            const little_endian = header.format === 'binary_little_endian';
            const body = new DataView(data, header.headerLength);
            let result, loc = 0;

            for (let currentElement = 0; currentElement < header.elements.length; currentElement++) {
                for (let currentElementCount = 0; currentElementCount < header.elements[currentElement].count; currentElementCount++) {
                    result = binaryReadElement(body, loc, header.elements[currentElement].properties, little_endian);
                    loc += result[1];
                    const element = result[0];
                    handleElement(buffer, header.elements[currentElement].name, element);
                }
            }

            return postProcess(buffer, header);
        }


        function handleElement(buffer, elementName, element) {
            function findAttrName(names) {
                for (let i = 0, l = names.length; i < l; i++) {
                    const name = names[i];
                    if (name in element) return name;
                }
                return null;
            }

            const attrX = findAttrName(['x', 'px', 'posx']) || 'x';
            const attrY = findAttrName(['y', 'py', 'posy']) || 'y';
            const attrZ = findAttrName(['z', 'pz', 'posz']) || 'z';
            const attrLabels = findAttrName(['labels']);
            const attrLabelId = findAttrName(['labelid']);
            const attrStartIndex = findAttrName(['start_index']) || 'start_index';
            const attrEndIndex = findAttrName(['end_index']) || 'end_index';

            if (elementName === 'vertex') {
                buffer.vertices.push(element[attrX], element[attrY], element[attrZ]);

                if (attrLabels) {
                    if (!buffer.labels) buffer.labels = [];
                    buffer.labels.push(element[attrLabels]);
                }
                if (attrLabelId) {
                    if (!buffer.labelIds) buffer.labelIds = [];
                    buffer.labelIds.push(element[attrLabelId]);
                }
            } else if (elementName === 'face') {
                const vertex_indices = element.vertex_indices || element.vertex_index;
                if (vertex_indices.length === 3) {
                    buffer.indices.push(vertex_indices[0], vertex_indices[1], vertex_indices[2]);
                } else if (vertex_indices.length === 4) {
                    buffer.indices.push(vertex_indices[0], vertex_indices[1], vertex_indices[3]);
                    buffer.indices.push(vertex_indices[1], vertex_indices[2], vertex_indices[3]);
                }
            } else if (elementName === 'arrow') {
                buffer.arrows.push({
                    startIndex: element[attrStartIndex],
                    endIndex: element[attrEndIndex]
                });
            }
        }

        /**
         * Post-process the parsed buffer into a THREE.BufferGeometry.
         * Attaches parsed metadata and comments to geometry.userData.
         * @param {Object} buffer - Parsed vertex/face/arrow data
         * @param {Object} header - Parsed header containing metadata and comments
         * @returns {THREE.BufferGeometry} The constructed geometry
         */
        function postProcess(buffer, header) {
            let geometry = new THREE.BufferGeometry();
            if (buffer.indices.length > 0) {
                geometry.setIndex(buffer.indices);
            }

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.vertices, 3));
            
            if (buffer.labels && buffer.labels.length > 0) {
                geometry.setAttribute('labels', new THREE.Int32BufferAttribute(buffer.labels, 1));
            }
            if (buffer.labelIds && buffer.labelIds.length > 0) {
                geometry.setAttribute('labelid', new THREE.Int32BufferAttribute(buffer.labelIds, 1));
            }

            // Store arrows in userData
            geometry.userData.arrows = buffer.arrows;
            
            // Store parsed metadata and raw comments in userData
            geometry.userData.metadata = header.metadata || {};
            geometry.userData.comments = header.comments || [];

            geometry.computeBoundingSphere();
            return geometry;
        }

        const scope = this;
        let geometry;
        if (data instanceof ArrayBuffer) {
            const text = THREE.LoaderUtils.decodeText(new Uint8Array(data));
            const header = parseHeader(text);
            geometry = header.format === 'ascii' ? parseASCII(text, header) : parseBinary(data, header);
        } else {
            geometry = parseASCII(data, parseHeader(data));
        }

        return geometry;
    }
};


export default CustomPLYLoader;
