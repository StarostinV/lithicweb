/**
 * @fileoverview Unit tests for the confirmUnsavedChanges utility.
 *
 * Tests the modal-based confirmation flow for unsaved annotation changes.
 * Uses JSDOM mocking for modal elements.
 *
 * Note: The module caches DOM element references on first call, so we set up
 * DOM once before all tests and reuse the same elements throughout.
 *
 * @see src/utils/confirmUnsavedChanges.js
 */

// Set up DOM elements ONCE before the module is imported
document.body.innerHTML = `
    <div id="unsavedChangesModal" style="display: none;">
        <button id="unsavedChangesModalClose"></button>
        <button id="unsavedChangesCancelBtn"></button>
        <button id="unsavedChangesLoadBtn"></button>
        <button id="unsavedChangesSaveBtn"></button>
    </div>
`;

let confirmUnsavedChanges;
let modal;

beforeAll(async () => {
    const mod = await import('../../../src/utils/confirmUnsavedChanges.js');
    confirmUnsavedChanges = mod.confirmUnsavedChanges;
    modal = document.getElementById('unsavedChangesModal');
});

beforeEach(() => {
    // Reset modal visibility between tests
    modal.style.display = 'none';
});

describe('confirmUnsavedChanges', () => {
    /**
     * @test When no unsaved changes, resolves immediately with 'load'
     */
    test('should resolve immediately with "load" when no unsaved changes', async () => {
        const meshView = { hasUnsavedChanges: () => false };

        const result = await confirmUnsavedChanges(meshView);
        expect(result).toBe('load');
        // Modal should NOT have been shown
        expect(modal.style.display).toBe('none');
    });

    /**
     * @test When unsaved changes exist and user clicks Load, resolves with 'load'
     */
    test('should resolve with "load" when user clicks Load button', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        const promise = confirmUnsavedChanges(meshView);
        expect(modal.style.display).toBe('flex');

        document.getElementById('unsavedChangesLoadBtn').click();

        const result = await promise;
        expect(result).toBe('load');
        expect(modal.style.display).toBe('none');
    });

    /**
     * @test When unsaved changes exist and user clicks Save Current, resolves with 'save'
     */
    test('should resolve with "save" when user clicks Save Current button', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        const promise = confirmUnsavedChanges(meshView);
        expect(modal.style.display).toBe('flex');

        document.getElementById('unsavedChangesSaveBtn').click();

        const result = await promise;
        expect(result).toBe('save');
        expect(modal.style.display).toBe('none');
    });

    /**
     * @test When unsaved changes exist and user clicks Cancel, resolves with 'cancel'
     */
    test('should resolve with "cancel" when user clicks Cancel button', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        const promise = confirmUnsavedChanges(meshView);
        document.getElementById('unsavedChangesCancelBtn').click();

        const result = await promise;
        expect(result).toBe('cancel');
        expect(modal.style.display).toBe('none');
    });

    /**
     * @test When unsaved changes exist and user clicks modal close button, resolves with 'cancel'
     */
    test('should resolve with "cancel" when user clicks close button', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        const promise = confirmUnsavedChanges(meshView);
        document.getElementById('unsavedChangesModalClose').click();

        const result = await promise;
        expect(result).toBe('cancel');
    });

    /**
     * @test Clicking backdrop (the modal element itself) dismisses with 'cancel'
     */
    test('should resolve with "cancel" when user clicks backdrop', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        const promise = confirmUnsavedChanges(meshView);

        // Simulate clicking the modal backdrop (target === modal)
        const event = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(event, 'target', { value: modal });
        modal.dispatchEvent(event);

        const result = await promise;
        expect(result).toBe('cancel');
    });

    /**
     * @test Multiple sequential calls work correctly
     */
    test('should handle sequential calls after previous resolution', async () => {
        const meshView = { hasUnsavedChanges: () => true };

        // First call — cancel
        const p1 = confirmUnsavedChanges(meshView);
        document.getElementById('unsavedChangesCancelBtn').click();
        expect(await p1).toBe('cancel');

        // Second call — load
        const p2 = confirmUnsavedChanges(meshView);
        document.getElementById('unsavedChangesLoadBtn').click();
        expect(await p2).toBe('load');

        // Third call — save
        const p3 = confirmUnsavedChanges(meshView);
        document.getElementById('unsavedChangesSaveBtn').click();
        expect(await p3).toBe('save');
    });
});
