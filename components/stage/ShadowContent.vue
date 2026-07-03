<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMeasuredDims } from '~/composables/useMeasuredDims'
import { styleObjectToCss } from '~/utils/textTemplate'
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
  svg?: string
  styleObject?: Record<string, any>
  customCss?: string
  explicitWidth?: number
  explicitHeight?: number
}>()

const host = ref<HTMLElement>()
const { setMeasured } = useMeasuredDims()
let ro: ResizeObserver | null = null

function build() {
  const el = host.value
  if (!el) return
  const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  const fontFamily = props.styleObject?.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY
  const style = { ...(props.styleObject ?? {}) }
  if (!style.fontSize && !props.svg) style.fontSize = TEXT_DEFAULT_FONT_SIZE

  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: content-box; background: transparent; }
      .container {
        font-family: '${fontFamily}', sans-serif;
        ${styleObjectToCss(style)}
        ${props.explicitWidth ? `width: ${props.explicitWidth}px;` : 'width: max-content;'}
        ${props.explicitHeight ? `height: ${props.explicitHeight}px;` : ''}
      }
      ${props.svg ? '.container svg { display: block; width: 100%; height: 100%; }' : ''}
      ${props.customCss ?? ''}
    </style>
    <div class="container">${props.svg ?? props.html ?? ''}</div>
  `
  ro?.disconnect()
  const container = shadow.querySelector('.container') as HTMLElement | null
  if (container && !props.svg) {
    ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect()
      const w = container.offsetWidth || r.width
      const h = container.offsetHeight || r.height
      if (w > 0 || h > 0) setMeasured(props.itemId, Math.ceil(w), Math.ceil(h))
    })
    ro.observe(container)
    const w = container.offsetWidth
    const h = container.offsetHeight
    if (w > 0 || h > 0) setMeasured(props.itemId, Math.ceil(w), Math.ceil(h))
  }
}

onMounted(build)
watch(
  () => [
    props.html,
    props.svg,
    props.customCss,
    JSON.stringify(props.styleObject ?? {}),
    props.explicitWidth,
    props.explicitHeight,
  ],
  build
)
onBeforeUnmount(() => ro?.disconnect())
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
