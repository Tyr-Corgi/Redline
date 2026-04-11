interface ToastNotificationProps {
  message: string;
  type: 'error' | 'info';
  onDismiss: () => void;
}

export function ToastNotification({ message, onDismiss }: ToastNotificationProps) {
  return (
    <div className="toast-notification" role="alert" aria-live="assertive">
      {message}
      <button onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
