import { describe, expect, it } from "vitest";
import { buildLines, detectFields, type RawItem } from "@/features/certmaker/lib/clone-detect";

const PAGE = { w: 2000, h: 1414 };
const CH = 14; // pixel width per character in these fixtures

/** A text fragment `text` whose left edge is `x` (or centred on the page when x is omitted). */
function item(text: string, y: number, opts: { x?: number; h?: number } = {}): RawItem {
  const h = opts.h ?? 30;
  const w = text.length * CH * (h / 30);
  return { text, x: opts.x ?? (PAGE.w - w) / 2, y, w, h, size: h * 0.85 };
}

const detect = (items: RawItem[]) => detectFields(buildLines(items), PAGE);

describe("buildLines", () => {
  it("joins fragments on one baseline and keeps far-apart columns separate", () => {
    const lines = buildLines([item("Date:", 1200, { x: 100 }), item("12/03/2026", 1202, { x: 100 + 5 * CH + 10 }), item("Director", 1200, { x: 1500 })]);
    expect(lines.map((l) => l.text)).toEqual(["Date: 12/03/2026", "Director"]);
  });
  it("orders lines top to bottom", () => {
    const lines = buildLines([item("second", 600), item("first", 100)]);
    expect(lines.map((l) => l.text)).toEqual(["first", "second"]);
  });
  it("ignores empty fragments", () => {
    expect(buildLines([item("   ", 100), item("kept", 200)]).map((l) => l.text)).toEqual(["kept"]);
  });
});

describe("detectFields", () => {
  const typical = [
    item("CERTIFICATE OF ACHIEVEMENT", 200, { h: 70 }),
    item("This certificate is proudly presented to", 420),
    item("Candidate Name", 500, { h: 60 }),
    item("for successfully completing", 620),
    item("Advanced Anaesthesia Workshop", 700, { h: 40 }),
    item("Date: 12 March 2026", 1200, { x: 200 }),
    item("Certificate No: CERT-2026-001", 1200, { x: 1250 }),
    item("Director", 1300, { x: 300 }),
  ];

  it("finds name, course, date and certificate number, and nothing else", () => {
    const { fields, rest } = detect(typical);
    expect(fields.map((f) => [f.kind, f.text])).toEqual([
      ["name", "Candidate Name"],
      ["course", "Advanced Anaesthesia Workshop"],
      ["date", "12 March 2026"],
      ["certId", "CERT-2026-001"],
    ]);
    // title, cue lines and the signature caption stay as locked artwork
    expect(rest.map((l) => l.text)).toEqual(expect.arrayContaining(["CERTIFICATE OF ACHIEVEMENT", "Director"]));
    expect(rest.map((l) => l.text)).not.toContain("Candidate Name");
  });

  it("limits a label: value field to the value so the label stays untouched", () => {
    const { fields } = detect(typical);
    const date = fields.find((f) => f.kind === "date");
    const label = typical.find((i) => i.text.startsWith("Date:"));
    expect(date).toBeDefined();
    expect(date!.box.x).toBeGreaterThan(label!.x + 4 * CH);
  });

  it("treats the line after 'presented to' as the name even when it is a real name", () => {
    const { fields } = detect([item("is hereby awarded to", 400), item("Priya Sharma", 480, { h: 60 })]);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: "name", text: "Priya Sharma" });
  });

  it("does not treat a cue as valid for a line far below it", () => {
    const { fields } = detect([item("presented to", 300), item("Some unrelated footer line", 1100)]);
    expect(fields.find((f) => f.kind === "name" && !f.guess)).toBeUndefined();
  });

  it("recognises placeholders and the kind they stand for", () => {
    const { fields } = detect([item("{{name}}", 500), item("[Course Name]", 700), item("Candidate Name", 900), item("DD/MM/YYYY", 1100, { x: 200 })]);
    expect(fields.map((f) => f.kind)).toEqual(["name", "course", "name", "date"]);
  });

  it("keeps unknown placeholders as custom fields labelled with their text", () => {
    const { fields } = detect([item("[Grade Obtained]", 800)]);
    expect(fields[0]).toMatchObject({ kind: "custom", label: "[Grade Obtained]" });
  });

  it("recognises date formats on short lines", () => {
    for (const text of ["12/03/2026", "2026-03-12", "12th March, 2026", "March 12, 2026", "Dated 5 Jan 2026"]) {
      const { fields } = detect([item(text, 1100, { x: 200 })]);
      expect(fields[0]?.kind, text).toBe("date");
    }
  });

  it("recognises certificate-number shapes but not ordinary words", () => {
    expect(detect([item("CERT-2026-001", 1100, { x: 200 })]).fields[0]?.kind).toBe("certId");
    expect(detect([item("ABC/2026/0042", 1100, { x: 200 })]).fields[0]?.kind).toBe("certId");
    expect(detect([item("ISO 9001 certified", 1100, { x: 200 })]).fields).toHaveLength(0);
  });

  it("does not turn a long paragraph that mentions a date into a field", () => {
    const text = "This workshop was held on 12 March 2026 at the main auditorium with great success and participation";
    expect(detect([item(text, 900)]).fields).toHaveLength(0);
  });

  it("guesses the name only when nothing else identified it, and marks it as a guess", () => {
    const { fields } = detect([item("CERTIFICATE OF EXCELLENCE", 200, { h: 60 }), item("Priya Sharma", 600, { h: 80 }), item("in recognition of dedication", 800), item("Hyderabad", 1100, { x: 200 })]);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ kind: "name", text: "Priya Sharma", guess: true });
  });

  it("returns nothing editable for a certificate with no recognisable text", () => {
    expect(detect([]).fields).toEqual([]);
  });
});
