// Initialize Babylon.js
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

const drawColor = [1, 0.6, 0.2, 1]; // Orange
const objectColor = [0.5, 0.5, 0.5, 1]; // Gray


// Create a basic BJS Scene
const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 2, 10, BABYLON.Vector3.Zero(), scene);
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
            const loader = new THREE.PLYLoader();
            const geometry = loader.parse(data);

            // Convert geometry to Babylon.js mesh
            const positions = geometry.attributes.position.array;
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

            for (let i = 0; i < meshColors.length; i += 4) {
                meshColors[i] = objectColor[0]; // R
                meshColors[i + 1] = objectColor[1]; // G
                meshColors[i + 2] = objectColor[2]; // B
                meshColors[i + 3] = objectColor[3]; // A
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
    // Check if mesh exists
    if (!mesh) {
        console.error("No colored mesh to export.");
        return;
    }

    // Extract vertex data
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = mesh.getIndices();

    // PLY file header
    const header = `ply
format ascii 1.0
element vertex ${positions.length / 3}
property float x
property float y
property float z
property int labels
element face ${indices.length / 3}
property list uchar int vertex_indices
end_header
`;

    // Vertex data
    let vertexData = '';
    for (let i = 0; i < positions.length / 3; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const label = meshColors[i * 4] === 1 ? 1 : 0; // Check if red component is 1 for the label
        vertexData += `${x} ${y} ${z} ${label}\n`;
    }

    // Face data
    let faceData = '';
    for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i];
        const i2 = indices[i + 1];
        const i3 = indices[i + 2];
        faceData += `3 ${i1} ${i2} ${i3}\n`;
    }

    // Combine header, vertex data, and face data
    const plyContent = header + vertexData + faceData;

    // Create a Blob from the PLY content
    const blob = new Blob([plyContent], {type: 'text/plain'});
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
