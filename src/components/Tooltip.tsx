import { useState, useRef, useCallback } from 'react';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom';
  delay?: number;
}

export function Tooltip({ text, children, position = 'bottom', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const tooltipId = useRef(`tooltip-${Math.random().toString(36).substr(2, 9)}`);

  const show = useCallback((e: React.MouseEvent | React.FocusEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = position === 'bottom' ? rect.bottom + 6 : rect.top - 6;
    setCoords({ x, y });
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [position, delay]);

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setVisible(false);
  }, []);

  return (
    <div
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ display: 'inline-flex' }}
      aria-describedby={visible ? tooltipId.current : undefined}
    >
      {children}
      {visible && (
        <div
          id={tooltipId.current}
          role="tooltip"
          className={`aurora-tooltip aurora-tooltip-${position}`}
          style={{
            position: 'fixed',
            left: coords.x,
            top: coords.y,
            transform: position === 'bottom' ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
