import { describe, expect, it } from "vitest";
import { isTextEntry } from "@/features/certmaker/lib/keyboard";

const input = (type: string) => {
  const el = document.createElement("input");
  el.type = type;
  return el;
};

describe("isTextEntry", () => {
  it("keeps native undo for text fields", () => {
    expect(isTextEntry(input("text"))).toBe(true);
    expect(isTextEntry(input("number"))).toBe(true);
    expect(isTextEntry(document.createElement("textarea"))).toBe(true);
  });
  it("lets Ctrl+Z through after clicking checkboxes, sliders and buttons", () => {
    for (const t of ["checkbox", "radio", "range", "color", "file", "button"])
      expect(isTextEntry(input(t))).toBe(false);
    expect(isTextEntry(document.createElement("button"))).toBe(false);
    expect(isTextEntry(document.createElement("select"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
