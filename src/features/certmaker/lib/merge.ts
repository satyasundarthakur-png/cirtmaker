import type { CertData } from "./types";
import { nextId } from "./exporter-utils";

/** One recipient row. Keys are normalised header names (lowercase, snake_case). */
export interface Row {
  name?: string;
  date?: string;
  organization?: string;
  certificate_id?: string;
  [column: string]: string | undefined;
}

export interface Dataset {
  headers: string[]; // normalised
  rows: Row[];
}

/** Variables every certificate understands, whether or not they appear in the CSV. */
export const BUILT_IN_VARS = ["name", "course", "date", "score", "grade", "organization", "certificate_id", "address"] as const;

const ALIASES: Record<string, string> = {
  recipient: "name",
  full_name: "name",
  student: "name",
  participant: "name",
  org: "organization",
  institute: "organization",
  id: "certificate_id",
  cert_id: "certificate_id",
  certificateid: "certificate_id",
  program: "course",
  programme: "course",
  workshop: "course",
  marks: "score",
};

export function normaliseHeader(h: string): string {
  const k = h
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return ALIASES[k] ?? k;
}

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Small RFC-4180 style parser: quoted fields, escaped quotes, embedded newlines. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = delimiter ?? detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      out.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Turn pasted/uploaded text into a dataset.
 * - With a header row (e.g. `Name,Course,Score,Date`): every column becomes a variable.
 * - A plain list of names (one column, no header) is still supported.
 */
export function parseDataset(text: string): Dataset {
  const table = parseDelimited(text.trim());
  if (table.length === 0) return { headers: [], rows: [] };
  const first = (table[0] ?? []).map(normaliseHeader);
  const multi = first.length > 1;
  const hasNameHeader = first.includes("name");
  if (!multi && !hasNameHeader) {
    return { headers: ["name"], rows: table.map((r) => ({ name: (r[0] ?? "").trim() })).filter((r) => r.name) };
  }
  const headers = first.map((h, i) => h || `column_${i + 1}`);
  const rows = table.slice(1).map((cells) => {
    const r: Row = {};
    headers.forEach((h, i) => {
      r[h] = (cells[i] ?? "").trim();
    });
    return r;
  });
  return { headers, rows };
}

const VAR_RE = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

/** Names of all `{{variables}}` used in a string. */
export function variablesIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(VAR_RE)) found.push(normaliseHeader(m[1] ?? ""));
  return found;
}

/** Replace `{{var}}` with row values. Unknown variables are left visible so mistakes are obvious. */
export function fill(text: string, row: Row): string {
  return text.replace(VAR_RE, (whole, raw: string) => {
    const v = row[normaliseHeader(raw)];
    return v === undefined || v === "" ? whole : v;
  });
}

/** Which template fields can contain variables. */
const TEXT_FIELDS = ["org", "title", "subtitle", "recipient", "body", "date", "certId", "sealText"] as const;

export function templateText(d: CertData): string {
  return [...TEXT_FIELDS.map((k) => d[k]), ...d.sigs.flatMap((s) => [s.name, s.role])].join("\n");
}

/** Variables used by the template that the dataset can't supply. */
export function missingVariables(d: CertData, ds: Dataset): string[] {
  const have = new Set(ds.headers);
  const builtin = new Set<string>(["certificate_id"]);
  return [...new Set(variablesIn(templateText(d)))].filter((v) => !have.has(v) && !builtin.has(v));
}

/** Build the certificate for one row. Certificate IDs count up unless the row carries its own. */
export function certForRow(base: CertData, row: Row, index: number): CertData {
  const certId = row.certificate_id || nextId(fill(base.certId, row), index);
  const vars: Row = { organization: base.org, date: base.date, address: base.address, ...row, certificate_id: certId };
  if (row.name) vars.name = row.name;
  const out: CertData = { ...base, certId };
  for (const k of TEXT_FIELDS) out[k] = fill(base[k], vars) as never;
  out.certId = certId;
  out.sigs = base.sigs.map((s) => ({ name: fill(s.name, vars), role: fill(s.role, vars) }));
  // A "name" column drives the recipient unless the template already composes it.
  // Likewise a "date" / "organization" column overrides the plain-text field.
  if (row.name && !/\{\{/.test(base.recipient)) out.recipient = row.name;
  if (row.date && !/\{\{/.test(base.date)) out.date = row.date;
  if (row.organization && !/\{\{/.test(base.org)) out.org = row.organization;
  return out;
}
