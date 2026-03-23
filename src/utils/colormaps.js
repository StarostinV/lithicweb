/**
 * Sequential colormaps for data visualization.
 *
 * Each colormap is defined as an array of RGB control points in [0,1] range.
 * Interpolation is linear between adjacent stops.
 *
 * @module utils/colormaps
 */

/**
 * Colormap definitions. Each is an array of [r, g, b] stops (0–1).
 * Interpolated linearly; first stop = t=0, last stop = t=1.
 */
export const COLORMAPS = {
    blueRed: [
        [0.23, 0.30, 0.75],  // blue
        [0.13, 0.70, 0.80],  // cyan
        [0.55, 0.83, 0.35],  // green
        [0.95, 0.85, 0.20],  // yellow
        [0.84, 0.19, 0.15],  // red
    ],
    viridis: [
        [0.27, 0.00, 0.33],  // dark purple
        [0.28, 0.22, 0.55],  // purple-blue
        [0.13, 0.40, 0.55],  // teal
        [0.15, 0.58, 0.43],  // green-teal
        [0.48, 0.73, 0.22],  // lime-green
        [0.99, 0.91, 0.14],  // yellow
    ],
    plasma: [
        [0.05, 0.03, 0.53],  // deep blue
        [0.42, 0.00, 0.66],  // purple
        [0.72, 0.10, 0.54],  // magenta
        [0.95, 0.35, 0.24],  // orange-red
        [0.98, 0.72, 0.08],  // yellow-orange
        [0.94, 0.97, 0.13],  // bright yellow
    ],
    coolwarm: [
        [0.23, 0.30, 0.75],  // blue
        [0.55, 0.60, 0.88],  // light blue
        [0.87, 0.87, 0.87],  // white/gray
        [0.88, 0.55, 0.50],  // light red
        [0.75, 0.15, 0.15],  // red
    ],
    turbo: [
        [0.19, 0.07, 0.23],  // dark purple
        [0.14, 0.40, 0.82],  // blue
        [0.06, 0.72, 0.65],  // cyan
        [0.35, 0.88, 0.30],  // green
        [0.78, 0.87, 0.14],  // yellow
        [0.98, 0.58, 0.07],  // orange
        [0.84, 0.19, 0.15],  // red
    ],
};

/**
 * Available colormap names for UI display.
 */
export const COLORMAP_NAMES = {
    blueRed: 'Blue → Red',
    viridis: 'Viridis',
    plasma: 'Plasma',
    coolwarm: 'Cool-Warm',
    turbo: 'Turbo',
};

/**
 * Sample a colormap at position t.
 *
 * @param {string} name - Colormap name (key in COLORMAPS)
 * @param {number} t - Position in [0, 1]
 * @returns {[number, number, number]} RGB values in [0, 1]
 */
export function sampleColormap(name, t) {
    const stops = COLORMAPS[name] || COLORMAPS.blueRed;
    t = Math.max(0, Math.min(1, t));

    const n = stops.length - 1;
    const i = Math.min(Math.floor(t * n), n - 1);
    const f = t * n - i;

    return [
        stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f,
        stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f,
        stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f,
    ];
}

/**
 * Generate an array of hex color strings for N evenly spaced samples.
 *
 * @param {string} name - Colormap name
 * @param {number} n - Number of samples
 * @returns {string[]} Array of hex color strings (e.g., '#ff0000')
 */
export function colormapHexColors(name, n) {
    if (n <= 0) return [];
    if (n === 1) {
        const [r, g, b] = sampleColormap(name, 0.5);
        return [rgbToHex(r, g, b)];
    }
    const colors = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const [r, g, b] = sampleColormap(name, t);
        colors.push(rgbToHex(r, g, b));
    }
    return colors;
}

function rgbToHex(r, g, b) {
    const toHex = (c) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
