import { hexToRgb, luminance } from "./color";
import { makeRng } from "./rng";

type Ctx = CanvasRenderingContext2D;
export type Paint = string | CanvasGradient;

export type FxType = "none" | "raised" | "engraved" | "extrude" | "ink" | "foil" | "lifted";
export interface Fx {
  type: FxType;
  amount: number; // 0–100
}

export const FX_OPTIONS: { id: FxType; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Flat, as printed" },
  { id: "raised", label: "Raised", hint: "Embossed — lifts off the paper" },
  { id: "engraved", label: "Engraved", hint: "Pressed into the paper" },
  { id: "extrude", label: "3D", hint: "Solid letters with real depth" },
  { id: "ink", label: "Wet ink", hint: "Pen-written look with bleed" },
  { id: "foil", label: "Foil", hint: "Shiny metallic, embossed" },
  { id: "lifted", label: "Lifted", hint: "Soft floating shadow" },
];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draws one element in the given paint. `stroke` mode is used for ink-edge effects. */
export type DrawFn = (c: Ctx, paint: Paint, mode?: "fill" | "stroke", lineWidth?: number) => void;

function mixHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return "#" + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, "0")).join("");
}
const rgba = (h: string, a: number) => {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
const lighten = (h: string, t: number) => mixHex(h, "#ffffff", t);
const darken = (h: string, t: number) => mixHex(h, "#000000", t);

function shadowed(L: Ctx, color: string, ox: number, oy: number, blur: number, fn: () => void) {
  L.save();
  L.shadowColor = color;
  L.shadowOffsetX = ox;
  L.shadowOffsetY = oy;
  L.shadowBlur = blur;
  fn();
  L.restore();
}

export interface FxEnv {
  k: number; // canvas pixels per page unit
  bg: string; // paper colour, used to tint shadows and highlights
  accent: string;
}

/**
 * Renders `draw` through the chosen effect on an off-screen layer, then composites it onto `c`.
 * `c` must already be scaled so that one unit = k pixels.
 */
export function paintWithEffect(c: Ctx, env: FxEnv, box: Box, fx: Fx, color: string, draw: DrawFn, seed: string) {
  const a = Math.min(1, Math.max(0, fx.amount / 100));
  const k = env.k;
  // geometry scales with the size of the element so small text is not swamped
  const s = Math.min(1.3, Math.max(0.35, box.h / 60));
  const pad = 10 + 16 * a;
  const bx = box.x - pad;
  const by = box.y - pad;
  const bw = box.w + pad * 2;
  const bh = box.h + pad * 2;
  const lw = Math.max(1, Math.ceil(bw * k));
  const lh = Math.max(1, Math.ceil(bh * k));
  const mk = () => {
    const cv = document.createElement("canvas");
    cv.width = lw;
    cv.height = lh;
    const x = cv.getContext("2d");
  if (!x) throw new Error("Canvas rendering is unavailable in this browser.");
    x.setTransform(k, 0, 0, k, -bx * k, -by * k);
    return { cv, x };
  };
  const { cv, x: L } = mk();

  const paper = env.bg;
  const dark = luminance(paper) < 0.18;
  const dk = darken(paper, 0.55);
  const hi = dark ? lighten(paper, 0.4) : "#ffffff";
  const faceGrad = (top: string, mid: string, bot: string) => {
    const g = L.createLinearGradient(0, box.y, 0, box.y + box.h);
    g.addColorStop(0, top);
    g.addColorStop(0.5, mid);
    g.addColorStop(1, bot);
    return g;
  };

  switch (fx.type) {
    case "raised": {
      const d = (0.6 + 1.8 * a) * k * s;
      const bl = (0.8 + 2.4 * a) * k * s;
      shadowed(L, rgba(hi, 0.95), -d, -d, bl * 0.7, () => draw(L, color));
      shadowed(L, rgba(dk, 0.62), d, d, bl, () => draw(L, color));
      draw(L, faceGrad(lighten(color, 0.18), color, darken(color, 0.12)));
      break;
    }
    case "engraved": {
      const d = (0.5 + 1.4 * a) * k * s;
      // 1) light catching the lower-right lip of the groove
      shadowed(L, rgba(hi, 0.95), d, d, 0.5 * k, () => draw(L, color));
      // 2) text layer with an inner shadow cast from the upper-left edge
      const M = mk();
      draw(M.x, darken(color, 0.1));
      const T = mk();
      T.x.fillStyle = "#000";
      T.x.fillRect(bx, by, bw, bh);
      T.x.globalCompositeOperation = "destination-out";
      draw(T.x, "#000");
      M.x.save();
      M.x.setTransform(1, 0, 0, 1, 0, 0);
      M.x.globalCompositeOperation = "source-atop";
      M.x.shadowColor = "rgba(0,0,0,0.9)";
      M.x.shadowBlur = (1 + 2.2 * a) * k * s;
      M.x.shadowOffsetX = d * 0.9;
      M.x.shadowOffsetY = d * 0.9;
      M.x.drawImage(T.cv, 0, 0);
      M.x.restore();
      L.save();
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.drawImage(M.cv, 0, 0);
      L.restore();
      break;
    }
    case "extrude": {
      const depth = (1.5 + 7 * a) * s;
      const n = Math.max(4, Math.round(depth * k * 1.2));
      const step = depth / n;
      shadowed(L, "rgba(0,0,0,0.38)", depth * 0.8 * k, depth * 1.1 * k, (3 + 7 * a) * k * s, () => {
        L.translate(depth * 0.7, depth * 0.7);
        draw(L, darken(color, 0.5));
      });
      for (let i = n; i >= 1; i--) {
        L.save();
        L.translate(i * step * 0.7, i * step * 0.7);
        draw(L, darken(color, 0.34 + 0.26 * (i / n)));
        L.restore();
      }
      draw(L, faceGrad(lighten(color, 0.26), color, darken(color, 0.1)));
      L.globalAlpha = 0.55;
      draw(L, lighten(color, 0.7), "stroke", 0.35);
      L.globalAlpha = 1;
      break;
    }
    case "ink": {
      const rnd = makeRng(seed);
      const ink = darken(color, 0.2);
      // 1) feathered bleed into the paper fibres
      L.globalAlpha = 0.5;
      shadowed(L, rgba(ink, 0.8), 0, 0, (1.2 + 3 * a) * k * s, () => draw(L, ink));
      // 2) body of the stroke, nudged a few times so the edge is slightly irregular
      L.globalAlpha = 0.95;
      draw(L, ink);
      for (let j = 0; j < 4; j++) {
        L.globalAlpha = 0.32;
        L.save();
        L.translate((rnd.next() - 0.5) * 0.9 * (0.35 + a) * s, (rnd.next() - 0.5) * 0.9 * (0.35 + a) * s);
        draw(L, ink);
        L.restore();
      }
      // 3) ink pools along the edge of every stroke
      L.globalAlpha = 0.75;
      draw(L, darken(ink, 0.45), "stroke", (0.5 + 0.8 * a) * s);
      L.globalAlpha = 1;
      // 4) dry spots where the pen pressed lightly
      const count = Math.round((lw * lh) / 90 * (0.12 + 0.88 * a));
      L.save();
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalCompositeOperation = "destination-out";
      for (let i = 0; i < count; i++) {
        L.fillStyle = `rgba(0,0,0,${0.25 + rnd.next() * 0.55})`;
        L.beginPath();
        L.arc(rnd.next() * lw, rnd.next() * lh, (0.25 + rnd.next() * 0.8) * k * s, 0, Math.PI * 2);
        L.fill();
      }
      L.restore();
      break;
    }
    case "foil": {
      const base = luminance(env.accent) < 0.06 ? "#aeb4bd" : env.accent;
      const g = L.createLinearGradient(box.x, box.y, box.x + box.w * 0.6, box.y + box.h * 1.6);
      g.addColorStop(0, lighten(base, 0.42));
      g.addColorStop(0.22, base);
      g.addColorStop(0.45, darken(base, 0.4));
      g.addColorStop(0.62, lighten(base, 0.38));
      g.addColorStop(0.82, base);
      g.addColorStop(1, darken(base, 0.3));
      const d = (0.5 + 1.2 * a) * k * s;
      shadowed(L, rgba(hi, 0.9), -d, -d, 0.6 * k, () => draw(L, base));
      shadowed(L, rgba(dk, 0.65), d, d, (0.8 + 1.6 * a) * k * s, () => draw(L, base));
      draw(L, g);
      L.globalAlpha = 0.6;
      draw(L, lighten(base, 0.85), "stroke", 0.3);
      L.globalAlpha = 1;
      break;
    }
    case "lifted": {
      shadowed(L, "rgba(0,0,0,0.4)", 0, (2 + 5 * a) * k * s, (5 + 10 * a) * k * s, () => draw(L, color));
      draw(L, color);
      break;
    }
    default:
      draw(L, color);
  }
  c.drawImage(cv, bx, by, bw, bh);
}
