// Initialize Babylon.js
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

const drawColor = [1, 0.6, 0.2, 1]; // Orange
const objectColor = [0.5, 0.5, 0.5, 1]; // Gray


class CustomPLYLoader extends THREE.PLYLoader {
    parse(data) {
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
                comments: [],
                elements: [],
                headerLength: headerLength,
                objInfo: ''
            };
            const lines = headerText.split('\n');
            let currentElement;

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
                        header.comments.push(line);
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

        function parseASCII(data, header) {
            const buffer = {
                indices: [],
                vertices: [],
                normals: [],
                uvs: [],
                faceVertexUvs: [],
                colors: [],
                labels: [] // To store labels
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

            return postProcess(buffer);
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


        function parseBinary(data, header) {
            const buffer = {
                indices: [],
                vertices: [],
                normals: [],
                uvs: [],
                faceVertexUvs: [],
                colors: [],
                labels: []  // To store labels
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

            return postProcess(buffer);
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
            const attrLabel = findAttrName(['labels']) || 'labels';

            if (elementName === 'vertex') {
                buffer.vertices.push(element[attrX], element[attrY], element[attrZ]);

                // Store labels if present
                if (attrLabel in element) {
                    buffer.labels.push(element[attrLabel]);
                }
            } else if (elementName === 'face') {
                const vertex_indices = element.vertex_indices || element.vertex_index;
                if (vertex_indices.length === 3) {
                    buffer.indices.push(vertex_indices[0], vertex_indices[1], vertex_indices[2]);
                } else if (vertex_indices.length === 4) {
                    buffer.indices.push(vertex_indices[0], vertex_indices[1], vertex_indices[3]);
                    buffer.indices.push(vertex_indices[1], vertex_indices[2], vertex_indices[3]);
                }
            }
        }

        function postProcess(buffer) {
            let geometry = new THREE.BufferGeometry();
            if (buffer.indices.length > 0) {
                geometry.setIndex(buffer.indices);
            }

            geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.vertices, 3));
            if (buffer.labels.length > 0) {
                geometry.setAttribute('labels', new THREE.Int32BufferAttribute(buffer.labels, 1));
            }

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

// Create a basic BJS Scene
const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, 30, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);
const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0), scene);

// Global variables
let rafId = null;
let mesh;
let meshColors;
let kdtree;
let mode = 'view'; // 'view', 'draw', 'erase'
let prevMode = 'view';
let isDrawing = false; // Track if the user is currently drawing


// Increase zoom speed
camera.wheelDeltaPercentage = 0.01; // Set to a higher value for faster zoom


// Function to update light direction to match the camera's forward direction
const updateLightDirection = () => {
    const forward = camera.getForwardRay().direction;
    light.direction = forward.negate();
};

// Update the light direction initially
updateLightDirection();


document.getElementById('updateLight').addEventListener('click', updateLightDirection);


const createKDTree = (positions) => {
    const points = [];
    for (let i = 0; i < positions.length; i += 3) {
        points.push({
            x: positions[i],
            y: positions[i + 1],
            z: positions[i + 2],
            index: i / 3 // Store the index of the vertex
        });
    }

    const distance = (a, b) => {
        return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    };

    return new kdTree(points, distance, ['x', 'y', 'z']);
};

// Add an observable to update the light direction whenever the camera moves
// scene.onBeforeRenderObservable.add(() => {
//     updateLightDirection();
// });


window.addEventListener('wheel', (event) => {
    if (event.ctrlKey) {
        event.preventDefault();
        const zoomAmount = event.deltaY * camera.wheelDeltaPercentage; // Adjust this value to control zoom speed
        camera.radius += zoomAmount;
    }
}, {passive: false});


// Add Axes
function createAxis(scene, size) {
    // X axis
    const xAxis = BABYLON.MeshBuilder.CreateLines("xAxis", {
        points: [
            new BABYLON.Vector3(0, 0, 0),
            new BABYLON.Vector3(size, 0, 0),
            new BABYLON.Vector3(size * 0.95, size * 0.05, 0),
            new BABYLON.Vector3(size, 0, 0),
            new BABYLON.Vector3(size * 0.95, size * -0.05, 0)
        ]
    }, scene);
    xAxis.color = new BABYLON.Color3(1, 0, 0);

    // Y axis
    const yAxis = BABYLON.MeshBuilder.CreateLines("yAxis", {
        points: [
            new BABYLON.Vector3(0, 0, 0),
            new BABYLON.Vector3(0, size, 0),
            new BABYLON.Vector3(size * -0.05, size * 0.95, 0),
            new BABYLON.Vector3(0, size, 0),
            new BABYLON.Vector3(size * 0.05, size * 0.95, 0)
        ]
    }, scene);
    yAxis.color = new BABYLON.Color3(0, 1, 0);

    // Z axis
    const zAxis = BABYLON.MeshBuilder.CreateLines("zAxis", {
        points: [
            new BABYLON.Vector3(0, 0, 0),
            new BABYLON.Vector3(0, 0, size),
            new BABYLON.Vector3(0, size * 0.05, size * 0.95),
            new BABYLON.Vector3(0, 0, size),
            new BABYLON.Vector3(0, size * -0.05, size * 0.95)
        ]
    }, scene);
    zAxis.color = new BABYLON.Color3(0, 0, 1);
}

// Call createAxis to add axes to the scene
createAxis(scene, 10);

// Function to enable vertex colors on a mesh

// File input handling
document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const data = event.target.result;

            // Use PLYLoader from three.js to parse the PLY file
            const loader = new CustomPLYLoader();
            const geometry = loader.parse(data);

            // Convert geometry to Babylon.js mesh
            const positions = geometry.attributes.position.array;
            const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];

            console.log("geometry.attributes", geometry.attributes);
            console.log("geometry", geometry);
            console.log("labels", labels);

            let indices = Array.from({length: geometry.index.count}, (_, i) => geometry.index.array[i]);

            // Reverse the winding order of the indices

            for (let i = 0; i < indices.length; i += 3) {
                let temp = indices[i + 1];
                indices[i + 1] = indices[i + 2];
                indices[i + 2] = temp;
            }

            const babylonMesh = new BABYLON.Mesh("mesh", scene);
            const vertexData = new BABYLON.VertexData();
            vertexData.positions = standardizePositions(positions);
            vertexData.indices = indices;

            // Recalculate normals
            BABYLON.VertexData.ComputeNormals(vertexData.positions, vertexData.indices, vertexData.normals = []);

            vertexData.applyToMesh(babylonMesh);

            if (mesh) mesh.dispose();  // Dispose previous mesh if any
            mesh = babylonMesh;

            // Enable backface culling
            mesh.material = new BABYLON.StandardMaterial("meshMaterial", scene);
            mesh.material.backFaceCulling = true;

            // Enable vertex colors
            mesh.material.vertexColorsEnabled = true;

            meshColors = new Float32Array((positions.length / 3) * 4);

            // if labels are defined, then 1 is for drawColor and 0 is for objectColor. Otherwise, all colors are objectColor as below

            if (labels) {
                for (let i = 0; i < meshColors.length; i += 4) {
                    if (labels[Math.floor(i / 4)] === 1) {
                        meshColors[i] = drawColor[0];     // R
                        meshColors[i + 1] = drawColor[1]; // G
                        meshColors[i + 2] = drawColor[2]; // B
                        meshColors[i + 3] = drawColor[3]; // A
                    } else {
                        meshColors[i] = objectColor[0];     // R
                        meshColors[i + 1] = objectColor[1]; // G
                        meshColors[i + 2] = objectColor[2]; // B
                        meshColors[i + 3] = objectColor[3]; // A
                    }
                }
                
            } else {
                for (let i = 0; i < meshColors.length; i += 4) {
                    meshColors[i] = objectColor[0]; // R
                    meshColors[i + 1] = objectColor[1]; // G
                    meshColors[i + 2] = objectColor[2]; // B
                    meshColors[i + 3] = objectColor[3]; // A
                }    
            }

            mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, meshColors, true); // Set true for updatable

            // Enable vertex colors
            // Create a new StandardMaterial and apply it to the mesh
            const material = new BABYLON.StandardMaterial("meshMaterial", scene);
            material.backFaceCulling = true;
            material.vertexColorsEnabled = true;

            // Reduce reflection intensity
            if (material.reflectionTexture) {
                material.reflectionTexture.level = 0.05;  // Adjust this value to control reflection intensity
            }

            if (material.reflectivityTexture) {
                material.reflectivityTexture.level = 0.05;
            }

            // Reduce specular highlights
            material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);  // Adjust this value to control specular intensity

            // Apply the material to the mesh
            mesh.material = material;

            kdtree = createKDTree(positions);
        };
        reader.readAsArrayBuffer(file);
    }
});

// Function to standardize the mesh
function standardizePositions(positions) {

    // Calculate the center of mass
    let centerX = 0, centerY = 0, centerZ = 0;
    const totalVertices = positions.length / 3;

    for (let i = 0; i < positions.length; i += 3) {
        centerX += positions[i];
        centerY += positions[i + 1];
        centerZ += positions[i + 2];
    }

    centerX /= totalVertices;
    centerY /= totalVertices;
    centerZ /= totalVertices;

    // Translate vertices to center them at the origin
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] -= centerX;
        positions[i + 1] -= centerY;
        positions[i + 2] -= centerZ;
    }

    return positions;
}

// Utility function to update button states
function updateButtonStates() {
    const buttons = document.querySelectorAll('.toggle-button');
    buttons.forEach(button => {
        button.classList.remove('bg-blue-500', 'text-white');
        if (button.id === `${mode}Mode`) {
            button.classList.add('bg-blue-500', 'text-white');
        } else {
            button.classList.add('bg-gray-300', 'text-gray-700');
        }
    });
    updateCursor();
}

function updateCursor() {
    const body = document.body;
    body.classList.remove('view-cursor', 'draw-cursor', 'erase-cursor');
    if (mode === 'view') {
        body.classList.add('view-cursor');
    } else if (mode === 'draw') {
        body.classList.add('draw-cursor');
    } else if (mode === 'erase') {
        body.classList.add('erase-cursor');
    }
}

// Toggle Draw Mode
document.getElementById('drawMode').addEventListener('click', () => {
    if (mode !== 'draw') {
        prevMode = mode;
        mode = 'draw';
        camera.detachControl(canvas);
    } else {
        mode = 'view';
        prevMode = 'view';
        camera.attachControl(canvas, true);
    }
    updateButtonStates();
});

// Toggle Erase Mode
document.getElementById('eraseMode').addEventListener('click', () => {
    if (mode !== 'erase') {
        prevMode = mode;
        mode = 'erase';
        camera.detachControl(canvas);
    } else {
        mode = 'view';
        prevMode = 'view';
        camera.attachControl(canvas, true);
    }
    updateButtonStates();
});

// Toggle View Mode
document.getElementById('viewMode').addEventListener('click', () => {
    if (mode !== 'view') {
        prevMode = mode;
        mode = 'view';
        camera.attachControl(canvas, true);
    }
    updateButtonStates();
});

// Initial call to set the correct button state on page load
updateButtonStates();

const colorVertex = (vertexIndex, color) => {
    meshColors[vertexIndex * 4] = color[0]; // R
    meshColors[vertexIndex * 4 + 1] = color[1]; // G
    meshColors[vertexIndex * 4 + 2] = color[2]; // B
    meshColors[vertexIndex * 4 + 3] = color[3]; // A
};


const handleDrawing = (pickResult) => {
    if (pickResult.hit) {
        const pickedPoint = pickResult.pickedPoint;

        // Color the picked vertex
        const targetColor = mode === 'draw' ? drawColor : objectColor;

        // Find the closest vertex using KD-Tree
        // console.time('kdTree nearest search');
        const nearest = kdtree.nearest({
            x: pickedPoint.x,
            y: pickedPoint.y,
            z: pickedPoint.z
        }, 1)[0];
        // console.timeEnd('kdTree nearest search');

        const closestVertexIndex = nearest[0].index;

        // Color the closest vertex
        if (closestVertexIndex !== -1) {
            colorVertex(closestVertexIndex, targetColor);
        }

        // Update the colors data in the mesh
        console.time('setVerticesData');
        mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, meshColors);
        console.timeEnd('setVerticesData');
    }
};


// Handle drawing and erasing
scene.onPointerObservable.add((pointerInfo) => {
    if (!mesh) return;

    switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
            if (pointerInfo.event.button === 0) { // Left mouse button
                if (mode === 'draw' || mode === 'erase') {
                    isDrawing = true;
                    console.time('scene.pick');
                    const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                    console.timeEnd('scene.pick');
                    handleDrawing(pickResult);
                }
            } else if (pointerInfo.event.button === 2) { // Right mouse button
                if (mode === 'draw' || mode === 'erase') {
                    prevMode = mode;
                    mode = 'view';
                    camera.attachControl(canvas, true);
                    updateButtonStates();
                }
            }
            break;

        case BABYLON.PointerEventTypes.POINTERMOVE:
            if (isDrawing && (mode === 'draw' || mode === 'erase')) { // Left mouse button
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                handleDrawing(pickResult);
            }
            break;

        case BABYLON.PointerEventTypes.POINTERUP:
            if (pointerInfo.event.button === 0) { // Left mouse button
                if (isDrawing) {
                    isDrawing = false;
                }
            } else if (pointerInfo.event.button === 2) { // Right mouse button
                mode = prevMode;
                if (mode !== 'view') {
                    camera.detachControl(canvas);
                    updateButtonStates();
                }
            }
            break;
    }
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        if (mode === 'draw' || mode === 'erase') {
            prevMode = mode;
            mode = 'view';
            camera.attachControl(canvas, true);
            updateButtonStates();
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode = prevMode;
        if (mode !== 'view') {
            camera.detachControl(canvas);
            updateButtonStates();
        }
    }
});

// Export Annotations
document.getElementById('exportAnnotations').addEventListener('click', () => {
    if (!mesh) {
        console.error("No mesh to export.");
        return;
    }

    // Extract vertex data
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = mesh.getIndices();

    const vertexCount = positions.length / 3;
    const faceCount = indices.length / 3;

    // PLY file header
    const header = `ply
format binary_little_endian 1.0
element vertex ${vertexCount}
property float x
property float y
property float z
property int labels
element face ${faceCount}
property list uchar int vertex_indices
end_header
`;

    // Calculate the size of the binary buffer
    const vertexElementSize = 4 * (3 + 1); // 3 floats (x, y, z) + 1 int (label)
    const faceElementSize = 1 + 3 * 4; // 1 uchar (vertex count) + 3 ints (vertex indices)
    const headerSize = new TextEncoder().encode(header).length;
    const totalSize = headerSize + vertexCount * vertexElementSize + faceCount * faceElementSize;

    // Create the binary buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);
    let offset = 0;

    // Write the header
    const headerBytes = new TextEncoder().encode(header);
    for (let i = 0; i < headerBytes.length; i++) {
        dataView.setUint8(offset++, headerBytes[i]);
    }

    // Write the vertex data
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const label = meshColors[i * 4] === 1 ? 1 : 0; // Check if red component is 1 for the label

        dataView.setFloat32(offset, x, true); offset += 4;
        dataView.setFloat32(offset, y, true); offset += 4;
        dataView.setFloat32(offset, z, true); offset += 4;
        dataView.setInt32(offset, label, true); offset += 4;
    }

    // Write the face data
    for (let i = 0; i < faceCount; i++) {
        const i1 = indices[i * 3];
        const i2 = indices[i * 3 + 2]; // Inverted order for consistency with the usual PLY files with lithic artifacts
        const i3 = indices[i * 3 + 1];

        dataView.setUint8(offset, 3); offset += 1; // Number of vertices per face
        dataView.setInt32(offset, i1, true); offset += 4;
        dataView.setInt32(offset, i2, true); offset += 4;
        dataView.setInt32(offset, i3, true); offset += 4;
    }

    // Create a Blob from the binary buffer
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Create a link element and trigger the download
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mesh.ply';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

engine.runRenderLoop(() => {
    scene.render();
});

// Resize the canvas when the window is resized
window.addEventListener('resize', () => {
    engine.resize();
});
