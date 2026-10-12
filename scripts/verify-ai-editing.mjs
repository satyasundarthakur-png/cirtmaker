// Optional raster/performance QA: npm install --no-save @napi-rs/canvas, then node scripts/verify-ai-editing.mjs.
// This uses native canvas, not a browser, and does not exercise live provider calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
const native = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/@napi-rs/canvas`)
  : require("@napi-rs/canvas");
const { createCanvas, Image, GlobalFonts } = native;
for (const [name, pkg, stem] of [
  ["Inter", "inter", "inter"],
  ["Montserrat", "montserrat", "montserrat"],
  ["Playfair Display", "playfair-display", "playfair-display"],
  ["Cormorant Garamond", "cormorant-garamond", "cormorant-garamond"],
  ["Great Vibes", "great-vibes", "great-vibes"],
  ["Noto Sans Oriya", "noto-sans-oriya", "noto-sans-oriya"],
  ["Noto Sans Devanagari", "noto-sans-devanagari", "noto-sans-devanagari"],
]) {
  GlobalFonts.registerFromPath(
    resolve(`node_modules/@fontsource/${pkg}/files/${stem}-latin-400-normal.woff2`),
    name,
  );
}
globalThis.Image = Image;
globalThis.document = {
  createElement: () => createCanvas(1, 1),
  fonts: { check: () => true, load: async () => [], ready: Promise.resolve() },
};
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: { alias: { "@": resolve("src") } },
});
try {
  const { cloneField, paintCloneFields } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/clone.ts",
  );
  const { AIEditingEngine } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/AIEditingEngine.ts",
  );
  const { SelectionManager } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/SelectionManager.ts",
  );
  const { StyleMatchEngine } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/StyleMatchEngine.ts",
  );
  const { renderToCanvas } = await server.ssrLoadModule("/src/features/certmaker/lib/render.ts");
  const { DEFAULT_DATA } = await server.ssrLoadModule("/src/features/certmaker/lib/types.ts");
  const base = createCanvas(1000, 600),
    ctx = base.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1000, 600);
  ctx.fillStyle = "#17181a";
  ctx.font = "48px Inter";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Rabindra", 250, 130);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(850, 40, 100, 50); // Protected graphical marker outside editable rectangle.
  const field = {
    ...cloneField("Rabindra", 100, 100, 300, 60, 0),
    fontSize: 48,
    align: "center",
    erase: "smart",
  };
  const clone = {
    image: base.toDataURL("image/png"),
    width: 1000,
    height: 600,
    filename: "fixture.png",
    kind: "image",
    fields: [field],
    suggestions: [],
  };
  const select = SelectionManager.resolve(clone, ["clone-0"]);
  const plan = AIEditingEngine.plan(clone, select, [{ type: "move", dx: 0, dy: 100 }]);
  const rendered = createCanvas(1, 1);
  await renderToCanvas(rendered, { ...DEFAULT_DATA, cloneMode: true, clone: plan.next }, 1000);
  assert.deepEqual(
    [...rendered.getContext("2d").getImageData(850, 40, 100, 50).data],
    [...base.getContext("2d").getImageData(850, 40, 100, 50).data],
  );
  const darkPixels = (canvas, x, y, w, h) => {
    const pixels = canvas.getContext("2d").getImageData(x, y, w, h).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) count++;
    return count;
  };
  assert.ok(
    darkPixels(rendered, 100, 100, 300, 60) < darkPixels(base, 100, 100, 300, 60) * 0.25,
    "old ink removed at anchored source",
  );
  assert.ok(darkPixels(rendered, 100, 200, 300, 60) > 100, "text painted at moved location");
  const locked = AIEditingEngine.plan(plan.next, SelectionManager.resolve(plan.next, ["clone-0"]), [
    { type: "lock" },
  ]);
  const lockedCanvas = createCanvas(1, 1);
  await renderToCanvas(
    lockedCanvas,
    { ...DEFAULT_DATA, cloneMode: true, clone: locked.next },
    1000,
  );
  assert.deepEqual(
    [...lockedCanvas.getContext("2d").getImageData(0, 0, 1000, 600).data],
    [...rendered.getContext("2d").getImageData(0, 0, 1000, 600).data],
    "locking preserves already edited raster",
  );
  const changed = paintCloneFields;
  const fx = createCanvas(400, 150);
  changed(fx.getContext("2d"), [
    {
      ...field,
      original: "",
      replacement: "Rabindra\nCourse",
      x: 10,
      y: 10,
      w: 350,
      h: 120,
      redraw: true,
      rotation: 10,
      lineHeight: 1.4,
      letterSpacing: 2,
      opacity: 0.6,
      erase: "none",
    },
  ]);
  assert.ok(
    [...fx.getContext("2d").getImageData(0, 0, 400, 150).data].some((v, i) => i % 4 === 3 && v > 0),
  );
  const nativeData = { ...DEFAULT_DATA, recipient: "Rabindra", logo: clone.image };
  const template = createCanvas(1, 1);
  await renderToCanvas(template, nativeData, 1000);
  const { templateLayers, applyTemplateLayers } = await server.ssrLoadModule(
    "/src/features/certmaker/lib/editing/TemplateAdapter.ts",
  );
  const nativeDocument = templateLayers(nativeData),
    nativeSelection = SelectionManager.resolve(nativeDocument, ["recipient"]);
  const nativePlan = AIEditingEngine.plan(nativeDocument, nativeSelection, [
    { type: "replace", text: "New recipient" },
    { type: "rotate", degrees: 5 },
  ]);
  const nativeAfter = createCanvas(1, 1);
  await renderToCanvas(nativeAfter, applyTemplateLayers(nativeData, nativePlan.next), 1000);
  assert.deepEqual(
    [...nativeAfter.getContext("2d").getImageData(400, 60, 200, 60).data],
    [...template.getContext("2d").getImageData(400, 60, 200, 60).data],
    "native logo area preserved",
  );
  if (process.env.AI_QA_IMAGE_DIRECTORY) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(process.env.AI_QA_IMAGE_DIRECTORY, { recursive: true });
    for (const [name, canvas] of [
      ["clone-before", base],
      ["clone-after", rendered],
      ["template-before", template],
      ["template-after", nativeAfter],
    ])
      writeFileSync(
        resolve(process.env.AI_QA_IMAGE_DIRECTORY, `${name}.png`),
        canvas.toBuffer("image/png"),
      );
  }

  function timed(fn, iterations = 100) {
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      fn();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      medianMs: +times[Math.floor(times.length * 0.5)].toFixed(3),
      p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3),
    };
  }
  const many = {
    ...clone,
    fields: Array.from({ length: 100 }, (_, i) => ({
      ...field,
      id: `clone-${i}`,
      x: (i % 10) * 90,
      y: Math.floor(i / 10) * 50,
      w: 80,
      h: 30,
      original: "",
      replacement: "{{name}}",
      erase: "none",
    })),
  };
  const all = SelectionManager.resolve(
    many,
    many.fields.map((f) => f.id),
  );
  const selectionTime = timed(() =>
    SelectionManager.resolve(
      many,
      many.fields.map((f) => f.id),
    ),
  );
  const previewTime = timed(
    () => AIEditingEngine.plan(many, all, [{ type: "replace", text: "Rabindra" }]),
    30,
  );
  const styleTimes = [];
  let ranked;
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    ranked = await StyleMatchEngine.analyze(clone, field);
    styleTimes.push(performance.now() - start);
  }
  styleTimes.sort((a, b) => a - b);
  assert.ok(ranked.length >= 3);
  assert.ok(!ranked.some((m) => m.font === "Great Vibes"));
  const rasterTimes = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await renderToCanvas(rendered, { ...DEFAULT_DATA, cloneMode: true, clone: plan.next }, 1000);
    rasterTimes.push(performance.now() - start);
  }
  rasterTimes.sort((a, b) => a - b);
  const result = {
    environment:
      "Node native canvas (not browser); warmed font/image/erase caches; 100 layers for metadata tests, 1000x600 source for raster tests",
    selection: selectionTime,
    styleRaster: {
      medianMs: +styleTimes[10].toFixed(3),
      p95Ms: +styleTimes[19].toFixed(3),
      topMatches: ranked.slice(0, 3).map((m) => ({ font: m.font, score: m.score })),
    },
    planPreview: previewTime,
    documentPreview: { medianMs: +rasterTimes[5].toFixed(3), p95Ms: +rasterTimes[9].toFixed(3) },
    checks: [
      "marker artwork bytes preserved",
      "movement uses anchored erase",
      "multiline rotation spacing opacity produce raster output",
      "native template renders",
      "ranked font candidates exclude unsupported decorative face",
    ],
  };
  const destination = process.argv[2] ?? "ai-editing-performance.json";
  writeFileSync(destination, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}
