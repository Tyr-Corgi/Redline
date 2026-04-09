#!/usr/bin/env node
/**
 * Save fidelity test at ZOOM=1.5: verifies annotation positions survive save→reopen.
 * This is the critical test — at zoom=1.0 normalization is a no-op.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.join(__dirname, 'screenshots');
const URL = 'http://localhost:5173';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // Collect console logs
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  console.log('📄 Opening editor...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(1000);

  // Load test PDF
  const testPdfPath = path.join(__dirname, 'test-input.pdf');
  const fileInput = page.locator('input[type="file"][accept="application/pdf"]').first();
  await fileInput.setInputFiles(testPdfPath);
  await sleep(2000);

  const container = page.locator('.page-container').first();
  const isVisible = await container.isVisible().catch(() => false);
  if (!isVisible) { console.log('❌ PDF did not load'); await browser.close(); return; }

  const box1 = await container.boundingBox();
  console.log(`📐 Page at zoom=1.0: ${box1.width}x${box1.height}`);

  // ——— ZOOM to 150% ———
  console.log('🔍 Zooming to 150%...');
  // Use keyboard shortcut: + three times (each +0.25, but let's use the zoom dropdown)
  // Or use Ctrl+= to zoom in
  await page.keyboard.press('Equal'); // +0.25 → 125%
  await sleep(300);
  await page.keyboard.press('Equal'); // +0.25 → 150%
  await sleep(500);

  const box2 = await container.boundingBox();
  console.log(`📐 Page at zoom=1.5: ${box2.width}x${box2.height}`);
  const actualZoom = box2.width / box1.width;
  console.log(`📐 Actual zoom ratio: ${actualZoom.toFixed(3)}`);

  // Get the current zoom from the UI
  const zoomText = await page.locator('.zoom-controls select, .zoom-controls span').first().textContent().catch(() => 'N/A');
  console.log(`📐 UI zoom: ${zoomText}`);

  // ——— Place text at KNOWN position relative to page ———
  // Place at 20% from left, 10% from top of the page
  const textX = box2.x + box2.width * 0.2;
  const textY = box2.y + box2.height * 0.1;

  console.log('📝 Selecting Text tool...');
  const textBtn = page.locator('button[title*="Text"]').first();
  await textBtn.click();
  await sleep(300);

  console.log(`📝 Clicking at viewport (${textX.toFixed(0)}, ${textY.toFixed(0)})...`);
  await page.mouse.click(textX, textY);
  await sleep(500);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('ZOOM TEST', { delay: 30 });
  await sleep(300);

  // Deselect
  const selectBtn = page.locator('button[title*="Select"]').first();
  await selectBtn.click();
  await sleep(300);
  await page.mouse.click(box2.x + box2.width * 0.8, box2.y + box2.height * 0.8);
  await sleep(300);

  // Screenshot at zoom=1.5 with annotations
  await page.screenshot({ path: path.join(SCREENSHOTS, 'zoom-test-before-150.png') });
  console.log('📸 Screenshot: zoom-test-before-150.png (annotations at 150%)');

  // ——— Read the Fabric canvas JSON to inspect stored annotation positions ———
  const fabricInfo = await page.evaluate(() => {
    // The fabric canvas wrapper
    const wrapper = document.querySelector('.page-container > div[style*="z-index: 2"]');
    if (!wrapper) return { error: 'no wrapper' };
    const canvases = wrapper.querySelectorAll('canvas');
    const mainCanvas = canvases[0]; // Fabric creates the first canvas
    const dims = {
      wrapperW: wrapper.clientWidth,
      wrapperH: wrapper.clientHeight,
    };
    if (mainCanvas) {
      dims.canvasW = mainCanvas.width;
      dims.canvasH = mainCanvas.height;
      dims.canvasCssW = mainCanvas.style.width;
      dims.canvasCssH = mainCanvas.style.height;
    }
    return dims;
  });
  console.log('🔍 Fabric canvas info:', JSON.stringify(fabricInfo));

  // ——— SAVE ———
  console.log('💾 Saving PDF at zoom=1.5...');
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.keyboard.press('Control+s');

  let download;
  try {
    download = await downloadPromise;
  } catch {
    console.log('❌ Download timed out');
    await browser.close();
    return;
  }

  const savePath = path.join(__dirname, 'test-zoom-saved.pdf');
  await download.saveAs(savePath);
  console.log(`✅ Saved: ${savePath} (${fs.statSync(savePath).size} bytes)`);

  // ——— Zoom back to 100% ———
  console.log('🔍 Zooming back to 100%...');
  await page.keyboard.press('Minus');
  await sleep(300);
  await page.keyboard.press('Minus');
  await sleep(500);

  // Screenshot at zoom=1.0 (should show annotations at correct relative position)
  await page.screenshot({ path: path.join(SCREENSHOTS, 'zoom-test-before-100.png') });
  console.log('📸 Screenshot: zoom-test-before-100.png (same annotations at 100%)');

  // ——— Open saved PDF in a FRESH browser context (no IndexedDB session) ———
  console.log('🔄 Opening saved PDF in fresh context...');
  const context2 = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  const page2 = await context2.newPage();
  page2.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  await page2.goto(URL, { waitUntil: 'networkidle' });
  await sleep(1000);

  const fileInput2 = page2.locator('input[type="file"][accept="application/pdf"]').first();
  await fileInput2.setInputFiles(savePath);
  await sleep(2000);

  const container3 = page2.locator('.page-container').first();
  const vis3 = await container3.isVisible().catch(() => false);
  if (!vis3) { console.log('❌ Saved PDF did not load'); await browser.close(); return; }

  // Screenshot of reopened saved PDF at 100%
  await page2.screenshot({ path: path.join(SCREENSHOTS, 'zoom-test-after-100.png') });
  console.log('📸 Screenshot: zoom-test-after-100.png (saved PDF at 100%)');

  const box3 = await container3.boundingBox();
  console.log(`📐 Reopened page: ${box3.width}x${box3.height}`);

  // Print console errors
  const errors = consoleLogs.filter(l => l.startsWith('[error]'));
  if (errors.length > 0) {
    console.log('\n⚠️ Console errors:');
    errors.forEach(e => console.log('  ', e));
  }

  console.log('\n============================================================');
  console.log('📊 ZOOM SAVE TEST COMPLETE');
  console.log('============================================================');
  console.log('Key files to compare:');
  console.log('  zoom-test-before-100.png — annotations in editor at 100%');
  console.log('  zoom-test-after-100.png  — saved PDF reopened at 100%');
  console.log('');
  console.log('The "ZOOM TEST" text should appear at the SAME position');
  console.log('relative to "Test Page" in both screenshots.');
  console.log('============================================================');

  await browser.close();
}

run().catch(err => { console.error('Failed:', err); process.exit(1); });
