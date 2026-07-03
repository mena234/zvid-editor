<script setup lang="ts">
import { computed, inject } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { effectiveLayout } from '~/utils/itemGeometry'
import { topLeftToAnchor } from '~/shared/schema/defaults'
import { useProjectStore } from '~/stores/project'
import { round3 } from '~/utils/time'

const props = defineProps<{ item: VisualDoc; primary: boolean }>()
const project = useProjectStore()
const stageCtx = inject<any>('stageCtx')

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
} | null = null

function onHandleDown(e: PointerEvent, dir: string) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  const L = layout.value
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
  }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp)
}

function onResizeMove(e: PointerEvent) {
  const s = resizeStart
  if (!s) return
  const dx = (e.clientX - s.px) / stageCtx.scale
  const dy = (e.clientY - s.py) / stageCtx.scale

  let { left, top, w, h } = s
  const keepRatio = e.shiftKey && s.dir.length === 2
  const ratio = s.w / Math.max(1, s.h)

  if (s.dir.includes('e')) w = s.w + dx
  if (s.dir.includes('w')) {
    w = s.w - dx
    left = s.left + dx
  }
  if (s.dir.includes('s')) h = s.h + dy
  if (s.dir.includes('n')) {
    h = s.h - dy
    top = s.top + dy
  }

  if (keepRatio) {
    if (Math.abs(dx) > Math.abs(dy)) h = w / ratio
    else w = h * ratio
    if (s.dir.includes('w')) left = s.left + (s.w - w)
    if (s.dir.includes('n')) top = s.top + (s.h - h)
  }

  w = Math.max(8, w)
  h = Math.max(8, h)

  const { x, y } = topLeftToAnchor(left, top, w, h, s.anchor)
  const patch: Record<string, any> = {
    x: round3(x),
    y: round3(y),
    width: Math.round(w),
    height: Math.round(h),
    anchor: s.anchor,
    resize: undefined, // manual size overrides contain/cover
  }
  if (props.item.position && props.item.position !== 'custom') patch.position = 'custom'
  project.patchVisual(props.item._id, patch, false)
}

function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeUp)
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
  if (rotateStart) project.commit()
  rotateStart = null
}
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
  border-radius: 2px;
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
