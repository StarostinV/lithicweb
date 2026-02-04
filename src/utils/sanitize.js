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
