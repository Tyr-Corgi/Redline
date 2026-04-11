import { useRef, memo } from 'react';
import type { Tool, ToolConfig } from '../types';
import { Tooltip } from './Tooltip';

interface ToolbarProps {
  activeTool: Tool;
  toolConfig: ToolConfig;
  currentPage: number;
  numPages: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  fileName?: string;
  onNewProject: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
  onPrint: () => void;
  onMergePdfs: () => void;
  onToolChange: (tool: Tool) => void;
  onToolConfigChange: (config: Partial<ToolConfig>) => void;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const fontSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const lineWidths = [1, 2, 3, 4, 5, 6, 8, 10];
const fontFamilies = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];

const tools: { tool: Tool; title: string; icon: string }[] = [
  { tool: 'select', title: 'Select & Move — Click to select, drag to move objects (V)', icon: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' },
  { tool: 'text', title: 'Add Text — Click anywhere to type text on the PDF (T)', icon: 'M4 7V4h16v3M9 20h6M12 4v16' },
  { tool: 'draw', title: 'Freehand Draw — Draw freely with your mouse or pen (D)', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z' },
  { tool: 'highlight', title: 'Highlight — Click and drag to highlight an area (H)', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { tool: 'redact', title: 'Redact — Click and drag to black out sensitive information', icon: 'M3 3h18v18H3zM3 3l18 18' },
  { tool: 'signature', title: 'Signature — Draw your signature and place it on the document', icon: 'M3 17l6-6 4 4 8-8M14 7h7v7' },
  { tool: 'checkbox', title: 'Checkbox — Click to place a checkmark on the document', icon: 'M9 11l3 3 5-5M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { tool: 'date', title: "Date Stamp — Click to insert today's date", icon: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18' },
  { tool: 'image', title: 'Insert Image — Upload and place an image on the document', icon: 'M3 3h18v18H3zM8.5 8.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM21 15l-5-5L5 21' },
  { tool: 'shape', title: 'Shape — Click and drag to draw a rectangle', icon: 'M3 3h18v18H3z' },
  { tool: 'arrow', title: 'Arrow — Click and drag to draw an arrow', icon: 'M5 12h14M12 5l7 7-7 7' },
  { tool: 'circle', title: 'Circle — Click and drag to draw a circle', icon: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0' },
  { tool: 'stamp', title: 'Stamp — Click to place a pre-styled stamp', icon: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7' },
  { tool: 'eraser', title: 'Eraser — Click on any annotation to remove it', icon: 'M20 20H7L3 16l10-10 7 7v7zM10 10l4 4' },
];

function Toolbar({
  activeTool,
  toolConfig,
  currentPage,
  numPages,
  zoom,
  canUndo,
  canRedo,
  onNewProject,
  onOpenFile,
  onSave,
  onPrint,
  onMergePdfs,
  onToolChange,
  onToolConfigChange,
  onPageChange,
  onZoomChange,
  onUndo,
  onRedo,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file?.type === 'application/pdf') onOpenFile(file);
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="PDF editing tools">
      {/* File */}
      <div className="toolbar-section">
        <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileChange} style={{ display: 'none' }} />
        <button className="tool-btn" onClick={onNewProject} title="New Project" aria-label="New Project">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
        </button>
        <button className="tool-btn" onClick={() => fileInputRef.current?.click()} title="Open PDF" aria-label="Open PDF">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
        </button>
        <button className="tool-btn" onClick={onSave} title="Save PDF (Ctrl+S)" aria-label="Save PDF">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
        </button>
        <button className="tool-btn" onClick={onPrint} title="Print" aria-label="Print">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
        </button>
        <button className="tool-btn" onClick={onMergePdfs} title="Merge PDFs" aria-label="Merge PDFs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="8" height="10" rx="1" /><rect x="14" y="3" width="8" height="10" rx="1" /><path d="M6 16v2a2 2 0 002 2h8a2 2 0 002-2v-2" /><line x1="12" y1="13" x2="12" y2="18" /></svg>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Undo/Redo */}
      <div className="toolbar-section">
        <button className="tool-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" /></svg>
        </button>
        <button className="tool-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" /></svg>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Tools */}
      <div className="toolbar-section">
        {tools.map(({ tool, title, icon }) => (
          <Tooltip key={tool} text={title.split(' — ')[0]}>
            <button
              className={`tool-btn ${activeTool === tool ? 'active' : ''}`}
              onClick={() => onToolChange(tool)}
              aria-label={title.split(' — ')[0]}
              aria-pressed={activeTool === tool}
              aria-current={activeTool === tool ? 'true' : undefined}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={icon} />
              </svg>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="toolbar-divider" />

      {/* Config */}
      <div className="toolbar-section">
        {['text', 'draw', 'shape', 'date', 'highlight', 'arrow', 'circle'].includes(activeTool) && (
          <div className="tool-config-item">
            <label htmlFor="tool-color" className="config-label">Color</label>
            <input id="tool-color" type="color" value={toolConfig.color} onChange={(e) => onToolConfigChange({ color: e.target.value })} className="color-input" aria-label="Color picker" />
          </div>
        )}
        {['text', 'date'].includes(activeTool) && (
          <>
            <div className="tool-config-item">
              <label htmlFor="tool-font-family" className="config-label">Font</label>
              <select id="tool-font-family" value={toolConfig.fontFamily} onChange={(e) => onToolConfigChange({ fontFamily: e.target.value })} className="config-select" aria-label="Font family">
                {fontFamilies.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </div>
            <div className="tool-config-item">
              <label htmlFor="tool-font-size" className="config-label">Size</label>
              <select id="tool-font-size" value={toolConfig.fontSize} onChange={(e) => onToolConfigChange({ fontSize: Number(e.target.value) })} className="config-select" aria-label="Font size">
                {fontSizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="tool-config-item">
              <button
                className={`tool-btn format-btn ${toolConfig.bold ? 'active' : ''}`}
                onClick={() => onToolConfigChange({ bold: !toolConfig.bold })}
                title="Bold"
                aria-label="Bold"
                aria-pressed={toolConfig.bold}
              >
                <strong>B</strong>
              </button>
              <button
                className={`tool-btn format-btn ${toolConfig.italic ? 'active' : ''}`}
                onClick={() => onToolConfigChange({ italic: !toolConfig.italic })}
                title="Italic"
                aria-label="Italic"
                aria-pressed={toolConfig.italic}
              >
                <em>I</em>
              </button>
              <button
                className={`tool-btn format-btn ${toolConfig.underline ? 'active' : ''}`}
                onClick={() => onToolConfigChange({ underline: !toolConfig.underline })}
                title="Underline"
                aria-label="Underline"
                aria-pressed={toolConfig.underline}
              >
                <span style={{ textDecoration: 'underline' }}>U</span>
              </button>
            </div>
          </>
        )}
        {['draw', 'shape', 'arrow', 'circle'].includes(activeTool) && (
          <div className="tool-config-item">
            <label htmlFor="tool-line-width" className="config-label">Width</label>
            <select id="tool-line-width" value={toolConfig.lineWidth} onChange={(e) => onToolConfigChange({ lineWidth: Number(e.target.value) })} className="config-select" aria-label="Stroke width">
              {lineWidths.map((w) => <option key={w} value={w}>{w}px</option>)}
            </select>
          </div>
        )}
        {activeTool === 'highlight' && (
          <div className="tool-config-item">
            <label htmlFor="tool-opacity" className="config-label">Opacity</label>
            <input id="tool-opacity" type="range" min="0.1" max="1" step="0.1" value={toolConfig.opacity} onChange={(e) => onToolConfigChange({ opacity: Number(e.target.value) })} className="opacity-slider" aria-label="Opacity" aria-valuetext={`${Math.round((toolConfig.opacity || 0.3) * 100)} percent`} />
            <span className="opacity-value">{Math.round(toolConfig.opacity * 100)}%</span>
          </div>
        )}
        {activeTool === 'checkbox' && (
          <div className="tool-config-item">
            <label className="config-label">Style</label>
            <button
              className={`tool-btn format-btn ${toolConfig.checkboxStyle === 'check' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ checkboxStyle: 'check' })}
              title="Checkmark"
              aria-label="Checkmark style"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
            <button
              className={`tool-btn format-btn ${toolConfig.checkboxStyle === 'x' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ checkboxStyle: 'x' })}
              title="X Mark"
              aria-label="X Mark style"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        )}
        {activeTool === 'stamp' && (
          <div className="tool-config-item">
            <label className="config-label">Stamp</label>
            <button
              className={`tool-btn format-btn ${toolConfig.stampType === 'approved' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ stampType: 'approved' })}
              title="Approved"
              aria-label="Approved stamp"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              APR
            </button>
            <button
              className={`tool-btn format-btn ${toolConfig.stampType === 'draft' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ stampType: 'draft' })}
              title="Draft"
              aria-label="Draft stamp"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              DFT
            </button>
            <button
              className={`tool-btn format-btn ${toolConfig.stampType === 'confidential' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ stampType: 'confidential' })}
              title="Confidential"
              aria-label="Confidential stamp"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              CONF
            </button>
            <button
              className={`tool-btn format-btn ${toolConfig.stampType === 'urgent' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ stampType: 'urgent' })}
              title="Urgent"
              aria-label="Urgent stamp"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              URG
            </button>
            <button
              className={`tool-btn format-btn ${toolConfig.stampType === 'void' ? 'active' : ''}`}
              onClick={() => onToolConfigChange({ stampType: 'void' })}
              title="Void"
              aria-label="Void stamp"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              VOID
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-spacer" />

      {/* Pages */}
      <div className="toolbar-section">
        <button className="tool-btn" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1} title="Previous Page" aria-label="Previous Page">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="page-info">Page {currentPage} of {numPages || 0}</span>
        <button className="tool-btn" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= numPages} title="Next Page" aria-label="Next Page">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Zoom */}
      <div className="toolbar-section">
        <button className="tool-btn" onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))} title="Zoom Out (-)" aria-label="Zoom Out">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
        </button>
        <select id="zoom-level" value={zoom} onChange={(e) => onZoomChange(Number(e.target.value))} className="zoom-select" aria-label="Zoom level">
          {zoomLevels.map((l) => <option key={l} value={l}>{Math.round(l * 100)}%</option>)}
        </select>
        <button className="tool-btn" onClick={() => onZoomChange(Math.min(4, zoom + 0.25))} title="Zoom In (+)" aria-label="Zoom In">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
        </button>
      </div>
    </div>
  );
}

export default memo(Toolbar);
