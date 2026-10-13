import type { CertData } from "./types";

/**
 * Verification model
 * ------------------
 * Each certificate gets a verification URL, shown as a QR code:
 *
 *   embed ON  : <base>/<ID>?d=<compact record>&h=<checksum>
 *               Works with no server: the page decodes the record and re-computes the checksum.
 *               This proves the link/QR was not edited. It cannot prove WHO issued it.
 *   embed OFF : <base>/<ID>
 *               Short link for organisations that run their own registry (verify.yourdomain.com).
 *
 * The local register (this browser) lists what was issued here and supports revocation.
 * Real authenticity needs a server-side registry; see AUDIT.md "QR verification".
 */

export interface VerifyRecord {
  id: string;
  name: string;
  title: string;
  org: string;
  date: string;
}

export interface VerifySettings {
  qr: boolean;
  verifyBase: string; // "" = this site
  verifyEmbed: boolean;
}

const recordOf = (d: CertData): VerifyRecord => ({
  id: d.certId,
  name: d.recipient,
  title: d.title,
  org: d.org,
  date: d.date,
});

const b64u = {
  enc(s: string) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string) {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

export function encodeRecord(r: VerifyRecord): string {
  return b64u.enc(JSON.stringify([r.id, r.name, r.title, r.org, r.date]));
}

export function decodeRecord(s: string): VerifyRecord | null {
  try {
    const a: unknown = JSON.parse(b64u.dec(s));
    if (!Array.isArray(a) || a.length !== 5 || a.some((x) => typeof x !== "string")) return null;
    const [id, name, title, org, date] = a as string[];
    return { id: id!, name: name!, title: title!, org: org!, date: date! };
  } catch {
    return null;
  }
}

/** Short SHA-256 checksum of the record (16 hex chars). */
export async function checksum(r: VerifyRecord): Promise<string> {
  const data = new TextEncoder().encode([r.id, r.name, r.title, r.org, r.date].join("\u241f"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function baseUrl(s: Pick<VerifySettings, "verifyBase">): string {
  const raw = s.verifyBase.trim().replace(/\/+$/, "");
  if (raw) return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://example.com";
  return `${origin}/verify`;
}

export async function verifyUrl(d: CertData): Promise<string> {
  const r = recordOf(d);
  const path = `${baseUrl(d)}/${encodeURIComponent(r.id)}`;
  if (!d.verifyEmbed) return path;
  return `${path}?d=${encodeRecord(r)}&h=${await checksum(r)}`;
}

export type CheckResult =
  | { status: "intact"; record: VerifyRecord }
  | { status: "altered"; record: VerifyRecord | null }
  | { status: "no-record" };

/** Validate the `d` + `h` parameters from a scanned link against the ID in the path. */
export async function checkLink(id: string, d?: string, h?: string): Promise<CheckResult> {
  if (!d || !h) return { status: "no-record" };
  const record = decodeRecord(d);
  if (!record) return { status: "altered", record: null };
  const ok = record.id === id && (await checksum(record)) === h;
  return ok ? { status: "intact", record } : { status: "altered", record };
}

/* ---------- local issue register (this browser) ---------- */

export interface Issued extends VerifyRecord {
  issuedAt: string; // ISO
  revoked?: boolean | undefined;
}

const REG_KEY = "certmaker:register:v1";
const REG_MAX = 5000;

export function loadRegister(): Issued[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(REG_KEY) ?? "[]");
    return Array.isArray(v)
      ? (v as Issued[]).filter((x) => !!x && typeof x === "object" && typeof x.id === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRegister(list: Issued[]) {
  try {
    localStorage.setItem(REG_KEY, JSON.stringify(list.slice(-REG_MAX)));
  } catch {
    /* storage unavailable */
  }
}

/** Record certificates as issued. Re-issuing the same ID updates its record and keeps any revocation. */
export function registerIssued(certs: CertData[]): void {
  const list = loadRegister();
  const idx = new Map(list.map((x, i) => [x.id, i]));
  const now = new Date().toISOString();
  for (const c of certs) {
    if (!c.certId) continue;
    const rec: Issued = { ...recordOf(c), issuedAt: now };
    const at = idx.get(c.certId);
    if (at === undefined) {
      idx.set(c.certId, list.length);
      list.push(rec);
    } else list[at] = { ...rec, revoked: list[at]?.revoked };
  }
  saveRegister(list);
}

export function lookupIssued(id: string): Issued | undefined {
  return loadRegister().find((x) => x.id === id);
}

export function setRevoked(id: string, revoked: boolean): Issued[] {
  const list = loadRegister().map((x) => (x.id === id ? { ...x, revoked } : x));
  saveRegister(list);
  return list;
}

export function clearRegister(): void {
  saveRegister([]);
}
