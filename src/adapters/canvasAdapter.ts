export interface CanvasAdapter {
  createCanvas(): HTMLCanvasElement;
  getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null;
  toDataURL(canvas: HTMLCanvasElement, format?: string): string;
}

export const defaultCanvasAdapter: CanvasAdapter = {
  createCanvas: () => document.createElement('canvas'),
  getContext: (canvas) => canvas.getContext('2d'),
  toDataURL: (canvas, format = 'image/png') => canvas.toDataURL(format),
};
