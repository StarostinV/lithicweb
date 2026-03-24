/**
 * Reusable utility for checking unsaved changes before loading a new annotation.
 *
 * Shows a modal dialog with three options:
 * - Cancel: abort the load
 * - Load: discard changes and proceed
 * - Save Current: save current annotation first, then proceed
 *
 * @module confirmUnsavedChanges
 */

// Modal DOM elements (cached on first use)
let modal, closeBtn, cancelBtn, loadBtn, saveBtn;
let _resolve = null;

function ensureElements() {
    if (modal) return;
    modal = document.getElementById('unsavedChangesModal');
    closeBtn = document.getElementById('unsavedChangesModalClose');
    cancelBtn = document.getElementById('unsavedChangesCancelBtn');
    loadBtn = document.getElementById('unsavedChangesLoadBtn');
    saveBtn = document.getElementById('unsavedChangesSaveBtn');

    const dismiss = (result) => {
        modal.style.display = 'none';
        if (_resolve) {
            const r = _resolve;
            _resolve = null;
            r(result);
        }
    };

    closeBtn?.addEventListener('click', () => dismiss('cancel'));
    cancelBtn?.addEventListener('click', () => dismiss('cancel'));
    loadBtn?.addEventListener('click', () => dismiss('load'));
    saveBtn?.addEventListener('click', () => dismiss('save'));
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) dismiss('cancel');
    });
}

/**
 * Check for unsaved changes and prompt the user if needed.
 *
 * @param {MeshView} meshView - The mesh view to check for unsaved changes
 * @returns {Promise<'load'|'save'|'cancel'>}
 *   - 'load': proceed with loading (no unsaved changes, or user chose to discard)
 *   - 'save': user wants to save current annotation first, then load
 *   - 'cancel': user cancelled the operation
 */
export function confirmUnsavedChanges(meshView) {
    // No unsaved changes — proceed immediately
    if (!meshView.hasUnsavedChanges()) {
        return Promise.resolve('load');
    }

    ensureElements();

    return new Promise((resolve) => {
        _resolve = resolve;
        modal.style.display = 'flex';
    });
}
