import type { Canvas as FabricCanvas } from 'fabric';
import type { Tool, ToolConfig } from '../types';
import {
  setupDragRect,
  setupDragShape,
  setupDragCircle,
  setupDragArrow,
  setupStampTool,
  setupCheckboxTool,
  setupDateTool,
} from './drawTools';

// Lazy load Fabric.js module
// Lazy singleton: import('fabric') is code-split by Vite into a separate chunk.
// The singleton only caches the promise to avoid duplicate network requests.
let fabricModule: typeof import('fabric') | null = null;
async function getFabric() {
  if (!fabricModule) {
    fabricModule = await import('fabric');
  }
  return fabricModule;
}

// Interface for accessing Fabric.js IText internal textarea
interface FabricITextWithTextarea {
  hiddenTextarea?: HTMLTextAreaElement;
}

/**
 * Setup tool-specific event handlers and configurations on the Fabric canvas.
 * Extracted from PageCanvas component to reduce component line count (Issue C11).
 *
 * This function receives all dependencies as parameters to avoid closure issues
 * that could cause circular dependencies or stale references (Issue C13).
 * By accepting refs and setters explicitly, it maintains a clear dependency graph
 * without closing over component state.
 *
 * @param canvas - The Fabric.js canvas instance to attach handlers to
 * @param activeTool - The currently active annotation tool
 * @param toolConfig - Configuration for tool appearance and behavior
 * @param prevActiveToolRef - Mutable ref tracking previous tool (for one-time side effects)
 * @param setSignatureOpen - State setter to open signature modal
 * @param imageInputRef - Ref to hidden file input for image uploads
 * @param dragRafRef - Mutable ref for requestAnimationFrame ID (drag tool optimization)
 * @returns Cleanup function for drag tools, or null for tools without cleanup
 */
export async function setupToolHandlers(
  canvas: FabricCanvas,
  activeTool: Tool,
  toolConfig: ToolConfig,
  prevActiveToolRef: React.MutableRefObject<Tool>,
  setSignatureOpen: (open: boolean) => void,
  imageInputRef: React.RefObject<HTMLInputElement | null>,
  dragRafRef: React.MutableRefObject<number | null>
): Promise<(() => void) | null> {
  const fabric = await getFabric();
  let dragToolCleanup: (() => void) | null = null;

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
  return dragToolCleanup;
}
