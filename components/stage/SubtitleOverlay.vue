<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '~/stores/project'
import {
  activeCaptionAt,
  renderCaptionWords,
  subtitleContainerStyle,
  subtitleTextStyle,
  subtitleStrokeStyle,
  type RenderedWord,
} from '~/utils/subtitleRuntime'
import { loadGoogleFont } from '~/utils/fonts'
import { buildAssContent } from '~/shared/ass/buildAssContent'
import { loadRenderFont } from '~/shared/ass/fontMetrics'

const props = defineProps<{ time: number }>()
const project = useProjectStore()

// resolvedPreviewDoc substitutes {{placeholders}} in caption text/styles
// (identical to project.doc when the variables preview is off)
const subtitle = computed(() => project.resolvedPreviewDoc.subtitle)
const styles = computed(() => subtitle.value?.styles ?? {})
const mode = computed(() => styles.value.mode ?? 'normal')
const hasCaptions = computed(() => (subtitle.value?.captions?.length ?? 0) > 0)

watch(
  () => styles.value.fontFamily,
  (f) => f && loadGoogleFont(f),
  { immediate: true }
)

/* ------------------------------------------------------------------ */
/* Native ASS preview (jassub = libass compiled to WASM)               */
/*                                                                     */
/* The ASS content comes from shared/ass/buildAssContent — the same    */
/* builder the renderer uses — and is rasterized by the same libass,   */
/* so font sizing, margins, wrapping, and per-line boxes are pixel-    */
/* faithful to the FFmpeg output. Init is retried with a fresh worker  */
/* and canvas on transient failures; the DOM word-span approximation   */
/* below stays as a fallback only when every attempt fails.            */
/* ------------------------------------------------------------------ */

const assHostEl = ref<HTMLDivElement | null>(null)
const assReady = ref(false)
// reactive: the warning chip below offers Retry when init/build failed
const assFailed = ref(false)
// browser lacks Worker/OffscreenCanvas — retrying is pointless, only a
// different browser helps
const assUnsupported = ref(false)
const warningDismissed = ref(false)
let jassub: any = null
let destroyed = false
let rebuildToken = 0
const loadedFontKeys = new Set<string>()

function assSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    !!HTMLCanvasElement.prototype.transferControlToOffscreen
  )
}

// abslink's wrap() only listens for `message` events, so a worker that dies
// while booting (aborted wasm fetch, dev-server restart) leaves `ready`
// pending FOREVER — guard it with worker-error listeners and a hard timeout.
const INIT_ATTEMPTS = 3
const INIT_TIMEOUT_MS = 20_000
const INIT_RETRY_DELAY_MS = 750

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Await instance.ready, but reject on worker error or timeout instead of hanging. */
function waitAssReady(instance: any): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const worker: Worker | undefined = instance._worker
    let done = false
    const finish = (err?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker?.removeEventListener('error', onError)
      worker?.removeEventListener('messageerror', onError)
      if (err === undefined) resolve()
      else reject(err instanceof Error ? err : new Error(String(err)))
    }
    const onError = (e: any) =>
      finish(new Error(`worker failed: ${e?.message || e?.type || 'error'}`))
    const timer = setTimeout(
      () => finish(new Error(`init timed out after ${INIT_TIMEOUT_MS}ms`)),
      INIT_TIMEOUT_MS
    )
    worker?.addEventListener('error', onError)
    worker?.addEventListener('messageerror', onError)
    Promise.resolve(instance.ready).then(
      () => finish(),
      (e: unknown) => finish(e ?? new Error('jassub init failed'))
    )
  })
}

/**
 * Tear down without JASSUB.destroy(): destroy() awaits `ready`, which never
 * settles when the worker failed to boot, so the worker (and its wasm memory)
 * would leak. Direct termination is also safe for healthy instances.
 */
function hardDestroy(instance: any) {
  if (!instance) return
  instance._destroyed = true
  try {
    instance._ro?.disconnect()
  } catch {}
  try {
    instance._worker?.terminate()
  } catch {}
  try {
    instance._canvas?.remove()
  } catch {}
}

async function initAss(): Promise<boolean> {
  if (jassub) return true
  if (!assHostEl.value || assFailed.value || destroyed) return false
  if (!assSupported()) {
    console.warn('[subtitles] browser lacks Worker/OffscreenCanvas — DOM fallback only')
    assUnsupported.value = true
    assFailed.value = true
    return false
  }

  for (let attempt = 1; attempt <= INIT_ATTEMPTS && !destroyed; attempt++) {
    let instance: any = null
    try {
      const { default: JASSUB } = await import('jassub')
      const host = assHostEl.value
      if (!host || destroyed) return false
      // transferControlToOffscreen() is one-shot and destroy() removes the
      // canvas from the DOM, so every attempt needs a fresh canvas element
      const canvas = document.createElement('canvas')
      canvas.width = project.defaults.width
      canvas.height = project.defaults.height
      host.replaceChildren(canvas)
      instance = new JASSUB({
        // jassub ships its own newer lib.dom types; structurally identical
        canvas: canvas as any,
        subContent: '[Script Info]\nScriptType: v4.00+\n',
        // its bundled default.woff2 is missing from the dist — an empty map +
        // explicit defaultFont avoids a broken fetch; real families are always
        // added by ensureFonts before a track is set
        availableFonts: {},
        defaultFont: 'liberation sans',
      })
      await waitAssReady(instance)
      if (destroyed) {
        hardDestroy(instance)
        return false
      }
      jassub = instance
      // fonts live in the worker — a fresh worker starts with none
      loadedFontKeys.clear()
      assReady.value = true
      return true
    } catch (e) {
      hardDestroy(instance)
      console.warn(
        `[subtitles] jassub init attempt ${attempt}/${INIT_ATTEMPTS} failed:`,
        e
      )
      if (attempt < INIT_ATTEMPTS) await sleep(INIT_RETRY_DELAY_MS * attempt)
    }
  }
  if (!destroyed) {
    console.warn('[subtitles] native ASS preview unavailable, using DOM fallback')
    assFailed.value = true
    assReady.value = false
  }
  return false
}

/** Manual retry (warning chip) — clears the failed state and re-inits. */
function retryNativePreview() {
  if (assUnsupported.value || destroyed) return
  assFailed.value = false
  warningDismissed.value = false
  scheduleRebuild()
}

/**
 * Load the styled font variant (the same TTF the renderer downloads) into
 * libass. Matching is by the font's INTERNAL family name, which is why the
 * ASS builder styles (text and box drawings alike) reference the subtitle's
 * own family — never a family we don't supply.
 */
async function ensureFonts(st: Record<string, any>) {
  const family = String(st.fontFamily ?? 'Poppins').split(',')[0].trim()
  const variant = { weight: st.isBold ? 700 : 400, italic: !!st.isItalic }
  const key = `${family}|${variant.weight}|${variant.italic}`
  if (loadedFontKeys.has(key)) return
  const font = await loadRenderFont(family, variant)
  if (font && jassub) {
    // slice(): abslink may transfer (detach) the buffer, and the cached copy
    // is reused for canvas measurement
    await jassub.renderer.addFonts([font.data.slice()])
    loadedFontKeys.add(key)
  }
}

// rebuilds are serialized: init/setTrack must never interleave
let rebuildChain: Promise<void> = Promise.resolve()
function scheduleRebuild() {
  const token = ++rebuildToken
  rebuildChain = rebuildChain.then(() => rebuild(token)).catch(() => {})
}

async function rebuild(token: number) {
  if (assFailed.value || destroyed || token !== rebuildToken) return
  const sub = subtitle.value
  const st = sub?.styles ?? {}
  if (!sub?.captions?.length) {
    // No captions → nothing to rasterize. Clear an already-running track but
    // never boot the worker for an empty document: deep-linked projects load
    // AFTER mount, and init must not burn its retry attempts (or 2MB of wasm)
    // before real captions exist.
    if (jassub) {
      await jassub.renderer.setTrack('[Script Info]\nScriptType: v4.00+\n')
      renderFrame(true)
    }
    return
  }
  if (!(await initAss())) return
  try {
    await ensureFonts(st)
    // deep clone: buildAssContent mutates captions/styles like the package does
    const clone = JSON.parse(JSON.stringify({ captions: sub.captions, styles: st }))
    const content = await buildAssContent(clone, {
      width: project.defaults.width,
      height: project.defaults.height,
    })
    if (destroyed || token !== rebuildToken) return
    await jassub.renderer.setTrack(content)
    renderFrame(true)
  } catch (e: any) {
    console.warn('[subtitles] ASS build failed, using DOM fallback:', String(e?.stack || e))
    assFailed.value = true
    assReady.value = false
  }
}

function renderFrame(repaint = false) {
  if (!jassub || !assReady.value) return
  jassub.manualRender(
    {
      mediaTime: props.time,
      width: project.defaults.width,
      height: project.defaults.height,
      expectedDisplayTime: performance.now(),
    },
    repaint
  )
}

onMounted(() => {
  scheduleRebuild()
})

onBeforeUnmount(() => {
  destroyed = true
  hardDestroy(jassub)
  jassub = null
})

watch(() => props.time, () => renderFrame())

// Rebuild the track when the subtitle content/styles or the canvas size change.
let rebuildTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [subtitle, () => project.defaults.width, () => project.defaults.height],
  () => {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => scheduleRebuild(), 120)
  },
  { deep: true }
)

// Deep-linked projects load AFTER mount: if the mount-time init failed (e.g.
// a transient network error before any caption existed), give it one fresh
// round of attempts when captions actually arrive.
watch(hasCaptions, (has, had) => {
  if (has && !had && assFailed.value && !assUnsupported.value) retryNativePreview()
})

/* ------------------------------------------------------------------ */
/* DOM fallback (pre-jassub approximation)                             */
/* ------------------------------------------------------------------ */

const active = computed(() => activeCaptionAt(subtitle.value, props.time))

const words = computed(() => {
  if (!active.value) return []
  return renderCaptionWords(active.value.caption, props.time, mode.value, styles.value)
})

const containerStyle = computed(() =>
  subtitleContainerStyle(styles.value, project.defaults.width, project.defaults.height)
)
const textStyle = computed(() => subtitleTextStyle(styles.value))
// stroke layer behind the fills — mirrors libass outline rendering order
const strokeStyle = computed(() => subtitleStrokeStyle(styles.value))
const activeColor = computed(() => styles.value.activeWord?.color)
// The renderer's Highlight ASS style carries the activeWord.background box in
// every mode that restyles the active word via {\rHighlight}.
const activeBackground = computed(() =>
  ['progressive', 'karaoke', 'highlight', 'pop', 'bounce'].includes(mode.value)
    ? styles.value.activeWord?.background
    : undefined
)

function wordStyle(w: RenderedWord): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  if (w.active && activeColor.value) s.color = activeColor.value
  if (w.active && activeBackground.value) {
    s.background = activeBackground.value
    // renderer active-word boxes are square unless activeWord.radius is set
    s.borderRadius = `${Number(styles.value.activeWord?.radius) || 0}px`
    s.padding = '0 0.14em'
  }
  if (w.opacity !== undefined) s.opacity = String(w.opacity)
  if (w.scale !== undefined) {
    s.display = 'inline-block'
    s.transform = `scale(${w.scale})`
  }
  if (w.translate !== undefined) {
    s.display = 'inline-block'
    s.transform = `translate(${w.translate[0]}px, ${w.translate[1]}px)`
  }
  return Object.keys(s).length ? s : undefined
}

/**
 * Word style for the stroke layer: keeps every layout-affecting property of
 * the fill layer (opacity, transforms, active-word padding) so both layers
 * wrap and align identically, but never any color/box.
 */
function strokeWordStyle(w: RenderedWord): Record<string, string> | undefined {
  const s: Record<string, string> = {}
  if (w.active && activeBackground.value) s.padding = '0 0.14em'
  if (w.opacity !== undefined) s.opacity = String(w.opacity)
  if (w.scale !== undefined) {
    s.display = 'inline-block'
    s.transform = `scale(${w.scale})`
  }
  if (w.translate !== undefined) {
    s.display = 'inline-block'
    s.transform = `translate(${w.translate[0]}px, ${w.translate[1]}px)`
  }
  return Object.keys(s).length ? s : undefined
}

function typedPart(w: RenderedWord): string {
  return [...w.text].slice(0, w.revealedChars ?? 0).join('')
}
function untypedPart(w: RenderedWord): string {
  return [...w.text].slice(w.revealedChars ?? 0).join('')
}
</script>

<template>
  <!-- native ASS canvas: rasterized by libass (jassub), identical to renders.
       The canvas itself is created per init attempt (see initAss). -->
  <div v-show="assReady && hasCaptions" class="subtitle-overlay ass-layer">
    <div ref="assHostEl" class="ass-host"></div>
  </div>

  <!-- captions exist but the exact preview couldn't load: warn + offer retry -->
  <div
    v-if="assFailed && hasCaptions && !warningDismissed"
    class="ass-warning"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
  >
    <span class="warn-icon" aria-hidden="true">⚠</span>
    <span v-if="assUnsupported" class="warn-text">
      This browser can't show the exact subtitle preview — an approximation is
      shown. Please switch to a recent Chrome, Edge, or Firefox.
    </span>
    <span v-else class="warn-text">
      The exact subtitle preview failed to load — an approximation is shown.
      If retrying doesn't help, try a different browser (Chrome or Edge).
    </span>
    <button v-if="!assUnsupported" class="warn-retry" @click="retryNativePreview">
      Retry
    </button>
    <button class="warn-close" aria-label="Dismiss" @click="warningDismissed = true">
      ×
    </button>
  </div>

  <!-- DOM approximation fallback (only when every WASM init attempt fails) -->
  <div v-if="!assReady && active" class="subtitle-overlay" :style="containerStyle">
    <div class="subtitle-text" :style="textStyle">
      <div class="line-stack">
        <!-- stroke layer: whole line dilated behind every fill, like libass -->
        <div v-if="strokeStyle" class="stroke-layer" aria-hidden="true" :style="strokeStyle">
          <template v-for="(w, i) in words" :key="`s${i}`">
            <span v-if="w.visible && w.revealedChars !== undefined" class="w"
              >{{ typedPart(w) }}<span class="untyped">{{ untypedPart(w) }}</span></span
            ><span v-else-if="w.visible" class="w" :style="strokeWordStyle(w)">{{
              w.text
            }}</span
            >{{ ' ' }}
          </template>
        </div>
        <div class="fill-layer">
          <template v-for="(w, i) in words" :key="i">
            <span
              v-if="w.visible && w.fillProgress !== undefined"
              class="w fill-w"
              ><span
                class="fill-top"
                aria-hidden="true"
                :style="{
                  width: `${w.fillProgress * 100}%`,
                  color: activeColor ?? 'inherit',
                }"
                >{{ w.text }}</span
              >{{ w.text }}</span
            ><span v-else-if="w.visible && w.revealedChars !== undefined" class="w"
              >{{ typedPart(w) }}<span class="untyped">{{ untypedPart(w) }}</span></span
            ><span v-else-if="w.visible" class="w" :style="wordStyle(w)">{{
              w.text
            }}</span
            >{{ ' ' }}
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subtitle-overlay {
  z-index: 998;
}
.ass-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ass-host {
  position: absolute;
  inset: 0;
}
/* the canvas is inserted dynamically, so scoped selectors need :deep() */
.ass-host :deep(canvas) {
  width: 100%;
  height: 100%;
  display: block;
}
/* Warning chip: lives inside the scale()d stage frame, so it divides the
   stage scale back out (--stage-scale set by StageView) to keep a constant
   on-screen size at any zoom. */
.ass-warning {
  position: absolute;
  left: 50%;
  top: calc(10px / var(--stage-scale, 1));
  transform: translateX(-50%) scale(calc(1 / var(--stage-scale, 1)));
  transform-origin: top center;
  z-index: 1200;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(560px, calc(92% * var(--stage-scale, 1)));
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(15, 17, 22, 0.92);
  border: 1px solid rgba(251, 191, 36, 0.45);
  color: #e6e8ee;
  font-size: 12.5px;
  line-height: 1.35;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.warn-icon {
  color: #fbbf24;
  flex: 0 0 auto;
}
.warn-text {
  min-width: 0;
}
.warn-retry {
  flex: 0 0 auto;
  border: 1px solid var(--accent, #6366f1);
  background: transparent;
  color: var(--accent, #a5b4fc);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.warn-retry:hover {
  background: rgba(99, 102, 241, 0.15);
}
.warn-close {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: #9aa1ad;
  font-size: 15px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
}
.warn-close:hover {
  color: #e6e8ee;
}
.subtitle-text {
  max-width: 100%;
}
.line-stack {
  position: relative;
}
.stroke-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fill-layer {
  position: relative;
}
.w {
  transition: color 0.05s linear;
}
.fill-w {
  position: relative;
}
.fill-top {
  position: absolute;
  left: 0;
  top: 0;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
}
/* typewriter: untyped characters keep their space (matches ASS \k reveal) */
.untyped {
  visibility: hidden;
}
</style>
