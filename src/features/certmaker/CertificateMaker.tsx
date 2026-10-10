import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Preview from "@/features/certmaker/components/Preview";
import TemplatePicker from "@/features/certmaker/components/TemplatePicker";
import ReferencePanel from "@/features/certmaker/components/ReferencePanel";
import EffectsPanel from "@/features/certmaker/components/EffectsPanel";
import { DEFAULT_DATA, type CertData, type FontSet } from "@/features/certmaker/lib/types";
import { FONT_SETS } from "@/features/certmaker/lib/themes";
import { batchExport, download, fileSafe, pdfBlob, pngBlob, type BatchFormat } from "@/features/certmaker/lib/exporter";

const KEY = "certmaker:v1";
const MAX_BATCH = 300;

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-display text-lg">
        {title}
        <span aria-hidden className="text-muted transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="grid gap-4 px-5 pb-5">{children}</div>
    </details>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
    </div>
  );
}

export default function CertificateMaker() {
  const [d, setD] = useState<CertData>(DEFAULT_DATA);
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = { ...DEFAULT_DATA, ...JSON.parse(raw) } as CertData;
        if (saved.template === "inspired" && !saved.custom) saved.template = "classic";
        setD({ ...saved, fx: saved.fx ?? {}, colors: saved.colors ?? {}, refBg: "", bgMode: "recreate" });
      }
    } catch { /* storage unavailable */ }
    setStorageReady(true);
  }, []);
  const [names, setNames] = useState("Asha Mohanty\nRavi Kumar\nPriya Nair");
  const [fmt, setFmt] = useState<BatchFormat>("pdf-zip");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!storageReady) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...d, refBg: "", logo: d.logo.length < 400_000 ? d.logo : "" }));
      } catch {
        /* ignore quota / private mode */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [d, storageReady]);

  const set = <K extends keyof CertData>(k: K, v: CertData[K]) => setD((p) => ({ ...p, [k]: v }));
  const setSig = (i: number, k: "name" | "role", v: string) =>
    setD((p) => ({ ...p, sigs: p.sigs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  const list = useMemo(() => names.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), [names]);
  const slug = fileSafe(d.recipient) || "certificate";

  async function run(label: string, fn: () => Promise<void>) {
    setErr("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function onLogo(file?: File) {
    if (!file) return;
    if (file.size > 3_000_000) return setErr("Logo is over 3 MB — please use a smaller image.");
    const r = new FileReader();
    r.onload = () => set("logo", String(r.result));
    r.readAsDataURL(file);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden>
            <rect width="100" height="100" rx="20" fill="var(--certificate-icon-ink)" />
            <rect x="16" y="24" width="68" height="46" rx="3" fill="var(--certificate-icon-paper)" stroke="var(--certificate-icon-gold)" strokeWidth="4" />
            <path d="M30 42h40M36 52h28" stroke="var(--certificate-icon-ink)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="50" cy="74" r="10" fill="var(--certificate-icon-gold)" />
          </svg>
          <div>
            <h1 className="font-display text-xl leading-none">Certificate Maker</h1>
            <p className="mt-1 text-xs text-muted">Design, personalise in bulk, download as PDF</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[430px_1fr]">
        <div className="order-2 grid content-start gap-4 lg:order-1">
          <Section title="Inspired by your own certificate" open={false}>
            <ReferencePanel data={d} setData={setD} />
          </Section>

          <Section title="Design">
            <TemplatePicker data={d} onPick={(id, accent) => setD((p) => ({ ...p, template: id, accent: id === "inspired" && p.custom ? p.custom.accent : accent, bgMode: id === "inspired" ? p.bgMode : "recreate" }))} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Accent colour" id="accent">
                <input id="accent" type="color" value={d.accent} onChange={(e) => set("accent", e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-card p-1" />
              </Field>
              <Field label="Paper" id="paper">
                <select id="paper" className="field" value={d.paper} onChange={(e) => set("paper", e.target.value as CertData["paper"])}>
                  <option value="a4">A4 landscape</option>
                  <option value="letter">US Letter landscape</option>
                </select>
              </Field>
            </div>
            <Field label="Typography" id="fonts">
              <select id="fonts" className="field" value={d.fontSet} onChange={(e) => set("fontSet", e.target.value as FontSet)}>
                {(Object.keys(FONT_SETS) as FontSet[]).map((k) => (
                  <option key={k} value={k}>{FONT_SETS[k].label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted">Odia and Devanagari text works in every set; choose Noto if the whole certificate is in Odia or Hindi.</p>
            </Field>
          </Section>

          <Section title="Content">
            <Field label="Organisation" id="org"><input id="org" className="field" value={d.org} onChange={(e) => set("org", e.target.value)} /></Field>
            <Field label="Title" id="title"><input id="title" className="field" value={d.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <Field label="Line above the name" id="sub"><input id="sub" className="field" value={d.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></Field>
            <Field label="Recipient name" id="rec"><input id="rec" className="field" value={d.recipient} onChange={(e) => set("recipient", e.target.value)} /></Field>
            <Field label="Description (up to 4 lines)" id="body"><textarea id="body" rows={4} className="field" value={d.body} onChange={(e) => set("body", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" id="date"><input id="date" className="field" value={d.date} onChange={(e) => set("date", e.target.value)} /></Field>
              <Field label="Certificate ID" id="cid"><input id="cid" className="field" value={d.certId} onChange={(e) => set("certId", e.target.value)} /></Field>
            </div>
          </Section>

          <Section title="Text colours & effects">
            <EffectsPanel data={d} setData={setD} selected={sel} setSelected={setSel} />
          </Section>

          <Section title="Signatures, logo & seal" open={false}>
            {d.sigs.map((s, i) => (
              <div key={i} className="grid grid-cols-2 gap-4">
                <Field label={`Signatory ${i + 1} name`} id={`sn${i}`}><input id={`sn${i}`} className="field" value={s.name} onChange={(e) => setSig(i, "name", e.target.value)} /></Field>
                <Field label="Role" id={`sr${i}`}><input id={`sr${i}`} className="field" value={s.role} onChange={(e) => setSig(i, "role", e.target.value)} /></Field>
              </div>
            ))}
            <Field label="Logo (PNG / JPG / SVG, shown at the top)" id="logo">
              <input id="logo" type="file" accept="image/*" className="field" onChange={(e) => onLogo(e.target.files?.[0])} />
              {d.logo && <Button variant="certificate" size="certificate" type="button" className="mt-2 text-xs text-brand underline" onClick={() => set("logo", "")}>Remove logo</Button>}
            </Field>
            <div className="grid grid-cols-2 items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.showSeal} onChange={(e) => set("showSeal", e.target.checked)} className="accent-brand" /> Show seal</label>
              <Field label="Seal text (optional, ≤ 8 chars)" id="seal"><input id="seal" maxLength={8} className="field" value={d.sealText} onChange={(e) => set("sealText", e.target.value)} placeholder="★ if empty" /></Field>
            </div>
          </Section>

          <Section title="Bulk: one certificate per name" open={false}>
            <Field label={`Names, one per line (${list.length}${list.length > MAX_BATCH ? ` — max ${MAX_BATCH}` : ""})`} id="names">
              <textarea id="names" rows={6} className="field font-mono" value={names} onChange={(e) => setNames(e.target.value)} />
            </Field>
            <Field label="Output" id="fmt">
              <select id="fmt" className="field" value={fmt} onChange={(e) => setFmt(e.target.value as BatchFormat)}>
                <option value="pdf-zip">Separate PDFs (.zip)</option>
                <option value="png-zip">Separate PNG images (.zip)</option>
                <option value="pdf-one">One combined PDF</option>
              </select>
              <p className="mt-1.5 text-xs text-muted">Certificate IDs count up automatically from the ID above (CERT-2026-001, -002, …).</p>
            </Field>
            <Button variant="certificate" size="certificate"
              type="button"
              className="btn btn-primary"
              disabled={!!busy || list.length === 0 || list.length > MAX_BATCH}
              onClick={() =>
                run("batch", async () => {
                  const r = await batchExport(list, d, fmt, (a, b) => setProgress([a, b]));
                  download(r.blob, r.filename);
                })
              }
            >
              {busy === "batch" && progress ? `Generating ${progress[0]} / ${progress[1]}…` : `Generate ${list.length} certificate${list.length === 1 ? "" : "s"}`}
            </Button>
          </Section>
        </div>

        <div className="order-1 grid content-start gap-4 lg:sticky lg:top-4 lg:order-2 lg:self-start">
          <Preview data={d} selected={sel} onSelect={setSel} />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="certificate" size="certificate" type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run("pdf", async () => download(await pdfBlob(d), `${slug}.pdf`))}>
              {busy === "pdf" ? "Preparing…" : "Download PDF"}
            </Button>
            <Button variant="certificate" size="certificate" type="button" className="btn" disabled={!!busy} onClick={() => run("png", async () => download(await pngBlob(d), `${slug}.png`))}>
              {busy === "png" ? "Preparing…" : "Download PNG"}
            </Button>
            <Button variant="certificate" size="certificate" type="button" className="btn" onClick={() => { if (confirm("Reset everything to the defaults?")) setD(DEFAULT_DATA); }}>Reset</Button>
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <p className="text-xs text-muted">Everything happens in your browser — names and logos are never uploaded. Your last design is remembered on this device.</p>
        </div>
      </main>
    </div>
  );
}
