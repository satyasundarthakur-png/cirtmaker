import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { CertData } from "@/features/certmaker/lib/types";
import { certHeight, renderToCanvas, type Region } from "@/features/certmaker/lib/render";

interface Props {
  data: CertData;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** 1 = fit to the available width. */
  zoom?: number;
}

export default function Preview({ data, selected, onSelect, zoom = 1 }: Props) {
  const renderW = Math.min(3000, Math.round(1400 * Math.max(1, zoom)));
  const ref = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(true);
  const [regions, setRegions] = useState<Region[]>([]);
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    setBusy(true);
    const t = setTimeout(async () => {
      if (!ref.current) return;
      // draw on an offscreen canvas first so a stale render never flashes on screen
      const off = document.createElement("canvas");
      const regs = await renderToCanvas(off, data, renderW);
      if (my !== token.current || !ref.current) return;
      ref.current.width = off.width;
      ref.current.height = off.height;
      const context = ref.current.getContext("2d");
      if (!context) return;
      context.drawImage(off, 0, 0);
      setRegions(regs);
      setBusy(false);
    }, 60);
    return () => clearTimeout(t);
  }, [data, renderW]);

  const H = certHeight(data);

  function click(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 1000;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hit = regions
      .filter((g) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    onSelect(hit ? hit.id : null);
  }

  const sel = regions.find((g) => g.id === selected);

  return (
    <div className="relative mx-auto cursor-pointer overflow-hidden rounded-sm border border-line bg-card shadow-[0_10px_40px_-12px_rgba(15,23,42,0.35)]" style={{ width: `${zoom * 100}%` }} onClick={click}>
      <canvas ref={ref} className="block h-auto w-full" role="img" aria-label={`Certificate preview for ${data.recipient}. Click a part of the certificate to edit its text.`} />
      {sel && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded border-2 border-dashed border-brand"
          style={{ left: `${(sel.x / 1000) * 100}%`, top: `${(sel.y / H) * 100}%`, width: `${(sel.w / 1000) * 100}%`, height: `${(sel.h / H) * 100}%` }}
        >
          <span className="absolute -top-5 left-0 rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{sel.label}</span>
        </div>
      )}
      {busy && <div className="absolute inset-0 grid place-items-center bg-card/50 text-sm text-muted" role="status">Rendering…</div>}
    </div>
  );
}
