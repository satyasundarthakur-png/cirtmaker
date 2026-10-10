import { useCallback, useRef, useState, type SetStateAction } from "react";

const LIMIT = 100;
const COALESCE_MS = 700;

/**
 * State with undo/redo. Rapid consecutive edits (typing, dragging a colour picker)
 * are merged into one history step so Undo feels natural.
 */
export function useHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastPush = useRef(0);
  const live = useRef<T>(initial);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const set = useCallback((action: SetStateAction<T>) => {
    const prev = live.current;
    const next = typeof action === "function" ? (action as (p: T) => T)(prev) : action;
    if (Object.is(next, prev)) return;
    const now = Date.now();
    if (now - lastPush.current > COALESCE_MS || past.current.length === 0) {
      past.current.push(prev);
      if (past.current.length > LIMIT) past.current.shift();
    }
    lastPush.current = now;
    future.current = [];
    live.current = next;
    setPresent(next);
    refresh();
  }, []);

  /** Replace state without recording history (used when restoring saved work). */
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    live.current = value;
    setPresent(value);
    refresh();
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(live.current);
    live.current = prev;
    lastPush.current = 0;
    setPresent(prev);
    refresh();
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(live.current);
    live.current = next;
    lastPush.current = 0;
    setPresent(next);
    refresh();
  }, []);

  return { present, set, reset, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
