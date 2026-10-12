import { authorizedText } from "./editing/SelectionManager";
import { loadCloneImage } from "./clone-image";
import { analyseInk, fitToInk, windowFor, type InkAnalysis, type Pixels } from "./clone-erase";
import type { Box } from "./clone-geometry";
import type { CloneSource, CloneTextField } from "./types";

/** The replacement pixels for one field: opaque only where old writing was removed, transparent everywhere else. */
export interface ErasePatch {
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
}

const MAX_CACHED = 60;
const cache = new WeakMap<HTMLImageElement, Map<string, Promise<ErasePatch>>>();

/** Static printed text that must never be erased: everything that was found but is not an editable field. */
export const protectBoxes = (clone: CloneSource, excludeId?: string): Box[] =>
  [...clone.suggestions, ...clone.fields.filter((f) => !authorizedText(f) && !f.deleted)]
    .filter((f) => f.id !== excludeId)
    .map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h }));

/** Read a window of the original at its own resolution (no scaling, so no resampling). */
function readWindow(img: HTMLImageElement, win: Box): Pixels {
  const c = document.createElement("canvas");
  c.width = win.w;
  c.height = win.h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas rendering is unavailable.");
  ctx.drawImage(img, win.x, win.y, win.w, win.h, 0, 0, win.w, win.h);
  const data = ctx.getImageData(0, 0, win.w, win.h);
  return { data: data.data, width: win.w, height: win.h };
}

function analyse(img: HTMLImageElement, box: Box, protect: Box[], loose: boolean): InkAnalysis {
  const win = windowFor(box, img.naturalWidth, img.naturalHeight);
  if (win.w === 0 || win.h === 0)
    return analyseInk({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, win, {
      box,
      protect,
      imageWidth: img.naturalWidth,
      loose,
    });
  return analyseInk(readWindow(img, win), win, {
    box,
    protect,
    imageWidth: img.naturalWidth,
    loose,
  });
}

function toPatch(a: InkAnalysis): ErasePatch {
  const { window: win, mask, fill } = a;
  const c = document.createElement("canvas");
  c.width = Math.max(1, win.w);
  c.height = Math.max(1, win.h);
  const ctx = c.getContext("2d");
  if (ctx && win.w > 0 && win.h > 0) {
    const out = ctx.createImageData(win.w, win.h);
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      out.data[p * 4] = fill[p * 4] ?? 255;
      out.data[p * 4 + 1] = fill[p * 4 + 1] ?? 255;
      out.data[p * 4 + 2] = fill[p * 4 + 2] ?? 255;
      out.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }
  return { x: win.x, y: win.y, canvas: c };
}

/** The smart-erase patch for a field. Cached per image and per box, so dragging stays responsive. */
export function erasePatchFor(
  img: HTMLImageElement,
  f: CloneTextField,
  protect: Box[],
): Promise<ErasePatch> {
  const source = f.sourceBox ?? f;
  let perImage = cache.get(img);
  if (!perImage) {
    perImage = new Map();
    cache.set(img, perImage);
  }
  const key = [
    source.x,
    source.y,
    source.w,
    source.h,
    ...protect.flatMap((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.w), Math.round(p.h)]),
  ].join("|");
  const hit = perImage.get(key);
  if (hit) return hit;
  const made = Promise.resolve().then(() =>
    toPatch(analyse(img, { x: source.x, y: source.y, w: source.w, h: source.h }, protect, false)),
  );
  perImage.set(key, made);
  if (perImage.size > MAX_CACHED) perImage.delete(perImage.keys().next().value as string);
  return made;
}

/**
 * Fit fields to the writing they replace: box, text size, ink colour and stroke weight.
 * Pass `only` to fit a single field. Fields where no old text is found are left as they were.
 */
export async function fitFieldsToInk(clone: CloneSource, only?: string): Promise<CloneSource> {
  const img = await loadCloneImage(clone.image);
  const protect = protectBoxes(clone);
  const size = { width: img.naturalWidth, height: img.naturalHeight };
  const fields = clone.fields.map((f) => {
    if ((only && f.id !== only) || !authorizedText(f)) return f;
    if (!f.original.trim()) return f; // a box added by hand has no old writing to fit
    const fit = fitToInk(analyse(img, { x: f.x, y: f.y, w: f.w, h: f.h }, protect, true), f, size);
    return fit ? { ...f, ...fit } : f;
  });
  return { ...clone, fields };
}
