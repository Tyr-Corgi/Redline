/**
 * useHistory — extracted undo/redo history management.
 * Encapsulates the PUSH_HISTORY, UNDO, REDO reducer logic
 * with a capped 50-entry ring buffer.
 */
import { useReducer, useCallback } from 'react';
import type { HistoryEntry } from '../types';

interface HistoryState {
  history: HistoryEntry[];
  historyIndex: number;
}

type HistoryAction =
  | { type: 'PUSH'; payload: { page: number; snapshot: string } }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' };

const MAX_HISTORY = 50;

const initialState: HistoryState = {
  history: [],
  historyIndex: -1,
};

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'PUSH': {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push({
        type: 'modify',
        page: action.payload.page,
        snapshot: action.payload.snapshot,
      });
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    }

    case 'UNDO':
      if (state.historyIndex <= 0) return state;
      return { ...state, historyIndex: state.historyIndex - 1 };

    case 'REDO':
      if (state.historyIndex >= state.history.length - 1) return state;
      return { ...state, historyIndex: state.historyIndex + 1 };

    case 'CLEAR':
      return initialState;

    default:
      return state;
  }
}

export function useHistory() {
  const [state, dispatch] = useReducer(historyReducer, initialState);

  const pushHistory = useCallback((page: number, snapshot: string) => {
    dispatch({ type: 'PUSH', payload: { page, snapshot } });
  }, []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const clearHistory = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  return {
    history: state.history,
    historyIndex: state.historyIndex,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.history.length - 1,
    pushHistory,
    undo,
    redo,
    clearHistory,
  };
}
