import { useRef, useEffect, useCallback, useState, memo } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface PageSidebarProps {
  pdfDoc: PDFDocumentProxy;
  currentPage: number;
  onPageChange: (page: number) => void;
  pageRotations: Record<number, number>;
  onRotatePage: (page: number) => void;
  deletedPages: number[];
  onDeletePage: (page: number) => void;
  onConfirmDelete?: (message: string, onConfirm: () => void) => void;
}

function PageSidebarComponent({
  pdfDoc,
  currentPage,
  onPageChange,
  pageRotations,
  onRotatePage,
  deletedPages,
  onDeletePage,
  onConfirmDelete
}: PageSidebarProps) {
  const visiblePages = Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1)
    .filter(pageNum => !deletedPages.includes(pageNum));

  const [visibleThumbnails, setVisibleThumbnails] = useState<Set<number>>(new Set([currentPage]));
  const observerRef = useRef<IntersectionObserver | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Constants for windowed rendering
  const THUMB_HEIGHT = 200; // approximate height per thumbnail slot including padding
  const BUFFER = 3; // render 3 extra above and below viewport

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = Number(entry.target.getAttribute('data-page'));
          if (pageNum) setVisibleThumbnails(prev => new Set(prev).add(pageNum));
        }
      });
    }, { rootMargin: '100px' });

    return () => observerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    setVisibleThumbnails(prev => new Set(prev).add(currentPage));
  }, [currentPage]);

  // Track scroll position and container height for windowed rendering
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => setScrollTop(container.scrollTop);
    const handleResize = () => setContainerHeight(container.clientHeight);

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleResize();
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      ro.disconnect();
    };
  }, []);

  // Scroll active page into view when currentPage changes
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    const pageIndex = visiblePages.indexOf(currentPage);
    if (pageIndex === -1) return;

    const scrollPosition = pageIndex * THUMB_HEIGHT;
    const container = scrollContainerRef.current;
    const isInView = scrollPosition >= scrollTop && scrollPosition <= scrollTop + containerHeight - THUMB_HEIGHT;

    if (!isInView) {
      container.scrollTo({ top: scrollPosition - containerHeight / 2, behavior: 'smooth' });
    }
  }, [currentPage, visiblePages, scrollTop, containerHeight, THUMB_HEIGHT]);

  // Calculate which thumbnails to render based on scroll position
  const startIndex = Math.max(0, Math.floor(scrollTop / THUMB_HEIGHT) - BUFFER);
  const endIndex = Math.min(
    visiblePages.length - 1,
    Math.ceil((scrollTop + containerHeight) / THUMB_HEIGHT) + BUFFER
  );

  const topSpacer = startIndex * THUMB_HEIGHT;
  const bottomSpacer = (visiblePages.length - endIndex - 1) * THUMB_HEIGHT;

  return (
    <div className="page-sidebar">
      <div className="page-sidebar-header">Pages</div>
      <div ref={scrollContainerRef} className="page-sidebar-list">
        <div style={{ height: topSpacer }} />
        {visiblePages.slice(startIndex, endIndex + 1).map((pageNum) => (
          <PageThumbnail
            key={pageNum}
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            isActive={currentPage === pageNum}
            onClick={() => onPageChange(pageNum)}
            rotation={pageRotations[pageNum] || 0}
            onRotate={() => onRotatePage(pageNum)}
            onDelete={visiblePages.length > 1 ? () => onDeletePage(pageNum) : undefined}
            onConfirmDelete={onConfirmDelete}
            observer={observerRef.current}
            isVisible={visibleThumbnails.has(pageNum)}
          />
        ))}
        <div style={{ height: Math.max(0, bottomSpacer) }} />
      </div>
    </div>
  );
}

export const PageSidebar = memo(PageSidebarComponent);

function PageThumbnail({ pdfDoc, pageNum, isActive, onClick, rotation, onRotate, onDelete, onConfirmDelete, observer, isVisible }: {
  pdfDoc: PDFDocumentProxy;
  pageNum: number;
  isActive: boolean;
  onClick: () => void;
  rotation: number;
  onRotate: () => void;
  onDelete?: () => void;
  onConfirmDelete?: (message: string, onConfirm: () => void) => void;
  observer: IntersectionObserver | null;
  isVisible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const renderingRef = useRef(false);
  const retryCountRef = useRef(0);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || rendered || renderingRef.current || !isVisible) return;
    renderingRef.current = true;

    try {
      const page = await pdfDoc.getPage(pageNum);
      // Scale to fit ~150px width
      const baseViewport = page.getViewport({ scale: 1 });
      const thumbScale = 150 / baseViewport.width;
      const viewport = page.getViewport({ scale: thumbScale });

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      await (page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0])).promise;
      setRendered(true);
    } catch {
      // Retry up to 3 times on render failure (e.g. worker busy with main page)
      if (retryCountRef.current < 3) {
        retryCountRef.current++;
        renderingRef.current = false;
        setTimeout(() => render(), 200 * retryCountRef.current);
        return;
      }
    } finally {
      renderingRef.current = false;
    }
  }, [pdfDoc, pageNum, rendered, isVisible]);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    const container = containerRef.current;
    if (container && observer) {
      observer.observe(container);
      return () => observer.unobserve(container);
    }
  }, [observer]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    if (onConfirmDelete) {
      onConfirmDelete(`Delete page ${pageNum}?`, onDelete);
    } else {
      onDelete();
    }
  }, [onDelete, onConfirmDelete, pageNum]);

  const handleRotate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRotate();
  }, [onRotate]);

  return (
    <div
      ref={containerRef}
      className={`page-thumbnail ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      title={`Page ${pageNum}`}
      data-page={pageNum}
    >
      <canvas
        ref={canvasRef}
        style={{ transform: `rotate(${rotation}deg)` }}
      />
      <span className="page-thumbnail-num">{pageNum}</span>
      <div className="page-thumbnail-actions">
        {onDelete && (
          <button
            className="page-action-btn delete"
            onClick={handleDelete}
            title="Delete page"
            aria-label="Delete page"
          >
            ×
          </button>
        )}
        <button
          className="page-action-btn rotate"
          onClick={handleRotate}
          title="Rotate page"
          aria-label="Rotate page 90°"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
