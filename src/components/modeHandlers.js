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
