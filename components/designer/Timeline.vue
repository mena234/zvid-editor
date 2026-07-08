<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DesignDoc, DesignLayer, LayerAnim } from '~/utils/designer/types'
import { animPreset } from '~/utils/designer/animations'
import { splitTextHtml } from '~/utils/designer/compile'

/**
 * Simple animation timeline for the Design Studio.
 *
 * One row per layer (front-most first, same order as the layers panel).
 * Entrance animations render as draggable bars — drag the body to change the
 * delay, the right edge to change the duration; split-text presets show the
 * stagger tail as a lighter cap. Infinite loops span the whole lane as a
 * striped bar (right edge adjusts the period). The ruler scrubs the shared
 * preview clock, so the playhead here and the preview stay in lockstep.
 */

const props = defineProps<{
  design: DesignDoc
  selectedId: string | null
  /** resolved loop duration (s) from the compiled design */
  duration: number
  /** false when nothing animates — play/scrub are disabled */
  animated: boolean
  /** shared master clock (owned by the modal, ticked by the preview) */
  clock: { t: number; playing: boolean }
}>()

const emit = defineEmits<{
  'update:selectedId': [string | null]
  'patch-layer': [id: string, patch: Record<string, any>]
}>()

/** UI lists front-most first; doc stores bottom → top. */
const rows = computed(() =>
  [...props.design.layers].reverse().map((layer) => ({ layer, bar: barFor(layer) }))
)

const KIND_ICON: Record<DesignLayer['kind'], string> = {
  text: 'text',
  shape: 'svg',
  image: 'image',
}

function rowLabel(l: DesignLayer): string {
  if (l.kind === 'text') {
    const t = l.text.replace(/\n/g, ' ').trim()
    return t.length > 16 ? `${t.slice(0, 16)}…` : t || 'Text'
  }
  return l.name
}

/* ---------------- bars ---------------- */
interface Bar {
  kind: 'entrance' | 'loop'
  /** % of the lane */
  left: number
  width: number
  /** stagger tail as % of the bar's own width (entrances only) */
  tailPct: number
  title: string
}

function barFor(l: DesignLayer): Bar | null {
  const preset = animPreset(l.anim?.preset)
  const a = l.anim
  if (!preset || !a) return null
  const total = Math.max(0.001, props.duration)
  if (preset.infinite) {
    return {
      kind: 'loop',
      left: 0,
      width: 100,
      tailPct: 0,
      title: `${preset.label} — loops every ${a.duration.toFixed(2)}s`,
    }
  }
  const tail =
    preset.split && l.kind === 'text'
      ? (a.stagger ?? 0) * Math.max(0, splitTextHtml(l.text, preset.split).count - 1)
      : 0
  const len = a.duration + tail
  const width = Math.max(1.2, (len / total) * 100)
  return {
    kind: 'entrance',
    left: (a.delay / total) * 100,
    width,
    tailPct: len > 0 ? (tail / len) * 100 : 0,
    title:
      `${preset.label} — delay ${a.delay.toFixed(2)}s, duration ${a.duration.toFixed(2)}s` +
      (tail ? `, stagger tail ${tail.toFixed(2)}s` : ''),
  }
}

/* ---------------- ruler ---------------- */
const ticks = computed(() => {
  const total = Math.max(0.001, props.duration)
  const step = total <= 3 ? 0.5 : total <= 8 ? 1 : 2
  const out: { t: number; left: number; label: string }[] = []
  for (let t = 0; t <= total + 0.001; t += step) {
    out.push({
      t,
      left: (t / total) * 100,
      label: Number.isInteger(t) ? String(t) : t.toFixed(1),
    })
  }
  return out
})

const playheadPct = computed(() =>
  props.duration > 0 ? Math.min(100, (props.clock.t / props.duration) * 100) : 0
)

/* ---------------- scrub (ruler / empty lane) ---------------- */
const trackEl = ref<HTMLElement>()

function scrubAt(e: PointerEvent) {
  const el = trackEl.value
  if (!el || !props.animated) return
  const r = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)))
  props.clock.playing = false
  props.clock.t = Math.max(0, Math.min(props.duration - 0.001, frac * props.duration))
}

function onTrackDown(e: PointerEvent) {
  e.preventDefault()
  scrubAt(e)
  window.addEventListener('pointermove', scrubAt)
  window.addEventListener('pointerup', endScrub)
}

function endScrub() {
  window.removeEventListener('pointermove', scrubAt)
  window.removeEventListener('pointerup', endScrub)
}

/* ---------------- drag bars (retime) ---------------- */
const STEP = 0.05
const quant = (v: number) => Math.round(v / STEP) * STEP
const round2 = (v: number) => Math.round(v * 100) / 100

let drag: null | {
  id: string
  mode: 'move' | 'resize'
  startX: number
  orig: LayerAnim
  /** captured at drag start so auto-duration growth doesn't warp the drag */
  pxPerSec: number
} = null

function onBarDown(e: PointerEvent, l: DesignLayer, mode: 'move' | 'resize') {
  const preset = animPreset(l.anim?.preset)
  if (!l.anim || !preset) return
  e.preventDefault()
  e.stopPropagation()
  emit('update:selectedId', l.id)
  if (mode === 'move' && preset.infinite) return // loops have no delay
  const el = trackEl.value
  if (!el) return
  drag = {
    id: l.id,
    mode,
    startX: e.clientX,
    orig: { ...l.anim },
    pxPerSec: Math.max(1, el.clientWidth) / Math.max(0.001, props.duration),
  }
  window.addEventListener('pointermove', onBarMove)
  window.addEventListener('pointerup', onBarUp)
}

function onBarMove(e: PointerEvent) {
  if (!drag) return
  const ds = (e.clientX - drag.startX) / drag.pxPerSec
  if (drag.mode === 'move') {
    // same range as the inspector's Delay field
    const delay = round2(Math.max(0, Math.min(14, quant(drag.orig.delay + ds))))
    if (delay !== drag.orig.delay)
      emit('patch-layer', drag.id, { anim: { ...drag.orig, delay } })
  } else {
    // same range as the inspector's Duration/Period field
    const duration = round2(Math.max(STEP, Math.min(15, quant(drag.orig.duration + ds))))
    if (duration !== drag.orig.duration)
      emit('patch-layer', drag.id, { anim: { ...drag.orig, duration } })
  }
}

function onBarUp() {
  drag = null
  window.removeEventListener('pointermove', onBarMove)
  window.removeEventListener('pointerup', onBarUp)
}

onBeforeUnmount(() => {
  endScrub()
  onBarUp()
})
</script>

<template>
  <div class="tl">
    <div class="tl-head">
      <UiIcon name="clock" :size="12" class="tl-head-icon" />
      <span class="tl-title">Timeline</span>
      <button
        class="icon-btn"
        :title="clock.playing ? 'Pause' : 'Play'"
        :disabled="!animated"
        @click="clock.playing = !clock.playing"
      >
        <UiIcon :name="clock.playing && animated ? 'pause' : 'play'" :size="12" />
      </button>
      <span class="tl-time mono">{{ clock.t.toFixed(2) }} / {{ duration.toFixed(2) }}s</span>
      <span class="tl-hint">drag bars to retime · right edge = duration · click ruler to scrub</span>
    </div>

    <div v-if="rows.length" class="tl-scroll">
      <div class="tl-body">
        <div class="tl-names">
          <div class="tl-corner" />
          <div
            v-for="{ layer } in rows"
            :key="layer.id"
            class="tl-name"
            :class="{ active: layer.id === selectedId, off: layer.hidden }"
            :title="rowLabel(layer)"
            @click="emit('update:selectedId', layer.id)"
          >
            <UiIcon :name="KIND_ICON[layer.kind]" :size="12" class="tl-kind" />
            <span class="tl-name-label">{{ rowLabel(layer) }}</span>
          </div>
        </div>

        <div ref="trackEl" class="tl-track" @pointerdown="onTrackDown">
          <div class="tl-ruler">
            <span
              v-for="tick in ticks"
              :key="tick.t"
              class="tl-tick"
              :style="{ left: `${tick.left}%` }"
            >
              <span class="tl-tick-label mono">{{ tick.label }}</span>
            </span>
          </div>

          <div
            v-for="{ layer, bar } in rows"
            :key="layer.id"
            class="tl-row"
            :class="{ active: layer.id === selectedId, off: layer.hidden }"
          >
            <div
              v-if="bar"
              class="tl-bar"
              :class="bar.kind"
              :style="{ left: `${bar.left}%`, width: `${bar.width}%` }"
              :title="bar.title"
              @pointerdown="onBarDown($event, layer, 'move')"
            >
              <span
                v-if="bar.tailPct > 1"
                class="tl-tail"
                :style="{ width: `${bar.tailPct}%` }"
              />
              <span
                class="tl-handle"
                title="Drag to change duration"
                @pointerdown="onBarDown($event, layer, 'resize')"
              />
            </div>
            <span v-else class="tl-none">no animation</span>
          </div>

          <div class="tl-playhead" :style="{ left: `${playheadPct}%` }" />
        </div>
      </div>
    </div>
    <p v-else class="hint tl-empty">Add a layer to see its animation timing here.</p>
  </div>
</template>

<style scoped>
.tl {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  padding: 6px 8px;
  background: var(--bg-1);
}
.tl-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tl-head-icon {
  color: var(--text-2);
}
.tl-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-1);
}
.tl-time {
  font-size: 10px;
  color: var(--text-2);
  white-space: nowrap;
}
.tl-hint {
  flex: 1;
  text-align: right;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl-scroll {
  max-height: 128px;
  overflow-y: auto;
}
.tl-body {
  display: flex;
  min-width: 0;
}
.tl-names {
  flex: 0 0 132px;
  display: flex;
  flex-direction: column;
}
.tl-corner {
  height: 18px;
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--bg-1);
}
.tl-name {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px;
  font-size: 10.5px;
  color: var(--text-1);
  border-radius: var(--radius-s);
  cursor: pointer;
  user-select: none;
}
.tl-name:hover {
  background: var(--bg-3);
}
.tl-name.active {
  background: var(--accent-soft);
  color: var(--text-0);
}
.tl-name.off,
.tl-row.off {
  opacity: 0.4;
}
.tl-kind {
  flex: 0 0 auto;
  color: var(--text-2);
}
.tl-name.active .tl-kind {
  color: var(--accent);
}
.tl-name-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl-track {
  flex: 1;
  position: relative;
  min-width: 0;
  cursor: crosshair;
}
.tl-ruler {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 18px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-1);
}
.tl-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border-1);
}
.tl-tick-label {
  position: absolute;
  top: 1px;
  left: 3px;
  font-size: 8.5px;
  color: var(--text-3);
}
.tl-row {
  position: relative;
  height: 24px;
  border-bottom: 1px dashed color-mix(in srgb, var(--border-1) 55%, transparent);
  overflow: hidden;
}
.tl-row.active {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.tl-bar {
  position: absolute;
  top: 4px;
  bottom: 4px;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000));
  border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--border-2));
  cursor: grab;
  min-width: 8px;
}
.tl-bar:active {
  cursor: grabbing;
}
.tl-bar.loop {
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--accent) 55%, transparent) 0 6px,
    color-mix(in srgb, var(--accent) 30%, transparent) 6px 12px
  );
  cursor: default;
}
.tl-tail {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  border-radius: 0 4px 4px 0;
  background: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.28) 0 4px,
    transparent 4px 8px
  );
  pointer-events: none;
}
.tl-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  width: 8px;
  cursor: ew-resize;
}
.tl-handle::after {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  right: 4px;
  width: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.75);
}
.tl-none {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9.5px;
  color: var(--text-3);
  user-select: none;
}
.tl-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--red, #ff5470);
  z-index: 1;
  pointer-events: none;
}
.tl-empty {
  padding: 2px 0 4px;
}
</style>
