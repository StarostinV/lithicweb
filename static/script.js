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
let meshgrid;
let drawMode = false;
let eraseMode = false;

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

    const wireframe = BABYLON.MeshBuilder.CreateLineSystem("wireframe", {lines: lines}, scene);
    wireframe.color = new BABYLON.Color3(0.5, 0.5, 0.5);
    if (meshgrid) meshgrid.dispose();  // Dispose previous mesh if any
    meshgrid = wireframe;
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

            // Enable backface culling
            mesh.material = new BABYLON.StandardMaterial("meshMaterial", scene);
            mesh.material.backFaceCulling = true;

            // Standardize the mesh
            standardizeMesh(mesh);

            // Create wireframe
            createWireframe(mesh, scene);
        };
        reader.readAsArrayBuffer(file);
    }
});

// Function to standardize the mesh
function standardizeMesh(mesh) {
    // console.log("Standardizing mesh");

    // Get vertex positions
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
    console.log("center of mass: ", center);

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
    drawMode = true;
    eraseMode = false;
    camera.detachControl(canvas);
});

// Toggle Erase Mode
document.getElementById('eraseMode').addEventListener('click', () => {
    drawMode = false;
    eraseMode = true;
    camera.detachControl(canvas);
});

// Handle drawing and erasing
scene.onPointerObservable.add((pointerInfo) => {
    if (!mesh) return;
    switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
            if (drawMode) {
                // Implement drawing on mesh
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                if (pickResult.hit) {
                    const pickedPoint = pickResult.pickedPoint;
                    const sphere = BABYLON.MeshBuilder.CreateSphere("sphere", {diameter: 0.05}, scene);
                    sphere.position = pickedPoint;
                    sphere.material = new BABYLON.StandardMaterial("sphereMat", scene);
                    sphere.material.diffuseColor = new BABYLON.Color3(1, 0, 0);
                }
            } else if (eraseMode) {
                // Implement erasing on mesh
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                if (pickResult.hit) {
                    const pickedPoint = pickResult.pickedPoint;
                    // Add erasing logic here
                }
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
