/** Input types that take typed text — only these keep the browser's own text undo. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/**
 * True when the key press belongs to a text field. Checkboxes, radios, sliders, colour pickers and
 * buttons keep focus after a click, so they must NOT swallow Ctrl+Z / Ctrl+Shift+Z.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
