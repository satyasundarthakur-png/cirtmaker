import type { CloneSource, CloneTextField } from "../types";
import type { Selection } from "./types";
export function authorizedText(field: CloneTextField): boolean {
  return !field.locked && !field.deleted && (!field.protection || field.protection === "text");
}
export class SelectionManager {
  static resolve(
    clone: CloneSource,
    ids: readonly string[],
    reference: string | null = null,
  ): Selection {
    const available = new Set(clone.fields.filter((f) => !f.deleted).map((f) => f.id));
    const selected = [...new Set(ids)].filter((id) => available.has(id));
    return {
      ids: selected,
      primary: selected.at(-1) ?? null,
      reference: reference && available.has(reference) ? reference : null,
    };
  }
  static select(selection: Selection, id: string | null, additive = false): string[] {
    if (!id) return [];
    return additive
      ? selection.ids.includes(id)
        ? selection.ids.filter((v) => v !== id)
        : [...selection.ids, id]
      : [id];
  }
  static hitTest(clone: CloneSource, x: number, y: number): string | null {
    return (
      [...clone.fields].reverse().find((f) => {
        if (f.deleted) return false;
        const angle = (-(f.rotation ?? 0) * Math.PI) / 180;
        const dx = x - f.x - f.w / 2,
          dy = y - f.y - f.h / 2;
        return (
          Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= f.w / 2 &&
          Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= f.h / 2
        );
      })?.id ?? null
    );
  }
}
