/**
 * Feature flag system for Redline PDF Editor.
 * Controls optional features and limits via environment variables.
 */

export interface FeatureFlags {
  /** Enable automatic session saving to IndexedDB */
  enableAutoSave: boolean;
  /** Enable keyboard shortcuts (Ctrl+Z, Ctrl+S, etc.) */
  enableKeyboardShortcuts: boolean;
  /** Enable touch gestures (pinch-to-zoom) */
  enableTouchGestures: boolean;
  /** Enable session restore from IndexedDB on page load */
  enableSessionRestore: boolean;
  /** Maximum number of PDF pages to allow */
  maxPdfPages: number;
  /** Maximum PDF file size in bytes */
  maxPdfSizeBytes: number;
  /** Maximum image file size in bytes */
  maxImageSizeBytes: number;
}

/** Default feature flag values (production-ready defaults) */
const defaultFlags: FeatureFlags = {
  enableAutoSave: true,
  enableKeyboardShortcuts: true,
  enableTouchGestures: true,
  enableSessionRestore: true,
  maxPdfPages: 500,
  maxPdfSizeBytes: 50 * 1024 * 1024, // 50 MB
  maxImageSizeBytes: 10 * 1024 * 1024, // 10 MB
};

/**
 * Read feature flags from environment variables, falling back to defaults.
 * Environment variables are prefixed with VITE_ to be exposed to the browser.
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    enableAutoSave: import.meta.env.VITE_ENABLE_AUTO_SAVE !== 'false',
    enableKeyboardShortcuts: import.meta.env.VITE_ENABLE_SHORTCUTS !== 'false',
    enableTouchGestures: import.meta.env.VITE_ENABLE_TOUCH !== 'false',
    enableSessionRestore: import.meta.env.VITE_ENABLE_RESTORE !== 'false',
    maxPdfPages: parseInt(import.meta.env.VITE_MAX_PDF_PAGES, 10) || defaultFlags.maxPdfPages,
    maxPdfSizeBytes: parseInt(import.meta.env.VITE_MAX_PDF_SIZE_MB, 10) * 1024 * 1024 || defaultFlags.maxPdfSizeBytes,
    maxImageSizeBytes: parseInt(import.meta.env.VITE_MAX_IMAGE_SIZE_MB, 10) * 1024 * 1024 || defaultFlags.maxImageSizeBytes,
  };
}

/**
 * Active feature flags for the current session.
 * This is a singleton instance that gets evaluated once at module load time.
 */
export const features = getFeatureFlags();
