import { createCamera } from './components/camera.js';
import { createKDTree } from './components/kdTree.js';
import { exportAnnotations } from './loaders/meshExporter.js';
import { handleModeSwitch, handleDrawing, updateButtonStates } from './components/modeHandlers.js';
import CustomPLYLoader from './loaders/customPLYLoader.js';
import { standardizePositions } from './utils/standardizePositions.js';
import { updateLightDirection } from './utils/updateLight.js';

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

const drawColor = [1, 0.6, 0.2, 1]; // Orange
const objectColor = [0.5, 0.5, 0.5, 1]; // Gray

const camera = createCamera(scene, canvas);
const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0), scene);

let mesh, meshColors, kdtree, mode = 'view', prevMode = 'view', isDrawing = false;

document.getElementById('updateLight').addEventListener('click', () => updateLightDirection(camera, light));

document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
            const data = event.target.result;
            const loader = new CustomPLYLoader();
            const geometry = loader.parse(data);

            const positions = geometry.attributes.position.array;
            const labels = geometry.attributes.labels ? geometry.attributes.labels.array : [];
            let indices = Array.from({ length: geometry.index.count }, (_, i) => geometry.index.array[i]);

            for (let i = 0; i < indices.length; i += 3) {
                let temp = indices[i + 1];
                indices[i + 1] = indices[i + 2];
                indices[i + 2] = temp;
            }

            const babylonMesh = new BABYLON.Mesh("mesh", scene);
            const vertexData = new BABYLON.VertexData();
            vertexData.positions = standardizePositions(positions);
            vertexData.indices = indices;

            BABYLON.VertexData.ComputeNormals(vertexData.positions, vertexData.indices, vertexData.normals = []);
            vertexData.applyToMesh(babylonMesh);

            if (mesh) mesh.dispose();
            mesh = babylonMesh;
            mesh.material = new BABYLON.StandardMaterial("meshMaterial", scene);
            mesh.material.backFaceCulling = true;
            mesh.material.vertexColorsEnabled = true;

            meshColors = new Float32Array((positions.length / 3) * 4);
            if (labels) {
                for (let i = 0; i < meshColors.length; i += 4) {
                    if (labels[Math.floor(i / 4)] === 1) {
                        meshColors[i] = drawColor[0];
                        meshColors[i + 1] = drawColor[1];
                        meshColors[i + 2] = drawColor[2];
                        meshColors[i + 3] = drawColor[3];
                    } else {
                        meshColors[i] = objectColor[0];
                        meshColors[i + 1] = objectColor[1];
                        meshColors[i + 2] = objectColor[2];
                        meshColors[i + 3] = objectColor[3];
                    }
                }
            } else {
                for (let i = 0; i < meshColors.length; i += 4) {
                    meshColors[i] = objectColor[0];
                    meshColors[i + 1] = objectColor[1];
                    meshColors[i + 2] = objectColor[2];
                    meshColors[i + 3] = objectColor[3];
                }
            }

            mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, meshColors, true);

            const material = new BABYLON.StandardMaterial("meshMaterial", scene);
            material.backFaceCulling = true;
            material.vertexColorsEnabled = true;
            material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            mesh.material = material;

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

scene.onPointerObservable.add((pointerInfo) => {
    if (!mesh) return;

    switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
            if (pointerInfo.event.button === 0 && (mode === 'draw' || mode === 'erase')) {
                isDrawing = true;
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                handleDrawing(pickResult, mode, kdtree, mesh, meshColors, drawColor, objectColor);
            } else if (pointerInfo.event.button === 2 && (mode === 'draw' || mode === 'erase')) {
                prevMode = mode;
                mode = 'view';
                camera.attachControl(canvas, true);
                updateButtonStates(mode);
            }
            break;
        case BABYLON.PointerEventTypes.POINTERMOVE:
            if (isDrawing && (mode === 'draw' || mode === 'erase')) {
                const pickResult = scene.pick(scene.pointerX, scene.pointerY);
                handleDrawing(pickResult, mode, kdtree, mesh, meshColors, drawColor, objectColor);
            }
            break;
        case BABYLON.PointerEventTypes.POINTERUP:
            if (pointerInfo.event.button === 0 && isDrawing) {
                isDrawing = false;
            } else if (pointerInfo.event.button === 2) {
                mode = prevMode;
                if (mode !== 'view') {
                    camera.detachControl(canvas);
                    updateButtonStates(mode);
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
            updateButtonStates(mode);
        }
    }
});

window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' || event.key === 'Control') {
        mode = prevMode;
        if (mode !== 'view') {
            camera.detachControl(canvas);
            updateButtonStates(mode);
        }
    }
});

engine.runRenderLoop(() => {
    scene.render();
});

window.addEventListener('resize', () => {
    engine.resize();
});
