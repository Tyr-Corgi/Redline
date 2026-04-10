import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type React from 'react';

// Configure PDF.js worker — use Vite ?url import for local worker file
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Maximum allowed PDF file size (50 MB) */
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

async function validatePdfBytes(buffer: ArrayBuffer): Promise<boolean> {
  if (buffer.byteLength < 5) return false;
  const header = new TextDecoder().decode(buffer.slice(0, 5));
  return header === '%PDF-';
}

export async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 50 MB.`);
  }
  const arrayBuffer = await file.arrayBuffer();
  if (!await validatePdfBytes(arrayBuffer)) {
    throw new Error('Invalid PDF file: missing PDF magic number header');
  }
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  return await loadingTask.promise;
}

export async function loadPdfFromBytes(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  if (bytes.byteLength > MAX_PDF_SIZE_BYTES) {
    throw new Error(`PDF too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 50 MB.`);
  }
  if (!await validatePdfBytes(bytes)) {
    throw new Error('Invalid PDF file: missing PDF magic number header');
  }
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
  return await loadingTask.promise;
}

export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number,
  renderTaskRef?: React.MutableRefObject<ReturnType<PDFPageProxy['render']> | null>,
): Promise<{ width: number; height: number }> {
  const page: PDFPageProxy = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get canvas 2D context');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  context.scale(dpr, dpr);

  const task = page.render({ canvasContext: context, viewport, canvas } as unknown as Parameters<typeof page.render>[0]);
  if (renderTaskRef) renderTaskRef.current = task;
  await task.promise;
  if (renderTaskRef) renderTaskRef.current = null;

  return { width: viewport.width, height: viewport.height };
}

/**
 * Render a Fabric canvas to an image and embed it into a PDF page.
 * This handles all annotation types uniformly by flattening the canvas.
 */
async function embedCanvasImage(
  pdfDoc: any,
  pageIndex: number,
  canvasDataUrl: string,
  pageWidth: number,
  pageHeight: number,
): Promise<void> {
  const pages = pdfDoc.getPages();
  if (pageIndex >= pages.length) return;
  const page = pages[pageIndex];

  const base64Data = canvasDataUrl.split(',')[1];
  const imageBytes = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0));
  const image = await pdfDoc.embedPng(imageBytes);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });
}

/**
 * Save PDF with annotations flattened from Fabric canvas images.
 * Each page's Fabric canvas is rendered to a transparent PNG overlay
 * and composited onto the original PDF page.
 * Applies page rotations and removes deleted pages.
 */
export async function savePdfWithCanvasOverlays(
  originalFile: File,
  canvasImages: Map<number, { dataUrl: string; width: number; height: number }>,
  pageRotations: Record<number, number> = {},
  deletedPages: number[] = [],
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const arrayBuffer = await originalFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);

  // Apply rotations to pages
  for (const [pageNum, rotation] of Object.entries(pageRotations)) {
    const pageIndex = Number(pageNum) - 1;
    const pages = pdfDoc.getPages();
    if (pageIndex >= pages.length) continue;
    if (rotation) {
      const page = pages[pageIndex];
      page.setRotation(degrees(rotation));
    }
  }

  // Embed canvas overlays
  for (const [pageNum, imageInfo] of canvasImages.entries()) {
    const pageIndex = pageNum - 1; // pageNum is 1-based
    const pages = pdfDoc.getPages();
    if (pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { width: pdfWidth, height: pdfHeight } = page.getSize();

    await embedCanvasImage(
      pdfDoc,
      pageIndex,
      imageInfo.dataUrl,
      pdfWidth,
      pdfHeight,
    );
  }

  // Remove deleted pages (in reverse order to maintain indices)
  const sortedDeletedPages = [...deletedPages].sort((a, b) => b - a);
  for (const pageNum of sortedDeletedPages) {
    const pageIndex = pageNum - 1;
    if (pageIndex >= 0 && pageIndex < pdfDoc.getPageCount()) {
      pdfDoc.removePage(pageIndex);
    }
  }

  return await pdfDoc.save();
}

export function downloadPdf(pdfBytes: Uint8Array, filename: string): void {
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Merge multiple PDFs into a single document.
 * Each entry is { bytes, name } in the desired order.
 * Returns the merged PDF as Uint8Array.
 */
export async function mergePdfs(
  files: { bytes: ArrayBuffer; name: string }[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();

  for (const { bytes } of files) {
    const donor = await PDFDocument.load(bytes);
    const pageIndices = donor.getPageIndices();
    const copiedPages = await merged.copyPages(donor, pageIndices);
    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }

  return await merged.save();
}

/**
 * Get the page count of a PDF from raw bytes (used for merge preview).
 */
export async function getPageCount(bytes: ArrayBuffer): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
