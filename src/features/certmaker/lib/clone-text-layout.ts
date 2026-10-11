/** Fit user-entered single-line text without changing template pixels or font selection. */
export function fitCloneText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  requestedSize: number,
  width: number,
  height: number,
) {
  let size = Math.max(0.1, requestedSize);
  let ascent = size * 0.8;
  let descent = size * 0.2;
  for (let attempt = 0; attempt < 32; attempt++) {
    ctx.font = font(size);
    const metrics = ctx.measureText(text);
    ascent = metrics.actualBoundingBoxAscent ?? size * 0.8;
    descent = metrics.actualBoundingBoxDescent ?? size * 0.2;
    const inkWidth = Math.max(metrics.width, (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? metrics.width));
    const ratio = Math.min(1, width / Math.max(inkWidth, 0.01), height / Math.max(ascent + descent, 0.01));
    if (ratio >= 1) break;
    size *= Math.max(0.01, ratio * 0.99);
  }
  ctx.font = font(size);
  return { size, ascent, descent };
}