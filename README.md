# Redline

A powerful, privacy-first PDF editor that runs entirely in your browser. No uploads, no servers, no accounts — your documents never leave your device.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

### Annotation Tools
- **Text** — Click anywhere to add editable text with full formatting (font, size, bold, italic, underline)
- **Draw** — Freehand drawing with configurable brush width and color
- **Highlight** — Drag to highlight regions with adjustable opacity
- **Redact** — Black-out sensitive content permanently on export
- **Arrow** — Draw directional arrows with arrowheads
- **Circle** — Drag to draw circles/ellipses
- **Shape** — Drag to draw rectangles with stroke styling
- **Stamp** — Place stamps (Approved, Draft, Confidential, Urgent, Void)
- **Checkbox** — Add check marks or X marks to forms
- **Date** — Insert today's date as editable text
- **Signature** — Draw your signature on a pad and place it
- **Image** — Upload and embed images onto pages
- **Eraser** — Click any annotation to remove it

### Document Management
- **Merge PDFs** — Combine multiple PDF files with drag-and-drop reordering
- **Rotate Pages** — Rotate individual pages (90 degree increments)
- **Delete Pages** — Remove unwanted pages with confirmation
- **Page Sidebar** — Visual thumbnail navigation with live previews

### Editor Features
- **Undo / Redo** — Full history with Ctrl+Z / Ctrl+Shift+Z
- **Zoom** — 25% to 400% with Ctrl+scroll, pinch-to-zoom, and dropdown
- **Auto-Save** — Debounced session persistence to IndexedDB
- **Session Restore** — Automatically restores your last editing session on reload
- **Print** — Multi-page print with annotation overlays
- **Export** — Save as PDF with annotations flattened into the document

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+S` | Save/Export PDF |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `V` | Select tool |
| `T` | Text tool |
| `D` | Draw tool |
| `H` | Highlight tool |
| `+` / `-` | Zoom in/out |
| `Delete` | Remove selected annotation |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 |
| Language | TypeScript 6 |
| Build | Vite 8 |
| PDF Rendering | pdfjs-dist 5 |
| PDF Export | pdf-lib |
| Canvas Annotations | Fabric.js 7 |
| Storage | IndexedDB (browser-native) |

## Getting Started

```bash
# Clone
git clone https://github.com/Tyr-Corgi/Redline.git
cd Redline

# Install
npm install

# Dev server (localhost:5173)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Architecture

```
src/
  App.tsx                  # Main orchestrator — file handling, save/print, keyboard shortcuts
  components/
    Toolbar.tsx            # Tool selection, formatting controls, navigation
    PageCanvas.tsx         # PDF rendering + Fabric.js annotation overlay
    PageSidebar.tsx        # Thumbnail navigation with rotate/delete actions
    SignatureModal.tsx      # Draw-to-sign signature pad
    MergePdfModal.tsx      # Multi-PDF merge with drag reorder
    Tooltip.tsx            # Custom animated tooltip system
    FocusTrap.tsx          # Accessible focus trap for modals
    ErrorBoundary.tsx      # React error boundary
  hooks/
    usePdfEditor.ts        # Core state management (useReducer + annotation store)
  services/
    pdfService.ts          # PDF.js rendering, pdf-lib export, merge operations
    storageService.ts      # IndexedDB session persistence with backup rotation
  styles/
    index.css              # Aurora design system — CSS custom properties, glass-morphism
  types/
    index.ts               # TypeScript type definitions
```

## Design

Redline uses the **Aurora** design system — a dark-theme UI built on CSS custom properties with:

- Deep purple palette (`#1e1e2e` base, `#4f8cff` accent)
- Glass-morphism toolbar and sidebar (`backdrop-filter: blur`)
- Micro-interactions on all interactive elements
- 8 custom animations (fade, slide, scale, pulse)
- 4px thin auto-hiding scrollbars
- WCAG 2.1 AA accessible with full keyboard navigation

## Privacy

Redline is 100% client-side. Your PDFs are processed entirely in the browser using Web APIs:

- **No server uploads** — files stay on your machine
- **No tracking** — zero analytics, no cookies
- **No accounts** — nothing to sign up for
- **Local storage only** — auto-save uses IndexedDB in your browser

## License

MIT
