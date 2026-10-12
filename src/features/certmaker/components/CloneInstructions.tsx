import { checkClone } from "../lib/clone-check";
import { useState } from "react";
import { Check, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyFieldInstruction,
  instructionIsCurrent,
  planFieldInstruction,
  type FieldInstruction,
} from "../lib/clone-instructions";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  selected: string | null;
  variables: string[];
  edit: (fn: (c: CloneSource) => CloneSource) => void;
  onSelect: (id: string | null) => void;
}

export default function CloneInstructions({ clone, selected, variables, edit, onSelect }: Props) {
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<FieldInstruction | null>(null);
  const [message, setMessage] = useState("");
  const field = clone.fields.find((f) => f.id === selected);
  const current = !!plan && selected === plan.id && instructionIsCurrent(clone, plan);

  function review() {
    setPlan(null);
    setMessage("");
    try {
      setPlan(planFieldInstruction(clone, selected ?? "", instruction, variables));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that instruction.");
    }
  }

  function apply() {
    if (!plan || !current) return;
    edit((c) => applyFieldInstruction(c, plan));
    if (plan.remove) onSelect(null);
    if (plan.duplicate) onSelect(plan.duplicate.id);
    setPlan(null);
    setInstruction("");
    setMessage("Change applied.");
  }

  return (
    <section
      aria-label="Text box instructions"
      className="grid min-w-0 gap-2 border-y border-line py-3 text-xs"
    >
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Terminal className="size-3.5" aria-hidden /> Editing assistant{" "}
        <span className="ml-auto text-muted">On-device</span>
      </h3>
      <p className="break-words text-muted">
        {field ? `Selected: ${field.label} (${field.id})` : "No text box selected"}
      </p>
      <p className="text-muted">
        AI detects boxes; these reviewed commands edit them locally. Erase removes selected text.
        Duplicate copies an editable text box. Beautify changes typography.
      </p>
      <div className="flex flex-wrap gap-1">
        {["erase text", "duplicate", "beautify", "restore original"].map((command) => (
          <Button
            key={command}
            variant="certificate"
            size="certificate"
            disabled={!field}
            onClick={() => {
              setInstruction(command);
              setPlan(null);
              setMessage("");
            }}
          >
            {command}
          </Button>
        ))}
        <Button
          variant="certificate"
          size="certificate"
          onClick={() => {
            const issues = checkClone(clone);
            setMessage(
              issues.length
                ? issues.join("\n")
                : "Layout check passed: no out-of-page boxes, overlaps or unerased replacement text found.",
            );
          }}
        >
          Check layout
        </Button>
      </div>
      {field && clone.fields.some((f) => f.id !== field.id) && (
        <label className="grid gap-1 text-muted">
          Match style to
          <select
            className="field"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setInstruction(`match style ${e.target.value}`);
                setPlan(null);
                setMessage("");
              }
            }}
          >
            <option value="">Choose another text box</option>
            {clone.fields
              .filter((f) => f.id !== field.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.id})
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="grid gap-1 text-muted">
        Instruction
        <textarea
          aria-label="Text box instruction"
          className="field min-h-20 resize-y"
          value={instruction}
          maxLength={4000}
          disabled={!field}
          placeholder={'Set text to "Workshop"'}
          onChange={(e) => {
            setInstruction(e.target.value);
            setPlan(null);
            setMessage("");
          }}
        />
      </label>
      <p className="text-muted">
        Try: write "Workshop", move right 20 px, font size 24, align center, or fill from column
        name.
      </p>
      <Button
        variant="certificate"
        size="certificate"
        className="btn justify-self-start"
        disabled={!field || !instruction.trim()}
        onClick={review}
      >
        <Terminal aria-hidden /> Review command
      </Button>
      {plan && (
        <div className="grid min-w-0 gap-2" aria-live="polite">
          <p className="break-words font-medium">{plan.summary}</p>
          {!current && (
            <p role="status" className="text-destructive">
              Selection or field changed. Review the command again.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="certificate"
              size="certificate"
              className="btn btn-primary"
              disabled={!current}
              onClick={apply}
            >
              <Check aria-hidden /> Apply change
            </Button>
            <Button
              variant="certificate"
              size="certificate"
              className="btn"
              onClick={() => setPlan(null)}
            >
              <X aria-hidden /> Discard
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="whitespace-pre-line break-words text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
