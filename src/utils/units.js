/**
 * Units system for coordinate-aware measurements.
 *
 * Supports conversion between common length units used in lithic analysis.
 * Source unit (what PLY coordinates are in) lives in mesh metadata.
 * Display unit (what user wants to see) lives in UserConfig.
 *
 * @module utils/units
 */

/**
 * Supported units with display info and conversion factors relative to mm.
 */
export const UNIT_DEFINITIONS = {
    'raw':  { label: 'Raw (unitless)',  factor: 1,     symbol: '',   decimals: 2 },
    'um':   { label: 'Micrometers (μm)', factor: 0.001, symbol: 'μm', decimals: 1 },
    'mm':   { label: 'Millimeters (mm)', factor: 1,     symbol: 'mm', decimals: 2 },
    'cm':   { label: 'Centimeters (cm)', factor: 10,    symbol: 'cm', decimals: 3 },
    'm':    { label: 'Meters (m)',       factor: 1000,  symbol: 'm',  decimals: 4 },
    'in':   { label: 'Inches (in)',      factor: 25.4,  symbol: 'in', decimals: 3 },
};

/**
 * Convert a value between two units.
 * @param {number} value - The value to convert
 * @param {string} fromUnit - Source unit key
 * @param {string} toUnit - Target unit key
 * @returns {number} Converted value
 */
export function convert(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return value;
    const from = UNIT_DEFINITIONS[fromUnit] || UNIT_DEFINITIONS['raw'];
    const to = UNIT_DEFINITIONS[toUnit] || UNIT_DEFINITIONS['raw'];
    // Convert to mm first, then to target
    const inMm = value * from.factor;
    return inMm / to.factor;
}

/**
 * Format a distance value with unit symbol.
 * @param {number} value - Distance in source units
 * @param {string} unit - Unit key for display
 * @returns {string} Formatted string, e.g. "12.34 mm"
 */
export function formatDistance(value, unit) {
    const def = UNIT_DEFINITIONS[unit] || UNIT_DEFINITIONS['raw'];
    const formatted = value.toFixed(def.decimals);
    return def.symbol ? `${formatted} ${def.symbol}` : formatted;
}

/**
 * Format a distance value, converting from source to display unit.
 * @param {number} value - Distance in source unit coordinates
 * @param {string} sourceUnit - What the coordinates are in
 * @param {string} displayUnit - What to display as
 * @returns {string} Formatted string with unit
 */
export function formatDistanceConverted(value, sourceUnit, displayUnit) {
    const converted = convert(value, sourceUnit, displayUnit);
    return formatDistance(converted, displayUnit);
}

/**
 * Format an area value with unit symbol (unit²).
 * @param {number} value - Area in source units squared
 * @param {string} unit - Unit key for display
 * @returns {string} Formatted string, e.g. "12.34 mm²"
 */
export function formatArea(value, unit) {
    const def = UNIT_DEFINITIONS[unit] || UNIT_DEFINITIONS['raw'];
    const formatted = value.toFixed(def.decimals);
    return def.symbol ? `${formatted} ${def.symbol}²` : formatted;
}

/**
 * Format an area value, converting from source to display unit.
 * Area conversion is factor², not factor.
 * @param {number} value - Area in source units squared
 * @param {string} sourceUnit - What the coordinates are in
 * @param {string} displayUnit - What to display as
 * @returns {string} Formatted string with unit²
 */
export function formatAreaConverted(value, sourceUnit, displayUnit) {
    if (sourceUnit === displayUnit) return formatArea(value, displayUnit);
    const from = UNIT_DEFINITIONS[sourceUnit] || UNIT_DEFINITIONS['raw'];
    const to = UNIT_DEFINITIONS[displayUnit] || UNIT_DEFINITIONS['raw'];
    const factorRatio = from.factor / to.factor;
    const converted = value * factorRatio * factorRatio;
    return formatArea(converted, displayUnit);
}

/**
 * Format an angle in radians to degrees.
 * @param {number} radians - Angle in radians
 * @returns {string} Formatted string, e.g. "45.2°"
 */
export function formatAngle(radians) {
    const degrees = radians * (180 / Math.PI);
    return `${degrees.toFixed(1)}°`;
}

/**
 * Resolve the effective display unit from mesh metadata and user config.
 * @param {object} meshMetadata - Mesh metadata object (may have .unit)
 * @param {UserConfig} userConfig - User configuration
 * @returns {string} Resolved unit key
 */
export function getEffectiveUnit(meshMetadata, userConfig) {
    const displayUnit = userConfig?.get('units.displayUnit') || 'auto';
    if (displayUnit !== 'auto') return displayUnit;
    return meshMetadata?.unit || userConfig?.get('units.defaultSourceUnit') || 'mm';
}

/**
 * Get the source unit from mesh metadata or user config default.
 * @param {object} meshMetadata - Mesh metadata object
 * @param {UserConfig} userConfig - User configuration
 * @returns {string} Source unit key
 */
export function getSourceUnit(meshMetadata, userConfig) {
    return meshMetadata?.unit || userConfig?.get('units.defaultSourceUnit') || 'mm';
}
