<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import {
  fetchLibraryContent,
  fetchLibraryList,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'
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

/* ---------------- SVG shapes ----------------
   Served by the orch content library ("shapes" kind) — the SVG markup
   comes from the CDN, so shapes can be added without an editor deploy. */
const svgShapes = ref<
  { slug: string; title: string; svg: string; width: number; height: number }[]
>([])
const shapesPending = ref(false)
const shapesError = ref('')

async function loadShapes() {
  shapesPending.value = true
  shapesError.value = ''
  try {
    const items = await fetchLibraryList('shapes')
    svgShapes.value = await Promise.all(
      items.map(async (it) => {
        const content = await fetchLibraryContent('shapes', it.slug)
        return {
          slug: it.slug,
          title: it.title,
          svg: content.svg,
          width: content.width,
          height: content.height,
        }
      })
    )
  } catch (e) {
    shapesError.value = libraryErrorMessage(e)
  } finally {
    shapesPending.value = false
  }
}

function addSvg(shape: { svg: string; width: number; height: number }) {
  const added = project.addVisual(editor.context, {
    type: 'SVG',
    svg: shape.svg,
    width: shape.width,
    height: shape.height,
    position: 'center-center',
    ...defaultTiming(),
  })
  editor.selectVisual(added._id)
}

/* ---------------- HTML canvas presets ----------------
   Full-frame <canvas> overlays driven by customCode JS — the same
   HTML+JS the package captures with Puppeteer at render time.
   Served by the orch content library ("canvas-presets" kind). */
const showCanvases = ref(false)
const canvasPresets = ref<LibraryItem[]>([])
const canvasesPending = ref(false)
const canvasesError = ref('')
const addingCanvasSlug = ref('')

function toggleShapes() {
  showShapes.value = !showShapes.value
  if (showShapes.value) {
    showCanvases.value = false
    if (!svgShapes.value.length && !shapesPending.value) loadShapes()
  }
}
function toggleCanvases() {
  showCanvases.value = !showCanvases.value
  if (showCanvases.value) {
    showShapes.value = false
    if (!canvasPresets.value.length && !canvasesPending.value) loadCanvasPresets()
  }
}

async function loadCanvasPresets() {
  canvasesPending.value = true
  canvasesError.value = ''
  try {
    canvasPresets.value = await fetchLibraryList('canvas-presets')
  } catch (e) {
    canvasesError.value = libraryErrorMessage(e)
  } finally {
    canvasesPending.value = false
  }
}

async function addCanvasPreset(item: LibraryItem) {
  if (addingCanvasSlug.value) return
  addingCanvasSlug.value = item.slug
  try {
    const content = await fetchLibraryContent('canvas-presets', item.slug)
    const w = project.defaults.width
    const h = project.defaults.height
    const added = project.addVisual(editor.context, {
      type: 'TEXT',
      html: `<canvas width="${w}" height="${h}" style="display:block;width:100%;height:100%"></canvas>`,
      width: w,
      height: h,
      position: 'center-center',
      customCode: { js: content.js, animationDuration: content.animationDuration ?? 10 },
      ...defaultTiming(),
    })
    editor.selectVisual(added._id)
    editor.notify(`${item.title} canvas added — tweak its JS under Custom code`, 'success')
  } catch (e) {
    editor.notify(libraryErrorMessage(e), 'error')
  } finally {
    addingCanvasSlug.value = ''
  }
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
        <button
          class="type-card design"
          title="Visually build an animated illustration — layers, text animations, templates"
          @click="editor.openDesigner(null)"
        >
          <UiIcon name="magic" :size="18" />
          Design
        </button>
        <button class="type-card" @click="mediaKind = mediaKind === 'AUDIO' ? null : 'AUDIO'">
          <UiIcon name="audio" :size="18" />
          Audio
        </button>
        <button
          class="type-card"
          :class="{ open: mediaKind === null && showShapes }"
          @click="toggleShapes"
        >
          <UiIcon name="svg" :size="18" />
          Shape
        </button>
        <button
          class="type-card"
          :class="{ open: mediaKind === null && showCanvases }"
          @click="toggleCanvases"
        >
          <UiIcon name="code" :size="18" />
          Canvas
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
        <p v-if="shapesPending" class="hint grid-span">Loading shapes…</p>
        <template v-else-if="shapesError">
          <p class="hint grid-span">⚠ {{ shapesError }}</p>
          <button class="btn sm" @click="loadShapes()">Retry</button>
        </template>
        <button
          v-for="s in svgShapes"
          :key="s.slug"
          class="shape-card"
          :title="s.title"
          @click="addSvg(s)"
        >
          <span class="shape-preview" v-html="s.svg" />
          <span>{{ s.title }}</span>
        </button>
      </div>

      <div v-if="showCanvases" class="canvas-list">
        <p class="hint">
          Animated full-frame &lt;canvas&gt; overlays. The JS lives in the
          element's Custom code section — edit it freely after adding.
        </p>
        <p v-if="canvasesPending" class="hint">Loading presets…</p>
        <template v-else-if="canvasesError">
          <p class="hint">⚠ {{ canvasesError }}</p>
          <button class="btn sm" @click="loadCanvasPresets()">Retry</button>
        </template>
        <button
          v-for="c in canvasPresets"
          :key="c.slug"
          class="canvas-card"
          :class="{ busy: addingCanvasSlug === c.slug }"
          :title="c.description ?? ''"
          @click="addCanvasPreset(c)"
        >
          <UiIcon name="code" :size="14" />
          <span class="canvas-name">{{ c.title }}</span>
          <span class="canvas-hint">{{ c.description }}</span>
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
.type-card.design {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}
.type-card.design:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
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
.shape-grid .grid-span {
  grid-column: 1 / -1;
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
.canvas-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
}
.canvas-card {
  display: grid;
  grid-template-columns: 20px 1fr;
  grid-template-rows: auto auto;
  column-gap: 7px;
  align-items: center;
  text-align: left;
  padding: 7px 9px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
}
.canvas-card:hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.canvas-card.busy {
  opacity: 0.6;
  pointer-events: none;
}
.canvas-card .canvas-name {
  font-size: 11.5px;
  font-weight: 600;
}
.canvas-card .canvas-hint {
  grid-column: 2;
  font-size: 10px;
  color: var(--text-3);
}
.canvas-card :deep(svg) {
  grid-row: span 2;
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
