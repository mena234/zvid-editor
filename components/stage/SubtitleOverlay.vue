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
/* faithful to the FFmpeg output. The DOM word-span approximation      */
/* below stays as a fallback when WASM/worker init fails.              */
/* ------------------------------------------------------------------ */

const canvasEl = ref<HTMLCanvasElement | null>(null)
const assReady = ref(false)
let jassub: any = null
let destroyed = false
let rebuildToken = 0
let assFailed = false
const loadedFontKeys = new Set<string>()

async function initAss(): Promise<boolean> {
  if (jassub) return true
  const canvas = canvasEl.value
  if (!canvas || typeof Worker === 'undefined' || assFailed) return false
  try {
    const { default: JASSUB } = await import('jassub')
    canvas.width = project.defaults.width
    canvas.height = project.defaults.height
    jassub = new JASSUB({
      // jassub ships its own newer lib.dom types; structurally identical
      canvas: canvas as any,
      subContent: '[Script Info]\nScriptType: v4.00+\n',
      // its bundled default.woff2 is missing from the dist — an empty map +
      // explicit defaultFont avoids a broken fetch; real families are always
      // added by ensureFonts before a track is set
      availableFonts: {},
      defaultFont: 'liberation sans',
    })
    await jassub.ready
    if (destroyed) return false
    assReady.value = true
    return true
  } catch (e) {
    console.warn('[subtitles] native ASS preview unavailable, using DOM fallback:', e)
    assFailed = true
    assReady.value = false
    jassub = null
    return false
  }
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
  if (assFailed || destroyed || token !== rebuildToken) return
  if (!(await initAss())) return
  const sub = subtitle.value
  const st = sub?.styles ?? {}
  if (!sub?.captions?.length) {
    await jassub.renderer.setTrack('[Script Info]\nScriptType: v4.00+\n')
    renderFrame(true)
    return
  }
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
    assFailed = true
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
  try {
    jassub?.destroy()
  } catch {}
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
  <!-- native ASS canvas: rasterized by libass (jassub), identical to renders -->
  <div v-show="assReady && hasCaptions" class="subtitle-overlay ass-layer">
    <canvas ref="canvasEl" class="ass-canvas"></canvas>
  </div>

  <!-- DOM approximation fallback (only when WASM init fails) -->
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
.ass-canvas {
  width: 100%;
  height: 100%;
  display: block;
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
