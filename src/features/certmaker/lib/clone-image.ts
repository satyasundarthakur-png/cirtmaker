/** Decoding of the locked original. Kept apart so the erase code can use it without importing clone.ts. */

let lastImage: { src: string; promise: Promise<HTMLImageElement> } | null = null;

/** Decode the locked original. Only the latest image is cached so replacing a template frees the old one. */
export function loadCloneImage(src: string): Promise<HTMLImageElement> {
  if (lastImage?.src === src) return lastImage.promise;
  const promise = new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("The original certificate could not be displayed."));
    img.src = src;
  });
  lastImage = { src, promise };
  promise.catch(() => {
    if (lastImage?.promise === promise) lastImage = null;
  });
  return promise;
}
