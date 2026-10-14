import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { authorizedText } from "../lib/editing/SelectionManager";
import { dragBox, nudgeBox, type Handle } from "../lib/clone-geometry";
import type { CloneSource, CloneTextField } from "../lib/types";
import type { DetectView } from "../lib/clone-debug";
import DetectionLayer from "./DetectionLayer";
import EraserLayer from "./EraserLayer";
import type { Box } from "../lib/clone-geometry";

interface Props {
  clone: CloneSource;
  selected: string | null;
  selectedIds?: string[] | undefined;
  /** While the colour picker is active the boxes must not catch clicks. */
  passive?: boolean;
  onSelect: (id: string | null, additive?: boolean) => void;
  onChange: (id: string, patch: Partial<CloneTextField>) => void;
  onRemove: (id: string) => void;
  detectView?: DetectView | undefined;
  onAssignName?: ((id: string) => void) | undefined;
  eraser?: boolean | undefined;
  onErase?: ((box: Box) => void) | undefined;
  onEraserDone?: (() => void) | undefined;
}

const HANDLES: { h: Exclude<Handle, "move">; cls: string; cursor: string }[] = [
  { h: "nw", cls: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { h: "n", cls: "left-1/2 -top-1.5 -translate-x-1/2", cursor: "ns-resize" },
  { h: "ne", cls: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { h: "e", cls: "-right-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { h: "se", cls: "-bottom-1.5 -right-1.5", cursor: "nwse-resize" },
  { h: "s", cls: "-bottom-1.5 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { h: "sw", cls: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
  { h: "w", cls: "-left-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

interface Drag {
  id: string;
  handle: Handle;
  startX: number;
  startY: number;
  box: { x: number; y: number; w: number; h: number };
  kx: number;
  ky: number;
}

/**
 * Editable boxes laid on top of the locked original. Drag a box to move it, drag a handle to resize it,
 * arrow keys nudge (Shift = 10 px), Enter or double-click types into it, Delete removes it.
 */
export default function CloneOverlay({
  clone,
  selected,
  selectedIds,
  passive,
  onSelect,
  onChange,
  onRemove,
  detectView = "off",
  onAssignName,
  eraser = false,
  onErase,
  onEraserDone,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const cancelled = useRef(false);
  const pointerSelection = useRef(false);
  const bounds = { w: clone.width, h: clone.height };

  function begin(e: PointerEvent<HTMLElement>, f: CloneTextField, handle: Handle) {
    e.stopPropagation();
    pointerSelection.current = true;
    window.setTimeout(() => {
      pointerSelection.current = false;
    }, 0);
    if (!authorizedText(f) || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const rect = root.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height || editing) return;
    drag.current = {
      id: f.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      box: { x: f.x, y: f.y, w: f.w, h: f.h },
      kx: clone.width / rect.width,
      ky: clone.height / rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!selectedIds?.includes(f.id)) onSelect(f.id);
  }

  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    onChange(
      d.id,
      dragBox(
        d.box,
        d.handle,
        (e.clientX - d.startX) * d.kx,
        (e.clientY - d.startY) * d.ky,
        bounds,
      ),
    );
  }

  function end(e: PointerEvent<HTMLElement>) {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function key(e: KeyboardEvent<HTMLElement>, f: CloneTextField) {
    if (editing) return;
    if (!authorizedText(f)) {
      if (e.key === "Enter") onSelect(f.id);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = arrows[e.key];
    if (delta) {
      e.preventDefault();
      onChange(f.id, nudgeBox(f, delta[0], delta[1], bounds));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setEditing(f.id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(f.id);
    } else if (e.key === "Escape") {
      onSelect(null);
    }
  }

  return (
    <div
      ref={root}
      className="absolute inset-0"
      style={{ pointerEvents: passive ? "none" : undefined }}
    >
      {clone.fields
        .filter((f) => !f.deleted)
        .map((f) => {
          const on = selectedIds?.includes(f.id) ?? selected === f.id;
          return (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              aria-label={`${f.label}: ${f.replacement || "empty"}. Drag to move, arrow keys to nudge, Enter to edit text.`}
              aria-pressed={on}
              className={`absolute cursor-move touch-none rounded-[2px] outline-none ${on ? "z-10 border-2 border-brand bg-brand/10" : "border border-dashed border-brand/60 hover:bg-brand/10"} focus-visible:ring-2 focus-visible:ring-brand`}
              style={{
                left: `${(f.x / clone.width) * 100}%`,
                top: `${(f.y / clone.height) * 100}%`,
                width: `${(f.w / clone.width) * 100}%`,
                height: `${(f.h / clone.height) * 100}%`,
                transform: `rotate(${f.rotation ?? 0}deg)`,
                ...(detectView === "pickName" || eraser ? { pointerEvents: "none" as const } : {}),
              }}
              onPointerDown={(e) => begin(e, f, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(f.id, e.shiftKey || e.ctrlKey || e.metaKey);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (authorizedText(f)) setEditing(f.id);
              }}
              onFocus={() => {
                if (!pointerSelection.current) onSelect(f.id);
              }}
              onKeyDown={(e) => key(e, f)}
            >
              {on && authorizedText(f) && (
                <>
                  <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {f.label}
                  </span>
                  {(f.rotation ? [] : HANDLES).map(({ h, cls, cursor }) => (
                    <span
                      key={h}
                      aria-hidden
                      data-handle={h}
                      className={`absolute size-3 touch-none rounded-full border-2 border-brand bg-card ${cls}`}
                      style={{ cursor }}
                      onPointerDown={(e) => begin(e, f, h)}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                    />
                  ))}
                </>
              )}
              {editing === f.id && (
                <input
                  autoFocus
                  aria-label={`Text for ${f.label}`}
                  defaultValue={f.replacement}
                  className="absolute inset-0 w-full min-w-24 rounded-[2px] border-2 border-brand bg-card px-1 text-sm text-foreground outline-none"
                  style={{ textAlign: f.align }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelled.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={(e) => {
                    if (cancelled.current) {
                      cancelled.current = false;
                      setEditing(null);
                      return;
                    }
                    onChange(f.id, { replacement: e.currentTarget.value });
                    setEditing(null);
                  }}
                />
              )}
            </div>
          );
        })}
      {eraser && onErase && (
        <EraserLayer clone={clone} onErase={onErase} onDone={onEraserDone ?? (() => undefined)} />
      )}
      {detectView !== "off" && (
        <DetectionLayer clone={clone} view={detectView} onAssignName={onAssignName} />
      )}
    </div>
  );
}
