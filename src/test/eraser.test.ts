import { describe, expect, it } from "vitest";
import { addEraser, isActive, paintCloneFields } from "@/features/certmaker/lib/clone";
import { ringColor } from "@/features/certmaker/lib/clone-erase";
import { detectionRows } from "@/features/certmaker/lib/clone-debug";
import type { CloneSource } from "@/features/certmaker/lib/types";

const source = (): CloneSource => ({
  image: "",
  width: 1000,
  height: 600,
  filename: "x",
  kind: "image",
  fields: [],
  suggestions: [],
});

describe("ringColor", () => {
  const paper = (w: number, h: number, rgb: number[]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
    return { data, width: w, height: h };
  };
  it("returns the paper colour around a box, ignoring what is inside it", () => {
    const px = paper(40, 30, [240, 230, 200]);
    for (let y = 10; y < 20; y++)
      for (let x = 10; x < 30; x++) px.data.set([0, 0, 0, 255], (y * 40 + x) * 4);
    expect(ringColor(px, { x: 10, y: 10, w: 20, h: 10 }, 4)).toEqual([240, 230, 200]);
  });
  it("gives up when there is no paper around the box", () => {
    expect(ringColor(paper(10, 10, [1, 2, 3]), { x: 0, y: 0, w: 10, h: 10 }, 3)).toBeNull();
  });
});

describe("hand eraser", () => {
  it("adds an active, text-free patch over exactly the dragged area", () => {
    const { clone, id } = addEraser(source(), { x: 100, y: 50, w: 300, h: 40 }, "#f4efe3");
    const f = clone.fields.find((x) => x.id === id)!;
    expect(f).toMatchObject({
      label: "Erased area",
      replacement: "",
      erase: "patch",
      cover: "#f4efe3",
      x: 100,
      y: 50,
      w: 300,
      h: 40,
    });
    expect(isActive(f)).toBe(true);
    expect(f.sourceBox).toEqual({ x: 100, y: 50, w: 300, h: 40 });
  });

  it("paints the cover colour over the area and draws no text", () => {
    const { clone } = addEraser(source(), { x: 100, y: 50, w: 300, h: 40 }, "#f4efe3");
    const calls: string[] = [];
    let fill = "";
    const ctx = new Proxy(
      {},
      {
        get: (_t, name: string) => {
          if (name === "fillStyle") return fill;
          return (...args: unknown[]) => {
            calls.push(`${name}(${args.join(",")})`);
          };
        },
        set: (_t, name: string, v: string) => {
          if (name === "fillStyle") fill = v;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    paintCloneFields(ctx, clone.fields);
    expect(calls).toContain("fillRect(100,50,300,40)");
    expect(fill).toBe("#f4efe3");
    expect(calls.some((c) => c.startsWith("fillText"))).toBe(false);
  });

  it("is not listed as a detected region", () => {
    const { clone } = addEraser(source(), { x: 10, y: 10, w: 80, h: 30 }, "#fff");
    expect(detectionRows(clone)).toHaveLength(0);
  });
});
