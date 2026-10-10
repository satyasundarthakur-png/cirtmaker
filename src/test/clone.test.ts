import { describe, expect, it, vi } from "vitest";
import { cloneField, paintCloneFields } from "@/features/certmaker/lib/clone";
import { DEFAULT_DATA } from "@/features/certmaker/lib/types";
import { certForRow, missingVariables } from "@/features/certmaker/lib/merge";
import { certHeight } from "@/features/certmaker/lib/render";

describe("Clone Mode", () => {
  const field = cloneField("Original recipient", 40, 80, 200, 30, 0);
  const data = { ...DEFAULT_DATA, cloneMode: true, clone: { image: "original", filename: "certificate.png", width: 1000, height: 600, fields: [field] } };

  function context() {
    return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 100 })) };
  }
  it("leaves every original pixel untouched when text is unchanged", () => {
    const ctx = context();
    paintCloneFields(ctx as unknown as CanvasRenderingContext2D, [field]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
  it("clips replacement and covering strictly to its text rectangle", () => {
    const ctx = context();
    paintCloneFields(ctx as unknown as CanvasRenderingContext2D, [{ ...field, replacement: "New recipient" }]);
    expect(ctx.rect).toHaveBeenCalledWith(40, 80, 200, 30);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.fillRect).toHaveBeenCalledWith(40, 80, 200, 30);
    expect(ctx.fillText).toHaveBeenCalledWith("New recipient", 40, 80);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
  it("uses the source aspect ratio rather than recreating a paper template", () => {
    expect(certHeight(data)).toBe(600);
    expect(certHeight({ ...data, clone: { ...data.clone, width: 600, height: 1000 } })).toBeCloseTo(1000 * 1000 / 600);
  });
  it("replaces CSV variables only in clone text while retaining the original image", () => {
    const base = { ...data, clone: { ...data.clone, fields: [{ ...field, replacement: "{{name}} — {{course}}" }] } };
    const merged = certForRow(base, { name: "Satya", course: "Workshop" }, 0);
    expect(merged.clone?.fields[0]?.replacement).toBe("Satya — Workshop");
    expect(merged.clone?.fields[0]?.original).toBe(field.original);
    expect(merged.clone?.image).toBe("original");
    expect(base.clone.fields[0]?.replacement).toBe("{{name}} — {{course}}");
    expect(missingVariables(base, { headers: ["name"], rows: [] })).toEqual(["course"]);
  });
});