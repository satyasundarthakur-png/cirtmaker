/**
 * Clone Mode text-field detection. Pure functions: no canvas, no pixels, no artwork analysis.
 * It only reads the TEXT of an uploaded certificate (PDF text layer or OCR words) and decides which
 * lines are likely to be replaced: candidate name, certificate number, date, course/event, custom placeholders.
 */
import { isCentered, type Box } from "./clone-geometry";
import type { CloneKind } from "./types";
import { candidateNameIssue, logDetection } from "./clone-name-validation";

/** A fragment of text with its position, as produced by a PDF text layer or OCR. */
export interface RawItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size in pixels when known (PDF). */
  size?: number;
  /** Font name/family text, used only to guess serif / script / bold / italic. */
  fontHint?: string;
}

export interface Word {
  text: string;
  x: number;
  w: number;
  y?: number;
  h?: number;
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  words: Word[];
  fontHint: string;
}

export interface Detected {
  kind: CloneKind;
  label: string;
  /** Tight box around the text to replace. */
  box: Box;
  text: string;
  size: number;
  fontHint: string;
  /** True when this came from a weak heuristic rather than an explicit label, cue phrase or pattern. */
  guess?: boolean;
}

export interface Detection {
  fields: Detected[];
  /** Other text on the certificate. Not editable unless the user chooses. */
  rest: TextLine[];
}

export const KIND_LABEL: Record<CloneKind, string> = {
  name: "Candidate name",
  certId: "Certificate number",
  date: "Date",
  course: "Course / event",
  custom: "Custom text",
};

/* ---------- lines ---------- */

function splitWords(it: RawItem): Word[] {
  const t = it.text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(" ");
  if (parts.length === 1) return [{ text: t, x: it.x, w: it.w, y: it.y, h: it.h }];
  const out: Word[] = [];
  let offset = 0;
  for (const part of parts) {
    out.push({
      text: part,
      x: it.x + it.w * (offset / t.length),
      w: it.w * (part.length / t.length),
      y: it.y,
      h: it.h,
    });
    offset += part.length + 1;
  }
  return out;
}

/** Group fragments that sit on the same baseline into lines. Far-apart columns stay separate lines. */
export function buildLines(items: RawItem[]): TextLine[] {
  const usable = items.filter((i) => i.text.trim() && i.w > 0 && i.h > 0);
  const byY = [...usable].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: RawItem[][] = [];
  for (const it of byY) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (
      row &&
      ref &&
      Math.abs(it.y + it.h / 2 - (ref.y + ref.h / 2)) <= 0.35 * Math.min(ref.h, it.h) &&
      Math.max(ref.h, it.h) <= 1.6 * Math.min(ref.h, it.h)
    )
      row.push(it);
    else rows.push([it]);
  }
  const lines: TextLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const rowH = Math.max(...row.map((r) => r.h));
    let group: RawItem[] = [];
    const flush = () => {
      if (!group.length) return;
      const words = group.flatMap(splitWords);
      const x0 = Math.min(...group.map((g) => g.x));
      const x1 = Math.max(...group.map((g) => g.x + g.w));
      const y0 = Math.min(...group.map((g) => g.y));
      const y1 = Math.max(...group.map((g) => g.y + g.h));
      const widest = group.reduce((a, b) => (b.w > a.w ? b : a));
      lines.push({
        text: words.map((w) => w.text).join(" "),
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        size: Math.max(...group.map((g) => g.size ?? g.h * 0.85)),
        words,
        fontHint: widest.fontHint ?? "",
      });
      group = [];
    };
    for (const it of row) {
      const last = group[group.length - 1];
      if (last && it.x - (last.x + last.w) > 2.5 * rowH) flush();
      group.push(it);
    }
    flush();
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Bounding box of the words that overlap characters [start, end) of the line text. */
function spanBox(line: TextLine, start: number, end: number): Box {
  let offset = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const w of line.words) {
    const wStart = offset;
    const wEnd = offset + w.text.length;
    if (wEnd > start && wStart < end) {
      x0 = Math.min(x0, w.x);
      x1 = Math.max(x1, w.x + w.w);
      y0 = Math.min(y0, w.y ?? line.y);
      y1 = Math.max(y1, (w.y ?? line.y) + (w.h ?? line.h));
    }
    offset = wEnd + 1;
  }
  if (!Number.isFinite(x0)) return { x: line.x, y: line.y, w: line.w, h: line.h };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------- patterns ---------- */

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_RE = new RegExp(
  `\\b(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,2}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\.?,?\\s+\\d{2,4}|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4})\\b`,
  "i",
);
const ID_RE = /\b[A-Z]{2,8}[-/]\d{2,4}(?:[-/][A-Z0-9]+)*\b|\b[A-Z]{2,8}[-/]?\d{4,}\b/;
const PLACEHOLDER_RE = /\{\{[^}]+\}\}|\[[^\]]{2,40}\]|<[^>\n]{2,40}>|_{3,}|\.{5,}/;

const LABEL_KINDS: [CloneKind, RegExp][] = [
  [
    "certId",
    /\b(cert(?:ificate)?\.?\s*(?:no|number|id|#)|serial\s*(?:no|number)?|reg(?:istration)?\.?\s*(?:no|number)|ref(?:erence)?\.?\s*(?:no|number)|roll\s*(?:no|number)|id\s*(?:no|number))\b/i,
  ],
  ["date", /\b(date|dated|issued(?:\s+on)?|issue\s+date|held\s+on)\b/i],
  [
    "course",
    /\b(course|programme|program|workshop|training|conference|seminar|webinar|symposium|event|module)\b/i,
  ],
  ["name", /\b(candidate|recipient|awardee|participant|student|trainee|delegate|attendee|name)\b/i],
];

const PHRASE_PLACEHOLDERS: [CloneKind, RegExp][] = [
  [
    "name",
    /^(?:candidate|recipient|participant|student|trainee|awardee|attendee|delegate)(?:\s+name)?$/i,
  ],
  ["name", /^name(?:\s+of\s+(?:the\s+)?(?:candidate|recipient|participant|student|trainee))?$/i],
  [
    "course",
    /^(?:course|programme|program|workshop|event|conference|training|seminar)\s*(?:name|title)$/i,
  ],
  ["date", /^(?:dd|mm|yyyy|d|m|y)[/.-](?:dd|mm|yyyy|m|y)[/.-](?:dd|yy|yyyy)$/i],
];

const NAME_CUE =
  /\b(?:presented to|awarded to|is awarded to|is hereby awarded to|hereby awarded to|proudly presented to|is presented to|given to|granted to|conferred (?:up)?on|certif(?:y|ies) that|certified that)\s*[:,]?\s*$/i;
const COURSE_CUE =
  /\b(?:completed|completing|completion of|participation in|participated in|attended|attending|enrolled in|undergone|undergoing|on the topic|titled|entitled)\s*(?:the|in|a|an)?\s*[:,]?\s*$/i;

const NOT_A_NAME =
  /\b(certificate|achievement|appreciation|completion|participation|excellence|award|awarded|merit|presented|proudly|certify|certifies|hereby|this is|has|for|in recognition|successfully|date|signature|director|principal|president|chairman|secretary)\b/i;

const countAlnum = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

function kindFromLabel(label: string): CloneKind | null {
  for (const [kind, re] of LABEL_KINDS) if (re.test(label)) return kind;
  return null;
}

function kindFromWords(text: string): CloneKind {
  return kindFromLabel(text) ?? "custom";
}

/* ---------- classification ---------- */

export function detectFields(lines: TextLine[], page: { w: number; h: number }): Detection {
  const fields: Detected[] = [];
  const handled = new Set<TextLine>();
  const residuals: TextLine[] = [];
  let cue: { kind: CloneKind; line: TextLine } | null = null;

  const add = (
    line: TextLine,
    kind: CloneKind,
    span: { start: number; end: number } | null,
    label?: string,
    guess = false,
  ) => {
    const box = span
      ? spanBox(line, span.start, span.end)
      : { x: line.x, y: line.y, w: line.w, h: line.h };
    const text = span ? line.text.slice(span.start, span.end) : line.text;
    const issue = kind === "name" ? candidateNameIssue(text, box, page) : null;
    logDetection({
      text,
      kind,
      box,
      confidence: issue ? 0 : guess ? 55 : 90,
      stage: "classification",
      reason: issue ?? undefined,
    });
    if (issue) return false;
    if (span)
      for (const [start, end] of [
        [0, span.start],
        [span.end, line.text.length],
      ] as const) {
        const remaining = line.text.slice(start, end).trim();
        if (countAlnum(remaining) < 2) continue;
        const rect = spanBox(line, start, end);
        residuals.push({ ...line, ...rect, text: remaining, words: [] });
      }
    fields.push({
      kind,
      label: label ?? KIND_LABEL[kind],
      box,
      text,
      size: line.size,
      fontHint: line.fontHint,
      ...(guess ? { guess } : {}),
    });
    handled.add(line);
    return true;
  };

  for (const line of lines) {
    const text = line.text;
    if (countAlnum(text) < 2) continue;
    const activeCue = cue && line.y - (cue.line.y + cue.line.h) <= cue.line.h * 3 ? cue : null;
    cue = null;
    let done = false;

    // 1. "Label: value" such as "Certificate No: CERT-2026-001"
    const lv = text.match(/^([^:：]{1,40}?)\s*[:：]\s*(\S.*)$/);
    if (lv?.[1] && lv[2]) {
      const kind = kindFromLabel(lv[1]);
      if (kind) {
        const valueStart = text.indexOf(lv[2], lv[1].length);
        let span = { start: valueStart, end: text.length };
        const narrow =
          kind === "date" ? DATE_RE.exec(lv[2]) : kind === "certId" ? ID_RE.exec(lv[2]) : null;
        if (narrow)
          span = {
            start: valueStart + narrow.index,
            end: valueStart + narrow.index + narrow[0].length,
          };
        done = add(line, kind, span);
      }
    }

    // 2. the line right after "presented to" / "has successfully completed"
    if (!done && activeCue && /\p{L}/u.test(text)) {
      done = add(line, activeCue.kind, null);
    }

    // 3. placeholders: {{name}}, [Candidate Name], ______, "Candidate Name", "DD/MM/YYYY"
    if (!done) {
      const phrase = PHRASE_PLACEHOLDERS.find(([, re]) => re.test(text.trim()));
      if (phrase) {
        add(line, phrase[0], null);
        done = true;
      } else {
        const ph = PLACEHOLDER_RE.exec(text);
        if (ph && (text.length <= 50 || ph[0].length === text.length)) {
          const kind = kindFromWords(ph[0]);
          add(
            line,
            kind,
            { start: ph.index, end: ph.index + ph[0].length },
            kind === "custom" ? ph[0].slice(0, 24) : undefined,
          );
          done = true;
        }
      }
    }

    // 4. a date or an ID-looking token on a short line
    if (!done && text.length <= 60) {
      const m = DATE_RE.exec(text);
      if (m) {
        add(line, "date", { start: m.index, end: m.index + m[0].length });
        done = true;
      }
    }
    if (!done && text.length <= 40) {
      const m = ID_RE.exec(text);
      if (m) {
        add(line, "certId", { start: m.index, end: m.index + m[0].length });
        done = true;
      }
    }

    // a static line that ends with a cue phrase points at the next line
    if (!done) {
      if (NAME_CUE.test(text)) cue = { kind: "name", line };
      else if (COURSE_CUE.test(text)) cue = { kind: "course", line };
    }
  }

  // Fallback: no name found, so offer the most prominent centred short line as a guess.
  if (!fields.some((f) => f.kind === "name") && lines.length) {
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    const guess = lines
      .filter((l) => {
        if (handled.has(l)) return false;
        const words = l.words.length;
        return (
          words >= 1 &&
          words <= 5 &&
          countAlnum(l.text) >= 3 &&
          !/\d/.test(l.text) &&
          !NOT_A_NAME.test(l.text) &&
          isCentered({ x: l.x, y: l.y, w: l.w, h: l.h }, page.w) &&
          l.y >= page.h * 0.25 &&
          l.y <= page.h * 0.72 &&
          l.size >= median * 1.2
        );
      })
      .sort((a, b) => b.size - a.size)[0];
    if (guess) add(guess, "name", null, "Candidate name (guess)", true);
  }

  const rest = [...lines.filter((l) => !handled.has(l) && countAlnum(l.text) >= 2), ...residuals];
  fields.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return { fields, rest };
}
