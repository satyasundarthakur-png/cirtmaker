import { patchField, removeField, nextIndex } from "./clone";
import type { CloneSource, CloneTextField } from "./types";

export interface FieldInstruction {
  id: string;
  before: CloneTextField;
  image: string;
  patch: Partial<CloneTextField>;
  remove: boolean;
  summary: string;
  duplicate?: CloneTextField;
  snapshot: string;
}

/** Device-only, explicit commands. Never guesses artwork operations or executes generated code. */
export function planFieldInstruction(
  clone: CloneSource,
  id: string,
  instruction: string,
  variables: string[],
): FieldInstruction {
  const field = clone.fields.find((f) => f.id === id);
  if (!field) throw new Error("Select a text box first.");
  const text = instruction.trim();
  if (!text || text.length > 4000) throw new Error("Enter an instruction of 1–4000 characters.");
  let patch: Partial<CloneTextField> = {};
  let remove = false;
  let summary = "";
  let duplicate: CloneTextField | undefined;
  let match: RegExpMatchArray | null;
  if (/^(?:replicate|duplicate)(?: (?:selected )?(?:text|box|field))?$/i.test(text)) {
    const normalized = patchField(clone, id, { y: field.y + field.h + 8 }).fields.find(
      (f) => f.id === id,
    )!;
    duplicate = {
      ...field,
      id: `clone-${nextIndex(clone)}`,
      original: "",
      replacement: field.replacement,
      x: normalized.x,
      y: normalized.y,
      erase: "none",
      cover: "",
      redraw: true,
      label: `${field.label} copy`,
    };
    summary = "Duplicate selected text as a new editable box (original artwork retained)";
  } else if ((match = text.match(/^write\s+([\s\S]+)$/i))) {
    patch = { replacement: match[1]!.replace(/^("|')([\s\S]*)\1$/, "$2") };
    summary = `Text → ${patch.replacement}`;
  } else if (
    (match = text.match(
      /^font\s+(Inter|serif|Playfair Display|Great Vibes|Cormorant Garamond|Montserrat|Noto Sans Oriya|Noto Sans Devanagari)$/i,
    ))
  ) {
    const fonts = [
      "Inter",
      "serif",
      "Playfair Display",
      "Great Vibes",
      "Cormorant Garamond",
      "Montserrat",
      "Noto Sans Oriya",
      "Noto Sans Devanagari",
    ];
    patch = {
      font: fonts.find((f) => f.toLowerCase() === match![1]!.toLowerCase())!,
      redraw: true,
      erase: field.original ? "smart" : field.erase,
    };
    summary = `Font → ${patch.font}`;
  } else if ((match = text.match(/^colou?r\s+(#[0-9a-f]{6})$/i))) {
    patch = { color: match[1]!, redraw: true, erase: field.original ? "smart" : field.erase };
    summary = `Colour → ${patch.color}`;
  } else if ((match = text.match(/^(bold|italic)\s+(on|off)$/i))) {
    patch = {
      [match[1]!.toLowerCase()]: match[2]!.toLowerCase() === "on",
      redraw: true,
      erase: field.original ? "smart" : field.erase,
    };
    summary = `${match[1]} → ${match[2]}`;
  } else if (/^beautify(?: text)?$/i.test(text)) {
    patch = {
      font: "Playfair Display",
      align: "center",
      bold: false,
      italic: false,
      weight: 0,
      fontSize: Math.max(8, field.h * 0.7),
      redraw: true,
      erase: field.original ? "smart" : field.erase,
    };
    summary = "Use centered Playfair Display, fit text inside the selected box";
  } else if ((match = text.match(/^match(?: style)?(?: to| with)?\s+(.+)$/i))) {
    const target = clone.fields.find((f) => f.id === match![1]);
    if (!target || target.id === id)
      throw new Error("Use another editable box's ID to match its style.");
    const { font, fontSize, color, bold, italic, align, weight } = target;
    patch = {
      font,
      fontSize,
      color,
      bold,
      italic,
      align,
      weight,
      redraw: true,
      erase: field.original ? "smart" : field.erase,
    };
    summary = `Match typography and colour to ${target.label} (${target.id})`;
  } else if (
    (match = text.match(
      /^(?:set|change|update|replace)\s+(?:(?:the\s+)?(?:selected\s+)?(?:text|field|content|value)\s+)?(?:to|with)\s+([\s\S]+)$/i,
    ))
  ) {
    let replacement = match[1] ?? "";
    if (
      (replacement.startsWith('"') && replacement.endsWith('"')) ||
      (replacement.startsWith("'") && replacement.endsWith("'"))
    )
      replacement = replacement.slice(1, -1);
    patch = { replacement };
    summary = `Text → ${replacement || "(empty)"}`;
  } else if (
    (match = text.match(
      /^(?:fill|map)\s+(?:(?:the\s+)?(?:selected\s+)?(?:text|field)\s+)?from\s+(?:(?:the\s+)?(?:csv\s+)?column\s+)?(.+)$/i,
    ))
  ) {
    const name = (match[1] ?? "").replace(/^\{\{|\}\}$/g, "").trim();
    const column =
      variables.find((v) => v === name) ??
      variables.find((v) => v.toLowerCase() === name.toLowerCase());
    if (!column)
      throw new Error(
        "That column is unavailable. Choose an existing CSV column or built-in variable.",
      );
    patch = { replacement: `{{${column}}}` };
    summary = `Text → {{${column}}}`;
  } else if (/^restore(?: original(?: text)?)?$/i.test(text)) {
    patch = { replacement: field.original, redraw: false };
    summary = "Restore original text";
  } else if (/^(?:clear|erase|delete)(?: (?:the )?(?:selected |user-added )?text)?$/i.test(text)) {
    patch = { replacement: "", erase: field.original ? "smart" : field.erase, redraw: false };
    summary = "Erase selected text; preserve surrounding artwork";
  } else if (/^remove(?: (?:the )?(?:selected )?(?:text )?box)?$/i.test(text)) {
    remove = true;
    summary = field.original
      ? "Remove editable box and restore original template content"
      : "Remove user-added text box";
  } else if (
    (match = text.match(/^move\s+(left|right|up|down)\s+([0-9]+(?:\.[0-9]+)?)\s*(px|pixels|%)?$/i))
  ) {
    const direction = (match[1] ?? "").toLowerCase();
    const horizontal = direction === "left" || direction === "right";
    const amount =
      Number(match[2]) * (match[3] === "%" ? (horizontal ? clone.width : clone.height) / 100 : 1);
    patch = horizontal
      ? { x: field.x + amount * (direction === "left" ? -1 : 1) }
      : { y: field.y + amount * (direction === "up" ? -1 : 1) };
  } else if (
    (match = text.match(
      /^move\s+to\s+([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(?:px|pixels)?$/i,
    ))
  ) {
    patch = { x: Number(match[1]), y: Number(match[2]) };
  } else if (
    (match = text.match(
      /^resize\s+to\s+([0-9]+(?:\.[0-9]+)?)\s*(?:x|×|by)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:px|pixels)?$/i,
    ))
  ) {
    patch = { w: Number(match[1]), h: Number(match[2]) };
  } else if (
    (match = text.match(/^(?:set )?font size(?: to)?\s+([0-9]+(?:\.[0-9]+)?)\s*(?:px|pixels)?$/i))
  ) {
    const size = Number(match[1]);
    if (!Number.isFinite(size) || size <= 0 || size > Math.max(clone.width, clone.height))
      throw new Error("Choose a positive font size within the page dimensions.");
    patch = { fontSize: size };
    summary = `Font size → ${size} px`;
  } else if ((match = text.match(/^align\s+(left|cent(?:er|re)|right)$/i))) {
    patch = {
      align: /^cent/i.test(match[1] ?? "")
        ? "center"
        : match[1]?.toLowerCase() === "right"
          ? "right"
          : "left",
    };
    summary = `Alignment → ${patch.align}`;
  } else {
    throw new Error(
      'Command not recognised. Try: set text to "Workshop", fill from column name, move right 20 px, resize to 300 x 50, font size 24, align center, clear text, remove box, or restore original.',
    );
  }
  // Normalize through the same boundary used by panel controls and canvas dragging.
  if (["x", "y", "w", "h"].some((key) => key in patch)) {
    const normalized = patchField(clone, id, patch).fields.find((f) => f.id === id);
    if (!normalized) throw new Error("That text box is no longer available.");
    patch = { x: normalized.x, y: normalized.y, w: normalized.w, h: normalized.h };
    summary = `Box → left ${normalized.x}, top ${normalized.y}, ${normalized.w} × ${normalized.h} px`;
  }
  return {
    id,
    image: clone.image,
    before: { ...field },
    patch,
    remove,
    summary,
    snapshot: JSON.stringify([clone.width, clone.height, clone.fields, clone.suggestions]),
    ...(duplicate ? { duplicate } : {}),
  };
}

export function instructionIsCurrent(clone: CloneSource, plan: FieldInstruction): boolean {
  const field = clone.fields.find((f) => f.id === plan.id);
  return (
    JSON.stringify([clone.width, clone.height, clone.fields, clone.suggestions]) ===
      plan.snapshot &&
    clone.image === plan.image &&
    !!field &&
    Object.keys(plan.before).every(
      (key) => field[key as keyof CloneTextField] === plan.before[key as keyof CloneTextField],
    )
  );
}

export function applyFieldInstruction(clone: CloneSource, plan: FieldInstruction): CloneSource {
  if (!instructionIsCurrent(clone, plan)) return clone;
  if (plan.duplicate) return { ...clone, fields: [...clone.fields, plan.duplicate] };
  return plan.remove ? removeField(clone, plan.id) : patchField(clone, plan.id, plan.patch);
}
