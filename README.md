# Zvid Editor

A visual editor for [`@zvid-io/zvid`](../package): compose a video on a canvas +
multi-track timeline, then **export the exact JSON** the package renders — so
anything you design by hand can be automated through the API/CLI afterwards.

```bash
npm install
npm run dev        # → http://localhost:3000
npm test           # schema round-trip tests over the package examples
```

## What it does

- **Stage** — drag / resize / rotate elements with snapping guides, marquee
  selection, anchor & position presets, safe-area overlay, zoom/pan.
- **Timeline** — per-track lanes for visuals, audio lanes with waveforms and
  auto-loop markers, subtitle lane, scene strip; move/trim clips, drag the
  yellow handles to shape enter/exit animation windows, split (<kbd>S</kbd>),
  frame-accurate scrubbing.
- **All 5 element types** — VIDEO (source trim, speed, volume, transitions),
  IMAGE (crop, rounded corners, chroma key, Ken Burns zoom, filters), GIF,
  TEXT (plain or HTML, Google-Fonts picker, free-form CSS), SVG (code editor +
  shape library) — plus `customCode` CSS/JS animations previewed live
  (CSS-only code runs in an isolated shadow DOM; JS runs in a sandboxed iframe).
- **Audio** — background tracks with waveform, trim, volume, speed and the
  package's auto-loop behavior visualized.
- **Subtitles** — caption list, word-level timing grid, SRT/VTT/Whisper-JSON
  import, all four modes (`normal`, `one-word`, `karaoke`, `progressive`)
  previewed on the stage.
- **Scenes** — scene cards + timeline strip, per-scene backgrounds/durations
  (`-1` auto), xfade transitions with overlap, scene-local editing, full-movie
  preview, flat ⇄ scenes conversion.
- **Templates** — a Variables panel (add/edit/rename/delete typed variables,
  usage counts, undeclared-placeholder problems) plus live `{{placeholder}}`
  substitution everywhere (stage, audio, subtitles; toggleable; the document
  always keeps the raw placeholders). The **full-movie preview and timeline
  are fully resolved**: `iterate` scenes expand into one scene per array
  item, condition-falsy scenes/elements are dropped, and the total duration
  matches the render; editing contexts instead dim condition-falsy elements
  so they stay selectable. Scene settings expose `condition` (live on/off
  chip) and `iterate`/`iterateAs`; visuals get a `condition` field in the
  Timing tab; scene cards show ×N / if ✓ badges. Preview semantics are a TS
  port of orch's templateEngine (`shared/template/engine.ts`, incl. the
  order-independent chained-variable declaration) — keep the two in sync.
- **Export** — minimal, validated JSON (defaults omitted, like the shipped
  examples) with a validation report and ready-made Node / CLI / HTTP snippets.
  Import accepts anything `zvid render` accepts.
- **Account (optional)** — the editor is fully usable logged out; signing in
  (same httpOnly `auth_token` cookie as the dashboard, proxied via the
  editor's own server routes to orch) unlocks **Save** (cloud projects,
  `/api/projects` drafts — not plan-validated) and **Save as template**
  (orch `/api/templates`, plan-validated at save time). The cloud-project
  link survives reloads via `zvid-cloud-project` in localStorage and is
  cleared by New/Import/Examples. `NUXT_PUBLIC_DASH_URL` points the
  register/dashboard links (default `http://localhost:3002`). Dashboard deep
  links open saved work directly: `/?project=prj_…` (cloud project, linked
  for in-place saving) and `/?template=tpl_…` (template JSON, unlinked); the
  query is stripped after loading.
- **Render** (optional) — `POST /api/render` wraps the local package build to
  produce the ground-truth MP4 with live progress. Requires FFmpeg on PATH and
  `package/` built + installed (`yarn install && yarn build`). Disable with
  `NUXT_RENDER_ENABLED=false`; point elsewhere with `ZVID_PACKAGE_PATH`.
  `GET /api/probe?src=…` provides an ffprobe fallback for CORS-blocked media.

## Fidelity notes

The stage is a DOM approximation of the FFmpeg output. Text/HTML/SVG are
near-exact (the package renders them with a headless browser from the same
markup + Google Fonts). Enter/exit xfade effects use CSS approximations —
effects marked `≈` in the picker differ visually from FFmpeg; chroma key shows
a badge instead of keying. Use the Render button for the exact result.

## Keyboard shortcuts

Press <kbd>?</kbd> in the app — Space (play), ←/→ (frame-step or nudge),
<kbd>S</kbd> (split), Ctrl+Z/Y, Ctrl+D, Del, Ctrl+scroll (zoom).
