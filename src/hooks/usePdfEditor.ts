/**
 * PDF Editor domain hook — manages document lifecycle, page navigation,
 * and annotation storage (ref-based for Fabric.js imperative API).
 * History management is delegated to the extracted useHistory hook.
 * Architecture note: Business logic bridges React state with Fabric.js imperative canvas.
 * Annotations stored in refs to avoid stale closures in Fabric.js callbacks.
 */
import { useReducer, useCallback, useRef } from 'react';
import type { Tool, ToolConfig } from '../types';
import { useHistory } from './useHistory';
import { loadPdf, loadPdfFromBytes } from '../services/pdfService';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface CoreState {
  file: File | null;
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  zoom: number;
  activeTool: Tool;
  toolConfig: ToolConfig;
  pageRotations: Record<number, number>;
  deletedPages: number[];
}

type CoreAction =
  | { type: 'SET_FILE'; payload: { file: File; pdfDoc: import('pdfjs-dist').PDFDocumentProxy; numPages: number } }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_TOOL_CONFIG'; payload: Partial<ToolConfig> }
  | { type: 'CLEAR_FILE' }
  | { type: 'SET_PAGE_ROTATION'; payload: { page: number; rotation: number } }
  | { type: 'DELETE_PAGE'; payload: number };

const initialState: CoreState = {
  file: null,
  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  zoom: 1.0,
  activeTool: 'select',
  toolConfig: {
    color: '#000000',
    fontSize: 12,
    fontFamily: 'Arial',
    bold: false,
    italic: false,
    underline: false,
    lineWidth: 2,
    opacity: 0.3,
    checkboxStyle: 'check',
    stampType: 'approved',
  },
  pageRotations: {},
  deletedPages: [],
};

function coreReducer(state: CoreState, action: CoreAction): CoreState {
  switch (action.type) {
    case 'SET_FILE':
      return {
        ...state,
        file: action.payload.file,
        pdfDoc: action.payload.pdfDoc,
        numPages: action.payload.numPages,
        currentPage: 1,
      };

    case 'SET_PAGE':
      return {
        ...state,
        currentPage: Math.max(1, Math.min(action.payload, state.numPages)),
      };

    case 'SET_ZOOM':
      return {
        ...state,
        zoom: Math.max(0.25, Math.min(action.payload, 4.0)),
      };

    case 'SET_TOOL':
      return { ...state, activeTool: action.payload };

    case 'SET_TOOL_CONFIG':
      return { ...state, toolConfig: { ...state.toolConfig, ...action.payload } };

    case 'CLEAR_FILE':
      return initialState;

    case 'SET_PAGE_ROTATION':
      return {
        ...state,
        pageRotations: {
          ...state.pageRotations,
          [action.payload.page]: action.payload.rotation,
        },
      };

    case 'DELETE_PAGE': {
      const newDeletedPages = [...state.deletedPages, action.payload];
      // If current page is deleted, navigate to nearest valid page
      let newCurrentPage = state.currentPage;
      if (action.payload === state.currentPage) {
        // Find nearest valid page
        for (let i = state.currentPage + 1; i <= state.numPages; i++) {
          if (!newDeletedPages.includes(i)) {
            newCurrentPage = i;
            break;
          }
        }
        // If no page found after, search before
        if (newCurrentPage === state.currentPage) {
          for (let i = state.currentPage - 1; i >= 1; i--) {
            if (!newDeletedPages.includes(i)) {
              newCurrentPage = i;
              break;
            }
          }
        }
      }
      return {
        ...state,
        deletedPages: newDeletedPages,
        currentPage: newCurrentPage,
      };
    }

    default:
      return state;
  }
}

export function usePdfEditor() {
  const [state, dispatch] = useReducer(coreReducer, initialState);
  const { history, historyIndex, canUndo, canRedo, pushHistory, undo, redo, clearHistory } = useHistory();

  // Per-page annotation storage: pageNum -> { json: Fabric JSON, zoom: zoom level }
  const pageAnnotationsRef = useRef<Map<number, { json: string; zoom: number }>>(new Map());

  const openFile = useCallback(async (file: File) => {
    // Clear annotations and history atomically before loading new file
    pageAnnotationsRef.current.clear();
    clearHistory();
    const pdfDoc: PDFDocumentProxy = await loadPdf(file);
    dispatch({
      type: 'SET_FILE',
      payload: { file, pdfDoc, numPages: pdfDoc.numPages },
    });
  }, [clearHistory]);

  /** Open a PDF from raw bytes (for session restore) */
  const openFromBytes = useCallback(async (bytes: ArrayBuffer, fileName: string) => {
    pageAnnotationsRef.current.clear();
    clearHistory();
    const pdfDoc: PDFDocumentProxy = await loadPdfFromBytes(bytes);
    // Create a synthetic File object so the rest of the app works normally
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const file = new File([blob], fileName, { type: 'application/pdf' });
    dispatch({
      type: 'SET_FILE',
      payload: { file, pdfDoc, numPages: pdfDoc.numPages },
    });
    return pdfDoc;
  }, [clearHistory]);

  /** Bulk-restore per-page annotations (for session restore) */
  const restoreAnnotations = useCallback((
    annotations: Record<number, string>,
    annotationZooms?: Record<number, number>,
  ) => {
    pageAnnotationsRef.current.clear();
    for (const [page, json] of Object.entries(annotations)) {
      const pageNum = Number(page);
      // Use stored zoom if available, otherwise assume zoom=1.0 (legacy sessions)
      const storedZoom = annotationZooms?.[pageNum] ?? 1.0;
      pageAnnotationsRef.current.set(pageNum, { json, zoom: storedZoom });
    }
  }, []);

  const setPage = useCallback((page: number) => {
    dispatch({ type: 'SET_PAGE', payload: page });
  }, []);

  const setZoom = useCallback((zoom: number) => {
    dispatch({ type: 'SET_ZOOM', payload: zoom });
  }, []);

  const setTool = useCallback((tool: Tool) => {
    dispatch({ type: 'SET_TOOL', payload: tool });
  }, []);

  const setToolConfig = useCallback((config: Partial<ToolConfig>) => {
    dispatch({ type: 'SET_TOOL_CONFIG', payload: config });
  }, []);

  // pushHistory, undo, redo, canUndo, canRedo provided by useHistory()

  /** Save current page's Fabric canvas JSON + zoom level to the per-page store */
  const savePageAnnotations = useCallback((page: number, json: string, zoom: number) => {
    pageAnnotationsRef.current.set(page, { json, zoom });
  }, []);

  /** Get stored Fabric canvas JSON + zoom for a given page */
  const getPageAnnotations = useCallback((page: number): { json: string; zoom: number } | undefined => {
    return pageAnnotationsRef.current.get(page);
  }, []);

  /** Get all stored page annotations (for PDF save) */
  const getAllPageAnnotations = useCallback((): Map<number, { json: string; zoom: number }> => {
    return new Map(pageAnnotationsRef.current);
  }, []);

  const clearFile = useCallback(() => {
    clearHistory();
    dispatch({ type: 'CLEAR_FILE' });
  }, [clearHistory]);

  const rotatePage = useCallback((page: number) => {
    const currentRotation = state.pageRotations[page] || 0;
    const newRotation = (currentRotation + 90) % 360;
    dispatch({ type: 'SET_PAGE_ROTATION', payload: { page, rotation: newRotation } });
  }, [state.pageRotations]);

  const getPageRotation = useCallback((page: number): number => {
    return state.pageRotations[page] || 0;
  }, [state.pageRotations]);

  const deletePage = useCallback((page: number) => {
    dispatch({ type: 'DELETE_PAGE', payload: page });
  }, []);

  return {
    file: state.file,
    pdfDoc: state.pdfDoc as PDFDocumentProxy | null,
    numPages: state.numPages,
    currentPage: state.currentPage,
    zoom: state.zoom,
    activeTool: state.activeTool,
    toolConfig: state.toolConfig,
    history,
    historyIndex,
    canUndo,
    canRedo,
    pageRotations: state.pageRotations,
    deletedPages: state.deletedPages,
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
  };
}
