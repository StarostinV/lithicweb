/**
 * SettingsPanel - Manages the settings panel UI and functionality.
 * 
 * Features:
 * - Display current rendering and lighting settings summary
 * - Export/import settings to/from JSON file
 * - Reset all settings to defaults
 * - Clear local storage
 * 
 * ## Event Bus Integration
 * 
 * Subscribes to:
 * - `Events.CONFIG_CHANGED` - Updates settings summary when config changes
 */

import { eventBus, Events } from '../utils/EventBus.js';
import { normalizeLightingPreset } from '../utils/lightingPresets.js';

export class SettingsPanel {
    /**
     * Create a SettingsPanel instance.
     * @param {UserConfig} userConfig - User configuration manager
     * @param {RenderingPanel} renderingPanel - Rendering panel for reloading settings
     */
    constructor(userConfig, renderingPanel) {
        this.userConfig = userConfig;
        this.renderingPanel = renderingPanel;
        
        this.initControls();
        this.initConfigListener();
    }
    
    /**
     * Initialize settings panel controls and event listeners.
     */
    initControls() {
        // Export settings button
        const exportBtn = document.getElementById('exportSettingsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportSettings());
        }
        
        // Import settings input
        const importInput = document.getElementById('importSettingsInput');
        if (importInput) {
            importInput.addEventListener('change', (e) => this.importSettings(e));
        }
        
        // Reset all settings button
        const resetBtn = document.getElementById('resetAllSettingsBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetAllSettings());
        }
        
        // Clear local storage button
        const clearBtn = document.getElementById('clearStorageBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearLocalStorage());
        }

        // Units selectors
        const displayUnitSelect = document.getElementById('displayUnitSelect');
        if (displayUnitSelect) {
            displayUnitSelect.value = this.userConfig.get('units.displayUnit') || 'auto';
            displayUnitSelect.addEventListener('change', (e) => {
                this.userConfig.set('units.displayUnit', e.target.value);
            });
        }

        const defaultSourceUnitSelect = document.getElementById('defaultSourceUnitSelect');
        if (defaultSourceUnitSelect) {
            defaultSourceUnitSelect.value = this.userConfig.get('units.defaultSourceUnit') || 'mm';
            defaultSourceUnitSelect.addEventListener('change', (e) => {
                this.userConfig.set('units.defaultSourceUnit', e.target.value);
            });
        }
    }
    
    /**
     * Initialize config change listener to auto-update summary when visible.
     * Uses EventBus for subscription.
     */
    initConfigListener() {
        eventBus.on(Events.CONFIG_CHANGED, () => {
            // Only update if settings panel is visible
            const settingsPanel = document.getElementById('settingsPanel');
            if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
                this.updateSettingsSummary();
            }
        }, 'settingsPanel');
    }
    
    /**
     * Clean up resources and EventBus subscriptions.
     * Call this when the panel is being destroyed.
     */
    dispose() {
        eventBus.offNamespace('settingsPanel');
    }
    
    /**
     * Update the settings summary display in the Settings panel.
     */
    updateSettingsSummary() {
        const renderingConfig = this.userConfig.getSection('rendering');
        const lightingConfig = this.userConfig.getSection('lighting');
        
        const renderingSummaryEl = document.getElementById('renderingSettingsSummary');
        const lightingSummaryEl = document.getElementById('lightingSettingsSummary');
        
        if (renderingSummaryEl) {
            renderingSummaryEl.innerHTML = `
                <div class="settings-item">
                    <span class="settings-item-key">Annotation Mode</span>
                    <span class="settings-item-value">${renderingConfig.annotationMode}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Material</span>
                    <span class="settings-item-value">${renderingConfig.materialType}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Wireframe</span>
                    <span class="settings-item-value">${renderingConfig.wireframeMode ? 'On' : 'Off'}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Flat Shading</span>
                    <span class="settings-item-value">${renderingConfig.flatShading ? 'On' : 'Off'}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Background</span>
                    <span class="settings-item-value">
                        <span class="settings-item-color" style="background-color: ${renderingConfig.backgroundColor}"></span>
                        ${renderingConfig.backgroundColor}
                    </span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Edge Color</span>
                    <span class="settings-item-value">
                        <span class="settings-item-color" style="background-color: ${renderingConfig.edgeColor}"></span>
                        ${renderingConfig.edgeColor}
                    </span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Object Color</span>
                    <span class="settings-item-value">
                        <span class="settings-item-color" style="background-color: ${renderingConfig.objectColor}"></span>
                        ${renderingConfig.objectColor}
                    </span>
                </div>
            `;
        }
        
        if (lightingSummaryEl) {
            lightingSummaryEl.innerHTML = `
                <div class="settings-item">
                    <span class="settings-item-key">Preset</span>
                    <span class="settings-item-value">${normalizeLightingPreset(lightingConfig.currentLightingPreset || 'default')}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Key Light</span>
                    <span class="settings-item-value">${lightingConfig.keyLightIntensity?.toFixed(1) || '2.0'}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Fill Light</span>
                    <span class="settings-item-value">${lightingConfig.fillLightIntensity?.toFixed(1) || '1.0'}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Ambient</span>
                    <span class="settings-item-value">${lightingConfig.ambientLightIntensity?.toFixed(1) || '0.3'}</span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Light Color</span>
                    <span class="settings-item-value">
                        <span class="settings-item-color" style="background-color: ${lightingConfig.keyLightColor}"></span>
                        ${lightingConfig.keyLightColor}
                    </span>
                </div>
                <div class="settings-item">
                    <span class="settings-item-key">Follow Camera</span>
                    <span class="settings-item-value">${lightingConfig.lightFollowsCamera ? 'On' : 'Off'}</span>
                </div>
            `;
        }
    }
    
    /**
     * Export settings to a JSON file.
     */
    exportSettings() {
        this.userConfig.exportToFile('lithicjs-settings.json');
    }
    
    /**
     * Import settings from a JSON file.
     * @param {Event} e - Change event from file input
     */
    async importSettings(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            await this.userConfig.importFromFile(file);
            // Reload settings into rendering panel
            this.renderingPanel.loadFromConfig();
            // Update summary display
            this.updateSettingsSummary();
            // Show success message
            alert('Settings imported successfully!');
        } catch (error) {
            console.error('Failed to import settings:', error);
            alert('Failed to import settings: ' + error.message);
        }
        
        // Reset file input
        e.target.value = '';
    }
    
    /**
     * Reset all settings to defaults.
     */
    resetAllSettings() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            this.userConfig.reset();
            this.renderingPanel.loadFromConfig();
            this.updateSettingsSummary();
        }
    }
    
    /**
     * Clear all settings from local storage.
     */
    clearLocalStorage() {
        if (confirm('This will clear all saved settings from browser storage. Continue?')) {
            localStorage.removeItem('lithicjs_user_config');
            this.userConfig.reset();
            this.renderingPanel.loadFromConfig();
            this.updateSettingsSummary();
            alert('Local storage cleared.');
        }
    }
    
    /**
     * Called when the settings panel is shown.
     * Updates the settings summary display.
     */
    onShow() {
        this.updateSettingsSummary();
        // Sync unit selectors with current config
        const displayUnitSelect = document.getElementById('displayUnitSelect');
        if (displayUnitSelect) displayUnitSelect.value = this.userConfig.get('units.displayUnit') || 'auto';
        const defaultSourceUnitSelect = document.getElementById('defaultSourceUnitSelect');
        if (defaultSourceUnitSelect) defaultSourceUnitSelect.value = this.userConfig.get('units.defaultSourceUnit') || 'mm';
    }
}
