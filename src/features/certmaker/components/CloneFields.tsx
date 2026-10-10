import { useEffect } from "react";
import { AlignCenter, AlignLeft, AlignRight, Crosshair, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addManualField, autoMapFields, patchField, promoteSuggestion, removeField } from "../lib/clone";
import type { CloneAlign, CloneKind, CloneSource, CloneTextField } from "../lib/types";

export interface PickTarget {
  id: string;
  prop: "color" | "cover";
}

interface Props {
  clone: CloneSource;
  edit: (fn: (c: CloneSource) => CloneSource) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** CSV columns plus built-in variables, offered as {{variable}} shortcuts. */
  variables: string[];
  picking: PickTarget | null;
  onPick: (target: PickTarget | null) => void;
}

const FONTS = ["Inter", "serif", "Playfair Display", "Great Vibes", "Cormorant Garamond", "Montserrat", "Noto Sans Oriya", "Noto Sans Devanagari"];
const KIND_BADGE: Record<CloneKind, string> = { name: "Name", certId: "Number", date: "Date", course: "Course", custom: "Custom" };
const ALIGNS: { v: CloneAlign; label: string; Icon: typeof AlignLeft }[] = [
  { v: "left", label: "Align left", Icon: AlignLeft },
  { v: "center", label: "Align centre", Icon: AlignCenter },
  { v: "right", label: "Align right", Icon: AlignRight },
];
const GEOMETRY = [
  ["x", "Left"],
  ["y", "Top"],
  ["w", "Width"],
  ["h", "Height"],
  ["fontSize", "Font size"],
] as const;

const MEGAPIXELS_WARN = 16.7;

export default function CloneFields({ clone, edit, selected, onSelect, variables, picking, onPick }: Props) {
  useEffect(() => {
    if (selected) document.getElementById(`card-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const update = (id: string, patch: Partial<CloneTextField>) => edit((c) => patchField(c, id, patch));
  const megapixels = (clone.width * clone.height) / 1_000_000;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1 text-xs text-muted">
        <p className="break-words font-semibold text-ink">{clone.filename}</p>
        <p>
          {clone.width} × {clone.height} px · {clone.kind === "pdf" ? "PDF page rendered once at print resolution" : "used exactly as uploaded"}
        </p>
        <p>The artwork is locked. Only the boxes below change, and a box only paints once its text differs from the original.</p>
        {megapixels > MEGAPIXELS_WARN && (
          <p role="status" className="text-destructive">
            This is a {megapixels.toFixed(0)} megapixel image. Some phones cannot export at full size and will export slightly smaller.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="certificate"
          size="certificate"
          type="button"
          className="btn"
          onClick={() => {
            const r = addManualField(clone);
            edit(() => r.clone);
            onSelect(r.id);
          }}
        >
          <Plus aria-hidden /> Add text box
        </Button>
        <Button variant="certificate" size="certificate" type="button" className="btn" onClick={() => edit(autoMapFields)} disabled={!clone.fields.length}>
          <Wand2 aria-hidden /> Fill from CSV columns
        </Button>
      </div>

      {picking && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-brand bg-secondary p-2 text-xs">
          Click a spot on the certificate to pick its colour.
          <button type="button" className="font-semibold text-brand underline" onClick={() => onPick(null)}>Cancel</button>
        </p>
      )}

      {!clone.fields.length && (
        <p role="status" className="text-sm text-muted">
          No name, number, date or course text was recognised. Use “Add text box”, or promote a line from “Other text” below. The original stays unchanged.
        </p>
      )}

      {clone.fields.map((f) => {
        const on = selected === f.id;
        return (
          <div key={f.id} id={`card-${f.id}`} className={`grid min-w-0 gap-2 rounded-lg border p-3 ${on ? "border-brand bg-secondary/40" : "border-line"}`}>
            <label htmlFor={f.id} className="min-w-0 text-xs font-semibold text-muted">
              <span className="mr-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand">{KIND_BADGE[f.kind]}</span>
              <span className="break-words">{f.label}</span>
            </label>
            <input id={f.id} className="field" value={f.replacement} onFocus={() => onSelect(f.id)} onChange={(e) => update(f.id, { replacement: e.target.value })} />
            {f.original && <p className="break-words text-[11px] text-muted">Original text: {f.original}</p>}

            {on && (
              <div className="grid gap-3 border-t border-line pt-3">
                <label className="grid gap-1 text-xs text-muted">
                  Fill from a column
                  <select className="field" value="" onChange={(e) => e.target.value && update(f.id, { replacement: `{{${e.target.value}}}` })}>
                    <option value="">Choose a column…</option>
                    {variables.map((v) => <option key={v} value={v}>{`{{${v}}}`}</option>)}
                  </select>
                </label>

                <label className="grid gap-1 text-xs text-muted">
                  Font
                  <select aria-label={`${f.label} font`} className="field" value={f.font} onChange={(e) => update(f.id, { font: e.target.value })}>
                    {FONTS.map((font) => <option key={font}>{font}</option>)}
                  </select>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" aria-label="Bold" aria-pressed={f.bold} className={`rounded border px-2.5 py-1 text-xs font-bold ${f.bold ? "border-brand bg-brand text-primary-foreground" : "border-line"}`} onClick={() => update(f.id, { bold: !f.bold })}>B</button>
                  <button type="button" aria-label="Italic" aria-pressed={f.italic} className={`rounded border px-2.5 py-1 text-xs italic ${f.italic ? "border-brand bg-brand text-primary-foreground" : "border-line"}`} onClick={() => update(f.id, { italic: !f.italic })}>I</button>
                  {ALIGNS.map(({ v, label, Icon }) => (
                    <button key={v} type="button" aria-label={label} aria-pressed={f.align === v} className={`rounded border p-1.5 ${f.align === v ? "border-brand bg-brand text-primary-foreground" : "border-line"}`} onClick={() => update(f.id, { align: v })}>
                      <Icon className="size-4" aria-hidden />
                    </button>
                  ))}
                </div>

                <div className="grid gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      Text colour
                      <input aria-label={`${f.label} text colour`} type="color" value={f.color} onChange={(e) => update(f.id, { color: e.target.value })} />
                    </label>
                    <button type="button" className="inline-flex items-center gap-1 text-brand underline" onClick={() => onPick({ id: f.id, prop: "color" })}>
                      <Crosshair className="size-3.5" aria-hidden /> Pick from certificate
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={!!f.cover} onChange={(e) => update(f.id, { cover: e.target.checked ? "#ffffff" : "" })} />
                      Cover the original text
                    </label>
                    {f.cover && (
                      <>
                        <input aria-label={`${f.label} cover colour`} type="color" value={f.cover} onChange={(e) => update(f.id, { cover: e.target.value })} />
                        <button type="button" className="inline-flex items-center gap-1 text-brand underline" onClick={() => onPick({ id: f.id, prop: "cover" })}>
                          <Crosshair className="size-3.5" aria-hidden /> Pick from certificate
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">The cover is a flat patch in the colour you choose. On a patterned background, turn it off or pick the colour next to the text.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {GEOMETRY.map(([key, label]) => (
                    <label key={key} className="text-xs text-muted">
                      {label}
                      <input
                        className="field"
                        type="number"
                        min={key === "x" || key === "y" ? 0 : 1}
                        value={Math.round(f[key])}
                        onChange={(e) => update(f.id, { [key]: Math.max(key === "x" || key === "y" ? 0 : 1, Number(e.target.value)) })}
                      />
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 text-xs">
                  {f.original && (
                    <button type="button" className="text-brand underline" onClick={() => update(f.id, { replacement: f.original })}>Restore original text</button>
                  )}
                  <button type="button" className="inline-flex items-center gap-1 text-destructive underline" onClick={() => { edit((c) => removeField(c, f.id)); onSelect(null); }}>
                    <Trash2 className="size-3.5" aria-hidden /> Remove box
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {clone.suggestions.length > 0 && (
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Other text on the certificate ({clone.suggestions.length}). Not editable unless you choose.</summary>
          <ul className="mt-3 grid gap-2">
            {clone.suggestions.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 break-words">{s.original}</span>
                <button type="button" className="shrink-0 text-brand underline" onClick={() => { edit((c) => promoteSuggestion(c, s.id)); onSelect(s.id); }}>Make editable</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
