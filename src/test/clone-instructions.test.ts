import { describe, expect, it } from "vitest";
import { cloneField } from "@/features/certmaker/lib/clone";
import {
  applyFieldInstruction,
  instructionIsCurrent,
  planFieldInstruction,
} from "@/features/certmaker/lib/clone-instructions";
import type { CloneSource } from "@/features/certmaker/lib/types";

const source = (): CloneSource => ({
  image: "template",
  width: 1000,
  height: 600,
  filename: "template.png",
  kind: "image",
  fields: [{ ...cloneField("", 100, 100, 200, 40, 0), replacement: "User text", erase: "none" }],
  suggestions: [],
});
const plan = (c: CloneSource, text: string) =>
  planFieldInstruction(c, "clone-0", text, ["name", "College", "date"]);

describe("device-only field instructions", () => {
  it("reviews before applying exact text and preserves template pixels and unknown tokens", () => {
    const c = source();
    const p = plan(c, 'set text to "Asha / {{missing}}"');
    expect(c.fields[0]?.replacement).toBe("User text");
    const next = applyFieldInstruction(c, p);
    expect(next.fields[0]?.replacement).toBe("Asha / {{missing}}");
    expect(next.image).toBe(c.image);
    expect(next.fields[0]?.erase).toBe("none");
  });
  it("maps existing column names and rejects unavailable ones", () => {
    expect(plan(source(), "fill from column college").patch.replacement).toBe("{{College}}");
    expect(() => plan(source(), "fill from column secret")).toThrow("unavailable");
  });
  it("clamps absolute, relative and percentage geometry to source coordinates", () => {
    expect(plan(source(), "move right 10%").patch.x).toBe(200);
    expect(plan(source(), "move down 10%").patch.y).toBe(160);
    expect(plan(source(), "move to 99999, 99999").patch).toEqual({ x: 800, y: 560, w: 200, h: 40 });
    expect(plan(source(), "resize to 2000 x 2000").patch).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
  });
  it("updates typography only through explicit instructions", () => {
    expect(plan(source(), "align centre").patch).toEqual({ align: "center" });
    expect(plan(source(), "font size 24").patch).toEqual({ fontSize: 24 });
    expect(() => plan(source(), "font size 0")).toThrow();
  });
  it("erases selected original text with smart erase", () => {
    expect(plan(source(), "erase selected text").patch.replacement).toBe("");
    const c = source();
    c.fields[0] = { ...cloneField("Original", 100, 100, 200, 40, 0), replacement: "Edited" };
    expect(plan(c, "erase text").patch).toMatchObject({ replacement: "", erase: "smart" });
    expect(plan(c, "restore original").patch.replacement).toBe("Original");
    const removed = applyFieldInstruction(c, plan(c, "remove box"));
    expect(removed.fields).toHaveLength(0);
    expect(removed.suggestions[0]?.replacement).toBe("Original");
  });
  it("rejects stale reviews after editing or swapping the original", () => {
    const c = source();
    const p = plan(c, "move right 20 px");
    const changed = { ...c, fields: c.fields.map((f) => ({ ...f, replacement: "Typed later" })) };
    expect(instructionIsCurrent(changed, p)).toBe(false);
    expect(applyFieldInstruction(changed, p)).toBe(changed);
    expect(applyFieldInstruction({ ...c, image: "different" }, p).image).toBe("different");
  });
  it("refuses unsupported instructions instead of guessing", () => {
    expect(() => plan(source(), "recreate handwriting and erase artwork")).toThrow(
      "not recognised",
    );
  });
});
describe("editing actions", () => {
  it("duplicates with a unique ID without erasing artwork", () => {
    const c = source();
    const p = plan(c, "duplicate");
    const next = applyFieldInstruction(c, p);
    expect(next.fields).toHaveLength(2);
    expect(next.fields[1]).toMatchObject({
      id: "clone-1",
      original: "",
      replacement: "User text",
      erase: "none",
    });
  });
  it("beautifies unchanged original wording and restores original pixels", () => {
    const c = source();
    c.fields[0] = cloneField("Original", 100, 100, 200, 40, 0);
    const next = applyFieldInstruction(c, plan(c, "beautify"));
    expect(next.fields[0]).toMatchObject({
      redraw: true,
      erase: "smart",
      font: "Playfair Display",
    });
    expect(applyFieldInstruction(next, plan(next, "restore original")).fields[0]?.redraw).toBe(
      false,
    );
  });
  it("matches style and invalidates review when the target changes", () => {
    const c = source();
    c.fields.push({ ...cloneField("Title", 400, 100, 200, 40, 1), color: "#123456" });
    const p = plan(c, "match style clone-1");
    expect(p.patch.color).toBe("#123456");
    c.fields[1]!.color = "#ffffff";
    expect(instructionIsCurrent(c, p)).toBe(false);
  });
  it("writes literal text without running code", () => {
    expect(plan(source(), 'write "Workshop"').patch.replacement).toBe("Workshop");
  });
});
