// Generate a simple multi-page test PDF using pdf-lib
import { PDFDocument, rgb } from 'pdf-lib';
import { writeFileSync } from 'fs';

async function generate() {
  const doc = await PDFDocument.create();

  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([612, 792]); // standard letter
    page.drawText(`Test Page ${i}`, {
      x: 50,
      y: 700,
      size: 36,
      color: rgb(0, 0, 0),
    });
    page.drawText(`This is content on page ${i} for testing annotations.`, {
      x: 50,
      y: 650,
      size: 14,
      color: rgb(0.3, 0.3, 0.3),
    });
    // Add some boxes to test redaction over
    page.drawRectangle({
      x: 50,
      y: 400,
      width: 200,
      height: 30,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0.5, 0.5, 0.5),
      borderWidth: 1,
    });
    page.drawText(`Sensitive Data ${i}: SSN 123-45-678${i}`, {
      x: 55,
      y: 407,
      size: 12,
      color: rgb(0, 0, 0),
    });
  }

  const bytes = await doc.save();
  writeFileSync(new URL('./test.pdf', import.meta.url), bytes);
  console.log('Generated tests/test.pdf (3 pages)');
}

generate();
