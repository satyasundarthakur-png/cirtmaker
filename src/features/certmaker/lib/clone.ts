import { candidateNameIssue, logDetection } from "./clone-name-validation";
import { byPosition, hex } from "./util";
import { buildLines, detectFields, type Detected, type RawItem } from "./clone-detect";
import { clampBox, clonePageMm, isCentered } from "./clone-geometry";
import { fitFieldsToInk, type ErasePatch } from "./clone-erase-canvas";
import { authorizedText } from "./editing/SelectionManager";
import { fitCloneText } from "./clone-text-layout";
import type { CloneKind, CloneSource, CloneTextField } from "./types";

/*
 * Clone Mode. The uploaded certificate is the locked background: it is never cropped, redrawn, simplified,
 * colour-analysed or regenerated. Only the text rectangles listed in `fields` are ever painted over.
 * This module must not import the reference style analyser (see AGENTS.md).
 */

const MAX_BYTES = 25 * 1024 * 1024;
/** PDFs are drawn once at this resolution, capped by canvas memory limits on phones/tablets. */
const PDF_DPI = 300;
const MAX_PDF_PIXELS = 16_000_000;
const OCR_MAX_WIDTH = 2400;
const MAX_SUGGESTIONS = 80;

/* ---------- fields ---------- */

export function cloneField(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
): CloneTextField {
  return {
    id: `clone-${index}`,
    kind: "custom",
    label: "Custom text",
    original: text,
    replacement: text,
    x,
    y,
    w,
    h,
    fontSize: Math.max(8, h * 0.8),
    font: "Inter",
    bold: false,
    italic: false,
    align: "left",
    color: "#17181a",
    erase: "patch",
    cover: "#ffffff",
    weight: 0,
  };
}

/** A field is only painted once its text differs from the original. Untouched fields leave the artwork alone. */
export const isActive = (f: CloneTextField) =>
  f.replacement !== f.original || f.redraw === true || f.deleted === true;

const GENERIC = new Set(["serif", "sans-serif", "cursive", "monospace"]);

/** Typical stem thickness of each font as a fraction of its size, so thickness is only added to fonts that are thinner than the writing. */
const STEM: Record<string, number> = {
  Inter: 0.09,
  Montserrat: 0.095,
  "Playfair Display": 0.075,
  "Cormorant Garamond": 0.045,
  "Great Vibes": 0.03,
  "Noto Sans Oriya": 0.08,
  "Noto Sans Devanagari": 0.08,
  serif: 0.07,
  "sans-serif": 0.085,
};

/** Extra outline thickness (image px) that brings a thin font up to the stroke thickness of the writing it replaces. */
export function extraStroke(
  f: Pick<CloneTextField, "font" | "bold" | "weight">,
  size: number,
): number {
  if (f.weight <= 0) return 0;
  const natural = (STEM[f.font] ?? 0.08) * size * (f.bold ? 1.6 : 1);
  // half the shortfall, and never more than 3.5% of the size: enough to look as dark, not so much that letters fill in
  return Math.max(0, Math.min(0.5 * (f.weight - natural), 0.035 * size));
}

export function fontCss(
  f: Pick<CloneTextField, "font" | "bold" | "italic" | "fontWeight">,
  size: number,
) {
  const lead = `${f.italic ? "italic " : ""}${f.fontWeight ?? (f.bold ? 700 : 400)} ${size}px`;
  if (GENERIC.has(f.font)) return `${lead} ${f.font}`;
  const fallback =
    /playfair|cormorant|garamond|serif/i.test(f.font) && !/sans/i.test(f.font)
      ? "serif"
      : "sans-serif";
  return `${lead} "${f.font}", ${fallback}`;
}

/**
 * Paint the replacement text. Only active fields are touched, and only in their own area:
 *  - "smart": the old writing's own pixels are replaced from `patches`; the rest of the artwork is left alone;
 *  - "patch": a flat rectangle in the cover colour, clipped to the box;
 *  - "none": nothing is removed.
 */
export function paintCloneFields(
  ctx: CanvasRenderingContext2D,
  fields: CloneTextField[],
  patches?: ReadonlyMap<string, ErasePatch>,
  protectedAreas: readonly { id?: string; x: number; y: number; w: number; h: number }[] = [],
) {
  // Erase original ink first, then paint all replacement layers. Moving one must not erase another.
  for (const f of fields.filter(isActive)) {
    const source = f.sourceBox ?? f;
    if (
      ![source.x, source.y, source.w, source.h].every(Number.isFinite) ||
      source.w <= 0 ||
      source.h <= 0
    )
      continue;
    if (f.erase === "smart") {
      const patch = patches?.get(f.id);
      if (patch) ctx.drawImage(patch.canvas, patch.x, patch.y);
    } else if (f.erase === "patch" && f.cover) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(source.x, source.y, source.w, source.h);
      ctx.clip();
      ctx.fillStyle = f.cover;
      ctx.fillRect(source.x, source.y, source.w, source.h);
      ctx.restore();
    }
  }
  for (const f of fields) {
    if (!isActive(f) || f.deleted || !f.replacement.trim()) continue;
    if (
      ![f.x, f.y, f.w, f.h, f.fontSize].every(Number.isFinite) ||
      f.w <= 0 ||
      f.h <= 0 ||
      f.fontSize <= 0
    )
      continue;
    ctx.save();
    for (const area of protectedAreas) {
      if (area.id === f.id) continue;
      ctx.beginPath();
      ctx.rect(-1000000, -1000000, 2000000, 2000000);
      ctx.rect(area.x, area.y, area.w, area.h);
      ctx.clip("evenodd");
    }
    if (f.rotation) {
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.rotate((f.rotation * Math.PI) / 180);
      ctx.translate(-f.x - f.w / 2, -f.y - f.h / 2);
    }
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.globalAlpha = f.opacity ?? 1;
    const padX = Math.min(2, f.w * 0.05),
      padY = Math.min(2, f.h * 0.05);
    let lines = f.replacement.replace(/\t/g, " ").split(/\r?\n/);
    if (f.multiline) {
      ctx.font = fontCss(f, f.fontSize);
      lines = lines.flatMap((paragraph) => {
        const wrapped: string[] = [];
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const next = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(next).width > f.w - 4) {
            wrapped.push(line);
            line = word;
          } else line = next;
        }
        wrapped.push(line);
        return wrapped;
      });
    }
    const spacing = f.letterSpacing ?? 0;
    const wordSpacing = f.wordSpacing ?? 0;
    const nativeWordSpacing = Reflect.has(ctx, "wordSpacing");
    if (nativeWordSpacing)
      (ctx as unknown as { wordSpacing: string }).wordSpacing = `${wordSpacing}px`;
    ctx.fontKerning = f.kerning ?? "normal";
    const nativeSpacing = Reflect.has(ctx, "letterSpacing");
    if (nativeSpacing) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
    let size = f.fontSize;
    for (const line of lines)
      size = Math.min(
        size,
        fitCloneText(
          ctx,
          line,
          (s) => fontCss(f, s),
          size,
          f.w -
            2 * padX -
            (nativeSpacing ? 0 : Math.max(0, line.length - 1) * spacing) -
            (nativeWordSpacing ? 0 : (line.match(/\s/g)?.length ?? 0) * wordSpacing),
          f.h - 2 * padY,
        ).size,
      );
    size = Math.min(
      size,
      (f.h - 2 * padY) / (1 + Math.max(0, lines.length - 1) * (f.lineHeight ?? 1.2)),
    );
    ctx.font = fontCss(f, size);
    ctx.fillStyle = f.color;
    ctx.textAlign = f.align;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(lines[0] ?? "A");
    const ascent = metrics.actualBoundingBoxAscent ?? size * 0.8,
      descent = metrics.actualBoundingBoxDescent ?? size * 0.2;
    const gap = size * (f.lineHeight ?? 1.2);
    const blockHeight = ascent + descent + (lines.length - 1) * gap;
    const tx =
      f.align === "center" ? f.x + f.w / 2 : f.align === "right" ? f.x + f.w - padX : f.x + padX;
    const startY =
      (f.baselineShift ?? 0) +
      (f.baselineOffset !== undefined
        ? f.y + (f.baselineOffset * f.h) / (f.sourceBox?.h ?? f.h)
        : f.y + (f.h - blockHeight) / 2 + ascent);
    if (f.slantAngle) {
      ctx.translate(tx, startY);
      ctx.transform(1, 0, -Math.tan((f.slantAngle * Math.PI) / 180), 1, 0, 0);
      ctx.translate(-tx, -startY);
    }
    const fx = f.textEffects;
    if (fx) {
      ctx.shadowColor = fx.shadowColor;
      ctx.shadowBlur = fx.shadowBlur;
      ctx.shadowOffsetX = fx.shadowX;
      ctx.shadowOffsetY = fx.shadowY;
    }
    lines.forEach((line, i) => {
      const extra = fx?.strokeWidth ?? extraStroke(f, size);
      if (extra >= 0.3) {
        ctx.strokeStyle = fx?.strokeColor ?? f.color;
        ctx.lineWidth = extra;
        ctx.lineJoin = "round";
        ctx.strokeText(line, tx, startY + i * gap);
      }
      if ((spacing && !nativeSpacing) || (wordSpacing && !nativeWordSpacing)) {
        const segments = Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line),
          (s) => s.segment,
        );
        const width =
          segments.reduce((n, g) => n + ctx.measureText(g).width, 0) +
          Math.max(0, segments.length - 1) * spacing +
          (line.match(/\s/g)?.length ?? 0) * wordSpacing;
        let x = tx - (f.align === "center" ? width / 2 : f.align === "right" ? width : 0);
        ctx.textAlign = "left";
        segments.forEach((g) => {
          ctx.fillText(g, x, startY + i * gap);
          x += ctx.measureText(g).width + spacing + (/\s/.test(g) ? wordSpacing : 0);
        });
        ctx.textAlign = f.align;
      } else ctx.fillText(line, tx, startY + i * gap);
    });
    ctx.restore();
  }
}

/* ---------- original image ---------- */

export { loadCloneImage } from "./clone-image";
import { loadCloneImage } from "./clone-image";

/** Colour of one pixel of the original, chosen by the user clicking on it (the colour picker). */
export async function samplePixel(src: string, x: number, y: number): Promise<string> {
  const img = await loadCloneImage(src);
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas rendering is unavailable.");
  ctx.drawImage(img, Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), 1, 1, 0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return hex([r, g, b]);
}

/* ---------- detection -> fields ---------- */

function styleFromHint(hint: string): Pick<CloneTextField, "font" | "bold" | "italic"> {
  const bold = /bold|black|heavy|semibold|demi/i.test(hint);
  const italic = /italic|oblique/i.test(hint);
  const script =
    /script|vibes|brush|signature|cursive|lobster|pacifico|zapf|chancery|handwrit/i.test(hint);
  const serif =
    (/serif/i.test(hint) && !/sans/i.test(hint)) ||
    /times|georgia|garamond|playfair|cormorant|palatino|bookman|minion|cambria/i.test(hint);
  return {
    font: script ? "Great Vibes" : serif ? "Playfair Display" : "Inter",
    bold: bold && !script,
    italic: italic && !script,
  };
}

/** Build an editable field from a detected piece of text. Shared by OCR/PDF detection and optional AI detection. */
export function fieldFromDetected(
  d: Detected,
  id: string,
  page: { w: number; h: number },
): CloneTextField {
  const issue = d.kind === "name" ? candidateNameIssue(d.text, d.box, page) : null;
  if (issue)
    throw new Error(`Unsafe Candidate name detection: ${issue}. Select the actual name manually.`);
  const size = Math.max(8, d.size);
  const padX = Math.max(3, size * 0.15);
  const padY = Math.max(2, size * 0.12);
  const box = clampBox(
    { x: d.box.x - padX, y: d.box.y - padY, w: d.box.w + 2 * padX, h: d.box.h + 2 * padY },
    page,
  );
  const text = d.text.trim();
  logDetection({ text, kind: d.kind, box, confidence: d.guess ? 55 : 90, stage: "clone-creation" });
  return {
    id,
    kind: d.kind,
    label: d.label,
    original: text,
    replacement: text,
    ...(d.kind === "name" ? { detectionBox: { ...d.box } } : {}),
    ...box,
    fontSize: Math.round(size * 10) / 10,
    ...styleFromHint(d.fontHint),
    align: isCentered(box, page.w) ? "center" : "left",
    color: "#17181a",
    erase: "smart",
    cover: "#ffffff",
    weight: 0,
  };
}

function detectionToFields(items: RawItem[], page: { w: number; h: number }) {
  const { fields, rest } = detectFields(buildLines(items), page);
  let n = 0;
  const editable = fields.map((d) => fieldFromDetected(d, `clone-${n++}`, page));
  const others = rest.slice(0, MAX_SUGGESTIONS).map((l) =>
    fieldFromDetected(
      {
        kind: "custom",
        label: "Other text",
        box: { x: l.x, y: l.y, w: l.w, h: l.h },
        text: l.text,
        size: l.size,
        fontHint: l.fontHint,
      },
      `clone-${n++}`,
      page,
    ),
  );
  return { fields: editable, suggestions: others };
}

/** OCR for scanned certificates and images. Loaded only when needed; reads text, never styles. */
async function ocrItems(canvas: HTMLCanvasElement): Promise<RawItem[]> {
  const { createWorker } = await import("tesseract.js");
  const k = Math.min(1, OCR_MAX_WIDTH / canvas.width);
  let source = canvas;
  if (k < 1) {
    source = document.createElement("canvas");
    source.width = Math.round(canvas.width * k);
    source.height = Math.round(canvas.height * k);
    source.getContext("2d")?.drawImage(canvas, 0, 0, source.width, source.height);
  }
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(source, {}, { blocks: true });
    const words =
      result.data.blocks?.flatMap((b) =>
        b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)),
      ) ?? [];
    return words
      .filter((w) => w.text.trim() && w.confidence >= 40)
      .map((w) => ({
        text: w.text.trim(),
        x: w.bbox.x0 / k,
        y: w.bbox.y0 / k,
        w: (w.bbox.x1 - w.bbox.x0) / k,
        h: (w.bbox.y1 - w.bbox.y0) / k,
      }));
  } finally {
    await worker.terminate();
  }
}

/* ---------- loading ---------- */

function mimeFor(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  return "";
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("That file could not be read."));
    r.readAsDataURL(blob);
  });
}

async function loadPdf(file: File): Promise<CloneSource> {
  const [pdfjs, workerAsset] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerAsset.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const wanted = PDF_DPI / 72;
    const area = base.width * base.height * wanted * wanted;
    const scale = area > MAX_PDF_PIXELS ? wanted * Math.sqrt(MAX_PDF_PIXELS / area) : wanted;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable.");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const content = await page.getTextContent();
    const items: RawItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const t = pdfjs.Util.transform(viewport.transform, item.transform);
      const size = Math.hypot(t[2] ?? 0, t[3] ?? 0);
      if (size < 1) continue;
      const style = content.styles[item.fontName];
      items.push({
        text: item.str,
        x: t[4] ?? 0,
        y: (t[5] ?? 0) - size * 0.9,
        w: Math.max(1, item.width * scale),
        h: size * 1.15,
        size,
        fontHint: `${item.fontName} ${style?.fontFamily ?? ""}`,
      });
    }
    const page2 = { w: canvas.width, h: canvas.height };
    let { fields, suggestions } = items.length
      ? detectionToFields(items, page2)
      : { fields: [], suggestions: [] };
    if (!items.length) ({ fields, suggestions } = detectionToFields(await ocrItems(canvas), page2)); // scanned PDF
    return fitFieldsToInk({
      image: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      filename: file.name,
      kind: "pdf",
      pageMm: [
        Math.round(((base.width * 25.4) / 72) * 10) / 10,
        Math.round(((base.height * 25.4) / 72) * 10) / 10,
      ],
      fields,
      suggestions,
    });
  } finally {
    await doc.destroy();
  }
}

async function loadImage(file: File, mime: string): Promise<CloneSource> {
  // The uploaded bytes are kept as they are (no canvas round-trip), so the artwork is untouched.
  const image = await readDataUrl(new Blob([file], { type: mime }));
  const img = await loadCloneImage(image);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable.");
  ctx.drawImage(img, 0, 0);
  const { fields, suggestions } = detectionToFields(await ocrItems(canvas), {
    w: width,
    h: height,
  });
  return fitFieldsToInk({
    image,
    width,
    height,
    filename: file.name,
    kind: "image",
    fields,
    suggestions,
  });
}

export async function loadClone(file: File): Promise<CloneSource> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 25 MB.");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return loadPdf(file);
  const mime = mimeFor(file);
  if (mime) return loadImage(file, mime);
  throw new Error(
    "Clone Mode needs a PDF, PNG or JPG to lock the original layout. Export Word files to PDF first.",
  );
}

/* ---------- editing operations (pure) ---------- */

/** Template variable each kind of field is normally filled from. */
const KIND_VARIABLE: Record<CloneKind, string | null> = {
  name: "name",
  certId: "certificate_id",
  date: "date",
  course: "course",
  custom: null,
};

export function nextIndex(c: CloneSource) {
  const nums = [...c.fields, ...c.suggestions].map((f) =>
    Number(/^clone-(\d+)$/.exec(f.id)?.[1] ?? -1),
  );
  return Math.max(-1, ...nums) + 1;
}

/** Apply only the geometry and look from a fitted copy onto the current clone, so text typed meanwhile is kept. */
export function mergeFit(current: CloneSource, fitted: CloneSource): CloneSource {
  const byId = new Map(fitted.fields.map((f) => [f.id, f]));
  return {
    ...current,
    fields: current.fields.map((f) => {
      if (!authorizedText(f)) return f;
      const t = byId.get(f.id);
      return t
        ? {
            ...f,
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            fontSize: t.fontSize,
            color: t.color,
            weight: t.weight,
          }
        : f;
    }),
  };
}

export function patchField(
  c: CloneSource,
  id: string,
  patch: Partial<CloneTextField>,
): CloneSource {
  return {
    ...c,
    fields: c.fields.map((f) => {
      if (f.id !== id || !authorizedText(f)) return f;
      const next = {
        ...f,
        ...patch,
        id: f.id,
        original: f.original,
        protection: f.protection ?? "text",
      };
      const visualChanged = [
        "x",
        "y",
        "w",
        "h",
        "rotation",
        "font",
        "fontSize",
        "color",
        "bold",
        "italic",
        "align",
        "weight",
        "fontWeight",
        "wordSpacing",
        "kerning",
        "slantAngle",
        "baselineShift",
        "letterSpacing",
        "lineHeight",
        "opacity",
        "textEffects",
      ].some((key) => key in patch);
      if (visualChanged) {
        next.redraw = true;
        if (f.original && !f.sourceBox) next.sourceBox = { x: f.x, y: f.y, w: f.w, h: f.h };
      }
      if (patch.bold !== undefined && patch.fontWeight === undefined)
        next.fontWeight = patch.bold ? 700 : 400;
      if (
        ["font", "fontSize", "color", "bold", "italic", "align", "weight"].some(
          (key) => key in patch,
        )
      )
        next.redraw = true;
      if (patch.replacement === f.original && !("redraw" in patch)) next.redraw = false;
      const geometryChanged = ["x", "y", "w", "h"].some((key) => key in patch);
      if (geometryChanged) {
        const finite = {
          x: Number.isFinite(next.x) ? next.x : f.x,
          y: Number.isFinite(next.y) ? next.y : f.y,
          w: Number.isFinite(next.w) ? next.w : f.w,
          h: Number.isFinite(next.h) ? next.h : f.h,
        };
        Object.assign(next, clampBox(finite, { w: c.width, h: c.height }));
      }
      if (!Number.isFinite(next.fontSize) || next.fontSize <= 0) next.fontSize = f.fontSize;
      return next;
    }),
  };
}

/** Remove a field. A detected field goes back to the "other text" list so it can be restored. */
export function removeField(c: CloneSource, id: string): CloneSource {
  const f = c.fields.find((x) => x.id === id);
  if (!f || !authorizedText(f)) return c;
  const back = f.original
    ? [...c.suggestions, { ...f, replacement: f.original, redraw: false }].sort(byPosition)
    : c.suggestions;
  return { ...c, fields: c.fields.filter((x) => x.id !== id), suggestions: back };
}

export function promoteSuggestion(c: CloneSource, id: string): CloneSource {
  const s = c.suggestions.find((x) => x.id === id);
  if (!s || !authorizedText(s)) return c;
  return {
    ...c,
    suggestions: c.suggestions.filter((x) => x.id !== id),
    fields: [...c.fields, s].sort(byPosition),
  };
}

/** A new text box in the middle of the page, for a spot the detector missed (e.g. a blank line on a template). */
export function addManualField(c: CloneSource): { clone: CloneSource; id: string } {
  const w = Math.round(c.width * 0.35);
  const h = Math.max(24, Math.round(c.height * 0.05));
  const id = `clone-${nextIndex(c)}`;
  const field: CloneTextField = {
    ...cloneField("", Math.round((c.width - w) / 2), Math.round((c.height - h) / 2), w, h, 0),
    id,
    label: "New text",
    replacement: "New text",
    fontSize: Math.round(h * 0.7),
    align: "center",
    erase: "none",
    cover: "",
  };
  return { clone: { ...c, fields: [...c.fields, field] }, id };
}

/** Point every untouched detected field at its CSV column: {{name}}, {{certificate_id}}, {{date}}, {{course}}. */
export function autoMapFields(c: CloneSource): CloneSource {
  return {
    ...c,
    fields: c.fields.map((f) => {
      const v = KIND_VARIABLE[f.kind];
      return authorizedText(f) && v && f.replacement === f.original
        ? { ...f, replacement: `{{${v}}}` }
        : f;
    }),
  };
}

/** Manual inspector unlock only; protected non-text assets cannot be unlocked. */
export function setLayerLock(c: CloneSource, id: string, locked: boolean): CloneSource {
  return {
    ...c,
    fields: c.fields.map((f) =>
      f.id === id && (!f.protection || f.protection === "text") && !f.deleted
        ? { ...f, locked }
        : f,
    ),
  };
}
