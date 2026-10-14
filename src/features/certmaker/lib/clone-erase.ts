/**
 * Clone Mode "smart erase". Pure functions over raw pixel arrays (no canvas), so they are fully unit-tested.
 *
 * A flat rectangle over the old text damages the artwork around it (printed dotted lines, nearby words) and still
 * misses strokes that stick out of an imprecise box. Instead this finds the old text's OWN pixels and removes only
 * those, leaving everything else exactly as it was:
 *
 *   - ink is found as connected dark shapes inside the field's box (parts sticking out are included);
 *   - printed dotted leader lines, long rules and known static text are protected and never touched;
 *   - erased pixels are filled from the surrounding paper, not from a fixed colour.
 *
 * It only ever changes pixels near the field's own box. It never creates artwork.
 */
import { clampBox, type Box } from "./clone-geometry";
import { hex } from "./util";
import type { CloneTextField } from "./types";

export interface Pixels {
  /** RGBA, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface InkAnalysis {
  /** The part of the image that was analysed, in image pixels. */
  window: Box;
  /** One entry per window pixel: 1 = remove (replace with `fill`). */
  mask: Uint8Array;
  /** RGBA for every window pixel. Only meaningful where `mask` is 1. */
  fill: Uint8ClampedArray;
  /** Bounding box of the old text's ink, in image pixels. Null when none was found. */
  inkBox: Box | null;
  /** Typical stroke thickness of the old text, in image pixels. */
  strokePx: number;
  /** Height holding 95% of the old ink. Ignores long tails (a trailing "g") that would inflate the real size. */
  bodyH: number;
  /** Typical (dark) ink colour of the old text. */
  inkColor: [number, number, number] | null;
  /** Brightness of the paper around the text (0–255). */
  paper: number;
  /** How many separate ink shapes were selected for removal. */
  selected: number;
}

export interface InkOptions {
  /** The field's box, in image pixels. */
  box: Box;
  /** Boxes of static printed text that must never be touched. */
  protect: Box[];
  imageWidth: number;
  /**
   * Fitting mode: also take in shapes that only partly overlap the box. Used to grow a badly placed box onto the
   * real writing. Erasing itself always uses the strict rule.
   */
  loose?: boolean;
}

/** Sizes below are written for a 1170 px wide scan and scale with the image. */
const REFERENCE_WIDTH = 1170;
export const scaleOf = (imageWidth: number) => Math.max(0.5, imageWidth / REFERENCE_WIDTH);

const MIN_PAPER = 90;
const INK_DROP = 55;
const PAPER_LIKE_DROP = 12;
const FILL_PASSES = 48;
const MIN_LEADER_DOTS = 6;
const MAX_COLOR_SAMPLES = 4000;

/** The part of the image to read: the box plus room for strokes that stick out of it. */
export function windowFor(box: Box, imageWidth: number, imageHeight: number): Box {
  const s = scaleOf(imageWidth);
  const padX = Math.max(6 * s, 0.5 * box.h);
  const padY = Math.max(8 * s, 0.9 * box.h);
  const x0 = Math.max(0, Math.floor(box.x - padX));
  const y0 = Math.max(0, Math.floor(box.y - padY));
  const x1 = Math.min(imageWidth, Math.ceil(box.x + box.w + padX));
  const y1 = Math.min(imageHeight, Math.ceil(box.y + box.h + padY));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

interface Component {
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  inBox: number;
  inProtect: number;
  perimeter: number;
  pixels: number[];
  protectedShape: boolean;
}

const empty = (win: Box, n: number): InkAnalysis => ({
  window: win,
  mask: new Uint8Array(n),
  fill: new Uint8ClampedArray(n * 4),
  inkBox: null,
  strokePx: 0,
  bodyH: 0,
  inkColor: null,
  paper: 255,
  selected: 0,
});

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Grow a 0/1 mask by `r` pixels in every direction (square structuring element, two passes). */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !hit; k++)
        hit = src[y * w + k] ?? 0;
      tmp[y * w + x] = hit;
    }
  }
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !hit; k++)
        hit = tmp[k * w + x] ?? 0;
      out[y * w + x] = hit;
    }
  }
  return out;
}

/**
 * Analyse the ink of one field. `pixels` is the window returned by `windowFor`, already cut out of the image.
 */
export function analyseInk(pixels: Pixels, win: Box, o: InkOptions): InkAnalysis {
  const w = pixels.width;
  const h = pixels.height;
  const n = w * h;
  if (n === 0 || w !== win.w || h !== win.h) return empty(win, n);
  const s = scaleOf(o.imageWidth);
  const d = pixels.data;

  // brightness of every pixel, and the paper level (the 85th percentile is robust to lots of ink)
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = Math.round(
      0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0),
    );
    lum[i] = v;
    hist[v] = (hist[v] ?? 0) + 1;
  }
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v] ?? 0;
    if (acc >= n * 0.85) {
      paper = v;
      break;
    }
  }
  // dark pages (light text on dark paper) are not supported: leave them alone
  if (paper < MIN_PAPER) return { ...empty(win, n), paper };
  const threshold = paper - INK_DROP;
  const strong = new Uint8Array(n);
  for (let i = 0; i < n; i++) strong[i] = (lum[i] ?? 255) < threshold ? 1 : 0;

  // static text that must never be touched
  const protectMask = new Uint8Array(n);
  for (const p of o.protect) {
    const px0 = Math.max(0, Math.floor(p.x - win.x));
    const py0 = Math.max(0, Math.floor(p.y - win.y));
    const px1 = Math.min(w, Math.ceil(p.x + p.w - win.x));
    const py1 = Math.min(h, Math.ceil(p.y + p.h - win.y));
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) protectMask[y * w + x] = 1;
  }

  const inBoxAt = (x: number, y: number) => {
    const ix = x + win.x + 0.5;
    const iy = y + win.y + 0.5;
    return ix >= o.box.x && ix < o.box.x + o.box.w && iy >= o.box.y && iy < o.box.y + o.box.h;
  };

  // connected shapes of ink (8-neighbour)
  const label = new Int32Array(n);
  const comps: Component[] = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (!strong[start] || label[start]) continue;
    const id = comps.length + 1;
    const c: Component = {
      area: 0,
      minX: w,
      maxX: 0,
      minY: h,
      maxY: 0,
      inBox: 0,
      inProtect: 0,
      perimeter: 0,
      pixels: [],
      protectedShape: false,
    };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const p = stack[--top] as number;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.pixels.push(p);
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      if (inBoxAt(x, y)) c.inBox++;
      if (protectMask[p]) c.inProtect++;
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !strong[p - 1] ||
        !strong[p + 1] ||
        !strong[p - w] ||
        !strong[p + w]
      )
        c.perimeter++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (strong[q] && !label[q]) {
            label[q] = id;
            stack[top++] = q;
          }
        }
      }
    }
    comps.push(c);
  }

  // shapes that are part of the printed page, never of the handwriting: long rules and dotted leader lines
  const dotArea = Math.max(3, 22 * s * s);
  const dotSide = 7 * s;
  const dots: { c: Component; cy: number }[] = [];
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (bw >= 10 * bh && bw >= 40 * s)
      c.protectedShape = true; // a solid rule
    else if (c.area <= dotArea && bw <= dotSide && bh <= dotSide)
      dots.push({ c, cy: (c.minY + c.maxY) / 2 });
  }
  dots.sort((a, b) => a.cy - b.cy);
  const tol = 2.2 * s;
  let i = 0;
  while (i < dots.length) {
    let j = i + 1;
    let sum = (dots[i] as { cy: number }).cy;
    while (j < dots.length && Math.abs((dots[j] as { cy: number }).cy - sum / (j - i)) <= tol) {
      sum += (dots[j] as { cy: number }).cy;
      j++;
    }
    if (j - i >= MIN_LEADER_DOTS)
      for (let k = i; k < j; k++) (dots[k] as { c: Component }).c.protectedShape = true; // a dotted leader line
    i = j;
  }

  // choose the shapes that belong to the old text
  const reach = Math.min(0.6 * o.box.h, 12 * s);
  const selectedComps: Component[] = [];
  for (const c of comps) {
    if (c.protectedShape || c.inProtect / c.area >= 0.5) continue;
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    const boxFrac = c.inBox / c.area;
    const centreIn = inBoxAt(Math.round(cx), Math.round(cy));
    if (o.loose) {
      // fitting: also take writing that lies within the box's width and only a little above or below it,
      // which is what a box placed a few pixels off looks like
      const compW = c.maxX - c.minX + 1;
      const overlapX =
        Math.min(c.maxX + win.x + 1, o.box.x + o.box.w) - Math.max(c.minX + win.x, o.box.x);
      const nearY =
        cy + win.y + 0.5 >= o.box.y - reach && cy + win.y + 0.5 <= o.box.y + o.box.h + reach;
      if (boxFrac >= 0.25 || centreIn || (overlapX >= 0.5 * compW && nearY)) selectedComps.push(c);
    } else if (boxFrac >= 0.5 || centreIn) selectedComps.push(c);
  }
  if (!selectedComps.length) return { ...empty(win, n), paper };

  const sel = new Uint8Array(n);
  let ix0 = Infinity,
    iy0 = Infinity,
    ix1 = -Infinity,
    iy1 = -Infinity;
  for (const c of selectedComps) {
    for (const p of c.pixels) sel[p] = 1;
    ix0 = Math.min(ix0, c.minX);
    iy0 = Math.min(iy0, c.minY);
    ix1 = Math.max(ix1, c.maxX);
    iy1 = Math.max(iy1, c.maxY);
  }

  // remove the shapes plus their soft edge, but never protected shapes or static text
  const grown = dilate(sel, w, h, Math.max(1, Math.round(1.6 * s)));
  const keep = new Uint8Array(n);
  for (const c of comps) if (c.protectedShape) for (const p of c.pixels) keep[p] = 1;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = grown[p] && !protectMask[p] && !keep[p] ? 1 : 0;

  // fill the holes from the surrounding paper: spread colour inward from paper-like neighbours
  const fill = new Uint8ClampedArray(n * 4);
  const known = new Uint8Array(n);
  const paperSamples: number[][] = [[], [], []];
  for (let p = 0; p < n; p++) {
    if (mask[p] || (lum[p] ?? 0) < paper - PAPER_LIKE_DROP) continue;
    known[p] = 1;
    fill[p * 4] = d[p * 4] ?? 0;
    fill[p * 4 + 1] = d[p * 4 + 1] ?? 0;
    fill[p * 4 + 2] = d[p * 4 + 2] ?? 0;
    fill[p * 4 + 3] = 255;
    if (p % 7 === 0) {
      (paperSamples[0] as number[]).push(d[p * 4] ?? 0);
      (paperSamples[1] as number[]).push(d[p * 4 + 1] ?? 0);
      (paperSamples[2] as number[]).push(d[p * 4 + 2] ?? 0);
    }
  }
  for (let pass = 0; pass < FILL_PASSES; pass++) {
    const newly: number[] = [];
    const colours: number[] = [];
    for (let p = 0; p < n; p++) {
      if (!mask[p] || known[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      let r = 0,
        g = 0,
        b = 0,
        cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!known[q]) continue;
          r += fill[q * 4] ?? 0;
          g += fill[q * 4 + 1] ?? 0;
          b += fill[q * 4 + 2] ?? 0;
          cnt++;
        }
      }
      if (cnt) {
        newly.push(p);
        colours.push(r / cnt, g / cnt, b / cnt);
      }
    }
    if (!newly.length) break;
    newly.forEach((p, k) => {
      fill[p * 4] = colours[k * 3] ?? 255;
      fill[p * 4 + 1] = colours[k * 3 + 1] ?? 255;
      fill[p * 4 + 2] = colours[k * 3 + 2] ?? 255;
      fill[p * 4 + 3] = 255;
      known[p] = 1;
    });
  }
  const fallback = [
    median(paperSamples[0] as number[]) || 255,
    median(paperSamples[1] as number[]) || 255,
    median(paperSamples[2] as number[]) || 255,
  ];
  for (let p = 0; p < n; p++) {
    if (mask[p] && !known[p]) {
      fill[p * 4] = fallback[0] ?? 255;
      fill[p * 4 + 1] = fallback[1] ?? 255;
      fill[p * 4 + 2] = fallback[2] ?? 255;
      fill[p * 4 + 3] = 255;
    }
  }

  // what the old text looked like: stroke thickness (weighted by size) and its dark ink colour
  const strokes = selectedComps
    .map((c) => ({ v: (2 * c.area) / Math.max(1, c.perimeter), a: c.area }))
    .sort((a, b) => a.v - b.v);
  const half = strokes.reduce((t, x) => t + x.a, 0) / 2;
  let run = 0;
  let strokePx = strokes[strokes.length - 1]?.v ?? 0;
  for (const x of strokes) {
    run += x.a;
    if (run >= half) {
      strokePx = x.v;
      break;
    }
  }
  const rowMass = new Float64Array(h);
  for (const c of selectedComps)
    for (const p of c.pixels) rowMass[Math.floor(p / w)] = (rowMass[Math.floor(p / w)] ?? 0) + 1;
  const totalMass = selectedComps.reduce((t, c) => t + c.area, 0);
  let lo = 0,
    hi = h - 1,
    seen = 0;
  for (let y = 0; y < h; y++) {
    seen += rowMass[y] ?? 0;
    if (seen >= totalMass * 0.025) {
      lo = y;
      break;
    }
  }
  seen = 0;
  for (let y = h - 1; y >= 0; y--) {
    seen += rowMass[y] ?? 0;
    if (seen >= totalMass * 0.025) {
      hi = y;
      break;
    }
  }
  const bodyH = Math.max(1, hi - lo + 1);
  const core: number[] = [];
  const coreLimit = paper - 110;
  const stride = Math.max(
    1,
    Math.floor(selectedComps.reduce((t, c) => t + c.area, 0) / MAX_COLOR_SAMPLES),
  );
  let k = 0;
  const rs: number[] = [],
    gs: number[] = [],
    bs: number[] = [];
  for (const c of selectedComps)
    for (const p of c.pixels) {
      if (k++ % stride || (lum[p] ?? 255) >= coreLimit) continue;
      rs.push(d[p * 4] ?? 0);
      gs.push(d[p * 4 + 1] ?? 0);
      bs.push(d[p * 4 + 2] ?? 0);
      core.push(p);
    }
  const inkColor: [number, number, number] | null =
    core.length >= 20 ? [median(rs), median(gs), median(bs)] : null;

  return {
    window: win,
    mask,
    fill,
    inkBox: { x: win.x + ix0, y: win.y + iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1 },
    strokePx,
    bodyH,
    inkColor,
    paper,
    selected: selectedComps.length,
  };
}

/* ---------- fitting a field to its writing ---------- */

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Settings that make a field fit the writing it replaces: a box that covers all of the old ink (grown only a limited
 * amount, so it cannot swallow neighbouring words), a text size and ink colour taken from it, and enough stroke weight
 * that thin fonts do not look faint next to heavy handwriting.
 * Returns null when no old text was found in the box.
 */
export function fitToInk(
  a: InkAnalysis,
  f: Pick<CloneTextField, "x" | "y" | "w" | "h" | "fontSize">,
  image: { width: number; height: number },
): Partial<CloneTextField> | null {
  if (!a.inkBox || a.selected === 0) return null;
  const s = scaleOf(image.width);
  const ink = a.inkBox;
  const margin = Math.max(2 * s, 0.1 * ink.h);
  const maxDx = Math.max(12 * s, 0.8 * f.h);
  const maxDy = 1.2 * f.h;
  const x0 = Math.max(Math.min(f.x, ink.x - margin), f.x - maxDx);
  const y0 = Math.max(Math.min(f.y, ink.y - margin), f.y - maxDy);
  const x1 = Math.min(Math.max(f.x + f.w, ink.x + ink.w + margin), f.x + f.w + maxDx);
  const y1 = Math.min(Math.max(f.y + f.h, ink.y + ink.h + margin), f.y + f.h + maxDy);
  const box = clampBox(
    { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    { w: image.width, h: image.height },
  );
  // text size from the body of the old writing (not its longest tail); never smaller than the size already known
  const fontSize = round1(Math.min(Math.max(f.fontSize, 1.1 * a.bodyH), 1.4 * box.h));
  // the stroke thickness to match; the painter only adds thickness if the chosen font is thinner than this
  const weight = a.strokePx >= 1.8 * s ? round1(Math.min(a.strokePx, 8 * s)) : 0;
  const out: Partial<CloneTextField> = { ...box, fontSize, weight };
  if (a.inkColor) out.color = hex(a.inkColor);
  return out;
}

/**
 * Colour of the paper just outside `box` (the median of a thin ring around it, per channel). A flat patch of this
 * colour makes the erased area disappear into the page. `px` covers the box plus its ring, and `box` is relative
 * to `px`. Null when there is not enough paper around the box to judge.
 */
export function ringColor(px: Pixels, box: Box, ring: number): [number, number, number] | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const x0 = box.x - ring;
  const y0 = box.y - ring;
  const x1 = box.x + box.w + ring;
  const y1 = box.y + box.h + ring;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(px.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(px.width, Math.ceil(x1)); x++) {
      if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) continue;
      const i = (y * px.width + x) * 4;
      if (px.data[i + 3]! < 128) continue;
      r.push(px.data[i]!);
      g.push(px.data[i + 1]!);
      b.push(px.data[i + 2]!);
    }
  }
  if (r.length < 12) return null;
  const mid = (v: number[]) => v.sort((a, c) => a - c)[Math.floor(v.length / 2)]!;
  return [mid(r), mid(g), mid(b)];
}
