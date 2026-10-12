import { useCallback, useRef, useState, type SetStateAction } from "react";
import { EditHistoryManager } from "./editing/EditHistoryManager";
export function useHistory<T>(initial: T) {
  const manager = useRef(new EditHistoryManager(initial));
  const [present, setPresent] = useState(initial);
  const [, refresh] = useState(0);
  const publish = useCallback((value: T) => {
    setPresent(value);
    refresh((n) => n + 1);
  }, []);
  const set = useCallback(
    (action: SetStateAction<T>) => {
      const previous = manager.current.present;
      const next = typeof action === "function" ? (action as (p: T) => T)(previous) : action;
      publish(manager.current.commit(next));
    },
    [publish],
  );
  const undo = useCallback(() => publish(manager.current.undo()), [publish]);
  const redo = useCallback(() => publish(manager.current.redo()), [publish]);
  const reset = useCallback(
    (value: T) => {
      manager.current.reset(value);
      publish(value);
    },
    [publish],
  );
  const rollback = useCallback(
    (position: number) => publish(manager.current.rollback(position)),
    [publish],
  );
  return {
    present,
    set,
    reset,
    undo,
    redo,
    rollback,
    position: manager.current.position,
    length: manager.current.length,
    canUndo: manager.current.canUndo,
    canRedo: manager.current.canRedo,
  };
}
