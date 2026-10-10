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

export interface CertData {
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
