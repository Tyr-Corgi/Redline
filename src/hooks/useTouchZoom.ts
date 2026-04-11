import { useEffect, useRef } from 'react';

interface UseTouchZoomParams {
  zoom: number;
  setZoom: (zoom: number) => void;
  latestZoomRef: React.RefObject<number>;
}

export function useTouchZoom(params: UseTouchZoomParams, elementRef: React.RefObject<HTMLDivElement | null>): void {
  const { zoom, setZoom, latestZoomRef } = params;
  const zoomRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    let initialDistance = 0;
    let initialZoom = zoom;

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = getDistance(e.touches);
        initialZoom = latestZoomRef.current ?? zoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / initialDistance;
        const newZoom = Math.round(Math.max(0.25, Math.min(4, initialZoom * scale)) * 100) / 100;
        if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
        zoomRafRef.current = requestAnimationFrame(() => {
          setZoom(newZoom);
          zoomRafRef.current = null;
        });
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [zoom, setZoom, elementRef, latestZoomRef]);
}
