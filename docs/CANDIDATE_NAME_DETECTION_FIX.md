# Candidate Name detection integrity

Base commit: `56f1f25`.

## Pipeline findings

- OCR supplies word rectangles; PDF extraction supplies text fragments. `buildLines` formerly grouped baseline centres using half the **largest** fragment height. A tall paragraph rectangle could therefore absorb shorter neighbouring text. Grouping now requires compatible heights and uses the smaller height for baseline tolerance. Word rectangles retain their own vertical bounds, so extracted spans do not inherit an unrelated fragment's height.
- `detectFields` formerly assigned the entire next line after a name cue without semantic or geometry validation. A shared validator now rejects multiline text, body wording (including “bearing registration number”), more than eight words/100 characters, and rectangles wider than 85%, taller than 10%, or larger than 6% of page area. Invalid detections remain static suggestions. The same guard applies to label-based and fallback detection.
- `itemsToFields` formerly trusted an AI `kind: name` response. It now applies the same validator and demotes rejected regions to static suggestions. CSV mappings are not applied to rejected names.
- `fieldFromDetected` validates again before constructing a name layer and retains its original text rectangle in optional `detectionBox` metadata.
- `fitFieldsToInk` formerly performed loose nearby-ink analysis and could enlarge the layer. Name fitting now uses the original text rectangle, strict component membership, and tight ink bounds clipped to that rectangle. Moved/edited names are not re-fitted against another source location. Invalid legacy name fields encountered during fitting are locked and restored to their original text.
- Extracted inline fields now retain the remaining label/wording as protected suggestions. Rendering retains the original locked image and uses the existing shared erase/painter; source anchors, static suggestions and clipping protect the neighbouring content. Copies discard detection anchors.

The user's original failing certificate was not supplied in this turn. The patch reproduces the described oversized region and body-text misclassification using synthetic OCR/AI fixtures, and verifies actual browser pixels with nearby body text. Ambiguous inline paragraphs are left protected rather than guessed as names; manually select the name or provide tighter OCR fragments in those cases.

## Diagnostics

In the browser console, enable session-only diagnostics, then re-import or run detection:

```js
sessionStorage.setItem("certmaker:debug-detection", "1");
```

`[certmaker:detection]` entries include detectedText, fieldType, x/y/w/h, confidence, stage and rejection reason. Stages include classification, AI conversion, clone creation and ink fitting. Scores are conservative detector confidence estimates, not calibrated OCR accuracy probabilities. Text logs stay in the local console; disabled by default. Disable using `sessionStorage.removeItem("certmaker:debug-detection")`.

## Validation and migration

- 219 tests across 20 files: oversized box rejection, body-text rejection, tall/short fragment separation, exact name span bounds, protected residual label, AI rejection and diagnostic logging, plus previous editing regressions.
- Real Chromium raster fixture: original name detection rectangle 350 × 40; fitted name rectangle 253 × 29; replacing the name changes its pixels while nearby “bearing registration number…” body text and artwork remain byte-identical.
- Full real-browser dummy PDF Clone Mode workflow: import, preview/reject, replacement, movement, duplication, bulk alignment, typography match, locking, undo/redo, native-size PNG and PDF downloads.
- TypeScript, changed-file lint and production build pass. The patch applies cleanly to the stated base.

`detectionBox` is optional; no database or dependency migration. Re-upload the original certificate after updating to rebuild detections. Unsafe old detections should not be reused. The existing Fit button also quarantines invalid original name fields; undo remains available.

Repeat raster verification with optional Playwright tooling and a running development server:

```sh
node scripts/verify-candidate-name.mjs /tmp/candidate-name-qa
node scripts/verify-clone-workflow.mjs /tmp/clone-workflow-qa
```

Apply and commit:

```sh
git apply --check candidate-name-bounds.patch
git apply candidate-name-bounds.patch
npm test
npm run build
git add src/features/certmaker/lib scripts/verify-candidate-name.mjs src/test/candidate-name-bounds.test.ts docs/CANDIDATE_NAME_DETECTION_FIX.md
git commit -m "Constrain candidate name detection and protect certificate body text"
```
