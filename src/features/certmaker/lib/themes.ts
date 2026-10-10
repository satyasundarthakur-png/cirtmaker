import type { CertData, CustomStyle, FontSet } from "./types";

type Ctx = CanvasRenderingContext2D;

export interface Theme {
  id: string;
  name: string;
  bg: string;
  ink: string;
  muted: string;
  accent: string; // default accent
  caps: boolean;
  shift?: number; // horizontal content offset (px in 1000-unit space)
  decor: (c: Ctx, W: number, H: number, accent: string, t: Theme) => void;
}

const TAU = Math.PI * 2;

export function corner(c: Ctx, x: number, y: number, sx: number, sy: number, color: string) {
  c.save();
  c.translate(x, y);
  c.scale(sx, sy);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 1.6;
  for (const r of [46, 32]) {
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI / 2);
    c.stroke();
  }
  c.beginPath();
  c.arc(58, 58, 3.2, 0, TAU);
  c.fill();
  c.restore();
}

function notched(c: Ctx, x: number, y: number, w: number, h: number, n: number) {
  c.beginPath();
  c.moveTo(x + n, y);
  c.lineTo(x + w - n, y);
  c.lineTo(x + w, y + n);
  c.lineTo(x + w, y + h - n);
  c.lineTo(x + w - n, y + h);
  c.lineTo(x + n, y + h);
  c.lineTo(x, y + h - n);
  c.lineTo(x, y + n);
  c.closePath();
}

export const THEMES: Theme[] = [
  {
    id: "classic",
    name: "Classic",
    bg: "#fffdf7",
    ink: "#2b2a28",
    muted: "#6f6a60",
    accent: "#b8892f",
    caps: false,
    decor(c, W, H, a) {
      c.strokeStyle = a;
      c.lineWidth = 5;
      c.strokeRect(26, 26, W - 52, H - 52);
      c.lineWidth = 1.5;
      c.strokeRect(40, 40, W - 80, H - 80);
      corner(c, 40, 40, 1, 1, a);
      corner(c, W - 40, 40, -1, 1, a);
      corner(c, 40, H - 40, 1, -1, a);
      corner(c, W - 40, H - 40, -1, -1, a);
    },
  },
  {
    id: "royal",
    name: "Royal",
    bg: "#0f1b3d",
    ink: "#f4ead0",
    muted: "#b9b29b",
    accent: "#d4af58",
    caps: true,
    decor(c, W, H, a) {
      c.strokeStyle = a;
      c.lineWidth = 4;
      notched(c, 24, 24, W - 48, H - 48, 26);
      c.stroke();
      c.lineWidth = 1.2;
      notched(c, 38, 38, W - 76, H - 76, 20);
      c.stroke();
      c.fillStyle = a;
      for (const [x, y] of [
        [24, 24],
        [W - 24, 24],
        [24, H - 24],
        [W - 24, H - 24],
      ]) {
        c.beginPath();
        c.arc(x, y, 5, 0, TAU);
        c.fill();
      }
    },
  },
  {
    id: "modern",
    name: "Modern",
    bg: "#ffffff",
    ink: "#18202b",
    muted: "#667085",
    accent: "#0f7c80",
    caps: true,
    shift: 22,
    decor(c, W, H, a) {
      c.fillStyle = a;
      c.fillRect(0, 0, 44, H);
      c.globalAlpha = 0.35;
      c.fillRect(56, 0, 8, H);
      c.globalAlpha = 0.1;
      c.beginPath();
      c.moveTo(W, H);
      c.lineTo(W - 300, H);
      c.lineTo(W, H - 300);
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    bg: "#ffffff",
    ink: "#1d1d1f",
    muted: "#707075",
    accent: "#1d1d1f",
    caps: true,
    decor(c, W, H, a) {
      c.strokeStyle = a;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(60, 48);
      c.lineTo(W - 60, 48);
      c.moveTo(60, H - 48);
      c.lineTo(W - 60, H - 48);
      c.stroke();
      c.fillStyle = a;
      c.fillRect(W / 2 - 5, 43, 10, 10);
    },
  },
  {
    id: "bloom",
    name: "Bloom",
    bg: "#fbf6ee",
    ink: "#3a2e2a",
    muted: "#7d6d63",
    accent: "#c4553d",
    caps: false,
    decor(c, W, H, a) {
      c.fillStyle = a;
      for (const [x, y] of [
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ]) {
        c.globalAlpha = 0.1;
        c.beginPath();
        c.arc(x, y, 190, 0, TAU);
        c.fill();
        c.globalAlpha = 0.16;
        c.beginPath();
        c.arc(x, y, 120, 0, TAU);
        c.fill();
        c.globalAlpha = 0.28;
        c.beginPath();
        c.arc(x, y, 56, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
      c.strokeStyle = a;
      c.lineWidth = 1.6;
      c.setLineDash([8, 6]);
      c.strokeRect(34, 34, W - 68, H - 68);
      c.setLineDash([]);
    },
  },
];

export interface FontStack {
  title: string;
  name: string;
  body: string;
  titleWeight: number;
  bodyWeight: number;
  nameWeight: number;
}

const FALLBACK = `"Noto Sans Oriya", "Noto Sans Devanagari", sans-serif`;

export const FONT_SETS: Record<FontSet, { label: string; stack: FontStack }> = {
  elegant: {
    label: "Elegant — Playfair + Great Vibes",
    stack: { title: `"Playfair Display", ${FALLBACK}`, name: `"Great Vibes", "Playfair Display", ${FALLBACK}`, body: `"Cormorant Garamond", "Playfair Display", ${FALLBACK}`, titleWeight: 700, nameWeight: 400, bodyWeight: 500 },
  },
  classic: {
    label: "Classic — Cormorant Garamond",
    stack: { title: `"Cormorant Garamond", ${FALLBACK}`, name: `"Cormorant Garamond", ${FALLBACK}`, body: `"Cormorant Garamond", ${FALLBACK}`, titleWeight: 700, nameWeight: 700, bodyWeight: 500 },
  },
  modern: {
    label: "Modern — Montserrat + Inter",
    stack: { title: `"Montserrat", ${FALLBACK}`, name: `"Montserrat", ${FALLBACK}`, body: `"Inter", ${FALLBACK}`, titleWeight: 700, nameWeight: 600, bodyWeight: 400 },
  },
  noto: {
    label: "Odia / Hindi friendly — Noto",
    stack: { title: `"Noto Sans Oriya", "Noto Sans Devanagari", sans-serif`, name: `"Noto Sans Oriya", "Noto Sans Devanagari", sans-serif`, body: `"Noto Sans Oriya", "Noto Sans Devanagari", sans-serif`, titleWeight: 700, nameWeight: 700, bodyWeight: 400 },
  },
};

/** Build a theme from the style detected in an uploaded reference. */
export function themeFromCustom(cs: CustomStyle): Theme {
  return {
    id: "inspired",
    name: "Inspired",
    bg: cs.bg,
    ink: cs.ink,
    muted: cs.muted,
    accent: cs.accent,
    caps: cs.caps,
    shift: cs.band > 0 ? cs.band / 2 : 0,
    decor(c, W, H, a) {
      if (cs.band > 0) {
        c.fillStyle = a;
        c.fillRect(0, 0, cs.band, H);
      }
      c.strokeStyle = a;
      cs.frames.forEach((f) => {
        c.lineWidth = Math.max(1, f.width);
        const o = f.inset + f.width / 2;
        c.strokeRect(o, o, W - 2 * o, H - 2 * o);
      });
      if (cs.corners && cs.frames.length) {
        const f = cs.frames[cs.frames.length - 1];
        const o = f.inset + f.width + 2;
        corner(c, o, o, 1, 1, a);
        corner(c, W - o, o, -1, 1, a);
        corner(c, o, H - o, 1, -1, a);
        corner(c, W - o, H - o, -1, -1, a);
      }
    },
  };
}

export function resolveTheme(d: CertData): Theme {
  if (d.template === "inspired" && d.custom) return themeFromCustom(d.custom);
  return THEMES.find((t) => t.id === d.template) ?? THEMES[0];
}
