<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMeasuredDims } from '~/composables/useMeasuredDims'
import { styleObjectToCss } from '~/utils/textTemplate'
import { textFontStack, fontSample, textFontCss, textFontHtml } from '~/shared/textFontPolicy'
import {
  applyFitFactor,
  measureFitFactor,
  RENDERER_WHITE_SPACE,
} from '~/utils/fitTextToBox'
import {
  TEXT_DEFAULT_FONT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
} from '~/shared/schema/constants'

/**
 * Live Shadow-DOM renderer for customCode items that only use CSS (no JS):
 * CSS keyframe animations run in isolation with the document's fonts —
 * higher fidelity than the sandboxed iframe, which we reserve for JS code.
 * Doubles as the measurer for auto-sized items.
 */
const props = defineProps<{
  itemId: string
  html?: string
  /** Escaped plain text retains authored newlines; HTML keeps CSS defaults. */
  plainText?: boolean
  svg?: string
  styleObject?: Record<string, any>
  customCss?: string
  explicitWidth?: number
  explicitHeight?: number
  /** TEXT `fitToBox` — shrink typography until the ink fits the declared box */
  fitToBox?: boolean
}>()

const host = ref<HTMLElement>()
const { setMeasured } = useMeasuredDims()
let ro: ResizeObserver | null = null
/** markup of the current shadow tree, re-measured when fonts swap in */
let markup = ''
let fitFactor = 1

const fitBox = () => ({
  width: props.explicitWidth && props.explicitWidth > 0 ? props.explicitWidth : null,
  height:
    props.explicitHeight && props.explicitHeight > 0 ? props.explicitHeight : null,
})
const fitActive = () =>
  !props.svg && props.fitToBox === true && !!(fitBox().width || fitBox().height)

/**
 * A fit-scaled size must never reach useMeasuredDims (it feeds the item box,
 * which feeds the fit). With both axes declared it is unused for layout anyway.
 */
function skipMeasure() {
  if (!fitActive()) return false
  const box = fitBox()
  if (box.width && box.height) return true
  return fitFactor < 1
}

/** Same routine as the renderer, measured on a transform-free shadow copy. */
function runFit(container: HTMLElement) {
  applyFitFactor(container, 1)
  fitFactor = 1
  if (!fitActive()) return
  const html = markup
  const factor = measureFitFactor((probeHost) => {
    const probe = document.createElement('div')
    probeHost.appendChild(probe)
    // `white-space` is inherited across the shadow boundary, and the renderer's
    // container inherits `normal` from the capture page's body. Pin the host so
    // no stage-level `pre-wrap` can widen the measured ink; declarations inside
    // the shadow tree (styleObject, customCss) still win, exactly as they do in
    // the renderer's own `.container` rule.
    probe.style.setProperty('white-space', RENDERER_WHITE_SPACE)
    const root = probe.attachShadow({ mode: 'open' })
    root.innerHTML = html
    return root.querySelector('.container') as HTMLElement | null
  }, fitBox())
  fitFactor = factor
  if (factor < 1) applyFitFactor(container, factor)
}

function build() {
  const el = host.value
  if (!el) return
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  const fontFamily = props.styleObject?.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY
  const style = { ...(props.styleObject ?? {}) }
  if (!style.fontSize && !props.svg) style.fontSize = TEXT_DEFAULT_FONT_SIZE

  markup = `
    <style>
      * { margin: 0; padding: 0; box-sizing: content-box; background: transparent; }
      .container {
        ${props.plainText ? 'white-space: pre-wrap;' : ''}
        font-family: ${textFontStack(fontFamily, fontSample(undefined, props.html))};
        ${styleObjectToCss(style)}
        ${props.explicitWidth ? `width: ${props.explicitWidth}px;` : 'width: max-content;'}
        ${props.explicitHeight ? `height: ${props.explicitHeight}px;` : ''}
      }
      ${props.svg ? '.container svg { display: block; width: 100%; height: 100%; }' : ''}
      ${props.svg ? props.customCss ?? '' : textFontCss(props.customCss ?? '', fontSample(undefined, props.html))}
    </style>
    <div class="container" dir="auto">${props.svg ?? textFontHtml(props.html ?? '')}</div>
  `
  shadow.innerHTML = markup
  ro?.disconnect()
  const container = shadow.querySelector('.container') as HTMLElement | null
  if (container) runFit(container)
  if (container && !props.svg) {
    ro = new ResizeObserver(() => {
      if (skipMeasure()) return
      const r = container.getBoundingClientRect()
      const w = container.offsetWidth || r.width
      const h = container.offsetHeight || r.height
      if (w > 0 || h > 0) setMeasured(props.itemId, Math.ceil(w), Math.ceil(h))
    })
    ro.observe(container)
    const w = container.offsetWidth
    const h = container.offsetHeight
    if (!skipMeasure() && (w > 0 || h > 0))
      setMeasured(props.itemId, Math.ceil(w), Math.ceil(h))
  }
}

/** a font swapping in changes the glyph metrics the fit was measured against */
function refit() {
  const container = host.value?.shadowRoot?.querySelector(
    '.container'
  ) as HTMLElement | null
  if (container) runFit(container)
}

onMounted(() => {
  build()
  try {
    document.fonts?.ready.then(refit).catch(() => {})
    document.fonts?.addEventListener?.('loadingdone', refit)
  } catch {
    /* no FontFaceSet — the fit just uses the metrics it has */
  }
})
watch(
  () => [
    props.html,
    props.plainText,
    props.svg,
    props.customCss,
    JSON.stringify(props.styleObject ?? {}),
    props.explicitWidth,
    props.explicitHeight,
    props.fitToBox,
  ],
  build
)
onBeforeUnmount(() => {
  ro?.disconnect()
  try {
    document.fonts?.removeEventListener?.('loadingdone', refit)
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div ref="host" class="shadow-content" />
</template>

<style scoped>
.shadow-content {
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>
