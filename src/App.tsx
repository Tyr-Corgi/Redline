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
import { loadSession, clearSession, createDebouncedSaver, markPageDirty } from './services/storageService';
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
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fabricCanvasRef = useRef<FabricCanvasWithOverlay | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const autoSaverRef = useRef(createDebouncedSaver(AUTO_SAVE_DEBOUNCE_MS));
  const latestEditorRef = useRef({ file, currentPage, zoom });
  const latestZoomRef = useRef(zoom);
  const isRestoringHistoryRef = useRef(false);
  const pageAnnotationsRef = useRef<Map<number, { json: string; zoom: number }>>(new Map());
  const documentAreaRef = useRef<HTMLDivElement>(null);
  const canvasDirtyRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestEditorRef.current = { file, currentPage, zoom };
  latestZoomRef.current = zoom;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.title = file ? `${file.name} — Redline` : 'Redline';
  }, [file]);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      const isPdf = selectedFile?.type === 'application/pdf' ||
        selectedFile?.name?.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        setToast({ message: 'Please select a PDF file.', type: 'error' });
        return;
      }
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
    },
    [openFile]
  );

  const handleMergedOpen = useCallback(
    async (bytes: ArrayBuffer, fileName: string) => {
      autoSaverRef.current.cancel();
      pdfBytesRef.current = bytes;
      fabricCanvasRef.current = null;
      await openFromBytes(bytes, fileName);
    },
    [openFromBytes]
  );

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

  const prevPageRef = useRef<number>(currentPage);
  useEffect(() => {
    if (prevPageRef.current !== currentPage) {
      // Flush pending history before changing pages
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
        if (canvasDirtyRef.current && fabricCanvasRef.current) {
          const rawSnapshot = JSON.stringify(fabricCanvasRef.current.toJSON());
          pushHistory(prevPageRef.current, rawSnapshot);
          canvasDirtyRef.current = false;
        }
      }
      prevPageRef.current = currentPage;
      triggerAutoSave();
      if (numPages > 0) {
        setStatusAnnouncement(`Page ${currentPage} of ${numPages}`);
      }
    }
  }, [currentPage, triggerAutoSave, numPages, pushHistory]);

  // Track last-applied historyIndex to detect undo/redo dispatches.
  // Starts at -1; updated on every apply so the baseline push doesn't
  // trigger a redundant restore on mount.
  const lastHistoryAppliedRef = useRef<number>(-1);
  useEffect(() => {
    // Skip if historyIndex hasn't actually changed (or is the initial baseline push)
    if (historyIndex === lastHistoryAppliedRef.current) return;
    const prevIndex = lastHistoryAppliedRef.current;
    lastHistoryAppliedRef.current = historyIndex;

    // Don't restore on first push (baseline) — canvas already has that state
    if (prevIndex === -1) return;

    if (historyIndex < 0 || historyIndex >= history.length) return;
    const entry = history[historyIndex];
    if (!entry || entry.page !== currentPage || !fabricCanvasRef.current) return;
    isRestoringHistoryRef.current = true;
    const canvas = fabricCanvasRef.current;
    // Temporarily suppress change tracking while restoring state.
    // Do NOT remove event listeners — PageCanvas owns them and won't re-add them.
    canvas.selection = false;
    canvas.discardActiveObject();
    canvas.loadFromJSON(entry.snapshot).then(() => {
      canvas.renderAll();
      canvas.selection = true;
      savePageAnnotations(currentPage, entry.snapshot, zoom);
      isRestoringHistoryRef.current = false;
    });
  }, [historyIndex, history, currentPage, zoom, savePageAnnotations]);

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

  useEffect(() => {
    if (!file) return;
    const handler = (e: BeforeUnloadEvent) => {
      autoSaverRef.current.flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [file]);

  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    onSave: handleSave,
    onZoomIn: useCallback(() => setZoom(Math.min(4, zoom + 0.25)), [zoom, setZoom]),
    onZoomOut: useCallback(() => setZoom(Math.max(0.25, zoom - 0.25)), [zoom, setZoom]),
    onDelete: () => {},
    onToolChange: setTool,
    onOpenFile: useCallback(() => fileInputRef.current?.click(), []),
    canUndo,
    canRedo,
    fabricCanvasRef,
  });

  useTouchZoom({ zoom, setZoom, latestZoomRef }, documentAreaRef);

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

  const handleDeletePage = useCallback((pageNum: number) => {
    deletePage(pageNum);
    pageAnnotationsRef.current.delete(pageNum);
  }, [deletePage]);

  const handleCanvasModified = useCallback(() => {
    if (isRestoringHistoryRef.current) return;
    canvasDirtyRef.current = true;
    markPageDirty(currentPage);
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      if (fabricCanvasRef.current && canvasDirtyRef.current) {
        const rawSnapshot = JSON.stringify(fabricCanvasRef.current.toJSON());
        pushHistory(currentPage, rawSnapshot);
        canvasDirtyRef.current = false;
      }
      historyTimerRef.current = null;
    }, 300);
  }, [currentPage, pushHistory]);

  return (
    <div className="app">
      <a href="#document-area" className="skip-link">
        Skip to document
      </a>
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
                  // Push baseline snapshot so there's a state to undo TO
                  const baseline = JSON.stringify(fc.toJSON());
                  pushHistory(currentPage, baseline);
                }}
                onModified={handleCanvasModified}
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
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>
    </div>
  );
}