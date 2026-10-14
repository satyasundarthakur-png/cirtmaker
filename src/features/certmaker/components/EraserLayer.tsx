import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Box } from "../lib/clone-geometry";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  onErase: (box: Box) => void;
  onDone: () => void;
}

/** Drag a rectangle over the certificate to erase it. Esc ends the tool. */
export default function EraserLayer({ clone, onErase, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Box | null>(null);

  // One listener for the tool's whole life. Re-subscribing on every render would drop the key press that also
  // re-renders the app (Esc clears the selection), because a listener removed mid-event is skipped.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const point = (e: PointerEvent<HTMLElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
    return {
      x: clamp(((e.clientX - r.left) / r.width) * clone.width, clone.width),
      y: clamp(((e.clientY - r.top) / r.height) * clone.height, clone.height),
    };
  };
  const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Eraser: drag over the part of the certificate to erase"
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      style={{ pointerEvents: "auto" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setRect(null);
      }}
      onPointerMove={(e) => {
        if (start.current) setRect(boxOf(start.current, point(e)));
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const from = start.current;
        start.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        setRect(null);
        if (!from) return;
        const box = boxOf(from, point(e));
        if (box.w >= 4 && box.h >= 4) onErase(box);
      }}
      onPointerCancel={() => {
        start.current = null;
        setRect(null);
      }}
    >
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none absolute border-2 border-dashed border-red-500 bg-red-500/15"
          style={{
            left: `${(rect.x / clone.width) * 100}%`,
            top: `${(rect.y / clone.height) * 100}%`,
            width: `${(rect.w / clone.width) * 100}%`,
            height: `${(rect.h / clone.height) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
