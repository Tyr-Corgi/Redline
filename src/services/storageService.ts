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

export interface SavedSession {
  pdfBytes: ArrayBuffer;
  pdfFileName: string;
  annotations: Record<number, string>; // pageNum → Fabric JSON (legacy, zoom=1.0)
  /** Per-page annotation zoom levels. If present, annotations[page] is raw at annotationZooms[page]. */
  annotationZooms?: Record<number, number>;
  currentPage: number;
  zoom: number;
  savedAt: number; // Date.now()
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
  return true;
}

export async function saveSession(session: SavedSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(session, SESSION_KEY);

    const backupKey = `session-backup-${session.savedAt}`;
    store.put(session, backupKey);

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
          store.delete(backupKeys[i]);
        }
      }
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);
      request.onsuccess = () => {
        db.close();
        const data = request.result;
        if (!data) { resolve(null); return; }
        if (!validateSession(data)) {
          console.warn('Invalid session data in IndexedDB — ignoring');
          resolve(null);
          return;
        }
        resolve(data);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Silently fail — clearing is best-effort
  }
}

export async function listSessionBackups(): Promise<{ key: string; savedAt: number }[]> {
  try {
    const db = await openDB();
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
          db.close();
          resolve(backups);
        }
      };

      cursorRequest.onerror = () => { db.close(); reject(cursorRequest.error); };
    });
  } catch {
    return [];
  }
}

export async function restoreSessionBackup(key: string): Promise<SavedSession | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        db.close();
        const data = request.result;
        if (!data) { resolve(null); return; }
        if (!validateSession(data)) {
          console.warn('Invalid session backup data in IndexedDB — ignoring');
          resolve(null);
          return;
        }
        resolve(data);
      };
      request.onerror = () => { db.close(); reject(request.error); };
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
