import { exportAnnotations } from './loaders/meshExporter.js';
import { handleModeSwitch, handleDrawing, updateButtonStates } from './components/modeHandlers.js';
import CustomPLYLoader from './loaders/customPLYLoader.js';
import { standardizePositions } from './utils/standardizePositions.js';
import { updateLightDirection } from './utils/updateLight.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { ClosestVertexFinder } from './geometry/intersections.js';

// Accelerate raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;

//colors
const drawColor = new THREE.Color(1, 0.6, 0.2); // Orange
const objectColor = new THREE.Color(0.5, 0.5, 0.5); // Gray

// renderer
const canvas = document.getElementById("renderCanvas");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setClearColor(0x201944); // Set the background color of the canvas to light gray
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // You can use other types too
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('contextmenu', function(event) {
    event.preventDefault();
});

// scene
const scene = new THREE.Scene();

// camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(30, 30, 30);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.update();
controls.zoomSpeed = 1.2;


// light
const light = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
light.position.set(0, 20, 0); // Position of the light source
scene.add(light);

const ambientLight = new THREE.AmbientLight(0x0c0c0c, 1);
scene.add(ambientLight);


// variables
let mesh, meshColors, mode = 'view', prevMode = 'view', isDrawing = false;

document.getElementById('updateLight').addEventListener('click', () => updateLightDirection(camera, light));

document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const data = event.target.result;

            const loader = new CustomPLYLoader();
            const geometry = loader.parse(data);

            let positions = geometry.attributes.position.array;
            positions = standardizePositions(positions); // Apply standardization
            const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
            const indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);

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
            standardizedGeometry.computeVertexNormals();

            meshColors = new Float32Array(positions.length);
            if (labels.length > 0) {
                for (let i = 0; i < labels.length; i++) {
                    if (labels[i] === 1) {
                        meshColors[i * 3] = drawColor.r;
                        meshColors[i * 3 + 1] = drawColor.g;
                        meshColors[i * 3 + 2] = drawColor.b;
                    } else {
                        meshColors[i * 3] = objectColor.r;
                        meshColors[i * 3 + 1] = objectColor.g;
                        meshColors[i * 3 + 2] = objectColor.b;
                    }
                }
            } else {
                for (let i = 0; i < meshColors.length; i += 3) {
                    meshColors[i] = objectColor.r;
                    meshColors[i + 1] = objectColor.g;
                    meshColors[i + 2] = objectColor.b;
                }
            }


            standardizedGeometry.setAttribute('color', new THREE.BufferAttribute(meshColors, 3));

            let material = new THREE.MeshPhongMaterial({
                // color: objectColor,
                shininess: 100, // Adjust shininess to see the specular highlights
                vertexColors: true, // Enable per-vertex coloring
            });

            // Create mesh with the new geometry and material
            mesh = new THREE.Mesh(standardizedGeometry, material);

            mesh.castShadow = true; // Enable shadow casting for this object
            mesh.receiveShadow = true; // Enable shadow receiving for this object
            light.target = mesh;

            const bvh = new MeshBVH(standardizedGeometry);
            standardizedGeometry.boundsTree = bvh;

            scene.add(mesh);

        };
        reader.readAsArrayBuffer(file);
    }
});

['view', 'draw', 'erase'].forEach(modeType => {
    document.getElementById(`${modeType}Mode`).addEventListener('click', (event) => {
        console.log("button clicked");
        [mode, prevMode] = handleModeSwitch(event, mode, prevMode, controls);
    });
});

document.getElementById('exportAnnotations').addEventListener('click', () => {
    exportAnnotations(mesh, meshColors);
});

const closestVertexFinder = new ClosestVertexFinder(camera, canvas);

canvas.addEventListener('pointerdown', (event) => {
    if (!mesh) return;

    if (event.button === 0 && (mode === 'draw' || mode === 'erase')) {    
        const closestVertexIndex = closestVertexFinder.findClosestVertex(mesh, event);
    
        if (closestVertexIndex !== -1) {
            isDrawing = true;
            handleDrawing(closestVertexIndex, mode, mesh, meshColors, drawColor, objectColor);
        }
    } else if (event.button === 2 && (mode === 'draw' || mode === 'erase')) {
        prevMode = mode;
        mode = 'view';
        controls.enabled = true;
        console.log(`Switched to ${mode} mode. prevMode=`, prevMode);
        updateButtonStates(mode);
    }
});

canvas.addEventListener('pointermove', (event) => {
    if (!mesh || !isDrawing || mode === 'view') return;

    const closestVertexIndex = closestVertexFinder.findClosestVertex(mesh, event);
    
    if (closestVertexIndex !== -1) {
        handleDrawing(closestVertexIndex, mode, mesh, meshColors, drawColor, objectColor);
    }
});

canvas.addEventListener('pointerup', (event) => {
    isDrawing = false;

    if (event.button === 2 && mode === 'view') {
        mode = prevMode;
    }

    if (mode !== 'view') {
        controls.enabled = false;
        updateButtonStates(mode);
    }

});

window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        if (mode === 'draw' || mode === 'erase') {
            prevMode = mode;
            mode = 'view';
            controls.enabled = true;
            updateButtonStates(mode);
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode = prevMode;
        if (mode !== 'view') {
            controls.enabled = false;
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
