import { describe, expect, it } from "vitest";
import { certForRow, fill, missingVariables, normaliseHeader, parseDataset, parseDelimited, variablesIn } from "@/features/certmaker/lib/merge";
import { DEFAULT_DATA } from "@/features/certmaker/lib/types";

describe("parseDelimited", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines", () => {
    const t = parseDelimited('Name,Course\n"Rao, K.","Intro ""AI""\nPart 2"\n');
    expect(t).toEqual([["Name", "Course"], ["Rao, K.", 'Intro "AI"\nPart 2']]);
  });
  it("detects semicolon and tab delimiters and strips a BOM", () => {
    expect(parseDelimited("\uFEFFa;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseDataset", () => {
  it("maps header columns to variables with aliases", () => {
    const ds = parseDataset("Name,Program,Marks,Date\nAsha,Anaesthesia,92,1 Jan 2026");
    expect(ds.headers).toEqual(["name", "course", "score", "date"]);
    expect(ds.rows[0]).toMatchObject({ name: "Asha", course: "Anaesthesia", score: "92" });
  });
  it("keeps supporting a plain list of names", () => {
    const ds = parseDataset("Asha\nRavi\n\nPriya");
    expect(ds.rows.map((r) => r.name)).toEqual(["Asha", "Ravi", "Priya"]);
  });
  it("supports unlimited custom columns", () => {
    const ds = parseDataset("Name,Mentor,Hours\nA,Dr X,12");
    expect(ds.headers).toContain("mentor");
    expect(fill("{{ Mentor }} / {{hours}}", ds.rows[0]!)).toBe("Dr X / 12");
  });
});

describe("variables", () => {
  it("finds, normalises and reports unknown variables", () => {
    expect(variablesIn("{{Name}} got {{ Final Grade }}")).toEqual(["name", "final_grade"]);
    const d = { ...DEFAULT_DATA, body: "Scored {{score}} ({{final_grade}})" };
    expect(missingVariables(d, parseDataset("Name,Score\nA,9"))).toEqual(["final_grade"]);
  });
  it("leaves unknown variables visible instead of blanking them", () => {
    expect(fill("Hi {{nope}}", {})).toBe("Hi {{nope}}");
  });
});

describe("certForRow", () => {
  const base = { ...DEFAULT_DATA, certId: "CERT-2026-001", body: "for completing {{course}} with {{score}}%", date: "5 May 2026" };
  it("fills text, uses the name column and counts up certificate IDs", () => {
    const a = certForRow(base, { name: "Asha", course: "ICU", score: "92" }, 0);
    const b = certForRow(base, { name: "Ravi", course: "ICU", score: "88" }, 1);
    expect(a.recipient).toBe("Asha");
    expect(a.body).toBe("for completing ICU with 92%");
    expect([a.certId, b.certId]).toEqual(["CERT-2026-001", "CERT-2026-002"]);
  });
  it("lets a row override the certificate id and date", () => {
    const c = certForRow(base, { name: "X", certificate_id: "XYZ-9", date: "1 Jan 2027" }, 5);
    expect(c.certId).toBe("XYZ-9");
    expect(c.date).toBe("1 Jan 2027");
  });
  it("keeps organisation/date built-ins available inside the template", () => {
    const c = certForRow({ ...base, subtitle: "From {{organization}} on {{date}}" }, { name: "A" }, 0);
    expect(c.subtitle).toBe(`From ${base.org} on 5 May 2026`);
  });
  it("normalises header spacing", () => {
    expect(normaliseHeader(" Certificate ID ")).toBe("certificate_id");
  });
});

describe("header handling", () => {
  it("recognises common name column titles", () => {
    for (const h of ["Student Name", "Participant Name", "Candidate", "Attendee"]) {
      expect(parseDataset(`${h},Course\nAsha,AI`).rows[0]?.name).toBe("Asha");
    }
  });
  it("keeps repeated column titles instead of overwriting", () => {
    const ds = parseDataset("Name,Score,Score\nAsha,80,90");
    expect(ds.headers).toEqual(["name", "score", "score_2"]);
    expect(ds.rows[0]?.["score"]).toBe("80");
    expect(ds.rows[0]?.["score_2"]).toBe("90");
  });
});
