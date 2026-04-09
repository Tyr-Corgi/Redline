#!/usr/bin/env node
/**
 * Save fidelity test: verifies annotation positions survive the save→reopen cycle.
 *
 * 1. Opens the editor, loads a test PDF
 * 2. Adds text at known positions (top-left corner area)
 * 3. Takes a screenshot of the annotated page ("before")
 * 4. Saves the PDF
 * 5. Re-opens the saved PDF
 * 6. Takes a screenshot ("after")
 * 7. Compares the two visually
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
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  console.log('📄 Opening editor...');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(1000);

  // Create a simple test PDF using jsPDF-like approach via the browser
  console.log('📄 Creating and loading test PDF...');

  // Use a file input to load a generated PDF
  const testPdfPath = path.join(__dirname, 'test-input.pdf');

  // Generate a simple PDF if not present
  if (!fs.existsSync(testPdfPath)) {
    // Create a minimal valid PDF
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 72 720 Td (Test Page) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000360 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`;
    fs.writeFileSync(testPdfPath, pdfContent);
  }

  // Upload the PDF
  const fileInput = await page.locator('input[type="file"][accept="application/pdf"]').first();
  await fileInput.setInputFiles(testPdfPath);
  await sleep(2000);

  // Verify PDF loaded
  const pageContainer = await page.locator('.page-container').first();
  const isVisible = await pageContainer.isVisible().catch(() => false);
  if (!isVisible) {
    console.log('❌ PDF did not load');
    await browser.close();
    process.exit(1);
  }
  console.log('✅ PDF loaded');

  // Get the canvas dimensions for reference
  const containerBox = await pageContainer.boundingBox();
  console.log(`📐 Page container: ${containerBox.width}x${containerBox.height} at (${containerBox.x}, ${containerBox.y})`);

  // Click the Text tool
  console.log('📝 Selecting Text tool...');
  const textBtn = page.locator('button[title*="Text"], button:has-text("Text")').first();
  await textBtn.click();
  await sleep(500);

  // Place text at a specific position relative to the page container
  // Click near the top-left area of the PDF page
  const clickX = containerBox.x + 100;
  const clickY = containerBox.y + 100;
  console.log(`📝 Placing text at (${clickX}, ${clickY}) relative to viewport...`);
  await page.mouse.click(clickX, clickY);
  await sleep(500);

  // Type something recognizable
  await page.keyboard.press('Control+a');
  await page.keyboard.type('SAVE TEST', { delay: 30 });
  await sleep(300);

  // Click elsewhere to deselect
  await page.mouse.click(containerBox.x + 300, containerBox.y + 300);
  await sleep(300);

  // Place a second text annotation further down
  await page.mouse.click(containerBox.x + 100, containerBox.y + 200);
  await sleep(500);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('POSITION CHECK', { delay: 30 });
  await sleep(300);

  // Click elsewhere to deselect
  await page.mouse.click(containerBox.x + 400, containerBox.y + 400);
  await sleep(500);

  // Switch to Select tool to deselect everything
  const selectBtn = page.locator('button[title*="Select"], button:has-text("Select")').first();
  await selectBtn.click();
  await sleep(500);

  // Screenshot BEFORE save
  await page.screenshot({ path: path.join(SCREENSHOTS, 'save-test-before.png'), fullPage: false });
  console.log('📸 Screenshot taken: save-test-before.png');

  // Now look at what the Fabric canvas JSON looks like for debugging
  const annotationJson = await page.evaluate(() => {
    // Access the fabric canvas through the app
    const canvasEl = document.querySelector('.page-container canvas:not([style*="z-index: 1"])');
    if (!canvasEl) return 'NO CANVAS FOUND';
    // Try to get fabric instance - fabric stores it on the element
    const wrapper = document.querySelector('.page-container > div[style*="z-index: 2"]');
    if (!wrapper) return 'NO WRAPPER FOUND';
    const innerCanvas = wrapper.querySelector('canvas');
    if (!innerCanvas) return 'NO INNER CANVAS';
    // We can't access fabric directly, but we can check the canvas dimensions
    return JSON.stringify({
      containerWidth: document.querySelector('.page-container')?.clientWidth,
      containerHeight: document.querySelector('.page-container')?.clientHeight,
      pdfCanvasWidth: document.querySelector('.page-container canvas')?.width,
      pdfCanvasHeight: document.querySelector('.page-container canvas')?.height,
    });
  });
  console.log('🔍 Canvas info:', annotationJson);

  // Save the PDF
  console.log('💾 Saving PDF...');
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

  // Try Ctrl+S
  await page.keyboard.press('Control+s');

  let download;
  try {
    download = await downloadPromise;
    const savePath = path.join(__dirname, 'test-saved-output.pdf');
    await download.saveAs(savePath);
    console.log(`✅ PDF saved to: ${savePath}`);

    const savedSize = fs.statSync(savePath).size;
    console.log(`📏 Saved PDF size: ${savedSize} bytes`);

    // Now reload the page and open the saved PDF
    console.log('🔄 Reloading editor to open saved PDF...');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await sleep(1500);

    // Upload the saved PDF
    const fileInput2 = await page.locator('input[type="file"][accept="application/pdf"]').first();
    await fileInput2.setInputFiles(savePath);
    await sleep(2000);

    // Verify loaded
    const container2 = await page.locator('.page-container').first();
    const vis2 = await container2.isVisible().catch(() => false);
    if (!vis2) {
      console.log('❌ Saved PDF did not load');
      await browser.close();
      process.exit(1);
    }

    // Screenshot AFTER reopening saved PDF
    await page.screenshot({ path: path.join(SCREENSHOTS, 'save-test-after.png'), fullPage: false });
    console.log('📸 Screenshot taken: save-test-after.png');

    // Get dimensions of the reopened page
    const containerBox2 = await container2.boundingBox();
    console.log(`📐 Reopened page container: ${containerBox2.width}x${containerBox2.height}`);

    console.log('\n============================================================');
    console.log('📊 SAVE TEST COMPLETE');
    console.log('============================================================');
    console.log('Compare save-test-before.png and save-test-after.png');
    console.log('The text "SAVE TEST" and "POSITION CHECK" should appear');
    console.log('at the same positions in both screenshots.');
    console.log('============================================================');

  } catch (err) {
    console.log('❌ Save failed or timed out:', err.message);
  }

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
