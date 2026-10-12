import * as aiTransport from "@/features/certmaker/lib/clone-ai";
import { describe, it, expect, vi } from "vitest";
import {
  cloneField,
  patchField,
  removeField,
  setLayerLock,
  autoMapFields,
} from "@/features/certmaker/lib/clone";
import { AIEditingEngine } from "@/features/certmaker/lib/editing/AIEditingEngine";
import { SelectionManager } from "@/features/certmaker/lib/editing/SelectionManager";
import { CommandParser } from "@/features/certmaker/lib/editing/CommandParser";
import { StyleMatchEngine } from "@/features/certmaker/lib/editing/StyleMatchEngine";
import { EditHistoryManager } from "@/features/certmaker/lib/editing/EditHistoryManager";
import { PreviewRenderer } from "@/features/certmaker/lib/editing/PreviewRenderer";
import { LayerInspector } from "@/features/certmaker/lib/editing/LayerInspector";
import {
  templateLayers,
  applyTemplateLayers,
} from "@/features/certmaker/lib/editing/TemplateAdapter";
import { certForRow } from "@/features/certmaker/lib/merge";
import { DEFAULT_DATA, type CloneSource } from "@/features/certmaker/lib/types";
const source = (): CloneSource => ({
  image: "locked-artwork",
  width: 1000,
  height: 600,
  filename: "test.png",
  kind: "image",
  fields: [
    cloneField("{{name}}", 50, 70, 250, 40, 0),
    { ...cloneField("Course", 400, 170, 250, 40, 1), font: "Montserrat", color: "#123456" },
  ],
  suggestions: [],
});
const selection = (c: CloneSource, ids = ["clone-0"]) => SelectionManager.resolve(c, ids);
function edit(c: CloneSource, instruction: string, ids?: string[]) {
  const parsed = CommandParser.local(instruction);
  expect(parsed).not.toBeNull();
  return AIEditingEngine.plan(c, selection(c, ids), parsed!);
}
describe("selection-aware editing acceptance", () => {
  it("detects current objects, multi-selection and rotated hit areas without manual IDs", () => {
    const c = source();
    expect(SelectionManager.hitTest(c, 100, 90)).toBe("clone-0");
    let s = selection(c);
    s = selection(c, SelectionManager.select(s, "clone-1", true));
    expect(s.ids).toHaveLength(2);
    expect(SelectionManager.select(s, "clone-0", true)).toEqual(["clone-1"]);
    expect(SelectionManager.resolve(c, ["missing", "clone-0", "clone-0"]).ids).toEqual(["clone-0"]);
  });
  it.each([
    ["replace with Rabindra", "Rabindra"],
    ['Replace this with "Rabindra"', "Rabindra"],
  ])("previews %s before applying", (instruction, value) => {
    const c = source(),
      plan = edit(c, instruction);
    expect(c.fields[0]?.replacement).toBe("{{name}}");
    expect(plan.changes[0]?.before?.replacement).toBe("{{name}}");
    expect(plan.changes[0]?.after?.replacement).toBe(value);
    expect(AIEditingEngine.apply(c, plan).fields[0]?.replacement).toBe(value);
    expect(plan.next.image).toBe(c.image);
  });
  it.each(["move 10px down", "Move slightly down"])(
    "moves unchanged original text and retains its erase anchor: %s",
    (instruction) => {
      const c = source(),
        p = edit(c, instruction);
      expect(p.next.fields[0]).toMatchObject({
        y: 80,
        redraw: true,
        sourceBox: { x: 50, y: 70, w: 250, h: 40 },
      });
      const later = edit(p.next, "move 10px down");
      expect(later.next.fields[0]?.sourceBox?.y).toBe(70);
    },
  );
  it("matches selected style, offers ranked candidates and avoids decorative guesses", () => {
    const c = source();
    const s = selection(c);
    s.reference = "clone-1";
    const p = AIEditingEngine.plan(c, s, [{ type: "match" }]);
    expect(p.next.fields[0]).toMatchObject({ font: "Montserrat", color: "#123456" });
    const matches = StyleMatchEngine.rank(c.fields[1]!);
    expect(matches[0]).toMatchObject({ font: "Montserrat", score: 100 });
    expect(matches).toHaveLength(8);
    expect(matches.some((m) => m.font === "Great Vibes")).toBe(false);
    const reference = {
      ...c.fields[1]!,
      fontWeight: 600,
      italic: true,
      letterSpacing: 2,
      lineHeight: 1.5,
      opacity: 0.5,
    };
    expect(StyleMatchEngine.extract(reference)).toMatchObject({
      fontWeight: 600,
      italic: true,
      letterSpacing: 2,
      lineHeight: 1.5,
      opacity: 0.5,
    });
  });
  it("duplicates, adds, rotates, resizes and deletes with reversible previews", () => {
    const c = source();
    const duplicate = edit(c, "duplicate this");
    expect(duplicate.next.fields).toHaveLength(3);
    expect(duplicate.next.fields[2]).toMatchObject({ original: "", erase: "none" });
    expect(edit(c, 'add text "New heading"').next.fields.at(-1)?.replacement).toBe("New heading");
    expect(edit(c, "rotate this 15 degrees").next.fields[0]?.rotation).toBe(15);
    expect(edit(c, "make this larger").next.fields[0]!.w).toBeCloseTo(287.5);
    const deleted = edit(c, "remove this text layer");
    expect(deleted.next.fields[0]).toMatchObject({
      deleted: true,
      replacement: "",
      erase: "smart",
    });
    const h = new EditHistoryManager(c);
    h.commit(deleted.next);
    expect(h.undo()).toBe(c);
    expect(h.redo()).toBe(deleted.next);
  });
  it("aligns several selected layers horizontally and preserves CSV tokens", () => {
    const c = source(),
      p = edit(c, "align horizontally", ["clone-0", "clone-1"]);
    expect(p.next.fields[0]!.y + p.next.fields[0]!.h / 2).toBe(
      p.next.fields[1]!.y + p.next.fields[1]!.h / 2,
    );
    expect(p.next.fields[0]?.replacement).toBe("{{name}}");
    expect(
      edit(c, 'replace all selected names with "{{student}}"', [
        "clone-0",
        "clone-1",
      ]).next.fields.every((f) => f.replacement === "{{student}}"),
    ).toBe(true);
    expect(LayerInspector.inspect(c.fields[0]!).tokens).toEqual(["name"]);
  });
  it("rejects unknown properties, field escape, unlocking and stale previews", () => {
    const c = source();
    expect(() =>
      CommandParser.parseResponse(
        '{"explanation":"","commands":[{"type":"style","style":{"image":"bad"}}]}',
      ),
    ).toThrow();
    expect(() =>
      AIEditingEngine.plan(c, selection(c), [
        { type: "replace", text: "bad", targets: ["clone-1"] },
      ]),
    ).toThrow("current selection");
    expect(() =>
      CommandParser.parseResponse('{"explanation":"","commands":[{"type":"unlock"}]}'),
    ).toThrow();
    const p = edit(c, "replace with Rabindra");
    expect(() => AIEditingEngine.apply(patchField(c, "clone-1", { color: "#ffffff" }), p)).toThrow(
      "stale",
    );
  });
  it("locks text and enforces protection at all mutation boundaries", () => {
    const c = source();
    c.fields[0]!.locked = true;
    expect(() => edit(c, "replace with Rabindra")).toThrow("locked");
    expect(patchField(c, "clone-0", { replacement: "bad" }).fields[0]).toBe(c.fields[0]);
    expect(removeField(c, "clone-0")).toBe(c);
    expect(autoMapFields(c).fields[0]?.replacement).toBe("{{name}}");
    expect(setLayerLock(c, "clone-0", false).fields[0]?.locked).toBe(false);
    c.fields[0]!.protection = "signature";
    expect(setLayerLock(c, "clone-0", false).fields[0]?.locked).toBe(true);
    expect(() =>
      AIEditingEngine.plan(c, selection(c, ["clone-1"]), [{ type: "move", dx: -200, dy: -100 }]),
    ).toThrow("overlaps");
  });
  it("rejects an entire bulk plan if any selected layer is locked", () => {
    const c = source();
    c.fields[1]!.locked = true;
    expect(() =>
      edit(c, "replace all selected fields with Rabindra", ["clone-0", "clone-1"]),
    ).toThrow();
    expect(c.fields[0]?.replacement).toBe("{{name}}");
  });
  it("handles unlimited undo, redo, rollback and branches", () => {
    const h = new EditHistoryManager(0);
    for (let i = 1; i <= 300; i++) h.commit(i);
    expect(h.length).toBe(301);
    for (let i = 0; i < 300; i++) h.undo();
    expect(h.present).toBe(0);
    h.rollback(120);
    expect(h.present).toBe(120);
    expect(h.redo()).toBe(121);
    h.commit(900);
    expect(h.canRedo).toBe(false);
    expect(() => h.rollback(-1)).toThrow();
  });
  it("diffs additions, deletions and style properties without state changes", () => {
    const c = source();
    const next = patchField(c, "clone-0", { color: "#abcdef" });
    const diff = PreviewRenderer.diff(c, next);
    expect(diff[0]?.properties).toContain("color");
    expect(c.fields[0]?.color).not.toBe("#abcdef");
  });
  it("adapts native template fields and substitutes CSV overlay tokens", () => {
    const base = { ...DEFAULT_DATA, recipient: "{{name}}" };
    const c = templateLayers(base);
    const sel = SelectionManager.resolve(c, ["recipient"]);
    const p = AIEditingEngine.plan(c, sel, [
      { type: "replace", text: "{{student}}" },
      { type: "move", dx: 0, dy: 10 },
    ]);
    const updated = applyTemplateLayers(base, AIEditingEngine.apply(templateLayers(base), p));
    expect(updated.recipient).toBe("{{student}}");
    expect(
      certForRow(updated, { name: "Rabindra" }, 0).textLayers?.find((f) => f.id === "recipient")
        ?.replacement,
    ).toBe("Rabindra");
    expect(updated.logo).toBe(base.logo);
    expect(updated.certId).toBe(base.certId);
  });
  it("does not send local acceptance commands to a provider", async () => {
    const c = source();
    const plan = await AIEditingEngine.instruct({
      clone: c,
      selection: selection(c),
      instruction: "replace with Rabindra",
      variables: [],
      provider: "gemini",
      apiKey: "",
      model: "",
      consent: false,
    });
    expect(plan.next.fields[0]?.replacement).toBe("Rabindra");
  });
});

it("native body edits preserve protected seal/signature zones even when selection bounds already overlap", () => {
  const base = { ...DEFAULT_DATA };
  const c = templateLayers(base);
  const p = AIEditingEngine.plan(c, SelectionManager.resolve(c, ["body"]), [
    { type: "replace", text: "This is revised wording." },
  ]);
  expect(applyTemplateLayers(base, p.next).body).toBe("This is revised wording.");
  expect(p.next.suggestions.some((f) => f.protection === "security")).toBe(true);
});
it("bulk name replacement edits selected name fields only and keeps selected courses intact", async () => {
  const c = source();
  c.fields[0]!.kind = "name";
  const p = await AIEditingEngine.instruct({
    clone: c,
    selection: selection(c, ["clone-0", "clone-1"]),
    instruction: 'Replace all selected names with "Rabindra"',
    variables: [],
    provider: "gemini",
    apiKey: "",
    model: "",
    consent: false,
  });
  expect(p.next.fields[0]?.replacement).toBe("Rabindra");
  expect(p.next.fields[1]?.replacement).toBe("Course");
});

it("remote planning sends only the selected objects and returns a preview without applying", async () => {
  const c = source();
  const transport = vi.spyOn(aiTransport, "requestEditText").mockResolvedValue(
    JSON.stringify({
      explanation: "Use requested name",
      commands: [{ type: "replace", text: "Rabindra" }],
    }),
  );
  try {
    const p = await AIEditingEngine.instruct({
      clone: c,
      selection: selection(c),
      instruction: "Please rewrite the selected name as Rabindra and retain its typography",
      variables: ["name"],
      provider: "gemini",
      apiKey: "key",
      model: "test",
      consent: true,
    });
    expect(c.fields[0]?.replacement).toBe("{{name}}");
    expect(p.next.fields[0]?.replacement).toBe("Rabindra");
    const prompt = transport.mock.calls[0]![0].prompt;
    expect(prompt).not.toContain("locked-artwork");
    expect(prompt).not.toContain('"original":"Course"');
    expect(prompt).not.toContain("test.png");
  } finally {
    transport.mockRestore();
  }
});
it("remote planning cannot target another field or edit locked selection", async () => {
  const c = source();
  const transport = vi.spyOn(aiTransport, "requestEditText").mockResolvedValue(
    JSON.stringify({
      explanation: "bad target",
      commands: [{ type: "replace", text: "bad", targets: ["clone-1"] }],
    }),
  );
  const options = {
    clone: c,
    selection: selection(c),
    instruction: "Please change this into something else",
    variables: [],
    provider: "gemini" as const,
    apiKey: "key",
    model: "test",
    consent: true,
  };
  try {
    await expect(AIEditingEngine.instruct(options)).rejects.toThrow("current selection");
    c.fields[0]!.locked = true;
    transport.mockClear();
    await expect(AIEditingEngine.instruct(options)).rejects.toThrow("protected");
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});
it("matches Odia to a script-supported face and offers weight alternatives rather than Latin fallbacks", () => {
  const reference = { ...source().fields[0]!, replacement: "ରବୀନ୍ଦ୍ର", font: "Inter" };
  const matches = StyleMatchEngine.rank(reference);
  expect(matches).toHaveLength(3);
  expect(matches.every((m) => m.font === "Noto Sans Oriya")).toBe(true);
  expect(new Set(matches.map((m) => m.style.fontWeight)).size).toBe(3);
});
