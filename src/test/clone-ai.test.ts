import { describe, expect, it, vi } from "vitest";
import { AiError, applyAiDetection, buildPrompt, buildRequest, detectWithGemini, itemsToFields, loadKey, parseAiResponse, saveKey, type AiItem } from "@/features/certmaker/lib/clone-ai";
import { cloneField } from "@/features/certmaker/lib/clone";
import type { CloneSource } from "@/features/certmaker/lib/types";

const envelope = (payload: unknown, wrap = false) => ({
  candidates: [{ content: { parts: [{ text: wrap ? "```json\n" + JSON.stringify(payload) + "\n```" : JSON.stringify(payload) }] }, finishReason: "STOP" }],
});
const item = (over: Record<string, unknown> = {}) => ({ text: "Priya Sharma", kind: "name", box_2d: [400, 250, 500, 750], font: "serif", bold: false, italic: true, align: "center", column: "", ...over });

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
}
const opts = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof detectWithGemini>[0]> = {}) => ({ apiKey: "KEY-123", model: "gemini-3.6-flash", imageBase64: "AAAA", headers: ["Name", "Course"], fetchImpl, ...over });

describe("request", () => {
  it("sends the image inline, asks for JSON, and sends no sampling parameters", () => {
    const req = buildRequest("QUJD", ["Name"]);
    const parts = req.contents[0]?.parts ?? [];
    expect(parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
    expect(req.generationConfig).toEqual({ responseMimeType: "application/json" });
    expect(JSON.stringify(req)).not.toMatch(/temperature|top_p|top_k/i);
  });
  it("tells the model to leave artwork alone, read text only, and use only the column names given", () => {
    const withCols = buildPrompt(["Student Name", "Course"]);
    expect(withCols).toContain('"Student Name"');
    expect(withCols).toMatch(/never around decorations/);
    expect(buildPrompt([])).toMatch(/no spreadsheet/);
  });
});

describe("parseAiResponse", () => {
  it("reads a normal answer, including JSON wrapped in code fences", () => {
    expect(parseAiResponse(envelope({ items: [item()] })).items).toHaveLength(1);
    expect(parseAiResponse(envelope({ items: [item()] }, true)).items).toHaveLength(1);
    expect(parseAiResponse(envelope([item()])).items).toHaveLength(1);
  });
  it("normalises kinds, fonts and column names", () => {
    const { items } = parseAiResponse(envelope({ items: [item({ kind: "Certificate Number", font: "Sans Serif", column: " course " })] }), ["Name", "Course"]);
    expect(items[0]).toMatchObject({ kind: "certId", font: "sans", column: "Course" });
  });
  it("ignores columns the user does not have and treats unknown kinds as static text", () => {
    const { items } = parseAiResponse(envelope({ items: [item({ kind: "heading", column: "Invented" })] }), ["Name"]);
    expect(items[0]).toMatchObject({ kind: "other", column: "" });
  });
  it("drops malformed items instead of trusting them, and says how many", () => {
    const bad = [item({ box_2d: [10, 10, 5, 5] }), item({ box_2d: [1, 2, 3] }), item({ text: "" }), item({ text: "x".repeat(400) }), "nope", item({ box_2d: ["a", "b", "c", "d"] })];
    const r = parseAiResponse(envelope({ items: [item(), ...bad] }));
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(bad.length);
  });
  it("clamps out-of-range coordinates into the image", () => {
    const { items } = parseAiResponse(envelope({ items: [item({ box_2d: [-50, -50, 1200, 1200] })] }));
    expect(items[0]?.box).toEqual({ x0: 0, y0: 0, x1: 1000, y1: 1000 });
  });
  it("fails clearly on unusable answers", () => {
    for (const bad of [{}, null, "text", { candidates: [] }, envelope({ nothing: true }), { candidates: [{ content: { parts: [{ text: "not json" }] } }] }, envelope({ items: [] })]) {
      expect(() => parseAiResponse(bad)).toThrow(AiError);
    }
  });
  it("reports blocked content", () => {
    expect(() => parseAiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrowError(expect.objectContaining({ code: "blocked" }));
  });
});

describe("itemsToFields", () => {
  const page = { w: 2000, h: 1000 };
  const parse = (raw: unknown[], headers: string[] = []): AiItem[] => parseAiResponse(envelope({ items: raw }), headers).items;

  it("converts 0–1000 boxes to pixels and splits editable fields from other text", () => {
    const { fields, suggestions } = itemsToFields(parse([item(), item({ text: "Director", kind: "other", box_2d: [900, 100, 950, 300], align: "left" })]), page, 0);
    expect(fields).toHaveLength(1);
    expect(suggestions).toHaveLength(1);
    const f = fields[0]!;
    // box [ymin 400, xmin 250, ymax 500, xmax 750] on 2000x1000 → x 500, y 400, w 1000, h 100 (plus a few px of padding)
    expect(f.x).toBeLessThanOrEqual(500);
    expect(500 - f.x).toBeLessThan(25);
    expect(f.x + f.w).toBeGreaterThanOrEqual(1500);
    expect(f.y).toBeLessThanOrEqual(400);
    expect(f.y + f.h).toBeGreaterThanOrEqual(500);
    expect(f).toMatchObject({ kind: "name", label: "Candidate name", original: "Priya Sharma", replacement: "Priya Sharma", align: "center", italic: true });
    expect(suggestions[0]).toMatchObject({ original: "Director", kind: "custom" });
  });
  it("points matched fields at their CSV column", () => {
    const { fields } = itemsToFields(parse([item({ column: "Name" })], ["Name"]), page, 0);
    expect(fields[0]?.replacement).toBe("{{Name}}");
    expect(fields[0]?.original).toBe("Priya Sharma");
  });
  it("numbers ids from the given start so they never collide", () => {
    const { fields, suggestions } = itemsToFields(parse([item(), item({ kind: "other", box_2d: [10, 10, 60, 200] })]), page, 7);
    expect([...fields, ...suggestions].map((f) => f.id).sort()).toEqual(["clone-7", "clone-8"]);
  });
});

describe("applyAiDetection", () => {
  const manual = { ...cloneField("", 100, 100, 200, 40, 3), id: "clone-3", replacement: "Hand-made box", cover: "" };
  const clone: CloneSource = {
    image: "x", width: 2000, height: 1000, filename: "t.png", kind: "image",
    fields: [{ ...cloneField("Old detected", 10, 10, 100, 30, 0), id: "clone-0" }, manual],
    suggestions: [{ ...cloneField("Old other", 10, 500, 100, 30, 1), id: "clone-1" }],
  };
  it("replaces detected boxes but keeps the ones the user added by hand", () => {
    const next = applyAiDetection(clone, parseAiResponse(envelope({ items: [item(), item({ kind: "other", text: "Footer", box_2d: [900, 100, 950, 400] })] })).items);
    expect(next.fields.map((f) => f.original)).toEqual(expect.arrayContaining(["Priya Sharma", ""]));
    expect(next.fields.some((f) => f.original === "Old detected")).toBe(false);
    expect(next.fields.find((f) => f.id === "clone-3")?.replacement).toBe("Hand-made box");
    expect(next.suggestions.map((f) => f.original)).toEqual(["Footer"]);
    expect(new Set([...next.fields, ...next.suggestions].map((f) => f.id)).size).toBe(next.fields.length + next.suggestions.length);
    expect(next.image).toBe("x");
  });
});

describe("detectWithGemini", () => {
  const good = envelope({ items: [item()] });

  it("calls the model endpoint with the key in a header, never in the URL", async () => {
    const f = fakeFetch(200, good);
    const r = await detectWithGemini(opts(f as unknown as typeof fetch));
    expect(r.items).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
    expect(url).not.toContain("KEY-123");
    expect(init.headers["x-goog-api-key"]).toBe("KEY-123");
    expect(init.body).toContain("inline_data");
  });
  it("sends column names but nothing else from the spreadsheet", async () => {
    const f = fakeFetch(200, good);
    await detectWithGemini(opts(f as unknown as typeof fetch, { headers: ["Student", "Course"] }));
    const body = (f.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(body).toContain("Student");
    expect(body).not.toContain("KEY-123");
  });
  it.each([
    [400, { error: { message: "API key not valid. Please pass a valid API key." } }, "key"],
    [403, { error: { message: "denied" } }, "key"],
    [429, { error: { message: "quota" } }, "quota"],
    [404, { error: { message: "model not found" } }, "model"],
    [500, { error: { message: "boom" } }, "other"],
  ])("maps HTTP %i to a friendly %s error", async (status, body, code) => {
    await expect(detectWithGemini(opts(fakeFetch(status, body) as unknown as typeof fetch))).rejects.toMatchObject({ code });
  });
  it("never leaks the key, even if the server echoes it back", async () => {
    const f = fakeFetch(500, { error: { message: "bad request for key KEY-123 here" } });
    let message = "";
    try {
      await detectWithGemini(opts(f as unknown as typeof fetch));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("KEY-123");
  });
  it("reports network failures and rejects bad input without calling out", async () => {
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(detectWithGemini(opts(down as unknown as typeof fetch))).rejects.toMatchObject({ code: "network" });
    const never = fakeFetch(200, good);
    await expect(detectWithGemini(opts(never as unknown as typeof fetch, { apiKey: "  " }))).rejects.toMatchObject({ code: "key" });
    await expect(detectWithGemini(opts(never as unknown as typeof fetch, { model: "../../evil?x=1" }))).rejects.toMatchObject({ code: "model" });
    expect(never).not.toHaveBeenCalled();
  });
  it("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const slow = vi.fn((_u: unknown, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")))));
    const p = detectWithGemini(opts(slow as unknown as typeof fetch, { signal: ctrl.signal }));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("key storage", () => {
  it("keeps the key for this tab only and can clear it", () => {
    saveKey("abc");
    expect(loadKey()).toBe("abc");
    expect(localStorage.getItem("certmaker.gemini.key")).toBeNull();
    saveKey("");
    expect(loadKey()).toBe("");
  });
});
