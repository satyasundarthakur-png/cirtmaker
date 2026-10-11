<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the uploaded certificate editor in `src/features/certmaker` and render it at `/` through TanStack Router; this preserves the editor while retaining the hosting framework.
- Keep certificate analysis, rendering, exports, and saved device designs browser-side; uploaded app privacy and offline-style workflows do not need a backend.
- Keep uploaded UI styling in semantic global tokens and the certificate Button variant; this preserves its design through Tailwind v4.
- Clone imports must use the isolated browser-only text detection module, never the reference style analyser; render the original first and change only explicit text rectangles to preserve locked artwork.
- Keep clone source images session-only like reference images and preserve source aspect ratios in preview and exports; this avoids storage quota failures and stretching the original.
- Clone Mode exports at the original's own pixel width (`exportWidth`) and sizes PDF pages from the source (`pageSize`); never resample or stretch the artwork. Keep text-field detection pure in `clone-detect.ts` and box geometry in `clone-geometry.ts` so both stay unit-tested.
- Optional AI text detection in Clone Mode (`clone-ai.ts`, providers: Google Gemini and Groq) is the only feature that sends data off the device: bring-your-own-key, session-only keys (never in the repo, localStorage or a URL; sent in a header only), explicit consent, and only the template image plus CSV column NAMES, never row data. AI only reads and locates text. It must never generate, edit or restyle artwork, or choose colours. Validate every model answer strictly; do not send deprecated sampling parameters. Overload (HTTP 5xx), timeouts and short rate limits are retried with backoff and then fall back to another model; key, model, format and quota errors are never retried. Model IDs change often, so keep the model field free-text and re-check the provider docs before changing defaults.
