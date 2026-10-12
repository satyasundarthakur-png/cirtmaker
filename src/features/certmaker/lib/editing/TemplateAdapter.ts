import { cloneField } from "../clone";
import { FONT_SETS, resolveTheme } from "../themes";
import { PAPER_RATIO, type CertData, type CloneSource, type CloneTextField } from "../types";
const editable = ["org", "title", "subtitle", "recipient", "body"] as const;
const fontName = (css: string) => /"([^"]+)"/.exec(css)?.[1] ?? css.split(",")[0]!.trim();
export function templateLayers(data: CertData): CloneSource {
  const theme = resolveTheme(data),
    fonts = FONT_SETS[data.fontSet].stack;
  const width = 1000,
    height = width / PAPER_RATIO[data.paper],
    cx = width / 2 + (theme.shift ?? 0);
  const definitions = [
    {
      id: "org",
      y: 125,
      h: 28,
      w: 760,
      font: fontName(fonts.body),
      size: 17,
      color: theme.muted,
      weight: 600,
      spacing: 4,
    },
    {
      id: "title",
      y: 165,
      h: 65,
      w: 800,
      font: fontName(fonts.title),
      size: theme.caps ? 44 : 54,
      color: theme.ink,
      weight: fonts.titleWeight,
      spacing: theme.caps ? 3 : 0,
    },
    {
      id: "subtitle",
      y: 251,
      h: 32,
      w: 760,
      font: fontName(fonts.body),
      size: 23,
      color: theme.muted,
      weight: fonts.bodyWeight,
      spacing: 0,
    },
    {
      id: "recipient",
      y: 295,
      h: 75,
      w: 780,
      font: fontName(fonts.name),
      size: 68,
      color: data.accent || theme.accent,
      weight: fonts.nameWeight,
      spacing: 0,
    },
    {
      id: "body",
      y: 397,
      h: 124,
      w: 720,
      font: fontName(fonts.body),
      size: 23,
      color: theme.ink,
      weight: fonts.bodyWeight,
      spacing: 0,
    },
  ];
  const fields = definitions.map((d, i): CloneTextField => ({
    ...cloneField(data[d.id as (typeof editable)[number]], cx - d.w / 2, d.y, d.w, d.h, i),
    id: d.id,
    label: d.id === "recipient" ? "Recipient name" : d.id,
    align: "center",
    font: d.font,
    fontSize: d.size,
    fontWeight: Number(d.weight),
    italic: d.id === "subtitle",
    letterSpacing: d.spacing,
    lineHeight: 1.35,
    color: data.colors[d.id] ?? d.color,
    erase: "none",
    cover: "",
    protection: "text",
    multiline: d.id === "body",
    baselineOffset:
      (
        { org: 144, title: 212, subtitle: 276, recipient: 358, body: 422 } as Record<string, number>
      )[d.id]! - d.y,
  }));
  const saved = new Map((data.textLayers ?? []).map((f) => [f.id, f]));
  const merged = fields.map((f) =>
    saved.has(f.id) ? { ...saved.get(f.id)!, replacement: f.replacement } : f,
  );
  return {
    image: `template:${data.template}`,
    width,
    height,
    filename: data.template,
    kind: "image",
    suggestions: [
      {
        ...cloneField("", cx - 350, height - 75, 700, 40, 1005),
        id: "protected-verification-meta",
        protection: "security" as const,
        locked: true,
      },
      ...(data.logo
        ? [
            {
              ...cloneField("", cx - 95, 62, 190, 58, 1000),
              id: "protected-logo",
              protection: "logo" as const,
              locked: true,
            },
          ]
        : []),
      ...data.sigs.slice(0, 2).map((_, i) => ({
        ...cloneField(
          "",
          width * (i ? 0.78 : 0.22) + (theme.shift ?? 0) - 110,
          height - 180,
          220,
          112,
          1001 + i,
        ),
        id: `protected-signature-${i}`,
        protection: "signature" as const,
        locked: true,
      })),
      ...(data.showSeal
        ? [
            {
              ...cloneField("", cx - 48, height - 198, 96, 124, 1003),
              id: "protected-seal",
              protection: "security" as const,
              locked: true,
            },
          ]
        : []),
      ...(data.qr
        ? [
            {
              ...cloneField("", width - 130, height - 150, 104, 110, 1004),
              id: "protected-qr",
              protection: "security" as const,
              locked: true,
            },
          ]
        : []),
    ],
    fields: [
      ...merged,
      ...(data.textLayers ?? []).filter((f) => !editable.some((id) => id === f.id)),
    ],
  };
}
export function applyTemplateLayers(data: CertData, clone: CloneSource): CertData {
  const next = { ...data, textLayers: clone.fields };
  for (const id of editable) {
    const field = clone.fields.find((f) => f.id === id);
    if (field) next[id] = field.deleted ? "" : field.replacement;
  }
  return next;
}
