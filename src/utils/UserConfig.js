/**
 * UserConfig - Manages user configuration settings with localStorage persistence.
 * 
 * Features:
 * - Automatic save/load to localStorage
 * - Export configuration as JSON file
 * - Import configuration from JSON file
 * - Default values with validation
 * - Event listeners for config changes
 * 
 * ## Event Bus Integration
 * 
 * UserConfig emits the following events via the global EventBus:
 * - `Events.CONFIG_CHANGED` - When any configuration value changes
 *   Data: { path: string, newValue: any, oldValue: any }
 * 
 * Components can subscribe to these events instead of using addListener():
 * ```javascript
 * import { eventBus, Events } from '../utils/EventBus.js';
 * eventBus.on(Events.CONFIG_CHANGED, (data) => {
 *     console.log('Config changed:', data.path, data.newValue);
 * });
 * ```
 */

import { eventBus, Events } from './EventBus.js';

const STORAGE_KEY = 'lithicjs_user_config';
const CONFIG_VERSION = 1;

// Default configuration values
const DEFAULT_CONFIG = {
    version: CONFIG_VERSION,
    
    // Rendering settings
    rendering: {
        annotationMode: 'full',
        wireframeMode: false,
        flatShading: false,
        materialType: 'lambert',
        metalness: 0.0,
        roughness: 0.5,
        envMapIntensity: 1.0,
        backgroundColor: '#201944',
        edgeColor: '#ff9933',
        objectColor: '#808080',
    },
    
    // Lighting settings
    lighting: {
        keyLightIntensity: 2.0,
        fillLightIntensity: 1.0,
        ambientLightIntensity: 0.3,
        keyLightColor: '#ffffff',
        lightFollowsCamera: false,
        currentLightingPreset: 'default',
    },
    
    // Display settings
    display: {
        showGizmo: true,
        autoSegments: true,
    },
    
    // Units settings
    units: {
        displayUnit: 'auto',       // 'auto' | 'raw' | 'um' | 'mm' | 'cm' | 'm' | 'in'
        defaultSourceUnit: 'mm',   // Assumed source unit when mesh has no metadata
    },

    // UI preferences
    ui: {
        sidebarWidth: 380,
    },
};

export class UserConfig {
    constructor() {
        this.config = this.deepClone(DEFAULT_CONFIG);
        this.listeners = new Map();
        this.load();
    }
    
    /**
     * Deep clone an object.
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
    
    /**
     * Load configuration from localStorage.
     */
    load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults to handle new config keys
                this.config = this.mergeConfig(this.deepClone(DEFAULT_CONFIG), parsed);
                // Update version
                this.config.version = CONFIG_VERSION;
                console.log('[UserConfig] Loaded configuration from localStorage');
            } else {
                console.log('[UserConfig] No stored configuration, using defaults');
            }
        } catch (error) {
            console.error('[UserConfig] Error loading configuration:', error);
            this.config = this.deepClone(DEFAULT_CONFIG);
        }
    }
    
    /**
     * Recursively merge source config into target config.
     * Source values override target values.
     */
    mergeConfig(target, source) {
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    if (typeof target[key] !== 'object' || target[key] === null) {
                        target[key] = {};
                    }
                    this.mergeConfig(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
        return target;
    }
    
    /**
     * Save configuration to localStorage.
     */
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
            console.log('[UserConfig] Configuration saved to localStorage');
        } catch (error) {
            console.error('[UserConfig] Error saving configuration:', error);
        }
    }
    
    /**
     * Get a configuration value by path (e.g., 'rendering.backgroundColor').
     */
    get(path) {
        const parts = path.split('.');
        let value = this.config;
        for (const part of parts) {
            if (value === undefined || value === null) return undefined;
            value = value[part];
        }
        return value;
    }
    
    /**
     * Set a configuration value by path and save.
     */
    set(path, value) {
        const parts = path.split('.');
        let obj = this.config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (obj[parts[i]] === undefined) {
                obj[parts[i]] = {};
            }
            obj = obj[parts[i]];
        }
        const key = parts[parts.length - 1];
        const oldValue = obj[key];
        obj[key] = value;
        this.save();
        this.notifyListeners(path, value, oldValue);
    }
    
    /**
     * Get entire config section (e.g., 'rendering').
     */
    getSection(section) {
        return this.deepClone(this.config[section] || {});
    }
    
    /**
     * Set entire config section.
     */
    setSection(section, values) {
        this.config[section] = { ...this.config[section], ...values };
        this.save();
        this.notifyListeners(section, this.config[section]);
    }
    
    /**
     * Reset configuration to defaults.
     */
    reset() {
        this.config = this.deepClone(DEFAULT_CONFIG);
        this.save();
        this.notifyListeners('*', this.config);
        console.log('[UserConfig] Configuration reset to defaults');
    }
    
    /**
     * Export configuration as a JSON file download.
     */
    exportToFile(filename = 'lithicjs-settings.json') {
        const dataStr = JSON.stringify(this.config, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log('[UserConfig] Configuration exported to', filename);
    }
    
    /**
     * Import configuration from a JSON file.
     * Returns a promise that resolves with the imported config.
     */
    importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    
                    // Validate basic structure
                    if (typeof imported !== 'object' || imported === null) {
                        throw new Error('Invalid configuration format');
                    }
                    
                    // Merge with defaults to ensure all keys exist
                    this.config = this.mergeConfig(this.deepClone(DEFAULT_CONFIG), imported);
                    this.config.version = CONFIG_VERSION;
                    this.save();
                    this.notifyListeners('*', this.config);
                    
                    console.log('[UserConfig] Configuration imported from file');
                    resolve(this.config);
                } catch (error) {
                    console.error('[UserConfig] Error importing configuration:', error);
                    reject(error);
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
            
            reader.readAsText(file);
        });
    }
    
    /**
     * Add a listener for configuration changes.
     * 
     * @deprecated Prefer using EventBus for new code:
     * ```javascript
     * import { eventBus, Events } from '../utils/EventBus.js';
     * eventBus.on(Events.CONFIG_CHANGED, (data) => {
     *     // data.path, data.newValue, data.oldValue
     * });
     * ```
     * 
     * @param {string} path - Config path to listen to ('*' for all changes)
     * @param {function} callback - Function called with (newValue, oldValue, path)
     * @returns {function} Unsubscribe function
     */
    addListener(path, callback) {
        if (!this.listeners.has(path)) {
            this.listeners.set(path, new Set());
        }
        this.listeners.get(path).add(callback);
        
        return () => {
            const pathListeners = this.listeners.get(path);
            if (pathListeners) {
                pathListeners.delete(callback);
            }
        };
    }
    
    /**
     * Notify listeners of config changes.
     * Emits both to legacy listeners and the global EventBus.
     */
    notifyListeners(path, newValue, oldValue) {
        // Legacy listener pattern (for backward compatibility)
        // Notify specific path listeners
        const pathListeners = this.listeners.get(path);
        if (pathListeners) {
            pathListeners.forEach(cb => cb(newValue, oldValue, path));
        }
        
        // Notify wildcard listeners
        const wildcardListeners = this.listeners.get('*');
        if (wildcardListeners) {
            wildcardListeners.forEach(cb => cb(newValue, oldValue, path));
        }
        
        // EventBus pattern (preferred for new code)
        eventBus.emit(Events.CONFIG_CHANGED, {
            path: path,
            newValue: newValue,
            oldValue: oldValue
        });
    }
    
    /**
     * Get the full config object (clone).
     */
    getAll() {
        return this.deepClone(this.config);
    }
    
    /**
     * Check if config has been modified from defaults.
     */
    isModified() {
        return JSON.stringify(this.config) !== JSON.stringify(DEFAULT_CONFIG);
    }
}

// Export default config for reference
export { DEFAULT_CONFIG };
