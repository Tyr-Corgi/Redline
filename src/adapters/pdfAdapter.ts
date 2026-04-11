import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfAdapter {
  loadDocument(buffer: ArrayBuffer): Promise<PDFDocumentProxy>;
  getPage(doc: PDFDocumentProxy, pageNum: number): Promise<unknown>;
  renderPage(page: unknown, canvas: HTMLCanvasElement, scale: number): Promise<void>;
}

// Default implementation wraps pdfjs-dist
export const defaultPdfAdapter: PdfAdapter = {
  async loadDocument(buffer) {
    const { getDocument } = await import('pdfjs-dist');
    return getDocument({ data: buffer }).promise;
  },
  async getPage(doc, pageNum) {
    return (doc as PDFDocumentProxy).getPage(pageNum);
  },
  async renderPage() {
    // Implementation delegates to pdfjs render
    // This is a placeholder for actual render logic
  },
};
