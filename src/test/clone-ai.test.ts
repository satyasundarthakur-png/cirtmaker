import { describe, expect, it, vi } from "vitest";
import {
  AiError, PROVIDERS, applyAiDetection, buildGroqRequest, buildPrompt, buildRequest, detectOnce, detectResilient, fallbackModels, itemsToFields, loadKey, parseAiResponse, saveKey,
  type AiItem, type AiProvider, type PreparedImage,
} from "@/features/certmaker/lib/clone-ai";
import { cloneField } from "@/features/certmaker/lib/clone";
import type { CloneSource } from "@/features/certmaker/lib/types";

const DIMS = { width: 1800, height: 1200 };
const IMAGE: PreparedImage = { base64: "AAAA", ...DIMS };

const geminiEnvelope = (payload: unknown, wrap = false) => ({
  candidates: [{ content: { parts: [{ text: wrap ? "```json\n" + JSON.stringify(payload) + "\n```" : JSON.stringify(payload) }] }, finishReason: "STOP" }],
});
const groqEnvelope = (content: unknown, finish = "stop") => ({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }] });
const item = (over: Record<string, unknown> = {}) => ({ text: "Priya Sharma", kind: "name", box_2d: [400, 250, 500, 750], font: "serif", bold: false, italic: true, align: "center", column: "", ...over });

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
/** A fetch that answers with each reply in turn (the last one repeats). */
function fakeFetch(...replies: Reply[]) {
  let i = 0;
  return vi.fn(async (_url: unknown, _init?: unknown) => {
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null } } as unknown as Response;
  });
}
const asFetch = (f: ReturnType<typeof fakeFetch>) => f as unknown as typeof fetch;
const noSleep = () => vi.fn(async (_ms: number, _signal?: AbortSignal) => {});

const base = (provider: AiProvider, f: ReturnType<typeof fakeFetch>, over: Partial<Parameters<typeof detectOnce>[0]> = {}) => ({
  provider, apiKey: "KEY-123", model: provider === "groq" ? "qwen/qwen3.8-27b" : "gemini-3.6-flash", image: IMAGE, headers: ["Name", "Course"], fetchImpl: asFetch(f), ...over,
});
const ok = (provider: AiProvider) => ({ status: 200, body: provider === "groq" ? groqEnvelope(JSON.stringify({ items: [item()] })) : geminiEnvelope({ items: [item()] }) });
const busy = { status: 503, body: { error: { message: "This model is currently experiencing high demand." } } };

describe("requests", () => {
  it("Gemini: image inline, JSON requested, no sampling parameters", () => {
    const req = buildRequest("QUJD", ["Name"], DIMS);
    expect(req.contents[0]?.parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "QUJD" } });
    expect(req.generationConfig).toEqual({ responseMimeType: "application/json" });
    expect(JSON.stringify(req)).not.toMatch(/temperature|top_p|top_k/i);
  });
  it("Groq: OpenAI-style message with the image as a data URL, JSON mode, no sampling parameters", () => {
    const req = buildGroqRequest("qwen/qwen3.8-27b", "QUJD", ["Name"], DIMS);
    expect(req.model).toBe("qwen/qwen3.8-27b");
    expect(req.messages[0]?.content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req.max_completion_tokens).toBeGreaterThan(1000);
    expect(JSON.stringify(req)).not.toMatch(/temperature|top_p|top_k/i);
  });
  it("tells the model to read text only, use only the given columns, and which coordinate scale to use", () => {
    expect(buildPrompt(["Student Name", "Course"])).toContain('"Student Name"');
    expect(buildPrompt([])).toMatch(/no spreadsheet/);
    expect(buildPrompt([], DIMS)).toMatch(/1800 by 1200 pixels.*0-1000.*never pixels/);
    expect(buildPrompt([])).toMatch(/never around decorations/);
  });
});

describe("parseAiResponse (Gemini)", () => {
  it("reads a normal answer, fenced JSON and a bare array", () => {
    expect(parseAiResponse(geminiEnvelope({ items: [item()] })).items).toHaveLength(1);
    expect(parseAiResponse(geminiEnvelope({ items: [item()] }, true)).items).toHaveLength(1);
    expect(parseAiResponse(geminiEnvelope([item()])).items).toHaveLength(1);
  });
  it("normalises kinds, fonts and column names; ignores columns the user lacks", () => {
    const { items } = parseAiResponse(geminiEnvelope({ items: [item({ kind: "Certificate Number", font: "Sans Serif", column: " course " }), item({ kind: "heading", column: "Invented" })] }), ["Name", "Course"]);
    expect(items[0]).toMatchObject({ kind: "certId", font: "sans", column: "Course" });
    expect(items[1]).toMatchObject({ kind: "other", column: "" });
  });
  it("drops malformed items instead of trusting them, and says how many", () => {
    const bad = [item({ box_2d: [10, 10, 5, 5] }), item({ box_2d: [1, 2, 3] }), item({ text: "" }), item({ text: "x".repeat(400) }), "nope", item({ box_2d: ["a", "b", "c", "d"] })];
    const r = parseAiResponse(geminiEnvelope({ items: [item(), ...bad] }));
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(bad.length);
  });
  it("clamps slightly out-of-range coordinates", () => {
    expect(parseAiResponse(geminiEnvelope({ items: [item({ box_2d: [-50, -50, 1004, 1004] })] }), [], { dims: DIMS }).items[0]?.box).toEqual({ x0: 0, y0: 0, x1: 1000, y1: 1000 });
  });
  it("fails clearly on unusable answers and reports blocked content", () => {
    for (const bad of [{}, null, "text", { candidates: [] }, geminiEnvelope({ nothing: true }), { candidates: [{ content: { parts: [{ text: "not json" }] } }] }, geminiEnvelope({ items: [] })]) {
      expect(() => parseAiResponse(bad)).toThrow(AiError);
    }
    expect(() => parseAiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrowError(expect.objectContaining({ code: "blocked" }));
  });
});

describe("parseAiResponse (Groq)", () => {
  const groq = { provider: "groq" as const, dims: DIMS };
  const answer = JSON.stringify({ items: [item()] });
  it("reads message content as a string or as parts", () => {
    expect(parseAiResponse(groqEnvelope(answer), [], groq).items).toHaveLength(1);
    expect(parseAiResponse(groqEnvelope([{ type: "text", text: answer }]), [], groq).items).toHaveLength(1);
  });
  it("ignores inline thinking and text around the JSON", () => {
    expect(parseAiResponse(groqEnvelope(`<think>Let me look at the image…</think>\n${answer}`), [], groq).items).toHaveLength(1);
    expect(parseAiResponse(groqEnvelope(`Here you go:\n${answer}\nHope that helps.`), [], groq).items).toHaveLength(1);
    expect(parseAiResponse(groqEnvelope("```json\n" + answer + "\n```"), [], groq).items).toHaveLength(1);
  });
  it("explains a cut-off answer, and reports filtered content", () => {
    expect(() => parseAiResponse(groqEnvelope("", "length"), [], groq)).toThrowError(/ran out of room/);
    expect(() => parseAiResponse(groqEnvelope("x", "content_filter"), [], groq)).toThrowError(expect.objectContaining({ code: "blocked" }));
    expect(() => parseAiResponse({ choices: [] }, [], groq)).toThrow(AiError);
  });
});

describe("pixel coordinates", () => {
  it("recognises an answer given in pixels of the sent image and rescales it to 0–1000", () => {
    // [ymin, xmin, ymax, xmax] in pixels of a 1800 x 1200 image
    const { items } = parseAiResponse(geminiEnvelope({ items: [item({ box_2d: [600, 900, 720, 1700] }), item({ text: "b", box_2d: [100, 100, 150, 400] })] }), [], { dims: DIMS });
    expect(items[0]?.box.x0).toBeCloseTo(500, 0);
    expect(items[0]?.box.x1).toBeCloseTo(944.4, 0);
    expect(items[0]?.box.y0).toBeCloseTo(500, 0);
    expect(items[0]?.box.y1).toBeCloseTo(600, 0);
  });
  it("leaves 0–1000 answers alone, and does nothing without the image size", () => {
    expect(parseAiResponse(geminiEnvelope({ items: [item({ box_2d: [400, 250, 500, 750] })] }), [], { dims: DIMS }).items[0]?.box).toEqual({ x0: 250, y0: 400, x1: 750, y1: 500 });
    expect(parseAiResponse(geminiEnvelope({ items: [item({ box_2d: [600, 900, 720, 1700] })] })).items[0]?.box.x1).toBe(1000);
  });
});

describe("itemsToFields / applyAiDetection", () => {
  const page = { w: 2000, h: 1000 };
  const parse = (raw: unknown[], headers: string[] = []): AiItem[] => parseAiResponse(geminiEnvelope({ items: raw }), headers).items;

  it("converts boxes to pixels and splits editable fields from other text", () => {
    const { fields, suggestions } = itemsToFields(parse([item(), item({ text: "Director", kind: "other", box_2d: [900, 100, 950, 300], align: "left" })]), page, 0);
    const f = fields[0]!;
    expect(500 - f.x).toBeGreaterThanOrEqual(0);
    expect(500 - f.x).toBeLessThan(25);
    expect(f.x + f.w).toBeGreaterThanOrEqual(1500);
    expect(f).toMatchObject({ kind: "name", label: "Candidate name", original: "Priya Sharma", replacement: "Priya Sharma", align: "center", italic: true });
    expect(suggestions[0]).toMatchObject({ original: "Director", kind: "custom" });
  });
  it("points matched fields at their CSV column and numbers ids from the start index", () => {
    const { fields, suggestions } = itemsToFields(parse([item({ column: "Name" }), item({ kind: "other", box_2d: [10, 10, 60, 200] })], ["Name"]), page, 7);
    expect(fields[0]?.replacement).toBe("{{Name}}");
    expect([...fields, ...suggestions].map((f) => f.id).sort()).toEqual(["clone-7", "clone-8"]);
  });
  it("replaces detected boxes but keeps the ones the user added by hand", () => {
    const manual = { ...cloneField("", 100, 100, 200, 40, 3), id: "clone-3", replacement: "Hand-made box", cover: "" };
    const clone: CloneSource = { image: "x", width: 2000, height: 1000, filename: "t.png", kind: "image", fields: [{ ...cloneField("Old detected", 10, 10, 100, 30, 0), id: "clone-0" }, manual], suggestions: [{ ...cloneField("Old other", 10, 500, 100, 30, 1), id: "clone-1" }] };
    const next = applyAiDetection(clone, parse([item(), item({ kind: "other", text: "Footer", box_2d: [900, 100, 950, 400] })]));
    expect(next.fields.some((f) => f.original === "Old detected")).toBe(false);
    expect(next.fields.find((f) => f.id === "clone-3")?.replacement).toBe("Hand-made box");
    expect(next.suggestions.map((f) => f.original)).toEqual(["Footer"]);
    expect(new Set([...next.fields, ...next.suggestions].map((f) => f.id)).size).toBe(next.fields.length + next.suggestions.length);
    expect(next.image).toBe("x");
  });
});

describe("detectOnce", () => {
  it("Gemini: key in a header, never in the URL", async () => {
    const f = fakeFetch(ok("gemini"));
    await detectOnce(base("gemini", f));
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
    expect(url).not.toContain("KEY-123");
    expect(init.headers["x-goog-api-key"]).toBe("KEY-123");
    expect(init.body).toContain("inline_data");
  });
  it("Groq: Bearer header, OpenAI-compatible endpoint, model and image in the body", async () => {
    const f = fakeFetch(ok("groq"));
    const r = await detectOnce(base("groq", f));
    expect(r.items).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(url).not.toContain("KEY-123");
    expect(init.headers["Authorization"]).toBe("Bearer KEY-123");
    expect(JSON.parse(init.body)).toMatchObject({ model: "qwen/qwen3.8-27b", response_format: { type: "json_object" } });
  });
  it("sends column names but never the key or anything else from the spreadsheet", async () => {
    const f = fakeFetch(ok("groq"));
    await detectOnce(base("groq", f, { headers: ["Student", "Course"] }));
    const body = (f.mock.calls[0] as unknown as [string, { body: string }])[1].body;
    expect(body).toContain("Student");
    expect(body).not.toContain("KEY-123");
  });
  it.each<[AiProvider, number, unknown, string]>([
    ["gemini", 400, { error: { message: "API key not valid. Please pass a valid API key." } }, "key"],
    ["gemini", 403, { error: { message: "denied" } }, "key"],
    ["gemini", 429, { error: { message: "quota" } }, "quota"],
    ["gemini", 404, { error: { message: "model not found" } }, "model"],
    ["gemini", 503, { error: { message: "high demand" } }, "busy"],
    ["gemini", 418, { error: { message: "teapot" } }, "other"],
    ["groq", 401, { error: { message: "Invalid API Key" } }, "key"],
    ["groq", 404, { error: { message: "The model `x` does not exist" } }, "model"],
    ["groq", 429, { error: { message: "Rate limit reached" } }, "quota"],
    ["groq", 503, { error: { message: "over capacity" } }, "busy"],
    ["groq", 400, { error: { message: "messages[0].content must be a string" } }, "model"],
  ])("%s: HTTP %i becomes a friendly %s error", async (provider, status, body, code) => {
    await expect(detectOnce(base(provider, fakeFetch({ status, body })))).rejects.toMatchObject({ code });
  });
  it("reads how long the service asked us to wait", async () => {
    const f = fakeFetch({ status: 429, body: { error: { message: "limit" } }, headers: { "retry-after": "7" } });
    await expect(detectOnce(base("groq", f))).rejects.toMatchObject({ code: "quota", retryAfterMs: 7000 });
  });
  it("never leaks the key, even if the server echoes it back", async () => {
    for (const provider of ["gemini", "groq"] as const) {
      let message = "";
      try { await detectOnce(base(provider, fakeFetch({ status: 500, body: { error: { message: "bad request for key KEY-123 here" } } }))); } catch (e) { message = (e as Error).message; }
      expect(message).not.toBe("");
      expect(message).not.toContain("KEY-123");
    }
  });
  it("reports network failures by provider, and rejects bad input without calling out", async () => {
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(detectOnce(base("groq", down as unknown as ReturnType<typeof fakeFetch>))).rejects.toThrowError(/Could not reach Groq.*try the other provider/);
    const never = fakeFetch(ok("gemini"));
    await expect(detectOnce(base("gemini", never, { apiKey: "  " }))).rejects.toMatchObject({ code: "key" });
    await expect(detectOnce(base("gemini", never, { model: "../../evil?x=1" }))).rejects.toMatchObject({ code: "model" });
    expect(never).not.toHaveBeenCalled();
  });
  it("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const slow = vi.fn((_u: unknown, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")))));
    const p = detectOnce(base("gemini", slow as unknown as ReturnType<typeof fakeFetch>, { signal: ctrl.signal }));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("detectResilient", () => {
  it("retries when the model is overloaded, then succeeds on the same model", async () => {
    const f = fakeFetch(busy, busy, ok("gemini"));
    const sleep = noSleep();
    const status = vi.fn();
    const r = await detectResilient({ ...base("gemini", f), sleep, onStatus: status });
    expect(r.model).toBe("gemini-3.6-flash");
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1500, 4000]);
    expect(status.mock.calls[0]?.[0]).toMatch(/busy.*Retrying in 2s \(1 of 2\)/);
  });
  it("switches to another model when the first stays overloaded, and says which one answered", async () => {
    const f = fakeFetch(busy, busy, busy, ok("gemini"));
    const status = vi.fn();
    const r = await detectResilient({ ...base("gemini", f), sleep: noSleep(), onStatus: status });
    expect(r.model).toBe("gemini-3.5-flash-lite");
    expect(f).toHaveBeenCalledTimes(4);
    expect((f.mock.calls[3] as unknown as [string])[0]).toContain("gemini-3.5-flash-lite");
    expect(status.mock.calls.map((c) => c[0]).join("\n")).toMatch(/still busy\. Trying gemini-3\.5-flash-lite/);
  });
  it("gives a clear, honest error when everything is overloaded", async () => {
    const f = fakeFetch(busy);
    const err = await detectResilient({ ...base("gemini", f), sleep: noSleep() }).catch((e: unknown) => e as AiError);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("busy");
    expect((err as AiError).message).toMatch(/overloaded.*switching models.*Google/);
    expect(f).toHaveBeenCalledTimes(9); // 3 models x (1 try + 2 retries)
  });
  it("Groq has one model, so it retries and then reports the overload without mentioning other models", async () => {
    const f = fakeFetch(busy);
    const err = await detectResilient({ ...base("groq", f), sleep: noSleep() }).catch((e: unknown) => e as AiError);
    expect((err as AiError).message).toMatch(/Groq is overloaded/);
    expect((err as AiError).message).not.toMatch(/switching models/);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("waits as long as the service asks after a short rate limit, once", async () => {
    const limited = { status: 429, body: { error: { message: "limit" } }, headers: { "retry-after": "2" } };
    const f = fakeFetch(limited, ok("groq"));
    const sleep = noSleep();
    await detectResilient({ ...base("groq", f), sleep });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000]);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry problems that waiting cannot fix", async () => {
    for (const [status, code] of [[401, "key"], [404, "model"], [429, "quota"]] as const) {
      const f = fakeFetch({ status, body: { error: { message: "x" } } });
      await expect(detectResilient({ ...base("gemini", f), sleep: noSleep() })).rejects.toMatchObject({ code });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("can be cancelled while waiting to retry", async () => {
    const ctrl = new AbortController();
    const sleep = vi.fn(async () => { ctrl.abort(); throw new AiError("cancelled", "Cancelled."); });
    await expect(detectResilient({ ...base("gemini", fakeFetch(busy)), sleep, signal: ctrl.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
  it("tries the lightest Gemini model first as a fallback", () => {
    expect(fallbackModels("gemini", "gemini-3.6-flash")).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    expect(fallbackModels("gemini", "gemini-3.5-flash-lite")).toEqual(["gemini-3.6-flash", "gemini-3.8-flash"]);
    expect(fallbackModels("groq", "qwen/qwen3.8-27b")).toEqual([]);
  });
});

describe("providers and key storage", () => {
  it("lists both providers with a vision model each", () => {
    expect(Object.keys(PROVIDERS)).toEqual(["gemini", "groq"]);
    expect(PROVIDERS.groq.models[0]?.id).toBe("qwen/qwen3.8-27b");
  });
  it("keeps one key per provider for this tab only, and can clear it", () => {
    saveKey("g-key", "gemini");
    saveKey("q-key", "groq");
    expect(loadKey("gemini")).toBe("g-key");
    expect(loadKey("groq")).toBe("q-key");
    expect(localStorage.length).toBe(0);
    saveKey("", "groq");
    expect(loadKey("groq")).toBe("");
    expect(loadKey("gemini")).toBe("g-key");
    saveKey("", "gemini");
  });
});
