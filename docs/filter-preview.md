# Media filter preview

Images, video and GIFs use a hybrid preview: GPU filters during playback and
immediate edits, then Zvid's actual FFmpeg style graph once paused or settled.
The reference engine is `@ffmpeg/core` 0.12.10 with `@ffmpeg/ffmpeg` 0.12.15.
CSS filters remain only on the legacy SVG path. Project JSON, slider ranges and
native exports are unchanged by the playback optimization.

## Why this engine

CSS brightness multiplies RGB; FFmpeg eq changes luma additively. CSS hue,
saturation and Gaussian blur also differ from FFmpeg's YUV math and repeated
box blur. Merely copying slider curves or implementing an RGB color matrix
cannot reproduce the whole pipeline, intermediate clipping and rounding.

The prebuilt `@libav.js/variant-webcodecs-avf` 6.10.9 was inspected: it does not
export the required eq, hue, boxblur, lutrgb, negate, colorchannelmixer,
alphaextract or alphamerge filters. A custom libav build could make this smaller
and expose persistent filter graphs, but needs a maintained custom WASM build.
The pinned FFmpeg core runs the actual filters for settled frames: the browser
supplies decoded RGBA pixels, without downloading and re-encoding an entire video.
However, full-HD execution measured about 72.5 ms for brightness, 108.3 ms for
blur and 160.8 ms for combined filters, before browser overhead. That caps the
old per-frame path at roughly 14, 9 and 6 FPS respectively. Moving that work to
a worker does not make it fast enough for 30 FPS.

`gpuFilterMath.ts` and `gpuFilterPreview.ts` implement the same parameter mappings,
filter order, limited-range YUV conversion, eq lookup/integer math, fixed-point
hue rotation, repeated box blur, inversion and tint with WebGL2. This is not a
CSS approximation. GPU YUV-to-RGB rounding and browser edge rasterization can
still differ slightly, so live playback is not advertised as byte-identical.
The paused FFmpeg result remains the precise filter reference.

- [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html)
- [FFmpeg WASM architecture](https://ffmpegwasm.netlify.app/docs/overview/)
- [FFmpeg WASM performance considerations](https://ffmpegwasm.netlify.app/docs/performance/)
- [libav.js variants and build configuration](https://github.com/Yahweasel/libav.js)

## Implementation

`utils/ffmpegFilterGraph.ts` mirrors the package's `getStyleFilters.ts`, including
four-decimal parameter rounding, gradual positive contrast from 1 to 3, filter
order, partial RGB inversion and separate preserved alpha. A test compares the
entire generated graph against the package on every run to detect drift.

Frames retain the item's project dimensions, crop/object fit and corner clipping
before color processing. No smaller radius or lower-resolution preview is silently
substituted.

- Playback uploads the decoded media directly to one shared WebGL2 context.
  There is no per-frame `getImageData`, WASM invocation or JavaScript RGBA copy.
  `requestVideoFrameCallback` marks fresh decoded video frames; RAF displays
  only the newest available frame while the browser owns media time and audio.
- Blur uses integer-valued float32 block sums and reduced-resolution prefix
  scans. Each window needs a bounded number of samples regardless of radius,
  preserving FFmpeg's mirrored edges, pass order and fixed-point rounding.
- Shader programs are cached, small color tables update only with settings,
  and size-specific buffers use a bounded LRU (three sizes / 8.3 million base
  pixels, except that a single larger allowed frame can remain). Resources are
  released 30 seconds after the last filtered item unmounts.
- After 150 ms without an edit/seek, a paused frame refines using the lazy FFmpeg
  worker. Obsolete jobs/results are discarded. An outstanding worker job or
  engine download never blocks GPU playback. Old imagery remains visible while
  refining instead of flashing a loading screen on every slider movement.
- If WebGL2 or float render targets are unavailable, the existing FFmpeg path
  remains available with a compatibility notice. That fallback can be slower;
  hardware acceleration is required for the real-time performance expectation.
  Lost contexts are replaced, and failed engine downloads have a Retry action.

The core is about 32 MB uncompressed, 10 MB gzip, and is loaded only for a visible
filtered item's exact refinement or compatibility fallback.

Public media hosts lacking CORS use `/api/filter-media`. This relay checks and
pins public DNS addresses on every redirect, excludes private/special IPs and
credentials, bounds concurrency/size/time, supports single byte ranges, and
does not forward cookies or authentication. Failure is shown on the stage;
failed engine downloads can be retried.

Two boundary fixes are necessary for stable equivalence:

1. Both graphs bound boxblur to `floor((planeSize - 1) / 2)`. FFmpeg's mirrored
   edge loop reads `src[2 * radius]`; the previous maximum for even dimensions
   read allocator padding, giving different results across engines.
2. `ffmpegCoreSource.ts` adapts only the pinned core's JavaScript command wrapper:
   arguments use a temporary aligned stack, and the stack is restored after
   FFmpeg's exception-based CLI exit. Without restoration repeated commands
   fail after about 160 calls. The WASM binary and filter algorithms are unchanged.
   The adapter rejects an unrecognized wrapper on dependency upgrades.

## Verification and limits

`npm test` includes native FFmpeg versus the actual WASM core on gradient/noise
fixtures with transparent pixels, all seven filters, neutral/end/extreme values,
combinations, odd dimensions and one-pixel dimensions. Raw RGBA equality is
required, including exact alpha. A further 600-frame stress test checks stable
memory. The sibling `package/` and FFmpeg on PATH are required for these tests.

`npm run test:e2e -- filter-preview.spec.ts` verifies real canvas pixels against
native FFmpeg, rapid edits/reset, forward/backward video seeks, sustained playback,
one worker shared by multiple items, CORS fallback, blocked URLs, and download retry.

`npm run test:e2e -- gpu-filter-preview.spec.ts` separately compares GPU colors
against native FFmpeg at neutral, extreme and combined settings, checks geometry
and transparency, pause/refine transitions, a blocked WASM download, missing GPU
support, and context-loss recovery. Its full-HD performance gate uses installed
Chrome and a real hardware GPU: brightness, blur and combined filters must each
deliver at least 27 FPS from a 30 FPS source, with no CPU readbacks, no frame gap
of 200 ms or more, and media time advancing at normal speed. Software renderers
explicitly skip only that performance gate, not the pixel tests.

`npm run test:fidelity -- filters.spec.ts` compares the whole editor stage with
real package renders. This includes geometry, crop, radius and opacity. Whole
renders are compared perceptually because browser decoding, alpha premultiplication,
scaling, final compositing and H.264 chroma/encoding can still differ; byte-identical
filter output on identical decoded RGBA does not promise byte-identical final files.
The filter math is shared with FFmpeg; the entire browser video decoder and stage
compositor are not replaced by FFmpeg.

### Slider normalization (2026-09-05)

The former positive contrast range mapped 0..100 to FFmpeg's technical limit
1..1000: even +1 produced 10.99, almost a black/white threshold. It now uses the
same gradual gain curve as saturation. `mapFilterGain` is shared by the editor's
GPU, WASM graph and legacy SVG parameter mapping; tests compare these with the
real native package rather than a duplicate mock.

| Control | Mapping | Audit result |
| --- | --- | --- |
| Contrast | -100..0 → 0..1; 0..100 → 1..3 | Fixed; +1 = 1.02, +25 = 1.5, +50 = 2, +100 = 3 |
| Brightness | -100..100 → additive -1..1 | Already gradual; unchanged |
| Saturation | -100..0 → 0..1; 0..100 → 1..3 | Already gradual; unchanged |
| Hue | Degrees, 0 neutral | Unchanged; not a percentage strength |
| Blur | 0..100 → 0..half the shortest side, with the safe integer bound | Already linear; unchanged; small images have integer-radius plateaus |
| Invert | 0..1 RGB interpolation; true = 1 | Full endpoint explicitly converts to RGB before negate, avoiding a YUV color jump |
| Tint | Per-channel RGB multiplication | Unchanged; #fff is neutral, #rgb and #rrggbb agree |

Numeric-string zeros no longer insert an unwanted eq/color-space conversion in
the native graph when another filter is active. Project fields and accepted
ranges have not changed, but existing positive contrast settings will render
more gently, and full inversion after eq/hue may change slightly. Ship the
editor and native render package together; do not rewrite saved project values.
`reports/filter-preview-research/package/` is an extracted, unused libav.js
research library, not Zvid's render engine; it is intentionally untouched.

`filterNormalization.test.ts` sweeps every integer brightness/contrast/saturation,
blur and hue position plus every 1% inversion step, checking native/WASM graph
agreement and GPU lookup tables. Native rendered-gradient regressions require
contrast +1 to stay within five channel values of neutral and 99%→100% inversion
within three. The image preview test also compares eight positive contrast stops
to native FFmpeg; the inspector test verifies +1 is stored unchanged in project JSON.

Normalization verification: 1,149 editor unit/store tests across 41 files passed,
including 228 byte-exact native/WASM comparisons and the 600-frame stability run.
All six native style-filter tests, the native package build/type-check, and the
documentation build/type-check passed. The editor-wide type-check still reports
the same 90 existing errors, with none in the filter code or its new tests.
The editor production build and all 29 browser tests passed without retries.
The GPU oracle covered 228 comparisons (maximum channel error 1/255), and full-HD
playback stayed at 29.94–29.99 FPS on the same RTX 3080 Ti, with normal media time
and zero CPU pixel readbacks. The longest measured frame gap was 45.5 ms.
Both full-render comparisons passed without retries: image SSIM 0.997189, and
video SSIM 0.998530 / 0.997672 / 0.998549 at the three seek positions. Temporary
test servers were stopped; these changes are local and have not been deployed.

### Initial hybrid-preview verification (2026-09-05, before slider normalization)

- 40 unit/store test files, 1,142 tests passed. The filter oracle covers 49
  parameter sets at four dimensions: 196 native/WASM comparisons with zero
  differing RGBA bytes, plus 600 consecutive commands with no heap growth.
- GPU color oracle: 196 native/GPU comparisons, maximum channel error 1/255,
  worst mean error 0.0278/255. Eighteen crop/fit/transparent/rounded-corner cases
  had worst visible-color mean error 0.645/255 and alpha mean error 0.423/255.
  Raster-edge tolerances are deliberately separate from opaque filter math.
- 29 browser tests passed without retries against the production build: six
  exact-preview tests, seven GPU/fallback/performance tests and all 16 existing
  inspector tests. Hardware performance was executed, not skipped.
- Production full-HD playback on Chrome / Windows / NVIDIA RTX 3080 Ti:

  | Filter | Preview FPS (30 FPS source) | Longest observed frame gap | CPU pixel reads |
  | --- | ---: | ---: | ---: |
  | Brightness | 29.95 | 40.1 ms | 0 |
  | Blur | 30.00 | 38.0 ms | 0 |
  | Combined seven filters | 29.95 | 40.8 ms | 0 |

  Each case used one second of warm-up and 3.5 seconds of measurement; media
  time advanced at 1.00× in all three. These are measured results on this GPU,
  not a guarantee for every device, resolution or number of simultaneous items.
- Both whole-render fidelity tests passed against the production build. An
  initial native screenshot-browser failure coincided with a Windows commitment
  limit error; after releasing the test servers, an isolated render succeeded
  and a fresh two-test run passed in 19.9 seconds.
- Complete image render SSIM: 0.996367. Video SSIM at 0.3, 1.2 and 0.2 seconds:
  0.998530, 0.997672 and 0.998549. Higher is better; 1 is identical.
- Package build, type-check and three focused native style-filter tests passed.
  Editor production build passed with source-map uploads disabled for local QA.
  Editor-wide type-check still reports 90 existing schema/UI/proxy type errors;
  no errors were reported in the new filter code.
- Native reference: FFmpeg n6.1.2-27-ge16ff06adb. Run the oracle again when the
  deployed FFmpeg or browser core is upgraded; equivalence is tested, not assumed.

## Third-party source and notices

The separately loaded FFmpeg core is GPL-2.0-or-later; the JavaScript worker API
is MIT. Preserve their notices and corresponding source/build information when
redistributing the binary. The pinned source and build recipe are available in
[ffmpeg.wasm release v12.15](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15)
(its `packages/core/package.json` pins core 0.12.10).
The local command-wrapper adaptation is fully contained in `ffmpegCoreSource.ts`.

GPU algorithm references (FFmpeg n5.1.4, used by the pinned browser core):
[eq](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/libavfilter/vf_eq.c),
[eq integer path](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/libavfilter/vf_eq.h),
[hue](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/libavfilter/vf_hue.c),
[boxblur](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/libavfilter/vf_boxblur.c),
[swscale input](https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/libswscale/input.c).
