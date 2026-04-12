/**
 * IndexedDB-based session persistence.
 * Stores the original PDF bytes + all per-page Fabric annotations
 * so the editing session survives page refreshes.
 */

const DB_NAME = 'pdf-editor';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';
const MAX_STORED_SESSIONS = 5;

// Dirty page tracking for optimized auto-save
const dirtyPages = new Set<number>();

export function markPageDirty(page: number): void {
  dirtyPages.add(page);
}

export function getDirtyPages(): Set<number> {
  return new Set(dirtyPages);
}

export function clearDirtyPages(): void {
  dirtyPages.clear();
}

export interface SavedSession {
  pdfBytes: ArrayBuffer;
  pdfFileName: string;
  annotations: Record<number, string>; // pageNum → Fabric JSON (legacy, zoom=1.0)
  /** Per-page annotation zoom levels. If present, annotations[page] is raw at annotationZooms[page]. */
  annotationZooms?: Record<number, number>;
  currentPage: number;
  zoom: number;
  savedAt: number; // Date.now()
  /** PDF fingerprint (byte length + first/last 16 bytes) to detect unchanged PDFs */
  pdfBytesHash?: string;
}

let persistentDB: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (persistentDB) {
      resolve(persistentDB);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      persistentDB = request.result;
      persistentDB.onclose = () => { persistentDB = null; };
      resolve(persistentDB);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Validate annotation JSON before passing to Fabric.js loadFromJSON.
 * Checks for valid structure and rejects suspicious properties.
 */
export function validateAnnotationJson(json: string): boolean {
  if (!json) return true; // Empty is valid (no annotations)

  try {
    // Strip dangerous keys during parsing to prevent prototype pollution
    const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
    const parsed = JSON.parse(json, (key, value) => {
      if (DANGEROUS_KEYS.includes(key)) return undefined;
      return value;
    });

    // Must have objects array
    if (!parsed || typeof parsed !== 'object') return false;
    if (!Array.isArray(parsed.objects)) return false;

    // Each object must have a type string (Fabric.js requirement)
    for (const obj of parsed.objects) {
      if (!obj || typeof obj !== 'object') return false;
      if (typeof obj.type !== 'string') return false;

      // Reject prototype pollution vectors (hasOwnProperty — not `in` which checks prototype chain)
      // This is defense-in-depth after reviver stripping
      const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
      if (DANGEROUS_KEYS.some(key => Object.prototype.hasOwnProperty.call(obj, key))) return false;

      // Also check nested objects recursively
      const checkNested = (val: unknown): boolean => {
        if (!val || typeof val !== 'object') return true;
        if (Array.isArray(val)) return val.every(checkNested);
        if (DANGEROUS_KEYS.some(key => Object.prototype.hasOwnProperty.call(val, key))) return false;
        return Object.values(val as Record<string, unknown>).every(checkNested);
      };
      if (!Object.values(obj).every(checkNested)) return false;

      // Reject suspicious properties that could be XSS vectors
      if (obj.src && typeof obj.src === 'string' && obj.src.toLowerCase().includes('javascript:')) {
        return false;
      }
    }

    return true;
  } catch {
    return false; // Invalid JSON
  }
}

/** Validate a session loaded from IndexedDB to guard against corrupted/malicious data */
function validateSession(data: unknown): data is SavedSession {
  if (!data || typeof data !== 'object') return false;
  const s = data as Record<string, unknown>;
  if (!(s.pdfBytes instanceof ArrayBuffer)) return false;
  if (typeof s.pdfFileName !== 'string') return false;
  if (typeof s.annotations !== 'object' || s.annotations === null) return false;
  if (typeof s.currentPage !== 'number' || s.currentPage < 1) return false;
  if (typeof s.zoom !== 'number' || s.zoom <= 0) return false;
  if (typeof s.savedAt !== 'number') return false;

  // Validate each annotation JSON structure
  const annotations = s.annotations as Record<number, unknown>;
  for (const json of Object.values(annotations)) {
    if (typeof json !== 'string') return false;
    if (!validateAnnotationJson(json)) return false;
  }

  return true;
}

/**
 * Cache for PDF hash computation to avoid re-hashing on every auto-save.
 * Keyed by ArrayBuffer reference for O(1) lookup.
 */
let cachedPdfHash: { buffer: ArrayBuffer; hash: string } | null = null;

/**
 * Compute a fast fingerprint of PDF bytes to detect changes.
 * Uses byte length + first/last 16 bytes for efficiency.
 * Caches result based on ArrayBuffer reference to prevent re-hashing on every auto-save.
 */
function computePdfHash(pdfBytes: ArrayBuffer): string {
  // Return cached hash if same buffer reference
  if (cachedPdfHash && cachedPdfHash.buffer === pdfBytes) {
    return cachedPdfHash.hash;
  }

  const len = pdfBytes.byteLength;
  const view = new Uint8Array(pdfBytes);
  const head = Array.from(view.slice(0, Math.min(16, len)));
  const tail = Array.from(view.slice(Math.max(0, len - 16)));
  const hash = `${len}-${head.join(',')}-${tail.join(',')}`;

  cachedPdfHash = { buffer: pdfBytes, hash };
  return hash;
}

export async function saveSession(session: SavedSession): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Check if we can skip re-storing PDF bytes
    const getCurrentRequest = store.get(SESSION_KEY);
    getCurrentRequest.onsuccess = () => {
      const currentSession = getCurrentRequest.result as SavedSession | undefined;
      const newHash = computePdfHash(session.pdfBytes);

      let sessionToStore = session;

      // If PDF hasn't changed, reuse existing PDF bytes and update only metadata
      if (currentSession && currentSession.pdfBytesHash === newHash) {
        sessionToStore = {
          ...session,
          pdfBytes: currentSession.pdfBytes, // Reuse existing bytes
          pdfBytesHash: newHash,
        };
      } else {
        // PDF changed or new session — compute and store hash
        sessionToStore = {
          ...session,
          pdfBytesHash: newHash,
        };
      }

      store.put(sessionToStore, SESSION_KEY);

      // Backup stores only metadata without PDF bytes to save space
      const backupKey = `session-backup-${session.savedAt}`;
      const backupData = {
        ...sessionToStore,
        pdfBytes: new ArrayBuffer(0), // Placeholder — restore falls back to main session
        pdfBytesHash: sessionToStore.pdfBytesHash,
      };
      store.put(backupData, backupKey);

      const cursorRequest = store.openCursor();
      const backupKeys: string[] = [];
      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const key = cursor.key as string;
          if (typeof key === 'string' && key.startsWith('session-backup-')) {
            backupKeys.push(key);
          }
          cursor.continue();
        } else {
          backupKeys.sort().reverse();
          for (let i = MAX_STORED_SESSIONS; i < backupKeys.length; i++) {
            const key = backupKeys[i];
            if (key) store.delete(key);
          }
        }
      };
    };

    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error); };
  });
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);
      request.onsuccess = () => {
        const data = request.result;
        if (!data) { resolve(null); return; }
        if (!validateSession(data)) {
          console.warn('[Redline] Invalid session data in IndexedDB — ignoring');
          resolve(null);
          return;
        }
        resolve(data);
      };
      request.onerror = () => { reject(request.error); };
    });
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SESSION_KEY);
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error); };
    });
  } catch {
    // Silently fail — clearing is best-effort
  }
}

export async function listSessionBackups(): Promise<{ key: string; savedAt: number }[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const cursorRequest = store.openCursor();
      const backups: { key: string; savedAt: number }[] = [];

      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const key = cursor.key as string;
          if (typeof key === 'string' && key.startsWith('session-backup-')) {
            const timestampStr = key.replace('session-backup-', '');
            const savedAt = parseInt(timestampStr, 10);
            if (!isNaN(savedAt)) {
              backups.push({ key, savedAt });
            }
          }
          cursor.continue();
        } else {
          backups.sort((a, b) => b.savedAt - a.savedAt);
          resolve(backups);
        }
      };

      cursorRequest.onerror = () => { reject(cursorRequest.error); };
    });
  } catch {
    return [];
  }
}

export async function restoreSessionBackup(key: string): Promise<SavedSession | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const data = request.result;
        if (!data) { resolve(null); return; }
        if (!validateSession(data)) {
          console.warn('[Redline] Invalid session backup data in IndexedDB — ignoring');
          resolve(null);
          return;
        }

        // If backup has empty pdfBytes (lightweight backup), restore from main session
        const session = data as SavedSession;
        if (session.pdfBytes.byteLength === 0) {
          const mainRequest = store.get(SESSION_KEY);
          mainRequest.onsuccess = () => {
            const mainSession = mainRequest.result as SavedSession | undefined;
            if (mainSession && mainSession.pdfBytes.byteLength > 0) {
              // Merge main session's PDF bytes with backup's metadata
              resolve({
                ...session,
                pdfBytes: mainSession.pdfBytes,
              });
            } else {
              // No main session PDF available
              resolve(null);
            }
          };
          mainRequest.onerror = () => { resolve(null); };
        } else {
          resolve(session);
        }
      };
      request.onerror = () => { reject(request.error); };
    });
  } catch {
    return null;
  }
}

/**
 * Debounced save — collapses rapid changes into a single write.
 * Returns a function you call on every change; it will only
 * actually write to IndexedDB after `delayMs` of inactivity.
 */
export function createDebouncedSaver(delayMs = 1000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SavedSession | null = null;

  const flush = async () => {
    if (pending) {
      await saveSession(pending);
      pending = null;
    }
  };

  const save = (session: SavedSession) => {
    pending = session;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return { save, flush, cancel };
}
