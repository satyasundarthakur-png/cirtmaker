/**
 * Optional AI text-field detection for Clone Mode. Two providers: Google Gemini and Groq.
 *
 * What it does: reads the certificate template image and returns the text on it, with a box around each piece,
 * a kind (name / number / date / course / custom / other), basic font hints, and, when the user has a CSV,
 * which column would fill each field.
 *
 * What it never does: generate, edit, restyle or redraw artwork, or pick colours. The original stays untouched.
 *
 * Privacy: bring-your-own-key, called straight from the browser. Only the template image and CSV column NAMES
 * are sent. Row data (recipients' names) never is. The key goes in a header only, never in a URL or an error message.
 */
import { KIND_LABEL, type Detected } from "./clone-detect";
import { fieldFromDetected, loadCloneImage, nextIndex } from "./clone";
import type { CloneAlign, CloneKind, CloneSource, CloneTextField } from "./types";

/* ---------- providers ---------- */

export type AiProvider = "gemini" | "groq";

export interface AiModel {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: AiProvider;
  name: string;
  /** Who receives the image, for the consent text. */
  company: string;
  keyUrl: string;
  keyLabel: string;
  models: readonly AiModel[];
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    company: "Google",
    keyUrl: "https://aistudio.google.com/apikey",
    keyLabel: "Get a key from Google AI Studio",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (recommended)" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (fastest, cheapest)" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (most capable)" },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq",
    company: "Groq",
    keyUrl: "https://console.groq.com/keys",
    keyLabel: "Get a free key from the Groq console",
    models: [{ id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (vision, recommended)" }],
  },
};

export const DEFAULT_MODEL: Record<AiProvider, string> = { gemini: "gemini-3.6-flash", groq: "qwen/qwen3.8-27b" };

/** Other models to try, in order, when the chosen one stays overloaded. */
export function fallbackModels(provider: AiProvider, model: string): string[] {
  // for Gemini the lightest model goes first: it is the least likely to be overloaded
  const order = provider === "gemini" ? ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"] : PROVIDERS[provider].models.map((m) => m.id);
  return order.filter((id) => id !== model);
}

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 60_000;
/** The copy sent to the AI always has this long side, so its coordinates are easy to interpret. */
const SEND_SIDE = 1800;
const MAX_ITEMS = 120;
const MAX_TEXT = 300;
const MAX_SUGGESTIONS = 80;
const MAX_COMPLETION_TOKENS = 4096;
/** Pauses before each automatic retry when a model is overloaded. */
const RETRY_DELAYS_MS = [1500, 4000];
const MAX_RETRY_AFTER_MS = 20_000;
const TRANSIENT_STATUS = new Set([500, 502, 503, 504]);
/** Coordinates above this can only be pixels, not the 0–1000 scale we asked for. */
const PIXEL_THRESHOLD = 1100;

export type AiErrorCode = "key" | "quota" | "busy" | "model" | "network" | "blocked" | "format" | "timeout" | "cancelled" | "other";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    /** How long the service asked us to wait before trying again, if it said. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiItem {
  text: string;
  kind: CloneKind | "other";
  /** Normalised 0–1000 box. */
  box: { x0: number; y0: number; x1: number; y1: number };
  font: "serif" | "sans" | "script";
  bold: boolean;
  italic: boolean;
  align: CloneAlign | null;
  column: string;
}

/** The downscaled copy that is actually sent. */
export interface PreparedImage {
  base64: string;
  width: number;
  height: number;
}

/* ---------- key storage (this browser tab only, one per provider) ---------- */

const keyStore = (p: AiProvider) => `certmaker.${p}.key`;

export function loadKey(provider: AiProvider = "gemini"): string {
  try {
    return sessionStorage.getItem(keyStore(provider)) ?? "";
  } catch {
    return "";
  }
}

export function saveKey(key: string, provider: AiProvider = "gemini") {
  try {
    if (key) sessionStorage.setItem(keyStore(provider), key);
    else sessionStorage.removeItem(keyStore(provider));
  } catch {
    /* storage blocked: the key just lives in memory */
  }
}

/* ---------- request ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

export function buildPrompt(headers: string[], dims?: { width: number; height: number }): string {
  const columns = headers.length
    ? `The user has a spreadsheet with these columns: ${headers.map((h) => `"${h}"`).join(", ")}. For each item that is a variable value, set "column" to the ONE column that would fill it, copied exactly from that list; otherwise "". `
    : `There is no spreadsheet, so always set "column" to "". `;
  const scale = dims
    ? `The image is ${dims.width} by ${dims.height} pixels. Coordinates must be normalised to 0-1000 on both axes (0,0 is the top-left corner and 1000,1000 the bottom-right), never pixels. `
    : "";
  return (
    "You are reading a certificate TEMPLATE image so a person can replace some of its text. " +
    "List every piece of text you can read. Transcribe it exactly, in its own script (for example Odia or Hindi), without translating or correcting it. " +
    'Give "box_2d" as [ymin, xmin, ymax, xmax] normalised to 0-1000, drawn tightly around only the text itself, never around decorations, borders, seals or logos. ' +
    scale +
    'Classify each item with "kind": "name" (the recipient or candidate name, or a placeholder for it), "certId" (the certificate, serial or registration number value), ' +
    '"date" (the issue date value), "course" (the course, programme, workshop or event title), "custom" (any other value that would change per person, such as a grade, score or place), ' +
    'or "other" (everything static: headings, sentences of wording, labels, signatory names and titles, institution names). ' +
    'When a line is "Label: value", return only the value as the item and treat the label as static. ' +
    'Also give "font" ("serif", "sans" or "script"), "bold" and "italic" (true or false), and "align" ("left", "center" or "right"). ' +
    columns +
    'Reply with JSON only, in exactly this shape: {"items":[{"text":"","kind":"","box_2d":[0,0,0,0],"font":"","bold":false,"italic":false,"align":"","column":""}]}'
  );
}

export function buildRequest(imageBase64: string, headers: string[], dims?: { width: number; height: number }) {
  return {
    contents: [{ parts: [{ text: buildPrompt(headers, dims) }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] }],
    // temperature and other sampling settings are deprecated on current Gemini models, so none are sent
    generationConfig: { responseMimeType: "application/json" },
  };
}

export function buildGroqRequest(model: string, imageBase64: string, headers: string[], dims?: { width: number; height: number }) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(headers, dims) },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: MAX_COMPLETION_TOKENS,
  };
}

/** A downscaled (or enlarged) JPEG copy of the original, for sending only. The stored artwork is never modified. */
export async function prepareImage(src: string): Promise<PreparedImage> {
  const img = await loadCloneImage(src);
  const k = SEND_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d");
  if (!ctx) throw new AiError("other", "Canvas rendering is unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { base64: c.toDataURL("image/jpeg", 0.92).split(",")[1] ?? "", width: c.width, height: c.height };
}

/* ---------- response ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const BLOCKED = "The AI service declined to read this image. Try a different file, or use the built-in detection.";

function geminiText(json: unknown): string {
  if (!isObj(json)) throw new AiError("format", "The AI sent back something unreadable.");
  const feedback = json["promptFeedback"];
  if (isObj(feedback) && typeof feedback["blockReason"] === "string") throw new AiError("blocked", BLOCKED);
  const candidates = json["candidates"];
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isObj(first)) throw new AiError("format", "The AI returned no answer. Try again.");
  if (first["finishReason"] === "SAFETY" || first["finishReason"] === "PROHIBITED_CONTENT") throw new AiError("blocked", BLOCKED);
  const content = first["content"];
  const parts = isObj(content) && Array.isArray(content["parts"]) ? content["parts"] : [];
  const text = parts.map((p) => (isObj(p) && typeof p["text"] === "string" ? p["text"] : "")).join("").trim();
  if (!text) throw new AiError("format", "The AI returned no answer. Try again.");
  return text;
}

function groqText(json: unknown): string {
  if (!isObj(json)) throw new AiError("format", "The AI sent back something unreadable.");
  const choices = json["choices"];
  const first = Array.isArray(choices) ? choices[0] : undefined;
  if (!isObj(first)) throw new AiError("format", "The AI returned no answer. Try again.");
  if (first["finish_reason"] === "content_filter") throw new AiError("blocked", BLOCKED);
  const message = first["message"];
  const content = isObj(message) ? message["content"] : undefined;
  const raw = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (isObj(p) && typeof p["text"] === "string" ? p["text"] : "")).join("") : "";
  // some reasoning models put their thinking inline; it is not part of the answer
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!text) {
    if (first["finish_reason"] === "length") throw new AiError("format", "The AI ran out of room before it finished answering. Try again.");
    throw new AiError("format", "The AI returned no answer. Try again.");
  }
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

/** Validate one item. Coordinates are kept raw here; they are normalised once the whole answer is known. */
function toItem(raw: unknown, headers: string[]): AiItem | null {
  if (!isObj(raw)) return null;
  const text = typeof raw["text"] === "string" ? raw["text"].trim() : "";
  if (!text || text.length > MAX_TEXT) return null;
  const rawBox = raw["box_2d"] ?? raw["box"];
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;
  const [y0, x0, y1, x1] = rawBox.map(num) as [number, number, number, number];
  if (![y0, x0, y1, x1].every(Number.isFinite) || y1 <= y0 || x1 <= x0) return null;
  const kind = KIND_ALIASES[typeof raw["kind"] === "string" ? norm(raw["kind"]) : ""] ?? "other";
  const fontRaw = typeof raw["font"] === "string" ? raw["font"].toLowerCase() : "";
  const font = fontRaw.includes("script") ? "script" : fontRaw.includes("serif") && !fontRaw.includes("sans") ? "serif" : "sans";
  const alignRaw = typeof raw["align"] === "string" ? raw["align"].toLowerCase() : "";
  const align = alignRaw === "left" || alignRaw === "center" || alignRaw === "right" ? alignRaw : null;
  const colRaw = typeof raw["column"] === "string" ? norm(raw["column"]) : "";
  const column = colRaw ? (headers.find((h) => norm(h) === colRaw) ?? "") : "";
  return { text, kind, box: { x0, y0, x1, y1 }, font, bold: raw["bold"] === true, italic: raw["italic"] === true, align, column };
}

function extractJson(text: string): unknown {
  const bare = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(bare);
  } catch {
    const a = bare.indexOf("{");
    const b = bare.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(bare.slice(a, b + 1));
    throw new SyntaxError("no JSON");
  }
}

export interface ParseOptions {
  provider?: AiProvider;
  /** Size of the image that was sent. Lets us recognise pixel coordinates when a model ignores the 0–1000 scale. */
  dims?: { width: number; height: number };
}

/** Strictly validate the model's answer. Anything malformed is dropped, never trusted. */
export function parseAiResponse(json: unknown, headers: string[] = [], opts: ParseOptions = {}): { items: AiItem[]; dropped: number } {
  const text = opts.provider === "groq" ? groqText(json) : geminiText(json);
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    throw new AiError("format", "The AI answered in a format that could not be read. Try again.");
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data["items"]) ? data["items"] : null;
  if (!list) throw new AiError("format", "The AI answered in a format that could not be read. Try again.");
  const checked = list.slice(0, MAX_ITEMS).map((r) => toItem(r, headers)).filter((i): i is AiItem => i !== null);

  // If any coordinate is clearly beyond 0–1000, the model answered in pixels of the image we sent.
  const maxCoord = Math.max(0, ...checked.flatMap((i) => [i.box.x1, i.box.y1]));
  const pixels = opts.dims && maxCoord > PIXEL_THRESHOLD ? opts.dims : null;
  const items: AiItem[] = [];
  for (const i of checked) {
    const sx = pixels ? 1000 / pixels.width : 1;
    const sy = pixels ? 1000 / pixels.height : 1;
    const box = { x0: clamp1000(i.box.x0 * sx), y0: clamp1000(i.box.y0 * sy), x1: clamp1000(i.box.x1 * sx), y1: clamp1000(i.box.y1 * sy) };
    if (box.x1 - box.x0 < 2 || box.y1 - box.y0 < 2) continue;
    items.push({ ...i, box });
  }
  if (!items.length) throw new AiError("format", list.length ? "The AI's answer had no usable text boxes. Try again, or use the built-in detection." : "The AI found no text on this certificate.");
  return { items, dropped: list.length - items.length };
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

/* ---------- one call ---------- */

export interface DetectOptions {
  provider: AiProvider;
  apiKey: string;
  model: string;
  image: PreparedImage;
  /** CSV column names only. Never row data. */
  headers: string[];
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const MODEL_RE = /^[A-Za-z0-9._/-]{1,64}$/;

async function errorFor(res: Response, apiKey: string, provider: AiProvider): Promise<AiError> {
  const name = PROVIDERS[provider].name;
  let detail = "";
  try {
    const j: unknown = await res.json();
    if (isObj(j) && isObj(j["error"]) && typeof j["error"]["message"] === "string") detail = j["error"]["message"];
  } catch {
    /* no JSON body */
  }
  detail = detail.split(apiKey).join("***").slice(0, 200);
  const header = res.headers?.get?.("retry-after");
  const seconds = header ? Number(header) : NaN;
  const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;

  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(detail))) {
    return new AiError("key", `${name} did not accept that API key. Check it was copied in full${provider === "gemini" ? ", and that the Gemini API is enabled for it" : ""}.`);
  }
  if (res.status === 429) return new AiError("quota", `Your ${name} usage limit has been reached for now. Wait a minute and try again, or check your plan.`, retryAfterMs);
  if (res.status === 404) return new AiError("model", "That model is not available for your key. Pick another model.");
  if (res.status === 413) return new AiError("other", "The image was too large to send.");
  if (res.status === 400 && provider === "groq" && /image|vision|multimodal|content/i.test(detail)) return new AiError("model", "That model cannot read images. Choose a vision model.");
  if (TRANSIENT_STATUS.has(res.status)) return new AiError("busy", `${name} is very busy right now. This is on ${PROVIDERS[provider].company}'s side, not your key or certificate.`, retryAfterMs);
  return new AiError("other", `${name} returned an error (${res.status}). ${detail}`.trim());
}

export async function detectOnce(o: DetectOptions): Promise<{ items: AiItem[]; dropped: number }> {
  const apiKey = o.apiKey.trim();
  const info = PROVIDERS[o.provider];
  if (!apiKey) throw new AiError("key", `Enter your ${info.name} API key first.`);
  if (!MODEL_RE.test(o.model) || o.model.includes("..")) throw new AiError("model", "That model name is not valid.");
  const dims = { width: o.image.width, height: o.image.height };
  const request =
    o.provider === "groq"
      ? { url: GROQ_URL, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: buildGroqRequest(o.model, o.image.base64, o.headers, dims) }
      : {
          url: `${GEMINI_URL}/${encodeURIComponent(o.model)}:generateContent`,
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: buildRequest(o.image.base64, o.headers, dims),
        };
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  o.signal?.addEventListener("abort", onAbort);
  try {
    const res = await (o.fetchImpl ?? fetch)(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: ctrl.signal });
    if (!res.ok) throw await errorFor(res, apiKey, o.provider);
    return parseAiResponse(await res.json(), o.headers, { provider: o.provider, dims });
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (timedOut) throw new AiError("timeout", `${info.name} took too long to answer.`);
    if (e instanceof DOMException && e.name === "AbortError") throw new AiError("cancelled", "Cancelled.");
    throw new AiError("network", `Could not reach ${info.name}. Check your connection, or whether an ad blocker or firewall is blocking it. If it keeps failing only for ${info.name}, your browser may be refusing direct calls to it: try the other provider.`);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

/* ---------- retry + fallback ---------- */

export interface ResilientOptions extends DetectOptions {
  /** Models to try, in order, if the chosen one stays busy. Defaults to the provider's other models. */
  fallbacks?: string[] | undefined;
  /** Progress text for the UI while waiting or switching model. */
  onStatus?: ((text: string) => void) | undefined;
  /** Injected in tests so they do not really wait. */
  sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError("cancelled", "Cancelled."));
    const onAbort = () => { clearTimeout(t); reject(new AiError("cancelled", "Cancelled.")); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** How many times an error is worth retrying on the same model. Key, model, format and similar errors never are. */
function retryBudget(e: AiError): number {
  if (e.code === "busy") return RETRY_DELAYS_MS.length;
  if (e.code === "timeout") return 1;
  if (e.code === "quota" && e.retryAfterMs !== undefined && e.retryAfterMs <= MAX_RETRY_AFTER_MS) return 1;
  return 0;
}

/**
 * detectOnce with automatic retries when the service is overloaded (HTTP 500/502/503/504), slow, or briefly
 * rate-limited, then the same on fallback models. Returns the model that actually answered.
 */
export async function detectResilient(o: ResilientOptions): Promise<{ items: AiItem[]; dropped: number; model: string }> {
  const sleep = o.sleep ?? wait;
  const info = PROVIDERS[o.provider];
  const models = [o.model, ...(o.fallbacks ?? fallbackModels(o.provider, o.model))].filter((m, i, all) => all.indexOf(m) === i);
  let last: AiError | null = null;
  for (const [mi, model] of models.entries()) {
    let retries = 0;
    for (;;) {
      try {
        const r = await detectOnce({ ...o, model });
        return { ...r, model };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        const budget = retryBudget(e);
        if (budget === 0) throw e;
        last = e;
        if (retries >= budget) break;
        const delay = e.retryAfterMs ?? RETRY_DELAYS_MS[retries] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 4000;
        retries++;
        o.onStatus?.(`${info.name} is busy. Retrying in ${Math.ceil(delay / 1000)}s (${retries} of ${budget})…`);
        await sleep(delay, o.signal);
      }
    }
    const next = models[mi + 1];
    if (next) o.onStatus?.(`${model} is still busy. Trying ${next}…`);
  }
  if (last?.code === "quota") throw last;
  throw new AiError(
    "busy",
    `${info.name} is overloaded right now, even after retrying${models.length > 1 ? " and switching models" : ""}. This is on ${info.company}'s side and usually clears within a few minutes. Try again shortly.${last?.code === "timeout" ? " (It was also slow to answer.)" : ""}`,
  );
}
