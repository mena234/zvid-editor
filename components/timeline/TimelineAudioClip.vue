<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { AudioDoc } from '~/shared/schema/types'
import { resolveAudioTiming } from '~/shared/schema/defaults'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useMediaProbe } from '~/composables/useMediaProbe'
import { useWaveform } from '~/composables/useWaveform'
import { round3, clamp } from '~/utils/time'

const props = defineProps<{
  audio: AudioDoc
  pxPerSec: number
  contextDuration: number
  lanes: number[]
  snap: (t: number, excludeId?: string) => number
}>()

const emit = defineEmits<{ ctxmenu: [e: MouseEvent] }>()

const project = useProjectStore()
const editor = useEditorStore()

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (!selected.value) editor.selectAudio(props.audio._id)
  emit('ctxmenu', e)
}
const { probe } = useMediaProbe()
const { waveformFor } = useWaveform()

const probed = computed(() => (props.audio.src ? probe('audio', props.audio.src) : null))

const timing = computed(() =>
  resolveAudioTiming(props.audio, props.contextDuration, probed.value?.duration)
)

const left = computed(() => timing.value.enter * props.pxPerSec)
const width = computed(() =>
  Math.max(6, (timing.value.exit - timing.value.enter) * props.pxPerSec)
)

const selected = computed(
  () => editor.selectionKind === 'audio' && editor.selectedId === props.audio._id
)

const label = computed(() => {
  const src = props.audio.src ?? ''
  try {
    return new URL(src).pathname.split('/').filter(Boolean).pop() || src
  } catch {
    return src.split(/[\\/]/).pop() || 'audio'
  }
})

/* loop segments: source shorter than the timeline window auto-loops */
const loopMarkers = computed(() => {
  const t = timing.value
  const trimmed = Math.max(0.01, t.audioEnd - t.audioBegin) / t.speed
  const window_ = t.exit - t.enter
  if (trimmed >= window_ - 0.01) return []
  const marks: number[] = []
  for (let x = trimmed; x < window_; x += trimmed) {
    marks.push((x / window_) * 100)
  }
  return marks
})

/* waveform */
const canvasEl = ref<HTMLCanvasElement>()
watchEffect(() => {
  const canvas = canvasEl.value
  if (!canvas) return
  const wf = props.audio.src ? waveformFor(props.audio.src) : null
  const w = Math.max(10, Math.floor(width.value))
  const h = 30
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  // repaint when the theme flips — the wave color comes from the CSS tokens
  void editor.theme
  const waveColor =
    getComputedStyle(canvas).getPropertyValue('--clip-audio').trim() || '#14b3b3'
  ctx.fillStyle = waveColor
  ctx.globalAlpha = 0.75

  const t = timing.value
  const sourceDur = wf?.duration ?? t.audioEnd
  const trimmed = Math.max(0.01, t.audioEnd - t.audioBegin)
  const windowDur = Math.max(0.01, t.exit - t.enter)

  if (wf?.status === 'ok' && wf.peaks.length && sourceDur > 0) {
    const peaks = wf.peaks
    for (let x = 0; x < w; x += 2) {
      const tt = (x / w) * windowDur // time within clip window
      const srcT = t.audioBegin + ((tt * t.speed) % trimmed)
      const idx = Math.min(peaks.length - 1, Math.floor((srcT / sourceDur) * peaks.length))
      const p = peaks[idx] ?? 0
      const bar = Math.max(1, p * (h - 6))
      ctx.fillRect(x, (h - bar) / 2, 1.4, bar)
    }
  } else {
    // fallback flat pattern
    ctx.globalAlpha = 0.35
    for (let x = 0; x < w; x += 3) {
      const p = 0.25 + 0.2 * Math.sin(x / 6)
      const bar = p * (h - 8)
      ctx.fillRect(x, (h - bar) / 2, 1.4, bar)
    }
  }
})

/* ---------------- gestures ---------------- */
type Mode = 'move' | 'trim-l' | 'trim-r'
let gesture: {
  mode: Mode
  startX: number
  t0: { enter: number; exit: number; audioBegin: number }
  moved: boolean
} | null = null

function beginGesture(e: PointerEvent, mode: Mode) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  editor.selectAudio(props.audio._id)
  gesture = {
    mode,
    startX: e.clientX,
    t0: {
      enter: timing.value.enter,
      exit: timing.value.exit,
      audioBegin: timing.value.audioBegin,
    },
    moved: false,
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onMove(e: PointerEvent) {
  const g = gesture
  if (!g) return
  const dt = (e.clientX - g.startX) / props.pxPerSec
  if (!g.moved && Math.abs(e.clientX - g.startX) < 3) return
  g.moved = true

  if (g.mode === 'move') {
    let nb = props.snap(g.t0.enter + dt, props.audio._id)
    nb = Math.max(0, nb)
    const shift = nb - g.t0.enter
    const patch: Record<string, any> = {
      enter: round3(nb),
      exit: round3(g.t0.exit + shift),
    }
    const laneEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-audio-track]') as HTMLElement | null
    if (laneEl) {
      const track = Number(laneEl.dataset.audioTrack)
      if (!Number.isNaN(track) && track !== (props.audio.track ?? 0)) patch.track = track
    }
    project.patchAudio(props.audio._id, patch, false)
  } else if (g.mode === 'trim-l') {
    let nb = props.snap(g.t0.enter + dt, props.audio._id)
    nb = clamp(nb, 0, g.t0.exit - 0.05)
    const shift = nb - g.t0.enter
    project.patchAudio(
      props.audio._id,
      {
        enter: round3(nb),
        audioBegin: round3(Math.max(0, g.t0.audioBegin + shift * timing.value.speed)),
      },
      false
    )
  } else {
    let ne = props.snap(g.t0.exit + dt, props.audio._id)
    ne = Math.max(g.t0.enter + 0.05, ne)
    project.patchAudio(props.audio._id, { exit: round3(ne) }, false)
  }
}

function onUp() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  if (gesture?.moved) project.commit()
  gesture = null
}
</script>

<template>
  <div
    class="aclip"
    :class="{ selected }"
    :style="{ left: `${left}px`, width: `${width}px` }"
    :title="label"
    @pointerdown="beginGesture($event, 'move')"
    @contextmenu="onContextMenu"
  >
    <canvas ref="canvasEl" class="wave" />
    <div class="aclip-inner">
      <UiIcon name="audio" :size="11" class="a-icon" />
      <span class="a-label">{{ label }}</span>
      <span v-if="(audio.volume ?? 1) !== 1" class="badge">{{
        typeof audio.volume === 'number'
          ? `${Math.round(audio.volume * 100)}%`
          : audio.volume
      }}</span>
      <span v-if="(audio.speed ?? 1) !== 1" class="badge">{{
        typeof audio.speed === 'number' ? `${audio.speed}×` : audio.speed
      }}</span>
    </div>
    <div
      v-for="(m, i) in loopMarkers"
      :key="i"
      class="loop-mark"
      :style="{ left: `${m}%` }"
      title="Source loops here (auto-loop)"
    />
    <div class="trim l" @pointerdown="beginGesture($event, 'trim-l')" />
    <div class="trim r" @pointerdown="beginGesture($event, 'trim-r')" />
  </div>
</template>

<style scoped>
.aclip {
  position: absolute;
  top: 5px;
  height: 30px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--clip-audio) 25%, var(--bg-3));
  border: 1px solid color-mix(in srgb, var(--clip-audio) 60%, transparent);
  overflow: hidden;
  cursor: grab;
  user-select: none;
}
.aclip:hover {
  border-color: var(--clip-audio);
}
.aclip.selected {
  border-color: var(--bg-1);
  box-shadow: 0 0 0 2px var(--accent);
  z-index: 5;
}
.wave {
  position: absolute;
  inset: 0;
  opacity: 0.8;
  pointer-events: none;
}
.aclip-inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 8px;
  z-index: 2;
  pointer-events: none;
}
.a-icon {
  color: color-mix(in srgb, var(--clip-audio) 72%, var(--text-0));
}
.a-label {
  font-size: 10.5px;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bg-1) 60%, transparent);
  color: var(--text-1);
}
.loop-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed color-mix(in srgb, var(--text-0) 45%, transparent);
  z-index: 2;
  pointer-events: none;
}
.trim {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  z-index: 3;
}
.trim.l {
  left: 0;
}
.trim.r {
  right: 0;
}
.aclip.selected .trim {
  background: color-mix(in srgb, var(--text-0) 22%, transparent);
}
</style>
