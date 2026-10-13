# Clone workflow corrective patch

Base: `964a97981232fbb684c0ad67ee47027d315c3c27` (main).

## Reproduced failures and fixes

1. Import a dummy text PDF, select the recipient, replace its name, move down 10px, then duplicate. The fixed `field.y + field.h + 8` copy position intersected protected course text; the command failed although free space existed. Duplication now chooses the nearest free position from page and obstacle boundaries, accounts for rotated bounds, avoids active text and protected suggestions, and rejects atomically when the page has no safe space. The original erase anchor is never copied.
2. Inject a native-canvas allocation failure during Clone Mode export. The exporter silently retried at 75% resolution. Clone Mode now attempts only native width and reports the original error. Generated templates retain their existing reduced-size recovery.

No data/schema migration or new production dependencies. Editing remains reviewed and undoable. This patch does not change the typography scoring algorithm.

## Verification

- Real headless Chromium browser: dummy PDF import (three editable fields, 3000 × 2000 source), Reject, name replacement, undo/redo, movement, safe duplication, bulk alignment, visual fingerprint matching, lock protection, and actual PNG/PDF downloads.
- PNG dimensions remain 3000 × 2000; sampled original border, seal, and title pixels match byte-for-byte. PDF page dimensions preserve the imported physical size, rounded to 0.1mm by the existing importer.
- 210 automated tests across 19 files; TypeScript, changed-file ESLint, and production build pass.
- Native-canvas QA: original ink erasure, relocated text, unchanged artwork, locking, native templates and typography rendering pass.
- The export failure is fault-injected, not an actual device memory exhaustion. Scanned-image OCR, live AI provider calls, and the deployed site are not exercised by this PDF test.

## Repeat the browser test

Install optional Playwright tooling (do not change production dependencies), install Chromium with `npx playwright install chromium`, and start `npm run dev -- --host 127.0.0.1`. In another terminal:

```sh
node scripts/verify-clone-workflow.mjs /tmp/clone-workflow-qa
```

`CLONE_QA_URL` optionally changes the dev server URL. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an installed Chromium executable. The test imports source modules for pixel integrity checks and therefore needs the development server. It generates the dummy fixture, downloaded exports, original raster, browser screenshot and JSON results. No account, provider key or personal data is needed.

## Applying the patch

```sh
git apply --check clone-workflow-fixes.patch
git apply clone-workflow-fixes.patch
npm test
npm run build
git add docs/CLONE_WORKFLOW_QA.md scripts/verify-clone-workflow.mjs src/features/certmaker/lib/editing/AIEditingEngine.ts src/features/certmaker/lib/exporter.ts src/test/editing-engine.test.ts src/test/clone-export-integrity.test.ts
git commit -m "Fix safe clone duplication and preserve native export resolution"
```

Review before pushing to the connected main branch. No deployment or push was performed during QA.
