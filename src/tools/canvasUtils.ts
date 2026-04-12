import type { Canvas as FabricCanvas } from 'fabric';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Deep freeze an object to prevent modification and prototype pollution
 */
function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * Render PDF page to canvas with DPI awareness
 */
export async function renderPdfPage(
  pdfDoc: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement,
  zoom: number,
  rotation: number,
  renderTaskRef: React.MutableRefObject<{ cancel: () => void } | null>,
  isMounted: () => boolean
): Promise<{ width: number; height: number; baseWidth: number; baseHeight: number } | null> {
  if (!canvas || !isMounted()) return null;

  if (renderTaskRef.current) {
    try { renderTaskRef.current.cancel(); } catch { /* already done */ }
    renderTaskRef.current = null;
  }

  try {
    const page = await pdfDoc.getPage(pageNum);
    // Apply rotation to the viewport
    const viewport = page.getViewport({ scale: zoom, rotation });

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to get canvas 2D context');

    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.scale(dpr, dpr);

    const task = page.render({
      canvasContext: context,
      viewport,
      canvas,
    } as unknown as Parameters<typeof page.render>[0]);

    if (renderTaskRef) renderTaskRef.current = task;
    await task.promise;
    if (renderTaskRef) renderTaskRef.current = null;

    // Only return if still mounted
    if (isMounted()) {
      const baseViewport = page.getViewport({ scale: 1.0, rotation });
      return {
        width: viewport.width,
        height: viewport.height,
        baseWidth: baseViewport.width,
        baseHeight: baseViewport.height,
      };
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('cancelled')) return null;
    throw err;
  }
}

/**
 * Initialize Fabric canvas and restore annotations
 */
export async function initializeFabricCanvas(
  fabricModule: typeof import('fabric'),
  canvasEl: HTMLCanvasElement,
  pageSize: { width: number; height: number },
  savedAnnotations: { json: string; zoom: number } | undefined,
  currentZoom: number,
  onCanvasReady?: (canvas: FabricCanvas) => void
): Promise<FabricCanvas> {
  // Create Fabric canvas from the programmatic element
  const fc = new fabricModule.Canvas(canvasEl, {
    width: pageSize.width,
    height: pageSize.height,
    selection: true,
    enableRetinaScaling: true,
  });

  onCanvasReady?.(fc);

  // Restore saved annotations for this page.
  // Annotations are stored raw at whatever zoom they were created at, along
  // with the zoom level. To load them into the current zoom, we scale ALL
  // object properties by (currentZoom / storedZoom).
  if (savedAnnotations) {
    try {
      const zoomRatio = savedAnnotations.zoom > 0 ? currentZoom / savedAnnotations.zoom : 1;
      // Parse and deep-freeze annotation data to prevent prototype pollution
      const parsedAnnotations = JSON.parse(savedAnnotations.json);
      const frozenAnnotations = deepFreeze(parsedAnnotations);
      await fc.loadFromJSON(frozenAnnotations);
      if (Math.abs(zoomRatio - 1) > 0.001) {
        fc.forEachObject((obj) => {
          obj.set({
            left: (obj.left ?? 0) * zoomRatio,
            top: (obj.top ?? 0) * zoomRatio,
            scaleX: (obj.scaleX ?? 1) * zoomRatio,
            scaleY: (obj.scaleY ?? 1) * zoomRatio,
          });
          obj.setCoords();
        });
      }
      fc.renderAll();
    } catch {
      // Failed to restore annotations, continue without them
    }
  }

  return fc;
}

/**
 * Setup annotation change listeners
 */
export function setupAnnotationListeners(
  canvas: FabricCanvas,
  pageNum: number,
  savedZoomRef: React.MutableRefObject<number>,
  liveCanvasJsonRef: React.MutableRefObject<{ json: string; zoom: number } | undefined>,
  onAnnotationsChange?: (pageNum: number, json: string, zoom: number) => void,
  onModified?: () => void,
  onAnnounce?: (message: string) => void
): () => void {
  const emitChange = () => {
    const rawJson = JSON.stringify(canvas.toJSON());
    liveCanvasJsonRef.current = { json: rawJson, zoom: savedZoomRef.current };
    onAnnotationsChange?.(pageNum, rawJson, savedZoomRef.current);
    onModified?.();
  };

  const handleAdded = () => {
    emitChange();
    onAnnounce?.('Annotation added');
  };

  const handleModified = () => {
    emitChange();
    onAnnounce?.('Annotation modified');
  };

  const handleRemoved = () => {
    emitChange();
    onAnnounce?.('Annotation removed');
  };

  const handlePathCreated = () => {
    emitChange();
    onAnnounce?.('Annotation added');
  };

  canvas.on('object:modified', handleModified);
  canvas.on('object:added', handleAdded);
  canvas.on('object:removed', handleRemoved);
  canvas.on('path:created', handlePathCreated);

  return () => {
    canvas.off('object:modified', handleModified);
    canvas.off('object:added', handleAdded);
    canvas.off('object:removed', handleRemoved);
    canvas.off('path:created', handlePathCreated);
  };
}
