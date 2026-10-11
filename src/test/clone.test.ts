import { describe, expect, it, vi } from "vitest";
import { addManualField, autoMapFields, cloneField, fontCss, isActive, paintCloneFields, patchField, promoteSuggestion, removeField } from "@/features/certmaker/lib/clone";
import { exportWidth, pageSize } from "@/features/certmaker/lib/exporter";
import { DEFAULT_DATA, type CloneSource, type CloneTextField } from "@/features/certmaker/lib/types";
import { certForRow, missingVariables } from "@/features/certmaker/lib/merge";
import { certHeight } from "@/features/certmaker/lib/render";

const field = (over: Partial<CloneTextField> = {}): CloneTextField => ({ ...cloneField("Original recipient", 40, 80, 200, 30, 0), ...over });
const source = (over: Partial<CloneSource> = {}): CloneSource => ({ image: "original", filename: "certificate.png", width: 1000, height: 600, kind: "image", fields: [field()], suggestions: [], ...over });
const data = (clone: CloneSource = source()) => ({ ...DEFAULT_DATA, cloneMode: true, clone });

function context() {
  return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 100 })), font: "", fillStyle: "", textAlign: "", textBaseline: "" };
}
const paint = (ctx: ReturnType<typeof context>, fields: CloneTextField[]) => paintCloneFields(ctx as unknown as CanvasRenderingContext2D, fields);

describe("painting", () => {
  it("leaves every original pixel untouched when text is unchanged", () => {
    const ctx = context();
    paint(ctx, [field()]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(isActive(field())).toBe(false);
  });
  it("clips cover and text strictly to the field rectangle", () => {
    const ctx = context();
    paint(ctx, [field({ replacement: "New recipient" })]);
    expect(ctx.rect).toHaveBeenCalledWith(40, 80, 200, 30);
    expect(ctx.clip).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenCalledWith(40, 80, 200, 30);
    expect(ctx.fillText).toHaveBeenCalledWith("New recipient", expect.any(Number), expect.any(Number));
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
  it("paints no cover at all when the cover is off", () => {
    const ctx = context();
    paint(ctx, [field({ replacement: "New recipient", cover: "" })]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledOnce();
  });
  it("centres or right-aligns text inside the box", () => {
    const centre = context();
    paint(centre, [field({ replacement: "X", align: "center" })]);
    expect(centre.fillText).toHaveBeenCalledWith("X", 140, expect.any(Number));
    expect(centre.textAlign).toBe("center");
    const right = context();
    paint(right, [field({ replacement: "X", align: "right" })]);
    expect(right.textAlign).toBe("right");
    expect((right.fillText.mock.calls[0] as unknown[])[1]).toBeGreaterThan(200);
  });
  it("shrinks text that is wider than the box instead of overflowing it", () => {
    const ctx = context();
    ctx.measureText.mockImplementation(() => ({ width: ctx.font.includes("24px") ? 400 : 180 }));
    paint(ctx, [field({ replacement: "Long", fontSize: 24 })]);
    expect(ctx.font).not.toContain("24px");
  });
  it("builds a font string with weight, style and quoted families", () => {
    expect(fontCss({ font: "Playfair Display", bold: true, italic: true }, 20)).toBe('italic 700 20px "Playfair Display", serif');
    expect(fontCss({ font: "serif", bold: false, italic: false }, 12)).toBe("400 12px serif");
  });
  it("clips user text even when erasure is disabled", () => {
    const ctx = context();
    paint(ctx, [field({ replacement: "User text", erase: "none" })]);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
  it("skips invalid geometry rather than poisoning the canvas state", () => {
    const ctx = context();
    paint(ctx, [field({ replacement: "User text", w: Number.NaN })]);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});

describe("original artwork and export size", () => {
  it("uses the source aspect ratio rather than a paper template", () => {
    expect(certHeight(data())).toBe(600);
    expect(certHeight(data(source({ width: 600, height: 1000 })))).toBeCloseTo((1000 * 1000) / 600);
  });
  it("exports at the original's own pixel width whatever dpi is chosen", () => {
    const d = data(source({ width: 3508, height: 2480 }));
    expect(exportWidth(d, 72)).toBe(3508);
    expect(exportWidth(d, 600)).toBe(3508);
    expect(exportWidth({ ...DEFAULT_DATA }, 300)).toBe(3508); // normal templates still follow dpi
  });
  it("sizes the page from the source, so portrait certificates are not stretched onto landscape paper", () => {
    expect(pageSize(data(source({ width: 2480, height: 3508 })))).toEqual([210, 297]);
    expect(pageSize(data(source({ width: 3508, height: 2480 })))).toEqual([297, 210]);
    expect(pageSize(data(source({ kind: "pdf", pageMm: [200, 150] })))).toEqual([200, 150]);
  });
});

describe("editing operations", () => {
  const base = source({
    fields: [field({ id: "clone-0", kind: "name", original: "Candidate Name", replacement: "Candidate Name" }), field({ id: "clone-1", kind: "date", original: "12/03/2026", replacement: "12/03/2026" }), field({ id: "clone-2", kind: "custom", original: "Keep", replacement: "Changed" })],
    suggestions: [field({ id: "clone-3", y: 500, original: "Director", replacement: "Director" })],
  });

  it("maps untouched detected fields to their CSV variable and leaves edited ones alone", () => {
    const mapped = autoMapFields(base);
    expect(mapped.fields.map((f) => f.replacement)).toEqual(["{{name}}", "{{date}}", "Changed"]);
    expect(mapped.fields[0]?.original).toBe("Candidate Name");
  });
  it("patches one field without mutating the original", () => {
    const next = patchField(base, "clone-1", { x: 5 });
    expect(next.fields[1]?.x).toBe(5);
    expect(base.fields[1]?.x).toBe(40);
  });
  it("sends a removed detected field back to 'other text' and drops a manual one", () => {
    const removed = removeField(base, "clone-0");
    expect(removed.fields.map((f) => f.id)).toEqual(["clone-1", "clone-2"]);
    expect(removed.suggestions.map((f) => f.id)).toContain("clone-0");
    const manual = addManualField(base);
    const gone = removeField(manual.clone, manual.id);
    expect(gone.suggestions).toHaveLength(base.suggestions.length);
  });
  it("promotes a suggestion into an editable field", () => {
    const next = promoteSuggestion(base, "clone-3");
    expect(next.fields.map((f) => f.id)).toContain("clone-3");
    expect(next.suggestions).toHaveLength(0);
  });
  it("adds a manual box inside the page, with unique id and no cover", () => {
    const { clone, id } = addManualField(base);
    const f = clone.fields.find((x) => x.id === id);
    expect(id).toBe("clone-4");
    expect(f).toBeDefined();
    expect(f!.cover).toBe("");
    expect(f!.x).toBeGreaterThanOrEqual(0);
    expect(f!.x + f!.w).toBeLessThanOrEqual(base.width);
    expect(isActive(f!)).toBe(true);
  });
});

describe("bulk generation", () => {
  it("replaces CSV variables only in clone text while retaining the original image", () => {
    const d = data(source({ fields: [field({ replacement: "{{name}} — {{course}}" })] }));
    const merged = certForRow(d, { name: "Satya", course: "Workshop" }, 0);
    expect(merged.clone?.fields[0]?.replacement).toBe("Satya — Workshop");
    expect(merged.clone?.fields[0]?.original).toBe("Original recipient");
    expect(merged.clone?.image).toBe("original");
    expect(d.clone?.fields[0]?.replacement).toBe("{{name}} — {{course}}");
    expect(missingVariables(d, { headers: ["name"], rows: [] })).toEqual(["course"]);
  });
  it("fills certificate numbers that count up per row", () => {
    const d = { ...data(source({ fields: [field({ replacement: "{{certificate_id}}" })] })), certId: "CERT-2026-001" };
    const ids = [0, 1, 2].map((i) => certForRow(d, { name: "A" }, i).clone?.fields[0]?.replacement);
    expect(ids).toEqual(["CERT-2026-001", "CERT-2026-002", "CERT-2026-003"]);
  });
});
