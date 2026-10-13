import { fontCss, loadCloneImage, paintCloneFields } from "../clone";
import type { CloneSource, CloneTextField } from "../types";
import type { LayerStyle, StyleMatch } from "./types";
import { AVAILABLE_FONTS } from "./CommandParser";

export interface TypographyFingerprint {
  version: 1;
  width: number;
  height: number;
  inkBounds: { x: number; y: number; w: number; h: number };
  mask: number[];
  horizontalProfile: number[];
  verticalProfile: number[];
  baselineShape: number[];
  characteristics: {
    aspect: number;
    strokeContrast: number;
    edgeOrientation: number[];
    componentCount: number;
    capHeightRatio: number;
  };
  strokeWeight: number;
  slantAngle: number;
  letterSpacing: number | null;
  wordSpacing: number | null;
  lineHeight: number | null;
  color: string;
  foregroundColor: string | null;
  opacity: number | null;
  visualDensity: number;
  background: [number, number, number];
  quality: number;
  uncertainties: string[];
}
export interface FingerprintScore {
  total: number;
  shape: number;
  stroke: number;
  slant: number;
  spacing: number;
  baseline: number;
  density: number;
  color: number;
  placement: number;
}
export interface TypographyMatchReport {
  fingerprint: TypographyFingerprint;
  beforeScore: number;
  finalScore: number;
  refinementPasses: number;
  candidatesEvaluated: number;
  components: FingerprintScore;
  uncertainties: string[];
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / Math.max(1, v.length);
const quantile = (v: number[], q: number) => {
  if (!v.length) return 0;
  const sorted = [...v].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position),
    hi = Math.ceil(position);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (position - lo);
};
const hex = (rgb: number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
function runs(values: number[], test: (n: number) => boolean) {
  const out: { start: number; end: number }[] = [];
  let start = -1;
  values.forEach((value, i) => {
    if (test(value) && start < 0) start = i;
    if (!test(value) && start >= 0) {
      out.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, end: values.length - 1 });
  return out;
}
function profile(values: number[], bins: number): number[] {
  const result = Array<number>(bins).fill(0),
    counts = Array<number>(bins).fill(0);
  values.forEach((v, i) => {
    const b = Math.min(bins - 1, Math.floor((i / Math.max(1, values.length)) * bins));
    result[b]! += v;
    counts[b]!++;
  });
  const scale = Math.max(0.001, ...values);
  return result.map((v, i) => v / Math.max(1, counts[i]!) / scale);
}

/** Pure, bounded pixel analysis. Features come from pixels, not a font-family label. */
export function fingerprintPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  known?: { color?: string; opacity?: number },
): TypographyFingerprint {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    data.length !== width * height * 4 ||
    width * height > 131072
  )
    throw new Error("Fingerprint crop must contain 2–131072 valid pixels.");
  const border: number[][] = [[], [], []];
  const borderAlpha: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        const p = (y * width + x) * 4;
        borderAlpha.push(data[p + 3]! / 255);
        for (let c = 0; c < 3; c++) border[c]!.push(data[p + c]!);
      }
  const background = (
    quantile(borderAlpha, 0.5) < 0.95 ? [255, 255, 255] : border.map((v) => quantile(v, 0.5))
  ) as [number, number, number];
  const distances = new Float32Array(width * height),
    alphas = new Float32Array(width * height);
  const contrast: number[] = [];
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const alpha = data[i + 3]! / 255;
    alphas[p] = alpha;
    const diff =
      Math.hypot(
        data[i]! - background[0],
        data[i + 1]! - background[1],
        data[i + 2]! - background[2],
      ) * alpha;
    distances[p] = diff;
    if (diff > 5) contrast.push(diff);
  }
  const peak = quantile(contrast, 0.95);
  if (peak < 8)
    throw new Error(
      "Reference has insufficient visible text contrast. Use a tighter text-only selection.",
    );
  const threshold = Math.max(8, peak * 0.22),
    ink = new Uint8Array(width * height),
    soft = new Float32Array(width * height);
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  const foregroundPixels: number[][] = [[], [], []];
  const colorPixels: number[][] = [[], [], []],
    alphaPixels: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      soft[p] = clamp(distances[p]! / peak, 0, 1);
      if (distances[p]! >= threshold) {
        ink[p] = 1;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        if (distances[p]! >= peak * 0.85) {
          for (let c = 0; c < 3; c++) {
            colorPixels[c]!.push(data[p * 4 + c]! * alphas[p]! + background[c]! * (1 - alphas[p]!));
            foregroundPixels[c]!.push(data[p * 4 + c]!);
          }
          alphaPixels.push(alphas[p]!);
        }
      }
    }
  if (right < left || bottom < top) throw new Error("No usable text ink in selected reference.");
  const w = right - left + 1,
    h = bottom - top + 1,
    mask = Array<number>(128 * 48).fill(0),
    counts = Array<number>(128 * 48).fill(0);
  const columns = Array<number>(w).fill(0),
    rows = Array<number>(h).fill(0),
    baseline = Array<number>(16).fill(0),
    baselineSamples: Array<number[]> = Array.from({ length: 16 }, () => []);
  const points: [number, number][] = [];
  let inkCount = 0;
  const edges = Array<number>(8).fill(0);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const p = y * width + x,
        bx = Math.min(127, Math.floor(((x - left) / w) * 128)),
        by = Math.min(47, Math.floor(((y - top) / h) * 48)),
        bin = by * 128 + bx;
      mask[bin]! += soft[p]!;
      counts[bin]!++;
      if (ink[p]) {
        columns[x - left]!++;
        rows[y - top]!++;
        inkCount++;
        points.push([x - left, y - top]);
        baselineSamples[Math.min(15, Math.floor(((x - left) / w) * 16))]!.push(y - top);
      }
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const gx = soft[p + 1]! - soft[p - 1]!,
          gy = soft[p + width]! - soft[p - width]!;
        const magnitude = Math.hypot(gx, gy);
        if (magnitude > 0.25) {
          const b = Math.min(
            7,
            Math.floor((((Math.atan2(gy, gx) + Math.PI) % Math.PI) / Math.PI) * 8),
          );
          edges[b]! += magnitude;
        }
      }
    }
  for (let i = 0; i < baseline.length; i++)
    baseline[i] = baselineSamples[i]!.length ? quantile(baselineSamples[i]!, 0.92) / h : 0;
  // Chamfer distance on binary ink; ridge diameters estimate normalized stroke weight.
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? 999 : 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!ink[p]) continue;
      d[p] = Math.min(
        d[p]!,
        x ? d[p - 1]! + 1 : 1,
        y ? d[p - width]! + 1 : 1,
        x && y ? d[p - width - 1]! + 1.414 : 999,
      );
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (!ink[p]) continue;
      d[p] = Math.min(
        d[p]!,
        x + 1 < width ? d[p + 1]! + 1 : 1,
        y + 1 < height ? d[p + width]! + 1 : 1,
        x + 1 < width && y + 1 < height ? d[p + width + 1]! + 1.414 : 999,
      );
    }
  const ridges: number[] = [];
  for (let y = top + 1; y < bottom; y++)
    for (let x = left + 1; x < right; x++) {
      const p = y * width + x;
      if (ink[p] && d[p]! >= d[p - 1]! && d[p]! >= d[p + 1]!) ridges.push(2 * d[p]! - 1);
    }
  // Find shear with strongest vertical projection. No generic script-font substitution.
  let slant = 0,
    bestSharpness = -Infinity;
  for (let angle = -24; angle <= 24; angle += 2) {
    const tangent = Math.tan((angle * Math.PI) / 180),
      projection = Array<number>(w + h).fill(0);
    for (
      let pointIndex = 0;
      pointIndex < points.length;
      pointIndex += Math.max(1, Math.floor(points.length / 512))
    ) {
      const [px, py] = points[pointIndex]!;
      const sx = Math.round(px + tangent * (py - h / 2) + h / 2);
      if (sx >= 0 && sx < projection.length) projection[sx]!++;
    }
    const sharpness = projection.reduce((s, v) => s + v * v, 0);
    if (sharpness > bestSharpness) {
      bestSharpness = sharpness;
      slant = angle;
    }
  }
  const empty = runs(columns, (n) => n === 0)
    .filter((r) => r.start > 0 && r.end < w - 1)
    .map((r) => r.end - r.start + 1);
  const smallGap = quantile(empty, 0.3),
    largeGap = quantile(empty, 0.85);
  const lineRuns: { start: number; end: number }[] = [];
  for (const band of runs(rows, (n) => n > 0)) {
    const last = lineRuns.at(-1);
    if (last && band.start - last.end <= Math.max(3, quantile(ridges, 0.5) * 1.5))
      last.end = band.end;
    else lineRuns.push({ ...band });
  }
  const lineCenters = lineRuns.map((r) => (r.start + r.end) / 2),
    lineGaps = lineCenters.slice(1).map((v, i) => v - lineCenters[i]!);
  const uncertainties = [
    "Raster foreground colour and opacity are not uniquely separable on opaque paper.",
    "Connected glyphs can make letter/word spacing ambiguous.",
    "Baseline curves include descenders; unsupported curved baselines cannot be recreated by straight-font controls.",
  ];
  const hasTransparency = alphaPixels.some((a) => a < 0.98);
  const opacity = known?.opacity ?? (hasTransparency ? quantile(alphaPixels, 0.8) : null);
  const backgroundVariation = mean(border.map((v) => quantile(v, 0.9) - quantile(v, 0.1)));
  const quality = clamp(
    1 - backgroundVariation / 100 - (inkCount < 20 ? 0.4 : 0) - (peak < 25 ? 0.2 : 0),
    0.2,
    1,
  );
  return {
    version: 1,
    width,
    height,
    inkBounds: { x: left, y: top, w, h },
    mask: mask.map((v, i) => v / Math.max(1, counts[i]!)),
    horizontalProfile: profile(rows, 32),
    verticalProfile: profile(columns, 64),
    baselineShape: baseline,
    characteristics: {
      aspect: w / h,
      strokeContrast: quantile(ridges, 0.9) / Math.max(0.01, quantile(ridges, 0.3)),
      edgeOrientation: edges.map(
        (v) =>
          v /
          Math.max(
            0.001,
            edges.reduce((s, n) => s + n, 0),
          ),
      ),
      componentCount: runs(columns, (n) => n > 0).length,
      capHeightRatio: quantile(rows, 0.75) / Math.max(1, w),
    },
    strokeWeight: quantile(ridges, 0.5) / h,
    slantAngle: slant,
    letterSpacing: empty.length ? smallGap / h : null,
    wordSpacing: largeGap > smallGap * 1.8 ? largeGap / h : null,
    lineHeight: lineGaps.length
      ? quantile(lineGaps, 0.5) /
        Math.max(
          1,
          quantile(
            lineRuns.map((r) => r.end - r.start + 1),
            0.5,
          ) / 0.78,
        )
      : null,
    color: known?.color ?? hex(colorPixels.map((v) => quantile(v, 0.5))),
    foregroundColor: hasTransparency ? hex(foregroundPixels.map((v) => quantile(v, 0.5))) : null,
    opacity,
    visualDensity: inkCount / (w * h),
    background,
    quality,
    uncertainties,
  };
}
function vectorScore(a: number[], b: number[]) {
  return clamp(1 - mean(a.map((v, i) => Math.abs(v - (b[i] ?? 0)))), 0, 1);
}
const ratioScore = (a: number, b: number) =>
  Math.exp(-Math.abs(a - b) / Math.max(0.01, Math.abs(a), Math.abs(b)));
const parseColor = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
export function compareFingerprints(
  a: TypographyFingerprint,
  b: TypographyFingerprint,
): FingerprintScore {
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.mask.length; i++) {
    dot += a.mask[i]! * b.mask[i]!;
    aa += a.mask[i]! ** 2;
    bb += b.mask[i]! ** 2;
  }
  const shape =
    (0.7 * dot) / Math.max(0.001, Math.sqrt(aa * bb)) +
    0.3 * vectorScore(a.characteristics.edgeOrientation, b.characteristics.edgeOrientation);
  const stroke =
    0.7 * ratioScore(a.strokeWeight, b.strokeWeight) +
    0.3 * ratioScore(a.characteristics.strokeContrast, b.characteristics.strokeContrast);
  const slant = Math.exp(-Math.abs(a.slantAngle - b.slantAngle) / 15);
  const spacing =
    0.4 * ratioScore(a.characteristics.aspect, b.characteristics.aspect) +
    0.3 * vectorScore(a.verticalProfile, b.verticalProfile) +
    0.3 * vectorScore(a.horizontalProfile, b.horizontalProfile);
  const baseline = vectorScore(a.baselineShape, b.baselineShape),
    density = ratioScore(a.visualDensity, b.visualDensity);
  const rgbA = parseColor(a.color),
    rgbB = parseColor(b.color),
    color = Math.exp(-Math.hypot(...rgbA.map((v, i) => v - rgbB[i]!)) / 100);
  const placement =
    Math.exp(
      -Math.hypot(
        a.inkBounds.x / a.width - b.inkBounds.x / b.width,
        a.inkBounds.y / a.height - b.inkBounds.y / b.height,
      ) * 4,
    ) * ratioScore(a.inkBounds.h / a.height, b.inkBounds.h / b.height);
  const total =
    100 *
    (0.38 * shape +
      0.12 * stroke +
      0.06 * slant +
      0.12 * spacing +
      0.06 * baseline +
      0.07 * density +
      0.05 * color +
      0.14 * placement);
  return {
    total: clamp(total, 0, 100),
    shape: shape * 100,
    stroke: stroke * 100,
    slant: slant * 100,
    spacing: spacing * 100,
    baseline: baseline * 100,
    density: density * 100,
    color: color * 100,
    placement: placement * 100,
  };
}
const copyStyle = (f: CloneTextField): LayerStyle => ({
  font: f.font,
  fontSize: f.fontSize,
  fontWeight: f.fontWeight ?? (f.bold ? 700 : 400),
  bold: f.bold,
  italic: f.italic,
  align: f.align,
  color: f.color,
  opacity: f.opacity ?? 1,
  letterSpacing: f.letterSpacing ?? 0,
  wordSpacing: f.wordSpacing ?? 0,
  lineHeight: f.lineHeight ?? 1.2,
  kerning: f.kerning ?? "normal",
  slantAngle: f.slantAngle ?? 0,
  baselineShift: f.baselineShift ?? 0,
  ...(f.textEffects ? { textEffects: f.textEffects } : {}),
});
function renderCandidate(
  canvas: HTMLCanvasElement,
  reference: CloneTextField,
  style: LayerStyle,
  scale: number,
  background: [number, number, number],
) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas typography analysis is unavailable.");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex(background);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const field: CloneTextField = {
    ...reference,
    ...style,
    original: "",
    replacement: reference.replacement || reference.original,
    x: 0,
    y: 0,
    w: canvas.width,
    h: canvas.height,
    fontSize: style.fontSize * scale,
    letterSpacing: (style.letterSpacing ?? 0) * scale,
    wordSpacing: (style.wordSpacing ?? 0) * scale,
    baselineShift: (style.baselineShift ?? 0) * scale,
    erase: "none",
    cover: "",
    redraw: true,
    rotation: 0,
  };
  delete field.sourceBox;
  delete field.baselineOffset;
  if (reference.baselineOffset !== undefined)
    field.baselineOffset = reference.baselineOffset * scale;
  if (field.textEffects)
    field.textEffects = {
      ...field.textEffects,
      strokeWidth: field.textEffects.strokeWidth * scale,
      shadowBlur: field.textEffects.shadowBlur * scale,
      shadowX: field.textEffects.shadowX * scale,
      shadowY: field.textEffects.shadowY * scale,
    };
  paintCloneFields(ctx, [field]);
  return fingerprintPixels(
    ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
    { opacity: style.opacity ?? 1 },
  );
}
/** FontFace coverage excludes named faces that would silently render through another font. */
export function coversReferenceScript(
  font: string,
  text: string,
  faces: readonly { family: string; unicodeRange: string }[],
): boolean {
  if (font === "serif" || font === "sans-serif") return true;
  const family = font.toLowerCase();
  const own = faces.filter((f) => f.family.replace(/["']/g, "").toLowerCase() === family);
  if (!own.length) return faces.length === 0;
  const ranges = own.flatMap((face) =>
    face.unicodeRange
      .toUpperCase()
      .split(",")
      .flatMap((range) => {
        const match = range.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/);
        if (!match) return [];
        const lo = parseInt(match[1]!.replace(/\?/g, "0"), 16),
          hi = match[2] ? parseInt(match[2], 16) : parseInt(match[1]!.replace(/\?/g, "F"), 16);
        return [{ lo, hi }];
      }),
  );
  return Array.from(text).every((ch) => {
    const point = ch.codePointAt(0)!;
    return (
      /\s/.test(ch) ||
      point === 0x200c ||
      point === 0x200d ||
      ranges.some((r) => point >= r.lo && point <= r.hi)
    );
  });
}
const completedMatches = new WeakMap<
  CloneTextField,
  { image: string; signature: string; matches: StyleMatch[] }
>();
export class TypographyFingerprintEngine {
  static async match(
    clone: CloneSource,
    reference: CloneTextField,
    signal?: AbortSignal,
  ): Promise<StyleMatch[]> {
    const cancel = () => {
      if (signal?.aborted) throw new Error("Typography analysis cancelled.");
    };
    cancel();
    const signature = JSON.stringify(reference);
    const cached = completedMatches.get(reference);
    if (cached?.image === clone.image && cached.signature === signature) return cached.matches;
    const box = reference.sourceBox ?? reference,
      scale = Math.min(1, 256 / box.w, 96 / box.h);
    const width = Math.max(2, Math.round(box.w * scale)),
      height = Math.max(2, Math.round(box.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas typography analysis is unavailable.");
    const originalRaster =
      !!reference.original &&
      !reference.redraw &&
      reference.replacement === reference.original &&
      !reference.deleted &&
      clone.image.startsWith("data:");
    let fingerprint: TypographyFingerprint;
    if (originalRaster) {
      const image = await loadCloneImage(clone.image);
      cancel();
      ctx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, width, height);
      fingerprint = fingerprintPixels(ctx.getImageData(0, 0, width, height).data, width, height);
    } else
      fingerprint = renderCandidate(
        canvas,
        reference,
        copyStyle(reference),
        scale,
        [255, 255, 255],
      );
    const text = originalRaster ? reference.original : reference.replacement;
    if (!text.trim()) throw new Error("Select non-empty reference text.");
    const sample = { ...reference, replacement: text };
    if (document.fonts)
      await Promise.all(
        AVAILABLE_FONTS.flatMap((font) =>
          [400, 600, 700].flatMap((fontWeight) =>
            [false, true].map((italic) =>
              document.fonts
                .load(fontCss({ ...reference, font, fontWeight, italic }, reference.fontSize), text)
                .catch(() => []),
            ),
          ),
        ),
      );
    cancel();
    const faces =
      document.fonts && Symbol.iterator in document.fonts ? Array.from(document.fonts) : [];
    const allowed = AVAILABLE_FONTS.filter(
      (font) => !/[\u0b00-\u0b7f]/u.test(text) || font === "Noto Sans Oriya",
    )
      .filter((font) => !/[\u0900-\u097f]/u.test(text) || font === "Noto Sans Devanagari")
      .filter((font) => coversReferenceScript(font, text, faces))
      .filter(
        (font) =>
          !document.fonts ||
          document.fonts.check(fontCss({ ...reference, font }, reference.fontSize), text),
      );
    if (!allowed.length) throw new Error("No loaded font supports this reference script.");
    const trials: { style: LayerStyle; score: FingerprintScore }[] = [];
    let evaluated = 0;
    const evaluate = (style: LayerStyle) => {
      cancel();
      evaluated++;
      try {
        return compareFingerprints(
          fingerprint,
          renderCandidate(canvas, sample, style, scale, fingerprint.background),
        );
      } catch {
        return {
          total: 0,
          shape: 0,
          stroke: 0,
          slant: 0,
          spacing: 0,
          baseline: 0,
          density: 0,
          color: 0,
          placement: 0,
        };
      }
    };
    const base = copyStyle(reference);
    base.color = originalRaster
      ? (fingerprint.foregroundColor ?? fingerprint.color)
      : reference.color; // Match observed composited colour; do not invent raster opacity.
    base.opacity = originalRaster ? (fingerprint.opacity ?? 1) : (reference.opacity ?? 1);
    const initialSize = originalRaster
      ? clamp(fingerprint.inkBounds.h / scale / 0.78, 4, 4096)
      : reference.fontSize;
    for (const font of allowed) {
      for (const fontWeight of [400, 600, 700])
        for (const italic of [false, true]) {
          const style = {
            ...base,
            font,
            fontWeight,
            bold: fontWeight >= 700,
            italic,
            fontSize: initialSize,
            slantAngle: 0,
          };
          ctx.font = fontCss({ ...sample, ...style }, 32);
          ctx.fontKerning = "normal";
          if (Reflect.has(ctx, "letterSpacing"))
            (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
          if (Reflect.has(ctx, "wordSpacing"))
            (ctx as unknown as { wordSpacing: string }).wordSpacing = "0px";
          const m = ctx.measureText(text.split(/\r?\n/)[0] ?? text);
          const probeHeight =
            (m.actualBoundingBoxAscent ?? 25) +
            (m.actualBoundingBoxDescent ?? 7) +
            Math.max(0, text.split(/\r?\n/).length - 1) *
              32 *
              (fingerprint.lineHeight ?? style.lineHeight ?? 1.2);
          style.fontSize = clamp(
            (fingerprint.inkBounds.h / scale / Math.max(1, probeHeight)) * 32,
            4,
            4096,
          );
          trials.push({ style, score: evaluate(style) });
        }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      cancel();
    }
    trials.sort((a, b) => b.score.total - a.score.total);
    const seen = new Set<string>();
    const seeds = trials
      .filter((trial) => {
        if (seen.has(trial.style.font)) return false;
        seen.add(trial.style.font);
        return true;
      })
      .slice(0, 3);
    if (seeds.length < 3)
      for (const trial of trials) {
        if (!seeds.includes(trial)) seeds.push(trial);
        if (seeds.length === 3) break;
      }
    const matches: StyleMatch[] = [];
    for (const seed of seeds) {
      let best = seed;
      const before = seed.score.total;
      let passes = 0;
      // Coordinate descent only accepts improvements, measured using the same painter used for exports.
      for (const step of [1, 0.5, 0.25]) {
        const axes: ((s: LayerStyle) => LayerStyle[])[] = [
          (s) => [
            { ...s, fontSize: clamp(s.fontSize * (1 + 0.06 * step), 1, 4096) },
            { ...s, fontSize: clamp(s.fontSize * (1 - 0.06 * step), 1, 4096) },
          ],
          (s) => [
            {
              ...s,
              letterSpacing: clamp((s.letterSpacing ?? 0) + step * 0.06 * s.fontSize, -20, 100),
            },
            {
              ...s,
              letterSpacing: clamp((s.letterSpacing ?? 0) - step * 0.06 * s.fontSize, -20, 100),
            },
          ],
          (s) => [
            { ...s, wordSpacing: clamp((s.wordSpacing ?? 0) + step * 0.12 * s.fontSize, -20, 100) },
            { ...s, wordSpacing: clamp((s.wordSpacing ?? 0) - step * 0.12 * s.fontSize, -20, 100) },
          ],
          (s) => [
            { ...s, slantAngle: clamp((s.slantAngle ?? 0) + step * 4, -24, 24) },
            { ...s, slantAngle: clamp((s.slantAngle ?? 0) - step * 4, -24, 24) },
          ],
          (s) => [
            { ...s, baselineShift: (s.baselineShift ?? 0) + step * 0.05 * s.fontSize },
            { ...s, baselineShift: (s.baselineShift ?? 0) - step * 0.05 * s.fontSize },
          ],
          (s) => [
            { ...s, lineHeight: clamp((s.lineHeight ?? 1.2) + step * 0.1, 0.5, 5) },
            { ...s, lineHeight: clamp((s.lineHeight ?? 1.2) - step * 0.1, 0.5, 5) },
          ],
          (s) => [
            { ...s, kerning: "normal" },
            { ...s, kerning: "none" },
          ],
          (s) => (["left", "center", "right"] as const).map((align) => ({ ...s, align })),
        ];
        for (const axis of axes) {
          for (const style of axis(best.style)) {
            const score = evaluate(style);
            if (score.total > best.score.total + 0.02) best = { style, score };
          }
        }
        passes++;
        // Let selection/cancel updates render between bounded passes.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        cancel();
      }
      const report: TypographyMatchReport = {
        fingerprint,
        beforeScore: Math.round(before),
        finalScore: Math.round(best.score.total),
        refinementPasses: passes,
        candidatesEvaluated: evaluated,
        components: best.score,
        uncertainties: originalRaster ? fingerprint.uncertainties : [],
      };
      matches.push({
        font: best.style.font,
        style: best.style,
        score: report.finalScore,
        confidence: Math.round(best.score.total * fingerprint.quality),
        source: "typography-fingerprint",
        explanation: `Visual fingerprint comparison and ${passes} refinement passes; score ${Math.round(before)} → ${report.finalScore}.`,
        typography: report,
      });
    }
    const result = matches
      .sort((a, b) => b.score - a.score)
      .map((m) => ({ ...m, typography: { ...m.typography!, candidatesEvaluated: evaluated } }));
    completedMatches.set(reference, { image: clone.image, signature, matches: result });
    return result;
  }
}
