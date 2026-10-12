import { fontCss, loadCloneImage } from "../clone";
import type { CloneSource, CloneTextField } from "../types";
import { LayerInspector } from "./LayerInspector";
import { AVAILABLE_FONTS } from "./CommandParser";
import type { LayerStyle, StyleMatch } from "./types";
interface RasterDescriptor {
  mask: number[];
  aspect: number;
}
function descriptor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RasterDescriptor | null {
  const bg = [data[0] ?? 255, data[1] ?? 255, data[2] ?? 255];
  const ink: [number, number][] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (
        (data[i + 3] ?? 0) > 20 &&
        Math.hypot(
          (data[i] ?? 255) - bg[0]!,
          (data[i + 1] ?? 255) - bg[1]!,
          (data[i + 2] ?? 255) - bg[2]!,
        ) > 70
      )
        ink.push([x, y]);
    }
  if (ink.length < 6) return null;
  const xs = ink.map((p) => p[0]),
    ys = ink.map((p) => p[1]);
  const left = Math.min(...xs),
    top = Math.min(...ys),
    w = Math.max(...xs) - left + 1,
    h = Math.max(...ys) - top + 1;
  const mask = Array<number>(64 * 32).fill(0);
  for (const [x, y] of ink)
    mask[
      Math.min(31, Math.floor(((y - top) / h) * 32)) * 64 +
        Math.min(63, Math.floor(((x - left) / w) * 64))
    ] = 1;
  return { mask, aspect: w / h };
}
function similarity(a: RasterDescriptor, b: RasterDescriptor) {
  let intersection = 0,
    union = 0;
  a.mask.forEach((v, i) => {
    if (v || b.mask[i]) union++;
    if (v && b.mask[i]) intersection++;
  });
  return Math.max(
    0,
    Math.min(
      100,
      100 *
        ((0.7 * intersection) / Math.max(1, union) +
          (0.3 * Math.min(a.aspect, b.aspect)) / Math.max(a.aspect, b.aspect)),
    ),
  );
}
export class StyleMatchEngine {
  static extract(reference: CloneTextField): LayerStyle {
    const v = LayerInspector.inspect(reference).style;
    return {
      font: v.font,
      fontSize: v.fontSize,
      fontWeight: v.fontWeight,
      bold: v.bold,
      italic: v.italic,
      align: v.align,
      color: v.color,
      opacity: v.opacity,
      letterSpacing: v.letterSpacing,
      lineHeight: v.lineHeight,
      ...(v.textEffects ? { textEffects: v.textEffects } : {}),
    };
  }
  static rank(reference: CloneTextField, scores?: ReadonlyMap<string, number>): StyleMatch[] {
    const script = /vibes|script|cursive/i.test(reference.font);
    const odia = /[\u0b00-\u0b7f]/u.test(reference.replacement || reference.original);
    const devanagari = /[\u0900-\u097f]/u.test(reference.replacement || reference.original);
    const family = (font: string) =>
      /vibes/i.test(font)
        ? "script"
        : /serif|playfair|garamond/i.test(font) && !/sans/i.test(font)
          ? "serif"
          : "sans";
    const ranked = AVAILABLE_FONTS.map((font): StyleMatch => {
      const compatible =
        !(font === "Great Vibes" && !script) &&
        !(odia && font !== "Noto Sans Oriya") &&
        !(devanagari && font !== "Noto Sans Devanagari");
      const score = !compatible
        ? 0
        : (scores?.get(font) ??
          (font === reference.font ? 100 : family(font) === family(reference.font) ? 70 : 40));
      return {
        font,
        score: Math.round(score),
        confidence: Math.round(score),
        style: { ...this.extract(reference), font },
        source: scores ? "raster-similarity" : "editable-properties",
        explanation: !compatible
          ? "Excluded: decorative/script coverage mismatch"
          : scores
            ? "Measured glyph-mask and aspect similarity within the reference text rectangle"
            : font === reference.font
              ? "Exact editable font property match"
              : "Same-family approximation from editable properties",
      };
    })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.font.localeCompare(b.font));
    if (ranked.length === 1) {
      const best = ranked[0]!;
      for (const fontWeight of [400, 700, 500]
        .filter((w) => w !== (best.style.fontWeight ?? 400))
        .slice(0, 2)) {
        ranked.push({
          ...best,
          score: Math.max(
            0,
            best.score -
              Math.round(5 + Math.abs(fontWeight - (best.style.fontWeight ?? 400)) / 100),
          ),
          confidence: Math.max(
            0,
            best.confidence -
              Math.round(5 + Math.abs(fontWeight - (best.style.fontWeight ?? 400)) / 100),
          ),
          style: { ...best.style, fontWeight, bold: fontWeight >= 700 },
          explanation:
            "Same script-supported font with an alternate weight; property similarity penalty, not an exact raster font identification",
        });
      }
    }
    return ranked;
  }
  static async analyze(clone: CloneSource, reference: CloneTextField): Promise<StyleMatch[]> {
    if (!reference.original || reference.redraw || !clone.image.startsWith("data:"))
      return this.rank(reference);
    if (document.fonts)
      await Promise.all(
        AVAILABLE_FONTS.map((font) =>
          document.fonts
            .load(fontCss({ ...reference, font }, 32), reference.original)
            .catch(() => []),
        ),
      );
    const img = await loadCloneImage(clone.image);
    const box = reference.sourceBox ?? reference;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return this.rank(reference);
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
    const sample = descriptor(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
    if (!sample) return this.rank(reference);
    const scores = new Map<string, number>();
    for (const font of AVAILABLE_FONTS) {
      // Only loaded fonts are scored; never misreport a browser fallback as the named face.
      const candidate = { ...reference, font };
      if (document.fonts && !document.fonts.check(fontCss(candidate, 32), reference.original))
        continue;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 256, 64);
      ctx.font = fontCss(candidate, 32);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = "#000000";
      if ("letterSpacing" in ctx)
        (ctx as unknown as { letterSpacing: string }).letterSpacing =
          `${reference.letterSpacing ?? 0}px`;
      ctx.fillText(reference.original, 128, 32, 250);
      const candidateSample = descriptor(ctx.getImageData(0, 0, 256, 64).data, 256, 64);
      if (candidateSample) scores.set(font, similarity(sample, candidateSample));
    }
    if (!scores.size) return this.rank(reference);
    const ranked = this.rank(reference, scores).filter((m) => scores.has(m.font));
    return ranked.length ? ranked : this.rank(reference);
  }
}
