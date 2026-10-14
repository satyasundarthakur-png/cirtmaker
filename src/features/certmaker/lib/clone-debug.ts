import type { CloneSource, CloneTextField } from "./types";

export type DetectView = "off" | "debug" | "pickName";

export interface DetectionRow {
  id: string;
  text: string;
  /** Type the field has now. */
  kind: string;
  /** Type the detector first reported (before validation). */
  rawKind: string;
  box: { x: number; y: number; w: number; h: number };
  /** 0–100, or null when the field did not come from a detector. */
  confidence: number | null;
  status: "field" | "other" | "rejected";
  reason: string;
  source: string;
}

const rowOf = (f: CloneTextField, listed: "field" | "other"): DetectionRow => {
  const d = f.detection;
  const rejected = !!d && !d.accepted && d.rawKind === "name";
  return {
    id: f.id,
    text: f.original || f.replacement,
    kind: listed === "other" ? "other" : f.kind,
    rawKind: d?.rawKind ?? f.kind,
    box: {
      x: Math.round(f.x),
      y: Math.round(f.y),
      w: Math.round(f.w),
      h: Math.round(f.h),
    },
    confidence: d ? d.confidence : null,
    status: rejected ? "rejected" : listed,
    reason: d?.reason ?? "",
    source: d?.source ?? "ocr/pdf",
  };
};

/** Every region the detector produced, accepted or not, for the debug table and overlay. */
export function detectionRows(clone: CloneSource): DetectionRow[] {
  return [
    ...clone.fields
      .filter((f) => !f.deleted && f.detection?.rawKind !== "eraser")
      .map((f) => rowOf(f, "field")),
    ...clone.suggestions.map((f) => rowOf(f, "other")),
  ];
}
