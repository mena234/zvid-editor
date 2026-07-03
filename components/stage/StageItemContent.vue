<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { resolveVisualTiming } from '~/utils/itemGeometry'
import { filterToCss, tintOverlayColor } from '~/utils/cssFilter'
import { useEditorStore } from '~/stores/editor'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { useMeasuredDims } from '~/composables/useMeasuredDims'
import { loadGoogleFont } from '~/utils/fonts'
import { buildIframeDoc, styleObjectToCss, escapeHtml } from '~/utils/textTemplate'
import {
  TEXT_DEFAULT_FONT_FAMILY,
  TEXT_DEFAULT_FONT_SIZE,
} from '~/shared/schema/constants'
import { clamp } from '~/utils/time'

const props = defineProps<{
  item: VisualDoc
  time: number
  contextDuration: number
  width: number
  height: number
}>()

const editor = useEditorStore()
const { probe, intrinsicOf } = useMediaProbe()
const { setMeasured } = useMeasuredDims()

const type = computed(() => canonicalVisualType(props.item.type))
const timing = computed(() => resolveVisualTiming(props.item, props.contextDuration))

/* ---------------- media (video/image/gif) ---------------- */
const probeEntry = computed(() => {
  if (type.value === 'VIDEO') return props.item.src ? probe('video', props.item.src) : null
  if (type.value === 'IMAGE' || type.value === 'GIF')
    return props.item.src ? probe('image', props.item.src) : null
  return null
})

const cssFilter = computed(() =>
  filterToCss(props.item.filter, props.width, props.height)
)
const tint = computed(() => tintOverlayColor(props.item.filter))

const radiusStyle = computed(() => {
  const r = props.item.radius
  if (!r) return undefined
  return `${r.tl ?? 0}px ${r.tr ?? 0}px ${r.br ?? 0}px ${r.bl ?? 0}px`
})

/** crop math: map cropParams source rect onto the item box */
const cropInnerStyle = computed(() => {
  const crop = props.item.cropParams
  if (!crop) return null
  const natural =
    type.value === 'VIDEO'
      ? intrinsicOf('video', props.item.src)
      : intrinsicOf('image', props.item.src)
  if (!natural) return null
  const sx = props.width / crop.width
  const sy = props.height / crop.height
  return {
    position: 'absolute' as const,
    left: `${-crop.x * sx}px`,
    top: `${-crop.y * sy}px`,
    width: `${natural.width * sx}px`,
    height: `${natural.height * sy}px`,
    maxWidth: 'none',
  }
})

/* ---------------- video playback sync ---------------- */
const videoEl = ref<HTMLVideoElement>()

const targetMediaTime = computed(() => {
  if (type.value !== 'VIDEO') return 0
  const vb = props.item.videoBegin ?? 0
  const ve = props.item.videoEnd ?? Infinity
  const speed = props.item.speed ?? 1
  const t = vb + Math.max(0, props.time - timing.value.enterBegin) * speed
  return clamp(t, vb, ve === Infinity ? t : ve)
})

const isItemVisible = computed(
  () => props.time >= timing.value.enterBegin && props.time <= timing.value.exitEnd
)

function syncVideo() {
  const v = videoEl.value
  if (!v || type.value !== 'VIDEO') return
  const shouldPlay = editor.playing && isItemVisible.value
  v.playbackRate = clamp((props.item.speed ?? 1) * editor.playbackRate, 0.07, 16)
  const vol = clamp(props.item.volume ?? 1, 0, 1)
  v.volume = vol
  v.muted = editor.muted || vol === 0

  if (shouldPlay) {
    if (Math.abs(v.currentTime - targetMediaTime.value) > 0.25) {
      v.currentTime = targetMediaTime.value
    }
    if (v.paused) v.play().catch(() => {})
  } else {
    if (!v.paused) v.pause()
    if (Math.abs(v.currentTime - targetMediaTime.value) > 0.04) {
      v.currentTime = targetMediaTime.value
    }
  }
}

watch([() => props.time, () => editor.playing, () => editor.muted, isItemVisible], () =>
  syncVideo()
)
watch(
  () => [props.item.volume, props.item.speed],
  () => syncVideo()
)

/* ---------------- TEXT ---------------- */
const fontFamily = computed(
  () => props.item.style?.fontFamily ?? TEXT_DEFAULT_FONT_FAMILY
)
watch(
  fontFamily,
  (f) => {
    if (type.value === 'TEXT') loadGoogleFont(f)
  },
  { immediate: true }
)

const textInnerStyle = computed(() => {
  const style = { ...(props.item.style ?? {}) }
  const css: Record<string, string> = {}
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === null || k === 'fontFamily') continue
    css[k] = String(v)
  }
  css.fontFamily = `'${fontFamily.value}', sans-serif`
  if (!css.fontSize) css.fontSize = TEXT_DEFAULT_FONT_SIZE
  if (props.item.width !== undefined) {
    css.width = `${props.item.width}px`
  } else {
    css.width = 'max-content'
    css.maxWidth = 'none'
  }
  if (props.item.height !== undefined) css.height = `${props.item.height}px`
  return css
})

const textHtml = computed(() => {
  if (props.item.html) return props.item.html
  return escapeHtml(props.item.text ?? '')
})

/* measurement for auto-sized TEXT (plain DOM path) */
const textMeasureEl = ref<HTMLElement>()
let ro: ResizeObserver | null = null
watch(
  textMeasureEl,
  (el) => {
    ro?.disconnect()
    ro = null
    if (el && type.value === 'TEXT') {
      ro = new ResizeObserver(() => {
        // offsetWidth/Height are unscaled layout px (stage scale is a transform)
        setMeasured(props.item._id, el.offsetWidth, el.offsetHeight)
      })
      ro.observe(el)
      setMeasured(props.item._id, el.offsetWidth, el.offsetHeight)
    }
  },
  { immediate: true }
)
onMounted(() => {
  if (type.value === 'SVG') measureSvg()
})
onBeforeUnmount(() => ro?.disconnect())

/* ---------------- SVG ---------------- */
const svgMarkup = computed(() => props.item.svg ?? '')

function measureSvg() {
  if (props.item.width !== undefined && props.item.height !== undefined) return
  try {
    const doc = new DOMParser().parseFromString(svgMarkup.value, 'image/svg+xml')
    const svg = doc.documentElement
    if (svg.tagName.toLowerCase() !== 'svg') return
    let w = parseFloat(svg.getAttribute('width') ?? '')
    let h = parseFloat(svg.getAttribute('height') ?? '')
    if (!w || !h) {
      const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        w = w || vb[2]
        h = h || vb[3]
      }
    }
    if (w && h) setMeasured(props.item._id, w, h)
  } catch {
    /* invalid svg — ignore */
  }
}
watch(svgMarkup, () => {
  if (type.value === 'SVG') measureSvg()
})

/* ---------------- customCode rendering ----------------
   CSS-only code runs live in a Shadow DOM (document fonts, exact metrics);
   JS code needs script execution → sandboxed iframe. */
const hasCustomCode = computed(
  () =>
    (type.value === 'TEXT' || type.value === 'SVG') &&
    !!(props.item.customCode?.css || props.item.customCode?.js)
)
const needsIframe = computed(() => hasCustomCode.value && !!props.item.customCode?.js)
const cssOnlyCode = computed(() => hasCustomCode.value && !needsIframe.value)

const iframeDoc = computed(() => {
  if (!hasCustomCode.value) return ''
  return buildIframeDoc({
    html: type.value === 'TEXT' ? (props.item.html ?? undefined) : undefined,
    text: type.value === 'TEXT' ? (props.item.text ?? undefined) : undefined,
    svg: type.value === 'SVG' ? svgMarkup.value : undefined,
    style: props.item.style,
    customCss: props.item.customCode?.css,
    customJs: props.item.customCode?.js,
    width: props.item.width,
    height: props.item.height,
  })
})
</script>

<template>
  <!-- VIDEO -->
  <div
    v-if="type === 'VIDEO'"
    class="media-box"
    :style="{ filter: cssFilter || undefined, borderRadius: radiusStyle }"
  >
    <video
      ref="videoEl"
      class="media"
      :src="item.src"
      :style="cropInnerStyle ?? undefined"
      preload="auto"
      playsinline
      crossorigin="anonymous"
      @loadedmetadata="syncVideo"
    />
    <div v-if="tint" class="tint" :style="{ background: tint }" />
    <div v-if="probeEntry?.status === 'error'" class="media-error">
      <UiIcon name="warning" :size="18" />
      <span>video failed to load</span>
    </div>
  </div>

  <!-- IMAGE / GIF -->
  <div
    v-else-if="type === 'IMAGE' || type === 'GIF'"
    class="media-box"
    :style="{ filter: cssFilter || undefined, borderRadius: radiusStyle }"
  >
    <img class="media" :src="item.src" :style="cropInnerStyle ?? undefined" draggable="false" />
    <div v-if="tint" class="tint" :style="{ background: tint }" />
    <div v-if="probeEntry?.status === 'error'" class="media-error">
      <UiIcon name="warning" :size="18" />
      <span>image failed to load</span>
    </div>
  </div>

  <!-- TEXT -->
  <div v-else-if="type === 'TEXT'" class="text-box">
    <iframe
      v-if="needsIframe"
      class="code-frame"
      :srcdoc="iframeDoc"
      sandbox="allow-scripts"
      scrolling="no"
      title="animated element preview"
    />
    <StageShadowContent
      v-else-if="cssOnlyCode"
      :item-id="item._id"
      :html="textHtml"
      :style-object="item.style"
      :custom-css="item.customCode?.css"
      :explicit-width="item.width"
      :explicit-height="item.height"
    />
    <div
      v-else
      ref="textMeasureEl"
      class="text-inner"
      :style="textInnerStyle"
      v-html="textHtml"
    />
    <!-- shadow-DOM measurer for the iframe path -->
    <StageMeasureGhost
      v-if="needsIframe"
      :item-id="item._id"
      :html="textHtml"
      :style-object="item.style"
      :custom-css="item.customCode?.css"
      :explicit-width="item.width"
      :explicit-height="item.height"
    />
  </div>

  <!-- SVG -->
  <div
    v-else-if="type === 'SVG'"
    class="svg-box"
    :style="{ filter: cssFilter || undefined }"
  >
    <iframe
      v-if="needsIframe"
      class="code-frame"
      :srcdoc="iframeDoc"
      sandbox="allow-scripts"
      scrolling="no"
      title="animated svg preview"
    />
    <StageShadowContent
      v-else-if="cssOnlyCode"
      :item-id="item._id"
      :svg="svgMarkup"
      :style-object="item.style"
      :custom-css="item.customCode?.css"
      :explicit-width="item.width ?? Math.round(width)"
      :explicit-height="item.height ?? Math.round(height)"
    />
    <div v-else class="svg-inner" v-html="svgMarkup" />
    <div v-if="tint" class="tint" :style="{ background: tint }" />
  </div>

  <div v-else class="unknown-box">
    <UiIcon name="warning" :size="16" />
    {{ item.type }}
  </div>
</template>

<style scoped>
.media-box {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.media {
  width: 100%;
  height: 100%;
  object-fit: fill; /* package scales input to exactly w×h */
  display: block;
}
.tint {
  position: absolute;
  inset: 0;
  mix-blend-mode: multiply;
  pointer-events: none;
}
.media-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(20, 24, 33, 0.85);
  color: var(--red);
  font-size: 12px;
  border: 1px dashed var(--red);
}
.text-box {
  position: relative;
  width: 100%;
  height: 100%;
}
.text-inner {
  position: absolute;
  top: 0;
  left: 0;
  white-space: pre-wrap;
}
.text-inner.ghost {
  visibility: hidden;
  pointer-events: none;
}
.svg-box {
  position: relative;
  width: 100%;
  height: 100%;
}
.svg-inner {
  width: 100%;
  height: 100%;
}
.svg-inner :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
.code-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  pointer-events: none;
  overflow: hidden;
}
.unknown-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  background: rgba(244, 98, 110, 0.15);
  border: 1px dashed var(--red);
  color: var(--red);
  font-size: 11px;
}
</style>
