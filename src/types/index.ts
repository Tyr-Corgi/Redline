export type Tool = 'select' | 'text' | 'draw' | 'highlight' | 'signature' | 'checkbox' | 'date' | 'image' | 'shape' | 'eraser' | 'redact' | 'arrow' | 'circle' | 'stamp';

export interface ToolConfig {
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineWidth: number;
  opacity: number;
  checkboxStyle: 'check' | 'x';
  stampType: string;
}

/**
 * Minimal Fabric.js canvas interface for keyboard shortcut operations
 */
export interface FabricCanvasRef {
  getActiveObjects(): unknown[];
  getActiveObject(): unknown | null;
  remove(...objects: unknown[]): void;
  discardActiveObject(): void;
  renderAll(): void;
}

/**
 * Fabric.js mouse event interface for draw tool event handlers
 * TPointerEvent can be MouseEvent or TouchEvent
 */
export interface FabricMouseEvent {
  e: MouseEvent | TouchEvent;
  target?: unknown;
  pointer?: { x: number; y: number };
  absolutePointer?: { x: number; y: number };
}

export interface HistoryEntry {
  type: 'add' | 'remove' | 'modify';
  page: number;
  snapshot: string; // JSON snapshot of fabric canvas
}

export interface EditorState {
  file: File | null;
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  zoom: number;
  activeTool: Tool;
  toolConfig: ToolConfig;
  history: HistoryEntry[];
  historyIndex: number;
  pageRotations: Record<number, number>;
  deletedPages: number[];
}

export type EditorAction =
  | { type: 'SET_FILE'; payload: { file: File; pdfDoc: import('pdfjs-dist').PDFDocumentProxy; numPages: number } }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SET_TOOL'; payload: Tool }
  | { type: 'SET_TOOL_CONFIG'; payload: Partial<ToolConfig> }
  | { type: 'PUSH_HISTORY'; payload: { page: number; snapshot: string } }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR_FILE' }
  | { type: 'SET_PAGE_ROTATION'; payload: { page: number; rotation: number } }
  | { type: 'DELETE_PAGE'; payload: number };
