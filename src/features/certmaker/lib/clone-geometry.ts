/** Pure geometry helpers for Clone Mode. All units are pixels of the original image. */
import { clamp } from "./util";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const MIN_BOX = 8;

const round = (n: number) => Math.round(n * 10) / 10;

/** Keep a box inside the image and at least MIN_BOX in each direction. */
export function clampBox(b: Box, bounds: { w: number; h: number }): Box {
  const w = clamp(b.w, MIN_BOX, bounds.w);
  const h = clamp(b.h, MIN_BOX, bounds.h);
  return {
    x: round(clamp(b.x, 0, bounds.w - w)),
    y: round(clamp(b.y, 0, bounds.h - h)),
    w: round(w),
    h: round(h),
  };
}

/** Result of dragging a box (or one of its handles) by dx, dy from where the drag started. */
export function dragBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
): Box {
  if (handle === "move") return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, bounds);
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_BOX);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_BOX, bounds.w);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_BOX);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_BOX, bounds.h);
  return { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) };
}

export function nudgeBox(b: Box, dx: number, dy: number, bounds: { w: number; h: number }): Box {
  return clampBox({ ...b, x: b.x + dx, y: b.y + dy }, bounds);
}

/** True when the box is centred on the page (names and course titles usually are). */
export function isCentered(b: Box, pageW: number): boolean {
  return Math.abs(b.x + b.w / 2 - pageW / 2) <= pageW * 0.04 && b.w <= pageW * 0.85;
}

const STANDARD_PAGES: [number, number][] = [
  [297, 210],
  [210, 297],
  [279.4, 215.9],
  [215.9, 279.4],
];

/**
 * Physical page size for an uploaded image. Snaps to A4 / US Letter when the aspect ratio matches,
 * otherwise treats the pixels as 300 dpi. The artwork is never stretched: only the page it sits on is chosen.
 */
export function clonePageMm(width: number, height: number): [number, number] {
  const aspect = width / height;
  for (const [w, h] of STANDARD_PAGES) {
    if (Math.abs(aspect - w / h) / (w / h) < 0.02) return [w, h];
  }
  return [round((width / 300) * 25.4), round((height / 300) * 25.4)];
}
