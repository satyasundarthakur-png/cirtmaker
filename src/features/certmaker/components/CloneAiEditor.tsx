import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkClone } from "../lib/clone-check";
import { AiError, PROVIDERS, saveKey, type AiProvider } from "../lib/clone-ai";
import {
  applyAiEditPlan,
  editSnapshot,
  generateEditPlan,
  type AiEditPlan,
} from "../lib/clone-ai-edit";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  selected: string | null;
  variables: string[];
  provider: AiProvider;
  apiKey: string;
  model: string;
  edit: (fn: (c: CloneSource) => CloneSource) => void;
}

export default function CloneAiEditor({
  clone,
  selected,
  variables,
  provider,
  apiKey,
  model,
  edit,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [consent, setConsent] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AiEditPlan | null>(null);
  const [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);
  const snapshot = editSnapshot(clone);
  const context = JSON.stringify([
    snapshot,
    selected,
    variables,
    provider,
    model,
    apiKey,
    instruction,
  ]);
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
  const current = !!plan && plan.snapshot === snapshot && planContext.current === context;

  async function run() {
    if (!consent || !apiKey.trim() || busy) return;
    const captured = context;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setPlan(null);
    setMessage("");
    try {
      saveKey(apiKey.trim(), provider);
      const generated = await generateEditPlan({
        clone,
        selected,
        variables,
        provider,
        apiKey,
        model,
        instruction,
        signal: ctrl.signal,
      });
      if (!mounted.current || ctrl.signal.aborted) return;
      if (latest.current !== captured) {
        setMessage("The certificate, selection or instruction changed. Generate a new plan.");
        return;
      }
      planContext.current = captured;
      if (autoApply && generated.actions.length && !generated.issues.length) {
        edit((c) => applyAiEditPlan(c, generated, variables));
        setMessage(
          `Applied ${generated.actions.length} AI edit action(s). Use Undo to restore the previous version.\n${generated.summaries.join("\n")}`,
        );
      } else {
        setPlan(generated);
        if (autoApply && generated.issues.length)
          setMessage("Layout warnings require review before applying.");
      }
    } catch (e) {
      if (mounted.current && !ctrl.signal.aborted)
        setMessage(
          e instanceof AiError || e instanceof Error ? e.message : "Could not plan AI edits.",
        );
    } finally {
      if (mounted.current) setBusy(false);
      if (abort.current === ctrl) abort.current = null;
    }
  }

  function apply() {
    if (!plan || !current || !plan.actions.length || !consent) return;
    edit((c) => applyAiEditPlan(c, plan, variables));
    setPlan(null);
    setMessage("AI edits applied. Use Undo to restore the previous version.");
  }

  return (
    <section
      aria-label="AI instruction editing"
      className="grid gap-2 rounded-lg border border-brand p-3 text-xs"
    >
      <h3 className="font-semibold">Edit with AI</h3>
      <p className="text-muted">
        Describe your change in ordinary language. AI plans edits across editable text boxes; the
        editor applies them. Configure your {PROVIDERS[provider].name} key and model in the AI
        settings above.
      </p>
      <p className="text-muted">
        {selected
          ? `Selected box: ${selected}`
          : "No selection. Name the text box in your instruction, or ask to add new text."}
      </p>
      <label className="grid gap-1">
        AI editing instruction
        <textarea
          aria-label="AI editing instruction"
          className="field min-h-24"
          maxLength={4000}
          disabled={busy}
          value={instruction}
          placeholder={'Make the selected name elegant, center it, and write "Asha Saha".'}
          onChange={(e) => {
            setInstruction(e.target.value);
            setPlan(null);
            setMessage("");
          }}
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (!e.target.checked) setPlan(null);
          }}
        />
        <span>
          I agree to send this instruction, editable field text and styles, selection, and variable
          names to {PROVIDERS[provider].company}. Field text may contain personal information.
          Certificate images and CSV recipient rows are not sent by this editing action.
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={autoApply}
          disabled={busy}
          onChange={(e) => setAutoApply(e.target.checked)}
        />
        <span>
          Automatically apply validated AI edits when layout checks find no warnings. Undo remains
          available.
        </span>
      </label>
      {!apiKey.trim() && (
        <p role="status" className="text-muted">
          Enter an API key in the AI settings above to enable AI editing.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="certificate"
          size="certificate"
          disabled={busy || !consent || !apiKey.trim() || !model.trim() || !instruction.trim()}
          onClick={run}
        >
          {busy ? "Planning edits…" : autoApply ? "Edit with AI" : "Generate AI edit plan"}
        </Button>
        {busy && (
          <Button
            variant="certificate"
            size="certificate"
            onClick={() => {
              abort.current?.abort();
              setMessage("AI editing cancelled.");
            }}
          >
            Cancel AI editing
          </Button>
        )}
        <Button
          variant="certificate"
          size="certificate"
          onClick={() => {
            const issues = checkClone(clone);
            setMessage(
              issues.length
                ? issues.join("\n")
                : "Structural layout check passed. This is not a spelling or visual similarity check.",
            );
          }}
        >
          Check layout locally
        </Button>
      </div>
      {plan && (
        <div aria-live="polite" className="grid gap-2">
          <p className="whitespace-pre-line">{plan.explanation}</p>
          {!!plan.summaries.length && (
            <ul className="list-inside list-disc">
              {plan.summaries.map((s, i) => (
                <li key={i} className="break-words">
                  {s}
                </li>
              ))}
            </ul>
          )}
          {!!plan.issues.length && (
            <p className="whitespace-pre-line text-destructive">{plan.issues.join("\n")}</p>
          )}
          {!current && <p role="status">Plan is stale. Generate it again.</p>}
          <div className="flex gap-2">
            <Button
              variant="certificate"
              size="certificate"
              disabled={!current || !consent || !plan.actions.length}
              onClick={apply}
            >
              Apply AI edits
            </Button>
            <Button variant="certificate" size="certificate" onClick={() => setPlan(null)}>
              Discard AI plan
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="whitespace-pre-line break-words">
          {message}
        </p>
      )}
      <p className="text-muted">
        Text edits only: erase, write, add, duplicate, move, resize, beautify and match another
        box’s style. Artwork and logos stay locked. Check the preview after applying.
      </p>
    </section>
  );
}
