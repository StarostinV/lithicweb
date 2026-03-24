/**
 * Screenshot capture utility.
 *
 * Captures the current WebGL canvas as a PNG image and triggers download.
 *
 * @module utils/screenshotExporter
 */

/**
 * Capture the current 3D canvas and download as PNG.
 * @param {Scene} scene - The Three.js scene wrapper
 * @param {string} [baseName='lithic'] - Base filename (without extension)
 */
export function captureScreenshot(scene, baseName = 'lithic') {
    if (!scene || !scene.renderer) {
        console.warn('[Screenshot] No renderer available');
        return;
    }

    // Force a render to ensure latest frame
    scene.renderer.render(scene.scene, scene.camera);

    // Capture canvas
    const dataUrl = scene.renderer.domElement.toDataURL('image/png');

    // Trigger download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${baseName}_screenshot_${timestamp}.png`;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
