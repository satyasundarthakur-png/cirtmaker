// Optional real-browser QA. Start npm run dev first; install playwright separately.
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const output = resolve(process.argv[2] ?? "clone-workflow-qa");
mkdirSync(output, { recursive: true });
const destination = (name) => resolve(output, name);
const require = createRequire(import.meta.url);
const { chromium: pw } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright")
  : require("playwright");
const { jsPDF } = require("jspdf");
const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [720, 480] });
pdf.setDrawColor(35, 75, 120);
pdf.setLineWidth(6);
pdf.rect(18, 18, 684, 444);
pdf.setFillColor(35, 75, 120);
pdf.circle(630, 90, 24, "F");
pdf.setFont("helvetica", "bold");
pdf.setFontSize(28);
pdf.text("CERTIFICATE OF ACHIEVEMENT", 360, 110, { align: "center" });
pdf.setFont("helvetica", "normal");
pdf.setFontSize(16);
pdf.text("This certificate is awarded to", 360, 170, { align: "center" });
pdf.setFontSize(32);
pdf.text("Aarav Sharma", 360, 230, { align: "center" });
pdf.setFontSize(16);
pdf.text("for completing the Digital Skills Course", 360, 295, { align: "center" });
pdf.text("Date: 12 October 2026", 70, 380);
pdf.text("Certificate No: DEMO-001", 420, 380);
pdf.save(destination("dummy-certificate.pdf"));
const browser = await pw.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--no-sandbox", "--disable-gpu", "--no-zygote", "--disable-dev-shm-usage"],
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  for (let i = 0; i < 30; i++) {
    try {
      await page.goto(process.env.CLONE_QA_URL ?? "http://127.0.0.1:8080/", {
        waitUntil: "networkidle",
      });
      break;
    } catch (e) {
      if (i === 29) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await page.getByRole("switch", { name: "Clone Mode" }).click();
  await page
    .getByLabel("Upload a reference certificate")
    .setInputFiles(destination("dummy-certificate.pdf"));
  await page.getByRole("button", { name: "Text fields", exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Text fields", exact: true }).click();
  const assert = require("node:assert/strict");
  const checks = ["real PDF import: 3000 × 2000, three editable fields"];
  const sourceImage = await page.evaluate(
    async (base64) => {
      const { loadClone } = await import("/src/features/certmaker/lib/clone.ts");
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return (
        await loadClone(new File([bytes], "dummy-certificate.pdf", { type: "application/pdf" }))
      ).image;
    },
    readFileSync(destination("dummy-certificate.pdf")).toString("base64"),
  );
  writeFileSync(
    destination("dummy-original-raster.png"),
    Buffer.from(sourceImage.split(",")[1], "base64"),
  );
  await page.getByLabel("Select Candidate name", { exact: true }).check();
  async function command(text, accept = true) {
    console.log("COMMAND", text);
    await page.getByLabel("AI editing instruction", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Generate edit preview", exact: true }).click();
    try {
      await page
        .getByRole("button", { name: "Accept edits", exact: true })
        .waitFor({ timeout: 5000 });
    } catch (e) {
      console.log(
        "FAILED UI",
        await page.getByRole("region", { name: "AI instruction editing" }).innerText(),
      );
      throw e;
    }
    await page
      .getByRole("button", { name: accept ? "Accept edits" : "Reject edits", exact: true })
      .click();
  }
  const name = page.locator("#clone-0");
  await command("replace with Rabindra", false);
  assert.equal(await name.inputValue(), "Aarav Sharma");
  checks.push("Reject preserves text");
  await command("replace with Rabindra");
  assert.equal(await name.inputValue(), "Rabindra");
  checks.push("replacement with reviewed preview");
  await page.getByRole("button", { name: "Undo (Ctrl+Z)", exact: true }).click();
  assert.equal(await name.inputValue(), "Aarav Sharma");
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)", exact: true }).click();
  assert.equal(await name.inputValue(), "Rabindra");
  checks.push("undo and redo");
  const top = page.locator("#card-clone-0").getByLabel("Top", { exact: true });
  const beforeY = Number(await top.inputValue());
  await command("move 10px down");
  assert.equal(Number(await top.inputValue()), beforeY + 10);
  checks.push("movement with anchored erase");
  await command("duplicate this");
  assert.equal(await page.getByLabel("Select Candidate name copy", { exact: true }).count(), 1);
  checks.push("duplicate");
  await page.getByLabel("Select Candidate name", { exact: true }).uncheck();
  await page.getByLabel("Select Date", { exact: true }).check();
  await command("move 10px down");
  await page.getByLabel("Select Certificate number", { exact: true }).check();
  await command("align horizontally");
  const geometry = async (id) => {
    const card = page.locator(`#card-${id}`);
    return (
      Number(await card.getByLabel("Top", { exact: true }).inputValue()) +
      Number(await card.getByLabel("Height", { exact: true }).inputValue()) / 2
    );
  };
  assert.ok(Math.abs((await geometry("clone-1")) - (await geometry("clone-2"))) <= 1);
  checks.push("bulk horizontal alignment");
  await page.getByLabel("Select Date", { exact: true }).uncheck();
  await page.getByLabel("Select Certificate number", { exact: true }).uncheck();
  await page.getByLabel("Select Candidate name", { exact: true }).check();
  await page.getByRole("button", { name: "Match style", exact: true }).click();
  await page.getByRole("button", { name: /Best Match:/ }).waitFor({ timeout: 60000 });
  console.log("MATCHES", await page.getByRole("button", { name: /Match.*%/ }).allTextContents());
  await page.getByRole("button", { name: "Accept edits", exact: true }).click();
  checks.push("visual fingerprint style preview and apply");
  await command("lock this");
  assert.equal(await name.isDisabled(), true);
  checks.push("locked text prevents editing");
  await page.getByRole("button", { name: "Undo (Ctrl+Z)", exact: true }).click();
  assert.equal(await name.isDisabled(), false);
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /Fine.tune|Custom settings/ })
    .click();
  await page.getByLabel("Format", { exact: true }).selectOption("png");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /^Export PNG/ })
    .first()
    .click();
  const download = await downloadPromise;
  await download.saveAs(destination("dummy-edited-export.png"));
  checks.push("PNG export");
  await page.getByLabel("Format", { exact: true }).selectOption("pdf");
  await page.getByLabel(/Quality/).fill("100");
  const pdfDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: /^Export PDF/ })
    .first()
    .click();
  await (await pdfDownloadPromise).saveAs(destination("dummy-edited-export.pdf"));
  checks.push("PDF export");
  const exported = readFileSync(destination("dummy-edited-export.png")).toString("base64");
  const integrity = await page.evaluate(
    async ({ sourceImage, exported }) => {
      const decode = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas;
      };
      const a = await decode(sourceImage),
        b = await decode("data:image/png;base64," + exported);
      const regions = [
        [0, 0, 3000, 100],
        [2450, 230, 350, 300],
        [400, 340, 2050, 180],
      ];
      const unchanged = regions.every(([x, y, w, h]) => {
        const ap = a.getContext("2d").getImageData(x, y, w, h).data,
          bp = b.getContext("2d").getImageData(x, y, w, h).data;
        return ap.every((v, i) => v === bp[i]);
      });
      return { width: b.width, height: b.height, protectedArtworkUnchanged: unchanged };
    },
    { sourceImage, exported },
  );
  assert.deepEqual(integrity, { width: 3000, height: 2000, protectedArtworkUnchanged: true });
  checks.push("native resolution and byte-identical border, seal and title pixels");
  assert.deepEqual(pageErrors, []);
  writeFileSync(
    destination("dummy-browser-results.json"),
    JSON.stringify({ checks, integrity }, null, 2),
  );
  console.log(checks);
  await page.screenshot({ path: destination("dummy-import.png"), fullPage: true });
} finally {
  await browser.close();
}
