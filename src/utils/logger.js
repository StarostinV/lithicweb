/**
 * Logger utility with configurable log levels.
 * 
 * In production, only warnings and errors are logged.
 * In development, all logs are shown.
 * 
 * Debug mode can be enabled at runtime via localStorage:
 *   localStorage.setItem('lithicjs_debug', 'true')
 * 
 * @module logger
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

/**
 * Check if debug mode is enabled.
 * Debug mode shows all log levels regardless of environment.
 * @returns {boolean}
 */
function isDebugMode() {
    try {
        return localStorage.getItem('lithicjs_debug') === 'true';
    } catch (e) {
        return false;
    }
}

/**
 * Get the current log level based on environment.
 * @returns {number} The minimum log level to display
 */
function getCurrentLevel() {
    if (isDebugMode()) {
        return LOG_LEVELS.debug;
    }
    // In production builds, webpack sets process.env.NODE_ENV
    // Default to 'warn' level for production
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
        return LOG_LEVELS.warn;
    }
    // Development mode - show all logs
    return LOG_LEVELS.debug;
}

/**
 * Format a log message with optional prefix.
 * @param {string} prefix - Optional prefix like '[CloudStorage]'
 * @param {Array} args - Log arguments
 * @returns {Array} Formatted arguments
 */
function formatArgs(prefix, args) {
    if (prefix) {
        return [prefix, ...args];
    }
    return args;
}

/**
 * Logger instance with standard log methods.
 * 
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   logger.debug('[MyComponent]', 'Debug message');
 *   logger.info('[MyComponent]', 'Info message');
 *   logger.warn('[MyComponent]', 'Warning message');
 *   logger.error('[MyComponent]', 'Error message');
 * 
 * Or create a prefixed logger:
 *   const log = logger.withPrefix('[MyComponent]');
 *   log.debug('Debug message');
 */
export const logger = {
    /**
     * Log debug messages (development only).
     * @param {...any} args - Arguments to log
     */
    debug(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.debug) {
            console.log(...args);
        }
    },

    /**
     * Log info messages (development only).
     * @param {...any} args - Arguments to log
     */
    info(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.info) {
            console.log(...args);
        }
    },

    /**
     * Log warning messages (always shown).
     * @param {...any} args - Arguments to log
     */
    warn(...args) {
        if (getCurrentLevel() <= LOG_LEVELS.warn) {
            console.warn(...args);
        }
    },

    /**
     * Log error messages (always shown).
     * @param {...any} args - Arguments to log
     */
    error(...args) {
        console.error(...args);
    },

    /**
     * Create a logger with a fixed prefix.
     * @param {string} prefix - Prefix for all log messages (e.g., '[CloudStorage]')
     * @returns {Object} Logger object with prefixed methods
     */
    withPrefix(prefix) {
        return {
            debug: (...args) => logger.debug(prefix, ...args),
            info: (...args) => logger.info(prefix, ...args),
            warn: (...args) => logger.warn(prefix, ...args),
            error: (...args) => logger.error(prefix, ...args)
        };
    },

    /**
     * Enable debug mode (persisted to localStorage).
     */
    enableDebug() {
        try {
            localStorage.setItem('lithicjs_debug', 'true');
            console.log('[Logger] Debug mode enabled');
        } catch (e) {
            console.warn('[Logger] Could not enable debug mode:', e);
        }
    },

    /**
     * Disable debug mode.
     */
    disableDebug() {
        try {
            localStorage.removeItem('lithicjs_debug');
            console.log('[Logger] Debug mode disabled');
        } catch (e) {
            console.warn('[Logger] Could not disable debug mode:', e);
        }
    },

    /**
     * Check if debug mode is currently enabled.
     * @returns {boolean}
     */
    isDebugEnabled: isDebugMode
};

// Export log levels for external use
export { LOG_LEVELS };
