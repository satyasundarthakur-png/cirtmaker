import type { CloneSource, CloneTextField } from "./types";

const MAX_BYTES = 25 * 1024 * 1024;

export function cloneField(text: string, x: number, y: number, w: number, h: number, index: number): CloneTextField {
  return { id: `clone-${index}`, original: text, replacement: text, x, y, w, h, fontSize: Math.max(8, h * 0.8), font: "Inter", color: "#17181a", cover: "#ffffff" };
}

async function imageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

async function detectScannedText(image: string): Promise<CloneTextField[]> {
  // Loaded only for explicit scanned-text recognition. Never imports the style analyser.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(image, {}, { blocks: true });
    const lines = result.data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
    return lines.filter((l) => l.text.trim() && l.confidence >= 40).map((l, i) =>
      cloneField(l.text.trim(), l.bbox.x0, l.bbox.y0, l.bbox.x1 - l.bbox.x0, l.bbox.y1 - l.bbox.y0, i));
  } finally { await worker.terminate(); }
}

export async function loadClone(file: File): Promise<CloneSource> {
  if (file.size > MAX_BYTES) throw new Error("That file is over 25 MB.");
  const canvas = document.createElement("canvas");
  let fields: CloneTextField[] = [];
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const [pdfjs, workerAsset] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerAsset.default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = 2000 / base.width;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas rendering is unavailable.");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const x = transform[4] ?? 0;
        const baseline = transform[5] ?? 0;
        const size = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
        const field = cloneField(item.str, x, baseline - size, Math.max(1, item.width * scale), Math.max(1, size * 1.2), fields.length);
        field.fontSize = size;
        const family = content.styles[item.fontName]?.fontFamily ?? "sans-serif";
        field.font = /serif/i.test(family) && !/sans/i.test(family) ? "serif" : "Inter";
        fields.push(field);
      }
    } finally { await doc.destroy(); }
  } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    const img = await imageFromFile(file);
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable.");
    ctx.drawImage(img, 0, 0);
  } else {
    throw new Error("Clone Mode needs a PDF, PNG or JPG to lock the original layout. Export Word files to PDF first.");
  }
  const image = canvas.toDataURL("image/png");
  if (!fields.length) fields = await detectScannedText(image);
  return { image, width: canvas.width, height: canvas.height, filename: file.name, fields };
}

/** Only changed text rectangles are covered. No pixels are sampled or analysed. */
export function paintCloneFields(ctx: CanvasRenderingContext2D, fields: CloneTextField[]) {
  for (const field of fields) {
    if (field.replacement === field.original) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(field.x, field.y, field.w, field.h);
    ctx.clip();
    ctx.fillStyle = field.cover;
    ctx.fillRect(field.x, field.y, field.w, field.h);
    ctx.fillStyle = field.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let size = field.fontSize;
    ctx.font = `${size}px ${field.font}`;
    while (ctx.measureText(field.replacement).width > field.w && size > 4) {
      size -= 0.5;
      ctx.font = `${size}px ${field.font}`;
    }
    ctx.fillText(field.replacement, field.x, field.y);
    ctx.restore();
  }
}