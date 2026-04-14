import { useEffect, useRef, useState } from 'react';

const TOAST_DURATION_MS = 5000;

interface ToastNotificationProps {
  message: string;
  type: 'error' | 'info';
  onDismiss: () => void;
}

export function ToastNotification({ message, onDismiss }: ToastNotificationProps) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(TOAST_DURATION_MS);
  const startRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (paused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      remainingRef.current -= Date.now() - startRef.current;
      return;
    }
    startRef.current = Date.now();
    timerRef.current = setTimeout(onDismiss, Math.max(remainingRef.current, 500));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paused, onDismiss]);

  return (
    <div
      className="toast-notification"
      role="alert"
      aria-live="assertive"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {message}
      <button onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
