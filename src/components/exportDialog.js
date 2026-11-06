import { PLY_EXPORT_PRESETS, plyPresetName } from '../loaders/meshExporter.js';

/**
 * ExportDialog - choose what goes into an exported annotation PLY.
 *
 * Presets fill the option toggles; editing a toggle turns the selection into
 * a custom one. The last-used options are remembered in UserConfig.
 */
export class ExportDialog {
    /**
     * @param {UserConfig} [userConfig=null]
     */
    constructor(userConfig = null) {
        this.userConfig = userConfig;
        this.modal = document.getElementById('exportPlyModal');
        this.presetButtons = [...document.querySelectorAll('#exportPlyPresets [data-preset]')];
        this.toggles = [...document.querySelectorAll('#exportPlyModal [data-export-option]')];
        this._resolve = null;

        this.presetButtons.forEach(btn => btn.addEventListener('click', () => {
            this._setOptions(PLY_EXPORT_PRESETS[btn.dataset.preset]);
        }));
        this.toggles.forEach(t => t.addEventListener('change', () => this._updatePresetButtons()));

        document.getElementById('exportPlyConfirmBtn')?.addEventListener('click', () => this._close(this._getOptions()));
        document.getElementById('exportPlyCancelBtn')?.addEventListener('click', () => this._close(null));
        document.getElementById('exportPlyModalClose')?.addEventListener('click', () => this._close(null));
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this._close(null);
        });
        this.modal?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._close(this._getOptions()); }
            if (e.key === 'Escape') this._close(null);
        });
    }

    /**
     * Show the dialog.
     * @returns {Promise<Object|null>} Chosen options, or null if cancelled
     */
    open() {
        if (!this.modal) return Promise.resolve({ ...PLY_EXPORT_PRESETS.neurolithic });
        if (this._resolve) this._close(null);
        const saved = this.userConfig?.getSection('export')?.plyOptions;
        this._setOptions(saved || PLY_EXPORT_PRESETS.neurolithic);
        this.modal.style.display = 'flex';
        document.getElementById('exportPlyConfirmBtn')?.focus();
        return new Promise(resolve => { this._resolve = resolve; });
    }

    _close(options) {
        if (this.modal) this.modal.style.display = 'none';
        if (options) this.userConfig?.setSection('export', { plyOptions: options });
        const resolve = this._resolve;
        this._resolve = null;
        resolve?.(options);
    }

    _getOptions() {
        const options = {};
        this.toggles.forEach(t => { options[t.dataset.exportOption] = t.checked; });
        return options;
    }

    _setOptions(options) {
        this.toggles.forEach(t => { t.checked = !!options[t.dataset.exportOption]; });
        this._updatePresetButtons();
    }

    _updatePresetButtons() {
        const preset = plyPresetName(this._getOptions());
        this.presetButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.preset === preset));
    }
}
