export function fileSafe(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r\t]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function nextId(base: string, i: number) {
  const m = base.match(/(\d+)(\D*)$/);
  if (!m || !m[1]) return base ? `${base}-${i + 1}` : "";
  const n = String(parseInt(m[1], 10) + i).padStart(m[1].length, "0");
  return base.slice(0, m.index) + n + m[2];
}

/* ---------- export profiles ---------- */

export type ExportFormat = "pdf" | "png" | "jpeg" | "svg";

export interface ExportProfile {
  id: "print" | "web" | "highres" | "custom";
  label: string;
  hint: string;
  format: ExportFormat;
  dpi: number;
  quality: number; // 0.5–1, JPEG / PDF image quality
}

export const PROFILES: ExportProfile[] = [
  { id: "print", label: "Print optimised", hint: "PDF at 300 dpi for printers and print shops", format: "pdf", dpi: 300, quality: 0.95 },
  { id: "web", label: "Web optimised", hint: "Small JPEG at 150 dpi for email and websites", format: "jpeg", dpi: 150, quality: 0.85 },
  { id: "highres", label: "High resolution", hint: "Lossless PNG at 450 dpi for large prints and archives", format: "png", dpi: 450, quality: 1 },
];

export const DPI_MIN = 72;
export const DPI_MAX = 600;
/** Longest allowed side, in pixels. Keeps phones and tablets from running out of canvas memory. */
export const MAX_SIDE_PX = 8000;
const PAPER_WIDTH_IN: Record<string, number> = { a4: 297 / 25.4, letter: 11 };

export const clampDpi = (n: number) => Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(Number.isFinite(n) ? n : 300)));

export function pixelWidth(paper: string, dpi: number) {
  const px = Math.round((PAPER_WIDTH_IN[paper] ?? PAPER_WIDTH_IN["a4"]!) * clampDpi(dpi));
  return Math.min(px, MAX_SIDE_PX);
}

export const EXT: Record<ExportFormat, string> = { pdf: "pdf", png: "png", jpeg: "jpg", svg: "svg" };

/**
 * SVG wrapper at the certificate's physical size. The artwork inside is a raster image:
 * it embeds cleanly in layouts and design tools, but text is not editable vector text.
 */
export function svgWrap(dataUrl: string, wMm: number, hMm: number, wPx: number, hPx: number) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wPx} ${hPx}">` +
    `<image width="${wPx}" height="${hPx}" href="${dataUrl}" xlink:href="${dataUrl}"/></svg>`
  );
}
