/**
 * Read an image file and scale it down so it survives being saved in the browser.
 * Big logos/signatures used to be dropped silently on reload; a ~600 px image looks identical on a certificate.
 */
export async function shrinkImage(file: File, maxSide = 700): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That image could not be read."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("That image could not be processed.");
    ctx.drawImage(img, 0, 0, w, h);
    let out = c.toDataURL("image/png"); // keeps transparency
    if (out.length > 180_000) {
      const webp = c.toDataURL("image/webp", 0.9); // also keeps transparency, much smaller
      if (webp.startsWith("data:image/webp") && webp.length < out.length) out = webp;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
