/**
 * Centralized configuration constants for Redline PDF Editor.
 * All magic numbers and hardcoded values are defined here for easy maintenance.
 */

// Editor behavior constants
export const EDITOR = {
  /** Debounce delay for auto-save to IndexedDB (ms) */
  AUTO_SAVE_DEBOUNCE_MS: 2000,
  /** Delay before showing "Saved" status (ms) */
  SAVE_STATUS_DELAY_MS: 900,
  /** Duration to display "Saved" status before resetting (ms) */
  SAVE_STATUS_RESET_MS: 3500,
  /** DPI scale factor for high-quality print rendering */
  PRINT_DPI_SCALE: 2,
  /** Maximum number of undo/redo history entries */
  MAX_HISTORY_SIZE: 50,
  /** Toast notification auto-dismiss delay (ms) */
  TOAST_AUTO_DISMISS_MS: 5000,
} as const;

// Zoom configuration
export const ZOOM = {
  /** Predefined zoom levels available in the dropdown */
  LEVELS: [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const,
  /** Minimum zoom level (25%) */
  MIN: 0.25,
  /** Maximum zoom level (400%) */
  MAX: 4.0,
  /** Zoom step for keyboard shortcuts and mouse wheel (25%) */
  STEP: 0.25,
  /** Default zoom level (100%) */
  DEFAULT: 1.0,
} as const;

// File size limits
export const FILES = {
  /** Maximum allowed PDF file size (50 MB) */
  MAX_PDF_SIZE_BYTES: 50 * 1024 * 1024,
  /** Maximum allowed image file size (10 MB) */
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  /** Accepted image MIME types for uploads */
  ACCEPTED_IMAGE_TYPES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const,
} as const;

// Canvas and annotation defaults
export const CANVAS = {
  /** Default width for inserted images (px) */
  IMAGE_DEFAULT_WIDTH: 200,
  /** Font size for stamp annotations (px) */
  STAMP_FONT_SIZE: 28,
  /** Size of checkbox marks (px) */
  CHECKBOX_SIZE: 22,
  /** Thumbnail width in page sidebar (px) */
  THUMBNAIL_WIDTH: 150,
} as const;

// IndexedDB storage configuration
export const STORAGE = {
  /** IndexedDB database name */
  DB_NAME: 'pdf-editor',
  /** IndexedDB database version */
  DB_VERSION: 1,
  /** Object store name for sessions */
  STORE_NAME: 'session',
  /** Key for the current active session */
  SESSION_KEY: 'current',
  /** Maximum number of backup sessions to keep */
  MAX_BACKUPS: 5,
  /** Prefix for backup session keys */
  BACKUP_PREFIX: 'session-backup-',
} as const;

// Toolbar configuration
export const TOOLBAR = {
  /** Available font sizes in the font size dropdown */
  FONT_SIZES: [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72] as const,
  /** Available line widths for drawing tools */
  LINE_WIDTHS: [1, 2, 3, 4, 5, 6, 8, 10] as const,
  /** Available font families */
  FONT_FAMILIES: ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'] as const,
} as const;

// Default tool configuration values
export const TOOL_DEFAULTS = {
  /** Default text color (black) */
  COLOR: '#000000',
  /** Default font size (px) */
  FONT_SIZE: 12,
  /** Default font family */
  FONT_FAMILY: 'Arial',
  /** Default bold state */
  BOLD: false,
  /** Default italic state */
  ITALIC: false,
  /** Default underline state */
  UNDERLINE: false,
  /** Default line width for drawing tools (px) */
  LINE_WIDTH: 2,
  /** Default opacity for highlights (30%) */
  OPACITY: 0.3,
  /** Default checkbox style */
  CHECKBOX_STYLE: 'check' as const,
  /** Default stamp type */
  STAMP_TYPE: 'approved' as const,
} as const;

// PDF validation constants
export const PDF = {
  /** Minimum valid PDF file size (header + minimal content) */
  MIN_SIZE_BYTES: 100,
  /** PDF magic number header */
  MAGIC_HEADER: '%PDF-',
  /** EOF marker in PDF tail */
  EOF_MARKER: '%%EOF',
  /** Required xref markers */
  XREF_MARKERS: ['xref', 'startxref'] as const,
  /** Size of tail to check for EOF marker (bytes) */
  TAIL_CHECK_SIZE: 1024,
} as const;

// Print configuration
export const PRINT = {
  /** Delay before triggering print dialog (ms) - allows images to load */
  DIALOG_DELAY_MS: 300,
} as const;

// Rotation values
export const ROTATION = {
  /** Available rotation angles (degrees) */
  ANGLES: [0, 90, 180, 270] as const,
  /** Rotation step (90 degrees clockwise) */
  STEP: 90,
} as const;
