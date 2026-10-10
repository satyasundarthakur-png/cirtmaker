# Certificate Studio — Product Audit & Roadmap

Reviewed as a pre-launch product by a startup advisor, senior UX architect and principal engineer.
Scores are for the product **before** and **after** the four commits that accompany this document.

> **What this review could and could not check.** Types, 25 unit tests and the production build all pass.
> The review environment had no browser, so the new layout, the QR code on the canvas and print output
> were **not** viewed or scanned. Do a visual pass and scan a printed QR code before showing anyone.

---

## 1. Executive summary

The original app is a clever *certificate renderer*: a procedural canvas engine, a reference-image style
learner, metallic/foil/emboss text effects, Odia/Devanagari font support, and fully private,
in-browser bulk export. Those are real strengths and hard to copy.

It was not yet a *product*. It was one long accordion form beside a preview; the certificate could not be
edited on the canvas; there was no undo; bulk meant "a list of names"; a certificate ID was printed but
there was nothing to verify it against; nothing was saved except the last design; and there was no account,
cloud or billing layer. Nothing in it could earn revenue.

These four commits move it from "tool" to "workspace" and add the two features that turn a generator into an
issuance platform: **merge-field bulk issuing** and **verifiable certificates**.

| Score | Before | After these commits |
|---|---|---|
| UX | 4 / 10 | 6 / 10 |
| UI | 5 / 10 | 6.5 / 10 |
| Product | 3.5 / 10 | 5 / 10 |
| Commercial readiness | 1.5 / 10 | 3 / 10 |

Commercial readiness is still low on purpose: there are no accounts, no server and no billing, and the
verification page can attest *integrity* but not *authenticity* (see §7). Those are Phase 3 work.

## 2. What shipped in this change

| Commit | Delivered |
|---|---|
| 1. Workspace shell | Left tab rail (Templates, Content, Branding, Colors, Variables, Export), central canvas with 25–300% zoom and fit, right properties panel, undo/redo with coalesced edits, keyboard shortcuts, sticky toolbar and mobile export bar, empty states |
| 2. Bulk merge | CSV/TSV/semicolon parser, unlimited columns as `{{variables}}`, built-ins (`name`, `course`, `date`, `score`, `grade`, `organization`, `certificate_id`, `address`), per-row canvas preview, missing-variable warning, insert-variable chips, 12 tests |
| 3. Verification | Unique ID → verification URL → QR on the certificate, embedded-record mode with SHA-256 checksum, short-link mode for a custom domain, public `/verify/$id` page (intact / altered / revoked / not found), local issue register with revoke |
| 4. Branding + export | Saved brand kits (logo, seal, signatories, signature images, address, template, colour, fonts), export profiles (Print 300 dpi PDF, Web 150 dpi JPEG, High-res 450 dpi PNG), custom format/DPI/quality, PDF/PNG/JPEG/SVG, JPEG bulk zip, this document |

**Not built (and why).** Drag-and-drop, layers, locking, snap/guides, alignment tools, multi-select. The
renderer places every element at hard-coded coordinates, so these need a scene-graph rewrite (§4), not
a patch. Doing that in a rush would have broken the existing effects and reference-style features. It is
the first item of Phase 2.

---

## 3. Section-by-section audit

Priority: **H**igh / **M**edium / **L**ow.

### 3.1 UI/UX
- **Problem:** one scrolling column of 7 accordions; preview scrolls out of reach on small screens.
- **Why it hurts:** every task means scroll, scan, scroll back; users lose the connection between a field and its effect on the certificate.
- **Solution:** workspace layout (done): rail + panel + canvas + properties. Next: inline text editing on the canvas.
- **Benefit:** faster edits, feels like a design tool. **Priority: H (partly done).**

### 3.2 Information architecture
- **Problem:** "Design" mixed template, colour, paper and fonts; branding was split across sections.
- **Solution (done):** tabs follow the user's mental model: pick → write → brand → style → merge → export. Page/typography moved to Properties.
- **Next:** a Projects/Library home (templates, recent designs, brand kits, issued batches). **Priority: M.**

### 3.3 Layout
- **Problem:** fixed 430 px form column, preview capped by container width, no zoom.
- **Solution (done):** full-height canvas on a checker background, zoom, independent scrolling panels.
- **Next:** resizable panels (`react-resizable-panels` is already a dependency). **Priority: L.**

### 3.4 Visual design
- **Problem:** default-looking cards, one teal accent, no hierarchy between primary/secondary actions.
- **Solution:** keep the token system in `styles.css`; add a typographic scale, an elevation scale and a dark workspace theme. Show templates in category rows with real previews.
- **Benefit:** perceived quality, which drives conversion on a paid product. **Priority: M.**

### 3.5 User flow
- **Problem:** the real job is "issue 120 certificates and let people verify them". The old flow made that a hidden accordion.
- **Solution (done):** Variables → Export is a first-class path with preview-by-row. **Next:** a guided "Issue a batch" wizard (template → upload → map columns → preview 3 → issue → share links). **Priority: H.**

### 3.6 Mobile responsiveness
- **Problem:** two-column grid collapsed to a long page.
- **Solution (done):** canvas first, scrollable tab strip, sticky export bar. **Next:** touch pinch-zoom and bottom-sheet panels. **Priority: M.**

### 3.7 Accessibility
- **Problem:** the canvas is `role="img"` but click-driven, so selecting an element by keyboard was only possible through the Colors tab list; muted text uses a single low-ish contrast token; no skip link.
- **Solution (partly done):** tabs use `tablist`/`tab`/`tabpanel`, toolbar buttons have labels, focus rings on all controls, `aria-pressed` on profiles. **Next:** arrow-key navigation inside the tab rail, a skip link, an audit with axe, and an off-canvas DOM mirror of element text for screen readers. **Priority: H** (also a procurement requirement for universities and government).

### 3.8 Performance
- **Problem:** every keystroke re-renders the full 1400 px preview on the main thread; template thumbnails (6+ canvases) re-rendered on every change; bulk export is serial on the main thread; PDF pages are JPEG data-URLs held in memory.
- **Solution (partly done):** thumbnails now render only while the Templates tab is open; export size is capped at 8000 px per side. **Next:** `OffscreenCanvas` in a Web Worker, cache thumbnails by (theme, relevant fields), stream ZIP entries, and cap concurrency. **Priority: M.**

### 3.9 SaaS readiness
- **Problem:** everything lives in `localStorage` on one device; no identity, storage, or usage metering.
- **Solution:** see Phase 3. Minimum viable backend: auth, Postgres (templates, brand kits, batches, certificates), object storage (logos, signatures, PDFs), a verification endpoint. **Priority: H.**

### 3.10 Enterprise readiness
- **Problem:** no SSO, audit trail, roles, retention, or data-processing story.
- **Solution:** workspaces with roles (owner/admin/designer/issuer/viewer), SSO (SAML/OIDC), immutable issuance log, custom domain verification, data export, configurable retention, status page. **Priority: L now, H for any institutional sale.**

### 3.11 Monetisation
See §8. Short version: sell **verification and issuance volume**, not the editor.

---

## 4. Certificate design system & WYSIWYG architecture

### Template taxonomy
Academic · Medical conference · Workshop · Corporate · Award · Participation · Fellowship · Luxury.
Each category ships 6–10 templates and a default content pack (wording, signatory roles, suggested seal).

### Scalable template schema (proposed)
```jsonc
{
  "id": "med-conf-aurora",
  "category": "medical-conference",
  "version": 3,
  "paper": "a4-landscape",
  "tokens": { "colors": { "ink": "#1b2430", "accent": "#0f766e", "paper": "#fffdf8" },
              "fonts":  { "title": "Playfair Display", "body": "Inter" } },
  "layers": [
    { "id": "frame", "type": "decor", "preset": "double-rule", "locked": true },
    { "id": "logo",  "type": "image", "slot": "brand.logo", "x": 410, "y": 50, "w": 180, "h": 60 },
    { "id": "title", "type": "text",  "text": "Certificate of Attendance", "x": 500, "y": 210, "align": "center", "fx": { "type": "raised", "amount": 40 } },
    { "id": "name",  "type": "text",  "text": "{{name}}", "role": "recipient" },
    { "id": "qr",    "type": "qr",    "slot": "verify" }
  ],
  "variables": ["name", "course", "date"],
  "meta": { "tags": ["conference", "cme"], "author": "studio", "license": "free" }
}
```
Templates become data, so they can be stored in a database, versioned, previewed server-side and sold in a
marketplace. The existing 5 themes migrate to this format as `decor` layers.

### WYSIWYG implementation approach
1. **Scene graph.** Replace the hard-coded coordinates in `render.ts` with an ordered `Layer[]` (above). The renderer iterates layers; today's layout becomes the default layer set.
2. **Hit-testing and selection.** Reuse the existing region idea: each layer reports its box; pointer events pick the top-most; shift-click multi-selects; marquee select on empty canvas.
3. **Transform.** Pointer-event drag/resize/rotate handles drawn in an HTML overlay positioned over the canvas (not on it), so handles stay crisp at any zoom.
4. **Snap, guides, alignment.** Snap to page centre, margins, grid and other layers' edges within a screen-space threshold (about 6 px); draw guides in the overlay; alignment/distribution are pure functions over selected boxes.
5. **Layers panel.** Reorder, rename, hide, **lock**; a `locked` flag excludes a layer from hit-testing and transforms.
6. **History.** The `useHistory` hook from commit 1 already provides undo/redo; with a layer model, switch to patch-based entries (immer patches) to keep memory flat.
7. **Shortcuts.** Delete, arrow-nudge (Shift = 10×), Ctrl+D duplicate, Ctrl+G group, Ctrl+[ / ] reorder.
8. **Library choice.** Build on the current canvas renderer with an HTML overlay, rather than adopting Konva/Fabric. The renderer's text effects and metallic finishes are the differentiator and don't map onto those libraries.

**Effort:** 4–6 weeks for one strong engineer. **Risk:** keeping effects, reference-style import and bulk merge working through the migration. Protect it with golden-image tests.

---

## 5. Bulk merge, verification and branding — architecture

### Bulk (built)
`parseDataset` → `Dataset{headers, rows}` → `certForRow(template, row, index)` → `batchExport`.
Templates hold `{{variables}}`; columns are normalised (`Full Name` → `full_name`, aliases like `recipient`→`name`,
`program`→`course`). Unknown variables stay visible and trigger a warning.
**To scale beyond ~300 certificates:** move rendering to a worker pool in the browser, or to server-side
rendering (headless Chromium or `skia-canvas`) behind a queue (BullMQ/SQS) with progress via SSE and results in object storage.

### Verification (built client-side; production design below)
Built: ID → URL → QR → `/verify/$id`. In embedded mode the link carries a compact record plus a 16-hex SHA-256 checksum.
**Limit, stated plainly:** anyone can create a record and compute its checksum, so this proves *the link was not edited*,
not *who issued it*. Production design:

| Piece | Design |
|---|---|
| Registry | `certificates(id, org_id, batch_id, recipient, title, issued_at, status, hash, revoked_at)` |
| IDs | `CERT-<year>-<sequence>` per org, plus an unguessable public token for the URL if privacy matters |
| Signing | Per-org Ed25519 key held server-side; sign the canonical record; store signature; verification page re-checks it |
| Endpoint | `GET verify.<domain>/<id>` → server lookup → HTML + JSON (`/api/verify/<id>`) |
| QR | Short URL only (`/<id>`): a smaller, far more scannable code than the embedded form |
| Status | valid · revoked · expired · superseded, with reason and timestamp |
| Abuse | Rate limit, no enumeration (token IDs), optional PII minimisation (show initials until a code is entered) |
| Dashboard | Scans over time, top certificates, geographies, revoked-lookup alerts |

### Branding kit (built locally; cloud design)
Local kits store identity + look. Cloud version: `brand_kits(id, org_id, name, address, theme jsonb)` and
`assets(id, org_id, kind: logo|seal|signature, url, sha256)`; kits reference assets by id so a logo update propagates;
signature assets are access-controlled (a signature image is sensitive); one default kit per workspace.

### Export
Built: profiles + DPI + PDF/PNG/JPEG/SVG. **SVG is a wrapper around a raster image**, not editable vector text.
True vector export means re-implementing text effects as SVG filters and is rarely worth it; consider
server-side PDF (vector text, embedded fonts) for the Print profile instead. Add PDF/X and bleed + crop marks
for professional printers.

---

## 6. Technical audit

| Area | Finding | Recommendation |
|---|---|---|
| React architecture | One 450-line component owns tabs, forms, persistence and export orchestration | Split per tab into `features/certmaker/panels/*`; move export/session logic into hooks (`useExport`, `useBrandKits`, `useRegister`) |
| State management | `CertData` is one flat object (now with undo/redo) | Fine for now. With layers, adopt Zustand + immer patches; keep UI state (tab, zoom, selection) separate from document state |
| Component structure | Good split of render engine vs UI; `ReferencePanel` and `effects.ts` are large | Add unit tests for `reference.ts` colour/layout inference with fixture images |
| Scalability | Everything client-side; 300-cert cap is a memory guard | Worker pool now; server rendering + queue for enterprise |
| Performance | Main-thread canvas; per-keystroke re-render | OffscreenCanvas worker, render scheduling with `requestIdleCallback`, thumbnail cache |
| Export rendering | PDFs are a flattened JPEG; text is not selectable or searchable | Server-side vector PDF for print; keep raster path for effects |
| File management | Logos/signatures are data-URLs inside `localStorage` (≈5 MB limit; dropped above 400 KB) | IndexedDB for assets now; object storage + signed URLs in cloud |
| Testing | Was 1 routing test; now 25 tests over merge, verification, export maths, brand kits | Add Playwright smoke tests and golden-image renders for each template |
| Tooling | ESLint reports ~200 Prettier formatting errors on existing files; `bun.lock` points at a private registry | Run `prettier --write` once in its own commit; regenerate the lockfile (see below) |
| Security | Verification links are user-supplied data rendered in React (escaped) | Keep escaping; add CSP; never render `d` as HTML |

**Dependency note.** Commit 3 adds `qrcode-generator` to `package.json`. `bun.lock` was **not** updated: it resolves
packages from a private registry that wasn't reachable here. Run `bun install` locally (or let Lovable do it) and commit the lockfile.

---

## 7. SaaS features, ranked by revenue potential

| Rank | Feature | Why it earns | Model |
|---|---|---|---|
| 1 | **Verification dashboard + public portal** | Recurring value that grows with issuance; hard to leave once QR codes are in the world | Per-issued-certificate / monthly tiers |
| 2 | **Bulk issuance with email delivery** | The painful job institutes pay to avoid | Credits per certificate |
| 3 | **Team collaboration + roles + approvals** | Seat-based, sticky; hospitals and universities need sign-off | Per seat |
| 4 | **White-label + custom domain** (`verify.yourcollege.edu`) | Clear price anchor for enterprise | Add-on / enterprise |
| 5 | **API access + webhooks** (LMS, registration, CME systems) | Integration revenue, lock-in | Usage tiers |
| 6 | **Cloud templates & brand kits** | Table stakes for paid plans | Included, drives upgrade |
| 7 | **Template marketplace** | Network effect, small take rate early | 20–30% revenue share |
| 8 | **Certificate analytics** | Supports renewals | Included in higher tiers |

**Suggested packaging:** Free (watermark, 25 certificates/month, local only) · Pro (no watermark, cloud kits, 500/month, verification)
· Team (seats, approvals, 5,000/month) · Enterprise (SSO, white label, API, SLA).

## 8. AI features (realistic)

| Feature | How to build it | Notes |
|---|---|---|
| **Content writer** | LLM call with category, audience, tone and language; returns title/subtitle/body in a JSON schema, validated against field length limits | Include Odia/Hindi; show 3 options; never auto-apply |
| **Layout suggestions** | Rule-based scorer first (text length, logo aspect, signatory count → pick template and font-fit); LLM only to explain | Cheap, deterministic, testable |
| **Colour recommendations** | Extract dominant colours from the uploaded logo (k-means on a downscaled canvas), generate accent/ink/paper with a WCAG contrast check | No LLM needed |
| **Branding generator** | From a logo + org name, propose a kit (palette, font pairing, seal text) using the colour extractor plus a curated font-pair table | Output is a normal brand kit |
| **Template builder** | LLM emits the JSON template schema from §4 (validated server-side) from a description or an uploaded sample | Needs the scene-graph model first; reference-style import already covers the image case |

Run AI behind your server (never ship keys to the browser), meter it per workspace, and keep the "private, in-browser" promise
explicit: only the text the user chooses to send leaves the device.

---

## 9. Biggest weaknesses

1. Not editable on the canvas: no move/resize/layers. The single biggest gap against Canva-class tools.
2. No server: no accounts, no cloud, no durable registry, no billing, so no revenue path.
3. Verification proves integrity, not authenticity, until there is a signing registry.
4. Flattened raster PDFs: no selectable text, weak for professional print.
5. Main-thread rendering limits batch size and hurts low-end devices.
6. Accessibility gaps are a blocker for institutional procurement.
7. Template library is small (5 themes + reference import) with no categories.
8. Test coverage and formatting hygiene are thin for a paid product.

## 10. Highest-impact improvements

1. Scene-graph editor (drag, layers, snap) — Phase 2.
2. Server registry + signed verification + custom domain — Phase 3.
3. Guided "Issue a batch" wizard with email delivery — Phase 2/3.
4. Template library with categories and a published schema — Phase 2.
5. Accessibility pass to WCAG 2.2 AA — Phase 2.

---

## 11. Roadmap

### Phase 1 — Quick wins (this change, plus 1–2 weeks of polish)
| | |
|---|---|
| **Features** | Workspace layout, zoom, undo/redo, merge fields, QR + verify page, brand kits, export profiles. **Next:** format all files with Prettier, regenerate lockfile, visual QA, fix mobile edge cases, skip link, tab arrow-key navigation, 8 more templates |
| **Effort** | 1–2 weeks remaining |
| **Complexity** | Low–Medium |
| **User impact** | High: the product now feels like a workspace |
| **Business impact** | Medium: a credible demo and the start of a paid-feature story |

### Phase 2 — Professional features (4–8 weeks)
| | |
|---|---|
| **Features** | Scene-graph editor: drag/resize/rotate, layers, lock, snap, guides, align, multi-select; template schema + categories (8 families); batch-issue wizard with column mapping; WCAG 2.2 AA; worker-based rendering; IndexedDB asset store; Playwright + golden-image tests |
| **Effort** | 4–8 weeks, 1–2 engineers |
| **Complexity** | High (renderer migration is the risk) |
| **User impact** | Very high |
| **Business impact** | High: closes the biggest competitive gap |

### Phase 3 — Commercial SaaS (8–12 weeks)
| | |
|---|---|
| **Features** | Auth, workspaces, cloud templates and kits, server registry with signed verification and revocation, short QR links, email delivery of certificates, Stripe billing and usage metering, verification dashboard, public certificate portal, AI content writer and colour tools |
| **Effort** | 8–12 weeks, 2–3 engineers |
| **Complexity** | High (backend, security, billing) |
| **User impact** | High |
| **Business impact** | Very high: first revenue |

### Phase 4 — Enterprise platform (12+ weeks, demand-led)
| | |
|---|---|
| **Features** | SSO (SAML/OIDC), roles and approval workflows, audit log, white-label + custom verify domain, API + webhooks + LMS/CME integrations, template marketplace, data residency, SLA and status page, server-side vector PDF with bleed/crop marks |
| **Effort** | 12+ weeks, 3–4 engineers |
| **Complexity** | Very high |
| **User impact** | Medium (but decisive for institutions) |
| **Business impact** | Very high: large contracts, low churn |

### Startup-advisor verdict
Don't try to out-Canva Canva. The defensible position is **trusted issuance for institutions**: bulk, multilingual
(Odia/Hindi are an underserved advantage), verifiable, and private by default. Sell verification and issuance volume to
medical colleges, conference organisers and training institutes, where a verifiable credential has real value to the
recipient. Build Phase 2's editor because buyers expect it, but spend your differentiation budget on Phase 3's registry.
