# Editor test system

Three layers (full design: `EDITOR_TESTING_PLAN.md` at the repo root):

| Layer | Runner | Where | Command |
|---|---|---|---|
| Unit — pure logic + pinia stores | Vitest | `tests/*.test.ts`, `tests/unit/`, `tests/store/` | `npm test` |
| Server routes — Nitro proxies over HTTP | Playwright (`request`) | `tests/e2e/api.spec.ts` | part of `npm run test:e2e` |
| E2E — real browser against the running app | Playwright | `tests/e2e/*.spec.ts` | `npm run test:e2e` |
| Fidelity — stage vs real `zvid render`, SSIM | Playwright | `tests/fidelity/` | `npm run test:fidelity` (opt-in) |

`npm run test:all` runs unit + server + E2E (not fidelity — it runs real package renders).

## Responsive feature parity

Run `npm run test:responsive` after installing Chromium, WebKit and Firefox with
`npx playwright install chromium webkit firefox`. To run just Chromium, use
`npm run test:responsive -- --project=chromium`.

The suite exercises desktop, tablet, phone, 320px phone and phone landscape
workflows. Chromium also runs the panel, Design Studio and real touch-gesture
tests; WebKit and Firefox run account, project, upload, import/export, render
dialog and support-chat workflows. Tests tap controls, verify exported project data and check
viewport bounds. Touch gestures use browser input, not synthetic DOM events.
Artifacts are written to `../tmp/editor-responsive-results`.

These checks emulate screen sizes and touch input. They do not replace physical
iOS/Android testing of browser chrome, on-screen keyboards, file pickers or
hardware-specific media playback. Auth and cloud rendering use the local mock
server and do not spend credits. Keep test runs serial because they share mock
server state.

The verified coverage and known limits are recorded in
[the responsive editor QA report](../docs/responsive-editor-qa.md).

## Fidelity layer

`tests/fidelity/` renders a fixture JSON with the actual package CLI
(`package/dist/cli.cjs`, needs ffmpeg + the built package), captures the
editor stage **1:1** (stageZoom = 1) at the same timestamps, and asserts an
FFmpeg SSIM score. Artifacts (render, per-timestamp editor/render frames and
diff heatmaps) land in `tests/fidelity/.artifacts/<case>/` — eyeball those
on failure.

`fidelity.spec.ts` uses only features confirmed pixel-exact, so a breach is
a regression. `kitchen-sink.spec.ts` covers the **entire feature surface**:
one scenes-based project (`fixtures/kitchen-sink-video.json` — geometry,
crop/radius/tint/invert, approximate filters, video trim/speed/transition,
text+subtitles, SVG/GIF, enter/exit animations, chroma key, Ken Burns) probed
at a per-feature timestamp with per-feature calibrated thresholds, plus
`fixtures/kitchen-sink-image.json` for image mode. Both fixture JSONs are
directly importable in the editor for eyeballing (fixture server :4598 must
be running). Measured SSIM scores as of 2026-07-09 are in the spec comments —
recalibrate deliberately when parity improves.

`filters.spec.ts` separately checks the FFmpeg WASM media preview against native
package renders; see [filter preview](../docs/filter-preview.md) for pixel tests
and sustained playback coverage.

`gpu-filter-preview.spec.ts` tests the fast playback path separately: native
FFmpeg pixel comparisons, transparent/cropped/rounded media, exact paused
refinement, blocked downloads, absent acceleration and lost-context recovery.
It also generates a temporary 1080p/30 FPS clip and benchmarks brightness, blur
and combined filters in installed Chrome. The performance gate requires a
hardware GPU (software rendering explicitly skips it), at least 27 preview FPS,
normal media time, frame gaps below 200 ms, and zero CPU canvas pixel reads during
playback. It attaches renderer/timing evidence as `gpu-performance.json`.
Run with `npx playwright test --project=e2e gpu-filter-preview.spec.ts --retries=0`.
Do not rebuild Nuxt or run `nuxt prepare` while browser tests are using the dev
server: regenerated files can trigger reloads mid-test. Production-build QA is
preferred for final timing and retry tests.

`tests/unit/filterNormalization.test.ts` checks all integer slider positions
against the real sibling render package, including gradual contrast gains,
brightness/saturation lookup tables, safe blur steps, degree hue values, numeric
zero compatibility, and continuous RGB inversion. The native package's
`tests/styleFilters.test.js` additionally renders gradients to catch perceptual
regressions such as contrast +1 behaving like a black/white threshold.

Known caveats baked into older kitchen-sink thresholds: legacy CSS filters (~0.92),
font rasterization (~0.96), librsvg vs browser SVG (~0.96), Ken Burns edge
crop + the CK badge chip (~0.86). Rotation is excluded: the package flattens
the rotated item's alpha to an opaque black box (package-side quirk).

## How the E2E stack works

`playwright.config.ts` boots (or **reuses**, if already listening) three servers:

| Port | What | Source |
|---|---|---|
| 4597 | editor dev server, `ORCH_URL` → mock | `node node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 4597` |
| 4598 | fixture media server (CORS + Range) | `tests/e2e/helpers/fixtureServer.mjs` |
| 4599 | mock orch: HTTP API + Socket.IO `/frontend` | `tests/e2e/helpers/mockOrch.mjs` |

For fast local iteration keep them running yourself (then `playwright test` skips
the ~30 s dev-server boot):

```bash
node tests/e2e/helpers/standalone-servers.mjs   # fixtures + mock orch
ORCH_URL=http://127.0.0.1:4599 NUXT_PUBLIC_ORCH_URL=http://127.0.0.1:4599 \
  node node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 4597
```

Gotcha: bind the dev server to `127.0.0.1` explicitly — plain `nuxt dev` binds
`[::1]` on Windows and every IPv4 health check fails.

### The test bridge

`plugins/testHooks.client.ts` exposes `window.__zvidTest` (dev servers always;
production builds only with `localStorage['zvid-test-hooks']`). It gives specs
the pinia stores plus `exportedDoc()` / `validate()` / `loadRaw()`. Convention:
**set up** state via `loadProject()`, **interact** through the real UI,
**assert** on `exportedDoc()` — the exported JSON is what `zvid render`
consumes, so it is the ground truth.

Helpers live in `tests/e2e/helpers/app.ts` (`openEditor`, `exportedDoc`,
`loadProject`, `store`, `fx`, `resetMockOrch`, …).

### The mock orch

`tests/e2e/helpers/mockOrch.mjs` implements every orch endpoint the editor's
server routes proxy (auth/session/projects/templates/uploads/designs/stock/
library) plus the render socket (`submitTask` → queued → progress → complete).
Scriptable per test:

```ts
await resetMockOrch({ loginOk: false })               // next login fails
await resetMockOrch({ renderMode: 'fail-task' })      // render job fails mid-run
await resetMockOrch({ library: { examples: [...] }, libraryContent: {...} })
```

Auth: the mock accepts only the token `tok-valid`
(`openEditor(page, { authed: true })` sets the cookie).

### Fixtures

`tests/e2e/fixtures/` — tiny committed media generated by `generate.mjs`
(needs ffmpeg): `clip.mp4` (2 s, 320×180\@30, burned frame numbers, audio),
`clip-b.mp4`, `image.png`, `anim.gif`, `tone.mp3` (3 s), `subs.srt`,
`subs.vtt`, `whisper.json`, `shape.svg`. URL helper: `fx('clip.mp4')`.

## Determinism rules

- No external network in any test (media = fixture server, orch = mock,
  fonts = only default; Google-Fonts-dependent behavior is not asserted).
- Never assert wall-clock animation phase (GIF/customCode play free-running —
  known preview approximation #21 in `EDITOR_ISSUES.md`); pin the playhead and
  assert geometry/visibility/JSON instead.
- Preview≈render divergences documented in `EDITOR_ISSUES.md` are **not**
  asserted either way; tests lock in editor-intended behavior. FFmpeg parity
  is the optional fidelity harness's job (see plan §L5), not CI's.

## Writing a new spec

Copy the shape of `boot.spec.ts`: `openEditor(page)` per test, drive real
DOM, assert exported JSON. Selectors: use existing class names/titles from
the components (no `data-testid` sprinkling). Keep specs independent — every
test must pass alone and in any order (`workers: 1` serializes files, but
order is not guaranteed).
