/**
 * Export dialog: presets fill the toggles, edits become custom, the choice is
 * remembered, cancel returns null.
 */
import { ExportDialog } from '../../../src/components/exportDialog.js';
import { PLY_EXPORT_PRESETS } from '../../../src/loaders/meshExporter.js';

function setupDom() {
    const opts = ['labels', 'arrows', 'metadata', 'colors', 'quality']
        .map(o => `<input type="checkbox" data-export-option="${o}">`).join('');
    document.body.innerHTML = `
        <div id="exportPlyModal" class="modal">
            <div id="exportPlyPresets">
                <button data-preset="neurolithic"></button><button data-preset="meshlab"></button>
            </div>
            ${opts}
            <button id="exportPlyCancelBtn"></button><button id="exportPlyConfirmBtn"></button>
            <button id="exportPlyModalClose"></button>
        </div>`;
}

function fakeConfig() {
    const store = {};
    return { getSection: (s) => store[s], setSection: (s, v) => { store[s] = { ...store[s], ...v }; } };
}

const click = (sel) => document.querySelector(sel).click();
const active = () => [...document.querySelectorAll('[data-preset].active')].map(b => b.dataset.preset);

test('defaults to neurolithic, switches preset, remembers the choice', async () => {
    setupDom();
    const config = fakeConfig();
    const dialog = new ExportDialog(config);

    let p = dialog.open();
    expect(active()).toEqual(['neurolithic']);
    click('[data-preset="meshlab"]');
    expect(active()).toEqual(['meshlab']);
    click('#exportPlyConfirmBtn');
    expect(await p).toEqual(PLY_EXPORT_PRESETS.meshlab);

    p = dialog.open();
    expect(active()).toEqual(['meshlab']);
    const quality = document.querySelector('[data-export-option="quality"]');
    quality.checked = true;
    quality.dispatchEvent(new Event('change'));
    expect(active()).toEqual([]);   // custom
    click('#exportPlyCancelBtn');
    expect(await p).toBeNull();

    // Cancel does not overwrite the remembered options
    p = dialog.open();
    expect(active()).toEqual(['meshlab']);
    click('#exportPlyModalClose');
    expect(await p).toBeNull();
});
