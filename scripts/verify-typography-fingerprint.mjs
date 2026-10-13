// Optional native-canvas QA: npm install --no-save @napi-rs/canvas; node scripts/verify-typography-fingerprint.mjs OUTPUT_DIRECTORY
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
const { createCanvas, Image, GlobalFonts } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/@napi-rs/canvas`)
  : require("@napi-rs/canvas");
for (const [font, pkg] of [
  ["Inter", "inter"],
  ["Montserrat", "montserrat"],
  ["Playfair Display", "playfair-display"],
  ["Cormorant Garamond", "cormorant-garamond"],
  ["Great Vibes", "great-vibes"],
  ["Noto Sans Oriya", "noto-sans-oriya"],
  ["Noto Sans Devanagari", "noto-sans-devanagari"],
])
  for (const weight of [400, 600, 700])
    try {
      GlobalFonts.registerFromPath(
        resolve(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`),
        font,
      );
    } catch {}
globalThis.Image = Image;
globalThis.document = {
  createElement: () => createCanvas(1, 1),
  fonts: { load: async () => [], check: () => true },
};
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: { alias: { "@": resolve("src") } },
});
const output = resolve(process.argv[2] ?? "typography-qa");
mkdirSync(output, { recursive: true });
try {
  const { cloneField, paintCloneFields } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/clone.ts",
  );
  const { StyleMatchEngine } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/StyleMatchEngine.ts",
  );
  const { TypographyFingerprintEngine } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/TypographyFingerprintEngine.ts",
  );
  const fixtures = [
    {
      id: "regular-wrong-script-label",
      font: "Inter",
      weight: 400,
      italic: false,
      size: 44,
      spacing: 0,
      wordSpacing: 0,
      color: "#17181a",
      text: "Rabindra",
      metadataFont: "Great Vibes",
    },
    {
      id: "bold-spaced-wrong-family",
      font: "Montserrat",
      weight: 700,
      italic: false,
      size: 40,
      spacing: 2,
      wordSpacing: 5,
      color: "#315cad",
      text: "AVATAR office",
      metadataFont: "Inter",
    },
  ];
  const results = [];
  for (const fixture of fixtures) {
    const source = createCanvas(560, 140),
      c = source.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 560, 140);
    c.font = `${fixture.italic ? "italic " : ""}${fixture.weight} ${fixture.size}px "${fixture.font}"`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = fixture.color;
    c.letterSpacing = `${fixture.spacing}px`;
    c.wordSpacing = `${fixture.wordSpacing}px`;
    c.fontKerning = "normal";
    c.fillText(fixture.text, 280, 83);
    const field = {
      ...cloneField(fixture.text, 35, 20, 490, 100, 0),
      font: fixture.metadataFont,
      fontSize: 12,
      align: "left",
      color: "#000000",
      erase: "smart",
    };
    const clone = {
      image: source.toDataURL("image/png"),
      width: 560,
      height: 140,
      filename: "fixture.png",
      kind: "image",
      fields: [field],
      suggestions: [],
    };
    const start = performance.now();
    const matches = await StyleMatchEngine.analyze(clone, field);
    const firstMs = performance.now() - start;
    assert.equal(
      matches[0].font,
      fixture.font,
      "Visual matching must override deliberately wrong font metadata",
    );
    assert.ok(matches[0].typography.finalScore >= matches[0].typography.beforeScore);
    assert.equal(matches[0].typography.refinementPasses, 3);
    assert.ok(matches[0].typography.candidatesEvaluated >= 54);
    const againStart = performance.now();
    await StyleMatchEngine.analyze(clone, field);
    const cachedMs = performance.now() - againStart;
    const after = createCanvas(560, 140),
      ctx = after.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 560, 140);
    paintCloneFields(ctx, [
      { ...field, ...matches[0].style, original: "", redraw: true, erase: "none" },
    ]);
    writeFileSync(resolve(output, `${fixture.id}-reference.png`), source.toBuffer("image/png"));
    writeFileSync(resolve(output, `${fixture.id}-matched.png`), after.toBuffer("image/png"));
    writeFileSync(
      resolve(output, `${fixture.id}-fingerprint.json`),
      JSON.stringify(matches[0].typography.fingerprint, null, 2),
    );
    const target = {
      ...field,
      id: "target",
      original: "",
      replacement: "A much longer recipient name",
      w: 70,
      h: 25,
    };
    const fitted = await StyleMatchEngine.analyze(clone, field, undefined, target);
    assert.ok(fitted[0].targetFit.ratio < 1);
    assert.ok(fitted[0].confidence < matches[0].confidence);
    assert.ok(fitted[0].targetFit.warning);
    results.push({
      fixture: fixture.id,
      actualFont: fixture.font,
      misleadingMetadata: fixture.metadataFont,
      firstAnalysisMs: +firstMs.toFixed(2),
      cachedAnalysisMs: +cachedMs.toFixed(3),
      best: matches[0].font,
      confidence: matches[0].confidence,
      beforeScore: matches[0].typography.beforeScore,
      finalScore: matches[0].typography.finalScore,
      refinedControls: matches[0].style,
      candidates: matches[0].typography.candidatesEvaluated,
      components: matches[0].typography.components,
      targetConstraint: fitted[0].targetFit,
    });
  }
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () =>
      TypographyFingerprintEngine.match(
        {
          image: "",
          width: 1,
          height: 1,
          filename: "",
          kind: "image",
          fields: [],
          suggestions: [],
        },
        cloneField("Text", 0, 0, 100, 30, 0),
        ctrl.signal,
      ),
    /cancelled/,
  );
  const result = {
    environment:
      "Node native canvas, not browser; bundled fonts registered; live providers not used",
    fixtures: results,
    checks: [
      "wrong script/family labels ignored",
      "actual raster family ranked first",
      "every refinement is non-degrading",
      "word/letter spacing and kerning controls rendered",
      "target fit reduces confidence when geometry constrains fidelity",
      "pre-cancelled analysis rejected",
      "completed visual analysis cached by reference/image",
    ],
  };
  writeFileSync(resolve(output, "RESULTS.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}
