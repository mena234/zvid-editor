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
- **Export** — minimal, validated JSON (defaults omitted, like the shipped
  examples) with a validation report and ready-made Node / CLI / HTTP snippets.
  Import accepts anything `zvid render` accepts.
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
