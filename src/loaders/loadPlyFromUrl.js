/**
 * Load a PLY from a URL into MeshLoader (same path as cloud download: File + loadFile).
 *
 * @param {*} meshLoader - MeshLoader instance
 * @param {string} url - Absolute or root-relative URL (e.g. '/demo/showcase.ply')
 * @param {string} displayFileName - Filename shown in UI and used for export basename (e.g. 'showcase.ply')
 * @returns {Promise<void>}
 */
export async function loadPlyFromUrl(meshLoader, url, displayFileName) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const file = new File([blob], displayFileName, { type: 'application/octet-stream' });
    await meshLoader.loadFile(file);

    const fileNameSpan = document.getElementById('fileName');
    if (fileNameSpan) {
        fileNameSpan.textContent = displayFileName;
        fileNameSpan.title = displayFileName;
    }
}

/** Root-relative URL after webpack CopyPlugin (see webpack.config.js). */
export const DEMO_SHOWCASE_PLY_URL = '/demo/showcase.ply';

/** Display name for the bundled demo mesh (fixture is test_annotated_mesh.ply on disk). */
export const DEMO_SHOWCASE_FILENAME = 'showcase.ply';

/**
 * Whether to auto-load the demo mesh on startup.
 * Skip with URL: ?demo=0 or ?demo=false
 */
export function shouldAutoloadDemoMesh() {
    const v = new URLSearchParams(window.location.search).get('demo');
    if (v === '0' || v === 'false') {
        return false;
    }
    return true;
}
