// Initialize Babylon.js
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

// Create a basic BJS Scene
const camera = new BABYLON.ArcRotateCamera("camera", Math.PI / 2, Math.PI / 2, 10, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);
const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0), scene);

// Increase zoom speed
camera.wheelDeltaPercentage = 0.01; // Set to a higher value for faster zoom

let mesh;
let coloredMesh;
let meshgrid;
let mode = 'view'; // 'view', 'draw', 'erase'
let prevMode = 'view';
let isDrawing = false; // Track if the user is currently drawing

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
            new BABYLON.Vector3(0 , size * 0.05, size * 0.95),
            new BABYLON.Vector3(0, 0, size),
            new BABYLON.Vector3(0 , size * -0.05, size * 0.95)
        ]
    }, scene);
    zAxis.color = new BABYLON.Color3(0, 0, 1);
}

// Call createAxis to add axes to the scene
createAxis(scene, 10);

// Function to create a wireframe overlay
function createWireframe(mesh, scene) {
    const vertexData = BABYLON.VertexData.ExtractFromMesh(mesh);
    const positions = vertexData.positions;
    const indices = vertexData.indices;

    const lines = [];
    for (let i = 0; i < indices.length; i += 3) {
        const p1 = BABYLON.Vector3.FromArray(positions, indices[i] * 3);
        const p2 = BABYLON.Vector3.FromArray(positions, indices[i + 1] * 3);
        const p3 = BABYLON.Vector3.FromArray(positions, indices[i + 2] * 3);
        lines.push([p1, p2, p3, p1]);
    }

    const wireframe = BABYLON.MeshBuilder.CreateLineSystem("wireframe", { lines: lines }, scene);
    wireframe.color = new BABYLON.Color3(0.5, 0.5, 0.5);
    if (meshgrid) meshgrid.dispose(); // Dispose previous mesh if any
    meshgrid = wireframe;
}

// Function to enable vertex colors on a mesh
function createColoredMesh(originalMesh, scene) {
    const vertexData = BABYLON.VertexData.ExtractFromMesh(originalMesh);
    const positions = vertexData.positions;
    const indices = vertexData.indices;

    // Create a new mesh for coloring
    const coloredMesh = new BABYLON.Mesh("coloredMesh", scene);
    const newVertexData = new BABYLON.VertexData();
    newVertexData.positions = positions;
    newVertexData.indices = indices;

    // Initialize colors array
    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0; i < colors.length; i += 4) {
        colors[i] = 0.5; // R
        colors[i + 1] = 0.5; // G
        colors[i + 2] = 0.5; // B
        colors[i + 3] = 1; // A
    }
    newVertexData.colors = colors;

    newVertexData.applyToMesh(coloredMesh);

    // Enable vertex colors
    coloredMesh.material = new BABYLON.StandardMaterial("coloredMeshMaterial", scene);
    coloredMesh.material.backFaceCulling = true;
    coloredMesh.material.vertexColorsEnabled = true;

    return coloredMesh;
}

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
            vertexData.positions = positions;
            vertexData.indices = indices;

            // Recalculate normals
            BABYLON.VertexData.ComputeNormals(vertexData.positions, vertexData.indices, vertexData.normals = []);

            vertexData.applyToMesh(babylonMesh);

            if (mesh) mesh.dispose();  // Dispose previous mesh if any
            mesh = babylonMesh;

            // Standardize the mesh
            standardizeMesh(mesh);

            // Create colored mesh
            coloredMesh = createColoredMesh(mesh, scene);

            // Create wireframe
            createWireframe(mesh, scene);

            // Remove the original mesh from the scene
            mesh.dispose();
        };
        reader.readAsArrayBuffer(file);
    }
});

// Function to standardize the mesh
function standardizeMesh(mesh) {
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);

    if (!positions) {
        console.error("No vertex data available.");
        return;
    }

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

    const center = new BABYLON.Vector3(centerX, centerY, centerZ);

    // Translate vertices to center them at the origin
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] -= centerX;
        positions[i + 1] -= centerY;
        positions[i + 2] -= centerZ;
    }

    mesh.position = mesh.position.subtract(center);

    // Apply the updated positions back to the mesh
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
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
});

// Handle Alt key events
window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt') {
        if (mode === 'draw' || mode === 'erase') {
            prevMode = mode;
            mode = 'view';
            camera.attachControl(canvas, true);
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') {
        mode = prevMode;
        if (mode !== 'view') {
            camera.detachControl(canvas);
        }
    }
});

// Utility function to get bounding box center and half-size
function getBoundingBox(vertices, indices, faceIndex) {
    let min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    for (let i = 0; i < 3; i++) {
        const vertexIndex = indices[faceIndex * 3 + i];
        const x = vertices[vertexIndex * 3];
        const y = vertices[vertexIndex * 3 + 1];
        const z = vertices[vertexIndex * 3 + 2];
        
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
    }

    const center = min.add(max).scale(0.5);
    const halfSize = max.subtract(min).scale(0.5);

    return { center, halfSize };
}

// Utility function to check if a point is within a bounding box
function isPointInBoundingBox(point, bbox) {
    const { center, halfSize } = bbox;
    return Math.abs(point.x - center.x) <= halfSize.x &&
           Math.abs(point.y - center.y) <= halfSize.y &&
           Math.abs(point.z - center.z) <= halfSize.z;
}

// Handle drawing and erasing
scene.onPointerObservable.add((pointerInfo) => {
    if (!coloredMesh) return;

    const handleDrawing = (pickResult) => {
        if (pickResult.hit) {
            const pickedPoint = pickResult.pickedPoint;

            const positions = coloredMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const indices = coloredMesh.getIndices();
            let colors = coloredMesh.getVerticesData(BABYLON.VertexBuffer.ColorKind);

            // Color the picked face
            const drawColor = [1, 0, 0, 1]; // Red
            const eraseColor = [0.5, 0.5, 0.5, 1]; // Gray
            const targetColor = mode === 'draw' ? drawColor : eraseColor;
            
            const radius = 1; // Radius around the picked point to color
            const radiusSquared = radius * radius;

            // Function to color a face
            const colorFace = (index, color) => {
                for (let i = 0; i < 3; i++) {
                    const vertexIndex = indices[index * 3 + i];
                    colors[vertexIndex * 4] = color[0]; // R
                    colors[vertexIndex * 4 + 1] = color[1]; // G
                    colors[vertexIndex * 4 + 2] = color[2]; // B
                    colors[vertexIndex * 4 + 3] = color[3]; // A
                }
            };

            // Color faces within the radius
            for (let i = 0; i < indices.length; i += 3) {
                const bbox = getBoundingBox(positions, indices, i / 3);

                if (isPointInBoundingBox(pickedPoint, bbox)) {
                    const p1 = BABYLON.Vector3.FromArray(positions, indices[i] * 3);
                    const p2 = BABYLON.Vector3.FromArray(positions, indices[i + 1] * 3);
                    const p3 = BABYLON.Vector3.FromArray(positions, indices[i + 2] * 3);

                    // Check if any vertex of the face is within the radius
                    if (BABYLON.Vector3.DistanceSquared(p1, pickedPoint) <= radiusSquared ||
                        BABYLON.Vector3.DistanceSquared(p2, pickedPoint) <= radiusSquared ||
                        BABYLON.Vector3.DistanceSquared(p3, pickedPoint) <= radiusSquared) {
                        colorFace(i / 3, targetColor);
                    }
                }
            }

            // Update the colors data in the mesh
            coloredMesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
        }
    };

    switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
            if (mode === 'draw' || mode === 'erase') {
                isDrawing = true;
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                handleDrawing(pickResult);
            }
            break;

        case BABYLON.PointerEventTypes.POINTERMOVE:
            if (isDrawing && (mode === 'draw' || mode === 'erase')) {
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                handleDrawing(pickResult);
            }
            break;

        case BABYLON.PointerEventTypes.POINTERUP:
            if (isDrawing) {
                isDrawing = false;
            }
            break;
    }
});

// Export Annotations
document.getElementById('exportAnnotations').addEventListener('click', () => {
    // Implement export functionality
});

engine.runRenderLoop(() => {
    scene.render();
});

// Resize the canvas when the window is resized
window.addEventListener('resize', () => {
    engine.resize();
});
