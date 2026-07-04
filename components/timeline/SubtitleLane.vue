<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { round3, clamp } from '~/utils/time'

const props = defineProps<{ headerW: number; pxPerSec: number }>()

const project = useProjectStore()
const editor = useEditorStore()

const captions = computed(() => project.doc.subtitle?.captions ?? [])

/* ---------------- gestures ---------------- */
type Mode = 'move' | 'trim-l' | 'trim-r'
let gesture: {
  mode: Mode
  index: number
  startX: number
  start0: number
  end0: number
  words0: { start: number; end: number; text: string }[]
  moved: boolean
} | null = null

function beginGesture(e: PointerEvent, index: number, mode: Mode) {
  if (e.button !== 0) return
  e.stopPropagation()
  const c = captions.value[index]
  editor.selectCaption(index)
  editor.leftPanel = 'subtitles'
  gesture = {
    mode,
    index,
    startX: e.clientX,
    start0: c.start,
    end0: c.end,
    words0: (c.words ?? []).map((w) => ({ ...w })),
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
  const c = captions.value[g.index]
  if (!c) return

  if (g.mode === 'move') {
    const shift = Math.max(-g.start0, dt)
    c.start = round3(g.start0 + shift)
    c.end = round3(g.end0 + shift)
    c.words = g.words0.map((w) => ({
      ...w,
      start: round3(w.start + shift),
      end: round3(w.end + shift),
    }))
  } else if (g.mode === 'trim-l') {
    c.start = round3(clamp(g.start0 + dt, 0, g.end0 - 0.05))
  } else {
    c.end = round3(Math.max(g.start0 + 0.05, g.end0 + dt))
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
  <div class="tl-row sub-row">
    <div class="tl-header">
      <span class="lane-badge">CC</span>
      <button
        class="icon-btn sm-btn"
        title="Open the subtitles panel"
        @click="editor.leftPanel = 'subtitles'"
      >
        <UiIcon name="subtitles" :size="13" />
      </button>
    </div>
    <div class="lane">
      <div
        v-for="(c, i) in captions"
        :key="i"
        class="caption-block"
        :class="{ selected: editor.selectionKind === 'caption' && editor.selectedCaptionIndex === i }"
        :style="{
          left: `${c.start * pxPerSec}px`,
          width: `${Math.max(8, (c.end - c.start) * pxPerSec)}px`,
        }"
        :title="c.text ?? c.words?.map((w) => w.text).join(' ')"
        @pointerdown="beginGesture($event, i, 'move')"
      >
        <span class="caption-text">{{
          c.text ?? c.words?.map((w) => w.text).join(' ')
        }}</span>
        <div class="trim l" @pointerdown="beginGesture($event, i, 'trim-l')" />
        <div class="trim r" @pointerdown="beginGesture($event, i, 'trim-r')" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-row {
  min-height: 30px;
}
.tl-row {
  display: flex;
  border-bottom: 1px solid var(--border-0);
}
.tl-header {
  position: sticky;
  left: 0;
  z-index: 20;
  width: 148px;
  flex: 0 0 148px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  background: var(--bg-2);
  border-right: 1px solid var(--border-0);
}
.lane-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--orange);
}
.sm-btn {
  width: 20px;
  height: 20px;
}
.lane {
  position: relative;
  flex: 1;
}
.caption-block {
  position: absolute;
  top: 4px;
  height: 21px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--orange) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--orange) 50%, transparent);
  display: flex;
  align-items: center;
  padding: 0 6px;
  cursor: grab;
  overflow: hidden;
  user-select: none;
}
.caption-block:hover {
  border-color: var(--orange);
}
.caption-block.selected {
  border-color: var(--bg-1);
  box-shadow: 0 0 0 2px var(--accent);
  z-index: 3;
}
.caption-text {
  font-size: 9.5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trim {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}
.trim.l {
  left: 0;
}
.trim.r {
  right: 0;
}
</style>
