import qrcode from "qrcode-generator";

/** Build a QR module matrix (true = dark). Error correction L keeps long verification links scannable. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
