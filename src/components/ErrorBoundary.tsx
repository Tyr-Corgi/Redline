import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Redline] Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#525659',
          color: '#e0e0e0',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          padding: '40px',
          textAlign: 'center',
        }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" style={{ marginBottom: '24px' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ fontSize: '24px', marginBottom: '12px', color: '#ffffff' }}>Something went wrong</h2>
          <p style={{ fontSize: '14px', color: '#b0b0b0', marginBottom: '8px', maxWidth: '500px' }}>
            The PDF editor encountered an unexpected error. Your work may have been auto-saved.
          </p>
          <p style={{ fontSize: '12px', color: '#808080', marginBottom: '24px', fontFamily: 'monospace' }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              background: '#0066cc',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            Reload Editor
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
