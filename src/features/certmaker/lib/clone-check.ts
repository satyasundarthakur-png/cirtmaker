import type { CloneSource } from "./types";

/** Structural checks only: does not claim to verify spelling or pixel similarity. */
export function checkClone(clone: CloneSource): string[] {
  const issues: string[] = [];
  for (const f of clone.fields) {
    if (
      ![f.x, f.y, f.w, f.h, f.fontSize].every(Number.isFinite) ||
      f.w <= 0 ||
      f.h <= 0 ||
      f.fontSize <= 0
    )
      issues.push(`${f.label}: invalid box or font size.`);
    if (f.x < 0 || f.y < 0 || f.x + f.w > clone.width || f.y + f.h > clone.height)
      issues.push(`${f.label}: box extends beyond the page.`);
    if (f.original && f.replacement !== f.original && f.erase === "none")
      issues.push(`${f.label}: original text may show behind the replacement.`);
    for (const other of clone.fields) {
      if (other.id <= f.id) continue;
      if (
        f.x < other.x + other.w &&
        f.x + f.w > other.x &&
        f.y < other.y + other.h &&
        f.y + f.h > other.y
      )
        issues.push(`${f.label} (${f.id}) overlaps ${other.label} (${other.id}).`);
    }
  }
  return issues;
}
