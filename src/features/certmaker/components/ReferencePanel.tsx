import { Button } from "@/components/ui/button";
import { useRef, useState, type DragEvent } from "react";
import type { CertData } from "@/features/certmaker/lib/types";
import { analyseReference, type RefResult } from "@/features/certmaker/lib/reference";
import { loadClone } from "../lib/clone";

interface Props {
  data: CertData;
  setData: (fn: (p: CertData) => CertData) => void;
}

export default function ReferencePanel({ data, setData }: Props) {
  const [ref, setRef] = useState<RefResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handle(file?: File | null) {
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      if (data.cloneMode) {
        const clone = await loadClone(file);
        setRef(null);
        setData((p) => ({ ...p, clone, cloneMode: true }));
        return;
      }
      const r = await analyseReference(file);
      setRef(r);
      setData((p) => ({
        ...p,
        template: "inspired",
        custom: r.style,
        accent: r.style.accent,
        paper: r.paper,
        fontSet: r.fontSet,
        refBg: r.bg,
        bgMode: "recreate",
        clearInset: r.clearInset,
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files?.[0]);
  }

  function applyText() {
    if (!ref) return;
    const t = ref.text;
    setData((p) => ({ ...p, title: t.title ?? p.title, org: t.org ?? p.org, body: t.body ?? p.body, date: t.date ?? p.date }));
  }

  function clear() {
    setRef(null);
    setErr("");
    setData((p) => ({ ...p, template: "classic", accent: "#b8892f", custom: null, refBg: "", bgMode: "recreate" }));
  }

  const hasText = !!(ref && (ref.text.title || ref.text.org || ref.text.body || ref.text.date));
  const active = data.template === "inspired" && !!data.custom;

  return (
    <div className="grid gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition ${over ? "border-brand bg-brand/5" : "border-line"}`}
      >
        <p className="text-sm">{data.cloneMode ? "Original certificate" : "Drop a certificate you like here"}</p>
        <p className="mt-1 text-xs text-muted">{data.cloneMode ? "PDF, PNG or JPG · locked background" : "PDF, DOCX, PNG or JPG · it is read in your browser and never uploaded"}</p>
        <Button variant="certificate" size="certificate" type="button" className="btn mt-3" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Reading…" : "Choose file"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={data.cloneMode ? ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" : ".pdf,.docx,.png,.jpg,.jpeg,.webp,application/pdf,image/*"}
          className="sr-only"
          aria-label="Upload a reference certificate"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      {data.cloneMode && data.clone && <p className="break-words text-xs text-muted">{data.clone.filename} · {data.clone.fields.length} text fields</p>}
      {!data.cloneMode && ref && active && (
        <div className="grid gap-4 rounded-xl border border-line bg-paper p-4">
          <div className="flex gap-4">
            {ref.thumb && <img src={ref.thumb} alt="Your reference certificate" className="h-24 w-auto rounded border border-line bg-card" />}
            <div className="min-w-0">
              <p className="label !mb-1">What was picked up</p>
              <ul className="grid gap-0.5 text-xs">
                {ref.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            </div>
          </div>

          <div role="radiogroup" aria-label="How to use the reference" className="grid gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="bgmode" className="mt-1 accent-brand" checked={data.bgMode === "recreate"} onChange={() => setData((p) => ({ ...p, bgMode: "recreate" }))} />
              <span><b>Recreate the style</b><span className="block text-xs text-muted">Same colours, frame and feel, redrawn as an editable template.</span></span>
            </label>
            {ref.bg && (
              <label className="flex items-start gap-2">
                <input type="radio" name="bgmode" className="mt-1 accent-brand" checked={data.bgMode === "image"} onChange={() => setData((p) => ({ ...p, bgMode: "image" }))} />
                <span><b>Use it as the background</b><span className="block text-xs text-muted">Keeps the original frame and corner artwork and clears the inside for your text.</span></span>
              </label>
            )}
          </div>

          {data.bgMode === "image" && (
            <div>
              <label htmlFor="clear" className="label">Corner artwork kept: {Math.round(data.clearInset)}</label>
              <input id="clear" type="range" min={0} max={200} step={2} value={data.clearInset} onChange={(e) => setData((p) => ({ ...p, clearInset: +e.target.value }))} className="w-full accent-brand" />
            </div>
          )}

          {hasText && (
            <div className="rounded-lg border border-line bg-card p-3 text-xs">
              <p className="label !mb-1">Wording found in the file</p>
              <dl className="grid gap-0.5">
                {ref.text.title && <div><dt className="inline font-semibold">Title: </dt><dd className="inline">{ref.text.title}</dd></div>}
                {ref.text.org && <div><dt className="inline font-semibold">Organisation: </dt><dd className="inline">{ref.text.org}</dd></div>}
                {ref.text.body && <div><dt className="inline font-semibold">Description: </dt><dd className="inline">{ref.text.body}</dd></div>}
                {ref.text.date && <div><dt className="inline font-semibold">Date: </dt><dd className="inline">{ref.text.date}</dd></div>}
              </dl>
              <Button variant="certificate" size="certificate" type="button" className="btn mt-3" onClick={applyText}>Use this wording</Button>
            </div>
          )}
          <Button variant="certificate" size="certificate" type="button" className="justify-self-start text-xs text-brand underline" onClick={clear}>Remove reference and go back to the built-in templates</Button>
        </div>
      )}
    </div>
  );
}
