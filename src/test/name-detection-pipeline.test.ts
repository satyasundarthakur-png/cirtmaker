import { describe, expect, it } from "vitest";
import {
  applyAiDetection,
  itemsToFields,
  parseAiResponse,
  type AiItem,
} from "@/features/certmaker/lib/clone-ai";
import { assignCandidateName } from "@/features/certmaker/lib/clone";
import { detectionRows } from "@/features/certmaker/lib/clone-debug";
import { candidateNameIssue } from "@/features/certmaker/lib/clone-name-validation";
import type { CloneSource } from "@/features/certmaker/lib/types";

const page = { w: 1800, h: 1200 };
const ai = (text: string, kind: AiItem["kind"], box: [number, number, number, number]): AiItem => ({
  text,
  kind,
  box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] },
  font: "serif",
  bold: false,
  italic: false,
  align: "center",
  column: "",
});

/** A template where the model labels a body sentence as the name and calls the real name "other". */
const wrongAnswer = () => [
  ai("Certificate of Completion", "other", [300, 80, 700, 130]),
  ai("This is to certify that", "other", [380, 250, 620, 270]),
  ai("Priya Sharma", "other", [350, 300, 650, 360]),
  ai(
    "bearing registration number ABC-123 has successfully completed",
    "name",
    [100, 400, 900, 424],
  ),
  ai("the training course", "other", [380, 440, 620, 460]),
];

describe("name detection pipeline", () => {
  it("rejects body wording the model called a name and finds the real name", () => {
    const { fields, suggestions } = itemsToFields(wrongAnswer(), page, 0);
    const names = fields.filter((f) => f.kind === "name");
    expect(names).toHaveLength(1);
    expect(names[0]?.original).toBe("Priya Sharma");
    expect(names[0]?.detection?.reason).toMatch(/promoted/);
    const body = suggestions.find((f) => f.original.startsWith("bearing"));
    expect(body?.kind).toBe("custom");
    expect(body?.detection).toMatchObject({ accepted: false, rawKind: "name", confidence: 0 });
    expect(body?.detection?.reason).toMatch(/paragraph-like|body wording/);
  });

  it("keeps the name region tight around the name", () => {
    const [name] = itemsToFields(wrongAnswer(), page, 0).fields.filter((f) => f.kind === "name");
    expect(name!.w).toBeLessThan(page.w * 0.35);
    expect(name!.h).toBeLessThan(page.h * 0.08);
  });

  it("applies the 1–6 word and wording rules", () => {
    const box = { x: 600, y: 500, w: 600, h: 60 };
    for (const text of [
      "completed the course",
      "training programme",
      "conducted by the institute",
      "awarded to",
      "registration",
      "number",
      "one two three four five six seven",
    ])
      expect(candidateNameIssue(text, box, page)).not.toBeNull();
    expect(candidateNameIssue("Priya Sharma", box, page)).toBeNull();
    expect(candidateNameIssue("Dr. A. P. J. Abdul Kalam", box, page)).toBeNull();
  });

  it("keeps only the best-scoring candidate when the model reports several", () => {
    const items = [
      ai("Priya Sharma", "name", [350, 300, 650, 360]),
      ai("Dr. Rao", "name", [50, 700, 200, 720]),
      ai("Some wording", "other", [380, 450, 620, 470]),
    ];
    const { fields, suggestions } = itemsToFields(items, page, 0);
    expect(fields.filter((f) => f.kind === "name").map((f) => f.original)).toEqual([
      "Priya Sharma",
    ]);
    expect(suggestions.find((f) => f.original === "Dr. Rao")?.detection?.reason).toMatch(
      /better Candidate name/,
    );
  });

  it("never promotes a body sentence when no real name exists", () => {
    const { fields } = itemsToFields(
      [
        ai("has successfully completed the training", "name", [100, 400, 900, 424]),
        ai("Certificate of Completion", "other", [300, 80, 700, 130]),
      ],
      page,
      0,
    );
    expect(fields.some((f) => f.kind === "name")).toBe(false);
  });

  it("keeps the raw model JSON for the debug view", () => {
    const raw = JSON.stringify({
      items: [{ text: "Priya", kind: "name", box_2d: [300, 350, 360, 650] }],
    });
    const envelope = { choices: [{ message: { content: raw }, finish_reason: "stop" }] };
    const parsed = parseAiResponse(envelope, [], { provider: "groq" });
    expect(parsed.raw).toBe(raw);
    const base: CloneSource = {
      image: "",
      width: 1800,
      height: 1200,
      filename: "x",
      kind: "image",
      fields: [],
      suggestions: [],
    };
    const applied = applyAiDetection(base, parsed.items, { provider: "groq", raw: parsed.raw });
    expect(applied.debug).toEqual({ provider: "groq", raw });
  });

  it("lists every region with type, box and confidence", () => {
    const { fields, suggestions } = itemsToFields(wrongAnswer(), page, 0);
    const rows = detectionRows({
      image: "",
      width: 1800,
      height: 1200,
      filename: "x",
      kind: "image",
      fields,
      suggestions,
    });
    expect(rows).toHaveLength(5);
    const rejected = rows.find((r) => r.status === "rejected");
    expect(rejected).toMatchObject({ rawKind: "name", confidence: 0 });
    expect(rows.find((r) => r.text === "Priya Sharma")).toMatchObject({ kind: "name" });
  });
});

describe("manual candidate name correction", () => {
  const source = (): CloneSource => {
    const { fields, suggestions } = itemsToFields(
      [
        ai("Priya Sharma", "name", [350, 300, 650, 360]),
        ai("Course Host", "other", [400, 700, 600, 740]),
        ai("whole paragraph of wording here", "other", [50, 400, 950, 800]),
      ],
      page,
      0,
    );
    return {
      image: "",
      width: 1800,
      height: 1200,
      filename: "x",
      kind: "image",
      fields,
      suggestions,
    };
  };

  it("makes the clicked text the one Candidate name and demotes the old one", () => {
    const c = source();
    const target = c.suggestions.find((f) => f.original === "Course Host")!;
    const { clone, error } = assignCandidateName(c, target.id);
    expect(error).toBeUndefined();
    const names = clone.fields.filter((f) => f.kind === "name");
    expect(names.map((f) => f.original)).toEqual(["Course Host"]);
    expect(names[0]?.replacement).toBe("{{name}}");
    expect(names[0]?.detection).toMatchObject({
      source: "manual",
      accepted: true,
      confidence: 100,
    });
    const old = clone.fields.find((f) => f.original === "Priya Sharma");
    expect(old?.kind).toBe("custom");
    expect(clone.suggestions.some((f) => f.id === target.id)).toBe(false);
  });

  it("refuses a paragraph-sized region", () => {
    const c = source();
    const big = c.suggestions.find((f) => f.original.startsWith("whole paragraph"))!;
    const r = assignCandidateName(c, big.id);
    expect(r.error).toMatch(/paragraph-sized/);
    expect(r.clone).toBe(c);
  });
});
