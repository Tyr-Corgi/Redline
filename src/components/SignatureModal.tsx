import { useRef, useEffect, useState, useId, useCallback } from 'react';
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

  const handleTypedSignature = useCallback((name: string) => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 250;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 250);
    ctx.fillStyle = '#000000';
    ctx.font = 'italic 48px "Georgia", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 300, 125);
    onSave(c.toDataURL('image/png'));
  }, [onSave]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      // Check if canvas has content
      const canvas = canvasRef.current;
      if (canvas) {
        const htmlCanvas = canvas.getElement();
        const ctx = htmlCanvas.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, htmlCanvas.width, htmlCanvas.height);
          const hasContent = imageData.data.some((val, i) => i % 4 === 3 && val > 0);
          if (hasContent) {
            // Don't close - user has drawn something. They should use Cancel button explicitly.
            return;
          }
        }
      }
      onCancel();
    }
  };

  return (
    <div className="signature-modal" onClick={handleBackdropClick}>
      <FocusTrap>
      <div className="signature-modal-content" role="dialog" aria-modal="true" aria-labelledby="signature-modal-title" aria-describedby="signature-modal-instructions" onClick={(e) => e.stopPropagation()}>
        <p id="signature-modal-instructions" className="sr-only">Press Escape to close this dialog.</p>
        <div className="signature-modal-header">
          <h2 id="signature-modal-title">Draw Your Signature</h2>
          <button className="signature-modal-close" onClick={onCancel} aria-label="Close signature dialog">✕</button>
        </div>
        <div className="signature-canvas-wrapper" aria-label="Signature drawing area. Use mouse or touch to draw your signature.">
          <canvas id={canvasId} />
        </div>
        <div className="signature-type-wrapper">
          <label htmlFor={`sig-type-${uniqueId}`} className="signature-type-label">Or type your name:</label>
          <input
            id={`sig-type-${uniqueId}`}
            type="text"
            className="signature-type-input"
            placeholder="Your name"
            maxLength={80}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) handleTypedSignature(val);
              }
            }}
            aria-label="Type your name as a signature"
          />
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
