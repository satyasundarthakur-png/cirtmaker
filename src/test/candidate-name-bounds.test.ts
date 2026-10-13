import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLines, detectFields, type RawItem } from "@/features/certmaker/lib/clone-detect";
import { candidateNameIssue, logDetection } from "@/features/certmaker/lib/clone-name-validation";
import { itemsToFields } from "@/features/certmaker/lib/clone-ai";
import { fieldFromDetected } from "@/features/certmaker/lib/clone";
const page = { w: 1000, h: 700 };
const item = (text: string, y: number, h = 24, w = 300): RawItem => ({
  text,
  x: 200,
  y,
  w,
  h,
  size: h * 0.85,
});
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});
describe("Candidate Name safety", () => {
  it("rejects body wording following a name cue and keeps it protected", () => {
    const text = "bearing registration number ABC-123 completed the course";
    const result = detectFields(
      buildLines([item("This is to certify that", 200), item(text, 240)]),
      page,
    );
    expect(result.fields.some((f) => f.kind === "name")).toBe(false);
    expect(result.rest.some((f) => f.text === text)).toBe(true);
  });
  it("rejects the reported 554 × 275 paragraph region even if its label says name", () => {
    expect(candidateNameIssue("Rabindra", { x: 200, y: 200, w: 554, h: 275 }, page)).toBe(
      "paragraph-sized name rectangle",
    );
    expect(() =>
      fieldFromDetected(
        {
          kind: "name",
          label: "Candidate name",
          text: "Rabindra",
          box: { x: 200, y: 200, w: 554, h: 275 },
          size: 30,
          fontHint: "",
        },
        "clone-0",
        page,
      ),
    ).toThrow("Unsafe Candidate name detection");
  });
  it("does not merge a tall OCR paragraph with a neighbouring name", () => {
    const lines = buildLines([
      item("Rabindra Thakur", 200, 28, 220),
      item("bearing registration number and completing the course", 160, 275, 554),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.text === "Rabindra Thakur")?.h).toBe(28);
  });
  it("detects only a genuine single-line name after the cue", () => {
    const result = detectFields(
      buildLines([
        item("presented to", 160),
        item("Rabindra Thakur", 200, 28, 220),
        item("bearing registration number ABC-123", 240),
      ]),
      page,
    );
    expect(result.fields.filter((f) => f.kind === "name")).toEqual([
      expect.objectContaining({ text: "Rabindra Thakur", box: { x: 200, y: 200, w: 220, h: 28 } }),
    ]);
  });
  it("retains static label text when extracting a name span", () => {
    const result = detectFields(
      buildLines([item("Candidate name: Rabindra Thakur", 200, 28, 360)]),
      page,
    );
    expect(result.fields[0]?.text).toBe("Rabindra Thakur");
    expect(result.rest.some((l) => l.text === "Candidate name:")).toBe(true);
    const detected = result.fields[0]!;
    expect(fieldFromDetected(detected, "clone-0", page).detectionBox).toEqual(detected.box);
  });
  it.each([
    "bearing registration number ABC-123",
    "Rabindra Sharma has completed the course",
    "one two three four five six seven eight nine",
  ])("demotes unsafe AI name %s to protected text", (text) => {
    const result = itemsToFields(
      [
        {
          text,
          kind: "name",
          box: { x0: 200, y0: 200, x1: 754, y1: 593 },
          font: "sans",
          bold: false,
          italic: false,
          align: "left",
          column: "Name",
        },
      ],
      page,
      0,
    );
    expect(result.fields).toHaveLength(0);
    expect(result.suggestions[0]?.replacement).toBe(text);
  });
  it("logs geometry, text, assignment and confidence only when opted in", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const entry = {
      text: "Rabindra",
      kind: "name",
      box: { x: 10, y: 20, w: 100, h: 30 },
      confidence: 90,
      stage: "classification",
    };
    logDetection(entry);
    expect(debug).not.toHaveBeenCalled();
    sessionStorage.setItem("certmaker:debug-detection", "1");
    logDetection(entry);
    expect(debug).toHaveBeenCalledWith(
      "[certmaker:detection]",
      expect.objectContaining({
        detectedText: "Rabindra",
        fieldType: "name",
        x: 10,
        y: 20,
        w: 100,
        h: 30,
        confidence: 90,
      }),
    );
  });
});
