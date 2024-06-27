export function updateButtonStates(mode) {
    const buttons = document.querySelectorAll('.toggle-button');
    buttons.forEach(button => {
        button.classList.remove('bg-blue-500', 'text-white');
        if (button.id === `${mode}Mode`) {
            button.classList.add('bg-blue-500', 'text-white');
        } else {
            button.classList.add('bg-gray-300', 'text-gray-700');
        }
    });
    updateCursor(mode);
}

function updateCursor(mode) {
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

export function handleModeSwitch(event, mode, prevMode, camera, canvas) {
    if (mode !== event.target.id.replace('Mode', '')) {
        mode = event.target.id.replace('Mode', '');
        prevMode = mode; // when we click the button, we forget about the prev mode
        console.log(`Switched to ${mode} mode`);
        if (mode === 'view') {
            camera.attachControl(canvas, true);
        } else {
            camera.detachControl(canvas);
        }
        updateButtonStates(mode);
    }
    return [mode, prevMode];
}

export function handleDrawing(pickResult, mode, kdtree, mesh, meshColors, drawColor, objectColor) {
    if (pickResult.hit) {
        const pickedPoint = pickResult.pickedPoint;

        // Color the picked vertex
        const targetColor = mode === 'draw' ? drawColor : objectColor;

        // Find the closest vertex using KD-Tree
        const nearest = kdtree.nearest({
            x: pickedPoint.x,
            y: pickedPoint.y,
            z: pickedPoint.z
        }, 1)[0];

        const closestVertexIndex = nearest[0].index;

        // Color the closest vertex
        if (closestVertexIndex !== -1) {
            colorVertex(closestVertexIndex, targetColor, meshColors);
        }

        // Update the colors data in the mesh
        mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, meshColors);
    }
}

function colorVertex(vertexIndex, color, meshColors) {
    meshColors[vertexIndex * 4] = color[0]; // R
    meshColors[vertexIndex * 4 + 1] = color[1]; // G
    meshColors[vertexIndex * 4 + 2] = color[2]; // B
    meshColors[vertexIndex * 4 + 3] = color[3]; // A
}
