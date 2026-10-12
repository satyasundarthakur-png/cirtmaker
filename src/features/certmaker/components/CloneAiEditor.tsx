import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import Preview from "./Preview";
import { DEFAULT_DATA, type CertData, type CloneSource } from "../lib/types";
import { PROVIDERS, type AiProvider } from "../lib/clone-ai";
import { AIEditingEngine } from "../lib/editing/AIEditingEngine";
import { SelectionManager, authorizedText } from "../lib/editing/SelectionManager";
import { StyleMatchEngine } from "../lib/editing/StyleMatchEngine";
import { LayerInspector } from "../lib/editing/LayerInspector";
import { applyTemplateLayers } from "../lib/editing/TemplateAdapter";
import { PreviewRenderer } from "../lib/editing/PreviewRenderer";
import { AVAILABLE_FONTS, CommandParser } from "../lib/editing/CommandParser";
import { setLayerLock } from "../lib/clone";
import type { EditCommand, EditPlan, StyleMatch } from "../lib/editing/types";
interface Props {
  clone: CloneSource;
  selected: string | null;
  selectedIds?: string[] | undefined;
  variables: string[];
  provider: AiProvider;
  apiKey: string;
  model: string;
  edit: (fn: (c: CloneSource) => CloneSource) => void;
  previewData?: CertData;
}
export default function CloneAiEditor({
  clone,
  selected,
  selectedIds,
  variables,
  provider,
  apiKey,
  model,
  edit,
  previewData,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [consent, setConsent] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [matches, setMatches] = useState<StyleMatch[]>([]);
  const [message, setMessage] = useState("");
  const [visualPreview, setVisualPreview] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const ids = selectedIds ?? (selected ? [selected] : []);
  const selection = SelectionManager.resolve(clone, ids, reference);
  const revision = AIEditingEngine.revision(clone);
  const context = JSON.stringify([revision, selection, provider, model, instruction, variables]);
  const latest = useRef(context);
  latest.current = context;
  const planContext = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    setConsent(false);
    setPlan(null);
  }, [provider]);
  const selectionKey = selection.ids.join("|");
  useEffect(() => {
    setMatches([]);
  }, [revision, reference, selectionKey]);
  const current = !!plan && plan.revision === revision && planContext.current === context;
  const selectedFields = clone.fields.filter((f) => selection.ids.includes(f.id));
  const allEditable = selectedFields.length > 0 && selectedFields.every(authorizedText);
  const primary = selectedFields.find((f) => f.id === selection.primary);
  const inspector = primary ? LayerInspector.inspect(primary) : null;

  function show(nextPlan: EditPlan) {
    setPlan(nextPlan);
    planContext.current = latest.current;
    setMessage("");
    setVisualPreview(false);
  }
  function queue(commands: EditCommand[]) {
    try {
      show(AIEditingEngine.plan(clone, selection, commands));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not preview edit.");
    }
  }
  async function run() {
    const parsed = CommandParser.local(instruction);
    if (parsed?.length === 1 && parsed[0]?.type === "match") {
      await matchStyle();
      return;
    }
    const captured = context;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setPlan(null);
    setMessage("");
    try {
      const result = await AIEditingEngine.instruct({
        clone,
        selection,
        instruction,
        variables,
        provider,
        apiKey,
        model,
        consent,
        signal: ctrl.signal,
      });
      if (!mounted.current || ctrl.signal.aborted) return;
      if (latest.current !== captured) {
        setMessage("Selection, certificate or instruction changed. Generate a fresh preview.");
        return;
      }
      show(result);
    } catch (e) {
      if (mounted.current && !ctrl.signal.aborted)
        setMessage(e instanceof Error ? e.message : "AI editing failed.");
    } finally {
      if (mounted.current) setBusy(false);
      if (abort.current === ctrl) abort.current = null;
    }
  }
  async function matchStyle() {
    const ref = clone.fields.find((f) => f.id === reference) ?? primary;
    if (!ref) {
      setMessage("Select editable text first.");
      return;
    }
    const captured = context;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setMessage("");
    try {
      const ranked = await StyleMatchEngine.analyze(clone, ref);
      if (mounted.current && !ctrl.signal.aborted && latest.current === captured) {
        setMatches(ranked.slice(0, 3));
        show(AIEditingEngine.plan(clone, selection, [{ type: "match" }], ranked[0]?.style));
      }
    } catch (e) {
      if (mounted.current) setMessage(e instanceof Error ? e.message : "Style analysis failed.");
    } finally {
      if (mounted.current) setBusy(false);
      if (abort.current === ctrl) abort.current = null;
    }
  }
  function matchCandidate(m: StyleMatch) {
    try {
      show(AIEditingEngine.plan(clone, selection, [{ type: "match" }], m.style));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Style preview is stale.");
    }
  }
  function apply() {
    if (!plan || !current) return;
    try {
      edit((c) => AIEditingEngine.apply(c, plan));
      setPlan(null);
      setMessage("Edits applied. Undo and Redo are available in the toolbar.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Preview became stale.");
    }
  }
  function unlock() {
    if (
      !selectedFields.length ||
      selectedFields.some((f) => f.protection && f.protection !== "text")
    ) {
      setMessage("Protected assets cannot be unlocked.");
      return;
    }
    const next = selection.ids.reduce((c, id) => setLayerLock(c, id, false), clone);
    show({
      revision,
      selection,
      commands: [],
      next,
      changes: PreviewRenderer.diff(clone, next),
      warnings: [],
      summary: "Manually unlock selected text layers",
    });
  }
  const beforeData = previewData ?? { ...DEFAULT_DATA, cloneMode: true, clone };
  const afterData = plan
    ? previewData
      ? applyTemplateLayers(previewData, plan.next)
      : { ...beforeData, clone: plan.next }
    : beforeData;
  return (
    <section
      aria-label="AI instruction editing"
      className="grid gap-3 rounded-lg border border-brand p-3 text-xs"
    >
      <h3 className="font-semibold">Selection-aware AI editing</h3>
      <p>
        {selection.ids.length
          ? `Selected: ${selectedFields.map((f) => f.label).join(", ")}`
          : "Select a text box on the document or use the selection checkboxes. Shift/Ctrl-click adds to the selection."}
      </p>
      {inspector && (
        <p className="text-muted">
          {inspector.locked ? "Locked" : inspector.editable ? "Editable" : "Protected"} ·{" "}
          {inspector.style.font}, {inspector.style.fontSize}px, weight {inspector.style.fontWeight}{" "}
          ·{" "}
          {inspector.tokens.length ? `CSV tokens: ${inspector.tokens.join(", ")}` : "Literal text"}
        </p>
      )}
      <label className="grid gap-1">
        AI editing instruction
        <textarea
          aria-label="AI editing instruction"
          className="field min-h-24"
          maxLength={4000}
          disabled={busy}
          value={instruction}
          placeholder={'Replace this with "Rabindra"'}
          onChange={(e) => {
            setInstruction(e.target.value);
            setPlan(null);
          }}
        />
      </label>
      <p className="text-muted">
        Simple instructions run locally. Other instructions use the configured{" "}
        {PROVIDERS[provider].name} model. No IDs are needed. Every change requires Accept after
        preview.
      </p>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          I agree to send my instruction and selected editable text/styles plus variable names to{" "}
          {PROVIDERS[provider].company}. This may include personal information. Images and CSV rows
          are not sent.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="certificate"
          size="certificate"
          disabled={busy || !instruction.trim()}
          onClick={run}
        >
          {busy ? "Analyzing…" : "Generate edit preview"}
        </Button>
        {busy && (
          <Button
            variant="certificate"
            size="certificate"
            onClick={() => {
              abort.current?.abort();
              setMessage("Cancelled.");
            }}
          >
            Cancel AI editing
          </Button>
        )}
      </div>
      <label className="grid gap-1">
        Style reference
        <select
          aria-label="Style reference"
          className="field"
          value={reference ?? ""}
          onChange={(e) => {
            setReference(e.target.value || null);
            setPlan(null);
          }}
        >
          <option value="">Selected original style (or choose reference text)</option>
          {clone.fields
            .filter((f) => !f.deleted)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["Match style", () => void matchStyle()],
            ["Duplicate", () => queue([{ type: "duplicate" }])],
            ["Remove layer", () => queue([{ type: "delete" }])],
            ["Center", () => queue([{ type: "align", axis: "center" }])],
            ["Align horizontally", () => queue([{ type: "align", axis: "horizontal" }])],
            ["Lock layers", () => queue([{ type: "lock" }])],
          ] as const
        ).map(([label, action]) => (
          <Button
            key={label}
            variant="certificate"
            size="certificate"
            disabled={busy || !allEditable}
            onClick={action}
          >
            {label}
          </Button>
        ))}
        {selectedFields.some((f) => f.locked) && (
          <Button variant="certificate" size="certificate" onClick={unlock}>
            Preview manual unlock
          </Button>
        )}
      </div>
      {!!matches.length && (
        <div className="grid gap-2">
          {matches.map((m, i) => (
            <Button
              key={`${m.font}-${m.style.fontWeight}-${i}`}
              variant="certificate"
              size="certificate"
              onClick={() => matchCandidate(m)}
            >
              {["Best Match", "Alternate Match 1", "Alternate Match 2"][i]}: {m.font} ·{" "}
              {m.confidence}% similarity — Preview
            </Button>
          ))}
          <p className="text-muted">
            Scores measure font/property or glyph similarity, not statistical certainty. Original
            raster identification is approximate. Decorative fonts require a script-style reference.
          </p>
        </div>
      )}
      {inspector && (
        <details>
          <summary className="cursor-pointer">Layer inspector and typography controls</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              Font
              <select
                className="field"
                value={primary?.font}
                disabled={!allEditable}
                onChange={(e) => queue([{ type: "style", style: { font: e.target.value } }])}
              >
                {AVAILABLE_FONTS.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <label>
              Color
              <input
                aria-label="Layer color"
                type="color"
                value={primary?.color}
                disabled={!allEditable}
                onChange={(e) => queue([{ type: "style", style: { color: e.target.value } }])}
              />
            </label>
            {(
              [
                ["Font size", "fontSize", primary?.fontSize ?? 24],
                ["Font weight", "fontWeight", primary?.fontWeight ?? (primary?.bold ? 700 : 400)],
                ["Letter spacing", "letterSpacing", primary?.letterSpacing ?? 0],
                ["Line height", "lineHeight", primary?.lineHeight ?? 1.2],
                ["Opacity", "opacity", primary?.opacity ?? 1],
              ] as const
            ).map(([label, property, value]) => (
              <label key={property}>
                {label}
                <input
                  className="field"
                  type="number"
                  step={property === "opacity" || property === "lineHeight" ? 0.1 : 1}
                  key={`${primary?.id}-${revision}-${property}`}
                  defaultValue={value}
                  disabled={!allEditable}
                  onBlur={(e) =>
                    queue([{ type: "style", style: { [property]: Number(e.target.value) } }])
                  }
                />
              </label>
            ))}
            <label>
              Rotation
              <input
                className="field"
                type="number"
                key={`${primary?.id}-${revision}-rotation`}
                defaultValue={primary?.rotation ?? 0}
                disabled={!allEditable}
                onBlur={(e) => queue([{ type: "rotate", degrees: Number(e.target.value) }])}
              />
            </label>
            <Button
              variant="certificate"
              size="certificate"
              disabled={!allEditable}
              onClick={() => queue([{ type: "style", style: { italic: !primary?.italic } }])}
            >
              Toggle slant
            </Button>
            <Button
              variant="certificate"
              size="certificate"
              disabled={!allEditable}
              onClick={() =>
                queue([
                  {
                    type: "style",
                    style: {
                      textEffects: {
                        strokeColor: primary?.color ?? "#000000",
                        strokeWidth: 1,
                        shadowColor: "#000000",
                        shadowBlur: 2,
                        shadowX: 1,
                        shadowY: 1,
                      },
                    },
                  },
                ])
              }
            >
              Preview outline and shadow
            </Button>
          </div>
        </details>
      )}
      {plan && (
        <div aria-live="polite" className="grid gap-2 rounded border border-line p-2">
          <p className="font-semibold">{plan.summary}</p>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Layer / changed property</th>
                  <th>Old value</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {plan.changes.flatMap((change) =>
                  change.properties
                    .filter((p) => !["sourceBox", "redraw"].includes(p))
                    .map((property) => (
                      <tr key={`${change.id}-${property}`} className="border-t border-line">
                        <td>
                          {change.label}: {property}
                        </td>
                        <td className="break-all">
                          <del>
                            {JSON.stringify(
                              change.before?.[property as keyof typeof change.before],
                            ) ?? "absent"}
                          </del>
                        </td>
                        <td className="break-all bg-brand/10">
                          <ins>
                            {JSON.stringify(
                              change.after?.[property as keyof typeof change.after],
                            ) ?? "removed"}
                          </ins>
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
          {!!plan.warnings.length && (
            <p className="whitespace-pre-line text-destructive">{plan.warnings.join("\n")}</p>
          )}
          {!current && <p role="status">Preview is stale. Generate it again.</p>}
          <Button
            variant="certificate"
            size="certificate"
            onClick={() => setVisualPreview((v) => !v)}
          >
            Show before / after document
          </Button>
          {visualPreview && (
            <div className="grid gap-2">
              <div>
                <p>Before</p>
                <Preview data={beforeData} selected={null} onSelect={() => {}} />
              </div>
              <div>
                <p>After</p>
                <Preview data={afterData} selected={null} onSelect={() => {}} />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="certificate"
              size="certificate"
              disabled={!current || !plan.changes.length}
              onClick={apply}
            >
              Accept edits
            </Button>
            <Button variant="certificate" size="certificate" onClick={() => setPlan(null)}>
              Reject edits
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="whitespace-pre-line break-words">
          {message}
        </p>
      )}
    </section>
  );
}
