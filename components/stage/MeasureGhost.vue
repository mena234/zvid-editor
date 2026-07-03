<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMeasuredDims } from '~/composables/useMeasuredDims'
import { styleObjectToCss } from '~/utils/textTemplate'
import {
  TEXT_DEFAULT_FONT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
} from '~/shared/schema/constants'

/**
 * Invisible Shadow-DOM measurer for auto-sized TEXT items whose visible
 * rendering happens in a sandboxed iframe (customCode). The shadow root
 * isolates the item's custom CSS from the app while measuring the same
 * container the package's capture page uses.
 */
const props = defineProps<{
  itemId: string
  html: string
  /** item style object ("style" itself is a reserved attr name in Vue) */
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
  if (!style.fontSize) style.fontSize = TEXT_DEFAULT_FONT_SIZE
  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: content-box; }
      .container {
        font-family: '${fontFamily}', sans-serif;
        ${styleObjectToCss(style)}
        ${props.explicitWidth ? `width: ${props.explicitWidth}px;` : 'width: max-content;'}
        ${props.explicitHeight ? `height: ${props.explicitHeight}px;` : ''}
        position: absolute;
      }
      ${props.customCss ?? ''}
    </style>
    <div class="container">${props.html}</div>
  `
  ro?.disconnect()
  const container = shadow.querySelector('.container') as HTMLElement | null
  if (container) {
    ro = new ResizeObserver(() => {
      const r = container.getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        setMeasured(props.itemId, Math.ceil(r.width), Math.ceil(r.height))
      }
    })
    ro.observe(container)
    // immediate measure (fonts may still swap in later; RO catches that too)
    const r = container.getBoundingClientRect()
    if (r.width > 0 || r.height > 0)
      setMeasured(props.itemId, Math.ceil(r.width), Math.ceil(r.height))
  }
}

onMounted(build)
watch(
  () => [
    props.html,
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
  <div ref="host" class="measure-ghost" aria-hidden="true" />
</template>

<style scoped>
.measure-ghost {
  position: absolute;
  top: 0;
  left: 0;
  /* generous room so fit-content resolves to one-line max-content,
     like the package's capture page */
  width: 6000px;
  height: 4000px;
  visibility: hidden;
  overflow: hidden;
  pointer-events: none;
}
</style>
