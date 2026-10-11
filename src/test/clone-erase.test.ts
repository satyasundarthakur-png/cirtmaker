import { describe, expect, it, vi } from "vitest";
import { analyseInk, fitToInk, scaleOf, windowFor, type Pixels } from "@/features/certmaker/lib/clone-erase";
import { addManualField, cloneField, extraStroke, mergeFit, paintCloneFields } from "@/features/certmaker/lib/clone";
import type { CloneSource, CloneTextField } from "@/features/certmaker/lib/types";

const W = 1170;
const H = 400;

function page(paper: [number, number, number] = [255, 255, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = paper[0]; data[i * 4 + 1] = paper[1]; data[i * 4 + 2] = paper[2]; data[i * 4 + 3] = 255; }
  return { data, width: W, height: H };
}
function rect(img: Pixels, x: number, y: number, w: number, h: number, c: [number, number, number] = [20, 20, 20]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * img.width + xx) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; }
}
/** A dotted leader line: 2x2 dots every 6 px. */
function leader(img: Pixels, x0: number, x1: number, y: number) { for (let x = x0; x < x1; x += 6) rect(img, x, y, 2, 2, [60, 60, 60]); }
const px = (img: Pixels, x: number, y: number) => img.data[(y * img.width + x) * 4]!;

/** Cut the analysis window out of the page, as the app does. */
function run(img: Pixels, box: { x: number; y: number; w: number; h: number }, protect: { x: number; y: number; w: number; h: number }[] = [], loose = false) {
  const win = windowFor(box, W, H);
  const out = new Uint8ClampedArray(win.w * win.h * 4);
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) for (let k = 0; k < 4; k++) out[(y * win.w + x) * 4 + k] = img.data[((y + win.y) * img.width + (x + win.x)) * 4 + k]!;
  const a = analyseInk({ data: out, width: win.w, height: win.h }, win, { box, protect, imageWidth: W, loose });
  const erased = (x: number, y: number) => a.mask[(y - win.y) * win.w + (x - win.x)] === 1;
  return { a, erased, win };
}

describe("smart erase", () => {
  // handwriting: two strokes, one of which sticks well out of the box (like a descender or the top of a tall letter)
  const box = { x: 300, y: 200, w: 200, h: 30 };
  function scene() {
    const img = page();
    leader(img, 150, 700, 228); // printed dotted line under the writing
    rect(img, 320, 205, 4, 22); // stroke inside the box
    rect(img, 380, 195, 4, 55); // long stroke: top 5px above the box, tail 20px below it
    rect(img, 440, 208, 30, 4); // a horizontal bar of the writing
    rect(img, 560, 205, 5, 20, [10, 10, 10]); // static printed text to the right, outside the box
    return img;
  }

  it("removes all of the old writing, including parts that stick out of the box", () => {
    const { erased, a } = run(scene(), box);
    expect(a.selected).toBeGreaterThanOrEqual(3);
    for (const [x, y] of [[321, 210], [381, 196], [381, 245], [450, 209]] as const) expect(erased(x, y), `${x},${y}`).toBe(true);
  });
  it("keeps the printed dotted line, even where it runs under the writing", () => {
    const { erased, win } = run(scene(), box);
    const strokes: [number, number][] = [[320, 324], [380, 384], [440, 470]];
    // every dot of the leader line inside the analysed window that is not itself touched by a stroke
    const xs: number[] = [];
    for (let x = 150; x < 700; x += 6) if (x >= win.x && x + 2 <= win.x + win.w && strokes.every(([a, b]) => x + 2 < a - 3 || x > b + 3)) xs.push(x);
    expect(xs.length).toBeGreaterThan(10);
    for (const x of xs) expect(erased(x, 228), `dot at ${x}`).toBe(false);
  });
  it("leaves printed text that is outside the box untouched", () => {
    const { erased } = run(scene(), box);
    expect(erased(562, 210)).toBe(false);
  });
  it("never erases inside a protected static-text box, even if the writing touches it", () => {
    const img = scene();
    rect(img, 500, 200, 10, 30); // static text that touches the end of the box
    const { erased } = run(img, box, [{ x: 495, y: 195, w: 30, h: 40 }]);
    expect(erased(505, 210)).toBe(false);
  });
  it("fills the hole with the paper colour, whatever it is", () => {
    for (const paper of [[255, 255, 255], [244, 238, 222]] as const) {
      const img = page([...paper]);
      rect(img, 320, 205, 4, 22);
      const { a, win } = run(img, box);
      const i = (210 - win.y) * win.w + (321 - win.x);
      expect(a.mask[i]).toBe(1);
      for (let k = 0; k < 3; k++) expect(Math.abs((a.fill[i * 4 + k] ?? 0) - paper[k]!)).toBeLessThanOrEqual(2);
    }
  });
  it("changes nothing when there is no ink, and ignores dark pages", () => {
    expect(run(page(), box).a.selected).toBe(0);
    const dark = page([30, 30, 30]);
    rect(dark, 320, 205, 4, 22, [250, 250, 250]);
    expect(run(dark, box).a.mask.some((m) => m === 1)).toBe(false);
  });
  it("does not treat a long solid rule as handwriting", () => {
    const img = page();
    rect(img, 250, 226, 400, 2);
    rect(img, 320, 205, 4, 18);
    const { erased } = run(img, box);
    expect(erased(500, 227)).toBe(false);
    expect(erased(321, 210)).toBe(true);
  });
  it("scales its sizes with the image, so hi-res scans behave the same", () => {
    expect(scaleOf(2340)).toBe(2);
    expect(scaleOf(100)).toBe(0.5);
  });
});

describe("fitting a box to the writing", () => {
  const field = { x: 300, y: 220, w: 200, h: 22, fontSize: 18 };
  it("grows a box that sits too low so it covers the whole of the old writing", () => {
    const img = page();
    rect(img, 320, 200, 4, 26); // writing mostly above the box
    rect(img, 400, 203, 4, 24);
    const { a } = run(img, field, [], true);
    const fit = fitToInk(a, field, { width: W, height: H })!;
    expect(fit.y!).toBeLessThanOrEqual(200);
    expect(fit.y! + fit.h!).toBeGreaterThanOrEqual(227);
    expect(fit.x!).toBeLessThanOrEqual(300);
  });
  it("limits how far a box can grow, so it cannot swallow neighbouring words", () => {
    const img = page();
    rect(img, 320, 205, 4, 22);
    rect(img, 300, 100, 4, 22); // writing from a different line, far above
    const { a } = run(img, field, [], true);
    const fit = fitToInk(a, field, { width: W, height: H })!;
    expect(fit.y!).toBeGreaterThan(150);
  });
  it("takes the text colour and stroke thickness from the old writing", () => {
    const img = page();
    rect(img, 320, 205, 4, 22, [20, 30, 120]); // blue ink, 4 px thick
    const { a } = run(img, field, [], true);
    const fit = fitToInk(a, field, { width: W, height: H })!;
    expect(fit.color).toBe("#141e78");
    expect(fit.weight!).toBeGreaterThanOrEqual(3);
  });
  it("sizes text from the body of the writing, not a thin trailing tail", () => {
    const img = page();
    for (let i = 0; i < 12; i++) rect(img, 310 + i * 9, 205, 4, 20); // the body of the writing: 20 px tall
    rect(img, 300, 205, 1, 36); // one hair-thin tail reaching 16 px lower
    const { a } = run(img, { x: 300, y: 200, w: 140, h: 30 }, [], true);
    expect(a.bodyH).toBeLessThanOrEqual(22);
    expect(a.inkBox!.h).toBeGreaterThanOrEqual(36);
  });
  it("returns nothing when there is no old writing in the box", () => {
    const { a } = run(page(), field, [], true);
    expect(fitToInk(a, field, { width: W, height: H })).toBeNull();
  });
});

describe("text weight", () => {
  const f = (font: string, weight: number, bold = false) => ({ font, weight, bold });
  it("adds thickness to a hairline script font to match heavy handwriting, but not to a heavy font", () => {
    expect(extraStroke(f("Great Vibes", 3.5), 28)).toBeGreaterThan(0.5);
    expect(extraStroke(f("Inter", 2, false), 28)).toBe(0);
  });
  it("never adds more than a small fraction of the size, and nothing when weight is 0", () => {
    expect(extraStroke(f("Great Vibes", 12), 28)).toBeLessThanOrEqual(0.035 * 28 + 1e-9);
    expect(extraStroke(f("Great Vibes", 0), 28)).toBe(0);
  });
});

describe("painting with smart erase", () => {
  function ctx() {
    return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), drawImage: vi.fn(), measureText: vi.fn(() => ({ width: 50 })), font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, lineJoin: "", textAlign: "", textBaseline: "" };
  }
  const smart: CloneTextField = { ...cloneField("old", 100, 50, 200, 30, 0), erase: "smart", replacement: "new", font: "Great Vibes", weight: 3.5 };
  const patch = { x: 90, y: 40, canvas: {} as HTMLCanvasElement };

  it("draws the erase patch unchanged and clips only the new text", () => {
    const c = ctx();
    paintCloneFields(c as unknown as CanvasRenderingContext2D, [smart], new Map([["clone-0", patch]]));
    expect(c.drawImage).toHaveBeenCalledWith(patch.canvas, 90, 40);
    expect(c.fillRect).not.toHaveBeenCalled();
    expect(c.clip).toHaveBeenCalledOnce();
    expect(c.fillText).toHaveBeenCalledOnce();
  });
  it("thickens a thin font with an outline pass before the fill", () => {
    const c = ctx();
    paintCloneFields(c as unknown as CanvasRenderingContext2D, [smart], new Map([["clone-0", patch]]));
    expect(c.strokeText).toHaveBeenCalledOnce();
    expect(c.lineWidth).toBeGreaterThan(0.3);
  });
  it("touches nothing for a field whose text has not changed", () => {
    const c = ctx();
    paintCloneFields(c as unknown as CanvasRenderingContext2D, [{ ...smart, replacement: "old" }], new Map([["clone-0", patch]]));
    expect(c.drawImage).not.toHaveBeenCalled();
    expect(c.fillText).not.toHaveBeenCalled();
  });
  it("'none' erases nothing and confines user text to its box", () => {
    const c = ctx();
    paintCloneFields(c as unknown as CanvasRenderingContext2D, [{ ...smart, erase: "none" }]);
    expect(c.drawImage).not.toHaveBeenCalled();
    expect(c.fillRect).not.toHaveBeenCalled();
    expect(c.clip).toHaveBeenCalledOnce();
  });
});

describe("editing helpers", () => {
  const base: CloneSource = { image: "x", width: 1000, height: 600, filename: "t.png", kind: "image", fields: [{ ...cloneField("old", 10, 10, 100, 30, 0), id: "a", replacement: "typed since" }], suggestions: [] };
  it("manual boxes default to not erasing anything", () => {
    const { clone, id } = addManualField(base);
    expect(clone.fields.find((f) => f.id === id)?.erase).toBe("none");
  });
  it("applies a fit without overwriting text typed while it was running", () => {
    const fitted: CloneSource = { ...base, fields: [{ ...base.fields[0]!, replacement: "old", x: 5, y: 6, w: 150, h: 40, fontSize: 31, color: "#112233", weight: 3 }] };
    const merged = mergeFit(base, fitted);
    expect(merged.fields[0]).toMatchObject({ replacement: "typed since", x: 5, y: 6, w: 150, h: 40, fontSize: 31, color: "#112233", weight: 3 });
  });
});
