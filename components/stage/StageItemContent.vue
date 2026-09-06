<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { resolveVisualTiming } from '~/utils/itemGeometry'
import { filterToCss, tintOverlayColor } from '~/utils/cssFilter'
import { hasMediaFilter } from '~/utils/ffmpegFilterGraph'
import { useEditorStore } from '~/stores/editor'
import { useProjectStore } from '~/stores/project'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { useMeasuredDims } from '~/composables/useMeasuredDims'
import { extractFontFamilies, loadGoogleFonts } from '~/utils/fonts'
import {
  applyFitFactor,
  applyRendererWhiteSpace,
  fitActiveFor,
  fitBoxOf,
  measureFitFactor,
} from '~/utils/fitTextToBox'
import {
  buildIframeDoc,
  styleObjectToCss,
  escapeHtml,
  isAutoHugText,
} from '~/utils/textTemplate'
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
  /** radius is clipped by the item wrapper instead (zoom parity) */
  suppressRadius?: boolean
}>()

const editor = useEditorStore()
const project = useProjectStore()
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

/* error overlay tracks the displayed element itself — the probe cache can
   fail (CORS metadata, codecs) while the element still plays fine */
const mediaFailed = ref(false)
/* skeleton placeholder until the element can render a frame — the playback
   clock holds for buffering media (usePlayback), so the stage must show
   "loading" rather than looking hung */
const mediaReady = ref(false)
watch(
  () => props.item.src,
  () => {
    mediaFailed.value = false
    mediaReady.value = false
  }
)

const cssFilter = computed(() =>
  filterToCss(props.item.filter, props.width, props.height)
)
const tint = computed(() => tintOverlayColor(props.item.filter))
const filteredMedia = computed(
  () =>
    ['VIDEO', 'IMAGE', 'GIF'].includes(type.value ?? '') &&
    hasMediaFilter(props.item.filter)
)
const proxyMedia = ref(false)
const mediaSrc = computed(() =>
  proxyMedia.value && props.item.src
    ? `/api/filter-media?src=${encodeURIComponent(props.item.src)}`
    : props.item.src
)
watch(
  () => props.item.src,
  () => {
    proxyMedia.value = false
  }
)
function onMediaError() {
  // A canvas needs CORS permission. Public hosts without CORS are retried
  // through a restricted same-origin media relay, without forwarding cookies.
  if (
    filteredMedia.value &&
    !proxyMedia.value &&
    /^https?:\/\//i.test(props.item.src ?? '')
  ) {
    proxyMedia.value = true
    mediaReady.value = false
    return
  }
  mediaFailed.value = true
}

const radiusStyle = computed(() => {
  const r = props.item.radius
  if (!r || props.suppressRadius) return undefined
  return `${r.tl ?? 0}px ${r.tr ?? 0}px ${r.br ?? 0}px ${r.bl ?? 0}px`
})

/* package parity for aspect-mismatched media: resize on an explicit box
   object-fits INTO the box (cover/contain); plain images are screenshot by
   the renderer with object-fit cover; videos/GIFs are scale-stretched.
   cropParams bypass this — the crop math below owns the geometry. */
const mediaFit = computed(() => {
  if (props.item.cropParams) return undefined
  const boxed =
    typeof props.item.width === 'number' &&
    typeof props.item.height === 'number'
  if (
    boxed &&
    (props.item.resize === 'cover' || props.item.resize === 'contain')
  )
    return props.item.resize
  if (type.value === 'IMAGE') return 'cover'
  return undefined /* .media default: fill */
})
const mediaFitStyle = computed(() =>
  mediaFit.value ? { objectFit: mediaFit.value } : undefined
)

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
const imgEl = ref<HTMLImageElement>()

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

/* offscreen videos hold at preload=metadata so they never contend with the
   media that must render right now; a 3s lookahead flips them to auto just
   before they enter (data is usually already in the HTTP cache thanks to
   MediaPreload, so the flip is a cheap cache read) */
const shouldBufferVideo = computed(
  () =>
    props.time >= timing.value.enterBegin - 3 && props.time <= timing.value.exitEnd
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
/* The renderer loads every family the element references — style.fontFamily
   plus every font-family declared in its inline html and its customCode css
   (first family of each stack, generics dropped, capped at 4). Loading only
   style.fontFamily left the rest in whatever fallback the container had. */
const textFontFamilies = computed(() =>
  extractFontFamilies({
    style: { ...(props.item.style ?? {}), fontFamily: fontFamily.value },
    html: props.item.html,
    css: props.item.customCode?.css,
  })
)
watch(
  textFontFamilies,
  (families) => {
    if (type.value === 'TEXT') loadGoogleFonts(families)
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

/* ---------------- fitToBox (plain DOM path) ----------------
   Mirrors package/src/lib/texts/fitTextToBox.ts: one factor in [0.5, 1] over
   font-size / line-height / letter-spacing / word-spacing, judged on painted
   ink. Factor 1 touches nothing, so an item that fits previews unchanged. */
const fitActive = computed(() => type.value === 'TEXT' && fitActiveFor(props.item))
const fitFactor = ref(1)

function runTextFit() {
  const el = textMeasureEl.value
  if (!el || type.value !== 'TEXT') return
  // restore first: a re-run must start from the author's typography, never
  // compound on top of the previous factor
  applyFitFactor(el, 1)
  fitFactor.value = 1
  if (!fitActive.value) return
  const factor = measureFitFactor((host) => {
    // measured on a transform-free copy — the stage's scale/rotation would
    // distort client rects (a rotated box reports its axis-aligned bounds)
    const clone = el.cloneNode(true) as HTMLElement
    host.appendChild(clone)
    // `.text-inner` paints with `white-space: pre-wrap`; the renderer's
    // container has no such rule, and pre-wrap keeps runs of whitespace at the
    // wrap point — measuring under it reads wider ink and picks a smaller
    // factor than the render. The clone measures under the renderer's value;
    // the painted element keeps pre-wrap.
    applyRendererWhiteSpace(clone, props.item)
    return clone
  }, fitBoxOf(props.item))
  fitFactor.value = factor
  if (factor < 1) applyFitFactor(el, factor)
}

/**
 * A fit-scaled size must never reach useMeasuredDims: it feeds effectiveLayout,
 * which feeds the item box. With both axes declared the measurement is unused
 * for layout anyway.
 */
function skipTextMeasure() {
  if (!fitActive.value) return false
  const box = fitBoxOf(props.item)
  if (box.width && box.height) return true
  return fitFactor.value < 1
}

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
        if (skipTextMeasure()) return
        // a v-show'd scene layer reports 0×0 (display:none) — writing that
        // would collapse the box of every visible instance sharing the cache
        // entry; the observer re-fires with real dims when the layer shows
        if (!el.offsetParent) return
        // offsetWidth/Height are unscaled layout px (stage scale is a transform)
        setMeasured(props.item._id, el.offsetWidth, el.offsetHeight)
      })
      ro.observe(el)
      if (!skipTextMeasure() && el.offsetParent)
        setMeasured(props.item._id, el.offsetWidth, el.offsetHeight)
    }
  },
  { immediate: true }
)

/* re-fit whenever the box, the copy or the typography changes — after the DOM
   patch, since v-html replaces the children the factor was applied to */
watch(
  () => [
    fitActive.value,
    props.item.width,
    props.item.height,
    textHtml.value,
    JSON.stringify(props.item.style ?? {}),
    textMeasureEl.value,
  ],
  () => runTextFit(),
  { flush: 'post' }
)

/* ---------------- in-place text editing ----------------
   The plain-DOM text div becomes a contenteditable while this item is the
   store's editingTextId. During the edit the v-html binding is frozen (Vue
   only rewrites innerHTML when the bound value changes — a rewrite would
   reset the caret), every input patches the doc without committing, and one
   history entry lands when editing ends. */
const isEditing = computed(
  () =>
    editor.editingTextId === props.item._id &&
    type.value === 'TEXT' &&
    !hasCustomCode.value
)

/** what the editable shows: the RAW doc content — with variables preview on,
 *  the stage otherwise displays resolved copies, and committing a resolved
 *  string back would destroy the {{placeholders}} */
const editFrozenHtml = ref('')
const editAsHtml = ref(false)
let editSnapshot: {
  text: string | null
  html: string | null
  /** declared height to drop on the first change (box re-hugs the copy) */
  height: number | null
} | null = null
let editHeightCleared = false

let ptoSupport: boolean | null = null
function plaintextOnlySupported(): boolean {
  if (ptoSupport === null) {
    const d = document.createElement('div')
    try {
      d.contentEditable = 'plaintext-only'
      ptoSupport = d.contentEditable === 'plaintext-only'
    } catch {
      ptoSupport = false
    }
  }
  return ptoSupport
}

const editableAttr = computed<boolean | 'plaintext-only'>(() => {
  if (!isEditing.value) return false
  if (editAsHtml.value) return true
  // plain text stays plain while typing; falls back to rich CE where
  // unsupported (innerText still reads back plain)
  return plaintextOnlySupported() ? 'plaintext-only' : true
})

function selectAllIn(el: HTMLElement) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  sel.removeAllRanges()
  sel.addRange(range)
}

function beginEdit() {
  const raw = project.visualById(props.item._id)
  if (!raw) {
    // display-only clones (iterate) have no doc entry to edit
    editor.stopTextEdit(props.item._id)
    return
  }
  editAsHtml.value = raw.html != null
  editSnapshot = {
    text: raw.text ?? null,
    html: raw.html ?? null,
    height:
      isAutoHugText(raw) && typeof raw.height === 'number' ? raw.height : null,
  }
  editHeightCleared = false
  editFrozenHtml.value = raw.html ?? escapeHtml(raw.text ?? '')
  nextTick(() => {
    const el = textMeasureEl.value
    if (!el || !isEditing.value) return
    el.focus()
    selectAllIn(el)
    const seed = editor.editingTextSeed
    if (seed) {
      // type-to-edit: the key that started the edit replaces the content
      editor.editingTextSeed = null
      try {
        document.execCommand('insertText', false, seed)
      } catch {
        el.textContent = seed
      }
      onEditInput()
    }
  })
}

/** one undo step per edit session — inputs patched without committing */
function finishEdit() {
  const snap = editSnapshot
  editSnapshot = null
  if (!snap) return
  const raw = project.visualById(props.item._id)
  if (!raw) return
  if ((raw.text ?? null) !== snap.text || (raw.html ?? null) !== snap.html) {
    project.commit()
  } else if (editHeightCleared && snap.height != null) {
    // typed and typed it back — restore the box so the session is a no-op
    project.patchVisual(props.item._id, { height: snap.height }, false)
  }
  editHeightCleared = false
}

watch(isEditing, (on) => (on ? beginEdit() : finishEdit()))

function onEditInput() {
  const el = textMeasureEl.value
  if (!el || !editSnapshot) return
  const patch: Record<string, any> = editAsHtml.value
    ? { html: el.innerHTML }
    : // the trailing \n is the CE's placeholder break, not typed content
      { text: el.innerText.replace(/\n$/, '') }
  if (editSnapshot.height != null && !editHeightCleared) {
    // first change drops the declared height: the box hugs the copy while
    // typing (measured dims take over) instead of overflowing a stale box
    patch.height = undefined
    editHeightCleared = true
  }
  project.patchVisual(props.item._id, patch, false)
}

function onEditBlur() {
  editor.stopTextEdit(props.item._id)
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).blur()
  }
}

onBeforeUnmount(() => {
  // item unmounting mid-edit (scene switch, undo) — land the pending commit
  if (isEditing.value) {
    finishEdit()
    editor.stopTextEdit(props.item._id)
  }
})

/* a font swapping in changes the glyph metrics the fit was measured against */
function onFontsLoaded() {
  runTextFit()
}
onMounted(() => {
  if (type.value === 'SVG') measureSvg()
  // cached media can be renderable before Vue attaches the event listeners
  if (videoEl.value && videoEl.value.readyState >= 2) mediaReady.value = true
  if (imgEl.value?.complete && imgEl.value.naturalWidth > 0) mediaReady.value = true
  runTextFit()
  try {
    document.fonts?.ready.then(onFontsLoaded).catch(() => {})
    document.fonts?.addEventListener?.('loadingdone', onFontsLoaded)
  } catch {
    /* no FontFaceSet — the fit just uses the metrics it has */
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  try {
    document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
  } catch {
    /* ignore */
  }
})

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
    // the iframe owns its document, so it fits itself (same routine)
    fitToBox: type.value === 'TEXT' && props.item.fitToBox === true,
  })
})
</script>

<template>
  <!-- VIDEO -->
  <div v-if="type === 'VIDEO'" class="media-box" :style="{ borderRadius: radiusStyle }">
    <video
      :key="`${filteredMedia}:${mediaSrc}`"
      ref="videoEl"
      class="media"
      :crossorigin="filteredMedia ? 'anonymous' : undefined"
      :src="mediaSrc"
      :class="{ 'filter-source': filteredMedia }"
      :style="cropInnerStyle ?? mediaFitStyle"
      :preload="shouldBufferVideo ? 'auto' : 'metadata'"
      playsinline
      @loadedmetadata="mediaFailed = false; syncVideo()"
      @loadeddata="mediaReady = true"
      @error="onMediaError"
    />
    <StageFilteredMedia
      v-if="filteredMedia && !mediaFailed"
      :media="videoEl"
      :filter="item.filter!"
      :width="width"
      :height="height"
      :fit="mediaFit"
      :crop="item.cropParams"
      :radius="suppressRadius ? undefined : item.radius"
      :time="time"
      :playing="editor.playing"
      :visible="isItemVisible"
    />
    <div v-if="!mediaReady && !mediaFailed" class="media-loading">
      <UiIcon name="video" :size="20" />
    </div>
    <div v-if="mediaFailed" class="media-error">
      <UiIcon name="warning" :size="18" />
      <span>video failed to load</span>
    </div>
  </div>

  <!-- IMAGE / GIF -->
  <div
    v-else-if="type === 'IMAGE' || type === 'GIF'"
    class="media-box"
    :style="{ borderRadius: radiusStyle }"
  >
    <img
      :key="`${filteredMedia}:${mediaSrc}`"
      ref="imgEl"
      class="media"
      :crossorigin="filteredMedia ? 'anonymous' : undefined"
      :src="mediaSrc"
      :class="{ 'filter-source': filteredMedia }"
      :style="cropInnerStyle ?? mediaFitStyle"
      :fetchpriority="isItemVisible ? 'high' : 'low'"
      draggable="false"
      @load="mediaFailed = false; mediaReady = true"
      @error="onMediaError"
    />
    <StageFilteredMedia
      v-if="filteredMedia && !mediaFailed"
      :media="imgEl"
      :filter="item.filter!"
      :width="width"
      :height="height"
      :fit="mediaFit"
      :crop="item.cropParams"
      :radius="suppressRadius ? undefined : item.radius"
      :time="time"
      :playing="editor.playing"
      :visible="isItemVisible"
      :animated="type === 'GIF'"
    />
    <div v-if="!mediaReady && !mediaFailed" class="media-loading">
      <UiIcon name="image" :size="20" />
    </div>
    <div v-if="mediaFailed" class="media-error">
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
      :fit-to-box="item.fitToBox === true"
    />
    <div
      v-else
      ref="textMeasureEl"
      class="text-inner"
      :class="{ editing: isEditing }"
      :style="textInnerStyle"
      :contenteditable="editableAttr"
      spellcheck="false"
      @input="onEditInput"
      @blur="onEditBlur"
      @keydown="onEditKeydown"
      v-html="isEditing ? editFrozenHtml : textHtml"
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
  object-fit: fill; /* videos/GIFs are scale-stretched by the package;
                       images and boxed resize override via mediaFitStyle */
  display: block;
}
.tint {
  position: absolute;
  inset: 0;
  mix-blend-mode: multiply;
  pointer-events: none;
}
.filter-source {
  opacity: 0;
}
/* skeleton shown while the media element buffers — a placeholder, not a
   spinner: neutral panel + shimmer sweep + faint media-type icon */
.media-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-2);
  color: var(--text-3);
  overflow: hidden;
  pointer-events: none;
}
.media-loading::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 32%,
    color-mix(in srgb, var(--text-3) 14%, transparent) 50%,
    transparent 68%
  );
  transform: translateX(-100%);
  animation: media-shimmer 1.3s ease-in-out infinite;
}
@keyframes media-shimmer {
  to {
    transform: translateX(100%);
  }
}
.media-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
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
.text-inner.editing {
  cursor: text;
  user-select: text;
  outline: none;
  caret-color: currentColor;
  /* an emptied text still needs a visible caret slot */
  min-width: 4px;
  min-height: 1em;
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
  background: color-mix(in srgb, var(--red) 14%, transparent);
  border: 1px dashed var(--red);
  color: var(--red);
  font-size: 11px;
}
</style>
