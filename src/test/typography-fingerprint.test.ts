import { describe, it, expect } from "vitest";
import {
  coversReferenceScript,
  fingerprintPixels,
  compareFingerprints,
} from "@/features/certmaker/lib/editing/TypographyFingerprintEngine";
function raster(stroke = 3, spacing = 9, color = [34, 85, 187], slant = 0) {
  const w = 100,
    h = 40,
    data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let glyph = 0; glyph < 4; glyph++)
    for (let y = 8; y < 32; y++)
      for (let dx = 0; dx < stroke; dx++) {
        const x = 8 + glyph * (stroke + spacing) + dx + Math.round((32 - y) * slant);
        if (x < 0 || x >= w) continue;
        const p = (y * w + x) * 4;
        data[p] = color[0]!;
        data[p + 1] = color[1]!;
        data[p + 2] = color[2]!;
      }
  return { data, w, h };
}
const fp = (r: ReturnType<typeof raster>) => fingerprintPixels(r.data, r.w, r.h);
describe("visual typography fingerprint", () => {
  it("extracts a serializable bounded fingerprint from actual pixels", () => {
    const f = fp(raster());
    expect(f.version).toBe(1);
    expect(f.mask).toHaveLength(6144);
    expect(f.horizontalProfile).toHaveLength(32);
    expect(f.verticalProfile).toHaveLength(64);
    expect(f.baselineShape).toHaveLength(16);
    expect(f.color).toBe("#2255bb");
    expect(f.opacity).toBeNull();
    expect(f.letterSpacing).toBeGreaterThan(0);
    expect(f.visualDensity).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(f)).strokeWeight).toBe(f.strokeWeight);
  });
  it("measures stroke weight and density rather than trusting a font label", () => {
    const thin = fp(raster(2)),
      heavy = fp(raster(6));
    expect(heavy.strokeWeight).toBeGreaterThan(thin.strokeWeight);
    expect(heavy.visualDensity).toBeGreaterThan(thin.visualDensity);
  });
  it("scores identical visual evidence above changed weight, spacing and color", () => {
    const a = fp(raster());
    expect(compareFingerprints(a, a).total).toBeCloseTo(100);
    expect(compareFingerprints(a, fp(raster(6, 14, [200, 40, 40]))).total).toBeLessThan(95);
  });
  it("measures slant and changing baseline profiles", () => {
    const straight = fp(raster()),
      slanted = fp(raster(3, 9, [34, 85, 187], 0.25));
    expect(Math.abs(slanted.slantAngle)).toBeGreaterThan(Math.abs(straight.slantAngle));
    expect(compareFingerprints(straight, slanted).slant).toBeLessThan(100);
  });
  it("rejects blank, malformed and oversized crops instead of inventing a match", () => {
    expect(() => fingerprintPixels(new Uint8ClampedArray(100 * 40 * 4).fill(255), 100, 40)).toThrow(
      "contrast",
    );
    expect(() => fingerprintPixels(new Uint8ClampedArray(4), 100, 40)).toThrow();
    expect(() => fingerprintPixels(new Uint8ClampedArray(512 * 512 * 4), 512, 512)).toThrow();
  });
  it("accepts known editable opacity while marking opaque-raster opacity as ambiguous", () => {
    const r = raster();
    const f = fingerprintPixels(r.data, r.w, r.h, { opacity: 0.6, color: "#123456" });
    expect(f.opacity).toBe(0.6);
    expect(f.color).toBe("#123456");
    expect(fp(r).uncertainties.some((s) => s.includes("not uniquely"))).toBe(true);
  });
});
it("handles transparent black lettering and distinguishes observable alpha from opaque-paper ambiguity", () => {
  const r = raster(3, 9, [0, 0, 0]);
  for (let p = 0; p < r.w * r.h; p++) {
    if (r.data[p * 4] === 255) {
      r.data[p * 4] = 0;
      r.data[p * 4 + 1] = 0;
      r.data[p * 4 + 2] = 0;
      r.data[p * 4 + 3] = 0;
    } else r.data[p * 4 + 3] = 128;
  }
  const f = fp(r);
  expect(f.foregroundColor).toBe("#000000");
  expect(f.opacity).toBeCloseTo(128 / 255);
  expect(f.color).toBe("#7f7f7f");
});

it("excludes named fonts lacking reference Unicode coverage instead of accepting a silent fallback", () => {
  const faces = [
    { family: "Inter", unicodeRange: "U+0000-00FF, U+0370-03FF" },
    { family: "Great Vibes", unicodeRange: "U+0000-00FF" },
  ];
  expect(coversReferenceScript("Inter", "αβ", faces)).toBe(true);
  expect(coversReferenceScript("Great Vibes", "αβ", faces)).toBe(false);
  expect(coversReferenceScript("Great Vibes", "Rabindra", faces)).toBe(true);
});
