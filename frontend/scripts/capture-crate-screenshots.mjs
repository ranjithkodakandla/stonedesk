import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../docs/crate-viewer-screenshots');
const baseUrl = 'http://127.0.0.1:4173/?crateDemo=1#crate-viewer-demo';

async function captureFigure(page, figLabel, filename) {
  await page.getByRole('button', { name: figLabel }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, filename), fullPage: false });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await captureFigure(page, 'FIG A · MAIN', 'v3-fig-a-main-board.png');
await captureFigure(page, 'FIG B · SECTION', 'v3-fig-b-section.png');
await captureFigure(page, 'FIG C · EXPLODED', 'v3-fig-c-exploded.png');

await browser.close();
console.log('Saved v3 screenshots to', outDir);
