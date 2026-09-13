<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { effectiveLayout } from '~/utils/itemGeometry'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { mediaCropSizeLimits, mediaResizeSourceRect, resizeMediaBox, resizeMediaCrop, type MediaSourceRect, type ResizeHandle } from '~/utils/mediaResize'
import { topLeftToAnchor } from '~/shared/schema/defaults'
import { useProjectStore } from '~/stores/project'
import { isAutoHugText } from '~/utils/textTemplate'
import { TEXT_DEFAULT_FONT_SIZE } from '~/shared/schema/constants'
import { round3 } from '~/utils/time'

const props = defineProps<{ item: VisualDoc; primary: boolean }>()
const project = useProjectStore()
const stageCtx = inject<any>('stageCtx')
const { intrinsicOf } = useMediaProbe()

/** Text boxes hug their wrapped copy: sides re-wrap, corners scale the type. */
const hugText = computed(() => isAutoHugText(props.item))

const layout = computed(() =>
  effectiveLayout(props.item, stageCtx.projW, stageCtx.projH)
)

const hs = computed(() => Math.max(6, 9 / stageCtx.scale)) // handle size in stage px

const boxStyle = computed(() => ({
  left: `${layout.value.left}px`,
  top: `${layout.value.top}px`,
  width: `${layout.value.width}px`,
  height: `${layout.value.height}px`,
  transform: props.item.angle ? `rotate(${props.item.angle}deg)` : undefined,
  '--hs': `${hs.value}px`,
  '--edge-length': `${20 / stageCtx.scale}px`,
  '--edge-thickness': `${4 / stageCtx.scale}px`,
  '--bw': `${Math.max(1, 1.4 / stageCtx.scale)}px`,
}))

const HANDLES = [
  { dir: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { dir: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { dir: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { dir: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { dir: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { dir: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { dir: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { dir: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
] as const

/* ---------------- resize ---------------- */
const TYPE_SCALE_KEYS = ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing']

let resizeStart: {
  dir: ResizeHandle
  px: number
  py: number
  left: number
  top: number
  w: number
  h: number
  anchor: any
  media: boolean
  angle: number
  resize: VisualDoc['resize']
  crop: VisualDoc['cropParams']
  source: { width: number; height: number } | null
  sourceCrop: MediaSourceRect | null
  resolvedCrop: VisualDoc['cropParams']
  flipH: boolean
  flipV: boolean
  contain: boolean
  minSize: number
  maxSize: number
  changed: boolean
  hug: boolean
  /** RAW doc style at drag start (corner scale must never compound or bake
   *  resolved {{placeholders}} back into the doc); null = don't scale type */
  scaleStyle: Record<string, any> | null
  fontPx: number
} | null = null

function onHandleDown(e: PointerEvent, dir: ResizeHandle) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const L = layout.value
  const type = canonicalVisualType(props.item.type)
  const media = type === 'IMAGE' || type === 'VIDEO' || type === 'GIF'
  // Selection receives the resolved preview; retain any authored crop
  // placeholders rather than writing their preview values back to the doc.
  const crop = project.visualById(props.item._id)?.cropParams
  let source: { width: number; height: number } | null = null
  let sourceCrop: MediaSourceRect | null = null
  // An explicitly letterboxed item retains that fit while its frame changes.
  // Switching it to a filled crop would abruptly zoom on the first movement.
  const contain = props.item.resize === 'contain' && !crop
  let minSize = 8
  let maxSize = Infinity
  if (media && dir.length === 1 && !contain) {
    const resolvedCrop = props.item.cropParams
    // With variable preview disabled (or a missing variable), crop fields can
    // still be placeholders. Never turn an unresolved crop into NaN geometry.
    if (resolvedCrop && (
      !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(resolvedCrop[key])) ||
      resolvedCrop.width <= 0 || resolvedCrop.height <= 0
    )) return
    const natural = props.item.src && intrinsicOf(type === 'VIDEO' ? 'video' : 'image', props.item.src)
    // Do not invent source dimensions or commit a wrong crop while metadata
    // is loading. The handles work once the displayed media has resolved.
    if (!natural) return
    source = natural
    sourceCrop = mediaResizeSourceRect(natural, L, resolvedCrop)
    const limits = mediaCropSizeLimits(natural, L, sourceCrop, dir, type === 'IMAGE' ? 1 : 2)
    minSize = limits.minSize
    maxSize = limits.maxSize
  }
  const hug = hugText.value
  let scaleStyle: Record<string, any> | null = null
  let fontPx = parseFloat(TEXT_DEFAULT_FONT_SIZE)
  if (hug && dir.length === 2) {
    const raw = project.visualById(props.item._id)
    const style = { ...(raw?.style ?? {}) }
    // a {{var}} in a scalable key would be replaced by a baked number — skip
    const templated = TYPE_SCALE_KEYS.some(
      (k) => typeof style[k] === 'string' && style[k].includes('{{')
    )
    if (raw && !templated) {
      scaleStyle = style
      const declared = parseFloat(String(style.fontSize ?? ''))
      if (isFinite(declared) && declared > 0) fontPx = declared
    }
  }
  resizeStart = {
    dir,
    px: e.clientX,
    py: e.clientY,
    left: L.left,
    top: L.top,
    w: L.width,
    h: L.height,
    anchor: L.anchor,
    media,
    angle: typeof props.item.angle === 'number' ? props.item.angle : 0,
    resize: props.item.resize,
    crop,
    source,
    sourceCrop,
    resolvedCrop: props.item.cropParams,
    flipH: !!props.item.flipH,
    flipV: !!props.item.flipV,
    contain,
    minSize,
    maxSize,
    changed: false,
    hug,
    scaleStyle,
    fontPx,
  }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp)
  window.addEventListener('pointercancel', onResizeUp)
  window.addEventListener('blur', onResizeUp)
}

/** Scale the px-valued typography of a style snapshot by one factor (unitless
 *  line-height and em spacings follow the font size on their own). */
function scaleTypography(style: Record<string, any>, factor: number) {
  const next = { ...style }
  for (const key of TYPE_SCALE_KEYS) {
    const raw = next[key]
    if (raw == null) {
      if (key === 'fontSize')
        next[key] = `${round3(parseFloat(TEXT_DEFAULT_FONT_SIZE) * factor)}px`
      continue
    }
    const m = String(raw).match(/^(-?\d*\.?\d+)px$/)
    if (m) next[key] = `${round3(parseFloat(m[1]) * factor)}px`
  }
  return next
}

function onResizeMove(e: PointerEvent) {
  const s = resizeStart
  if (!s) return
  const dx = (e.clientX - s.px) / stageCtx.scale
  const dy = (e.clientY - s.py) / stageCtx.scale

  // A click on a handle must not turn fitted media into a manual crop.
  if (!s.changed && Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return

  if (s.media) {
    const box = resizeMediaBox(
      { left: s.left, top: s.top, width: s.w, height: s.h, angle: s.angle },
      s.dir,
      dx,
      dy,
      s.minSize,
      s.maxSize
    )
    // Movement along an edge's tangent is not a resize either.
    if (!s.changed && Math.abs(box.width - s.w) < 0.001 && Math.abs(box.height - s.h) < 0.001) return
    const { x, y } = topLeftToAnchor(box.left, box.top, box.width, box.height, s.anchor)
    let cropParams = s.crop
    if (s.source && s.sourceCrop) {
      // Use the committed box dimensions so source and output retain exactly
      // the same aspect ratio in preview and the exported document.
      cropParams = resizeMediaCrop(
        s.source,
        { width: s.w, height: s.h },
        s.sourceCrop,
        { width: round3(box.width), height: round3(box.height) },
        s.dir,
        s.flipH,
        s.flipV
      )
      // A crop gesture authors the changed source coordinates; preserve any
      // untouched template fields instead of baking their preview values.
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (s.crop && s.resolvedCrop && Math.abs(cropParams[key] - s.resolvedCrop[key]) < 1e-9)
          cropParams[key] = s.crop[key]
      }
    }
    const patch: Record<string, any> = {
      x: round3(x),
      y: round3(y),
      width: round3(box.width),
      height: round3(box.height),
      anchor: s.anchor,
      resize: s.dir.length === 2 || s.contain ? s.resize : undefined,
      cropParams,
    }
    if (props.item.position && props.item.position !== 'custom') patch.position = 'custom'
    project.patchVisual(props.item._id, patch, false)
    s.changed = true
    return
  }

  let { left, top, w, h } = s
  const corner = s.dir.length === 2
  // text corners always scale proportionally (Canva-style); others on Shift
  const keepRatio = corner && (s.hug || e.shiftKey)
  const ratio = s.w / Math.max(1, s.h)

  if (s.dir.includes('e')) w = s.w + dx
  if (s.dir.includes('w')) w = s.w - dx
  if (s.dir.includes('s')) h = s.h + dy
  if (s.dir.includes('n')) h = s.h - dy

  if (keepRatio) {
    if (Math.abs(dx) > Math.abs(dy)) h = w / ratio
    else w = h * ratio
  }

  w = Math.max(8, w)
  h = Math.max(8, h)

  let factor = 1
  if (s.hug && corner) {
    // one factor drives width AND type, so the wrap points stay identical
    factor = Math.max(w / s.w, 4 / s.fontPx)
    w = s.w * factor
    h = s.h * factor
  }

  if (s.dir.includes('w')) left = s.left + (s.w - w)
  if (s.dir.includes('n')) top = s.top + (s.h - h)

  const { x, y } = topLeftToAnchor(left, top, w, h, s.anchor)
  const patch: Record<string, any> = {
    x: round3(x),
    y: round3(y),
    width: Math.round(w),
    height: Math.round(h),
    anchor: s.anchor,
    resize: undefined, // manual size overrides contain/cover
  }
  if (s.hug) {
    // n/s pins an explicit height (the drag counterpart of the inspector
    // Height field); every other handle re-wraps, so the measured height
    // takes over
    if (s.dir !== 'n' && s.dir !== 's') patch.height = undefined
    if (corner && s.scaleStyle) patch.style = scaleTypography(s.scaleStyle, factor)
  }
  if (props.item.position && props.item.position !== 'custom') patch.position = 'custom'
  project.patchVisual(props.item._id, patch, false)
  s.changed = true
}

function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
  window.removeEventListener('pointercancel', onResizeUp)
  window.removeEventListener('blur', onResizeUp)
  if (resizeStart?.changed) project.commit()
  resizeStart = null
}

/* ---------------- rotate ---------------- */
let rotateStart: { cx: number; cy: number } | null = null

function onRotateDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const el = (e.currentTarget as HTMLElement).closest('.sel-box') as HTMLElement
  const rect = el.getBoundingClientRect()
  rotateStart = { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  window.addEventListener('pointermove', onRotateMove)
  window.addEventListener('pointerup', onRotateUp)
  window.addEventListener('pointercancel', onRotateUp)
  window.addEventListener('blur', onRotateUp)
}

function onRotateMove(e: PointerEvent) {
  if (!rotateStart) return
  let deg =
    (Math.atan2(e.clientY - rotateStart.cy, e.clientX - rotateStart.cx) * 180) /
      Math.PI +
    90
  if (e.shiftKey) deg = Math.round(deg / 15) * 15
  else deg = Math.round(deg)
  deg = ((deg % 360) + 360) % 360
  if (deg > 180) deg -= 360
  project.patchVisual(props.item._id, { angle: deg === 0 ? undefined : deg }, false)
}

function onRotateUp() {
  window.removeEventListener('pointermove', onRotateMove)
  window.removeEventListener('pointerup', onRotateUp)
  window.removeEventListener('pointercancel', onRotateUp)
  window.removeEventListener('blur', onRotateUp)
  if (rotateStart) project.commit()
  rotateStart = null
}

onBeforeUnmount(() => {
  onResizeUp()
  onRotateUp()
})
</script>

<template>
  <div class="sel-box" :class="{ primary }" :style="boxStyle">
    <template v-if="primary">
      <span
        v-for="hd in HANDLES"
        :key="hd.dir"
        class="handle"
        :class="{ 'handle--edge': hd.dir.length === 1 }"
        :data-resize-handle="hd.dir"
        :style="{
          left: `${hd.x * 100}%`,
          top: `${hd.y * 100}%`,
          cursor: hd.cursor,
        }"
        @pointerdown="onHandleDown($event, hd.dir)"
      />
      <span
        class="rotate-handle"
        title="Drag to rotate (Shift = 15° steps)"
        @pointerdown="onRotateDown"
      />
      <span class="rotate-stick" />
    </template>
  </div>
</template>

<style scoped>
.sel-box {
  position: absolute;
  outline: var(--bw) solid var(--accent);
  pointer-events: none;
  z-index: 900;
}
.sel-box:not(.primary) {
  outline-style: dashed;
  opacity: 0.8;
}
.handle {
  position: absolute;
  transform: translate(-50%, -50%);
  width: var(--hs);
  height: var(--hs);
  background: #fff;
  border: var(--bw) solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(10, 6, 30, 0.3);
  pointer-events: auto;
}
.handle:not(.handle--edge) {
  width: calc(var(--hs) * 1.3);
  height: calc(var(--hs) * 1.3);
}
/* Slim edge bars retain a larger invisible target for easy dragging. */
.handle--edge {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.handle--edge::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  border-radius: 999px;
  box-shadow: 0 0 0 calc(var(--bw) / 2) rgba(10, 6, 30, 0.2);
  pointer-events: none;
}
.handle[data-resize-handle='n'],
.handle[data-resize-handle='s'] {
  width: var(--edge-length);
}
.handle[data-resize-handle='n']::before,
.handle[data-resize-handle='s']::before {
  width: 100%;
  height: var(--edge-thickness);
}
.handle[data-resize-handle='e'],
.handle[data-resize-handle='w'] {
  height: var(--edge-length);
}
.handle[data-resize-handle='e']::before,
.handle[data-resize-handle='w']::before {
  width: var(--edge-thickness);
  height: 100%;
}
.rotate-stick {
  position: absolute;
  left: 50%;
  top: calc(var(--hs) * -2.2);
  width: var(--bw);
  height: calc(var(--hs) * 2.2 - var(--hs) / 2);
  background: var(--accent);
  transform: translateX(-50%);
}
.rotate-handle {
  position: absolute;
  left: calc(50% - var(--hs) / 2 - var(--hs) * 0.1);
  top: calc(var(--hs) * -3.2);
  width: calc(var(--hs) * 1.2);
  height: calc(var(--hs) * 1.2);
  background: #fff;
  border: var(--bw) solid var(--accent);
  border-radius: 50%;
  pointer-events: auto;
  cursor: grab;
}
</style>
