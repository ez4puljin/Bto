import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_LIMIT = 60;
/** Edits closer together than this are one step of «Буцаах» (typing a text is one step). */
const STEP_MS = 700;

/**
 * A template editor's work with «Буцаах» / «Дахих» (ADR-0142): each change is a step, except edits
 * made in one breath (typing), which are one. A new `saved` (the answer of a save) starts afresh.
 */
export function useTemplateHistory<W>(saved: W) {
  const [state, setState] = useState({ work: saved, past: [] as W[], future: [] as W[] });
  const last = useRef(0);
  useEffect(() => setState({ work: saved, past: [], future: [] }), [saved]);
  const change = useCallback((update: (current: W) => W) => {
    setState((current) => {
      const next = update(current.work);
      const now = Date.now();
      const merge = now - last.current < STEP_MS && current.past.length > 0;
      last.current = now;
      return {
        work: next,
        past: merge ? current.past : [...current.past, current.work].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);
  const undo = useCallback(() => {
    last.current = 0;
    setState((current) => {
      const previous = current.past.at(-1);
      if (previous === undefined) return current;
      return {
        work: previous,
        past: current.past.slice(0, -1),
        future: [current.work, ...current.future],
      };
    });
  }, []);
  const redo = useCallback(() => {
    last.current = 0;
    setState((current) => {
      const [next, ...rest] = current.future;
      if (next === undefined) return current;
      return { work: next, past: [...current.past, current.work], future: rest };
    });
  }, []);
  return {
    work: state.work,
    change,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/** Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) outside a text field: the browser's own undo stays there. */
export function useUndoKeys(enabled: boolean, undo: () => void, redo: () => void) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, undo, redo]);
}

/** «11-01–11-30»: a free block's dates, if any (the conditions name themselves). */
export function datesSummary(show: { from?: string | null; to?: string | null }): string | null {
  return show.from || show.to ? `${show.from?.slice(5) ?? '…'}–${show.to?.slice(5) ?? '…'}` : null;
}
