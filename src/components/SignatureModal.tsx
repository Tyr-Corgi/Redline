import { useRef, useEffect, useState, useId } from 'react';
import { Canvas as FabricCanvas, PencilBrush } from 'fabric';
import { FocusTrap } from './FocusTrap';

interface SignatureModalProps {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}

export function SignatureModal({ onSave, onCancel }: SignatureModalProps) {
  const uniqueId = useId().replace(/:/g, '');
  const canvasId = `sig-${uniqueId}`;
  const canvasRef = useRef<FabricCanvas | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const fc = new FabricCanvas(canvasId, {
      width: 600,
      height: 250,
      backgroundColor: '#ffffff',
      isDrawingMode: true,
    });
    const brush = new PencilBrush(fc);
    brush.width = 3;
    brush.color = '#000000';
    fc.freeDrawingBrush = brush;
    canvasRef.current = fc;
    setReady(true);

    return () => { fc.dispose(); canvasRef.current = null; };
  }, [canvasId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleClear = () => {
    canvasRef.current?.clear();
    if (canvasRef.current) {
      canvasRef.current.backgroundColor = '#ffffff';
      canvasRef.current.renderAll();
    }
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
    onSave(dataUrl);
  };

  return (
    <div className="signature-modal" onClick={onCancel}>
      <FocusTrap>
      <div className="signature-modal-content" role="dialog" aria-modal="true" aria-label="Draw Your Signature" onClick={(e) => e.stopPropagation()}>
        <div className="signature-modal-header">
          <h3>Draw Your Signature</h3>
          <button className="signature-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="signature-canvas-wrapper">
          <canvas id={canvasId} />
        </div>
        <div className="signature-modal-actions">
          <button className="signature-modal-btn clear" onClick={handleClear}>Clear</button>
          <button className="signature-modal-btn cancel" onClick={onCancel}>Cancel</button>
          <button className="signature-modal-btn save" onClick={handleSave} disabled={!ready}>
            Save Signature
          </button>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
