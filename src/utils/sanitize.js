/**
 * Input sanitization utilities for user-provided content.
 * 
 * Use these functions to prevent XSS attacks when rendering user input.
 * 
 * @module sanitize
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Use this when inserting user-provided content into innerHTML.
 * 
 * @param {string} str - The string to escape
 * @returns {string} Escaped string safe for HTML insertion
 * 
 * @example
 * const userInput = '<script>alert("xss")</script>';
 * element.innerHTML = `<span>${escapeHtml(userInput)}</span>`;
 * // Result: <span>&lt;script&gt;alert("xss")&lt;/script&gt;</span>
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) {
        return '';
    }
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Sanitize a string for use as an HTML attribute value.
 * Escapes quotes and other special characters.
 * 
 * @param {string} str - The string to sanitize
 * @returns {string} Sanitized string safe for attribute values
 * 
 * @example
 * const userInput = '" onclick="alert(1)"';
 * element.innerHTML = `<button data-name="${escapeAttr(userInput)}">Click</button>`;
 */
export function escapeAttr(str) {
    if (str === null || str === undefined) {
        return '';
    }
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Validate and sanitize a name string (for annotations, files, etc.).
 * Removes potentially dangerous characters while preserving readability.
 * 
 * @param {string} name - The name to sanitize
 * @param {number} maxLength - Maximum length (default: 200)
 * @returns {string} Sanitized name
 */
export function sanitizeName(name, maxLength = 200) {
    if (!name || typeof name !== 'string') {
        return '';
    }
    
    // Trim whitespace
    let sanitized = name.trim();
    
    // Remove control characters
    sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
    
    // Truncate to max length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized;
}

/**
 * Check if a value looks like a Unix timestamp (milliseconds since epoch).
 * Considers values reasonable if they fall between year 2000 and year 2100.
 * 
 * @param {*} value - The value to check
 * @returns {boolean} True if value appears to be a timestamp
 */
export function isTimestamp(value) {
    if (typeof value !== 'number') return false;
    // Timestamp range: 2000-01-01 to 2100-01-01 (in milliseconds)
    const minTimestamp = 946684800000; // 2000-01-01
    const maxTimestamp = 4102444800000; // 2100-01-01
    return value >= minTimestamp && value <= maxTimestamp;
}

/**
 * Format a timestamp value to a human-readable string.
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.includeTime=true] - Include time in output
 * @param {boolean} [options.includeSeconds=false] - Include seconds in time
 * @returns {string} Formatted date/time string
 * 
 * @example
 * formatTimestamp(1704067200000); // "Jan 1, 2024, 12:00 AM"
 * formatTimestamp(1704067200000, { includeTime: false }); // "Jan 1, 2024"
 */
export function formatTimestamp(timestamp, options = {}) {
    const { includeTime = true, includeSeconds = false } = options;
    
    if (!isTimestamp(timestamp)) {
        return String(timestamp);
    }
    
    const date = new Date(timestamp);
    
    if (includeTime) {
        const dateOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            ...(includeSeconds && { second: '2-digit' })
        };
        return date.toLocaleString(undefined, dateOptions);
    } else {
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}

/**
 * Check if a metadata key is a known timestamp field.
 * 
 * @param {string} key - The metadata key to check
 * @returns {boolean} True if key is a known timestamp field
 */
export function isTimestampKey(key) {
    const timestampKeys = [
        'createdAt', 'modifiedAt', 'timestamp', 'computedAt',
        'created_at', 'modified_at', 'updated_at', 'savedAt', 
        'uploaded_at', 'exportedAt', 'processedAt'
    ];
    return timestampKeys.includes(key);
}

/**
 * Format a metadata value, automatically detecting and formatting timestamps.
 * 
 * @param {string} key - The metadata key
 * @param {*} value - The metadata value
 * @returns {string} Formatted value for display
 */
export function formatMetadataValue(key, value) {
    // Check if this is a known timestamp field or looks like a timestamp
    if (isTimestampKey(key) && isTimestamp(value)) {
        return formatTimestamp(value);
    }
    
    // For objects, stringify
    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value, null, 2);
    }
    
    // For numbers, check if it looks like a timestamp anyway
    if (typeof value === 'number' && isTimestamp(value)) {
        // Only auto-format if the key hints at being a date
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('time') || lowerKey.includes('date') || lowerKey.includes('at')) {
            return formatTimestamp(value);
        }
    }
    
    return String(value);
}
