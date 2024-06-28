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
    if (mode == 'view' || mode == 'arrow') {
        body.classList.add('view-cursor');
    } else if (mode == 'draw') {
        body.classList.add('draw-cursor');
    } else if (mode == 'erase') {
        body.classList.add('erase-cursor');
    }
}

export function handleModeSwitch(event, mode, controls) {
    if (mode !== event.target.id.replace('Mode', '')) {
        mode.setMode(event.target.id.replace('Mode', ''), true);
        if (mode == 'view') {
            controls.enabled = true;
        } else {
            controls.enabled = false;
        }
        console.log("handleModeSwitch", mode);
        updateButtonStates(mode);
    }
}

export function handleDrawing(closestVertexIndex, mode, mesh, meshColors, drawColor, objectColor) {
    // Color the picked vertex
    const targetColor = mode == 'draw' ? drawColor : objectColor;

    // Color the closest vertex
    if (closestVertexIndex !== -1) {
        colorVertex(closestVertexIndex, targetColor, meshColors);
    }

    // Update the colors data in the mesh
    mesh.geometry.attributes.color.needsUpdate = true;
}

function colorVertex(vertexIndex, color, meshColors) {
    meshColors[vertexIndex * 3] = color.r; // R
    meshColors[vertexIndex * 3 + 1] = color.g; // G
    meshColors[vertexIndex * 3 + 2] = color.b; // B
}
