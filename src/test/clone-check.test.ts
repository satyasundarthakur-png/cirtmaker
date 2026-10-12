import { describe, it, expect } from "vitest";
import { checkClone } from "@/features/certmaker/lib/clone-check";
import { cloneField, isActive, patchField } from "@/features/certmaker/lib/clone";
import type { CloneSource } from "@/features/certmaker/lib/types";
const source = (): CloneSource => ({
  image: "template",
  width: 1000,
  height: 600,
  filename: "test.png",
  kind: "image",
  fields: [cloneField("Name", 100, 100, 200, 40, 0)],
  suggestions: [],
});
describe("layout checks and style rendering", () => {
  it("reports overlap once and warns about unerased original text", () => {
    const c = source();
    c.fields.push({ ...cloneField("", 150, 100, 200, 40, 1), replacement: "New" });
    c.fields[0] = { ...c.fields[0]!, replacement: "Edited", erase: "none" };
    const issues = checkClone(c);
    expect(issues.filter((s) => s.includes("overlaps"))).toHaveLength(1);
    expect(issues.some((s) => s.includes("behind"))).toBe(true);
  });
  it("accepts valid separated fields and reports invalid geometry", () => {
    const c = source();
    expect(checkClone(c)).toEqual([]);
    c.fields[0]!.x = 999;
    expect(checkClone(c).some((s) => s.includes("beyond"))).toBe(true);
    c.fields[0]!.fontSize = NaN;
    expect(checkClone(c).some((s) => s.includes("invalid"))).toBe(true);
  });
  it("renders explicit typography edits with unchanged wording", () => {
    const c = source();
    expect(isActive(c.fields[0]!)).toBe(false);
    const changed = patchField(c, "clone-0", { bold: true });
    expect(isActive(changed.fields[0]!)).toBe(true);
    expect(isActive(patchField(changed, "clone-0", { replacement: "Name" }).fields[0]!)).toBe(
      false,
    );
  });
});
