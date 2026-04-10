import { useRef, useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { usePdfEditor } from './hooks/usePdfEditor';
import Toolbar from './components/Toolbar';
import { PageCanvas } from './components/PageCanvas';
import { PageSidebar } from './components/PageSidebar';
const MergePdfModal = lazy(() => import('./components/MergePdfModal'));
import { savePdfWithCanvasOverlays, downloadPdf } from './services/pdfService';
import { loadSession, clearSession, createDebouncedSaver } from './services/storageService';
import type { Canvas as FabricCanvas } from 'fabric';

type FabricCanvasWithOverlay = FabricCanvas & {
  getOverlay?: () => { dataUrl: string; width: number; height: number } | null;
};

export default function App() {
  // Named constants
  const AUTO_SAVE_DEBOUNCE_MS = 2000;
  const SAVE_STATUS_DELAY_MS = 900;
  const SAVE_STATUS_RESET_MS = 3500;
  const PRINT_DPI_SCALE = 2;

  // Issue 4: Prevent double-clicks during async operations
  const [isBusy, setIsBusy] = useState(false);

  const {
    file,
    pdfDoc,
    numPages,
    currentPage,
    zoom,
    activeTool,
    toolConfig,
    history,
    historyIndex,
    canUndo,
    canRedo,
    pageRotations,
    deletedPages,
    openFile,
    openFromBytes,
    restoreAnnotations,
    setPage,
    setZoom,
    setTool,
    setToolConfig,
    pushHistory,
    savePageAnnotations,
    getPageAnnotations,
    getAllPageAnnotations,
    undo,
    redo,
    clearFile,
    rotatePage,
    getPageRotation,
    deletePage,
  } = usePdfEditor();

  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [, setRestoringSession] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'info' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fabricCanvasRef = useRef<FabricCanvasWithOverlay | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const autoSaverRef = useRef(createDebouncedSaver(AUTO_SAVE_DEBOUNCE_MS));
  const latestStateRef = useRef({ file, currentPage, zoom });
  const zoomRafRef = useRef<number | null>(null);
  // Issue 2: Guard to prevent circular history restoration loops
  const isRestoringHistoryRef = useRef(false);
  // Issue 5: Sync ref during render — safe for refs per React docs (avoids stale closures in callbacks)
  latestStateRef.current = { file, currentPage, zoom };

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Dynamic document title
  useEffect(() => {
    document.title = file ? `${file.name} — Redline` : 'Redline';
  }, [file]);

  // Auto-restore session from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const session = await loadSession();
        if (session) {
          pdfBytesRef.current = session.pdfBytes;
          await openFromBytes(session.pdfBytes, session.pdfFileName);
          restoreAnnotations(session.annotations, session.annotationZooms);
          if (session.currentPage > 1) setPage(session.currentPage);
          if (session.zoom !== 1.0) setZoom(session.zoom);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        setRestoringSession(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (selectedFile?.type === 'application/pdf') {
      try {
        pdfBytesRef.current = await selectedFile.arrayBuffer();
        await openFile(selectedFile);
      } catch (error) {
        console.error('Failed to open PDF:', error);
        setToast({ message: `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
      }
    }
  }, [openFile]);

  // Open a merged PDF from raw bytes into the editor
  const handleMergedOpen = useCallback(async (bytes: ArrayBuffer, fileName: string) => {
    autoSaverRef.current.cancel();
    pdfBytesRef.current = bytes;
    fabricCanvasRef.current = null;
    await openFromBytes(bytes, fileName);
  }, [openFromBytes]);

  // Start a new project — clear everything and wipe the saved session
  const handleNewProject = useCallback(async () => {
    if (file) {
      setConfirmAction({
        message: 'Start a new project? Any unsaved changes will be lost.',
        onConfirm: async () => {
          autoSaverRef.current.cancel();
          pdfBytesRef.current = null;
          fabricCanvasRef.current = null;
          clearFile();
          await clearSession();
        },
      });
      return;
    }
    autoSaverRef.current.cancel();
    pdfBytesRef.current = null;
    fabricCanvasRef.current = null;
    clearFile();
    await clearSession();
  }, [file, clearFile]);

  // Issue 1: Typed interface for Fabric text objects (replaces unsafe `as any`)
  interface FabricTextObject {
    set(key: string, value: unknown): void;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    underline?: boolean;
    fill?: string;
    stroke?: string;
  }

  // Apply tool config changes to both state and any selected Fabric object
  const handleToolConfigChange = useCallback((config: Parameters<typeof setToolConfig>[0]) => {
    setToolConfig(config);
    if (!fabricCanvasRef.current) return;
    const obj = fabricCanvasRef.current.getActiveObject();
    if (!obj) return;
    // Use typed interface instead of `any` — still a cast but documented and type-safe
    const o = obj as FabricTextObject;
    const isText = 'fontSize' in obj;
    if (isText) {
      if (config.fontSize !== undefined) o.set('fontSize', config.fontSize);
      if (config.fontFamily !== undefined) o.set('fontFamily', config.fontFamily);
      if (config.bold !== undefined) o.set('fontWeight', config.bold ? 'bold' : 'normal');
      if (config.italic !== undefined) o.set('fontStyle', config.italic ? 'italic' : 'normal');
      if (config.underline !== undefined) o.set('underline', config.underline);
    }
    if (config.color !== undefined) {
      o.set('fill', config.color);
      if (isText) o.set('stroke', config.color);
    }
    fabricCanvasRef.current.renderAll();
  }, [setToolConfig]);

  // Trigger debounced auto-save to IndexedDB
  const triggerAutoSave = useCallback(() => {
    const { file: currentFile, currentPage: page, zoom: currentZoom } = latestStateRef.current;
    // Issue 3: Guard against race conditions — pdfBytesRef is captured at call time
    // and the session object is fully built before being passed to the debounced saver.
    // This architecture ensures that even though the save is debounced, the actual
    // data (pdfBytes, annotations) is immutable once captured here.
    if (!pdfBytesRef.current || !currentFile) return;
    setSaveStatus('saving');
    const annotations: Record<number, string> = {};
    const annotationZooms: Record<number, number> = {};
    const all = getAllPageAnnotations();
    for (const [pageNum, entry] of all.entries()) {
      annotations[pageNum] = entry.json;
      annotationZooms[pageNum] = entry.zoom;
    }
    autoSaverRef.current.save({
      pdfBytes: pdfBytesRef.current,
      pdfFileName: currentFile.name,
      annotations,
      annotationZooms,
      currentPage: page,
      zoom: currentZoom,
      savedAt: Date.now(),
    });
    setTimeout(() => setSaveStatus('saved'), SAVE_STATUS_DELAY_MS);
    setTimeout(() => setSaveStatus((s) => s === 'saved' ? 'idle' : s), SAVE_STATUS_RESET_MS);
  }, [getAllPageAnnotations]);

  // Track page changes for auto-save (PageCanvas cleanup handles saving
  // annotations via onAnnotationsChange, so we just trigger the auto-save).
  const prevPageRef = useRef<number>(currentPage);
  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage;
      triggerAutoSave();
    }
  }, [currentPage, triggerAutoSave]);

  // Restore canvas state on undo/redo
  const lastHistoryIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (historyIndex === lastHistoryIndexRef.current) return;
    lastHistoryIndexRef.current = historyIndex;

    if (historyIndex < 0 || historyIndex >= history.length) return;
    const entry = history[historyIndex];
    if (!entry || entry.page !== currentPage || !fabricCanvasRef.current) return;

    // Issue 2: Set guard to prevent circular loops during history restoration
    isRestoringHistoryRef.current = true;

    // Restore canvas from history snapshot (suppress modification events and
    // disable interaction while loading to prevent race conditions)
    const canvas = fabricCanvasRef.current;
    canvas.off('object:modified');
    canvas.off('object:added');
    canvas.off('object:removed');
    canvas.off('path:created');
    canvas.selection = false;
    canvas.discardActiveObject();

    // History snapshots are stored at the zoom they were taken at.
    // The snapshot JSON is raw at the current zoom since onModified fires
    // with the live canvas. Just restore directly.
    canvas.loadFromJSON(entry.snapshot).then(() => {
      canvas.renderAll();
      canvas.selection = true;
      savePageAnnotations(currentPage, entry.snapshot, zoom);
      // Clear restoration guard after async restore completes
      isRestoringHistoryRef.current = false;
    });
  }, [historyIndex, history, currentPage, zoom, savePageAnnotations]);

  // Save PDF by flattening Fabric canvas overlays onto each annotated page
  const handleSave = useCallback(async () => {
    // Issue 4: Prevent double-clicks during async save operation
    if (isBusy || !file || !pdfDoc) return;
    setIsBusy(true);

    try {
      // Flush current page's raw annotations before save
      if (fabricCanvasRef.current) {
        const rawJson = JSON.stringify(fabricCanvasRef.current.toJSON());
        savePageAnnotations(currentPage, rawJson, zoom);
      }

      // Collect canvas overlay images for every annotated page.
      // KEY INSIGHT: We render the Fabric canvas at the STORED zoom dimensions
      // (the exact size the canvas was when annotations were created) and load
      // the raw JSON without any transformation. The embedCanvasImage function
      // stretches the result to the PDF page size, mapping positions correctly.
      const canvasImages = new Map<number, { dataUrl: string; width: number; height: number }>();
      const allAnnotations = getAllPageAnnotations();
      const { Canvas: TempFabric } = await import('fabric');

      for (const [pageNum, entry] of allAnnotations.entries()) {
        try {
          const parsed = JSON.parse(entry.json);
          if (!parsed.objects || parsed.objects.length === 0) continue;

          const page = await pdfDoc.getPage(pageNum);
          const rotation = pageRotations[pageNum] || 0;
          // Render the overlay at the STORED zoom — this matches the coordinate
          // space of the raw Fabric JSON exactly. No JSON transformation needed.
          const storedViewport = page.getViewport({ scale: entry.zoom, rotation });
          // We also need the base viewport (scale=1.0) for the output dimensions
          // that embedCanvasImage will use to stretch onto the PDF page.
          const baseViewport = page.getViewport({ scale: 1.0, rotation });

          const tempCanvas = document.createElement('canvas');
          let tc: InstanceType<typeof TempFabric> | null = null;
          try {
            // Create canvas at stored zoom dimensions — matches raw JSON coords
            tc = new TempFabric(tempCanvas, {
              width: storedViewport.width,
              height: storedViewport.height,
            });
            // Load raw JSON as-is — no scaling needed
            await tc.loadFromJSON(entry.json);
            tc.renderAll();
            const dataUrl = tc.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
            // Report base viewport dimensions — embedCanvasImage stretches to
            // pdfWidth x pdfHeight (which equals baseViewport at scale=1.0)
            canvasImages.set(pageNum, {
              dataUrl,
              width: baseViewport.width,
              height: baseViewport.height,
            });
          } finally {
            if (tc) tc.dispose();
          }
        } catch {
          // Skip pages that fail to restore
        }
      }

      if (canvasImages.size === 0) {
        // No annotations — download original
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
      setToast({ message: `Failed to save PDF: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, file, pdfDoc, currentPage, zoom, pageRotations, deletedPages, savePageAnnotations, getAllPageAnnotations]);

  // Print all pages (PDF + annotation overlays) in a print-friendly window
  const handlePrint = useCallback(async () => {
    // Issue 4: Prevent double-clicks during async print operation
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
    if (!printWindow) { window.print(); return; }

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

      for (let p = 1; p <= pdfDoc.numPages; p++) {
        if (deletedPages.includes(p)) continue;
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
        await page.render({ canvasContext: ctx, viewport: printViewport, canvas: pdfCanvas } as unknown as Parameters<typeof page.render>[0]).promise;

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
          try {
            const parsed = JSON.parse(annotEntry.json);
            if (parsed.objects && parsed.objects.length > 0) {
              // Render at stored zoom dimensions — matches raw JSON coords
              const storedViewport = page.getViewport({ scale: annotEntry.zoom, rotation: rot });
              const tempCanvas = doc.createElement('canvas');
              const tc = new TempFabric(tempCanvas, {
                width: storedViewport.width,
                height: storedViewport.height,
              });
              // Load raw JSON as-is
              await tc.loadFromJSON(annotEntry.json);
              tc.renderAll();
              const overlayUrl = tc.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
              tc.dispose();
              // CSS stretches the overlay image to match the base viewport
              const overlayImg = doc.createElement('img');
              overlayImg.className = 'overlay-img';
              overlayImg.src = overlayUrl;
              overlayImg.style.cssText = `width:${cssW}px;height:${cssH}px;`;
              printPageDiv.appendChild(overlayImg);
            }
          } catch { /* skip annotation errors */ }
        }
        body.appendChild(printPageDiv);
      }

      html.appendChild(body);
      doc.appendChild(html);
      doc.close();
      // Wait for images to load then trigger print
      printWindow.onload = () => {
        setTimeout(() => { printWindow.print(); }, 300);
      };
    } catch (error) {
      console.error('Print error:', error);
      printWindow.close();
      setToast({ message: `Print preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, pdfDoc, currentPage, zoom, pageRotations, deletedPages, savePageAnnotations, getAllPageAnnotations, PRINT_DPI_SCALE]);

  // Warn before closing tab with unsaved work & flush auto-save
  useEffect(() => {
    if (!file) return;
    const handler = (e: BeforeUnloadEvent) => {
      autoSaverRef.current.flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [file]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); fileInputRef.current?.click(); }
      if (e.key === 'v' || e.key === 'V') { if (!isTyping(e)) setTool('select'); }
      if (e.key === 't' || e.key === 'T') { if (!isTyping(e)) setTool('text'); }
      if (e.key === 'd' || e.key === 'D') { if (!isTyping(e)) setTool('draw'); }
      if (e.key === 'h' || e.key === 'H') { if (!isTyping(e)) setTool('highlight'); }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(Math.min(4, zoom + 0.25)); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(Math.max(0.25, zoom - 0.25)); }
      // Delete selected object(s) — but not while editing text inside an IText
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e) && fabricCanvasRef.current) {
        const canvas = fabricCanvasRef.current;
        const active = canvas.getActiveObject();
        if (!active) return;
        // Don't delete if the user is editing text inside the object
        if ('isEditing' in active && (active as unknown as { isEditing: boolean }).isEditing) return;
        e.preventDefault();
        // Handle grouped selection (multiple objects selected)
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          canvas.discardActiveObject();
          activeObjects.forEach((obj) => canvas.remove(obj));
        } else {
          canvas.remove(active);
        }
        canvas.renderAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canUndo, canRedo, currentPage, numPages, zoom, undo, redo, setPage, setZoom, setTool, handleSave]);

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  // Pinch-to-zoom for touch devices
  const documentAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = documentAreaRef.current;
    if (!el) return;
    let initialDistance = 0;
    let initialZoom = zoom;

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getDistance(e.touches);
        initialZoom = latestStateRef.current.zoom;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / initialDistance;
        const newZoom = Math.round(Math.max(0.25, Math.min(4, initialZoom * scale)) * 100) / 100;
        if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = requestAnimationFrame(() => {
          setZoom(newZoom);
          zoomRafRef.current = null;
        });
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [zoom, setZoom]);

  return (
    <div className="app">
      <a href="#document-area" className="skip-link">Skip to document</a>
      <Toolbar
        activeTool={activeTool}
        toolConfig={toolConfig}
        currentPage={currentPage}
        numPages={numPages}
        zoom={zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        fileName={file?.name}
        onNewProject={handleNewProject}
        onOpenFile={handleFileSelect}
        onSave={handleSave}
        onPrint={handlePrint}
        onMergePdfs={() => setShowMergeModal(true)}
        onToolChange={setTool}
        onToolConfigChange={handleToolConfigChange}
        onPageChange={setPage}
        onZoomChange={setZoom}
        onUndo={undo}
        onRedo={redo}
      />

      {showMergeModal && (
        <Suspense fallback={null}>
          <MergePdfModal
            onClose={() => setShowMergeModal(false)}
            onMergedOpen={handleMergedOpen}
          />
        </Suspense>
      )}

      {saveStatus !== 'idle' && (
        <div className={`save-indicator ${saveStatus}`} role="status" aria-live="polite">
          {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
        </div>
      )}

      <div className="editor-body">
        {pdfDoc && (
          <PageSidebar
            pdfDoc={pdfDoc}
            currentPage={currentPage}
            onPageChange={setPage}
            pageRotations={pageRotations}
            onRotatePage={rotatePage}
            deletedPages={deletedPages}
            onDeletePage={deletePage}
            onConfirmDelete={(msg, onConfirm) => setConfirmAction({ message: msg, onConfirm })}
          />
        )}
        <div id="document-area" ref={documentAreaRef} className="document-area" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom(Math.round(Math.max(0.25, Math.min(4, zoom + delta)) * 100) / 100);
          }
        }}>
          {!pdfDoc ? (
            <div className={`drop-zone ${isDragging ? 'drag-over' : ''}`}>
              <div className="drop-zone-content">
                <div className="drop-zone-icon">
                  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="16" y="8" width="48" height="64" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <rect x="20" y="12" width="48" height="64" rx="4" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="2" />
                    <path d="M36 44l8-8 8 8M44 36v20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M32 28h24M32 34h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                  </svg>
                </div>
                <h2>Open a PDF to start editing</h2>
                <p className="drop-zone-subtitle">Edit, Annotate, Sign, Merge & More</p>
                <p className="drop-zone-hint">Drag and drop a PDF file here</p>
                <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }} style={{ display: 'none' }} />
                <div className="drop-zone-actions">
                  <button className="drop-zone-btn primary" onClick={() => fileInputRef.current?.click()}>
                    Choose PDF File
                  </button>
                  <button className="drop-zone-btn secondary" onClick={() => setShowMergeModal(true)}>
                    Merge PDFs
                  </button>
                </div>
                <span className="drop-zone-shortcut">or press Ctrl+O to open</span>
              </div>
            </div>
          ) : (
            <PageCanvas
              key={currentPage}
              pageNum={currentPage}
              pdfDoc={pdfDoc}
              zoom={zoom}
              activeTool={activeTool}
              toolConfig={toolConfig}
              savedAnnotations={getPageAnnotations(currentPage) ?? undefined}
              rotation={getPageRotation(currentPage)}
              onCanvasReady={(fc) => { fabricCanvasRef.current = fc as FabricCanvasWithOverlay; }}
              onModified={() => {
                // Issue 2: Prevent circular loops — skip history push during restoration
                if (isRestoringHistoryRef.current) return;
                if (fabricCanvasRef.current) {
                  const rawSnapshot = JSON.stringify(fabricCanvasRef.current.toJSON());
                  pushHistory(currentPage, rawSnapshot);
                }
              }}
              onAnnotationsChange={(page, json, annotZoom) => {
                savePageAnnotations(page, json, annotZoom);
                triggerAutoSave();
              }}
              onToast={(msg, type) => setToast({ message: msg, type })}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className="toast-notification" role="alert" aria-live="assertive">
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {confirmAction && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-label="Confirm action">
          <div className="confirm-dialog">
            <p>{confirmAction.message}</p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button className="confirm-btn ok" onClick={() => { confirmAction.onConfirm(); setConfirmAction(null); }}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable === true;
}
