import { useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Canvas as FabricCanvas } from 'fabric';
import { savePdfWithCanvasOverlays, downloadPdf } from '../services/pdfService';

interface SaveHandlerParams {
  file: File | null;
  pdfDoc: PDFDocumentProxy | null;
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

      for (const [pageNum, entry] of allAnnotations.entries()) {
        try {
          const parsed = JSON.parse(entry.json);
          if (!parsed.objects || parsed.objects.length === 0) continue;

          const page = await pdfDoc.getPage(pageNum);
          const rotation = pageRotations[pageNum] || 0;
          const storedViewport = page.getViewport({ scale: entry.zoom, rotation });
          const baseViewport = page.getViewport({ scale: 1.0, rotation });

          const tempCanvas = document.createElement('canvas');
          let tc: InstanceType<typeof TempFabric> | null = null;
          try {
            tc = new TempFabric(tempCanvas, {
              width: storedViewport.width,
              height: storedViewport.height,
            });
            await tc.loadFromJSON(entry.json);
            tc.renderAll();
            const dataUrl = tc.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
            canvasImages.set(pageNum, {
              dataUrl,
              width: baseViewport.width,
              height: baseViewport.height,
            });
          } finally {
            if (tc) {
              tc.dispose();
              // Clean up DOM element
              const canvasEl = tc.getElement();
              if (canvasEl?.parentNode) {
                canvasEl.parentNode.removeChild(canvasEl);
              }
              tc = null as any;
            }
          }
        } catch (error) {
          console.warn('[Redline]', error);
        }
      }

      if (canvasImages.size === 0) {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const name = file.name.replace('.pdf', '-edited.pdf');
        downloadPdf(bytes, name);
        return;
      }

      const pdfBytes = await savePdfWithCanvasOverlays(file, canvasImages, pageRotations, deletedPages);
      const name = file.name.replace('.pdf', '-edited.pdf');
      downloadPdf(pdfBytes, name);
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
