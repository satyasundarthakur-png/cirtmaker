import type { Box } from "./clone-geometry";

/** Conservative automatic name detection. Ambiguous text remains protected for manual selection. */
export function candidateNameIssue(
  text: string,
  box: Box,
  page: { w: number; h: number },
): string | null {
  const value = text.trim();
  if (!value || /[\r\n]/.test(value)) return "empty or multiline name";
  if (value.length > 100 || value.split(/\s+/).length > 8) return "paragraph-like name text";
  if (
    /\b(?:bearing|registration|certificate|successfully|completed|completing|completion|participation|participated|hereby|awarded|certify|certifies|enrolled|attended|having|has|number)\b/i.test(
      value,
    )
  )
    return "certificate body wording";
  if (
    ![box.x, box.y, box.w, box.h, page.w, page.h].every(Number.isFinite) ||
    page.w <= 0 ||
    page.h <= 0 ||
    box.w <= 0 ||
    box.h <= 0
  )
    return "invalid name geometry";
  if (box.x < 0 || box.y < 0 || box.x + box.w > page.w + 1 || box.y + box.h > page.h + 1)
    return "name outside page";
  if (box.w > page.w * 0.85 || box.h > page.h * 0.1 || box.w * box.h > page.w * page.h * 0.06)
    return "paragraph-sized name rectangle";
  return null;
}

/** Opt-in console diagnostics: sessionStorage certmaker:debug-detection = 1. Never persisted or sent. */
export function logDetection(entry: {
  text: string;
  kind: string;
  box: Box;
  confidence: number;
  stage: string;
  reason?: string | undefined;
}) {
  try {
    if (
      typeof sessionStorage === "undefined" ||
      sessionStorage.getItem("certmaker:debug-detection") !== "1"
    )
      return;
    console.debug("[certmaker:detection]", {
      detectedText: entry.text,
      fieldType: entry.kind,
      ...entry.box,
      confidence: entry.confidence,
      stage: entry.stage,
      reason: entry.reason ?? "accepted",
    });
  } catch {
    /* Storage may be blocked by the browser. */
  }
}
