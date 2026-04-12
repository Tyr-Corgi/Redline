import { useRef, useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { usePdfEditor } from './hooks/usePdfEditor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePrintHandler } from './hooks/usePrintHandler';
import { useSaveHandler } from './hooks/useSaveHandler';
import { useTouchZoom } from './hooks/useTouchZoom';
import Toolbar from './components/Toolbar';
import { PageCanvas } from './components/PageCanvas';
import { PageSidebar } from './components/PageSidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DropZone } from './components/DropZone';
import { ToastNotification } from './components/ToastNotification';
import { ConfirmDialog } from './components/ConfirmDialog';
const MergePdfModal = lazy(() => import('./components/MergePdfModal'));
import { loadSession, clearSession, createDebouncedSaver } from './services/storageService';
import type { Canvas as FabricCanvas } from 'fabric';

type FabricCanvasWithOverlay = FabricCanvas & {
  getOverlay?: () => { dataUrl: string; width: number; height: number } | null;
};

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

export default function App() {
  // Named constants
  const AUTO_SAVE_DEBOUNCE_MS = 2000;
  const SAVE_STATUS_DELAY_MS = 900;
  const SAVE_STATUS_RESET_MS = 3500;

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
  const [restoringSession, setRestoringSession] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'info' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fabricCanvasRef = useRef<FabricCanvasWithOverlay | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const autoSaverRef = useRef(createDebouncedSaver(AUTO_SAVE_DEBOUNCE_MS));

  /**
   * Ref-based state synchronization architecture:
   *
   * WHY REFS ARE NEEDED:
   * Fabric.js canvas event callbacks (object:modified, path:created, etc.) and touch event handlers
   * capture closures at registration time. When these callbacks execute, they have stale references
   * to React state. Refs provide a mutable container that always points to the latest state, bridging
   * the gap between React's declarative state model and Fabric's imperative event system.
   *
   * CONSOLIDATED EDITOR STATE:
   * - latestEditorRef: Consolidates file, currentPage, and zoom state for callbacks that need current editor context
   *   (used in triggerAutoSave and other imperative operations that fire from non-React event sources)
   * - latestZoomRef: Separate zoom ref required by useTouchZoom hook (expects RefObject<number>)
   *
   * OTHER STATE REFS:
   * - isRestoringHistoryRef: Guards against circular loops during undo/redo history restoration
   * - pageAnnotationsRef: Per-page annotation storage with zoom metadata for proper scaling during restore
   *
   * All refs are kept in sync with state via assignment in component body (runs on every render).
   * The refs are only accessed where event closures would otherwise capture stale state.
   */
  const latestEditorRef = useRef({ file, currentPage, zoom });
  const latestZoomRef = useRef(zoom);
  const isRestoringHistoryRef = useRef(false);
  const pageAnnotationsRef = useRef<Map<number, { json: string; zoom: number }>>(new Map());
  const documentAreaRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with state (runs every render)
  latestEditorRef.current = { file, currentPage, zoom };
  latestZoomRef.current = zoom;

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

  // Issue 4: Non-blocking session restore - render drop zone immediately
  useEffect(() => {
    setRestoringSession(false);
    (async () => {
      try {
        const session = await loadSession();
        if (session) {
          pdfBytesRef.current = session.pdfBytes;
          await openFromBytes(session.pdfBytes, session.pdfFileName);
          restoreAnnotations(session.annotations, session.annotationZooms);
          if (session.currentPage > 1) setPage(session.currentPage);
          if (session.zoom !== 1.0) setZoom(session.zoom);
          setStatusAnnouncement('Previous session restored');
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Issue 3: Memoize handleFileSelect
  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      if (selectedFile?.type === 'application/pdf') {
        try {
          pdfBytesRef.current = await selectedFile.arrayBuffer();
          await openFile(selectedFile);
        } catch (error) {
          console.error('Failed to open PDF:', error);
          setToast({
            message: `Failed to open PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
            type: 'error',
          });
        }
      }
    },
    [openFile]
  );

  // Issue 3: Memoize handleMergedOpen
  const handleMergedOpen = useCallback(
    async (bytes: ArrayBuffer, fileName: string) => {
      autoSaverRef.current.cancel();
      pdfBytesRef.current = bytes;
      fabricCanvasRef.current = null;
      await openFromBytes(bytes, fileName);
    },
    [openFromBytes]
  );

  // Issue 3: Memoize handleNewProject
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

  // Issue 3: Memoize handleToolConfigChange
  const handleToolConfigChange = useCallback(
    (config: Parameters<typeof setToolConfig>[0]) => {
      setToolConfig(config);
      if (!fabricCanvasRef.current) return;
      const obj = fabricCanvasRef.current.getActiveObject();
      if (!obj) return;
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
    },
    [setToolConfig]
  );

  // Issue 3: Memoize triggerAutoSave
  const triggerAutoSave = useCallback(() => {
    const { file: currentFile, currentPage: page, zoom: currentZoom } = latestEditorRef.current;
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
    setTimeout(() => {
      setSaveStatus('saved');
      setStatusAnnouncement('Document saved');
    }, SAVE_STATUS_DELAY_MS);
    setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), SAVE_STATUS_RESET_MS);
  }, [getAllPageAnnotations]);

  // Track page changes for auto-save (PageCanvas cleanup handles saving
  // annotations via onAnnotationsChange, so we just trigger the auto-save).
  const prevPageRef = useRef<number>(currentPage);
  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage;
      triggerAutoSave();
      if (numPages > 0) {
        setStatusAnnouncement(`Page ${currentPage} of ${numPages}`);
      }
    }
  }, [currentPage, triggerAutoSave, numPages]);

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

  // Extract save handler to useSaveHandler hook
  const handleSave = useSaveHandler({
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
    onToast: (msg, type = 'info') => setToast({ message: msg, type }),
  });

  // Issue 1: Extract print handler to usePrintHandler hook
  const handlePrint = usePrintHandler({
    pdfDoc,
    pdfBytesRef,
    fabricCanvasRef,
    pageAnnotationsRef,
    currentPage,
    pageRotations,
    deletedPages,
    zoom,
    onToast: (msg, type = 'info') => setToast({ message: msg, type }),
    isBusy,
    setIsBusy,
    savePageAnnotations,
    getAllPageAnnotations,
  });

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

  // Hooks
  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    onSave: handleSave,
    onZoomIn: useCallback(() => setZoom(Math.min(4, zoom + 0.25)), [zoom, setZoom]),
    onZoomOut: useCallback(() => setZoom(Math.max(0.25, zoom - 0.25)), [zoom, setZoom]),
    onDelete: useCallback(() => {}, []),
    onToolChange: setTool,
    onOpenFile: useCallback(() => fileInputRef.current?.click(), []),
    canUndo,
    canRedo,
    fabricCanvasRef,
  });

  useTouchZoom({ zoom, setZoom, latestZoomRef }, documentAreaRef);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(Math.round(Math.max(0.25, Math.min(4, zoom + delta)) * 100) / 100);
      }
    },
    [zoom, setZoom]
  );

  // Critical 2: Clean up page annotations when page is deleted
  const handleDeletePage = useCallback(
    (pageNum: number) => {
      deletePage(pageNum);
      pageAnnotationsRef.current.delete(pageNum);
    },
    [deletePage]
  );

  return (
    <div className="app">
      <a href="#document-area" className="skip-link">
        Skip to document
      </a>
      {/* Issue 5: Add error boundary for Toolbar */}
      <ErrorBoundary>
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
      </ErrorBoundary>

      {/* Issue 5: Add error boundary for lazy-loaded modal */}
      {showMergeModal && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <MergePdfModal onClose={() => setShowMergeModal(false)} onMergedOpen={handleMergedOpen} />
          </Suspense>
        </ErrorBoundary>
      )}

      {saveStatus !== 'idle' && (
        <div className={`save-indicator ${saveStatus}`} role="status" aria-live="polite">
          {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
        </div>
      )}

      {/* Issue 4: Show subtle loading indicator during session restore */}
      {restoringSession && (
        <div
          style={{
            position: 'fixed',
            top: '10px',
            right: '10px',
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 1000,
          }}
        >
          Restoring session...
        </div>
      )}

      <div className="editor-body">
        {pdfDoc && (
          <ErrorBoundary>
            <PageSidebar
              pdfDoc={pdfDoc}
              currentPage={currentPage}
              onPageChange={setPage}
              pageRotations={pageRotations}
              onRotatePage={rotatePage}
              deletedPages={deletedPages}
              onDeletePage={handleDeletePage}
              onConfirmDelete={(msg, onConfirm) => setConfirmAction({ message: msg, onConfirm })}
            />
          </ErrorBoundary>
        )}
        <div
          id="document-area"
          ref={documentAreaRef}
          className="document-area"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onWheel={handleWheel}
        >
          {!pdfDoc ? (
            <DropZone
              isDragging={isDragging}
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              onMerge={() => setShowMergeModal(true)}
            />
          ) : (
            /* Issue 5: Add error boundary for PageCanvas */
            <ErrorBoundary>
              <PageCanvas
                key={currentPage}
                pageNum={currentPage}
                pdfDoc={pdfDoc}
                zoom={zoom}
                activeTool={activeTool}
                toolConfig={toolConfig}
                savedAnnotations={getPageAnnotations(currentPage) ?? undefined}
                rotation={getPageRotation(currentPage)}
                onCanvasReady={(fc) => {
                  fabricCanvasRef.current = fc as FabricCanvasWithOverlay;
                }}
                onModified={() => {
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
            </ErrorBoundary>
          )}
        </div>
      </div>

      {toast && <ToastNotification message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      {confirmAction && (
        <ConfirmDialog
          message={confirmAction.message}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Critical 4: Accessibility status announcements for screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>
    </div>
  );
}
