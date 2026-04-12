import { useState, useRef, useCallback, useEffect } from 'react';
import { mergePdfs, getPageCount, downloadPdf } from '../services/pdfService';
import { FocusTrap } from './FocusTrap';

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;

interface PdfEntry {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  pageCount: number;
}

interface MergePdfModalProps {
  onClose: () => void;
  onMergedOpen: (bytes: ArrayBuffer, fileName: string) => void;
}

export default function MergePdfModal({ onClose, onMergedOpen }: MergePdfModalProps) {
  const [files, setFiles] = useState<PdfEntry[]>([]);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    const newEntries: PdfEntry[] = [];
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') {
        setError(`Skipped "${file.name}" — not a PDF`);
        continue;
      }
      if (file.size > MAX_PDF_SIZE_BYTES) {
        setError(`Skipped "${file.name}" — too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 50 MB)`);
        continue;
      }
      try {
        const bytes = await file.arrayBuffer();
        const pageCount = await getPageCount(bytes);
        newEntries.push({
          id: crypto.randomUUID(),
          name: file.name,
          bytes,
          pageCount,
        });
      } catch {
        setError(`Failed to read "${file.name}"`);
      }
    }
    setFiles((prev) => [...prev, ...newEntries]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const moveFile = useCallback((fromIdx: number, toIdx: number) => {
    setFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  }, []);

  const handleMergeAndDownload = useCallback(async () => {
    if (files.length < 2) return;
    setMerging(true);
    setError(null);
    try {
      const result = await mergePdfs(files.map((f) => ({ bytes: f.bytes, name: f.name })));
      downloadPdf(result, 'merged.pdf');
    } catch (err) {
      setError(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMerging(false);
    }
  }, [files]);

  const handleMergeAndOpen = useCallback(async () => {
    if (files.length < 2) return;
    setMerging(true);
    setError(null);
    try {
      const result = await mergePdfs(files.map((f) => ({ bytes: f.bytes, name: f.name })));
      onMergedOpen(result.buffer as ArrayBuffer, 'merged.pdf');
      onClose();
    } catch (err) {
      setError(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMerging(false);
    }
  }, [files, onMergedOpen, onClose]);

  const totalPages = files.reduce((sum, f) => sum + f.pageCount, 0);

  // Drag-and-drop reordering handlers
  const onDragStart = (idx: number) => {
    setDragIdx(idx);
  };
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const onDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      moveFile(dragIdx, dragOverIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="merge-modal-overlay" onClick={onClose}>
      <FocusTrap>
      <div className="merge-modal" role="dialog" aria-modal="true" aria-labelledby="merge-modal-title" aria-describedby="merge-modal-instructions" onClick={(e) => e.stopPropagation()}>
        <p id="merge-modal-instructions" className="sr-only">Press Escape to close this dialog.</p>
        <div className="merge-modal-header">
          <h3 id="merge-modal-title">Merge PDFs</h3>
          <button className="signature-modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="merge-modal-body">
          {/* Upload area */}
          <div
            className="merge-upload-zone"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over'); }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('drag-over');
              if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
            }}
            tabIndex={0}
            role="button"
            aria-label="Add PDF files for merging"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
              style={{ display: 'none' }}
            />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Click or drop PDF files here</span>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ol className="merge-file-list" role="list">
              {files.map((entry, idx) => (
                <li
                  key={entry.id}
                  className={`merge-file-item ${dragIdx === idx ? 'dragging' : ''} ${dragOverIdx === idx ? 'drag-target' : ''}`}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                >
                  <span className="merge-file-grip" title="Drag to reorder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
                    </svg>
                  </span>
                  <span className="merge-file-num">{idx + 1}</span>
                  <span className="merge-file-name" title={entry.name}>{entry.name}</span>
                  <span className="merge-file-pages">{entry.pageCount} pg{entry.pageCount !== 1 ? 's' : ''}</span>
                  <button
                    className="merge-file-move"
                    disabled={idx === 0}
                    onClick={() => moveFile(idx, idx - 1)}
                    title="Move up"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
                  </button>
                  <button
                    className="merge-file-move"
                    disabled={idx === files.length - 1}
                    onClick={() => moveFile(idx, idx + 1)}
                    title="Move down"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  <button className="merge-file-remove" onClick={() => removeFile(entry.id)} title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* Summary */}
          {files.length > 0 && (
            <div className="merge-summary">
              {files.length} file{files.length !== 1 ? 's' : ''} &middot; {totalPages} total page{totalPages !== 1 ? 's' : ''}
            </div>
          )}

          {error && <div className="merge-error" role="alert" aria-live="assertive">{error}</div>}
        </div>

        <div className="merge-modal-footer">
          {files.length < 2 && <span id="merge-hint" className="sr-only">Add at least 2 PDF files to merge</span>}
          <button className="signature-modal-btn cancel" onClick={onClose}>Cancel</button>
          <button
            className="signature-modal-btn save"
            disabled={files.length < 2 || merging}
            onClick={handleMergeAndDownload}
            aria-describedby={files.length < 2 ? 'merge-hint' : undefined}
          >
            {merging ? 'Merging...' : 'Merge & Download'}
          </button>
          <button
            className="signature-modal-btn save"
            disabled={files.length < 2 || merging}
            onClick={handleMergeAndOpen}
            aria-describedby={files.length < 2 ? 'merge-hint' : undefined}
          >
            {merging ? 'Merging...' : 'Merge & Open'}
          </button>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
