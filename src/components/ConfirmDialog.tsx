interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-label="Confirm action">
      <div className="confirm-dialog">
        <p>{message}</p>
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
    </div>
  );
}
