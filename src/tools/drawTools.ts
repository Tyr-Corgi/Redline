import type { Canvas as FabricCanvas } from 'fabric';
import { Rect, Circle, Line, Polygon, Group, IText, Image as FabricImage } from 'fabric';
import type { FabricObject } from 'fabric';
import type { FabricMouseEvent } from '../types';

/**
 * Context required for drag-based drawing tools
 */
export interface DragToolContext {
  canvas: FabricCanvas;
  color: string;
  opacity: number;
  strokeWidth: number;
  rafRef: React.RefObject<number | null>;
}

/**
 * Context required for simple click tools
 */
export interface ClickToolContext {
  canvas: FabricCanvas;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  stampType?: string;
  checkboxStyle?: 'check' | 'x';
}

/**
 * Setup drag-based rectangle drawing (for highlight/redact)
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupDragRect(ctx: DragToolContext): () => void {
  const { canvas, color, opacity, rafRef } = ctx;
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let rect: Rect | null = null;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    rect = new Rect({
      left: startX,
      top: startY,
      width: 0,
      height: 0,
      fill: color,
      opacity,
      selectable: true,
    });
    canvas.add(rect);
  };

  const handleMouseMove = (opt: FabricMouseEvent) => {
    if (!drawing || !rect) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    rect.set({
      width: Math.abs(w),
      height: Math.abs(h),
      left: w < 0 ? pt.x : startX,
      top: h < 0 ? pt.y : startY,
    });
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        rafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    drawing = false;
    rect = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
  };
}

/**
 * Setup drag-based shape drawing (rectangle with stroke)
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupDragShape(ctx: DragToolContext): () => void {
  const { canvas, color, strokeWidth, rafRef } = ctx;
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let shape: FabricObject | null = null;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    shape = new Rect({
      left: startX,
      top: startY,
      width: 0,
      height: 0,
      fill: 'transparent',
      stroke: color,
      strokeWidth,
    });
    canvas.add(shape);
  };

  const handleMouseMove = (opt: FabricMouseEvent) => {
    if (!drawing || !shape) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    if (shape instanceof Rect) {
      shape.set({
        width: Math.abs(w),
        height: Math.abs(h),
        left: w < 0 ? pt.x : startX,
        top: h < 0 ? pt.y : startY,
      });
    } else if (shape instanceof Circle) {
      // Fix Issue 2: Use local variable for proper type narrowing
      const r = Math.sqrt(w * w + h * h) / 2;
      const circle = shape as Circle;
      circle.set({ radius: r });
    }
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        rafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    drawing = false;
    shape = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
  };
}

/**
 * Setup drag-based circle drawing
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupDragCircle(ctx: DragToolContext): () => void {
  const { canvas, color, strokeWidth, rafRef } = ctx;
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let circle: Circle | null = null;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
    circle = new Circle({
      left: startX,
      top: startY,
      radius: 0,
      fill: 'transparent',
      stroke: color,
      strokeWidth,
    });
    canvas.add(circle);
  };

  const handleMouseMove = (opt: FabricMouseEvent) => {
    if (!drawing || !circle) return;
    const pt = canvas.getScenePoint(opt.e);
    const w = pt.x - startX;
    const h = pt.y - startY;
    const r = Math.sqrt(w * w + h * h);
    circle.set({ radius: r });
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        rafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    drawing = false;
    circle = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
  };
}

/**
 * Setup drag-based arrow drawing
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupDragArrow(ctx: DragToolContext): () => void {
  const { canvas, color, strokeWidth, rafRef } = ctx;
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let group: Group | null = null;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    drawing = true;
    startX = pt.x;
    startY = pt.y;
  };

  const handleMouseMove = (opt: FabricMouseEvent) => {
    if (!drawing) return;
    const pt = canvas.getScenePoint(opt.e);
    const endX = pt.x;
    const endY = pt.y;

    if (group) canvas.remove(group);

    const line = new Line([startX, startY, endX, endY], {
      stroke: color,
      strokeWidth,
    });

    const angle = Math.atan2(endY - startY, endX - startX);
    const headLen = 15;
    const arrowHead = new Polygon(
      [
        { x: 0, y: 0 },
        { x: -headLen, y: headLen / 2 },
        { x: -headLen, y: -headLen / 2 },
      ],
      {
        left: endX,
        top: endY,
        angle: (angle * 180) / Math.PI,
        fill: color,
        originX: 'center',
        originY: 'center',
      }
    );

    group = new Group([line, arrowHead], { selectable: true });
    canvas.add(group);
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        canvas.renderAll();
        rafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    drawing = false;
    group = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
  };
}

/**
 * Setup stamp tool - creates stamp annotations on click
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupStampTool(ctx: ClickToolContext): () => void {
  const { canvas, stampType = 'approved' } = ctx;
  const STAMP_FONT_SIZE = 28;

  const stampColors: Record<string, string> = {
    approved: '#22c55e',
    draft: '#f59e0b',
    confidential: '#ef4444',
    urgent: '#dc2626',
    void: '#b91c1c',
  };

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
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
  };

  canvas.on('mouse:down', handleMouseDown);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
  };
}

/**
 * Setup checkbox tool - creates checkbox marks on click
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupCheckboxTool(ctx: ClickToolContext): () => void {
  const { canvas, checkboxStyle = 'check' } = ctx;
  const CHECKBOX_SIZE = 22;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    const size = CHECKBOX_SIZE;

    // Draw just the mark on a temp canvas with DPI awareness, then add as image
    const dpr = window.devicePixelRatio || 1;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = (size + 4) * dpr;
    tempCanvas.height = (size + 4) * dpr;
    const ctx2d = tempCanvas.getContext('2d')!;
    ctx2d.scale(dpr, dpr);

    // Draw mark only (no surrounding box)
    ctx2d.strokeStyle = '#333333';
    ctx2d.lineWidth = 2.5;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.beginPath();
    if (checkboxStyle === 'x') {
      ctx2d.moveTo(4, 4);
      ctx2d.lineTo(size, size);
      ctx2d.moveTo(size, 4);
      ctx2d.lineTo(4, size);
    } else {
      ctx2d.moveTo(4, 2 + size / 2);
      ctx2d.lineTo(2 + size * 0.38, size - 1);
      ctx2d.lineTo(size, 5);
    }
    ctx2d.stroke();

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
  };

  canvas.on('mouse:down', handleMouseDown);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
  };
}

/**
 * Setup date tool - inserts current date on click
 * @param ctx - Tool context with canvas and configuration
 * @returns Cleanup function to remove event listeners
 */
export function setupDateTool(ctx: ClickToolContext): () => void {
  const { canvas, fontSize = 14, fontFamily = 'Arial', color = '#000000' } = ctx;

  const handleMouseDown = (opt: FabricMouseEvent) => {
    if (opt.target) return;
    const pt = canvas.getScenePoint(opt.e);
    const today = new Date().toLocaleDateString();
    const text = new IText(today, {
      left: pt.x,
      top: pt.y,
      originX: 'left',
      originY: 'bottom',
      fontSize,
      fontFamily,
      fill: color,
      stroke: color,
      strokeWidth: 0.5,
      paintFirst: 'stroke',
    });
    canvas.add(text);
  };

  canvas.on('mouse:down', handleMouseDown);

  return () => {
    canvas.off('mouse:down', handleMouseDown);
  };
}
