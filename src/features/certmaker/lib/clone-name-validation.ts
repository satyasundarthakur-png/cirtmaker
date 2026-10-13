import type { Box } from "./clone-geometry";

/** Words that mean "this is certificate wording", never a person's name. */
const BODY_WORDS = [
  "bearing",
  "registration",
  "certificate",
  "certify",
  "certifies",
  "certified",
  "course",
  "training",
  "trained",
  "conducted",
  "awarded",
  "completed",
  "completing",
  "completion",
  "successfully",
  "participation",
  "participated",
  "hereby",
  "enrolled",
  "attended",
  "having",
  "has",
  "number",
];
const BODY_RE = new RegExp(`\\b(?:${BODY_WORDS.join("|")})\\b`, "i");
export const MAX_NAME_WORDS = 6;

/** Hard rules. A name that breaks one is rejected outright. Returns the reason, or null if it passes. */
export function candidateNameIssue(
  text: string,
  box: Box,
  page: { w: number; h: number },
): string | null {
  const value = text.trim();
  if (!value || /[\r\n]/.test(value)) return "empty or multiline name";
  if (value.length > 80 || value.split(/\s+/).length > MAX_NAME_WORDS)
    return `more than ${MAX_NAME_WORDS} words (paragraph-like)`;
  if (BODY_RE.test(value)) return "certificate body wording";
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

/** Size/shape-only check for a name the user picked by hand: their choice overrides the wording rules. */
export function manualNameIssue(box: Box, page: { w: number; h: number }): string | null {
  if (box.w > page.w * 0.85 || box.h > page.h * 0.1 || box.w * box.h > page.w * page.h * 0.06)
    return "That region is paragraph-sized. Pick the single line that holds the name.";
  return null;
}

export const median = (values: number[]): number => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

/**
 * 0–100 likelihood that a region that already passed the hard rules is the recipient's name.
 * Soft evidence only: 1–4 words, horizontally centred, taller text than the body, no digits or colons.
 */
export function nameScore(
  text: string,
  box: Box,
  page: { w: number; h: number },
  bodyHeight: number,
): number {
  const value = text.trim();
  const words = value.split(/\s+/).length;
  let score = 40;
  score += words >= 2 && words <= 4 ? 20 : words === 1 ? 8 : 10;
  const off = Math.abs(box.x + box.w / 2 - page.w / 2) / page.w;
  score += off < 0.05 ? 20 : off < 0.15 ? 12 : off < 0.3 ? 0 : -15;
  if (bodyHeight > 0) {
    const ratio = box.h / bodyHeight;
    score += ratio >= 1.3 ? 20 : ratio >= 1 ? 8 : ratio >= 0.8 ? -5 : -20;
  }
  if (/\d/.test(value)) score -= 30;
  if (/[:;@/]/.test(value)) score -= 20;
  return Math.max(1, Math.min(100, Math.round(score)));
}

/** Below this a text line is not promoted to Candidate Name automatically. */
export const MIN_PROMOTE_SCORE = 60;

/** Opt-in console diagnostics: sessionStorage certmaker:debug-detection = 1. Never persisted or sent. */
export function debugDetectionEnabled(): boolean {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("certmaker:debug-detection") === "1"
    );
  } catch {
    return false;
  }
}

export function setDebugDetection(on: boolean) {
  try {
    if (on) sessionStorage.setItem("certmaker:debug-detection", "1");
    else sessionStorage.removeItem("certmaker:debug-detection");
  } catch {
    /* Storage may be blocked by the browser. */
  }
}

export function logDetection(entry: {
  text: string;
  kind: string;
  box: Box;
  confidence: number;
  stage: string;
  reason?: string | undefined;
}) {
  if (!debugDetectionEnabled()) return;
  console.debug("[certmaker:detection]", {
    detectedText: entry.text,
    fieldType: entry.kind,
    ...entry.box,
    confidence: entry.confidence,
    stage: entry.stage,
    reason: entry.reason ?? "accepted",
  });
}

/** The exact JSON text the model returned, before any validation. */
export function logRawDetection(provider: string, raw: string) {
  if (!debugDetectionEnabled()) return;
  console.debug(`[certmaker:detection] raw ${provider} JSON`, raw);
}
