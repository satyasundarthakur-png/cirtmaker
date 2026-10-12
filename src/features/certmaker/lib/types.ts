import type { Fx } from "./effects";

export type Paper = "a4" | "letter";
export type FontSet = "elegant" | "classic" | "modern" | "noto";

export interface Signatory {
  name: string;
  role: string;
}

export interface FrameLine {
  inset: number; // distance from page edge, in 1000-unit page width
  width: number;
}

/** Style learned from an uploaded reference certificate. */
export interface CustomStyle {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  frames: FrameLine[];
  band: number; // left colour band width (0 = none)
  corners: boolean;
  caps: boolean;
}

export type BgMode = "recreate" | "image";

export type CloneKind = "name" | "certId" | "date" | "course" | "custom";
export type CloneAlign = "left" | "center" | "right";
/** How the old text is removed: only its own pixels ("smart"), a flat rectangle ("patch"), or not at all. */
export type CloneErase = "smart" | "patch" | "none";

/** One editable text rectangle laid over the locked original. All numbers are pixels of the original image. */
export interface CloneTextField {
  id: string;
  kind: CloneKind;
  label: string;
  original: string;
  replacement: string;
  /** Repaint unchanged wording after an explicit style edit. */
  redraw?: boolean;
  locked?: boolean;
  protection?: "text" | "signature" | "logo" | "security" | "artwork";
  deleted?: boolean;
  rotation?: number;
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  multiline?: boolean;
  /** Native template baseline offset; retains baseline when changing wording. */
  baselineOffset?: number;
  opacity?: number;
  textEffects?: {
    strokeColor: string;
    strokeWidth: number;
    shadowColor: string;
    shadowBlur: number;
    shadowX: number;
    shadowY: number;
  };
  /** Immutable location of original ink; moving a replacement must erase here. */
  sourceBox?: { x: number; y: number; w: number; h: number };
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  font: string;
  bold: boolean;
  italic: boolean;
  align: CloneAlign;
  color: string;
  /** How the old text is removed. "smart" erases only the old writing's own pixels. */
  erase: CloneErase;
  /** Colour of the flat patch used when `erase` is "patch". "" = no patch. */
  cover: string;
  /** Stroke thickness (image px) the new text should match. Thickness is added only if the chosen font is thinner. 0 = font as designed. */
  weight: number;
}

export interface CloneSource {
  /** The uploaded artwork exactly as supplied (PDFs are rendered once at print resolution). Never re-drawn or altered. */
  image: string;
  width: number;
  height: number;
  filename: string;
  kind: "image" | "pdf";
  /** Physical page size when the source is a PDF. */
  pageMm?: [number, number];
  fields: CloneTextField[];
  /** Other text found on the certificate. Not editable unless the user promotes it. */
  suggestions: CloneTextField[];
}

export interface CertData {
  cloneMode: boolean;
  clone: CloneSource | null;
  /** Native-template editable overlays, in 1000-unit page coordinates. */
  textLayers?: CloneTextField[];
  template: string;
  accent: string;
  paper: Paper;
  fontSet: FontSet;
  org: string;
  title: string;
  subtitle: string;
  recipient: string;
  body: string;
  date: string;
  certId: string;
  sigs: Signatory[];
  showSeal: boolean;
  sealText: string;
  logo: string; // data URL or ""
  custom: CustomStyle | null;
  bgMode: BgMode;
  refBg: string; // reference image (data URL) used when bgMode === "image"
  colors: Record<string, string>; // per-element colour override: "#rrggbb" or "metal:<id>"
  fx: Record<string, Fx>; // per-element effects, keyed by element id
  clearInset: number; // how far in from the edge the original artwork is kept (image mode)
  address: string; // organisation address (available as {{address}})
  sigImgs: string[]; // optional signature images (data URLs), one per signatory
  qr: boolean; // print a verification QR code
  verifyBase: string; // verification site, "" = this site
  verifyEmbed: boolean; // embed the record in the link so it verifies without a server
}

export const PAPER_RATIO: Record<Paper, number> = { a4: 297 / 210, letter: 11 / 8.5 };
export const PAPER_MM: Record<Paper, [number, number]> = { a4: [297, 210], letter: [279.4, 215.9] };

const today = () =>
  new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export const DEFAULT_DATA: CertData = {
  cloneMode: false,
  clone: null,
  template: "classic",
  accent: "#b8892f",
  paper: "a4",
  fontSet: "elegant",
  org: "Your Organisation",
  title: "Certificate of Achievement",
  subtitle: "This certificate is proudly presented to",
  recipient: "Recipient Name",
  body: "in recognition of outstanding performance, dedication and commitment demonstrated throughout the programme.",
  date: today(),
  certId: "CERT-2026-001",
  sigs: [
    { name: "Dr. A. Sharma", role: "Director" },
    { name: "B. Patel", role: "Programme Coordinator" },
  ],
  showSeal: true,
  sealText: "",
  logo: "",
  custom: null,
  bgMode: "recreate",
  refBg: "",
  clearInset: 70,
  fx: {},
  colors: {},
  address: "",
  sigImgs: ["", ""],
  qr: false,
  verifyBase: "",
  verifyEmbed: true,
};
