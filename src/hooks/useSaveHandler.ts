import { useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Canvas as FabricCanvas } from 'fabric';
import { savePdfWithCanvasOverlays, downloadPdf } from '../services/pdfService';

interface SaveHandlerParams {
  file: File | null;
  pdfDoc: PDFDocumentProxy | null;
  pdfBytesRef: React.RefObject<ArrayBuffer | null>;
  fabricCanvasRef: React.RefObject<FabricCanvas | null>;
  currentPage: number;
  zoom: number;
  pageRotations: Record<number, number>;
  deletedPages: number[];
  isBusy: boolean;
  setIsBusy: (v: boolean) => void;
  savePageAnnotations: (page: number, json: string, zoom: number) => void;
  getAllPageAnnotations: () => Map<number, { json: string; zoom: number }>;
  onToast: (msg: string, type?: 'info' | 'error') => void;
}

export function useSaveHandler(params: SaveHandlerParams): () => Promise<void> {
  const {
    file,
    pdfDoc,
    pdfBytesRef,
    fabricCanvasRef,
    currentPage,
    zoom,
    pageRotations,
    deletedPages,
    isBusy,
    setIsBusy,
    savePageAnnotations,
    getAllPageAnnotations,
    onToast,
  } = params;

  return useCallback(async () => {
    if (isBusy || !file || !pdfDoc) return;
    setIsBusy(true);

    try {
      if (fabricCanvasRef.current) {
        const rawJson = JSON.stringify(fabricCanvasRef.current.toJSON());
        savePageAnnotations(currentPage, rawJson, zoom);
      }

      const canvasImages = new Map<number, { dataUrl: string; width: number; height: number }>();
      const allAnnotations = getAllPageAnnotations();
      const { Canvas: TempFabric } = await import('fabric');

      // Create a hidden DOM-attached canvas for Fabric.js 7.x compatibility
      const tempCanvas = document.createElement('canvas');
      tempCanvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
      document.body.appendChild(tempCanvas);
      let reusableCanvas: InstanceType<typeof TempFabric> | null = null;

      try {
        let pageCount = 0;
        for (const [pageNum, entry] of allAnnotations.entries()) {
          // Yield every page to prevent UI freeze
          if (pageCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          pageCount++;
          try {
            const parsed = JSON.parse(entry.json);
            if (!parsed.objects || parsed.objects.length === 0) continue;

            const page = await pdfDoc.getPage(pageNum);
            const rotation = pageRotations[pageNum] || 0;
            const storedViewport = page.getViewport({ scale: entry.zoom, rotation });
            const baseViewport = page.getViewport({ scale: 1.0, rotation });

            // Create canvas on first use, reuse for subsequent pages
            if (!reusableCanvas) {
              reusableCanvas = new TempFabric(tempCanvas, {
                width: storedViewport.width,
                height: storedViewport.height,
              });
            } else {
              // Resize and clear for next page
              reusableCanvas.setDimensions({
                width: storedViewport.width,
                height: storedViewport.height,
              });
              reusableCanvas.clear();
            }

            await reusableCanvas.loadFromJSON(entry.json);
            reusableCanvas.renderAll();
            const dataUrl = reusableCanvas.toDataURL({ format: 'png', quality: 1, multiplier: 3 });
            canvasImages.set(pageNum, {
              dataUrl,
              width: baseViewport.width,
              height: baseViewport.height,
            });
          } catch (error) {
            console.warn('[Redline]', error);
          }
        }
      } finally {
        // Grab the element ref BEFORE dispose (Fabric 7.x nullifies internals on dispose)
        const canvasEl = tempCanvas;
        if (reusableCanvas) {
          try { reusableCanvas.dispose(); } catch { /* already disposed */ }
          reusableCanvas = null;
        }
        if (canvasEl.parentNode) {
          canvasEl.parentNode.removeChild(canvasEl);
        }
      }

      // Use pdfBytesRef (raw bytes) as the source of truth — avoids stale File handles
      // and synthetic File objects from session restore / merge that may fail .arrayBuffer()
      const sourceBytes = pdfBytesRef.current ?? await file.arrayBuffer();

      if (canvasImages.size === 0) {
        const bytes = new Uint8Array(sourceBytes);
        const name = file.name.replace('.pdf', '-edited.pdf');
        await downloadPdf(bytes, name);
        return;
      }

      const pdfBytes = await savePdfWithCanvasOverlays(sourceBytes, canvasImages, pageRotations, deletedPages);
      const name = file.name.replace('.pdf', '-edited.pdf');
      await downloadPdf(pdfBytes, name);
    } catch (error) {
      console.error('Save error:', error);
      onToast(`Failed to save PDF: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setIsBusy(false);
    }
  }, [
    isBusy,
    file,
    pdfDoc,
    pdfBytesRef,
    fabricCanvasRef,
    currentPage,
    zoom,
    pageRotations,
    deletedPages,
    setIsBusy,
    savePageAnnotations,
    getAllPageAnnotations,
    onToast,
  ]);
}
