<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesignDoc } from '~/utils/designer/types'
import { compileDesign } from '~/utils/designer/compile'
import { useEditorContext } from '~/composables/useEditorContext'
import { useTemplateVars } from '~/composables/useTemplateVars'

/**
 * Live preview for the Design Studio.
 *
 * Renders the compiled html+css in a Shadow DOM (same isolation as the
 * stage) and drives every CSS animation deterministically through the Web
 * Animations API — the exact technique the package's capture uses — so
 * play/pause/scrub here show precisely what the render will contain.
 * A selection overlay on top allows click-to-select and drag-to-move.
 */

const props = defineProps<{
  design: DesignDoc
  selectedId: string | null
  /** shared master clock — the timeline scrubs it, this component ticks it */
  clock: { t: number; playing: boolean }
}>()

const emit = defineEmits<{
  'update:selectedId': [string | null]
  /** drag finished: commit new center position (%) */
  move: [id: string, x: number, y: number]
}>()

const compiled = computed(() => compileDesign(props.design))
const visibleLayers = computed(() => props.design.layers.filter((l) => !l.hidden))

/* {{placeholders}} are resolved on the COMPILED html string — the exact
 * substitution orch performs at render time — so what this preview shows is
 * what the capture machine gets. Follows the global "variable values"
 * preview toggle; off (or unresolvable) leaves the raw placeholder text. */
const { activeScene } = useEditorContext()
const tvars = useTemplateVars()
const displayHtml = computed(() => {
  const html = compiled.value.html
  if (!html.includes('{{')) return html
  const scope = activeScene.value
    ? tvars.scenePreviewScope(activeScene.value)
    : tvars.projectScope.value
  return tvars.displayString(html, scope) ?? html
})

/* ---------------- stage fit ---------------- */
const frameEl = ref<HTMLElement>()
const fit = ref({ scale: 1, w: 0, h: 0 })
let frameRo: ResizeObserver | null = null

function refit() {
  const el = frameEl.value
  if (!el) return
  const pad = 24
  const availW = el.clientWidth - pad
  const availH = el.clientHeight - pad
  const scale = Math.min(availW / props.design.width, availH / props.design.height, 1)
  fit.value = {
    scale: Math.max(0.05, scale),
    w: props.design.width * scale,
    h: props.design.height * scale,
  }
}

/* ---------------- shadow render ---------------- */
const hostEl = ref<HTMLElement>()
let anims: Animation[] = []

function build() {
  const host = hostEl.value
  if (!host) return
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${compiled.value.css}</style>${displayHtml.value}`
  grabAnimations()
  requestAnimationFrame(() => {
    measureBoxes()
  })
}

function grabAnimations() {
  const host = hostEl.value
  const root = host?.shadowRoot?.querySelector('.dz') as HTMLElement | null
  anims = root ? root.getAnimations({ subtree: true }) : []
  for (const a of anims) a.pause()
  applyTime()
}

/* ---------------- playback (master clock, WAAPI-driven) ---------------- */
const clock = props.clock
const duration = computed(() => compiled.value.duration)
let raf = 0
let last = 0

function applyTime() {
  const ms = clock.t * 1000
  for (const a of anims) {
    try {
      a.currentTime = ms
    } catch {
      /* detached animation — ignored, next build re-grabs */
    }
  }
}

// external scrubs (the timeline ruler) must reach the WAAPI immediately
watch(() => clock.t, applyTime, { flush: 'sync' })

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const dt = (now - last) / 1000
  last = now
  if (clock.playing && compiled.value.animated) {
    clock.t = (clock.t + dt) % duration.value
  }
}

function scrub(v: number) {
  clock.playing = false
  clock.t = v
}

function replay() {
  clock.t = 0
  clock.playing = true
}

/* ---------------- selection overlay ---------------- */
interface Box {
  id: string
  left: number
  top: number
  width: number
  height: number
}
const boxes = ref<Box[]>([])

function measureBoxes() {
  const host = hostEl.value
  const frame = frameEl.value
  const shadow = host?.shadowRoot
  if (!host || !frame || !shadow) return
  const frameRect = frame.getBoundingClientRect()
  const els = shadow.querySelectorAll<HTMLElement>('.dz-l')
  const out: Box[] = []
  els.forEach((el, i) => {
    const layer = visibleLayers.value[i]
    if (!layer) return
    const r = el.getBoundingClientRect()
    out.push({
      id: layer.id,
      left: r.left - frameRect.left,
      top: r.top - frameRect.top,
      width: r.width,
      height: r.height,
    })
  })
  boxes.value = out
}

/* ---------------- drag to move ---------------- */
const drag = ref<null | {
  id: string
  startX: number
  startY: number
  origX: number
  origY: number
  moved: boolean
}>(null)

function onBoxDown(e: PointerEvent, id: string) {
  e.preventDefault()
  emit('update:selectedId', id)
  const layer = props.design.layers.find((l) => l.id === id)
  if (!layer) return
  drag.value = {
    id,
    startX: e.clientX,
    startY: e.clientY,
    origX: layer.x,
    origY: layer.y,
    moved: false,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
}

function dragPosition(e: PointerEvent): { x: number; y: number } | null {
  const d = drag.value
  if (!d) return null
  const dx = ((e.clientX - d.startX) / (props.design.width * fit.value.scale)) * 100
  const dy = ((e.clientY - d.startY) / (props.design.height * fit.value.scale)) * 100
  return {
    x: Math.round(Math.min(130, Math.max(-30, d.origX + dx)) * 10) / 10,
    y: Math.round(Math.min(130, Math.max(-30, d.origY + dy)) * 10) / 10,
  }
}

function onDragMove(e: PointerEvent) {
  const d = drag.value
  const pos = dragPosition(e)
  if (!d || !pos) return
  if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 2) d.moved = true
  // fast path: nudge the shadow element + overlay directly, commit on release
  const idx = visibleLayers.value.findIndex((l) => l.id === d.id)
  const el = hostEl.value?.shadowRoot?.querySelectorAll<HTMLElement>('.dz-l')[idx]
  if (el) {
    el.style.left = `${pos.x}%`
    el.style.top = `${pos.y}%`
  }
  measureBoxes()
}

function onDragUp(e: PointerEvent) {
  const d = drag.value
  const pos = dragPosition(e)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  drag.value = null
  if (d && pos && d.moved) emit('move', d.id, pos.x, pos.y)
}

/* ---------------- backdrop ---------------- */
const backdrop = ref<'checker' | 'dark' | 'light'>('checker')

/* ---------------- lifecycle ---------------- */
onMounted(() => {
  refit()
  frameRo = new ResizeObserver(() => {
    refit()
    requestAnimationFrame(measureBoxes)
  })
  if (frameEl.value) frameRo.observe(frameEl.value)
  build()
  last = performance.now()
  raf = requestAnimationFrame(tick)
  // re-measure once webfonts arrive (text metrics change)
  document.fonts?.ready.then(() => requestAnimationFrame(measureBoxes))
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  frameRo?.disconnect()
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
})

watch(
  () => [compiled.value.css, displayHtml.value],
  () => {
    if (clock.t > duration.value) clock.t = 0
    build()
  }
)
watch(() => [props.design.width, props.design.height], refit)
watch(() => props.selectedId, () => requestAnimationFrame(measureBoxes))
</script>

<template>
  <div class="preview">
    <div
      ref="frameEl"
      class="frame"
      :data-backdrop="backdrop"
      @pointerdown.self="emit('update:selectedId', null)"
    >
      <div
        class="canvas-fit"
        :style="{ width: `${fit.w}px`, height: `${fit.h}px` }"
        @pointerdown.self="emit('update:selectedId', null)"
      >
        <div
          ref="hostEl"
          class="canvas-host"
          :style="{
            width: `${design.width}px`,
            height: `${design.height}px`,
            transform: `scale(${fit.scale})`,
            fontFamily: `'${design.fontFamily}', sans-serif`,
          }"
        />
      </div>
      <!-- selection / drag overlay -->
      <div class="overlay">
        <div
          v-for="b in boxes"
          :key="b.id"
          class="sel-box"
          :class="{ active: b.id === selectedId }"
          :style="{
            left: `${b.left}px`,
            top: `${b.top}px`,
            width: `${b.width}px`,
            height: `${b.height}px`,
          }"
          @pointerdown="onBoxDown($event, b.id)"
        />
      </div>
    </div>

    <div class="controls">
      <button class="icon-btn" :title="clock.playing ? 'Pause' : 'Play'" @click="clock.playing = !clock.playing">
        <UiIcon :name="clock.playing ? 'pause' : 'play'" :size="14" />
      </button>
      <button class="icon-btn" title="Replay from start" @click="replay">
        <UiIcon name="loop" :size="13" />
      </button>
      <input
        class="scrub"
        type="range"
        min="0"
        :max="duration"
        step="0.01"
        :value="clock.t"
        :disabled="!compiled.animated"
        @input="scrub(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="time mono">{{ clock.t.toFixed(2) }} / {{ duration.toFixed(2) }}s</span>
      <span class="bg-picker">
        <button
          v-for="b in ['checker', 'dark', 'light'] as const"
          :key="b"
          class="bg-dot"
          :class="[b, { on: backdrop === b }]"
          :title="`${b} backdrop`"
          @click="backdrop = b"
        />
      </span>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.frame {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  overflow: hidden;
}
.frame[data-backdrop='checker'] {
  background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 /
    18px 18px;
}
.frame[data-backdrop='dark'] {
  background: #0b0d12;
}
.frame[data-backdrop='light'] {
  background: #e8eaf0;
}
.canvas-fit {
  position: relative;
  flex: 0 0 auto;
}
.canvas-host {
  transform-origin: 0 0;
}
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.sel-box {
  position: absolute;
  pointer-events: auto;
  cursor: grab;
  border: 1px dashed transparent;
  border-radius: 2px;
}
.sel-box:hover {
  border-color: color-mix(in srgb, var(--accent) 65%, transparent);
}
.sel-box.active {
  border: 1.5px solid var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}
.sel-box:active {
  cursor: grabbing;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  flex: 0 0 auto;
}
.scrub {
  flex: 1;
  accent-color: var(--accent);
  min-width: 0;
}
.time {
  font-size: 10px;
  color: var(--text-2);
  white-space: nowrap;
}
.bg-picker {
  display: flex;
  gap: 4px;
}
.bg-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--border-2);
  padding: 0;
}
.bg-dot.checker {
  background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 /
    8px 8px;
}
.bg-dot.dark {
  background: #0b0d12;
}
.bg-dot.light {
  background: #e8eaf0;
}
.bg-dot.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
</style>
