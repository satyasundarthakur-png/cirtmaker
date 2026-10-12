# Selection-aware AI editing migration

Baseline: `a7f799d792477ba3891f13a90950e34449b9c292` on `satyasundarthakur-png/cirtmaker/main`.
This is the third patch, built on both earlier committed patches. No production dependency or lockfile changes are required.

## Install and commit

From the existing repository root, with a clean working tree:

```bash
git switch main
git pull --ff-only
git switch -c production-ai-editing
git apply --check /path/to/certificate-maker-production-ai-editing.patch
git apply /path/to/certificate-maker-production-ai-editing.patch
bun install
bun run test
bun run build
git add AGENTS.md README.md docs scripts src/features/certmaker src/test/clone-ai-editor.test.tsx src/test/clone-overlay.test.tsx src/test/clone.test.ts src/test/editing-engine.test.ts src/styles.css
git commit -m "Add selection-aware AI text editing with preview and protected layers"
git push -u origin production-ai-editing
```

Merge through GitHub into the branch your host deploys, then trigger deployment if it is not automatic. Stop if `git apply --check` fails; do not force an outdated patch. The patch must be applied to source, not uploaded to GitHub as a standalone file.

## Data migration

New layer properties are optional: old saved designs remain readable. Defaults are unlocked text, zero rotation/letter spacing, opacity 1 and line height 1.2. Existing fields retain their original data and geometry until edited.

`CertData.textLayers` stores native-template text overlays. Native editable fields are organisation, title, subtitle, recipient and description, plus added text. Verification metadata, QR/seal graphics, signature regions and logos are protected, not AI targets. Clone Mode works with detected/promoted editable fields and user-added text, including CSV-mapped fields. Unpromoted text remains protected. Explicit `locked` and `protection` metadata are enforced; importing a raster image does not semantically identify every unmarked security feature.

`sourceBox` preserves the original text-ink position when text moves or resizes. Do not rewrite this anchor during subsequent moves. Deleting an original clone field uses a deleted tombstone and smart erase; it does not restore original writing. The older remove-box command retains its old restoration semantics.

History is unlimited for the browser session and is not saved across reloads. Snapshots share unchanged image strings. Very long sessions can consume memory; there is no arbitrary 100-state cap. Rollback preserves redo until a new edit branches from that state.

## User workflow

1. Click an editable text box, or select it using a checkbox. Shift/Ctrl/Command-click adds a box to selection. Keyboard focus selects a box. No ID entry is needed.
2. Enter a natural instruction. The acceptance phrases below run locally without a key. Other phrases use Gemini/Groq after the separate editing consent checkbox is enabled.
3. Generate preview; inspect old/new values and changed properties. Use **Show before / after document** for the raster document preview.
4. Accept or reject. Every command change, style candidate and inspector control requires acceptance. Automatic application from the previous patch is intentionally removed.
5. Undo, Redo or Rollback using the toolbar.

Working local phrases:

- Replace this with "Rabindra"
- Make this larger / smaller
- Move slightly down / move 10px down
- Center this
- Match style
- Duplicate this
- Remove this text layer
- Align horizontally / vertically (selected group center lines)
- Replace all selected names with "Rabindra"
- Make all selected fields use matching style
- Font size 24 / font Montserrat / bold on / italic off
- Color #123456 / letter spacing 2 / line height 1.5 / opacity 0.7
- Rotate this 15 degrees / resize to 300 x 60
- Add text "Workshop"

For name-only bulk commands, names are identified by kind/name label/native recipient identity. Tokens are retained unless explicitly replaced; CSV substitution preserves unknown tokens and explicitly blank values. AI never receives CSV rows. Locked text can be manually unlocked only through a reviewed inspector action; protected non-text layers cannot be unlocked by this UI. Use resize commands for rotated layers, whose axis-aligned pointer handles are hidden.

## Style matching

Choose a reference text by its label or use the selected original style. Every bundled allowlisted font is considered; unsupported script/decorative candidates are excluded. Best Match and two alternatives produce an edit preview in one click. Odia/Devanagari use the script-supported Noto face; when only one suitable face exists, alternatives are weight variants rather than unsupported Latin fallbacks.

For editable text, family, size, numeric weight, slant, spacing, line height, color, opacity and effects come from authoritative layer properties. For untouched original raster text, candidate fonts are compared with the cropped text's normalized glyph mask and aspect ratio. Color/size/stroke properties still use the existing fitted layer estimates. Raster font identification and inverse effect/opacity identification are inherently approximate; a percentage is a similarity score, not a calibrated probability of exact identity. The system does not recreate handwriting, logos, signatures or artwork.

## Privacy and security

The provider gets the instruction, selected editable layer context and variable names, using an API key in headers. It does not get images, filenames, unselected layer values, suggested static text or CSV rows through editing. Detection remains a separate opt-in image request. JSON actions are strictly allowlisted; no model-generated code is evaluated. Target escape, malformed plans and locked selections are rejected before mutation. Reviews are invalidated by document or selection changes. Cancelled/unmounted/outdated responses are ignored.

Renderer and export use the same painter. Original text is erased at the source anchor before replacement layers are painted; known protected rectangles are excluded from erasure and overlay painting. Protected-region overlap is rejected for new geometry, with safe clipping for legacy editable rectangles that already overlap a protected area.

## Verification and release limits

198 unit/integration tests passed; TypeScript and targeted ESLint with zero warnings passed; production build passed. Native-canvas raster checks and measured warm timings are included in the delivery's verification directory. Fixture artwork bytes remained unchanged outside authorized editing areas; locking preserved the edited rendering; text movement erased the original anchor and painted at the new location.

The performance measurements are Node native-canvas measurements, not browser latency guarantees. Tests use 100-layer metadata documents and a 1000x600 raster fixture with warmed font/image/erase caches. Cold font loads, first image decoding, large documents and remote provider latency are outside these figures.

Real browser automation and live provider calls were not verified here. Browser downloads were unavailable in this environment. Before public rollout, run the acceptance flows in your deployed browser with a valid provider key and representative large/Odia/Devanagari certificates. Repository-wide lint still reports pre-existing issues in untouched files; changed files pass targeted lint.

Optional native raster QA (does not change production dependencies):

```bash
npm install --no-save @napi-rs/canvas
node scripts/verify-ai-editing.mjs performance.json
```
