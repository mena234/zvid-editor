<script setup lang="ts">
import { computed } from 'vue'
import type { VisualDoc } from '~/shared/schema/types'
import { canonicalVisualType } from '~/shared/schema/types'
import { resolveVisualTiming } from '~/shared/schema/defaults'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { round3, clamp } from '~/utils/time'

const props = defineProps<{
  item: VisualDoc
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
  if (!selected.value) editor.selectVisual(props.item._id)
  emit('ctxmenu', e)
}

const type = computed(() => canonicalVisualType(props.item.type) ?? 'IMAGE')
const timing = computed(() => resolveVisualTiming(props.item, props.contextDuration))

const left = computed(() => timing.value.enterBegin * props.pxPerSec)
const width = computed(() =>
  Math.max(6, (timing.value.exitEnd - timing.value.enterBegin) * props.pxPerSec)
)

const selected = computed(
  () =>
    editor.selectionKind === 'visual' &&
    (editor.selectedId === props.item._id || editor.selectedIds.includes(props.item._id))
)

const label = computed(() => {
  const it = props.item
  if (type.value === 'TEXT') {
    const t = it.text || it.html?.replace(/<[^>]+>/g, ' ').trim() || 'text'
    return t.length > 42 ? `${t.slice(0, 42)}…` : t
  }
  if (type.value === 'SVG') return it.svg ? 'svg graphic' : 'svg'
  const src = it.src ?? ''
  try {
    const url = new URL(src)
    const seg = url.pathname.split('/').filter(Boolean).pop()
    return seg || url.hostname
  } catch {
    return src.split(/[\\/]/).pop() || type.value.toLowerCase()
  }
})

const typeIcon = computed(
  () =>
    (({ VIDEO: 'video', IMAGE: 'image', GIF: 'gif', TEXT: 'text', SVG: 'svg' }) as any)[
      type.value
    ] ?? 'image'
)

const colorVar = computed(
  () =>
    (({
      VIDEO: 'var(--clip-video)',
      IMAGE: 'var(--clip-image)',
      GIF: 'var(--clip-gif)',
      TEXT: 'var(--clip-text)',
      SVG: 'var(--clip-svg)',
    }) as any)[type.value]
)

/* animation window fractions for shading */
const enterFrac = computed(() => {
  const t = timing.value
  const total = Math.max(0.001, t.exitEnd - t.enterBegin)
  return clamp((t.enterEnd - t.enterBegin) / total, 0, 1)
})
const exitFrac = computed(() => {
  const t = timing.value
  const total = Math.max(0.001, t.exitEnd - t.enterBegin)
  return clamp((t.exitEnd - t.exitBegin) / total, 0, 1)
})

/* ---------------- gestures ---------------- */
type Mode = 'move' | 'trim-l' | 'trim-r' | 'anim-enter' | 'anim-exit'
let gesture: {
  mode: Mode
  startX: number
  startY: number
  t0: { enterBegin: number; enterEnd: number; exitBegin: number; exitEnd: number }
  videoBegin: number
  videoEnd?: number
  track: number
  moved: boolean
} | null = null

function beginGesture(e: PointerEvent, mode: Mode) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  editor.selectVisual(props.item._id, e.shiftKey)
  gesture = {
    mode,
    startX: e.clientX,
    startY: e.clientY,
    t0: { ...timing.value },
    videoBegin: props.item.videoBegin ?? 0,
    videoEnd: props.item.videoEnd,
    track: props.item.track ?? 0,
    moved: false,
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onMove(e: PointerEvent) {
  const g = gesture
  if (!g) return
  const dt = (e.clientX - g.startX) / props.pxPerSec
  if (!g.moved && Math.abs(e.clientX - g.startX) < 3 && Math.abs(e.clientY - g.startY) < 3)
    return
  g.moved = true
  const speed = props.item.speed ?? 1
  const isVideo = type.value === 'VIDEO'

  if (g.mode === 'move') {
    const dur = g.t0.exitEnd - g.t0.enterBegin
    let nb = props.snap(g.t0.enterBegin + dt, props.item._id)
    nb = Math.max(0, nb)
    const shift = nb - g.t0.enterBegin
    const patch: Record<string, any> = {
      enterBegin: round3(g.t0.enterBegin + shift),
      exitEnd: round3(g.t0.exitEnd + shift),
    }
    patch.enterEnd = round3(g.t0.enterEnd + shift)
    patch.exitBegin = round3(g.t0.exitBegin + shift)

    // vertical lane change
    const laneEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-track]') as HTMLElement | null
    if (laneEl) {
      const track = Number(laneEl.dataset.track)
      if (!Number.isNaN(track) && track !== (props.item.track ?? 0)) patch.track = track
    }
    project.patchVisual(props.item._id, patch, false)
  } else if (g.mode === 'trim-l') {
    let nb = props.snap(g.t0.enterBegin + dt, props.item._id)
    nb = clamp(nb, 0, g.t0.exitEnd - 0.05)
    const shift = nb - g.t0.enterBegin
    const patch: Record<string, any> = {
      enterBegin: round3(nb),
      enterEnd: round3(Math.max(nb, g.t0.enterEnd + (g.t0.enterEnd > g.t0.enterBegin ? shift : 0))),
    }
    if (isVideo) patch.videoBegin = round3(Math.max(0, g.videoBegin + shift * speed))
    project.patchVisual(props.item._id, patch, false)
  } else if (g.mode === 'trim-r') {
    let ne = props.snap(g.t0.exitEnd + dt, props.item._id)
    ne = Math.max(g.t0.enterBegin + 0.05, ne)
    const patch: Record<string, any> = {
      exitEnd: round3(ne),
      exitBegin: round3(
        Math.min(ne, g.t0.exitBegin < g.t0.exitEnd ? g.t0.exitBegin + (ne - g.t0.exitEnd) : ne)
      ),
    }
    if (isVideo && g.videoEnd !== undefined) {
      patch.videoEnd = round3(g.videoBegin + (ne - g.t0.enterBegin) * speed)
    }
    project.patchVisual(props.item._id, patch, false)
  } else if (g.mode === 'anim-enter') {
    const ne = clamp(g.t0.enterEnd + dt, g.t0.enterBegin, g.t0.exitBegin)
    project.patchVisual(props.item._id, { enterEnd: round3(ne) }, false)
  } else if (g.mode === 'anim-exit') {
    const nb = clamp(g.t0.exitBegin + dt, g.t0.enterEnd, g.t0.exitEnd)
    project.patchVisual(props.item._id, { exitBegin: round3(nb) }, false)
  }
}

function onUp() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  if (gesture?.moved) project.commit()
  gesture = null
}

const showAnimHandles = computed(
  () => selected.value && width.value > 40
)
</script>

<template>
  <div
    class="clip"
    :class="{ selected }"
    :style="{
      left: `${left}px`,
      width: `${width}px`,
      '--clip-color': colorVar,
    }"
    :title="label"
    @pointerdown="beginGesture($event, 'move')"
    @contextmenu="onContextMenu"
  >
    <!-- animation window shading -->
    <div
      v-if="item.enterAnimation && enterFrac > 0"
      class="anim-shade in"
      :style="{ width: `${enterFrac * 100}%` }"
    />
    <div
      v-if="item.exitAnimation && exitFrac > 0"
      class="anim-shade out"
      :style="{ width: `${exitFrac * 100}%` }"
    />

    <div class="clip-inner">
      <UiIcon :name="typeIcon" :size="12" class="clip-icon" />
      <span class="clip-label">{{ label }}</span>
      <span v-if="item.speed && item.speed !== 1" class="badge">{{ item.speed }}×</span>
      <span v-if="item.enterAnimation" class="badge anim" :title="`enter: ${item.enterAnimation}`">⇥</span>
      <span v-if="item.exitAnimation" class="badge anim" :title="`exit: ${item.exitAnimation}`">⇤</span>
      <span
        v-if="item.transition && item.transitionId"
        class="badge link-badge"
        :title="`transition ${item.transition} → ${item.transitionId}`"
        >⛓</span
      >
    </div>

    <!-- trim handles -->
    <div class="trim l" @pointerdown="beginGesture($event, 'trim-l')" />
    <div class="trim r" @pointerdown="beginGesture($event, 'trim-r')" />

    <!-- animation window handles -->
    <template v-if="showAnimHandles">
      <div
        class="anim-handle"
        :style="{ left: `${enterFrac * 100}%` }"
        title="Enter animation ends here (enterEnd) — drag"
        @pointerdown="beginGesture($event, 'anim-enter')"
      />
      <div
        class="anim-handle exit"
        :style="{ left: `${(1 - exitFrac) * 100}%` }"
        title="Exit animation starts here (exitBegin) — drag"
        @pointerdown="beginGesture($event, 'anim-exit')"
      />
    </template>
  </div>
</template>

<style scoped>
.clip {
  position: absolute;
  top: 5px;
  height: 30px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--clip-color) 32%, var(--bg-3));
  border: 1px solid color-mix(in srgb, var(--clip-color) 65%, transparent);
  cursor: grab;
  overflow: hidden;
  user-select: none;
}
.clip:hover {
  border-color: var(--clip-color);
}
.clip.selected {
  border-color: var(--bg-1);
  box-shadow: 0 0 0 2px var(--accent);
  z-index: 5;
}
.clip-inner {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 8px;
  position: relative;
  z-index: 2;
  pointer-events: none;
}
.clip-icon {
  color: color-mix(in srgb, var(--clip-color) 72%, var(--text-0));
  flex: 0 0 auto;
}
.clip-label {
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
.badge.anim {
  color: var(--yellow);
}
.badge.link-badge {
  color: var(--cyan);
}
.anim-shade {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
}
.anim-shade.in {
  left: 0;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--yellow) 35%, transparent),
    transparent
  );
}
.anim-shade.out {
  right: 0;
  background: linear-gradient(
    -90deg,
    color-mix(in srgb, var(--yellow) 35%, transparent),
    transparent
  );
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
  border-radius: 5px 0 0 5px;
}
.trim.r {
  right: 0;
  border-radius: 0 5px 5px 0;
}
.clip.selected .trim {
  background: color-mix(in srgb, var(--text-0) 22%, transparent);
}
.anim-handle {
  position: absolute;
  top: 0;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  background: var(--yellow);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  cursor: ew-resize;
  z-index: 4;
}
.anim-handle.exit {
  top: auto;
  bottom: 0;
}
</style>
