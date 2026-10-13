import { fontCss } from "../clone";
import type { CloneSource, CloneTextField } from "../types";
import { LayerInspector } from "./LayerInspector";
import { TypographyFingerprintEngine } from "./TypographyFingerprintEngine";
import type { LayerStyle, StyleMatch } from "./types";

export class StyleMatchEngine {
  /** Transfer authoritative editable controls; never infer a family from a 'script' label. */
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
      wordSpacing: v.wordSpacing,
      kerning: v.kerning,
      slantAngle: v.slantAngle,
      baselineShift: v.baselineShift,
      lineHeight: v.lineHeight,
      ...(v.textEffects ? { textEffects: v.textEffects } : {}),
    };
  }
  static async analyze(
    clone: CloneSource,
    reference: CloneTextField,
    signal?: AbortSignal,
    target?: CloneTextField,
  ): Promise<StyleMatch[]> {
    const matches = await TypographyFingerprintEngine.match(clone, reference, signal);
    if (!target) return matches;
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    if (!ctx) return matches;
    return matches
      .map((match) => {
        const original = match.style;
        let ratio = 1;
        const scaleStyle = (factor: number): LayerStyle => ({
          ...original,
          fontSize: original.fontSize * factor,
          letterSpacing: (original.letterSpacing ?? 0) * factor,
          wordSpacing: (original.wordSpacing ?? 0) * factor,
          baselineShift: (original.baselineShift ?? 0) * factor,
          ...(original.textEffects
            ? {
                textEffects: {
                  ...original.textEffects,
                  strokeWidth: original.textEffects.strokeWidth * factor,
                  shadowBlur: original.textEffects.shadowBlur * factor,
                  shadowX: original.textEffects.shadowX * factor,
                  shadowY: original.textEffects.shadowY * factor,
                },
              }
            : {}),
        });
        for (let pass = 0; pass < 5; pass++) {
          const field = { ...target, ...scaleStyle(ratio) };
          ctx.font = fontCss(field, field.fontSize);
          ctx.fontKerning = field.kerning ?? "normal";
          const nativeLetters = Reflect.has(ctx, "letterSpacing"),
            nativeWords = Reflect.has(ctx, "wordSpacing");
          if (nativeLetters)
            (ctx as unknown as { letterSpacing: string }).letterSpacing =
              `${field.letterSpacing ?? 0}px`;
          if (nativeWords)
            (ctx as unknown as { wordSpacing: string }).wordSpacing = `${field.wordSpacing ?? 0}px`;
          let lines = field.replacement.replace(/\t/g, " ").split(/\r?\n/);
          if (field.multiline)
            lines = lines.flatMap((paragraph) => {
              const out: string[] = [];
              let line = "";
              for (const word of paragraph.split(/\s+/)) {
                const next = line ? `${line} ${word}` : word;
                if (line && ctx.measureText(next).width > field.w - 4) {
                  out.push(line);
                  line = word;
                } else line = next;
              }
              out.push(line);
              return out;
            });
          let step = 1;
          for (const line of lines) {
            const metrics = ctx.measureText(line);
            const measured =
              metrics.width +
              (nativeLetters ? 0 : Math.max(0, line.length - 1) * (field.letterSpacing ?? 0)) +
              (nativeWords ? 0 : (line.match(/\s/g)?.length ?? 0) * (field.wordSpacing ?? 0));
            step = Math.min(
              step,
              Math.max(0.1, field.w - 4) / Math.max(0.1, measured),
              Math.max(0.1, field.h - 4) /
                Math.max(
                  0.1,
                  (metrics.actualBoundingBoxAscent ?? field.fontSize * 0.8) +
                    (metrics.actualBoundingBoxDescent ?? field.fontSize * 0.2),
                ),
            );
          }
          step = Math.min(
            step,
            Math.max(0.1, field.h - 4) /
              Math.max(
                0.1,
                field.fontSize * (1 + Math.max(0, lines.length - 1) * (field.lineHeight ?? 1.2)),
              ),
          );
          if (step >= 0.999) break;
          ratio *= Math.max(0.001, step * 0.99);
        }
        ratio = Math.min(1, ratio);
        const style = scaleStyle(ratio);
        return {
          ...match,
          style,
          confidence: Math.round(match.confidence * ratio),
          targetFit: {
            ratio,
            requestedSize: original.fontSize,
            appliedSize: style.fontSize,
            warning:
              ratio < 0.98
                ? "Target box requires smaller text. Enlarge it for closer size fidelity."
                : null,
          },
        };
      })
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score);
  }
}
