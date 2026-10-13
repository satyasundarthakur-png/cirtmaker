import { templateLayers } from "./editing/TemplateAdapter";
import { PAPER_RATIO, type CertData } from "./types";
import { resolveTheme, FONT_SETS } from "./themes";
import { metalById, metalGradient, type Metal } from "./metals";
import { qrMatrix } from "./qr";
import { verifyUrl } from "./verify";
import { paintWithEffect, type Box, type DrawFn, type Fx, type Paint } from "./effects";
import { fontCss, isActive, loadCloneImage, paintCloneFields } from "./clone";
import { erasePatchFor, protectBoxes, type ErasePatch } from "./clone-erase-canvas";

type Ctx = CanvasRenderingContext2D;
const W = 1000;
const TAU = Math.PI * 2;

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(src: string) {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("logo failed to load"));
      i.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

function setSpacing(c: Ctx, px: number) {
  if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

interface TextOpts {
  font: (size: number) => string;
  size: number;
  minSize?: number;
  color: string;
  maxW: number;
  spacing?: number;
}

export interface Region extends Box {
  id: string;
  label: string;
}

interface Env {
  c: Ctx;
  k: number;
  bg: string;
  accent: string;
  fx: Record<string, Fx>;
  colors: Record<string, string>;
  regions: Map<string, Region>;
  suppressed: Set<string>;
}

export const REGION_LABELS: Record<string, string> = {
  org: "Organisation",
  title: "Title",
  subtitle: "Line above the name",
  recipient: "Recipient name",
  body: "Description",
  sig0: "Signature 1",
  sig1: "Signature 2",
  meta: "Date & ID",
  seal: "Seal",
  qr: "QR code",
};

function addRegion(env: Env, id: string, b: Box) {
  const pad = 4;
  const r = env.regions.get(id);
  const nx0 = b.x - pad,
    ny0 = b.y - pad,
    nx1 = b.x + b.w + pad,
    ny1 = b.y + b.h + pad;
  if (!r)
    env.regions.set(id, {
      id,
      label: REGION_LABELS[id] ?? id,
      x: nx0,
      y: ny0,
      w: nx1 - nx0,
      h: ny1 - ny0,
    });
  else {
    const x0 = Math.min(r.x, nx0),
      y0 = Math.min(r.y, ny0),
      x1 = Math.max(r.x + r.w, nx1),
      y1 = Math.max(r.y + r.h, ny1);
    env.regions.set(id, { ...r, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
}

/** Resolve a per-element colour override into a base colour plus an optional metallic finish. */
function resolveColor(
  env: Env,
  id: string,
  fallback: string,
): { color: string; metal: Metal | null } {
  const spec = env.colors[id];
  if (!spec) return { color: fallback, metal: null };
  if (spec.startsWith("metal:")) {
    const m = metalById(spec.slice(6));
    if (m) return { color: m.base, metal: m };
  }
  return { color: /^#[0-9a-fA-F]{6}$/.test(spec) ? spec : fallback, metal: null };
}

function applyOrDraw(env: Env, id: string, box: Box, color: string, draw: DrawFn, seed: string) {
  const fx = env.fx[id];
  if (fx && fx.type !== "none")
    paintWithEffect(
      env.c,
      { k: env.k, bg: env.bg, accent: env.accent },
      box,
      fx,
      color,
      draw,
      seed,
    );
  else draw(env.c, color);
}

/** Draw centred single-line text, shrinking to fit maxW, with the element's effect if it has one. */
function line(env: Env, id: string, text: string, x: number, y: number, o: TextOpts) {
  if (!text || env.suppressed.has(id)) return;
  const c = env.c;
  let size = o.size;
  const min = o.minSize ?? size * 0.5;
  const sp = o.spacing ?? 0;
  let width = 0;
  for (;;) {
    c.font = o.font(size);
    setSpacing(c, sp);
    width = c.measureText(text).width;
    if (width <= o.maxW || size <= min) break;
    size -= 1;
  }
  setSpacing(c, 0);
  const font = o.font(size);
  const { color, metal } = resolveColor(env, id, o.color);
  const box: Box = { x: x - width / 2, y: y - size * 0.95, w: width, h: size * 1.35 };
  const draw: DrawFn = (cc, paint: Paint, mode = "fill", lw = 0) => {
    cc.font = font;
    setSpacing(cc, sp);
    cc.textAlign = "center";
    cc.textBaseline = "alphabetic";
    // metallic finish replaces the main face colour (and effect face gradients), not shadows or side walls
    const face: Paint =
      metal && (paint === color || typeof paint !== "string") && mode === "fill"
        ? metalGradient(cc, metal, box.x, box.y, box.w, box.h)
        : paint;
    // letterSpacing adds trailing space; compensate so text stays optically centred
    if (mode === "stroke") {
      cc.lineWidth = lw;
      cc.lineJoin = "round";
      cc.strokeStyle = paint;
      cc.strokeText(text, x + sp / 2, y);
    } else {
      cc.fillStyle = face;
      cc.fillText(text, x + sp / 2, y);
    }
    setSpacing(cc, 0);
  };
  addRegion(env, id, box);
  applyOrDraw(env, id, box, color, draw, id + text);
}

function wrap(c: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (c.measureText(t).width > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

function seal(c: Ctx, cx: number, cy: number, accent: Paint, bg: string, text: string) {
  // tails
  c.fillStyle = accent;
  c.globalAlpha = 0.85;
  c.beginPath();
  c.moveTo(cx - 20, cy + 22);
  c.lineTo(cx - 38, cy + 62);
  c.lineTo(cx - 20, cy + 52);
  c.lineTo(cx - 6, cy + 64);
  c.lineTo(cx + 4, cy + 28);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(cx + 20, cy + 22);
  c.lineTo(cx + 38, cy + 62);
  c.lineTo(cx + 20, cy + 52);
  c.lineTo(cx + 6, cy + 64);
  c.lineTo(cx - 4, cy + 28);
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  // scalloped disc
  const n = 28;
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 47 : 41;
    const a = (i / (n * 2)) * TAU;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = accent;
  c.fill();
  c.strokeStyle = bg;
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(cx, cy, 34, 0, TAU);
  c.stroke();
  if (text.trim()) {
    c.fillStyle = bg;
    c.textAlign = "center";
    c.textBaseline = "middle";
    let s = 16;
    c.font = `700 ${s}px Inter, sans-serif`;
    while (c.measureText(text).width > 56 && s > 8) {
      s -= 1;
      c.font = `700 ${s}px Inter, sans-serif`;
    }
    c.fillText(text.slice(0, 8), cx, cy + 1);
    c.textBaseline = "alphabetic";
  } else {
    // five-point star
    c.fillStyle = bg;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 22 : 9;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
  }
}

/** Make sure every font used by this certificate is loaded before drawing. */
async function ensureFonts(d: CertData) {
  const f = FONT_SETS[d.fontSet].stack;
  const jobs = [
    [`${f.titleWeight} 40px ${f.title}`, d.title],
    [`${f.nameWeight} 60px ${f.name}`, d.recipient],
    [
      `${f.bodyWeight} 22px ${f.body}`,
      d.body + d.subtitle + d.org + d.date + d.certId + d.sigs.map((s) => s.name + s.role).join(""),
    ],
    [`700 16px Inter`, d.sealText || "A"],
  ] as const;
  await Promise.all(
    (d.textLayers ?? [])
      .filter((f) => !f.deleted)
      .map((f) =>
        document.fonts.load(fontCss(f, f.fontSize), f.replacement || "A").catch(() => []),
      ),
  );
  await Promise.all(
    jobs.map(([spec, txt]) => document.fonts.load(spec, txt || "A").catch(() => [])),
  );
}

export function certHeight(d: CertData) {
  if (d.cloneMode && d.clone) return (W * d.clone.height) / d.clone.width;
  return W / PAPER_RATIO[d.paper];
}

/**
 * Clone Mode drawing. The original is painted first, edge to edge, with no transform: at native width it is a
 * 1:1 pixel copy. Text fields are then painted in the original's own pixel coordinates.
 */
async function drawClone(
  canvas: HTMLCanvasElement,
  d: CertData,
  widthPx: number,
): Promise<Region[]> {
  const clone = d.clone;
  if (!clone) return [];
  canvas.width = Math.round(widthPx);
  canvas.height = Math.round((widthPx * clone.height) / clone.width);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas rendering is unavailable in this browser.");
  const original = await loadCloneImage(clone.image);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = canvas.width !== clone.width; // never resample when exporting at native size
  c.imageSmoothingQuality = "high";
  c.drawImage(original, 0, 0, canvas.width, canvas.height);
  // smart erase: replacement pixels for the old writing, computed from the original at its own resolution
  const protect = protectBoxes(clone);
  const patches = new Map<string, ErasePatch>();
  await Promise.all(
    clone.fields
      .filter((f) => isActive(f) && f.erase === "smart")
      .map(async (f) => {
        patches.set(f.id, await erasePatchFor(original, f, protectBoxes(clone, f.id)));
      }),
  );
  const k = canvas.width / clone.width;
  c.setTransform(k, 0, 0, k, 0, 0);
  paintCloneFields(c, clone.fields, patches, protectBoxes(clone));
  c.setTransform(1, 0, 0, 1, 0, 0);
  const scale = W / clone.width;
  return clone.fields
    .filter((f) => !f.deleted)
    .map((f) => ({
      id: f.id,
      label: f.label,
      x: f.x * scale,
      y: f.y * scale,
      w: f.w * scale,
      h: f.h * scale,
    }));
}

/** Draw the whole certificate into `canvas` at the given pixel width. Fonts must already be loaded. */
async function drawCertificate(
  canvas: HTMLCanvasElement,
  d: CertData,
  widthPx: number,
): Promise<Region[]> {
  if (d.cloneMode) return drawClone(canvas, d, widthPx);
  const H = certHeight(d);
  canvas.width = Math.round(widthPx);
  canvas.height = Math.round((widthPx * H) / W);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Canvas rendering is unavailable in this browser.");
  const k = canvas.width / W;
  c.setTransform(k, 0, 0, k, 0, 0);

  const theme = resolveTheme(d);
  const f = FONT_SETS[d.fontSet].stack;
  const accent = d.accent || theme.accent;

  c.fillStyle = theme.bg;
  c.fillRect(0, 0, W, H);
  let usedImage = false;
  if (d.template === "inspired" && d.bgMode === "image" && d.refBg) {
    try {
      const img = await loadImg(d.refBg);
      c.drawImage(img, 0, 0, W, H);
      // Clear everything inside the frame (or the margin) so the original wording can't show through,
      // but keep the corner artwork: two overlapping rectangles form a cross-shaped cover.
      const cs = theme.id === "inspired" ? d.custom : null;
      const lastFrame = cs?.frames.at(-1);
      const inner = lastFrame ? lastFrame.inset + lastFrame.width + 3 : 16;
      const kl = cs && cs.band > 0 ? cs.band + 4 : inner;
      const keep = Math.max(0, d.clearInset);
      c.fillStyle = theme.bg;
      c.fillRect(kl + keep, inner, W - kl - inner - 2 * keep, H - 2 * inner);
      c.fillRect(kl, inner + keep, W - kl - inner, H - 2 * inner - 2 * keep);
      usedImage = true;
    } catch {
      /* fall back to recreated style */
    }
  }
  if (!usedImage) theme.decor(c, W, H, accent, theme);

  const env: Env = {
    c,
    k,
    bg: theme.bg,
    accent,
    fx: d.fx ?? {},
    colors: d.colors ?? {},
    regions: new Map(),
    suppressed: new Set((d.textLayers ?? []).filter(isActive).map((f) => f.id)),
  };
  const maxW = 760;
  const shift = theme.shift ?? 0;
  const cx = W / 2 + shift;

  // logo
  if (d.logo) {
    try {
      const img = await loadImg(d.logo);
      const bw = 190;
      const bh = 58;
      const s = Math.min(bw / img.width, bh / img.height);
      c.drawImage(img, cx - (img.width * s) / 2, 62, img.width * s, img.height * s);
    } catch {
      /* ignore broken logo */
    }
  }

  line(env, "org", d.org.toUpperCase(), cx, 144, {
    font: (s) => `600 ${s}px ${f.body}`,
    size: 17,
    minSize: 11,
    color: theme.muted,
    maxW,
    spacing: 4,
  });

  const title = theme.caps ? d.title.toUpperCase() : d.title;
  line(env, "title", title, cx, 212, {
    font: (s) => `${f.titleWeight} ${s}px ${f.title}`,
    size: theme.caps ? 44 : 54,
    minSize: 24,
    color: theme.ink,
    maxW: 800,
    spacing: theme.caps ? 3 : 0,
  });

  // ornament rule
  c.strokeStyle = accent;
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(cx - 90, 234);
  c.lineTo(cx - 12, 234);
  c.moveTo(cx + 12, 234);
  c.lineTo(cx + 90, 234);
  c.stroke();
  c.fillStyle = accent;
  c.beginPath();
  c.moveTo(cx, 228);
  c.lineTo(cx + 6, 234);
  c.lineTo(cx, 240);
  c.lineTo(cx - 6, 234);
  c.closePath();
  c.fill();

  line(env, "subtitle", d.subtitle, cx, 276, {
    font: (s) => `italic ${f.bodyWeight} ${s}px ${f.body}`,
    size: 23,
    minSize: 14,
    color: theme.muted,
    maxW,
  });

  line(env, "recipient", d.recipient, cx, 358, {
    font: (s) => `${f.nameWeight} ${s}px ${f.name}`,
    size: 68,
    minSize: 30,
    color: accent,
    maxW: 780,
  });
  c.strokeStyle = theme.muted;
  c.globalAlpha = 0.6;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(cx - 280, 376);
  c.lineTo(cx + 280, 376);
  c.stroke();
  c.globalAlpha = 1;

  // body paragraph (max 4 lines)
  c.font = `${f.bodyWeight} 23px ${f.body}`;
  const lines = wrap(c, d.body, 700).slice(0, 4);
  lines.forEach((l, i) =>
    line(env, "body", l, cx, 422 + i * 31, {
      font: (s) => `${f.bodyWeight} ${s}px ${f.body}`,
      size: 23,
      color: theme.ink,
      maxW: 720,
    }),
  );

  // footer
  const sigY = H - 122;
  const xs = [W * 0.22, W * 0.78].map((x) => x + shift);
  const sigJobs: { src: string; x: number; y: number }[] = [];
  d.sigs.slice(0, 2).forEach((s, i) => {
    if (!s.name && !s.role) return;
    const x = xs[i];
    if (x === undefined) return;
    const sigSrc = d.sigImgs?.[i];
    if (sigSrc) sigJobs.push({ src: sigSrc, x, y: sigY });
    c.strokeStyle = theme.ink;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - 105, sigY);
    c.lineTo(x + 105, sigY);
    c.stroke();
    line(env, `sig${i}`, s.name, x, sigY + 24, {
      font: (z) => `700 ${z}px ${f.body}`,
      size: 19,
      minSize: 12,
      color: theme.ink,
      maxW: 220,
    });
    line(env, `sig${i}`, s.role, x, sigY + 44, {
      font: (z) => `${f.bodyWeight} ${z}px ${f.body}`,
      size: 15,
      minSize: 10,
      color: theme.muted,
      maxW: 220,
    });
  });
  for (const j of sigJobs) {
    try {
      const img = await loadImg(j.src);
      const s = Math.min(170 / img.width, 54 / img.height);
      c.drawImage(
        img,
        j.x - (img.width * s) / 2,
        j.y - img.height * s - 3,
        img.width * s,
        img.height * s,
      );
    } catch {
      /* ignore broken signature image */
    }
  }
  if (d.showSeal) {
    const sy = H - 150;
    const box: Box = { x: cx - 48, y: sy - 48, w: 96, h: 124 };
    addRegion(env, "seal", box);
    const sc = resolveColor(env, "seal", accent);
    applyOrDraw(
      env,
      "seal",
      box,
      sc.color,
      (cc, paint) =>
        seal(
          cc,
          cx,
          sy,
          sc.metal && (paint === sc.color || typeof paint !== "string")
            ? metalGradient(cc, sc.metal, box.x, box.y, box.w, box.h)
            : paint,
          theme.bg,
          d.sealText,
        ),
      "seal" + d.sealText,
    );
  }

  if (d.qr && d.certId) {
    try {
      const m = qrMatrix(await verifyUrl(d));
      const size = 78;
      const right = (xs[1] ?? W * 0.78) + 112;
      let qx = Math.max(right, W - 118);
      if (qx + size > W - 26) qx = W - 26 - size;
      const qy = H - 142;
      const pad = 4;
      const box: Box = { x: qx - pad, y: qy - pad, w: size + pad * 2, h: size + pad * 2 + 11 };
      addRegion(env, "qr", box);
      c.fillStyle = "#ffffff";
      c.fillRect(box.x, box.y, box.w, size + pad * 2);
      c.fillStyle = "#111111";
      const cell = size / m.length;
      m.forEach((row, r) =>
        row.forEach(
          (on, col) => on && c.fillRect(qx + col * cell, qy + r * cell, cell + 0.35, cell + 0.35),
        ),
      );
      c.font = `600 7.5px ${f.body}`;
      c.fillStyle = theme.muted;
      c.textAlign = "center";
      c.fillText("SCAN TO VERIFY", qx + size / 2, qy + size + pad + 9);
    } catch {
      /* link too long for a QR code: skip it rather than fail the export */
    }
  }

  const meta = [d.date && `Issued on ${d.date}`, d.certId && `ID ${d.certId}`]
    .filter(Boolean)
    .join("   ·   ");
  line(env, "meta", meta, cx, H - 56, {
    font: (s) => `${f.bodyWeight} ${s}px ${f.body}`,
    size: 15,
    minSize: 10,
    color: theme.muted,
    maxW: 700,
    spacing: 0.5,
  });
  const textLayers = (d.textLayers ?? []).map((f) => ({
    ...f,
    erase: "none" as const,
    replacement: ["org", "title", "subtitle", "recipient", "body"].includes(f.id)
      ? String(d[f.id as "org"] ?? f.replacement)
      : f.replacement,
  }));
  paintCloneFields(c, textLayers, undefined, templateLayers(d).suggestions);
  for (const layer of textLayers.filter((f) => !f.deleted)) addRegion(env, layer.id, layer);
  return Array.from(env.regions.values());
}

export async function renderToCanvas(
  canvas: HTMLCanvasElement,
  d: CertData,
  widthPx: number,
): Promise<Region[]> {
  if (d.cloneMode) {
    await Promise.all(
      (d.clone?.fields ?? [])
        .filter(isActive)
        .map((f) =>
          document.fonts.load(fontCss(f, f.fontSize), f.replacement || "A").catch(() => []),
        ),
    );
  } else await ensureFonts(d);
  return drawCertificate(canvas, d, widthPx);
}
