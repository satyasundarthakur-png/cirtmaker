import JSZip from "jszip";
import { PAPER_MM, type CertData } from "./types";
import { renderToCanvas } from "./render";

const EXPORT_W = 2339; // ≈200 dpi on A4

export function fileSafe(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r\t]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function nextId(base: string, i: number) {
  const m = base.match(/(\d+)(\D*)$/);
  if (!m) return base ? `${base}-${i + 1}` : "";
  const n = String(parseInt(m[1], 10) + i).padStart(m[1].length, "0");
  return base.slice(0, m.index) + n + m[2];
}

async function canvasFor(d: CertData) {
  const c = document.createElement("canvas");
  await renderToCanvas(c, d, EXPORT_W);
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

export type BatchFormat = "pdf-zip" | "png-zip" | "pdf-one";

export async function batchExport(
  names: string[],
  base: CertData,
  format: BatchFormat,
  onProgress: (done: number, total: number) => void,
): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  let one: Awaited<ReturnType<typeof newPdf>> | null = null;
  if (format === "pdf-one") one = await newPdf(base);

  for (let i = 0; i < names.length; i++) {
    const d: CertData = { ...base, recipient: names[i], certId: nextId(base.certId, i) };
    const c = await canvasFor(d);
    const label = `${String(i + 1).padStart(3, "0")}-${fileSafe(names[i]) || "certificate"}`;
    if (format === "png-zip") {
      zip.file(`${label}.png`, await toBlob(c, "image/png"));
    } else if (format === "pdf-zip") {
      const { pdf, w, h } = await newPdf(d);
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, w, h);
      zip.file(`${label}.pdf`, pdf.output("blob"));
    } else if (one) {
      if (i > 0) one.pdf.addPage([one.w, one.h], "landscape");
      one.pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, one.w, one.h);
    }
    onProgress(i + 1, names.length);
    await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
  }
  if (one) return { blob: one.pdf.output("blob"), filename: "certificates.pdf" };
  return { blob: await zip.generateAsync({ type: "blob" }), filename: `certificates-${format === "png-zip" ? "png" : "pdf"}.zip` };
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
