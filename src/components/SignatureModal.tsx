import { useRef, useEffect, useState, useId, useCallback } from 'react';
import { Canvas as FabricCanvas, PencilBrush } from 'fabric';
import { FocusTrap } from './FocusTrap';

interface SignatureModalProps {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}

const SIGNATURE_FONTS = [
  { family: 'Dancing Script', label: 'Cursive' },
  { family: 'Great Vibes', label: 'Elegant' },
  { family: 'Alex Brush', label: 'Brush' },
  { family: 'Sacramento', label: 'Flowing' },
] as const;

type TabMode = 'draw' | 'type';

/**
 * Preload fonts so canvas.fillText renders correctly on first use.
 * Uses the FontFace API — if a font is already loaded this resolves immediately.
 */
async function ensureFontLoaded(family: string): Promise<void> {
  try {
    await document.fonts.load(`48px "${family}"`);
  } catch {
    // Font might not be available — fallback will render with serif
  }
}

export function SignatureModal({ onSave, onCancel }: SignatureModalProps) {
  const uniqueId = useId().replace(/:/g, '');
  const canvasId = `sig-${uniqueId}`;
  const canvasRef = useRef<FabricCanvas | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<TabMode>('type');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(0);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Preload all signature fonts on mount
  useEffect(() => {
    Promise.all(SIGNATURE_FONTS.map(f => ensureFontLoaded(f.family)))
      .then(() => setFontsLoaded(true));
  }, []);

  // Initialize Fabric canvas for draw mode
  useEffect(() => {
    if (mode !== 'draw') return;

    const el = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!el) return;

    const fc = new FabricCanvas(el, {
      width: 560,
      height: 200,
      backgroundColor: '#ffffff',
      isDrawingMode: true,
    });
    const brush = new PencilBrush(fc);
    brush.width = 3;
    brush.color = '#1a1a2e';
    fc.freeDrawingBrush = brush;
    canvasRef.current = fc;
    setReady(true);

    return () => { fc.dispose(); canvasRef.current = null; setReady(false); };
  }, [canvasId, mode]);

  // Render typed signature on canvas.
  // `forExport` = true renders with transparent background (no white fill, no guide line).
  // `forExport` = false renders the visual preview with white background + signature line.
  const renderTypedSignature = useCallback((forExport: boolean) => {
    const canvas = previewRef.current;
    if (!canvas || !typedName.trim()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Use 4x scale for export to produce sharp text when embedded in the PDF
    const scale = forExport ? 4 : dpr;
    const w = 560;
    const h = 200;
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(scale, scale);

    if (forExport) {
      // Transparent background — just clear
      ctx.clearRect(0, 0, w, h);
    } else {
      // White background for visual preview
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      // Signature guide line (preview only)
      ctx.strokeStyle = '#d0d0d8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, 145);
      ctx.lineTo(520, 145);
      ctx.stroke();
    }

    // Signature text
    const font = SIGNATURE_FONTS[selectedFont] ?? SIGNATURE_FONTS[0];
    ctx.fillStyle = '#1a1a2e';
    ctx.font = `48px "${font.family}", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(typedName.trim(), w / 2, 140);
  }, [typedName, selectedFont]);

  useEffect(() => {
    if (mode === 'type' && fontsLoaded) {
      renderTypedSignature(false);
    }
  }, [mode, fontsLoaded, renderTypedSignature]);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleClear = () => {
    if (mode === 'draw') {
      canvasRef.current?.clear();
      if (canvasRef.current) {
        canvasRef.current.backgroundColor = '#ffffff';
        canvasRef.current.renderAll();
      }
    } else {
      setTypedName('');
      const canvas = previewRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  };

  const handleSave = () => {
    if (mode === 'draw') {
      if (!canvasRef.current) return;
      // Temporarily remove white background so export is transparent
      const prevBg = canvasRef.current.backgroundColor;
      canvasRef.current.backgroundColor = '';
      canvasRef.current.renderAll();
      const dataUrl = canvasRef.current.toDataURL({ format: 'png', quality: 1, multiplier: 3 });
      // Restore white background (in case user cancels save and keeps editing)
      canvasRef.current.backgroundColor = prevBg;
      canvasRef.current.renderAll();
      onSave(dataUrl);
    } else {
      if (!typedName.trim() || !previewRef.current) return;
      // Render with transparent background for export
      renderTypedSignature(true);
      const dataUrl = previewRef.current.toDataURL('image/png');
      onSave(dataUrl);
    }
  };

  const canSave = mode === 'draw' ? ready : typedName.trim().length > 0;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="signature-modal" onClick={handleBackdropClick}>
      <FocusTrap>
      <div className="signature-modal-content" role="dialog" aria-modal="true" aria-labelledby="signature-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="signature-modal-header">
          <h2 id="signature-modal-title">Add Signature</h2>
          <button className="signature-modal-close" onClick={onCancel} aria-label="Close signature dialog">&times;</button>
        </div>

        {/* Tabs */}
        <div className="signature-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'type'}
            className={`signature-tab ${mode === 'type' ? 'active' : ''}`}
            onClick={() => setMode('type')}
          >
            Type
          </button>
          <button
            role="tab"
            aria-selected={mode === 'draw'}
            className={`signature-tab ${mode === 'draw' ? 'active' : ''}`}
            onClick={() => setMode('draw')}
          >
            Draw
          </button>
        </div>

        {/* Draw panel */}
        {mode === 'draw' && (
          <div className="signature-canvas-wrapper" aria-label="Signature drawing area">
            <canvas id={canvasId} />
          </div>
        )}

        {/* Type panel */}
        {mode === 'type' && (
          <div className="signature-type-panel">
            <div className="signature-font-picker">
              {SIGNATURE_FONTS.map((font, i) => (
                <button
                  key={font.family}
                  className={`signature-font-option ${i === selectedFont ? 'active' : ''}`}
                  onClick={() => setSelectedFont(i)}
                  aria-label={`${font.label} style`}
                  aria-pressed={i === selectedFont}
                >
                  <span style={{ fontFamily: `"${font.family}", cursive`, fontSize: '20px' }}>
                    {typedName.trim() || 'Signature'}
                  </span>
                  <span className="signature-font-label">{font.label}</span>
                </button>
              ))}
            </div>
            <input
              type="text"
              className="signature-type-input"
              placeholder="Type your full name"
              value={typedName}
              maxLength={60}
              autoFocus
              onChange={(e) => setTypedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedName.trim()) handleSave();
              }}
              aria-label="Type your name for signature"
              style={{ fontFamily: `"${(SIGNATURE_FONTS[selectedFont] ?? SIGNATURE_FONTS[0]).family}", cursive` }}
            />
            <div className="signature-preview-wrapper">
              <canvas ref={previewRef} aria-label="Signature preview" />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="signature-modal-actions">
          <button className="signature-modal-btn clear" onClick={handleClear}>Clear</button>
          <button className="signature-modal-btn cancel" onClick={onCancel}>Cancel</button>
          <button className="signature-modal-btn save" onClick={handleSave} disabled={!canSave}>
            Use Signature
          </button>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
