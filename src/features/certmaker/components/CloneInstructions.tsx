import { useState } from "react";
import { Check, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyFieldInstruction, instructionIsCurrent, planFieldInstruction, type FieldInstruction } from "../lib/clone-instructions";
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
    setPlan(null);
    setInstruction("");
    setMessage("Change applied.");
  }

  return (
    <section aria-label="Text box instructions" className="grid min-w-0 gap-2 border-y border-line py-3 text-xs">
      <h3 className="flex items-center gap-1.5 font-semibold"><Terminal className="size-3.5" aria-hidden /> Text box instructions <span className="ml-auto text-muted">On-device</span></h3>
      <p className="break-words text-muted">{field ? `Selected: ${field.label}` : "No text box selected"}</p>
      <label className="grid gap-1 text-muted">
        Instruction
        <textarea aria-label="Text box instruction" className="field min-h-20 resize-y" value={instruction} maxLength={4000} disabled={!field} placeholder={'Set text to "Workshop"'} onChange={(e) => { setInstruction(e.target.value); setPlan(null); setMessage(""); }} />
      </label>
      <Button variant="certificate" size="certificate" className="btn justify-self-start" disabled={!field || !instruction.trim()} onClick={review}><Terminal aria-hidden /> Review command</Button>
      {plan && (
        <div className="grid min-w-0 gap-2" aria-live="polite">
          <p className="break-words font-medium">{plan.summary}</p>
          {!current && <p role="status" className="text-destructive">Selection or field changed. Review the command again.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="certificate" size="certificate" className="btn btn-primary" disabled={!current} onClick={apply}><Check aria-hidden /> Apply change</Button>
            <Button variant="certificate" size="certificate" className="btn" onClick={() => setPlan(null)}><X aria-hidden /> Discard</Button>
          </div>
        </div>
      )}
      {message && <p role="status" className="break-words text-muted">{message}</p>}
    </section>
  );
}