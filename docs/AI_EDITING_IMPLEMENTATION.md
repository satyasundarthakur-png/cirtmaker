# File-by-file implementation

Pipeline: selection → local parser or consented AI plan → schema/authority validation → nonmutating preview → explicit acceptance → shared renderer/history.

## New files

| File | Implementation |
| --- | --- |
| `docs/AI_EDITING_MIGRATION.md` | Migration, installation and release-verification notes. |
| `scripts/verify-ai-editing.mjs` | Optional native raster-integrity and measured-performance harness. |
| `src/features/certmaker/lib/editing/AIEditingEngine.ts` | Selection-scoped local/remote planning, atomic validated commands, geometry/protection checks and stale-plan application guard. |
| `src/features/certmaker/lib/editing/CommandParser.ts` | Deterministic acceptance-phrase parser plus strict Zod command/style response schemas. |
| `src/features/certmaker/lib/editing/EditHistoryManager.ts` | Unlimited immutable session history, undo, redo, rollback and branch semantics. |
| `src/features/certmaker/lib/editing/LayerInspector.ts` | Layer authority, locking, geometry, typography and CSV-token inspection. |
| `src/features/certmaker/lib/editing/PreviewRenderer.ts` | Nonmutating before/after per-layer and per-property diffs. |
| `src/features/certmaker/lib/editing/SelectionManager.ts` | Single/additive selection, primary/reference resolution, rotated hit testing and authorized-text policy. |
| `src/features/certmaker/lib/editing/StyleMatchEngine.ts` | Editable property extraction, normalized raster glyph comparison, script-safe font ranking and alternatives. |
| `src/features/certmaker/lib/editing/TemplateAdapter.ts` | Native-template editable layer registry, baseline/geometry projection and protected graphic regions. |
| `src/features/certmaker/lib/editing/types.ts` | Command, selection, plan, style-match, diff and layer-style TypeScript contracts. |
| `src/test/editing-engine.test.ts` | Acceptance, bulk token, selection escape, history, locking, metadata/native adaptation and provider privacy tests. |

## Modified files

| File | Implementation |
| --- | --- |
| `AGENTS.md` | Project editing invariants and documentation links. |
| `README.md` | Project editing invariants and documentation links. |
| `src/features/certmaker/CertificateMaker.tsx` | Single/multiple selection integration, native-template editing, history rollback and accurate privacy text. |
| `src/features/certmaker/components/CloneAiEditor.tsx` | Selection-aware instruction UI, reviewed property/document previews, ranked matching and inspector controls. |
| `src/features/certmaker/components/CloneAiPanel.tsx` | Shared provider settings and multi-selection/native preview plumbing; detection remains separate. |
| `src/features/certmaker/components/CloneFields.tsx` | Bulk selection checkboxes, locked inputs, tombstone filtering and AI editor integration. |
| `src/features/certmaker/components/CloneOverlay.tsx` | Modifier-click and keyboard selection, lock-aware pointer/keyboard editing, rotated overlays. |
| `src/features/certmaker/components/Preview.tsx` | Canvas overlay propagation for multiple selections; existing live offscreen-frame lifecycle retained. |
| `src/features/certmaker/lib/clone-ai.ts` | Preserves locked/protected boxes during redetection and rejects duplicate detection over their rectangles. |
| `src/features/certmaker/lib/clone-erase-canvas.ts` | Locked/static protection, source-anchor smart-erase windows and exclusion of the active field itself. |
| `src/features/certmaker/lib/clone-instructions.ts` | Legacy reviewed commands also enforce locks/protection. |
| `src/features/certmaker/lib/clone.ts` | Protected mutation boundaries, immutable erase anchors, two-pass erasure/painting, rotation/multiline/spacing/opacity/effects. |
| `src/features/certmaker/lib/history.ts` | React hook delegates to the unlimited history manager. |
| `src/features/certmaker/lib/merge.ts` | CSV substitution includes native overlay text while preserving existing missing/blank-token semantics. |
| `src/features/certmaker/lib/render.ts` | Shared native/clone/export typography rendering, protected clipping and native-text suppression. |
| `src/features/certmaker/lib/types.ts` | Command, selection, plan, style-match, diff and layer-style TypeScript contracts. |
| `src/styles.css` | Regular Montserrat face imported to support honest regular-weight matching. |
| `src/test/clone-ai-editor.test.tsx` | Selection-driven UI preview/accept/reject, style candidates, stale/cancelled responses and bulk alignment tests. |
| `src/test/clone-overlay.test.tsx` | Additive/keyboard selection and locked-layer keyboard protections. |
| `src/test/clone.test.ts` | Existing painter tests adjusted for balanced two-pass saves/restores; invalid geometry remains guarded. |

## API and invariant summary

- `AIEditingEngine.instruct` returns a preview plan; it never mutates the input. Simple acceptance phrases use the local parser. Remote commands require consent.
- `AIEditingEngine.plan` validates the entire command batch before exposing its result. `targets` must be a subset of current selection.
- `AIEditingEngine.apply` rejects stale revisions. Unknown properties, unsupported commands, non-finite values and protected/locked mutations are rejected.
- `PreviewRenderer.diff` records old/new object values and changed properties. The UI shows an additional shared-renderer document preview on demand.
- `EditHistoryManager` has no fixed history limit; rollback keeps the redo path, while new commits branch from the active state.
- `StyleMatchEngine` never changes artwork or sends images to providers. Its percentages are explicitly labeled similarity scores.

## Commit message

```text
Add selection-aware AI text editing with preview and protected layers
```

The archive includes the complete source snapshot, Git patch, migration guide, verification logs/results and nonpersonal before/after raster fixtures. It contains no node_modules, build output, Git credentials or API keys.
