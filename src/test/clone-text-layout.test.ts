import { describe, expect, it } from "vitest";
import { fitCloneText } from "@/features/certmaker/lib/clone-text-layout";

function context() {
  return {
    font: "",
    measureText(text: string) {
      const size = parseFloat(this.font);
      return { width: size * text.length, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
    },
  };
}
describe("clone text layout", () => {
  it("fits long values even when they require text smaller than the former minimum", () => {
    const ctx = context();
    const text = "A very long user-entered value";
    const result = fitCloneText(ctx as unknown as CanvasRenderingContext2D, text, (s) => `${s}px serif`, 30, 50, 20);
    expect(result.size).toBeLessThan(4);
    expect(ctx.measureText(text).width).toBeLessThanOrEqual(50);
  });
  it("fits vertical ink and preserves the requested size when it already fits", () => {
    const ctx = context();
    const fitted = fitCloneText(ctx as unknown as CanvasRenderingContext2D, "X", (s) => `${s}px serif`, 60, 100, 20);
    expect(fitted.ascent + fitted.descent).toBeLessThanOrEqual(20);
    expect(fitCloneText(ctx as unknown as CanvasRenderingContext2D, "X", (s) => `${s}px serif`, 12, 100, 20).size).toBe(12);
  });
});