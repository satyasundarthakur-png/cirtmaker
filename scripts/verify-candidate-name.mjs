// Real-browser synthetic raster regression. Start npm run dev first; optional Playwright tooling.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)
  : require("playwright");
const output = resolve(process.argv[2] ?? "candidate-name-qa");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-zygote"],
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.CLONE_QA_URL ?? "http://127.0.0.1:8080/", {
    waitUntil: "networkidle",
  });
  const result = await page.evaluate(async () => {
    const { fieldFromDetected } = await import("/src/features/certmaker/lib/clone.ts");
    const { fitFieldsToInk } = await import("/src/features/certmaker/lib/clone-erase-canvas.ts");
    const { renderToCanvas } = await import("/src/features/certmaker/lib/render.ts");
    const { DEFAULT_DATA } = await import("/src/features/certmaker/lib/types.ts");
    const { AIEditingEngine } =
      await import("/src/features/certmaker/lib/editing/AIEditingEngine.ts");
    const { SelectionManager } =
      await import("/src/features/certmaker/lib/editing/SelectionManager.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 700;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1000, 700);
    ctx.fillStyle = "#123456";
    ctx.strokeStyle = "#123456";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 960, 660);
    ctx.fillStyle = "#17181a";
    ctx.font = "32px Inter";
    ctx.fillText("Rabindra Thakur", 300, 240);
    ctx.font = "21px Inter";
    ctx.fillText("bearing registration number DEMO-001", 240, 275);
    ctx.fillText("has successfully completed the certificate course", 240, 302);
    const raw = { x: 295, y: 207, w: 350, h: 40 };
    const field = fieldFromDetected(
      {
        kind: "name",
        label: "Candidate name",
        box: raw,
        text: "Rabindra Thakur",
        size: 32,
        fontHint: "sans",
      },
      "clone-0",
      { w: 1000, h: 700 },
    );
    const clone = {
      image: canvas.toDataURL(),
      width: 1000,
      height: 700,
      filename: "nearby-body.png",
      kind: "image",
      fields: [field],
      suggestions: [],
    };
    const fitted = await fitFieldsToInk(clone);
    const plan = AIEditingEngine.plan(fitted, SelectionManager.resolve(fitted, ["clone-0"]), [
      { type: "replace", text: "Priya Sharma" },
    ]);
    const after = document.createElement("canvas");
    await renderToCanvas(after, { ...DEFAULT_DATA, cloneMode: true, clone: plan.next }, 1000);
    const compare = (x, y, w, h) => {
      const a = ctx.getImageData(x, y, w, h).data,
        b = after.getContext("2d").getImageData(x, y, w, h).data;
      return a.every((v, i) => v === b[i]);
    };
    return {
      before: canvas.toDataURL(),
      after: after.toDataURL(),
      raw,
      fitted: fitted.fields[0],
      bodyUnchanged: compare(200, 250, 650, 80),
      artworkUnchanged: compare(0, 0, 1000, 100),
      nameChanged: !compare(295, 207, 350, 40),
    };
  });
  assert.equal(result.bodyUnchanged, true);
  assert.equal(result.artworkUnchanged, true);
  assert.equal(result.nameChanged, true);
  const { raw, fitted } = result;
  assert.ok(
    fitted.x >= raw.x &&
      fitted.y >= raw.y &&
      fitted.x + fitted.w <= raw.x + raw.w &&
      fitted.y + fitted.h <= raw.y + raw.h,
  );
  for (const name of ["before", "after"]) {
    writeFileSync(
      resolve(output, `${name}.png`),
      Buffer.from(result[name].split(",")[1], "base64"),
    );
    delete result[name];
  }
  writeFileSync(resolve(output, "RESULTS.json"), JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await browser.close();
}
