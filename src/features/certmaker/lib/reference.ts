import JSZip from "jszip";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CustomStyle, FontSet, FrameLine, Paper } from "./types";

type RGB = [number, number, number];

export interface RefText {
  title?: string;
  org?: string;
  body?: string;
  date?: string;
  lines: string[];
}

export interface RefResult {
  kind: "pdf" | "docx" | "image";
  thumb: string; // small preview
  bg: string; // 1600px JPEG of the reference, "" when none (e.g. text-only DOCX)
  style: CustomStyle;
  text: RefText;
  fontSet: FontSet;
  paper: Paper;
  clearInset: number;
  notes: string[];
}

const MAX_BYTES = 25 * 1024 * 1024;

/* ---------- colour helpers ---------- */
const hex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const parseHex = (h: string): RGB => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const sat = (c: RGB) => {
  const mx = Math.max(...c);
  return mx === 0 ? 0 : (mx - Math.min(...c)) / mx;
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------- raster analysis ---------- */
interface RasterAnalysis {
  style: CustomStyle;
  ratio: number;
  notes: string[];
}

function analyseRaster(src: HTMLCanvasElement): RasterAnalysis {
  const W = 800;
  const ratio = src.width / src.height;
  const H = Math.round(W / ratio);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
  ctx.drawImage(src, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const px = (x: number, y: number): RGB => {
    const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
  };
  const notes: string[] = [];

  // background = dominant colour of the central region
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = Math.round(H * 0.2); y < H * 0.8; y += 2) {
    for (let x = Math.round(W * 0.2); x < W * 0.8; x += 2) {
      const [r, g, b] = px(x, y);
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      hist.set(k, e);
    }
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  hist.forEach((e) => {
    if (e.n > best.n) best = e;
  });
  const bg: RGB = best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
  const nonBg = (x: number, y: number) => dist(px(x, y), bg) > 55;

  // frames: lines of non-background colour running along all four edges
  const frac = (d: number) => {
    const fr: number[] = [];
    const xs0 = Math.round(W * 0.14), xs1 = Math.round(W * 0.86);
    const ys0 = Math.round(H * 0.14), ys1 = Math.round(H * 0.86);
    let a = 0, n = 0;
    for (let x = xs0; x < xs1; x++) { n++; if (nonBg(x, d)) a++; }
    fr.push(a / n);
    a = 0; n = 0;
    for (let x = xs0; x < xs1; x++) { n++; if (nonBg(x, H - 1 - d)) a++; }
    fr.push(a / n);
    a = 0; n = 0;
    for (let y = ys0; y < ys1; y++) { n++; if (nonBg(d, y)) a++; }
    fr.push(a / n);
    a = 0; n = 0;
    for (let y = ys0; y < ys1; y++) { n++; if (nonBg(W - 1 - d, y)) a++; }
    fr.push(a / n);
    return { avg: fr.reduce((p, q) => p + q, 0) / 4, min: Math.min(...fr) };
  };
  const runs: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  const maxD = Math.round(W * 0.12);
  for (let d = 0; d <= maxD; d++) {
    const f = frac(d);
    const hit = f.avg >= 0.7 && f.min >= 0.35;
    if (hit) {
      if (cur && d - cur.end <= 3) cur.end = d;
      else {
        cur = { start: d, end: d };
        runs.push(cur);
      }
    }
  }
  const toUnits = (px_: number) => (px_ * 1000) / W;
  const frames: FrameLine[] = [];
  let outerMargin = false;
  for (const r of runs) {
    if (r.start <= 2 && r.end - r.start > W * 0.02) {
      outerMargin = true; // a solid margin of a different colour, not a line
      continue;
    }
    frames.push({ inset: Math.round(toUnits(r.start) * 10) / 10, width: Math.max(1.2, Math.round(toUnits(r.end - r.start + 1) * 10) / 10) });
  }
  frames.sort((a, b) => a.inset - b.inset);
  const usedFrames = frames.slice(0, 2);

  // left colour band
  let bandPx = 0;
  for (let x = 0; x < W * 0.14; x++) {
    let a = 0;
    for (let y = 0; y < H; y += 2) if (nonBg(x, y)) a++;
    if (a / (H / 2) >= 0.9) bandPx = x + 1;
    else if (bandPx > 0) break;
  }
  const band = bandPx >= W * 0.02 && usedFrames.length === 0 ? Math.round(toUnits(bandPx)) : 0;

  // accent colour
  let accent: RGB | null = null;
  const firstFrame = usedFrames[0];
  if (firstFrame) {
    const f = firstFrame;
    const d = Math.round((f.inset * W) / 1000 + (f.width * W) / 2000);
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = Math.round(W * 0.2); x < W * 0.8; x++) {
      const p = px(x, d);
      if (dist(p, bg) > 55) { r += p[0]; g += p[1]; b += p[2]; n++; }
    }
    if (n) accent = [r / n, g / n, b / n];
  } else if (band) {
    accent = px(Math.round((band * W) / 2000), Math.round(H / 2));
  }
  if (!accent) {
    const h2 = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const p = px(x, y);
        if (dist(p, bg) < 70) continue;
        const k = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
        const e = h2.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2];
        h2.set(k, e);
      }
    }
    let bestScore = 0;
    h2.forEach((e) => {
      const col: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
      const score = e.n * (sat(col) >= 0.25 ? 1 + sat(col) : 0.35);
      if (score > bestScore && e.n > 12) {
        bestScore = score;
        accent = col;
      }
    });
  }
  const dark = lum(bg) < 120;
  const accentRgb: RGB = accent ?? (dark ? [212, 175, 88] : [184, 137, 47]);

  // ink colour: the most common strongly-contrasting, low-saturation colour in the middle of the page
  const ih = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = Math.round(H * 0.22); y < H * 0.6; y++) {
    for (let x = Math.round(W * 0.25); x < W * 0.75; x++) {
      const p = px(x, y);
      if (Math.abs(lum(p) - lum(bg)) < 110) continue;
      const k = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
      const e = ih.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2];
      ih.set(k, e);
    }
  }
  let ink: RGB = dark ? [244, 240, 228] : [34, 34, 34];
  let inkScore = 25;
  ih.forEach((e) => {
    const col: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
    const score = e.n * (1 - 0.6 * sat(col));
    if (e.n > 25 && score > inkScore) {
      inkScore = score;
      ink = col;
    }
  });
  if (Math.abs(lum(ink) - lum(bg)) < 110) ink = dark ? [244, 240, 228] : [34, 34, 34];

  // corner ornaments: denser corners than mid-edge, just inside the innermost frame
  let corners = false;
  const lastFrame = usedFrames[usedFrames.length - 1];
  if (lastFrame) {
    const f = lastFrame;
    const o = Math.round(((f.inset + f.width) * W) / 1000) + 3;
    const s = Math.round(W * 0.07);
    const dens = (x0: number, y0: number) => {
      let a = 0, n = 0;
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { n++; if (nonBg(x, y)) a++; }
      return a / n;
    };
    const corner = (dens(o, o) + dens(W - o - s, o) + dens(o, H - o - s) + dens(W - o - s, H - o - s)) / 4;
    const mid = (dens(Math.round(W * 0.3), o) + dens(Math.round(W * 0.3), H - o - s)) / 2;
    corners = corner > 0.04 && corner > mid * 3;
  }

  // report
  notes.push(`${dark ? "Dark" : "Light"} background ${hex(bg)}`);
  if (outerMargin) notes.push("Outer margin of a different colour");
  if (usedFrames.length === 2) notes.push("Double frame around the page");
  else if (usedFrames.length === 1) notes.push("Single frame around the page");
  if (band) notes.push("Colour band down the left side");
  if (corners) notes.push("Ornamented corners");
  if (!usedFrames.length && !band) notes.push("No frame or band detected — clean, open layout");
  notes.push(`Accent colour ${hex(accentRgb)}`);

  return {
    ratio,
    notes,
    style: {
      bg: hex(bg),
      ink: hex(ink),
      muted: hex(mix(ink, bg, 0.45)),
      accent: hex(accentRgb),
      frames: usedFrames,
      band,
      corners,
      caps: false,
    },
  };
}

/* ---------- text understanding ---------- */
interface Line {
  text: string;
  size: number;
  y: number; // reading order (top → bottom)
  family?: string | undefined;
}

const TITLE_RE = /certificate|diploma|award|appreciation|completion|achievement|participation|excellence|merit|recognition/i;
const DATE_RE = /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\b/;

function understand(lines: Line[]): RefText & { family?: string | undefined } {
  const clean = lines.filter((l) => l.text.trim().length > 1);
  const out: RefText & { family?: string | undefined } = { lines: clean.map((l) => l.text.trim()).slice(0, 40) };
  if (!clean.length) return out;
  const bySize = [...clean].sort((a, b) => b.size - a.size);
  const keyword = clean.filter((l) => TITLE_RE.test(l.text) && l.text.length < 70).sort((a, b) => b.size - a.size)[0];
  const title = keyword ?? bySize.find((l) => l.text.length >= 6 && l.text.length < 70);
  if (title) {
    out.title = title.text.trim();
    out.family = title.family;
    const above = clean.filter((l) => l.y < title.y && l.text.length >= 3 && l.text.length < 60);
    if (above[0]) out.org = above[0].text.trim();
    const below = clean.filter((l) => l.y > title.y);
    const bodyLines: string[] = [];
    for (const l of below) {
      if (l.text.trim().length >= 35) bodyLines.push(l.text.trim());
      else if (bodyLines.length) break;
    }
    if (bodyLines.length) out.body = bodyLines.join(" ").slice(0, 280);
  }
  const m = clean.map((l) => l.text).join("\n").match(DATE_RE);
  if (m) out.date = m[0];
  return out;
}

function groupPdfLines(items: { str?: string; transform?: number[]; height?: number; fontName?: string }[], styles: Record<string, { fontFamily?: string }>, pageH: number): Line[] {
  const rows: { y: number; parts: { x: number; s: string }[]; size: number; family?: string | undefined }[] = [];
  for (const it of items) {
    const s = it.str ?? "";
    if (!s.trim() || !it.transform) continue;
    const y = pageH - (it.transform[5] ?? 0);
    const size = Math.hypot(it.transform[0] ?? 0, it.transform[1] ?? 0) || it.height || 10;
    const row = rows.find((r) => Math.abs(r.y - y) < size * 0.4);
    const family = it.fontName ? styles[it.fontName]?.fontFamily : undefined;
    if (row) {
      row.parts.push({ x: it.transform[4] ?? 0, s });
      if (size > row.size) { row.size = size; row.family = family; }
    } else rows.push({ y, parts: [{ x: it.transform[4] ?? 0, s }], size, family });
  }
  return rows
    .sort((a, b) => a.y - b.y)
    .map((r) => ({ text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join("").replace(/\s+/g, " ").trim(), size: r.size, y: r.y, family: r.family }));
}

function fontFromFamily(f?: string, name?: string): FontSet {
  const n = (name ?? "").toLowerCase();
  if (/script|vibes|brush|hand|corsiva|edwardian|chancery|calligraph/.test(n)) return "elegant";
  if (/times|garamond|georgia|palatino|book|cambria|serif|didot|bodoni/.test(n) && !/sans/.test(n)) return "classic";
  if (/arial|calibri|helvet|verdana|segoe|montserrat|roboto|open sans|inter|sans/.test(n)) return "modern";
  if (f === "serif") return "elegant";
  if (f === "sans-serif") return "modern";
  return "elegant";
}

/* ---------- loaders ---------- */
function fileToCanvasFromImage(img: HTMLImageElement | ImageBitmap, maxW = 1600): HTMLCanvasElement {
  const w = img.width;
  const h = img.height;
  const s = Math.min(1, maxW / w);
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Could not read that image.")); };
    i.src = url;
  });
}

function finish(canvas: HTMLCanvasElement | null, a: RasterAnalysis | null, base: Omit<RefResult, "thumb" | "bg" | "style" | "notes" | "paper" | "clearInset"> & { style?: CustomStyle; notes?: string[] }): RefResult {
  const notes = [...(a?.notes ?? []), ...(base.notes ?? [])];
  const style = a?.style ?? base.style;
  if (!style) throw new Error("Could not read the certificate style.");
  if (base.text.title && base.text.title === base.text.title.toUpperCase() && /[A-Z]/.test(base.text.title)) style.caps = true;
  let thumb = "";
  let bg = "";
  if (canvas) {
    bg = canvas.toDataURL("image/jpeg", 0.88);
    const t = document.createElement("canvas");
    t.width = 520;
    t.height = Math.round((520 * canvas.height) / canvas.width);
    const thumbContext = t.getContext("2d");
    if (!thumbContext) throw new Error("Canvas rendering is unavailable.");
    thumbContext.drawImage(canvas, 0, 0, t.width, t.height);
    thumb = t.toDataURL("image/jpeg", 0.8);
  }
  const ratio = a?.ratio ?? 1.414;
  let paper: Paper = "a4";
  if (ratio >= 1.2) paper = Math.abs(ratio - 1.414) <= Math.abs(ratio - 1.294) ? "a4" : "letter";
  else notes.push("Portrait page — style is copied onto a landscape certificate");
  return { ...base, thumb, bg, style, notes, paper, clearInset: style.corners ? 72 : 0 };
}

async function fromImage(file: File): Promise<RefResult> {
  const img = await blobToImage(file);
  const canvas = fileToCanvasFromImage(img);
  const a = analyseRaster(canvas);
  return finish(canvas, a, { kind: "image", text: { lines: [] }, fontSet: a.style.frames.length ? "elegant" : "modern" });
}

async function fromPdf(file: File): Promise<RefResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const scale = 1600 / v1.width;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const content = await page.getTextContent();
  const lines = groupPdfLines(content.items as never, content.styles as never, v1.height);
  const text = understand(lines);
  const a = analyseRaster(canvas);
  const notes = lines.length ? [] : ["No selectable text found — this looks like a scanned page"];
  if (doc.numPages > 1) notes.push("Only page 1 was used");
  return finish(canvas, a, { kind: "pdf", text, fontSet: fontFromFamily(text.family), notes });
}

const attr = (el: Element, name: string) => el.getAttribute(`w:${name}`) ?? "";

async function fromDocx(file: File): Promise<RefResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("That doesn't look like a Word (.docx) file.");
  const dom = new DOMParser().parseFromString(await xmlFile.async("string"), "application/xml");
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const all = (name: string, root: Document | Element = dom) => Array.from(root.getElementsByTagNameNS(W_NS, name));

  const lines: Line[] = [];
  const colorCount = new Map<string, number>();
  const fontCount = new Map<string, number>();
  all("p").forEach((p, i) => {
    const text = all("t", p).map((t) => t.textContent ?? "").join("").trim();
    if (!text) return;
    let size = 0;
    all("sz", p).forEach((s) => { size = Math.max(size, parseInt(attr(s, "val"), 10) / 2 || 0); });
    all("color", p).forEach((c) => {
      const v = attr(c, "val").toUpperCase();
      if (/^[0-9A-F]{6}$/.test(v)) colorCount.set(v, (colorCount.get(v) ?? 0) + text.length);
    });
    all("rFonts", p).forEach((r) => {
      const f = attr(r, "ascii");
      if (f) fontCount.set(f, (fontCount.get(f) ?? 0) + text.length);
    });
    lines.push({ text, size: size || 11, y: i });
  });
  const text = understand(lines);
  const topFont = [...fontCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // largest embedded picture is usually the decorative background
  let canvas: HTMLCanvasElement | null = null;
  const media = Object.keys(zip.files).filter((n) => /^word\/media\/.+\.(png|jpe?g|webp)$/i.test(n));
  let biggest: { name: string; size: number } | null = null;
  for (const n of media) {
    const entry = zip.file(n);
    if (!entry) continue;
    const size = (await entry.async("uint8array")).length;
    if (!biggest || size > biggest.size) biggest = { name: n, size };
  }
  if (biggest) {
    const entry = zip.file(biggest.name);
    if (!entry) throw new Error("Embedded picture could not be read.");
    const blob = await entry.async("blob");
    const img = await blobToImage(blob.type ? blob : new Blob([blob], { type: /png$/i.test(biggest.name) ? "image/png" : "image/jpeg" }));
    if (img.width > 600 && img.width / img.height > 1) canvas = fileToCanvasFromImage(img);
  }

  const fontSet = fontFromFamily(undefined, topFont);
  if (canvas) {
    const a = analyseRaster(canvas);
    return finish(canvas, a, { kind: "docx", text, fontSet, notes: topFont ? [`Main font in the document: ${topFont}`] : [] });
  }

  // no picture — read what Word itself declares: page background, page border, text colours
  const notes: string[] = ["No background picture in the document — style read from Word settings"];
  const bgEl = all("background")[0];
  const bgHex = bgEl && /^[0-9A-Fa-f]{6}$/.test(attr(bgEl, "color")) ? attr(bgEl, "color") : "FFFFFF";
  const bgRgb = parseHex(bgHex);
  const dark = lum(bgRgb) < 120;
  const borders = all("pgBorders")[0];
  const frames: FrameLine[] = [];
  let borderColor: string | null = null;
  if (borders) {
    const top = Array.from(borders.children).find((e) => e.localName === "top") ?? borders.children[0];
    if (top) {
      const v = attr(top, "val");
      const c = attr(top, "color");
      if (/^[0-9A-Fa-f]{6}$/.test(c)) borderColor = c;
      frames.push({ inset: 30, width: v === "thick" ? 5 : 3 });
      if (v === "double" || v === "triple" || v === "thinThickSmallGap" || v === "thickThinSmallGap") frames.push({ inset: 44, width: 1.5 });
      notes.push(frames.length === 2 ? "Double page border" : "Page border");
    }
  }
  const palette = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const nonNeutral = palette.find((c) => sat(parseHex(c)) > 0.2) ?? palette[0];
  const accentHex = borderColor ?? nonNeutral ?? (dark ? "D4AF58" : "B8892F");
  const inkHex = palette.find((c) => Math.abs(lum(parseHex(c)) - lum(bgRgb)) > 90) ?? (dark ? "F4F0E4" : "222222");
  const ink = parseHex(inkHex);
  const style: CustomStyle = {
    bg: hex(bgRgb),
    ink: hex(ink),
    muted: hex(mix(ink, bgRgb, 0.45)),
    accent: "#" + accentHex.toLowerCase(),
    frames,
    band: 0,
    corners: frames.length === 2,
    caps: false,
  };
  const pg = all("pgSz")[0];
  const pw = pg ? parseInt(attr(pg, "w"), 10) : 0;
  const ph = pg ? parseInt(attr(pg, "h"), 10) : 0;
  const ratio = pw && ph ? Math.max(pw, ph) / Math.min(pw, ph) : 1.414;
  notes.push(`Accent colour ${style.accent}`);
  const res = finish(null, { style, ratio, notes: [] }, { kind: "docx", text, fontSet, notes });
  if (pw && ph && pw < ph) res.notes.push("Portrait page — style is copied onto a landscape certificate");
  return res;
}

export async function analyseReference(file: File): Promise<RefResult> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 25 MB.");
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return fromPdf(file);
  if (name.endsWith(".docx")) return fromDocx(file);
  if (name.endsWith(".doc")) throw new Error("Old .doc files aren't supported — save it as .docx or PDF and try again.");
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(name)) return fromImage(file);
  throw new Error("Please upload a PDF, DOCX, PNG or JPG file.");
}
