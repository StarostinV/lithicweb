/**
 * Render a thumbnail of every catalogue item with the web client itself.
 *
 * Needs a built client and the collection served with CORS, e.g.
 *   npx serve -s dist -l 5080
 *   npx serve --cors -l 5081 OUT_DIR
 *   node tools/collection/render_thumbs.mjs http://localhost:5080 http://localhost:5081 RAW_DIR
 * then crop with crop_thumbs.py. Requires playwright-core and a local Chrome.
 */
import { chromium } from 'playwright-core';
import fs from 'fs';

const [appUrl, collectionUrl, outDir] = process.argv.slice(2);
if (!outDir) {
    console.error('usage: render_thumbs.mjs APP_URL COLLECTION_URL RAW_DIR');
    process.exit(1);
}
const executablePath = process.env.CHROME || '/usr/bin/google-chrome';

const browser = await chromium.launch({
    executablePath, headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
await page.goto(`${appUrl}/?demo=0&collection=${encodeURIComponent(collectionUrl)}`);
// White background for the list; the screenshot button reads only the WebGL canvas
await page.evaluate(() => document.querySelector('.bg-preset[data-color="#FFFFFF"]').click());
await page.click('#collectionPanelBtn');
await page.waitForSelector('.collection-item', { timeout: 30000 });

const ids = await page.$$eval('.collection-item', els => els.map(e => e.dataset.id));
for (const id of ids) {
    if (fs.existsSync(`${outDir}/${id}.png`)) continue;     // resumable
    const sel = `.collection-item[data-id="${id}"]`;
    await page.evaluate(s => document.querySelector(s).click(), sel);
    await page.waitForFunction(s => document.querySelector(s)?.classList.contains('active'), sel, { timeout: 120000 });
    // The rotation gizmo is only drawn in View mode
    await page.evaluate(() => document.getElementById('arrowMode').click());
    await page.waitForTimeout(800);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.evaluate(() => document.getElementById('screenshotBtn').click()),
    ]);
    await download.saveAs(`${outDir}/${id}.png`);
    console.log(id);
}
await browser.close();
