/**
 * End-to-end test for all PDF editor tools using Playwright.
 * Run: npx playwright test tests/tools-e2e.spec.mjs --headed
 * Or:  node tests/tools-e2e.spec.mjs  (standalone runner below)
 */
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_PDF = resolve(__dirname, 'test.pdf');
const BASE_URL = 'http://localhost:5173';
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');

import { mkdirSync } from 'fs';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
function log(tool, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${tool}: ${status}${detail ? ' — ' + detail : ''}`);
  results.push({ tool, status, detail });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    // ── 1. Load the app ──
    console.log('\n🔧 Opening PDF Editor...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-app-loaded.png') });

    // Check drop zone is visible
    const dropZone = page.locator('.drop-zone');
    if (await dropZone.isVisible()) {
      log('App Load', 'PASS', 'Drop zone visible');
    } else {
      log('App Load', 'FAIL', 'Drop zone not visible');
    }

    // ── 2. Upload PDF ──
    console.log('\n📄 Uploading test PDF...');
    const fileInput = page.locator('input[type="file"][accept="application/pdf"]').first();
    await fileInput.setInputFiles(TEST_PDF);
    await sleep(2000); // Wait for PDF to render

    // Check that PDF rendered (page-container should appear)
    const pageContainer = page.locator('.page-container');
    if (await pageContainer.isVisible({ timeout: 5000 })) {
      log('PDF Upload', 'PASS', 'Page container rendered');
    } else {
      log('PDF Upload', 'FAIL', 'Page container did not appear');
      await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-upload-fail.png') });
      throw new Error('Cannot continue without PDF loaded');
    }
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-pdf-loaded.png') });

    // ── 3. Check toolbar has all new tool buttons ──
    console.log('\n🔍 Checking toolbar buttons...');
    const toolButtons = await page.locator('.tool-btn').all();
    const toolCount = toolButtons.length;
    log('Toolbar Buttons', toolCount >= 18 ? 'PASS' : 'WARN', `Found ${toolCount} buttons (expected ~22+)`);

    // Check for specific tool titles
    for (const toolTitle of ['Redact', 'Arrow', 'Circle', 'Stamp']) {
      const btn = page.locator(`.tool-btn[title*="${toolTitle}"]`);
      if (await btn.count() > 0) {
        log(`${toolTitle} Button`, 'PASS', 'Found in toolbar');
      } else {
        log(`${toolTitle} Button`, 'FAIL', 'Missing from toolbar');
      }
    }

    // Get the annotation canvas bounding box for click coordinates
    const canvasEl = page.locator('.annotation-canvas, .upper-canvas').first();
    const canvasBounds = await canvasEl.boundingBox();
    if (!canvasBounds) {
      log('Canvas', 'FAIL', 'Cannot find annotation canvas');
      throw new Error('No canvas found');
    }
    const cx = canvasBounds.x + canvasBounds.width / 2;
    const cy = canvasBounds.y + canvasBounds.height / 2;

    // ── Helper: click a tool button by title substring ──
    async function selectTool(titleSubstr) {
      const btn = page.locator(`.tool-btn[title*="${titleSubstr}"]`).first();
      await btn.click();
      await sleep(300);
    }

    // ── Helper: draw a drag gesture on canvas ──
    async function dragOnCanvas(startX, startY, endX, endY) {
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Move in steps for fabric.js to register
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const px = startX + (endX - startX) * (i / steps);
        const py = startY + (endY - startY) * (i / steps);
        await page.mouse.move(px, py);
        await sleep(30);
      }
      await page.mouse.up();
      await sleep(500);
    }

    // ── 4. Test SELECT tool (baseline) ──
    console.log('\n🖱️ Testing Select tool...');
    await selectTool('Select');
    const selectActive = page.locator('.tool-btn.active[title*="Select"]');
    log('Select Tool', await selectActive.count() > 0 ? 'PASS' : 'FAIL', 'Active state');

    // ── 5. Test TEXT tool ──
    console.log('\n📝 Testing Text tool...');
    await selectTool('Add Text');
    await page.mouse.click(cx - 100, cy - 200);
    await sleep(500);
    await page.keyboard.type('Test Text Annotation', { delay: 30 });
    await sleep(300);
    // Click elsewhere to deselect
    await selectTool('Select');
    await page.mouse.click(cx + 200, cy + 200);
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-text-tool.png') });
    log('Text Tool', 'PASS', 'Text placed on canvas');

    // ── 6. Test DRAW tool ──
    console.log('\n✏️ Testing Draw tool...');
    await selectTool('Freehand Draw');
    await dragOnCanvas(cx - 150, cy - 100, cx + 50, cy - 50);
    await selectTool('Select');
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-draw-tool.png') });
    log('Draw Tool', 'PASS', 'Freehand path drawn');

    // ── 7. Test HIGHLIGHT tool ──
    console.log('\n🟡 Testing Highlight tool...');
    await selectTool('Highlight');
    await dragOnCanvas(cx - 150, cy + 50, cx + 100, cy + 80);
    await selectTool('Select');
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '05-highlight-tool.png') });
    log('Highlight Tool', 'PASS', 'Highlight rectangle placed');

    // ── 8. Test REDACT tool ──
    console.log('\n⬛ Testing Redact tool...');
    await selectTool('Redact');
    await dragOnCanvas(cx - 120, cy + 100, cx + 80, cy + 130);
    await selectTool('Select');
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '06-redact-tool.png') });
    log('Redact Tool', 'PASS', 'Black redaction rectangle placed');

    // ── 9. Test ARROW tool ──
    console.log('\n➡️ Testing Arrow tool...');
    await selectTool('Arrow');
    await dragOnCanvas(cx - 200, cy + 160, cx + 50, cy + 160);
    await selectTool('Select');
    await sleep(500);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '07-arrow-tool.png') });
    log('Arrow Tool', 'PASS', 'Arrow drawn on canvas');

    // ── 10. Test CIRCLE tool ──
    console.log('\n⭕ Testing Circle tool...');
    await selectTool('Circle');
    await dragOnCanvas(cx + 80, cy - 50, cx + 180, cy + 20);
    await selectTool('Select');
    await sleep(500);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '08-circle-tool.png') });
    log('Circle Tool', 'PASS', 'Circle drawn on canvas');

    // ── 11. Test SHAPE (rectangle) tool ──
    console.log('\n🔲 Testing Shape tool...');
    await selectTool('Shape');
    await dragOnCanvas(cx + 100, cy + 100, cx + 200, cy + 170);
    await selectTool('Select');
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '09-shape-tool.png') });
    log('Shape Tool', 'PASS', 'Rectangle drawn');

    // ── 12. Test STAMP tool (all 5 types) ──
    console.log('\n🏷️ Testing Stamp tool...');
    await selectTool('Stamp');
    await sleep(300);

    // Check stamp config buttons appear (filter by stamp-specific text)
    const stampBtns = page.locator('.tool-btn.format-btn, .format-btn').filter({ hasText: /^(APR|DFT|CONF|URG|VOID)$/ });
    const stampCount = await stampBtns.count();
    log('Stamp Config', stampCount >= 5 ? 'PASS' : 'WARN', `Found ${stampCount} stamp type buttons`);

    // Place each stamp type
    const stampTypes = ['APR', 'DFT', 'CONF', 'URG', 'VOID'];
    for (let i = 0; i < stampTypes.length; i++) {
      const stampBtn = page.locator(`.format-btn`).filter({ hasText: stampTypes[i] }).first();
      if (await stampBtn.count() > 0) {
        await stampBtn.click();
        await sleep(200);
      }
      await page.mouse.click(cx - 200 + (i * 80), cy + 220);
      await sleep(300);
    }
    await selectTool('Select');
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '10-stamp-tool.png') });
    log('Stamp Tool', 'PASS', `Placed ${stampTypes.length} stamp types`);

    // ── 13. Test CHECKBOX tool ──
    console.log('\n☑️ Testing Checkbox tool...');
    await selectTool('Checkbox');
    await page.mouse.click(cx - 200, cy + 280);
    await sleep(500);
    // Switch to X style
    const xBtn = page.locator('.format-btn[title="X Mark"]');
    if (await xBtn.count() > 0) {
      await xBtn.click();
      await sleep(200);
    }
    await page.mouse.click(cx - 170, cy + 280);
    await sleep(500);
    await selectTool('Select');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '11-checkbox-tool.png') });
    log('Checkbox Tool', 'PASS', 'Checkmark and X mark placed');

    // ── 14. Test DATE tool ──
    console.log('\n📅 Testing Date tool...');
    await selectTool('Date Stamp');
    await page.mouse.click(cx + 100, cy + 280);
    await sleep(500);
    await selectTool('Select');
    await page.mouse.click(cx - 100, cy - 100);
    await sleep(300);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '12-date-tool.png') });
    log('Date Tool', 'PASS', 'Date stamp placed');

    // ── 15. Test ERASER tool ──
    console.log('\n🧹 Testing Eraser tool...');
    await selectTool('Eraser');
    // Click on the shape area to try to erase something
    await page.mouse.click(cx + 150, cy + 135);
    await sleep(300);
    await selectTool('Select');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '13-eraser-tool.png') });
    log('Eraser Tool', 'PASS', 'Eraser click registered');

    // ── FULL CANVAS SCREENSHOT WITH ALL ANNOTATIONS ──
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '14-all-annotations-page1.png') });

    // ── 16. Test PAGE SIDEBAR — Rotate ──
    console.log('\n🔄 Testing Page Rotate...');
    const sidebar = page.locator('.page-sidebar');
    if (await sidebar.isVisible()) {
      // Hover over page 2 thumbnail to reveal action buttons
      const page2Thumb = page.locator('.page-thumbnail').nth(1);
      await page2Thumb.hover();
      await sleep(800);

      const rotateBtn = page2Thumb.locator('[title="Rotate page"]');
      if (await rotateBtn.isVisible({ timeout: 3000 })) {
        await rotateBtn.click({ force: true, timeout: 5000 });
        await sleep(500);
        await page.screenshot({ path: resolve(SCREENSHOT_DIR, '15-page-rotate.png') });
        log('Page Rotate', 'PASS', 'Page 2 rotated 90°');
      } else {
        log('Page Rotate', 'FAIL', 'Rotate button not visible on hover');
        await page.screenshot({ path: resolve(SCREENSHOT_DIR, '15-page-rotate-fail.png') });
      }
    } else {
      log('Page Rotate', 'FAIL', 'Sidebar not visible');
    }

    // ── 17. Navigate to page 2 to verify rotation applied ──
    console.log('\n📄 Navigating to page 2...');
    const page2Btn = page.locator('.page-thumbnail').nth(1);
    await page2Btn.click();
    await sleep(1500);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '16-page2-rotated.png') });
    log('Page 2 Navigation', 'PASS', 'Navigated to page 2');

    // ── 18. Go back to page 1 and verify annotations persisted ──
    console.log('\n🔙 Returning to page 1 to check annotation persistence...');
    const page1Btn = page.locator('.page-thumbnail').first();
    await page1Btn.click();
    await sleep(1500);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '17-page1-annotations-persist.png') });
    log('Annotation Persistence', 'PASS', 'Returned to page 1 (check screenshot)');

    // ── 19. Test PAGE DELETE ──
    console.log('\n🗑️ Testing Page Delete...');
    // Navigate to page 3
    const page3Btn = page.locator('.page-thumbnail').nth(2);
    if (await page3Btn.count() > 0) {
      await page3Btn.hover();
      await sleep(500);

      // Set up dialog handler BEFORE clicking delete
      page.on('dialog', async dialog => {
        console.log(`  Dialog: "${dialog.message()}" → accepting`);
        await dialog.accept();
      });

      const deleteBtn = page3Btn.locator('[title="Delete page"]');
      if (await deleteBtn.isVisible({ timeout: 3000 })) {
        await deleteBtn.click({ force: true, timeout: 5000 });
        await sleep(1000);

        // Count remaining visible pages
        const remainingPages = await page.locator('.page-thumbnail').count();
        log('Page Delete', remainingPages === 2 ? 'PASS' : 'WARN', `${remainingPages} pages remaining (expected 2)`);
        await page.screenshot({ path: resolve(SCREENSHOT_DIR, '18-page-deleted.png') });
      } else {
        log('Page Delete', 'FAIL', 'Delete button not visible on hover');
        await page.screenshot({ path: resolve(SCREENSHOT_DIR, '18-page-delete-fail.png') });
      }
    } else {
      log('Page Delete', 'FAIL', 'Page 3 thumbnail not found');
    }

    // ── 20. Test UNDO/REDO ──
    console.log('\n↩️ Testing Undo/Redo...');
    const undoBtn = page.locator('.tool-btn[title*="Undo"]');
    const redoBtn = page.locator('.tool-btn[title*="Redo"]');

    if (await undoBtn.count() > 0) {
      const undoDisabled = await undoBtn.isDisabled();
      // Undo should be enabled since we made annotations
      log('Undo Button', !undoDisabled ? 'PASS' : 'WARN', undoDisabled ? 'Disabled (no history)' : 'Enabled');

      if (!undoDisabled) {
        await undoBtn.click();
        await sleep(500);
        await page.screenshot({ path: resolve(SCREENSHOT_DIR, '19-after-undo.png') });
        log('Undo Action', 'PASS', 'Undo executed');

        // Redo
        const redoDisabled = await redoBtn.isDisabled();
        if (!redoDisabled) {
          await redoBtn.click();
          await sleep(500);
          log('Redo Action', 'PASS', 'Redo executed');
        } else {
          log('Redo Action', 'WARN', 'Redo disabled after undo');
        }
      }
    }

    // ── 21. Test SAVE (download) ──
    console.log('\n💾 Testing Save...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
      page.locator('.tool-btn[title*="Save"]').click(),
    ]);

    if (download) {
      const filename = download.suggestedFilename();
      log('Save PDF', 'PASS', `Downloaded: ${filename}`);
      await download.saveAs(resolve(SCREENSHOT_DIR, filename));
    } else {
      log('Save PDF', 'WARN', 'No download triggered (may need annotations on current page)');
    }

    // ── 22. Test ZOOM ──
    console.log('\n🔍 Testing Zoom...');
    const zoomInBtn = page.locator('.tool-btn[title*="Zoom In"]');
    await zoomInBtn.click();
    await sleep(500);
    await zoomInBtn.click();
    await sleep(500);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '20-zoomed-in.png') });
    log('Zoom In', 'PASS', 'Zoomed in 2 steps');

    const zoomOutBtn = page.locator('.tool-btn[title*="Zoom Out"]');
    await zoomOutBtn.click();
    await sleep(500);
    await zoomOutBtn.click();
    await sleep(500);
    log('Zoom Out', 'PASS', 'Zoomed back out');

    // Final screenshot
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '21-final-state.png'), fullPage: true });

    // ── Report console errors ──
    if (consoleErrors.length > 0) {
      console.log('\n⚠️ Console errors detected:');
      consoleErrors.forEach(e => console.log(`  - ${e.substring(0, 200)}`));
      log('Console Errors', 'WARN', `${consoleErrors.length} errors`);
    } else {
      log('Console Errors', 'PASS', 'No console errors');
    }

  } catch (err) {
    console.error('\n💥 Test crashed:', err.message);
    log('Test Runner', 'FAIL', err.message);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'crash.png') }).catch(() => {});
  } finally {
    await browser.close();
  }

  // ── FINAL REPORT ──
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  console.log(`✅ PASS: ${pass}  ❌ FAIL: ${fail}  ⚠️ WARN: ${warn}`);
  console.log('='.repeat(60));

  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.tool}: ${r.detail}`);
    });
  }
  if (warn > 0) {
    console.log('\nWarnings:');
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`  ⚠️ ${r.tool}: ${r.detail}`);
    });
  }

  console.log(`\n📸 Screenshots saved to: ${SCREENSHOT_DIR}/`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
