import JSZip from "jszip";
import { PAPER_MM, type CertData } from "./types";
import { renderToCanvas } from "./render";

const EXPORT_W = 2339; // ≈200 dpi on A4

export { fileSafe, nextId } from "./exporter-utils";
import { EXT, fileSafe, pixelWidth, svgWrap, type ExportProfile } from "./exporter-utils";

async function canvasFor(d: CertData, widthPx: number = EXPORT_W) {
  const c = document.createElement("canvas");
  await renderToCanvas(c, d, widthPx);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("export failed"))), type, q));

async function newPdf(d: CertData) {
  const { jsPDF } = await import("jspdf");
  const [w, h] = PAPER_MM[d.paper];
  return { pdf: new jsPDF({ orientation: "landscape", unit: "mm", format: [w, h], compress: true }), w, h };
}

export async function pdfBlob(d: CertData): Promise<Blob> {
  const { pdf, w, h } = await newPdf(d);
  pdf.addImage((await canvasFor(d)).toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, w, h);
  return pdf.output("blob");
}

export async function pngBlob(d: CertData): Promise<Blob> {
  return toBlob(await canvasFor(d), "image/png");
}

/** Render one certificate using an export profile (format, dpi, quality). */
export async function exportWith(d: CertData, p: Pick<ExportProfile, "format" | "dpi" | "quality">): Promise<{ blob: Blob; ext: string }> {
  const c = await canvasFor(d, pixelWidth(d.paper, p.dpi));
  const ext = EXT[p.format];
  if (p.format === "png") return { blob: await toBlob(c, "image/png"), ext };
  if (p.format === "jpeg") return { blob: await toBlob(c, "image/jpeg", p.quality), ext };
  if (p.format === "svg") {
    const [w, h] = PAPER_MM[d.paper];
    const svg = svgWrap(c.toDataURL("image/png"), w, h, c.width, c.height);
    return { blob: new Blob([svg], { type: "image/svg+xml" }), ext };
  }
  const { pdf, w, h } = await newPdf(d);
  pdf.addImage(c.toDataURL("image/jpeg", p.quality), "JPEG", 0, 0, w, h);
  return { blob: pdf.output("blob"), ext };
}

export type BatchFormat = "pdf-zip" | "png-zip" | "jpeg-zip" | "pdf-one";

export async function batchExport(
  items: CertData[],
  format: BatchFormat,
  onProgress: (done: number, total: number) => void,
  dpi = 200,
  quality = 0.92,
): Promise<{ blob: Blob; filename: string }> {
  const first = items[0];
  if (!first) throw new Error("Nothing to generate.");
  const zip = new JSZip();
  let one: Awaited<ReturnType<typeof newPdf>> | null = null;
  if (format === "pdf-one") one = await newPdf(first);

  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    if (!d) continue;
    const c = await canvasFor(d, pixelWidth(d.paper, dpi));
    const label = `${String(i + 1).padStart(3, "0")}-${fileSafe(d.recipient) || "certificate"}`;
    if (format === "png-zip") {
      zip.file(`${label}.png`, await toBlob(c, "image/png"));
    } else if (format === "jpeg-zip") {
      zip.file(`${label}.jpg`, await toBlob(c, "image/jpeg", quality));
    } else if (format === "pdf-zip") {
      const { pdf, w, h } = await newPdf(d);
      pdf.addImage(c.toDataURL("image/jpeg", quality), "JPEG", 0, 0, w, h);
      zip.file(`${label}.pdf`, pdf.output("blob"));
    } else if (one) {
      if (i > 0) one.pdf.addPage([one.w, one.h], "landscape");
      one.pdf.addImage(c.toDataURL("image/jpeg", Math.min(quality, 0.9)), "JPEG", 0, 0, one.w, one.h);
    }
    onProgress(i + 1, items.length);
    await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
  }
  if (one) return { blob: one.pdf.output("blob"), filename: "certificates.pdf" };
  return { blob: await zip.generateAsync({ type: "blob" }), filename: `certificates-${format === "png-zip" ? "png" : format === "jpeg-zip" ? "jpg" : "pdf"}.zip` };
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
