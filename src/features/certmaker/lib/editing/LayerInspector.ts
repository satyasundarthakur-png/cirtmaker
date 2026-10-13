import type { CloneTextField } from "../types";
import { authorizedText } from "./SelectionManager";
export class LayerInspector {
  static inspect(layer: CloneTextField) {
    return {
      id: layer.id,
      label: layer.label,
      kind: layer.kind,
      value: layer.replacement,
      tokens: [...layer.replacement.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]!),
      editable: authorizedText(layer),
      locked: layer.locked === true,
      protection: layer.protection ?? "text",
      geometry: { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation ?? 0 },
      style: {
        font: layer.font,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight ?? (layer.bold ? 700 : 400),
        bold: layer.bold,
        italic: layer.italic,
        align: layer.align,
        color: layer.color,
        opacity: layer.opacity ?? 1,
        letterSpacing: layer.letterSpacing ?? 0,
        wordSpacing: layer.wordSpacing ?? 0,
        kerning: layer.kerning ?? "normal",
        slantAngle: layer.slantAngle ?? 0,
        baselineShift: layer.baselineShift ?? 0,
        lineHeight: layer.lineHeight ?? 1.2,
        textEffects: layer.textEffects,
      },
    };
  }
}
