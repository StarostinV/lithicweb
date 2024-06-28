import { createCamera } from './components/camera.js';
import { createKDTree } from './components/kdTree.js';
import { exportAnnotations } from './loaders/meshExporter.js';
import { handleModeSwitch, handleDrawing, updateButtonStates } from './components/modeHandlers.js';
import CustomPLYLoader from './loaders/customPLYLoader.js';
import { standardizePositions } from './utils/standardizePositions.js';
import { updateLightDirection } from './utils/updateLight.js';
import * as THREE from 'three';

const canvas = document.getElementById("renderCanvas");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setClearColor(0xD3D3D3); // Set the background color of the canvas to light gray
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // You can use other types too

// document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(20, 20, 20); // Position of the light source
light.castShadow = true; // Enable shadow casting
light.shadow.mapSize.width = 1024; // Shadow texture width
light.shadow.mapSize.height = 1024; // Shadow texture height
light.shadow.camera.near = 0.5; // Near plane of the shadow camera
light.shadow.camera.far = 500; // Far plane of the shadow camera
light.shadow.camera.left = -200; // Left bound of the light's view frustum
light.shadow.camera.right = 200; // Right bound of the light's view frustum
light.shadow.camera.top = 200; // Top bound of the light's view frustum
light.shadow.camera.bottom = -200; // Bottom bound of the light's view frustum
scene.add(light);

const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

const camera = createCamera(scene, canvas);

const ambientLight = new THREE.AmbientLight(0x0c0c0c);
scene.add(ambientLight);

// const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
// light.position.set(1, 1, 0);
// scene.add(light);

// Add additional light for better visibility
// const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
// directionalLight.position.set(0, 10, 10).normalize();
// scene.add(directionalLight);

let mesh, meshColors, kdtree, mode = 'view', prevMode = 'view', isDrawing = false;

document.getElementById('updateLight').addEventListener('click', () => updateLightDirection(camera, light));

document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const data = event.target.result;
            console.log(data);
            const loader = new CustomPLYLoader();
            const geometry = loader.parse(data);

            console.log(geometry);

            let positions = geometry.attributes.position.array;
            positions = standardizePositions(positions); // Apply standardization
            const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
            const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);

            // Ensure indices define polygons correctly
            for (let i = 0; i < indices.length; i += 3) {
                let temp = indices[i + 1];
                indices[i + 1] = indices[i + 2];
                indices[i + 2] = temp;
            }

            // Remove existing mesh if it exists
            if (mesh) {
                scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }

            // Create new BufferGeometry and set attributes
            const standardizedGeometry = new THREE.BufferGeometry();
            standardizedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            standardizedGeometry.setIndex(indices);

            meshColors = new Float32Array((positions.length / 3) * 4);
            if (labels.length) {
                for (let i = 0; i < meshColors.length; i += 4) {
                    if (labels[Math.floor(i / 4)] === 1) {
                        meshColors[i] = drawColor.r;
                        meshColors[i + 1] = drawColor.g;
                        meshColors[i + 2] = drawColor.b;
                        meshColors[i + 3] = 1.0;
                    } else {
                        meshColors[i] = objectColor.r;
                        meshColors[i + 1] = objectColor.g;
                        meshColors[i + 2] = objectColor.b;
                        meshColors[i + 3] = 1.0;
                    }
                }
            } else {
                for (let i = 0; i < meshColors.length; i += 4) {
                    meshColors[i] = objectColor.r;
                    meshColors[i + 1] = objectColor.g;
                    meshColors[i + 2] = objectColor.b;
                    meshColors[i + 3] = 1.0;
                }
            }

            console.log(meshColors);

            // Set color attribute
            // standardizedGeometry.setAttribute('color', new THREE.BufferAttribute(meshColors, 4));

            let material = new THREE.MeshPhongMaterial({
                color: objectColor,
                shininess: 30, // Adjust shininess to see the specular highlights
                specular: 0x333333, // Add some specular highlights
                side: THREE.DoubleSide,
            });

            console.log("material", material);

            // Create mesh with the new geometry and material
            mesh = new THREE.Mesh(standardizedGeometry, material);

            mesh.castShadow = true; // Enable shadow casting for this object
            mesh.receiveShadow = true; // Enable shadow receiving for this object
            light.target = mesh;


            scene.add(mesh);
            console.log(mesh);

            kdtree = createKDTree(positions);
        };
        reader.readAsArrayBuffer(file);
    }
});

['view', 'draw', 'erase'].forEach(modeType => {
    document.getElementById(`${modeType}Mode`).addEventListener('click', (event) => {
        [mode, prevMode] = handleModeSwitch(event, mode, prevMode, camera, canvas);
    });
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(mesh, meshColors);
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener('pointerdown', (event) => {
    if (!mesh) return;

    mouse.x = (event.clientX / canvas.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / canvas.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(mesh);

    if (intersects.length > 0 && (mode === 'draw' || mode === 'erase')) {
        isDrawing = true;
        handleDrawing(intersects[0], mode, kdtree, mesh, meshColors, drawColor, objectColor);
    } else if (event.button === 2 && (mode === 'draw' || mode === 'erase')) {
        prevMode = mode;
        mode = 'view';
        camera.controls.enabled = true;
        updateButtonStates(mode);
    }
});

canvas.addEventListener('pointermove', (event) => {
    if (!mesh || !isDrawing) return;

    mouse.x = (event.clientX / canvas.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / canvas.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(mesh);
    if (intersects.length > 0 && (mode === 'draw' || mode === 'erase')) {
        handleDrawing(intersects[0], mode, kdtree, mesh, meshColors, drawColor, objectColor);
    }
});

canvas.addEventListener('pointerup', () => {
    isDrawing = false;
});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        if (mode === 'draw' || mode === 'erase') {
            prevMode = mode;
            mode = 'view';
            camera.controls.enabled = true;
            updateButtonStates(mode);
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode = prevMode;
        if (mode !== 'view') {
            camera.controls.enabled = false;
            updateButtonStates(mode);
        }
    }
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
