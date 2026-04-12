import { FocusTrap } from './FocusTrap';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-desc">
      <FocusTrap active={true}>
        <div className="confirm-dialog">
          <h2 id="confirm-dialog-title" className="sr-only">Confirm action</h2>
          <p id="confirm-dialog-desc">{message}</p>
          <div className="confirm-actions">
            <button className="confirm-btn cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="confirm-btn ok"
              onClick={() => {
                onConfirm();
                onCancel();
              }}
            >
              OK
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
