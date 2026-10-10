/**
 * Optional AI text-field detection for Clone Mode, using the Gemini API.
 *
 * What it does: reads the certificate template image and returns the text on it, with a box around each piece,
 * a kind (name / number / date / course / custom / other), basic font hints, and, when the user has a CSV,
 * which column would fill each field.
 *
 * What it never does: generate, edit, restyle or redraw artwork, or pick colours. The original stays untouched.
 *
 * Privacy: bring-your-own-key, called straight from the browser. Only the template image and CSV column NAMES
 * are sent. Row data (recipients' names) never is. The key is never put in a URL or an error message.
 */
import { KIND_LABEL, type Detected } from "./clone-detect";
import { fieldFromDetected, loadCloneImage, nextIndex } from "./clone";
import type { CloneAlign, CloneKind, CloneSource, CloneTextField } from "./types";

export const GEMINI_MODELS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, cheapest)" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (most capable)" },
] as const;
export const DEFAULT_MODEL = GEMINI_MODELS[0].id;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
const SEND_MAX_SIDE = 2000;
const MAX_ITEMS = 120;
const MAX_TEXT = 300;
const MAX_SUGGESTIONS = 80;
const KEY_STORE = "certmaker.gemini.key";

export type AiErrorCode = "key" | "quota" | "model" | "network" | "blocked" | "format" | "timeout" | "cancelled" | "other";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiItem {
  text: string;
  kind: CloneKind | "other";
  /** Normalised 0–1000 box, as Gemini returns it. */
  box: { x0: number; y0: number; x1: number; y1: number };
  font: "serif" | "sans" | "script";
  bold: boolean;
  italic: boolean;
  align: CloneAlign | null;
  column: string;
}

/* ---------- key storage (this browser tab only) ---------- */

export function loadKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}

export function saveKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORE, key);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* storage blocked: the key just lives in memory */
  }
}

/* ---------- request ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

export function buildPrompt(headers: string[]): string {
  const columns = headers.length
    ? `The user has a spreadsheet with these columns: ${headers.map((h) => `"${h}"`).join(", ")}. For each item that is a variable value, set "column" to the ONE column that would fill it, copied exactly from that list; otherwise "". `
    : `There is no spreadsheet, so always set "column" to "". `;
  return (
    "You are reading a certificate TEMPLATE image so a person can replace some of its text. " +
    "List every piece of text you can read. Transcribe it exactly, in its own script (for example Odia or Hindi), without translating or correcting it. " +
    'Give "box_2d" as [ymin, xmin, ymax, xmax] normalised to 0-1000, drawn tightly around only the text itself, never around decorations, borders, seals or logos. ' +
    'Classify each item with "kind": "name" (the recipient or candidate name, or a placeholder for it), "certId" (the certificate, serial or registration number value), ' +
    '"date" (the issue date value), "course" (the course, programme, workshop or event title), "custom" (any other value that would change per person, such as a grade, score or place), ' +
    'or "other" (everything static: headings, sentences of wording, labels, signatory names and titles, institution names). ' +
    'When a line is "Label: value", return only the value as the item and treat the label as static. ' +
    'Also give "font" ("serif", "sans" or "script"), "bold" and "italic" (true or false), and "align" ("left", "center" or "right"). ' +
    columns +
    'Reply with JSON only, in exactly this shape: {"items":[{"text":"","kind":"","box_2d":[0,0,0,0],"font":"","bold":false,"italic":false,"align":"","column":""}]}'
  );
}

export function buildRequest(imageBase64: string, headers: string[]) {
  return {
    contents: [{ parts: [{ text: buildPrompt(headers) }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] }],
    // temperature and other sampling settings are deprecated on current Gemini models, so none are sent
    generationConfig: { responseMimeType: "application/json" },
  };
}

/** A downscaled JPEG copy of the original, for sending only. The stored artwork is never modified. */
export async function prepareImage(src: string): Promise<string> {
  const img = await loadCloneImage(src);
  const k = Math.min(1, SEND_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d");
  if (!ctx) throw new AiError("other", "Canvas rendering is unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92).split(",")[1] ?? "";
}

/* ---------- response ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function responseText(json: unknown): string {
  if (!isObj(json)) throw new AiError("format", "The AI sent back something unreadable.");
  const feedback = json["promptFeedback"];
  if (isObj(feedback) && typeof feedback["blockReason"] === "string") {
    throw new AiError("blocked", "Google declined to read this image. Try a different file, or use the built-in detection.");
  }
  const candidates = json["candidates"];
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isObj(first)) throw new AiError("format", "The AI returned no answer. Try again.");
  if (first["finishReason"] === "SAFETY" || first["finishReason"] === "PROHIBITED_CONTENT") {
    throw new AiError("blocked", "Google declined to read this image. Try a different file, or use the built-in detection.");
  }
  const content = first["content"];
  const parts = isObj(content) && Array.isArray(content["parts"]) ? content["parts"] : [];
  const text = parts.map((p) => (isObj(p) && typeof p["text"] === "string" ? p["text"] : "")).join("").trim();
  if (!text) throw new AiError("format", "The AI returned no answer. Try again.");
  return text;
}

const KIND_ALIASES: Record<string, CloneKind | "other"> = {
  name: "name", candidate: "name", recipient: "name", person: "name",
  certid: "certId", certificate_id: "certId", certificate_number: "certId", certificate_no: "certId", serial: "certId", id: "certId", number: "certId",
  date: "date", issue_date: "date",
  course: "course", event: "course", programme: "course", program: "course", workshop: "course",
  custom: "custom", variable: "custom",
  other: "other", static: "other",
};

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
const clamp1000 = (n: number) => Math.min(1000, Math.max(0, n));

function toItem(raw: unknown, headers: string[]): AiItem | null {
  if (!isObj(raw)) return null;
  const text = typeof raw["text"] === "string" ? raw["text"].trim() : "";
  if (!text || text.length > MAX_TEXT) return null;
  const rawBox = raw["box_2d"] ?? raw["box"];
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;
  const [y0, x0, y1, x1] = rawBox.map(num).map((n) => (Number.isFinite(n) ? clamp1000(n) : NaN)) as [number, number, number, number];
  if (![y0, x0, y1, x1].every(Number.isFinite) || y1 - y0 < 2 || x1 - x0 < 2) return null;
  const kindKey = typeof raw["kind"] === "string" ? norm(raw["kind"]) : "";
  const kind = KIND_ALIASES[kindKey] ?? "other";
  const fontRaw = typeof raw["font"] === "string" ? raw["font"].toLowerCase() : "";
  const font = fontRaw.includes("script") ? "script" : fontRaw.includes("serif") && !fontRaw.includes("sans") ? "serif" : "sans";
  const alignRaw = typeof raw["align"] === "string" ? raw["align"].toLowerCase() : "";
  const align = alignRaw === "left" || alignRaw === "center" || alignRaw === "right" ? alignRaw : null;
  const colRaw = typeof raw["column"] === "string" ? norm(raw["column"]) : "";
  const column = colRaw ? (headers.find((h) => norm(h) === colRaw) ?? "") : "";
  return { text, kind, box: { x0, y0, x1, y1 }, font, bold: raw["bold"] === true, italic: raw["italic"] === true, align, column };
}

/** Strictly validate the model's answer. Anything malformed is dropped, never trusted. */
export function parseAiResponse(json: unknown, headers: string[] = []): { items: AiItem[]; dropped: number } {
  const text = responseText(json).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError("format", "The AI answered in a format that could not be read. Try again.");
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data["items"]) ? data["items"] : null;
  if (!list) throw new AiError("format", "The AI answered in a format that could not be read. Try again.");
  const items = list.slice(0, MAX_ITEMS).map((r) => toItem(r, headers));
  const valid = items.filter((i): i is AiItem => i !== null);
  if (!valid.length) throw new AiError("format", list.length ? "The AI's answer had no usable text boxes. Try again, or use the built-in detection." : "The AI found no text on this certificate.");
  return { items: valid, dropped: list.length - valid.length };
}

/* ---------- items -> fields ---------- */

const byPosition = (a: CloneTextField, b: CloneTextField) => a.y - b.y || a.x - b.x;

export function itemsToFields(items: AiItem[], page: { w: number; h: number }, startIndex: number): { fields: CloneTextField[]; suggestions: CloneTextField[] } {
  const fields: CloneTextField[] = [];
  const suggestions: CloneTextField[] = [];
  let n = startIndex;
  for (const it of items) {
    const w = ((it.box.x1 - it.box.x0) / 1000) * page.w;
    const h = ((it.box.y1 - it.box.y0) / 1000) * page.h;
    const kind: CloneKind = it.kind === "other" ? "custom" : it.kind;
    const editable = it.kind !== "other";
    if (!editable && suggestions.length >= MAX_SUGGESTIONS) continue;
    const d: Detected = {
      kind,
      label: editable ? KIND_LABEL[kind] : "Other text",
      box: { x: (it.box.x0 / 1000) * page.w, y: (it.box.y0 / 1000) * page.h, w, h },
      text: it.text,
      size: h * 0.85,
      fontHint: `${it.font === "script" ? "script" : it.font === "serif" ? "serif" : "sans"}${it.bold ? " bold" : ""}${it.italic ? " italic" : ""}`,
    };
    const field = fieldFromDetected(d, `clone-${n++}`, page);
    if (it.align) field.align = it.align;
    if (editable && it.column) field.replacement = `{{${it.column}}}`;
    (editable ? fields : suggestions).push(field);
  }
  return { fields: fields.sort(byPosition), suggestions: suggestions.sort(byPosition) };
}

/** Replace the detected boxes with the AI's. Boxes the user added by hand are kept. */
export function applyAiDetection(clone: CloneSource, items: AiItem[]): CloneSource {
  const manual = clone.fields.filter((f) => !f.original);
  const { fields, suggestions } = itemsToFields(items, { w: clone.width, h: clone.height }, nextIndex(clone));
  return { ...clone, fields: [...fields, ...manual].sort(byPosition), suggestions };
}

/* ---------- call ---------- */

export interface DetectOptions {
  apiKey: string;
  model: string;
  imageBase64: string;
  /** CSV column names only. Never row data. */
  headers: string[];
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

async function errorFor(res: Response, apiKey: string): Promise<AiError> {
  let detail = "";
  try {
    const j: unknown = await res.json();
    if (isObj(j) && isObj(j["error"]) && typeof j["error"]["message"] === "string") detail = j["error"]["message"];
  } catch {
    /* no JSON body */
  }
  detail = detail.split(apiKey).join("***").slice(0, 200);
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(detail))) return new AiError("key", "Google did not accept that API key. Check it, and that the Gemini API is enabled for it.");
  if (res.status === 429) return new AiError("quota", "Your Gemini quota is used up for now. Wait a minute and try again, or check your plan in Google AI Studio.");
  if (res.status === 404) return new AiError("model", "That model is not available for your key. Pick another model.");
  if (res.status === 413) return new AiError("other", "The image was too large to send.");
  return new AiError("other", `Gemini returned an error (${res.status}). ${detail}`.trim());
}

export async function detectWithGemini(o: DetectOptions): Promise<{ items: AiItem[]; dropped: number }> {
  const apiKey = o.apiKey.trim();
  if (!apiKey) throw new AiError("key", "Enter your Gemini API key first.");
  if (!MODEL_RE.test(o.model)) throw new AiError("model", "That model name is not valid.");
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  o.signal?.addEventListener("abort", onAbort);
  try {
    const res = await (o.fetchImpl ?? fetch)(`${ENDPOINT}/${encodeURIComponent(o.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildRequest(o.imageBase64, o.headers)),
      signal: ctrl.signal,
    });
    if (!res.ok) throw await errorFor(res, apiKey);
    return parseAiResponse(await res.json(), o.headers);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (timedOut) throw new AiError("timeout", "Gemini took too long to answer. Try again.");
    if (e instanceof DOMException && e.name === "AbortError") throw new AiError("cancelled", "Cancelled.");
    throw new AiError("network", "Could not reach Gemini. Check your connection, or whether an ad blocker or firewall is blocking Google.");
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}
