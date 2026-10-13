import type { CloneTextField } from "./types";

/** Shared pure helpers (previously copy-pasted across the clone/reference/editing modules). */

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `[r, g, b]` (0–255, any rounding) → `#rrggbb`. */
export const hex = (rgb: ArrayLike<number>) =>
  "#" +
  Array.from(rgb, (v) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0"),
  ).join("");

/** Reading order: top to bottom, then left to right. */
export const byPosition = (a: CloneTextField, b: CloneTextField) => a.y - b.y || a.x - b.x;
