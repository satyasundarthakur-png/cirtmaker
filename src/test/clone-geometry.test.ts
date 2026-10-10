import { describe, expect, it } from "vitest";
import { MIN_BOX, clampBox, clonePageMm, dragBox, isCentered, nudgeBox } from "@/features/certmaker/lib/clone-geometry";

const BOUNDS = { w: 1000, h: 600 };
const BOX = { x: 100, y: 100, w: 200, h: 50 };

describe("dragBox", () => {
  it("moves without changing size and stays inside the image", () => {
    expect(dragBox(BOX, "move", 30, -20, BOUNDS)).toEqual({ x: 130, y: 80, w: 200, h: 50 });
    expect(dragBox(BOX, "move", -500, -500, BOUNDS)).toMatchObject({ x: 0, y: 0, w: 200, h: 50 });
    expect(dragBox(BOX, "move", 5000, 5000, BOUNDS)).toMatchObject({ x: 800, y: 550 });
  });
  it("resizes from each side while the opposite side stays put", () => {
    expect(dragBox(BOX, "e", 40, 0, BOUNDS)).toEqual({ x: 100, y: 100, w: 240, h: 50 });
    expect(dragBox(BOX, "w", -40, 0, BOUNDS)).toEqual({ x: 60, y: 100, w: 240, h: 50 });
    expect(dragBox(BOX, "s", 0, 25, BOUNDS)).toEqual({ x: 100, y: 100, w: 200, h: 75 });
    expect(dragBox(BOX, "n", 0, -25, BOUNDS)).toEqual({ x: 100, y: 75, w: 200, h: 75 });
    expect(dragBox(BOX, "se", 10, 10, BOUNDS)).toEqual({ x: 100, y: 100, w: 210, h: 60 });
    expect(dragBox(BOX, "nw", -10, -10, BOUNDS)).toEqual({ x: 90, y: 90, w: 210, h: 60 });
  });
  it("never collapses below the minimum size or leaves the image", () => {
    expect(dragBox(BOX, "e", -1000, 0, BOUNDS).w).toBe(MIN_BOX);
    expect(dragBox(BOX, "s", 0, -1000, BOUNDS).h).toBe(MIN_BOX);
    expect(dragBox(BOX, "e", 5000, 0, BOUNDS)).toMatchObject({ x: 100, w: 900 });
    expect(dragBox(BOX, "w", -5000, 0, BOUNDS)).toMatchObject({ x: 0, w: 300 });
  });
});

describe("clampBox / nudgeBox", () => {
  it("pulls an oversized or off-image box back in", () => {
    expect(clampBox({ x: -50, y: 900, w: 5000, h: 2 }, BOUNDS)).toEqual({ x: 0, y: 592, w: 1000, h: MIN_BOX });
  });
  it("nudges by whole pixels and stops at the edges", () => {
    expect(nudgeBox(BOX, 1, 0, BOUNDS).x).toBe(101);
    expect(nudgeBox({ ...BOX, x: 0 }, -10, 0, BOUNDS).x).toBe(0);
  });
});

describe("isCentered", () => {
  it("is true for a box centred on the page and false for one at the side", () => {
    expect(isCentered({ x: 600, y: 0, w: 800, h: 50 }, 2000)).toBe(true);
    expect(isCentered({ x: 100, y: 0, w: 400, h: 50 }, 2000)).toBe(false);
    expect(isCentered({ x: 50, y: 0, w: 1900, h: 50 }, 2000)).toBe(false);
  });
});

describe("clonePageMm", () => {
  it("snaps to A4 and Letter in either orientation", () => {
    expect(clonePageMm(3508, 2480)).toEqual([297, 210]);
    expect(clonePageMm(2480, 3508)).toEqual([210, 297]);
    expect(clonePageMm(3300, 2550)).toEqual([279.4, 215.9]);
  });
  it("treats other shapes as 300 dpi instead of stretching them onto a paper size", () => {
    const [w, h] = clonePageMm(1200, 1200);
    expect(w).toBeCloseTo(101.6, 1);
    expect(h).toBeCloseTo(101.6, 1);
  });
});
