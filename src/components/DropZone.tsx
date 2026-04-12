import type { RefObject } from 'react';

interface DropZoneProps {
  isDragging: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (file: File) => void;
  onMerge: () => void;
}

export function DropZone({ isDragging, fileInputRef, onFileSelect, onMerge }: DropZoneProps) {
  return (
    <div className={`drop-zone ${isDragging ? 'drag-over' : ''}`}>
      <div className="drop-zone-content">
        <div className="drop-zone-icon">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="16" y="8" width="48" height="64" rx="4" stroke="currentColor" strokeWidth="2" opacity="0.3" />
            <rect
              x="20"
              y="12"
              width="48"
              height="64"
              rx="4"
              fill="currentColor"
              opacity="0.08"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M36 44l8-8 8 8M44 36v20"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M32 28h24M32 34h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          </svg>
        </div>
        <h2>Open a PDF to start editing</h2>
        <p className="drop-zone-subtitle">Edit, Annotate, Sign, Merge & More</p>
        <p className="drop-zone-hint">Drag and drop a PDF file here</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          aria-label="Choose PDF file to open"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelect(f);
          }}
          style={{ display: 'none' }}
        />
        <div className="drop-zone-actions">
          <button className="drop-zone-btn primary" onClick={() => fileInputRef.current?.click()}>
            Choose PDF File
          </button>
          <button className="drop-zone-btn secondary" onClick={onMerge}>
            Merge PDFs
          </button>
        </div>
        <span className="drop-zone-shortcut">or press Ctrl+O to open</span>
      </div>
    </div>
  );
}
