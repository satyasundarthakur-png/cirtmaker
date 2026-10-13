import type { CertData } from "./types";

/** A reusable organisation profile ("brand kit"). */
export interface BrandKit {
  id: string;
  name: string;
  org: string;
  address: string;
  logo: string;
  sigs: CertData["sigs"];
  sigImgs: string[];
  showSeal: boolean;
  sealText: string;
  template: string;
  accent: string;
  fontSet: CertData["fontSet"];
}

const KEY = "certmaker:brands:v1";
const MAX_KITS = 12;

export function kitFrom(d: CertData, name: string): BrandKit {
  return {
    id: `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || d.org || "Untitled kit",
    org: d.org,
    address: d.address,
    logo: d.logo,
    sigs: d.sigs.map((s) => ({ ...s })),
    sigImgs: [...d.sigImgs],
    showSeal: d.showSeal,
    sealText: d.sealText,
    // a kit built from a reference-image style can't be restored without that style
    template: d.template === "inspired" ? "classic" : d.template,
    accent: d.accent,
    fontSet: d.fontSet,
  };
}

/** One-click reuse: copies identity and look onto the current design, leaving the wording alone. */
export function applyKit(d: CertData, k: BrandKit): CertData {
  return {
    ...d,
    org: k.org,
    address: k.address,
    logo: k.logo,
    sigs: k.sigs.map((s) => ({ ...s })),
    sigImgs: [...k.sigImgs],
    showSeal: k.showSeal,
    sealText: k.sealText,
    template: k.template,
    accent: k.accent,
    fontSet: k.fontSet,
    bgMode: "recreate",
    custom: d.custom,
  };
}

export function loadKits(): BrandKit[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v)
      ? (v as BrandKit[]).filter(
          (k) =>
            !!k &&
            typeof k === "object" &&
            typeof k.id === "string" &&
            Array.isArray(k.sigs) &&
            Array.isArray(k.sigImgs),
        )
      : [];
  } catch {
    return [];
  }
}

/** Returns false when the browser refuses to store it (quota / private mode). */
export function saveKits(list: BrandKit[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_KITS)));
    return true;
  } catch {
    return false;
  }
}
