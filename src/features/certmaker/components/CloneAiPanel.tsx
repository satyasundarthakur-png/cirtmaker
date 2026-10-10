import { useRef, useState } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiError, DEFAULT_MODEL, GEMINI_MODELS, applyAiDetection, detectWithGemini, loadKey, prepareImage, saveKey } from "../lib/clone-ai";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  /** CSV column names only. Row data is never sent. */
  headers: string[];
  edit: (fn: (c: CloneSource) => CloneSource) => void;
  onSelect: (id: string | null) => void;
}

/** Optional Gemini detection. Reads text only: it never changes the artwork. */
export default function CloneAiPanel({ clone, headers, edit, onSelect }: Props) {
  const [key, setKey] = useState(loadKey);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const image = clone.image;
    setBusy(true);
    setMsg(null);
    try {
      saveKey(key.trim());
      const imageBase64 = await prepareImage(image);
      const { items, dropped } = await detectWithGemini({ apiKey: key, model, imageBase64, headers, signal: ctrl.signal });
      // ignore the answer if the template was swapped while we waited
      edit((c) => (c.image === image ? applyAiDetection(c, items) : c));
      onSelect(null);
      const editable = items.filter((i) => i.kind !== "other").length;
      const mapped = items.filter((i) => i.kind !== "other" && i.column).length;
      setMsg({
        ok: true,
        text: `Found ${editable} editable field${editable === 1 ? "" : "s"} and ${items.length - editable} other text line${items.length - editable === 1 ? "" : "s"}.${mapped ? ` ${mapped} matched to your CSV columns.` : ""}${dropped ? ` ${dropped} unusable box${dropped === 1 ? " was" : "es were"} ignored.` : ""} Check each box, and use Undo to go back.`,
      });
    } catch (e) {
      if (e instanceof AiError && e.code === "cancelled") setMsg(null);
      else setMsg({ ok: false, text: e instanceof AiError ? e.message : "Something went wrong while reading the certificate." });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted">
        <Sparkles className="size-3.5 text-brand" aria-hidden /> Detect fields with AI (Gemini), optional
      </summary>
      <div className="mt-3 grid gap-3 text-xs">
        <p className="text-muted">
          Finds name, number, date and course boxes more accurately, including Odia, Hindi and other scripts, and can match them to your CSV columns. The AI only reads and locates text. It never changes your certificate artwork.
        </p>
        <p className="rounded bg-secondary p-2 text-muted">
          <strong className="text-ink">Privacy:</strong> clicking Detect sends the template image{headers.length ? " and your CSV column names" : ""} to Google, using your own key. Recipient rows are never sent. The built-in detection stays fully offline.
        </p>
        <label className="grid gap-1 text-muted">
          Gemini API key
          <input type="password" autoComplete="off" spellCheck={false} className="field" placeholder="Paste your key" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <a className="inline-flex items-center gap-1 text-brand underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
          Get a key from Google AI Studio <ExternalLink className="size-3" aria-hidden />
        </a>
        <p className="text-[11px] text-muted">Kept in this browser tab only and cleared when you close it. In Google’s console you can restrict the key to this website.</p>
        <label className="grid gap-1 text-muted">
          Model
          <input className="field" list="gemini-models" value={model} onChange={(e) => setModel(e.target.value.trim())} />
          <datalist id="gemini-models">{GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I understand the template image will be sent to Google. It contains no recipient data unless my template does.</span>
        </label>
        <div className="flex items-center gap-3">
          <Button variant="certificate" size="certificate" type="button" className="btn btn-primary" disabled={busy || !key.trim() || !consent || !model} onClick={run}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} {busy ? "Reading with Gemini…" : "Detect with AI"}
          </Button>
          {busy && <button type="button" className="text-brand underline" onClick={() => abort.current?.abort()}>Cancel</button>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-ink" : "text-destructive"}>{msg.text}</p>}
      </div>
    </details>
  );
}
