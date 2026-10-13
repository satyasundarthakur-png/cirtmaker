# Typography Fingerprint Engine

Baseline: `e4282b4bd09ab9b81545729a90d1594a97320997` on `satyasundarthakur-png/cirtmaker/main`.
This patch improves visual style fidelity. The existing selection, authorization, preview/accept, undo and export workflows remain in place. No production dependencies or lockfile changes are required.

## Apply and commit

```bash
git switch main
git pull --ff-only
git switch -c typography-fingerprint
git apply --check /path/to/typography-fingerprint.patch
git apply /path/to/typography-fingerprint.patch
bun install
bun run test
bun run build
git add AGENTS.md docs scripts src/features/certmaker src/test/clone-ai-editor.test.tsx src/test/editing-engine.test.ts src/test/typography-fingerprint.test.ts
git commit -m "Match typography with visual fingerprints and iterative refinement"
git push -u origin typography-fingerprint
```

Stop if patch checking fails; the patch is intended for the stated baseline. Merge and redeploy through your normal GitHub/hosting workflow.

## Visual analysis and fingerprint

`TypographyFingerprintEngine.ts` analyzes a bounded, aspect-preserving local crop of the reference's original text. For user-created or already-edited text, it renders the reference through the same painter used for exports. Font family labels do not decide the result.

The serializable fingerprint contains:

- Normalized soft ink mask, horizontal/vertical profiles, shape aspect and edge orientation.
- Ridge-based stroke thickness, stroke contrast and visual ink density.
- Projection-based slant estimate and a sampled lower-ink baseline profile.
- Apparent letter and word gap ratios; line-height estimates when separable lines are observable.
- Observed color, background estimates, alpha/opacity when identifiable, crop quality and explicit uncertainties.

Apparent ink gaps are not claimed to be exact CSS tracking/kerning values. Candidate rendering/refinement recovers usable controls by comparing actual visual results. On opaque paper, foreground color and opacity cannot uniquely be separated; the engine matches observed composited appearance and reports opacity as unknown. Transparent image alpha or known editable opacity can be used directly. Curved handwritten baselines and unique letterforms are measured but cannot be exactly recreated by straight-font controls.

## Candidate scoring

Every bundled allowlisted font is considered with regular/medium/bold and normal/italic variants. Script coverage and FontFace Unicode ranges exclude named fonts that would silently fall back to another face. Generic serif/sans families remain explicitly named measured candidates; a script label never triggers substitution with Great Vibes.

Each candidate uses the shared export painter. The weighted score compares shape, stroke, slant, spacing/profiles, baseline, density, observed color and placement. The best variant from each font family enters refinement. With only one compatible family, actual rendered weight/slant variants become alternatives; they are not made-up similarity penalties.

Three coordinate-descent passes refine size, letter spacing, word spacing, slant correction, baseline shift, line height, kerning and alignment. Changes are retained only when the measured score improves. Refinement yields between bounded passes/font batches so cancellation and selection changes can be processed. Completed analysis is cached against the reference contents and source image; changes invalidate it.

## Application and final confidence

The highest final-confidence candidate is selected by default for the existing edit preview. Accept applies it; Reject leaves the document unchanged. Controls include `wordSpacing`, `kerning`, `slantAngle` and `baselineShift`, added as optional layer/style properties and rendered consistently in preview and export.

If the target box is too small for the reference typography, uniform target fitting scales font size and absolute spacing/effects together. Confidence is reduced and the preview explains the size-fidelity limitation. The reference calibration score remains separate from this target-fit adjustment. Matching does not expand into protected artwork or recreate signatures.

The UI displays Best Match and two alternatives, initial/final score, final confidence, trial count, refinement count, measured features and baseline profile. Percentages are quality-adjusted visual-similarity scores, not probabilities of exact font identity.

## Verification

205 tests passed across 18 files, including pure pixel fingerprints, stroke/slant/spacing/color comparison, blank/malformed crop rejection, transparent alpha, Unicode coverage and existing editing regressions. TypeScript, targeted ESLint and production build checks pass.

Native-canvas fixtures deliberately lie about font metadata:

| Reference pixels | Misleading label | Selected font | Initial → refined score |
| --- | --- | --- | --- |
| Inter regular | Great Vibes | Inter | 78% → 92% |
| Montserrat bold, letter spacing 2px, word spacing 5px | Inter | Montserrat | 85% → 97% |

The second fixture recovered approximately 1.78px letter spacing and 4.81px word spacing. Each fixture evaluated 207 trials; no refinement decreased its score. Before/after PNGs, fingerprints and component scores are included in the archive.

These tests use Node native canvas with registered bundled fonts, not a deployed browser. Initial uncached analysis measured about 0.5–0.9 seconds on these fixtures; cached analysis was below 0.1ms. First-analysis latency therefore does not meet the previous 300ms target in this test environment. Font loading, browser engines, large/low-quality crops and different scripts affect timing and fidelity. Browser and real-certificate validation remain release checks; this matcher itself needs no external AI service or API key.

Optional reproducible QA (does not alter production dependencies):

```bash
npm install --no-save @napi-rs/canvas
node scripts/verify-typography-fingerprint.mjs typography-qa
```

## Changed architecture

- `TypographyFingerprintEngine.ts`: pure pixel fingerprint, visual score, font coverage, rendering search, refinement and cache.
- `StyleMatchEngine.ts`: removed family/script-label ranking; delegates to visual analysis and applies target-fit constraints.
- `CloneAiEditor.tsx`: fingerprint diagnostics, baseline profile, confidence and additional inspector controls.
- `clone.ts`: shared word spacing, kerning, synthetic slant and baseline adjustment rendering.
- `types.ts`, editing types, inspector and schema: optional persisted controls and diagnostics.
- `AIEditingEngine.ts`: cancellation and target context passed into style analysis.
- Unit/UI tests and native QA harness: verify measured matching rather than old label-based heuristics.
