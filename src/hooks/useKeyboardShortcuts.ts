import { useEffect } from 'react';
import type { Tool, FabricCanvasRef } from '../types';

interface KeyboardShortcutActions {
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onDelete: () => void;
  onToolChange: (tool: Tool) => void;
  onOpenFile: () => void;
  canUndo: boolean;
  canRedo: boolean;
  fabricCanvasRef: React.RefObject<FabricCanvasRef | null>;
}

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable === true;
}

/** Check if a Fabric.js IText/Textbox is being actively edited */
function isFabricTextEditing(fabricCanvasRef: React.RefObject<FabricCanvasRef | null>): boolean {
  const canvas = fabricCanvasRef.current;
  if (!canvas) return false;
  const active = canvas.getActiveObject();
  if (!active || typeof active !== 'object') return false;
  return 'isEditing' in (active as Record<string, unknown>) && !!(active as Record<string, unknown>).isEditing;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  const {
    onUndo,
    onRedo,
    onSave,
    onZoomIn,
    onZoomOut,
    onDelete,
    onToolChange,
    onOpenFile,
    canUndo,
    canRedo,
    fabricCanvasRef,
  } = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      }
      // Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        onRedo();
      }
      // Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
      // Open file
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        onOpenFile();
      }
      // Tool shortcuts (only when not typing)
      if (e.key === 'v' || e.key === 'V') {
        if (!isTyping(e)) onToolChange('select');
      }
      if (e.key === 't' || e.key === 'T') {
        if (!isTyping(e)) onToolChange('text');
      }
      if (e.key === 'd' || e.key === 'D') {
        if (!isTyping(e)) onToolChange('draw');
      }
      if (e.key === 'h' || e.key === 'H') {
        if (!isTyping(e)) onToolChange('highlight');
      }
      // Zoom shortcuts (skip when typing in inputs or Fabric text objects)
      if ((e.key === '+' || e.key === '=') && !isTyping(e) && !isFabricTextEditing(fabricCanvasRef)) {
        e.preventDefault();
        onZoomIn();
      }
      if ((e.key === '-' || e.key === '_') && !isTyping(e) && !isFabricTextEditing(fabricCanvasRef)) {
        e.preventDefault();
        onZoomOut();
      }
      // Delete selected object(s)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e) && fabricCanvasRef.current) {
        const canvas = fabricCanvasRef.current;
        const active = canvas.getActiveObject();
        if (!active) return;
        // Don't delete if the user is editing text inside the object
        if (active && typeof active === 'object' && 'isEditing' in active && (active as { isEditing: boolean }).isEditing) return;
        e.preventDefault();
        // Handle grouped selection (multiple objects selected)
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          canvas.discardActiveObject();
          for (const obj of activeObjects) {
            if (obj != null) canvas.remove(obj);
          }
        } else {
          canvas.remove(active);
        }
        canvas.renderAll();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onSave,
    onZoomIn,
    onZoomOut,
    onDelete,
    onToolChange,
    onOpenFile,
    fabricCanvasRef,
  ]);
}
