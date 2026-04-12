import { useRef, useEffect, useCallback, useState, lazy, Suspense } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Tool, ToolConfig } from '../types';
import {
  setupDragRect,
  setupDragShape,
  setupDragCircle,
  setupDragArrow,
  setupStampTool,
  setupCheckboxTool,
  setupDateTool,
  renderPdfPage,
  initializeFabricCanvas,
  setupAnnotationListeners,
} from '../tools';
const SignatureModal = lazy(() => import('./SignatureModal').then(m => ({ default: m.SignatureModal })));

// Lazy load Fabric.js module
let fabricModule: typeof import('fabric') | null = null;
async function getFabric() {
  if (!fabricModule) {
    fabricModule = await import('fabric');
  }
  return fabricModule;
}

// Constants
const IMAGE_DEFAULT_WIDTH = 200;

/**
 * Annotation Data Flow Architecture:
 *
 * 1. LIVE STATE: Fabric.js canvas owns the live annotation objects.
 *    This is the single source of truth while the user is editing.
 *
 * 2. SERIALIZED SNAPSHOTS: When annotations change, canvas.toJSON()
 *    serializes them to liveCanvasJsonRef (immediate) and
 *    onAnnotationsChange callback (debounced to parent).
 *
 * 3. RESTORE: When switching pages, savedAnnotations prop provides
 *    the serialized JSON to restore into a fresh Fabric canvas.
 *
 * This dual representation is required because Fabric.js is imperative
 * and React is declarative — refs bridge the gap.
 */

// Interface for accessing Fabric.js IText internal textarea (Issue 1)
interface FabricITextWithTextarea {
  hiddenTextarea?: HTMLTextAreaElement;
}

interface PageCanvasProps {
  pageNum: number;
  pdfDoc: PDFDocumentProxy;
  zoom: number;
  activeTool: Tool;
  toolConfig: ToolConfig;
  savedAnnotations?: { json: string; zoom: number };
  rotation?: number;
  onCanvasReady?: (canvas: FabricCanvas) => void;
  onModified?: () => void;
  onAnnotationsChange?: (pageNum: number, json: string, zoom: number) => void;
  onToast?: (message: string, type: 'error' | 'info') => void;
}

export function PageCanvas({
  pageNum,
  pdfDoc,
  zoom,
  activeTool,
  toolConfig,
  savedAnnotations,
  rotation = 0,
  onCanvasReady,
  onModified,
  onAnnotationsChange,
  onToast,
}: PageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const fabricWrapperRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const savedZoomRef = useRef<number>(zoom);
  const annotationsRestoredRef = useRef(false);
  // Track previous active tool so one-time side-effects (file picker, signature
  // modal) only fire when the user explicitly switches TO that tool, not on
  // component remount due to page change.
  const prevActiveToolRef = useRef(activeTool);
  // Ref to carry live canvas state from effect cleanup → setup on zoom changes.
  // The `savedAnnotations` prop is stale during setup because React reads it
  // during render (before cleanup runs), so cleanup's save never reaches setup.
  const liveCanvasJsonRef = useRef<{ json: string; zoom: number } | undefined>(savedAnnotations);

  // Track in-flight render to cancel on re-render
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  // Track mounted state to prevent state updates after unmount (Issue 3)
  const isMountedRef = useRef(true);
  // Track in-flight canvas initialization to cancel on rapid page switches (Critical #7)
  const initAbortRef = useRef<AbortController | null>(null);

  // Track tool announcement for screen readers (Issue 4)
  const [toolAnnouncement, setToolAnnouncement] = useState('');
  // Track annotation changes for screen readers (WCAG 4.1.3)
  const [announcement, setAnnouncement] = useState('');

  // Render PDF page to background canvas
  const renderPdf = useCallback(async () => {
    if (!pdfCanvasRef.current) return;
    const result = await renderPdfPage(
      pdfDoc,
      pageNum,
      pdfCanvasRef.current,
      zoom,
      rotation,
      renderTaskRef,
      () => isMountedRef.current
    );
    if (result) {
      setPageSize(result);
    }
  }, [pdfDoc, pageNum, zoom, rotation]);

  useEffect(() => {
    isMountedRef.current = true;
    renderPdf();
    return () => {
      isMountedRef.current = false;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* already done */ }
        renderTaskRef.current = null;
      }
    };
  }, [renderPdf]);

  // Create / recreate fabric canvas when page size changes
  useEffect(() => {
    if (!pageSize || !fabricWrapperRef.current) return;

    // Dispose old canvas
    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    // Clear any leftover DOM from previous Fabric instance
    const wrapper = fabricWrapperRef.current;
    wrapper.replaceChildren();

    // Create a fresh canvas element (not managed by React)
    const canvasEl = document.createElement('canvas');
    // Don't set canvasEl.width/height — let Fabric handle physical pixels via enableRetinaScaling
    wrapper.appendChild(canvasEl);

    // Initialize Fabric canvas asynchronously
    let fc: FabricCanvas | null = null;
    let mounted = true;

    // Abort any previous initialization to prevent race conditions (Critical #7)
    if (initAbortRef.current) {
      initAbortRef.current.abort();
    }
    const abortController = new AbortController();
    initAbortRef.current = abortController;

    getFabric().then(async (fabric) => {
      if (!mounted || abortController.signal.aborted) return;

      fc = await initializeFabricCanvas(
        fabric,
        canvasEl,
        pageSize,
        liveCanvasJsonRef.current,
        zoom,
        onCanvasReady
      );

      if (abortController.signal.aborted) return;

      fabricRef.current = fc;
      savedZoomRef.current = zoom;
      annotationsRestoredRef.current = true;

      // Setup annotation change listeners
      setupAnnotationListeners(
        fc,
        pageNum,
        savedZoomRef,
        liveCanvasJsonRef,
        onAnnotationsChange,
        onModified,
        setAnnouncement
      );
    });

    return () => {
      mounted = false;
      abortController.abort();
      // Save raw annotations + zoom before disposing
      if (fabricRef.current) {
        const rawJson = JSON.stringify(fabricRef.current.toJSON());
        liveCanvasJsonRef.current = { json: rawJson, zoom: savedZoomRef.current };
        onAnnotationsChange?.(pageNum, rawJson, savedZoomRef.current);
      }
      if (fc) {
        fc.off('object:modified');
        fc.off('object:added');
        fc.off('object:removed');
        fc.off('path:created');
        fc.off('mouse:down');
        fc.off('mouse:move');
        fc.off('mouse:up');
        fc.clear();
        fc.dispose();
      }
      fabricRef.current = null;
      wrapper.replaceChildren();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // Configure tool behavior on tool/config change
  const dragRafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Cancel any in-flight RAF from previous tool
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }

    canvas.isDrawingMode = false;
    canvas.selection = activeTool === 'select';
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

    // Objects are always selectable/movable
    canvas.forEachObject((obj) => { obj.selectable = true; });

    // Track cleanup function for drag tools
    let dragToolCleanup: (() => void) | null = null;

    const setupTools = async () => {
      const fabric = await getFabric();

      switch (activeTool) {
        case 'select':
          break;

        case 'text':
          canvas.on('mouse:down', (opt) => {
            if (opt.target) return;
            const pt = canvas.getScenePoint(opt.e);
            const text = new fabric.IText('Type here', {
              left: pt.x,
              top: pt.y,
              originX: 'left',
              originY: 'bottom',
              fontSize: toolConfig.fontSize,
              fontFamily: toolConfig.fontFamily,
              fontWeight: toolConfig.bold ? 'bold' : 'normal',
              fontStyle: toolConfig.italic ? 'italic' : 'normal',
              underline: toolConfig.underline,
              fill: toolConfig.color,
              stroke: toolConfig.color,
              strokeWidth: 0.5,
              paintFirst: 'stroke',
              selectable: true,
              editable: true,
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            // Defer editing entry past Fabric's full mouse event cycle (mouse:down → mouse:up).
            // A single requestAnimationFrame isn't enough because Fabric's mouse:up fires
            // after the first frame and can steal focus. Using setTimeout(0) ensures we run
            // after Fabric's entire event pipeline completes.
            setTimeout(() => {
              text.enterEditing();
              text.selectAll();
              // Ensure the hidden textarea has focus for keyboard capture (Issue 1)
              const hiddenInput = (text as FabricITextWithTextarea).hiddenTextarea;
              hiddenInput?.focus();
            }, 0);
          });
          break;

        case 'draw': {
          canvas.isDrawingMode = true;
          const brush = new fabric.PencilBrush(canvas);
          brush.width = toolConfig.lineWidth;
          brush.color = toolConfig.color;
          canvas.freeDrawingBrush = brush;
          break;
        }

        case 'highlight':
          dragToolCleanup = setupDragRect({
            canvas,
            color: toolConfig.color || '#FFFF00',
            opacity: toolConfig.opacity,
            strokeWidth: toolConfig.lineWidth,
            rafRef: dragRafRef,
          });
          break;

        case 'redact':
          dragToolCleanup = setupDragRect({
            canvas,
            color: '#000000',
            opacity: 1.0,
            strokeWidth: toolConfig.lineWidth,
            rafRef: dragRafRef,
          });
          break;

        case 'arrow':
          dragToolCleanup = setupDragArrow({
            canvas,
            color: toolConfig.color,
            opacity: toolConfig.opacity,
            strokeWidth: toolConfig.lineWidth,
            rafRef: dragRafRef,
          });
          break;

        case 'circle':
          dragToolCleanup = setupDragCircle({
            canvas,
            color: toolConfig.color,
            opacity: toolConfig.opacity,
            strokeWidth: toolConfig.lineWidth,
            rafRef: dragRafRef,
          });
          break;

        case 'stamp':
          dragToolCleanup = setupStampTool({
            canvas,
            stampType: toolConfig.stampType,
          });
          break;

        case 'checkbox':
          dragToolCleanup = setupCheckboxTool({
            canvas,
            checkboxStyle: toolConfig.checkboxStyle,
          });
          break;

        case 'date':
          dragToolCleanup = setupDateTool({
            canvas,
            fontSize: toolConfig.fontSize,
            fontFamily: toolConfig.fontFamily,
            color: toolConfig.color,
          });
          break;

        case 'shape':
          dragToolCleanup = setupDragShape({
            canvas,
            color: toolConfig.color,
            opacity: toolConfig.opacity,
            strokeWidth: toolConfig.lineWidth,
            rafRef: dragRafRef,
          });
          break;

        case 'eraser':
          canvas.on('mouse:down', (opt) => {
            if (opt.target) {
              canvas.remove(opt.target);
              canvas.renderAll();
            }
          });
          break;

        case 'signature':
          // Only open modal when user explicitly switches to this tool, not on remount
          if (prevActiveToolRef.current !== 'signature') {
            setSignatureOpen(true);
          }
          break;

        case 'image':
          // Only trigger file picker when user explicitly switches to this tool,
          // not when PageCanvas remounts due to page navigation
          if (prevActiveToolRef.current !== 'image') {
            imageInputRef.current?.click();
          }
          break;
      }
      prevActiveToolRef.current = activeTool;
    };

    setupTools();

    return () => {
      // Cancel any in-flight drag RAF on cleanup (tool change or unmount)
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      // Clean up drag tool event listeners
      if (dragToolCleanup) {
        dragToolCleanup();
      }
    };
  }, [activeTool, toolConfig, onModified]);

  // Announce tool changes to screen readers (Issue 4)
  useEffect(() => {
    const name = activeTool.charAt(0).toUpperCase() + activeTool.slice(1);
    setToolAnnouncement(`Tool changed to ${name}`);
    const timer = setTimeout(() => setToolAnnouncement(''), 1000);
    return () => clearTimeout(timer);
  }, [activeTool]);

  // Clear announcements after 3 seconds to ensure repeated actions trigger
  useEffect(() => {
    if (announcement) {
      const timer = setTimeout(() => setAnnouncement(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  // Signature save
  const handleSignatureSave = async (dataUrl: string) => {
    setSignatureOpen(false);
    if (!fabricRef.current) return;
    const fabric = await getFabric();
    fabric.Image.fromURL(dataUrl).then((img) => {
      img.scaleToWidth(IMAGE_DEFAULT_WIDTH);
      fabricRef.current?.add(img);
      fabricRef.current?.renderAll();
    });
  };

  // Image upload
  const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !fabricRef.current) return;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      onToast?.(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`, 'error');
      e.target.value = '';
      return;
    }
    const fabric = await getFabric();
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      fabric.Image.fromURL(url).then((img) => {
        img.scaleToWidth(IMAGE_DEFAULT_WIDTH);
        fabricRef.current?.add(img);
        fabricRef.current?.renderAll();
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  /** Get canvas overlay as transparent PNG data URL for PDF save */
  const getCanvasOverlay = useCallback((): { dataUrl: string; width: number; height: number } | null => {
    if (!fabricRef.current || !pageSize) return null;
    const dataUrl = fabricRef.current.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 1,
    });
    return { dataUrl, width: pageSize.width, height: pageSize.height };
  }, [pageSize]);

  // Expose getCanvasOverlay via onCanvasReady by attaching to the canvas
  useEffect(() => {
    const canvas = fabricRef.current;
    if (canvas) {
      (canvas as FabricCanvas & { getOverlay?: typeof getCanvasOverlay }).getOverlay = getCanvasOverlay;
    }
  }, [getCanvasOverlay]);

  return (
    <div ref={containerRef} className="page-container" style={{ width: pageSize?.width, height: pageSize?.height }}>
      <canvas
        ref={pdfCanvasRef}
        aria-label={`PDF background, page ${pageNum}`}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }}
      />
      <div
        ref={fabricWrapperRef}
        role="img"
        aria-label={`Annotation layer, page ${pageNum}`}
        aria-roledescription="annotation canvas"
        tabIndex={0}
        style={{ position: 'absolute', top: 0, left: 0, zIndex: 2, width: pageSize?.width, height: pageSize?.height }}
      />
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {toolAnnouncement}
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
        }}
      >
        {announcement}
      </div>
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
      {signatureOpen && (
        <Suspense fallback={null}>
          <SignatureModal onSave={handleSignatureSave} onCancel={() => setSignatureOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
