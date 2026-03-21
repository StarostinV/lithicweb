/**
 * Lighting preset ids exposed in the rendering UI.
 * Legacy preset names from older configs map to `default` via normalizeLightingPreset.
 */
export const LIGHTING_PRESET_IDS = Object.freeze(['default', 'even', 'relief']);

export function normalizeLightingPreset(name) {
    return LIGHTING_PRESET_IDS.includes(name) ? name : 'default';
}
