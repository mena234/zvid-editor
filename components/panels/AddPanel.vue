<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()

const mediaUrl = ref('')
const mediaKind = ref<null | 'VIDEO' | 'IMAGE' | 'GIF' | 'AUDIO'>(null)
const showShapes = ref(false)

const RECENT_KEY = 'zvid-editor:recent-media'
const recent = ref<{ kind: string; src: string }[]>(loadRecent())

function loadRecent(): { kind: string; src: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
function pushRecent(kind: string, src: string) {
  recent.value = [
    { kind, src },
    ...recent.value.filter((r) => r.src !== src),
  ].slice(0, 12)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
}

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

function addText() {
  const added = project.addVisual(editor.context, {
    type: 'TEXT',
    text: 'Your text here',
    position: 'center-center',
    style: { fontSize: '64px', color: '#ffffff', fontWeight: 'bold' },
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
  editor.notify('Text added — edit it in the inspector', 'success')
}

const SVG_SHAPES: Record<string, { label: string; svg: string; w: number; h: number }> = {
  rect: {
    label: 'Rectangle',
    w: 400,
    h: 260,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect x="8" y="8" width="384" height="244" rx="18" fill="#5b8cff"/></svg>',
  },
  circle: {
    label: 'Circle',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><circle cx="150" cy="150" r="140" fill="#9d6bff"/></svg>',
  },
  line: {
    label: 'Line',
    w: 400,
    h: 20,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 20"><line x1="10" y1="10" x2="390" y2="10" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/></svg>',
  },
  arrow: {
    label: 'Arrow',
    w: 400,
    h: 120,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><path d="M10 60h300M310 60l-70-45M310 60l-70 45" stroke="#3ecf8e" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  star: {
    label: 'Star',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M150 15l41 84 93 13-67 66 16 92-83-44-83 44 16-92-67-66 93-13z" fill="#f5c944"/></svg>',
  },
  blob: {
    label: 'Blob',
    w: 300,
    h: 300,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path d="M62 84c26-45 92-64 138-40s62 82 40 130-84 74-132 52S36 129 62 84z" fill="#41c7d4"/></svg>',
  },
}

function addSvg(shapeKey: string) {
  const shape = SVG_SHAPES[shapeKey]
  const added = project.addVisual(editor.context, {
    type: 'SVG',
    svg: shape.svg,
    width: shape.w,
    height: shape.h,
    position: 'center-center',
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
}

function addMedia() {
  const src = mediaUrl.value.trim()
  const kind = mediaKind.value
  if (!src || !kind) return
  pushRecent(kind, src)
  if (kind === 'AUDIO') {
    const added = project.addAudio(editor.context, { src })
    editor.selectAudio(added._id)
  } else {
    const added = project.addVisual(editor.context, {
      type: kind,
      src,
      position: 'center-center',
      anchor: 'center-center',
      ...(kind !== 'GIF' ? { resize: 'contain' as const } : {}),
      ...defaultTiming(),
    })
    editor.selectVisual(added._id)
  }
  mediaUrl.value = ''
  mediaKind.value = null
  editor.notify('Element added', 'success')
}

function addRecent(r: { kind: string; src: string }) {
  mediaKind.value = r.kind as any
  mediaUrl.value = r.src
  addMedia()
}

const kindLabel = computed(
  () =>
    (({ VIDEO: 'video', IMAGE: 'image', GIF: 'GIF', AUDIO: 'audio' }) as any)[
      mediaKind.value ?? ''
    ]
)
</script>

<template>
  <div class="add-panel">
    <UiSection title="Add elements">
      <div class="type-grid">
        <button class="type-card" @click="mediaKind = mediaKind === 'VIDEO' ? null : 'VIDEO'">
          <UiIcon name="video" :size="18" />
          Video
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'IMAGE' ? null : 'IMAGE'">
          <UiIcon name="image" :size="18" />
          Image
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'GIF' ? null : 'GIF'">
          <UiIcon name="gif" :size="18" />
          GIF
        </button>
        <button class="type-card" @click="addText">
          <UiIcon name="text" :size="18" />
          Text
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'AUDIO' ? null : 'AUDIO'">
          <UiIcon name="audio" :size="18" />
          Audio
        </button>
        <button
          class="type-card"
          :class="{ open: mediaKind === null && showShapes }"
          @click="showShapes = !showShapes"
        >
          <UiIcon name="svg" :size="18" />
          Shape
        </button>
      </div>

      <form v-if="mediaKind" class="url-form" @submit.prevent="addMedia">
        <label class="hint">{{ kindLabel }} URL (or server-local path)</label>
        <input
          v-model="mediaUrl"
          class="ctl"
          type="text"
          :placeholder="`https://… .${mediaKind === 'AUDIO' ? 'mp3' : mediaKind === 'VIDEO' ? 'mp4' : 'png'}`"
          spellcheck="false"
          autofocus
        />
        <div class="row">
          <button type="submit" class="btn primary sm" :disabled="!mediaUrl.trim()">
            Add {{ kindLabel }}
          </button>
          <button type="button" class="btn ghost sm" @click="mediaKind = null">Cancel</button>
        </div>
        <p class="hint">
          The URL must stay reachable by the render machine — remote URLs are the
          automation-friendly choice.
        </p>
      </form>

      <div v-if="showShapes" class="shape-grid">
        <button
          v-for="(s, key) in SVG_SHAPES"
          :key="key"
          class="shape-card"
          :title="s.label"
          @click="addSvg(key as string)"
        >
          <span class="shape-preview" v-html="s.svg" />
          <span>{{ s.label }}</span>
        </button>
      </div>
    </UiSection>

    <UiSection v-if="recent.length" title="Recent media" collapsible>
      <button
        v-for="(r, i) in recent"
        :key="i"
        class="recent-row"
        :title="r.src"
        @click="addRecent(r)"
      >
        <UiIcon
          :name="r.kind === 'AUDIO' ? 'audio' : r.kind === 'VIDEO' ? 'video' : 'image'"
          :size="13"
        />
        <span class="recent-src">{{ r.src }}</span>
      </button>
    </UiSection>

    <UiSection title="Tips" collapsible :start-open="false">
      <p class="hint">
        • Drag elements on the canvas; use the timeline to set when they appear.<br />
        • <kbd>S</kbd> splits the selected clip at the playhead.<br />
        • Right-click an element for quick actions.<br />
        • Everything you build exports as zvid JSON — press
        <b>Export JSON</b> when done.
      </p>
    </UiSection>
  </div>
</template>

<style scoped>
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 11px 4px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 10.5px;
  font-weight: 600;
}
.type-card:hover {
  border-color: var(--accent);
  color: var(--text-0);
  background: var(--bg-3);
}
.url-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.row {
  display: flex;
  gap: 6px;
}
.shape-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
}
.shape-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10px;
}
.shape-card:hover {
  border-color: var(--accent);
}
.shape-preview {
  width: 44px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.shape-preview :deep(svg) {
  max-width: 100%;
  max-height: 100%;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 7px;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--text-1);
  font-size: 11px;
  text-align: left;
}
.recent-row:hover {
  background: var(--bg-3);
  color: var(--text-0);
}
.recent-src {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
}
</style>
