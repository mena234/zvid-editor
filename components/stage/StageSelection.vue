<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { effectiveLayout } from '~/utils/itemGeometry'
import { topLeftToAnchor } from '~/shared/schema/defaults'
import { useProjectStore } from '~/stores/project'
import { isAutoHugText } from '~/utils/textTemplate'
import { TEXT_DEFAULT_FONT_SIZE } from '~/shared/schema/constants'
import { round3 } from '~/utils/time'

const props = defineProps<{ item: VisualDoc; primary: boolean }>()
const project = useProjectStore()
const stageCtx = inject<any>('stageCtx')

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
  dir: string
  px: number
  py: number
  left: number
  top: number
  w: number
  h: number
  anchor: any
  shift: boolean
  hug: boolean
  /** RAW doc style at drag start (corner scale must never compound or bake
   *  resolved {{placeholders}} back into the doc); null = don't scale type */
  scaleStyle: Record<string, any> | null
  fontPx: number
} | null = null

function onHandleDown(e: PointerEvent, dir: string) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const L = layout.value
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
    shift: false,
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
}

function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
  window.removeEventListener('pointercancel', onResizeUp)
  window.removeEventListener('blur', onResizeUp)
  if (resizeStart) project.commit()
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
        :style="{
          left: `calc(${hd.x * 100}% - var(--hs) / 2)`,
          top: `calc(${hd.y * 100}% - var(--hs) / 2)`,
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
  width: var(--hs);
  height: var(--hs);
  background: #fff;
  border: var(--bw) solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(10, 6, 30, 0.3);
  pointer-events: auto;
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
