import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneField } from "@/features/certmaker/lib/clone";
import {
  applyAiEditPlan,
  buildEditPrompt,
  generateEditPlan,
  parseEditPlan,
} from "@/features/certmaker/lib/clone-ai-edit";
import { requestEditText } from "@/features/certmaker/lib/clone-ai";
import type { CloneSource } from "@/features/certmaker/lib/types";
const source = (): CloneSource => ({
  image: "PRIVATE_IMAGE",
  width: 1000,
  height: 600,
  filename: "private.png",
  kind: "image",
  fields: [{ ...cloneField("Name", 100, 100, 200, 40, 0), label: "Recipient" }],
  suggestions: [],
});
const raw = (actions: unknown[]) => JSON.stringify({ explanation: "Edit requested text", actions });
const command = (command: string, fieldId = "clone-0") => ({ type: "command", fieldId, command });
const response = (text: string, provider = "gemini") =>
  new Response(
    JSON.stringify(
      provider === "gemini"
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { choices: [{ message: { content: text } }] },
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
afterEach(() => vi.useRealTimers());
describe("AI edit planning", () => {
  it("plans multi-step edits without mutating input, then applies atomically", () => {
    const c = source();
    const plan = parseEditPlan(
      raw([command("write Asha"), command("beautify"), command("color #123456")]),
      c,
      [],
    );
    expect(c.fields[0]?.replacement).toBe("Name");
    const next = applyAiEditPlan(c, plan, []);
    expect(next.fields[0]).toMatchObject({
      replacement: "Asha",
      font: "Playfair Display",
      color: "#123456",
      erase: "smart",
      redraw: true,
    });
    expect(next.image).toBe(c.image);
  });
  it("rejects the entire plan on unknown commands, IDs, extra properties or excessive actions", () => {
    const c = source();
    for (const invalid of [
      raw([command("write Asha"), command("execute JavaScript")]),
      raw([command("erase text", "missing")]),
      raw([{ ...command("erase text"), code: "alert(1)" }]),
      raw(Array.from({ length: 31 }, () => command("erase text"))),
    ]) {
      expect(() => parseEditPlan(invalid, c, [])).toThrow();
    }
    expect(c.fields[0]?.replacement).toBe("Name");
  });
  it("adds and duplicates editable text with unique IDs and no background patch", () => {
    const c = source();
    c.suggestions.push(cloneField("Static", 500, 100, 100, 20, 1));
    const plan = parseEditPlan(
      raw([
        { type: "add", text: "Workshop", x: 400, y: 300 },
        command("duplicate", "clone-2"),
        command("write Copy", "clone-3"),
      ]),
      c,
      [],
    );
    const next = applyAiEditPlan(c, plan, []);
    expect(next.fields.map((f) => f.id)).toEqual(["clone-0", "clone-2", "clone-3"]);
    expect(next.fields[1]).toMatchObject({
      replacement: "Workshop",
      erase: "none",
      x: 400,
      y: 300,
    });
    expect(next.fields[2]).toMatchObject({ replacement: "Copy", erase: "none", original: "" });
  });
  it("erases original text and matches style through local allowlisted operations", () => {
    const c = source();
    c.fields.push({ ...cloneField("Title", 500, 100, 200, 40, 1), font: "Montserrat", bold: true });
    const next = applyAiEditPlan(
      c,
      parseEditPlan(raw([command("match style clone-1"), command("erase text")]), c, []),
      [],
    );
    expect(next.fields[0]).toMatchObject({
      replacement: "",
      erase: "smart",
      font: "Montserrat",
      bold: true,
    });
  });
  it("rejects stale application and can return clarification without changes", () => {
    const c = source();
    const p = parseEditPlan(raw([command("write Asha")]), c, []);
    const changed = { ...c, fields: c.fields.map((f) => ({ ...f, replacement: "Typed later" })) };
    expect(applyAiEditPlan(changed, p, [])).toBe(changed);
    expect(parseEditPlan(raw([]), c, []).actions).toEqual([]);
  });
  it("sends instructions, editable fields and variable names but no image or static text", () => {
    const c = source();
    c.suggestions.push(cloneField("PRIVATE_STATIC", 500, 100, 100, 20, 5));
    const prompt = buildEditPrompt(c, "clone-0", "Beautify the recipient", ["name"]);
    expect(prompt).toContain("Beautify the recipient");
    expect(prompt).toContain("Recipient");
    expect(prompt).not.toContain("PRIVATE_IMAGE");
    expect(prompt).not.toContain("PRIVATE_STATIC");
    expect(prompt).not.toContain("private.png");
  });
});
describe("AI edit provider requests", () => {
  it.each(["gemini", "groq"] as const)(
    "uses %s credentials only in headers and interprets its real response envelope",
    async (provider) => {
      const fetchImpl = vi.fn().mockResolvedValue(response(raw([command("write Asha")]), provider));
      const plan = await generateEditPlan({
        clone: source(),
        selected: "clone-0",
        variables: [],
        instruction: "Change the name to Asha",
        provider,
        apiKey: "SECRET_KEY",
        model: "test-model",
        fetchImpl,
      });
      const [url, request] = fetchImpl.mock.calls[0]!;
      expect(url).not.toContain("SECRET_KEY");
      expect(request.body).not.toContain("SECRET_KEY");
      expect(request.body).not.toContain("PRIVATE_IMAGE");
      expect(JSON.stringify(request.headers)).toContain("SECRET_KEY");
      expect(plan.actions).toHaveLength(1);
      expect(request.body).not.toContain("temperature");
    },
  );
  it("does not retry key errors or expose secrets", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "SECRET_KEY bad key" } }), { status: 401 }),
      );
    await expect(
      requestEditText({
        provider: "gemini",
        apiKey: "SECRET_KEY",
        model: "test",
        prompt: "Edit",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "key" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects pre-cancelled requests before sending", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = vi.fn();
    await expect(
      requestEditText({
        provider: "gemini",
        apiKey: "key",
        model: "test",
        prompt: "Edit",
        signal: ctrl.signal,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("retries temporary server errors before parsing a valid plan", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(response(raw([])));
    const pending = requestEditText({
      provider: "gemini",
      apiKey: "key",
      model: "test",
      prompt: "Edit",
      fetchImpl,
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(raw([]));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

it("switches to a fallback model after bounded overload retries", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(response(raw([])));
  const pending = requestEditText({
    provider: "gemini",
    apiKey: "key",
    model: "test",
    prompt: "Edit",
    fetchImpl,
  });
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toBe(raw([]));
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(fetchImpl.mock.calls[3]![0]).toContain("gemini-3.5-flash-lite");
});
