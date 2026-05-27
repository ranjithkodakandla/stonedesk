import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../docs/crate-viewer-screenshots');
const baseUrl = 'http://127.0.0.1:4173/?crateDemo=1#crate-viewer-demo';

async function selectCrate(page, id) {
  await page.getByRole('button', { name: id }).click();
  await page.waitForTimeout(700);
}

async function captureFigure(page, figLabel, filename) {
  await page.getByRole('button', { name: figLabel }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, filename), fullPage: false });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

await selectCrate(page, 'DC-001');
await captureFigure(page, 'FIG A · MAIN', 'v4-kitchen-fig-a.png');
await captureFigure(page, 'FIG B · SECTION', 'v4-kitchen-fig-b.png');

await selectCrate(page, 'DC-002');
await captureFigure(page, 'FIG A · MAIN', 'v4-island-fig-a.png');
await captureFigure(page, 'FIG B · SECTION', 'v4-island-fig-b.png');

await selectCrate(page, 'DC-003');
await captureFigure(page, 'FIG A · MAIN', 'v4-vanity-fig-a.png');
await captureFigure(page, 'FIG B · SECTION', 'v4-vanity-fig-b.png');

await browser.close();
console.log('Saved v4 lean-load screenshots to', outDir);
