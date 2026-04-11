import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock IndexedDB
const mockDB = {
  transaction: vi.fn(() => ({
    objectStore: vi.fn(() => ({
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      openCursor: vi.fn(),
    })),
  })),
};

// Mock for indexedDB.open
const mockOpenRequest = {
  result: mockDB,
  onsuccess: null as ((ev: Event) => void) | null,
  onerror: null as ((ev: Event) => void) | null,
  onupgradeneeded: null as ((ev: Event) => void) | null,
};

Object.defineProperty(globalThis, 'indexedDB', {
  value: {
    open: vi.fn(() => mockOpenRequest),
  },
});
