import { useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Canvas as FabricCanvas } from 'fabric';

interface PrintHandlerParams {
  pdfDoc: PDFDocumentProxy | null;
  pdfBytesRef: React.RefObject<ArrayBuffer | null>;
  fabricCanvasRef: React.RefObject<FabricCanvas | null>;
  pageAnnotationsRef: React.RefObject<Map<number, { json: string; zoom: number }>>;
  currentPage: number;
  pageRotations: Record<number, number>;
  deletedPages: number[];
  zoom: number;
  onToast: (msg: string, type?: 'info' | 'error') => void;
  isBusy: boolean;
  setIsBusy: (v: boolean) => void;
  savePageAnnotations: (page: number, json: string, zoom: number) => void;
  getAllPageAnnotations: () => Map<number, { json: string; zoom: number }>;
}

const PRINT_DPI_SCALE = 2;
const BATCH_SIZE = 5;

export function usePrintHandler(params: PrintHandlerParams): () => Promise<void> {
  const {
    pdfDoc,
    fabricCanvasRef,
    currentPage,
    pageRotations,
    deletedPages,
    zoom,
    onToast,
    isBusy,
    setIsBusy,
    savePageAnnotations,
    getAllPageAnnotations,
  } = params;

  return useCallback(async () => {
    // Prevent double-clicks during async print operation
    if (isBusy || !pdfDoc) {
      if (!isBusy && !pdfDoc) window.print();
      return;
    }
    setIsBusy(true);

    // Flush current page's raw annotations before print
    if (fabricCanvasRef.current) {
      const rawJson = JSON.stringify(fabricCanvasRef.current.toJSON());
      savePageAnnotations(currentPage, rawJson, zoom);
    }

    const allAnnotations = getAllPageAnnotations();
    const printWindow = window.open('', '_blank', 'noopener');
    if (!printWindow) {
      window.print();
      return;
    }

    const doc = printWindow.document;
    doc.open();
    const html = doc.createElement('html');
    const head = doc.createElement('head');
    const title = doc.createElement('title');
    title.textContent = 'Print PDF';
    head.appendChild(title);
    const style = doc.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; }
      body { background: white; }
      .print-page { position: relative; page-break-after: always; }
      .print-page:last-child { page-break-after: auto; }
      .print-page img { display: block; }
      .overlay-img { position: absolute; top: 0; left: 0; pointer-events: none; }
      @media print { .print-page { page-break-after: always; } .print-page:last-child { page-break-after: auto; } }
    `;
    head.appendChild(style);
    html.appendChild(head);
    const body = doc.createElement('body');

    try {
      const { Canvas: TempFabric } = await import('fabric');

      // Process pages in batches to limit memory usage
      const pageNumbers = [];
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        if (!deletedPages.includes(p)) {
          pageNumbers.push(p);
        }
      }

      for (let batchStart = 0; batchStart < pageNumbers.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, pageNumbers.length);
        const batch = pageNumbers.slice(batchStart, batchEnd);

        for (const p of batch) {
          const rot = pageRotations[p] || 0;
          const page = await pdfDoc.getPage(p);
          // Render at scale 1.0 for base dimensions
          const baseViewport = page.getViewport({ scale: 1.0, rotation: rot });
          // Use PRINT_DPI_SCALE for print quality
          const printViewport = page.getViewport({ scale: PRINT_DPI_SCALE, rotation: rot });

          // Render PDF page at print quality
          const pdfCanvas = document.createElement('canvas');
          pdfCanvas.width = printViewport.width;
          pdfCanvas.height = printViewport.height;
          const ctx = pdfCanvas.getContext('2d')!;
          await page.render({
            canvasContext: ctx,
            viewport: printViewport,
            canvas: pdfCanvas,
          } as unknown as Parameters<typeof page.render>[0]).promise;

          // Use CSS size matching base viewport for consistent page sizing
          const cssW = baseViewport.width;
          const cssH = baseViewport.height;

          const printPageDiv = doc.createElement('div');
          printPageDiv.className = 'print-page';
          printPageDiv.style.cssText = `width:${cssW}px;height:${cssH}px;`;

          const pdfDataUrl = pdfCanvas.toDataURL('image/png');
          const pdfImg = doc.createElement('img');
          pdfImg.src = pdfDataUrl;
          pdfImg.style.cssText = `width:${cssW}px;height:${cssH}px;`;
          printPageDiv.appendChild(pdfImg);

          // Render annotation overlay at stored zoom dimensions (no JSON transform)
          const annotEntry = allAnnotations.get(p);
          if (annotEntry) {
            let tc: InstanceType<typeof TempFabric> | null = null;
            try {
              const parsed = JSON.parse(annotEntry.json);
              if (parsed.objects && parsed.objects.length > 0) {
                // Render at stored zoom dimensions — matches raw JSON coords
                const storedViewport = page.getViewport({ scale: annotEntry.zoom, rotation: rot });
                const tempCanvas = doc.createElement('canvas');
                tc = new TempFabric(tempCanvas, {
                  width: storedViewport.width,
                  height: storedViewport.height,
                });
                // Load raw JSON as-is
                await tc.loadFromJSON(annotEntry.json);
                tc.renderAll();
                const overlayUrl = tc.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
                // CSS stretches the overlay image to match the base viewport
                const overlayImg = doc.createElement('img');
                overlayImg.className = 'overlay-img';
                overlayImg.src = overlayUrl;
                overlayImg.style.cssText = `width:${cssW}px;height:${cssH}px;`;
                printPageDiv.appendChild(overlayImg);
              }
            } catch (error) {
              console.warn('[Redline]', error);
            } finally {
              if (tc) {
                tc.dispose();
                // Clean up DOM element
                const canvasEl = tc.getElement();
                if (canvasEl?.parentNode) {
                  canvasEl.parentNode.removeChild(canvasEl);
                }
                tc = null;
              }
            }
          }
          body.appendChild(printPageDiv);

          // C9 FIX: Yield after EVERY page to keep UI responsive
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      html.appendChild(body);
      doc.appendChild(html);
      doc.close();
      // Wait for images to load then trigger print
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
        }, 300);
      };
    } catch (error) {
      console.error('Print error:', error);
      printWindow.close();
      onToast(
        `Print preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setIsBusy(false);
    }
  }, [
    isBusy,
    pdfDoc,
    currentPage,
    zoom,
    pageRotations,
    deletedPages,
    savePageAnnotations,
    getAllPageAnnotations,
    fabricCanvasRef,
    onToast,
    setIsBusy,
  ]);
}
