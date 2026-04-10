import { useRef, useEffect, useCallback, useState, lazy, Suspense } from 'react';
import {
  Canvas as FabricCanvas,
  IText,
  Rect,
  Circle,
  Image as FabricImage,
  PencilBrush,
  Line,
  Polygon,
  Group,
} from 'fabric';
import type { FabricObject } from 'fabric';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Tool, ToolConfig } from '../types';
const SignatureModal = lazy(() => import('./SignatureModal').then(m => ({ default: m.SignatureModal })));

// Constants
const IMAGE_DEFAULT_WIDTH = 200;
const STAMP_FONT_SIZE = 28;
const CHECKBOX_SIZE = 22;

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

  // Track tool announcement for screen readers (Issue 4)
  const [toolAnnouncement, setToolAnnouncement] = useState('');

  // Render PDF page to background canvas
  const renderPdf = useCallback(async () => {
    if (!pdfCanvasRef.current || !isMountedRef.current) return;
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* already done */ }
      renderTaskRef.current = null;
    }
    try {
      const page = await pdfDoc.getPage(pageNum);
      // Apply rotation to the viewport
      const viewport = page.getViewport({ scale: zoom, rotation });

      const context = pdfCanvasRef.current.getContext('2d');
      if (!context) throw new Error('Failed to get canvas 2D context');

      const dpr = window.devicePixelRatio || 1;
      pdfCanvasRef.current.width = viewport.width * dpr;
      pdfCanvasRef.current.height = viewport.height * dpr;
      pdfCanvasRef.current.style.width = `${viewport.width}px`;
      pdfCanvasRef.current.style.height = `${viewport.height}px`;
      context.scale(dpr, dpr);

      const task = page.render({ canvasContext: context, viewport, canvas: pdfCanvasRef.current } as unknown as Parameters<typeof page.render>[0]);
      if (renderTaskRef) renderTaskRef.current = task;
      await task.promise;
      if (renderTaskRef) renderTaskRef.current = null;

      // Only update state if still mounted (Issue 3)
      if (isMountedRef.current) {
        setPageSize({ width: viewport.width, height: viewport.height });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('cancelled')) return;
      throw err;
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

    // Create Fabric canvas from the programmatic element
    const fc = new FabricCanvas(canvasEl, {
      width: pageSize.width,
      height: pageSize.height,
      selection: true,
      enableRetinaScaling: true,
    });

    fabricRef.current = fc;
    onCanvasReady?.(fc);

    // Restore saved annotations for this page.
    // Annotations are stored raw at whatever zoom they were created at, along
    // with the zoom level. To load them into the current zoom, we scale ALL
    // object properties by (currentZoom / storedZoom).
    const stored = liveCanvasJsonRef.current;
    annotationsRestoredRef.current = false;
    let mounted = true;
    if (stored) {
      try {
        const zoomRatio = stored.zoom > 0 ? zoom / stored.zoom : 1;
        fc.loadFromJSON(stored.json).then(() => {
          if (!mounted) return;
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
          savedZoomRef.current = zoom;
          annotationsRestoredRef.current = true;
          fc.renderAll();
        });
      } catch {
        savedZoomRef.current = zoom;
      }
    } else {
      savedZoomRef.current = zoom;
    }

    // Emit annotation changes on every modification — store raw JSON + current zoom
    const emitChange = () => {
      if (!fabricRef.current) return;
      const rawJson = JSON.stringify(fabricRef.current.toJSON());
      liveCanvasJsonRef.current = { json: rawJson, zoom: savedZoomRef.current };
      onAnnotationsChange?.(pageNum, rawJson, savedZoomRef.current);
      onModified?.();
    };

    fc.on('object:modified', emitChange);
    fc.on('object:added', emitChange);
    fc.on('object:removed', emitChange);
    fc.on('path:created', emitChange);

    return () => {
      mounted = false;
      // Save raw annotations + zoom before disposing
      if (fabricRef.current) {
        const rawJson = JSON.stringify(fabricRef.current.toJSON());
        liveCanvasJsonRef.current = { json: rawJson, zoom: savedZoomRef.current };
        onAnnotationsChange?.(pageNum, rawJson, savedZoomRef.current);
      }
      fc.off('object:modified');
      fc.off('object:added');
      fc.off('object:removed');
      fc.off('path:created');
      fc.off('mouse:down');
      fc.off('mouse:move');
      fc.off('mouse:up');
      fc.clear();
      fc.dispose();
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

    switch (activeTool) {
      case 'select':
        break;

      case 'text':
        canvas.on('mouse:down', (opt) => {
          if (opt.target) return;
          const pt = canvas.getScenePoint(opt.e);
          const text = new IText('Type here', {
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
        const brush = new PencilBrush(canvas);
        brush.width = toolConfig.lineWidth;
        brush.color = toolConfig.color;
        canvas.freeDrawingBrush = brush;
        break;
      }

      case 'highlight':
        setupDragRect(canvas, toolConfig.color || '#FFFF00', toolConfig.opacity, dragRafRef);
        break;

      case 'redact':
        setupDragRect(canvas, '#000000', 1.0, dragRafRef);
        break;

      case 'arrow':
        setupDragArrow(canvas, toolConfig.color, toolConfig.lineWidth, dragRafRef);
        break;

      case 'circle':
        setupDragCircle(canvas, toolConfig.color, toolConfig.lineWidth, dragRafRef);
        break;

      case 'stamp':
        canvas.on('mouse:down', (opt) => {
          if (opt.target) return;
          const pt = canvas.getScenePoint(opt.e);
          const stampColors: Record<string, string> = {
            approved: '#22c55e',
            draft: '#f59e0b',
            confidential: '#ef4444',
            urgent: '#dc2626',
            void: '#b91c1c',
          };
          const stampType = toolConfig.stampType || 'approved';
          const color = stampColors[stampType] || '#ef4444';
          const stamp = new IText(stampType.toUpperCase(), {
            left: pt.x,
            top: pt.y,
            fontSize: STAMP_FONT_SIZE,
            fontFamily: 'Arial',
            fontWeight: 'bold',
            fill: color,
            stroke: color,
            strokeWidth: 1,
            paintFirst: 'stroke',
            padding: 8,
            angle: stampType === 'void' ? -30 : 0,
          });
          canvas.add(stamp);
        });
        break;

      case 'checkbox':
        canvas.on('mouse:down', (opt) => {
          if (opt.target) return;
          const pt = canvas.getScenePoint(opt.e);
          const size = CHECKBOX_SIZE;

          // Draw just the mark on a temp canvas with DPI awareness, then add as image
          const dpr = window.devicePixelRatio || 1;
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = (size + 4) * dpr;
          tempCanvas.height = (size + 4) * dpr;
          const ctx = tempCanvas.getContext('2d')!;
          ctx.scale(dpr, dpr);

          // Draw mark only (no surrounding box)
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          if (toolConfig.checkboxStyle === 'x') {
            ctx.moveTo(4, 4);
            ctx.lineTo(size, size);
            ctx.moveTo(size, 4);
            ctx.lineTo(4, size);
          } else {
            ctx.moveTo(4, 2 + size / 2);
            ctx.lineTo(2 + size * 0.38, size - 1);
            ctx.lineTo(size, 5);
          }
          ctx.stroke();

          // Convert to Fabric image
          const dataUrl = tempCanvas.toDataURL();
          FabricImage.fromURL(dataUrl).then((img) => {
            img.set({
              left: pt.x,
              top: pt.y,
              selectable: true,
            });
            canvas.add(img);
            canvas.renderAll();
          });
        });
        break;

      case 'date':
        canvas.on('mouse:down', (opt) => {
          if (opt.target) return;
          const pt = canvas.getScenePoint(opt.e);
          const today = new Date().toLocaleDateString();
          const text = new IText(today, {
            left: pt.x,
            top: pt.y,
            originX: 'left',
            originY: 'bottom',
            fontSize: toolConfig.fontSize,
            fontFamily: toolConfig.fontFamily,
            fill: toolConfig.color,
            stroke: toolConfig.color,
            strokeWidth: 0.5,
            paintFirst: 'stroke',
          });
          canvas.add(text);
        });
        break;

      case 'shape':
        setupDragShape(canvas, toolConfig.color, toolConfig.lineWidth, dragRafRef);
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

    return () => {
      // Cancel any in-flight drag RAF on cleanup (tool change or unmount)
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [activeTool, toolConfig, onModified]);

  // Announce tool changes to screen readers (Issue 4)
  useEffect(() => {
    const toolNames: Record<Tool, string> = {
      select: 'Select',
      text: 'Text',
      draw: 'Draw',
      highlight: 'Highlight',
      redact: 'Redact',
      arrow: 'Arrow',
      circle: 'Circle',
      stamp: 'Stamp',
      checkbox: 'Checkbox',
      date: 'Date',
      shape: 'Shape',
      eraser: 'Eraser',
      signature: 'Signature',
      image: 'Image',
    };

    const toolName = toolNames[activeTool] || activeTool;
    setToolAnnouncement(`Tool changed to ${toolName}`);

    const timer = setTimeout(() => {
      setToolAnnouncement('');
    }, 1000);

    return () => clearTimeout(timer);
  }, [activeTool]);

  // Signature save
  const handleSignatureSave = (dataUrl: string) => {
    setSignatureOpen(false);
    if (!fabricRef.current) return;
    FabricImage.fromURL(dataUrl).then((img) => {
      img.scaleToWidth(IMAGE_DEFAULT_WIDTH);
      fabricRef.current?.add(img);
      fabricRef.current?.renderAll();
    });
  };

  // Image upload
  const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !fabricRef.current) return;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      onToast?.(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`, 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      FabricImage.fromURL(url).then((img) => {
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
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
      {signatureOpen && (
        <Suspense fallback={null}>
          <SignatureModal onSave={handleSignatureSave} onCancel={() => setSignatureOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

// --- helpers ---

function setupDragRect(canvas: FabricCanvas, color: string, opacity: number, sharedRafRef: React.RefObject<number | null>) {
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let rect: Rect | null = null;

  canvas.on('mouse:down', (opt) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    rect = new Rect({ left: startX, top: startY, width: 0, height: 0, fill: color, opacity, selectable: true });
    canvas.add(rect);
  });
  canvas.on('mouse:move', (opt) => {
    if (!drawing || !rect) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    rect.set({ width: Math.abs(w), height: Math.abs(h), left: w < 0 ? pt.x : startX, top: h < 0 ? pt.y : startY });
    if (!sharedRafRef.current) {
      sharedRafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        sharedRafRef.current = null;
      });
    }
  });
  canvas.on('mouse:up', () => {
    drawing = false;
    rect = null;
    if (sharedRafRef.current) {
      cancelAnimationFrame(sharedRafRef.current);
      sharedRafRef.current = null;
    }
  });
}

function setupDragShape(canvas: FabricCanvas, color: string, lineWidth: number, sharedRafRef: React.RefObject<number | null>) {
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let shape: FabricObject | null = null;

  canvas.on('mouse:down', (opt) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    shape = new Rect({ left: startX, top: startY, width: 0, height: 0, fill: 'transparent', stroke: color, strokeWidth: lineWidth });
    canvas.add(shape);
  });
  canvas.on('mouse:move', (opt) => {
    if (!drawing || !shape) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    if (shape instanceof Rect) {
      shape.set({ width: Math.abs(w), height: Math.abs(h), left: w < 0 ? pt.x : startX, top: h < 0 ? pt.y : startY });
    } else if (shape instanceof Circle) {
      // Fix Issue 2: Use local variable for proper type narrowing
      const r = Math.sqrt(w * w + h * h) / 2;
      const circle = shape as Circle;
      circle.set({ radius: r });
    }
    if (!sharedRafRef.current) {
      sharedRafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        sharedRafRef.current = null;
      });
    }
  });
  canvas.on('mouse:up', () => {
    drawing = false;
    shape = null;
    if (sharedRafRef.current) {
      cancelAnimationFrame(sharedRafRef.current);
      sharedRafRef.current = null;
    }
  });
}

function setupDragArrow(canvas: FabricCanvas, color: string, lineWidth: number, sharedRafRef: React.RefObject<number | null>) {
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let group: Group | null = null;

  canvas.on('mouse:down', (opt) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
  });
  canvas.on('mouse:move', (opt) => {
    if (!drawing) return;
    const pt = canvas.getScenePoint(opt.e);
    const endX = pt.x;
    const endY = pt.y;

    if (group) canvas.remove(group);

    const line = new Line([startX, startY, endX, endY], {
      stroke: color,
      strokeWidth: lineWidth,
    });

    const angle = Math.atan2(endY - startY, endX - startX);
    const headLen = 15;
    const arrowHead = new Polygon([
      { x: 0, y: 0 },
      { x: -headLen, y: headLen / 2 },
      { x: -headLen, y: -headLen / 2 },
    ], {
      left: endX,
      top: endY,
      angle: (angle * 180) / Math.PI,
      fill: color,
      originX: 'center',
      originY: 'center',
    });

    group = new Group([line, arrowHead], { selectable: true });
    canvas.add(group);
    if (!sharedRafRef.current) {
      sharedRafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        sharedRafRef.current = null;
      });
    }
  });
  canvas.on('mouse:up', () => {
    drawing = false;
    group = null;
    if (sharedRafRef.current) {
      cancelAnimationFrame(sharedRafRef.current);
      sharedRafRef.current = null;
    }
  });
}

function setupDragCircle(canvas: FabricCanvas, color: string, lineWidth: number, sharedRafRef: React.RefObject<number | null>) {
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let circle: Circle | null = null;

  canvas.on('mouse:down', (opt) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    circle = new Circle({ left: startX, top: startY, radius: 0, fill: 'transparent', stroke: color, strokeWidth: lineWidth });
    canvas.add(circle);
  });
  canvas.on('mouse:move', (opt) => {
    if (!drawing || !circle) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    const r = Math.sqrt(w * w + h * h);
    circle.set({ radius: r });
    if (!sharedRafRef.current) {
      sharedRafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        sharedRafRef.current = null;
      });
    }
  });
  canvas.on('mouse:up', () => {
    drawing = false;
    circle = null;
    if (sharedRafRef.current) {
      cancelAnimationFrame(sharedRafRef.current);
      sharedRafRef.current = null;
    }
  });
}
