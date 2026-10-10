import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SIDE_PX, PROFILES, clampDpi, pixelWidth, svgWrap } from "@/features/certmaker/lib/exporter-utils";
import { applyKit, kitFrom } from "@/features/certmaker/lib/brand";
import { DEFAULT_DATA } from "@/features/certmaker/lib/types";
import { certForRow } from "@/features/certmaker/lib/merge";

describe("export profiles", () => {
  it("computes pixel width from paper size and dpi", () => {
    expect(pixelWidth("a4", 300)).toBe(3508);
    expect(pixelWidth("letter", 300)).toBe(3300);
  });
  it("clamps dpi and never exceeds the memory cap", () => {
    expect(clampDpi(10)).toBe(72);
    expect(clampDpi(9999)).toBe(600);
    expect(clampDpi(Number.NaN)).toBe(300);
    expect(pixelWidth("a4", 600)).toBeLessThanOrEqual(MAX_SIDE_PX);
  });
  it("ships print, web and high-res presets within limits", () => {
    expect(PROFILES.map((p) => p.id)).toEqual(["print", "web", "highres"]);
    for (const p of PROFILES) expect(pixelWidth("a4", p.dpi)).toBeLessThanOrEqual(MAX_SIDE_PX);
  });
  it("wraps an image as an SVG at physical size", () => {
    const svg = svgWrap("data:image/png;base64,AAAA", 297, 210, 3508, 2480);
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('viewBox="0 0 3508 2480"');
    expect(svg).toContain("data:image/png;base64,AAAA");
  });
});

describe("brand kits", () => {
  beforeEach(() => undefined);
  it("copies identity and look but leaves the wording alone", () => {
    const src = { ...DEFAULT_DATA, org: "Eye Institute", address: "Hyderabad", accent: "#123456", fontSet: "classic" as const, template: "royal", title: "Source title", sigImgs: ["data:a", ""] };
    const kit = kitFrom(src, "  Main  ");
    expect(kit.name).toBe("Main");
    const target = applyKit({ ...DEFAULT_DATA, title: "Keep me", recipient: "Keep too" }, kit);
    expect(target).toMatchObject({ org: "Eye Institute", address: "Hyderabad", accent: "#123456", fontSet: "classic", template: "royal", title: "Keep me", recipient: "Keep too" });
    expect(target.sigImgs[0]).toBe("data:a");
  });
  it("does not carry a reference-image template into a kit", () => {
    expect(kitFrom({ ...DEFAULT_DATA, template: "inspired" }, "x").template).toBe("classic");
  });
  it("exposes the saved address as a {{address}} variable", () => {
    const c = certForRow({ ...DEFAULT_DATA, address: "Banjara Hills", body: "Held at {{address}}" }, { name: "A" }, 0);
    expect(c.body).toBe("Held at Banjara Hills");
  });
});
