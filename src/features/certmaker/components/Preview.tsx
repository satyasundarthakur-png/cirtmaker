import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { CertData, CloneSource, CloneTextField } from "@/features/certmaker/lib/types";
import CloneOverlay from "./CloneOverlay";
import { certHeight, renderToCanvas, type Region } from "@/features/certmaker/lib/render";

/** Clone Mode editing hooks: boxes on top of the locked original, plus the colour picker. */
export interface CloneEdit {
  /** The template being edited. May differ in text from the preview when a CSV row is being previewed. */
  clone: CloneSource;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<CloneTextField>) => void;
  onRemove: (id: string) => void;
  /** When set, the next click on the certificate reports the original-image pixel clicked. */
  onPixel?: ((x: number, y: number) => void) | undefined;
}

interface Props {
  data: CertData;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** 1 = fit to the available width. */
  zoom?: number;
  /** The template (not the CSV-filled preview) whose boxes the user edits. Clone Mode only. */
  cloneEdit?: CloneEdit | undefined;
}

export default function Preview({ data, selected, onSelect, zoom = 1, cloneEdit }: Props) {
  const renderW = Math.min(3000, Math.round(1400 * Math.max(1, zoom)));
  const ref = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    let live = true;
    setBusy(true);
    setError(null);
    const t = setTimeout(async () => {
      if (!ref.current) return;
      // draw on an offscreen canvas first so a stale render never flashes on screen
      try {
        const off = document.createElement("canvas");
        const regs = await renderToCanvas(off, data, renderW);
        if (!live || my !== token.current || !ref.current) return;
        const context = ref.current.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
        ref.current.width = off.width;
        ref.current.height = off.height;
        context.drawImage(off, 0, 0);
        setRegions(regs);
      } catch (e) {
        if (live && my === token.current) {
          setError(e instanceof Error ? e.message : "The certificate preview could not be drawn.");
          setRegions([]);
        }
      } finally {
        if (live && my === token.current) setBusy(false);
      }
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [data, renderW]);

  const H = certHeight(data);

  function click(e: MouseEvent<HTMLDivElement>) {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    if (busy || error) return;
    if (cloneEdit) {
      const c = cloneEdit.clone;
      if (cloneEdit.onPixel) cloneEdit.onPixel(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height);
      else cloneEdit.onSelect(null);
      return;
    }
    const x = ((e.clientX - r.left) / r.width) * 1000;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hit = regions
      .filter((g) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    onSelect(hit ? hit.id : null);
  }

  const sel = regions.find((g) => g.id === selected);

  return (
    <div className={`relative mx-auto ${cloneEdit?.onPixel ? "cursor-crosshair" : "cursor-pointer"} overflow-hidden rounded-sm border border-line bg-card shadow-[0_10px_40px_-12px_rgba(15,23,42,0.35)]`} style={{ width: `${zoom * 100}%` }} onClick={click}>
      <div className="relative" style={{ aspectRatio: `1000 / ${H}` }}>
      <canvas ref={ref} className="block h-full w-full" role="img" aria-label={cloneEdit ? "Original certificate with editable text boxes on top." : `Certificate preview for ${data.recipient}. Click a part of the certificate to edit its text.`} />
      {cloneEdit && !error && (
        <CloneOverlay clone={cloneEdit.clone} selected={cloneEdit.selected} passive={!!cloneEdit.onPixel} onSelect={cloneEdit.onSelect} onChange={cloneEdit.onChange} onRemove={cloneEdit.onRemove} />
      )}
      {sel && !cloneEdit && !busy && !error && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded border-2 border-dashed border-brand"
          style={{ left: `${(sel.x / 1000) * 100}%`, top: `${(sel.y / H) * 100}%`, width: `${(sel.w / 1000) * 100}%`, height: `${(sel.h / H) * 100}%` }}
        >
          <span className="absolute -top-5 left-0 rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{sel.label}</span>
        </div>
      )}
      {busy && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-card/50 text-sm text-muted" role="status">Rendering…</div>}
      {error && <div className="absolute inset-0 grid place-items-center bg-card/90 p-4 text-center text-sm text-destructive" role="alert">{error}</div>}
      </div>
    </div>
  );
}
