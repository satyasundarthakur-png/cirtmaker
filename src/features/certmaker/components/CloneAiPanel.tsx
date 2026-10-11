import { useRef, useState } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fitFieldsToInk } from "../lib/clone-erase-canvas";
import { AiError, DEFAULT_MODEL, PROVIDERS, applyAiDetection, detectResilient, loadKey, prepareImage, saveKey, type AiProvider } from "../lib/clone-ai";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  /** CSV column names only. Row data is never sent. */
  headers: string[];
  edit: (fn: (c: CloneSource) => CloneSource) => void;
  onSelect: (id: string | null) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Optional AI detection (Gemini or Groq). Reads text only: it never changes the artwork. */
export default function CloneAiPanel({ clone, headers, edit, onSelect }: Props) {
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [keys, setKeys] = useState<Record<AiProvider, string>>(() => ({ gemini: loadKey("gemini"), groq: loadKey("groq") }));
  const [models, setModels] = useState<Record<AiProvider, string>>({ ...DEFAULT_MODEL });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const info = PROVIDERS[provider];
  const key = keys[provider];
  const model = models[provider];

  async function run() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const image = clone.image;
    setBusy(true);
    setProgress("");
    setMsg(null);
    try {
      saveKey(key.trim(), provider);
      const prepared = await prepareImage(image);
      const { items, dropped, model: used } = await detectResilient({ provider, apiKey: key, model, image: prepared, headers, signal: ctrl.signal, onStatus: setProgress });
      // ignore the answer if the template was swapped while we waited
      const applied = applyAiDetection(clone, items);
      // AI boxes are often a little short or off: fit them to the real writing before showing them
      const fitted = await fitFieldsToInk(applied).catch(() => applied);
      edit((c) => (c.image === image ? fitted : c));
      onSelect(null);
      const editable = items.filter((i) => i.kind !== "other").length;
      const mapped = items.filter((i) => i.kind !== "other" && i.column).length;
      setMsg({
        ok: true,
        text:
          `Found ${plural(editable, "editable field", "editable fields")} and ${plural(items.length - editable, "other text line", "other text lines")}.` +
          (mapped ? ` ${mapped} matched to your CSV columns.` : "") +
          (dropped ? ` ${plural(dropped, "unusable box was", "unusable boxes were")} ignored.` : "") +
          (used !== model ? ` Answered by ${used}, because ${model} was busy.` : "") +
          " Check each box, and use Undo to go back.",
      });
    } catch (e) {
      if (e instanceof AiError && e.code === "cancelled") setMsg(null);
      else setMsg({ ok: false, text: e instanceof AiError ? e.message : "Something went wrong while reading the certificate." });
    } finally {
      setBusy(false);
      setProgress("");
      abort.current = null;
    }
  }

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted">
        <Sparkles className="size-3.5 text-brand" aria-hidden /> Detect fields with AI (Gemini or Groq), optional
      </summary>
      <div className="mt-3 grid gap-3 text-xs">
        <p className="text-muted">
          Finds name, number, date and course boxes more accurately, including Odia, Hindi and other scripts, and can match them to your CSV columns. The AI only reads and locates text. It never changes your certificate artwork.
        </p>
        <p className="rounded bg-secondary p-2 text-muted">
          <strong className="text-ink">Privacy:</strong> clicking Detect sends the template image{headers.length ? " and your CSV column names" : ""} to {info.company}, using your own key. Recipient rows are never sent. The built-in detection stays fully offline.
        </p>

        <fieldset className="grid gap-1 text-muted" disabled={busy}>
          <legend className="mb-1">AI provider</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="AI provider">
            {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={provider === p} className={`rounded border px-3 py-1.5 font-semibold ${provider === p ? "border-brand bg-brand text-primary-foreground" : "border-line"}`} onClick={() => { setProvider(p); setConsent(false); setMsg(null); }}>
                {PROVIDERS[p].name}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="grid gap-1 text-muted">
          {info.name} API key
          <input type="password" autoComplete="off" spellCheck={false} className="field" placeholder="Paste your key" value={key} onChange={(e) => setKeys((k) => ({ ...k, [provider]: e.target.value }))} />
        </label>
        <a className="inline-flex items-center gap-1 text-brand underline" href={info.keyUrl} target="_blank" rel="noopener noreferrer">
          {info.keyLabel} <ExternalLink className="size-3" aria-hidden />
        </a>
        <p className="text-[11px] text-muted">Kept in this browser tab only and cleared when you close it. Never saved to the project.</p>

        <label className="grid gap-1 text-muted">
          Model
          <input className="field" list={`${provider}-models`} value={model} onChange={(e) => setModels((m) => ({ ...m, [provider]: e.target.value.trim() }))} />
          <datalist id={`${provider}-models`}>{info.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </label>
        <p className="text-[11px] text-muted">If the model is overloaded, it retries automatically{provider === "gemini" ? " and then tries another Gemini model" : ""}.</p>

        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I understand the template image will be sent to {info.company}. It contains no recipient data unless my template does.</span>
        </label>
        <div className="flex items-center gap-3">
          <Button variant="certificate" size="certificate" type="button" className="btn btn-primary" disabled={busy || !key.trim() || !consent || !model} onClick={run}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {busy ? (progress ? "Working…" : `Reading with ${info.name}…`) : "Detect with AI"}
          </Button>
          {busy && <button type="button" className="text-brand underline" onClick={() => abort.current?.abort()}>Cancel</button>}
        </div>
        {busy && progress && <p role="status" className="text-muted">{progress}</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-ink" : "text-destructive"}>{msg.text}</p>}
      </div>
    </details>
  );
}
