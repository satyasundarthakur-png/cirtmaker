import type { CloneSource, CloneTextField } from "../types";
import type { LayerDiff } from "./types";
export class PreviewRenderer {
  static diff(before: CloneSource, after: CloneSource): LayerDiff[] {
    const old = new Map(before.fields.map((f) => [f.id, f]));
    const next = new Map(after.fields.map((f) => [f.id, f]));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
      const a = old.get(id) ?? null,
        b = next.get(id) ?? null;
      if (JSON.stringify(a) === JSON.stringify(b)) return [];
      const properties = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(
        (key) =>
          JSON.stringify(a?.[key as keyof CloneTextField]) !==
          JSON.stringify(b?.[key as keyof CloneTextField]),
      );
      return [{ id, label: b?.label ?? a!.label, before: a, after: b, properties }];
    });
  }
}
