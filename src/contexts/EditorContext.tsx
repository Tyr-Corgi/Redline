/**
 * EditorContext — split into two contexts to avoid unnecessary re-renders:
 *  1. EditorStateContext: frequently-changing values (activeTool, zoom, page, etc.)
 *  2. EditorActionsContext: stable callbacks (wrapped in useCallback by App)
 *
 * Toolbar consumes both. Because actions rarely change reference identity,
 * memo(Toolbar) only re-renders when actual state changes.
 */
import { createContext, useContext } from 'react';
import type { Tool, ToolConfig } from '../types';

export interface EditorStateValue {
  activeTool: Tool;
  toolConfig: ToolConfig;
  currentPage: number;
  numPages: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  fileName?: string;
}

export interface EditorActionsValue {
  onNewProject: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
  onPrint: () => void;
  onMergePdfs: () => void;
  onToolChange: (tool: Tool) => void;
  onToolConfigChange: (config: Partial<ToolConfig>) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** @deprecated Use EditorStateValue & EditorActionsValue instead */
export type EditorContextValue = EditorStateValue & EditorActionsValue;

export const EditorStateContext = createContext<EditorStateValue | null>(null);
export const EditorActionsContext = createContext<EditorActionsValue | null>(null);

/** Legacy single-context alias — kept for backward compat */
export const EditorContext = EditorStateContext;

export function useEditorState(): EditorStateValue {
  const ctx = useContext(EditorStateContext);
  if (!ctx) throw new Error('useEditorState must be used within EditorStateContext.Provider');
  return ctx;
}

export function useEditorActions(): EditorActionsValue {
  const ctx = useContext(EditorActionsContext);
  if (!ctx) throw new Error('useEditorActions must be used within EditorActionsContext.Provider');
  return ctx;
}

export function useEditorContext(): EditorStateValue & EditorActionsValue {
  return { ...useEditorState(), ...useEditorActions() };
}
