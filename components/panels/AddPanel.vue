<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import {
  fetchLibraryContent,
  fetchLibraryPage,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'
import { round3 } from '~/utils/time'
import { useTemplateVars } from '~/composables/useTemplateVars'

const { project, editor, contextDuration, activeScene } = useEditorContext()
const tvars = useTemplateVars()

const varOptions = computed(() =>
  tvars.placeholderOptions(activeScene.value, 'string')
)

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
   Served by the orch content library ("shapes" kind) with scroll pagination
   and search — the 1000-shape catalog would be far too heavy to load eagerly.
   Grid previews come from meta.svg in the list response (backfilled for the
   original shapes; fetchLibraryContent stays as a fallback), so a page render
   costs one metadata request, not one CDN fetch per tile. */
const SHAPE_PAGE_SIZE = 24
/* Categories map to slug/description prefixes baked into the catalog
   (orch scripts/lib/shapesCatalog.js) — the chip token ANDs with the text
   search on the server. */
const SHAPE_CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'core-', label: 'Basic' },
  { key: 'txt-', label: 'Text' },
  { key: 'callout-', label: 'Callouts' },
  { key: 'bg-', label: 'Backgrounds' },
  { key: 'promo-', label: 'Marketing' },
  { key: 'chart-', label: 'Charts' },
  { key: 'frame-', label: 'Frames' },
  { key: 'motion-', label: 'Motion' },
  { key: 'ui-', label: 'UI' },
  { key: 'deco-', label: 'Accents' },
] as const
const shapeCategory = ref('')
type ShapeTile = { slug: string; title: string; svg: string; width: number; height: number }
const svgShapes = ref<ShapeTile[]>([])
const shapesTotal = ref(0)
const shapesHasMore = ref(false)
const shapesPending = ref(false)
const shapesMorePending = ref(false)
const shapesError = ref('')
const shapeQuery = ref('')
const shapeSentinel = ref<HTMLElement | null>(null)
let shapeObserver: IntersectionObserver | null = null
let shapeQueryTimer: ReturnType<typeof setTimeout> | null = null
let shapeLoadId = 0

async function resolveShapeTile(it: LibraryItem): Promise<ShapeTile> {
  if (it.meta?.svg) {
    return {
      slug: it.slug,
      title: it.title,
      svg: it.meta.svg,
      width: it.meta.width ?? 300,
      height: it.meta.height ?? 300,
    }
  }
  const content = await fetchLibraryContent('shapes', it.slug)
  return {
    slug: it.slug,
    title: it.title,
    svg: content.svg,
    width: content.width,
    height: content.height,
  }
}

function shapeSearchQ() {
  return [shapeCategory.value, shapeQuery.value.trim()].filter(Boolean).join(' ')
}

async function loadShapes() {
  const id = ++shapeLoadId
  shapesPending.value = true
  shapesError.value = ''
  try {
    const page = await fetchLibraryPage('shapes', SHAPE_PAGE_SIZE, 0, shapeSearchQ())
    const tiles = await Promise.all(page.items.map(resolveShapeTile))
    if (id !== shapeLoadId) return // a newer search superseded this load
    svgShapes.value = tiles
    shapesTotal.value = page.total
    shapesHasMore.value = page.hasMore
  } catch (e) {
    if (id === shapeLoadId) shapesError.value = libraryErrorMessage(e)
  } finally {
    if (id === shapeLoadId) shapesPending.value = false
  }
}

async function loadMoreShapes() {
  if (shapesMorePending.value || shapesPending.value || !shapesHasMore.value) return
  const id = shapeLoadId
  shapesMorePending.value = true
  try {
    const page = await fetchLibraryPage(
      'shapes',
      SHAPE_PAGE_SIZE,
      svgShapes.value.length,
      shapeSearchQ()
    )
    const tiles = await Promise.all(page.items.map(resolveShapeTile))
    if (id !== shapeLoadId) return
    svgShapes.value = [...svgShapes.value, ...tiles]
    shapesTotal.value = page.total
    shapesHasMore.value = page.hasMore
  } catch (e) {
    if (id === shapeLoadId) shapesError.value = libraryErrorMessage(e)
  } finally {
    shapesMorePending.value = false
  }
}

// Debounced search: reload the first page whenever the query settles.
watch(shapeQuery, () => {
  if (shapeQueryTimer) clearTimeout(shapeQueryTimer)
  shapeQueryTimer = setTimeout(() => loadShapes(), 250)
})
function pickShapeCategory(key: string) {
  if (shapeCategory.value === key) return
  shapeCategory.value = key
  loadShapes()
}

// Infinite scroll for the shape grid (same pattern as the canvas presets).
watch(shapeSentinel, (el) => {
  shapeObserver?.disconnect()
  shapeObserver = null
  if (!el) return
  shapeObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreShapes()
    },
    { rootMargin: '160px' }
  )
  shapeObserver.observe(el)
})

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
   Served by the orch content library ("canvas-presets" kind) with scroll
   pagination; each tile shows the CDN thumbnail (meta.thumbnail) and plays
   the CDN preview video (meta.preview) while hovered. */
const CANVAS_PAGE_SIZE = 12
const showCanvases = ref(false)
const canvasPresets = ref<LibraryItem[]>([])
const canvasTotal = ref(0)
const canvasHasMore = ref(false)
const canvasesPending = ref(false)
const canvasMorePending = ref(false)
const canvasesError = ref('')
const addingCanvasSlug = ref('')
const hoverCanvasSlug = ref('')
const canvasSentinel = ref<HTMLElement | null>(null)
let canvasObserver: IntersectionObserver | null = null

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
    const page = await fetchLibraryPage('canvas-presets', CANVAS_PAGE_SIZE, 0)
    canvasPresets.value = page.items
    canvasTotal.value = page.total
    canvasHasMore.value = page.hasMore
  } catch (e) {
    canvasesError.value = libraryErrorMessage(e)
  } finally {
    canvasesPending.value = false
  }
}

async function loadMoreCanvases() {
  if (canvasMorePending.value || canvasesPending.value || !canvasHasMore.value) return
  canvasMorePending.value = true
  try {
    const page = await fetchLibraryPage(
      'canvas-presets',
      CANVAS_PAGE_SIZE,
      canvasPresets.value.length
    )
    canvasPresets.value = [...canvasPresets.value, ...page.items]
    canvasTotal.value = page.total
    canvasHasMore.value = page.hasMore
  } catch (e) {
    canvasesError.value = libraryErrorMessage(e)
  } finally {
    canvasMorePending.value = false
  }
}

// Infinite scroll: fetch the next page whenever the sentinel below the grid
// scrolls near the viewport. The sentinel only exists while the grid is open.
watch(canvasSentinel, (el) => {
  canvasObserver?.disconnect()
  canvasObserver = null
  if (!el) return
  canvasObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreCanvases()
    },
    { rootMargin: '160px' }
  )
  canvasObserver.observe(el)
})
onBeforeUnmount(() => {
  canvasObserver?.disconnect()
  shapeObserver?.disconnect()
  if (shapeQueryTimer) clearTimeout(shapeQueryTimer)
})

function onCanvasEnter(slug: string) {
  hoverCanvasSlug.value = slug
}
function onCanvasLeave(slug: string) {
  if (hoverCanvasSlug.value === slug) hoverCanvasSlug.value = ''
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
  if (src.includes('{{')) {
    // Strict: unknown/mistyped placeholders never enter the document.
    const check = tvars.validateTemplateValue(src, 'string', activeScene.value)
    if (!check.ok) {
      editor.notify(check.message, 'error')
      return
    }
  }
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
        <div class="url-row">
          <input
            v-model="mediaUrl"
            class="ctl"
            type="text"
            :placeholder="`https://… .${mediaKind === 'AUDIO' ? 'mp3' : mediaKind === 'VIDEO' ? 'mp4' : 'png'}`"
            spellcheck="false"
            autofocus
          />
          <UiVarMenu
            :options="varOptions"
            title="Use a variable for the URL"
            @insert="mediaUrl = $event"
          />
        </div>
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

      <div v-if="showShapes" class="shape-list">
        <input
          v-model="shapeQuery"
          class="ctl shape-search"
          type="search"
          placeholder="Search shapes… (arrow, badge, wave)"
          spellcheck="false"
        />
        <div class="shape-cats">
          <button
            v-for="c in SHAPE_CATEGORIES"
            :key="c.key"
            class="shape-cat"
            :class="{ active: shapeCategory === c.key }"
            @click="pickShapeCategory(c.key)"
          >
            {{ c.label }}
          </button>
        </div>
        <div class="shape-grid">
          <p v-if="shapesPending" class="hint grid-span">Loading shapes…</p>
          <template v-else-if="shapesError && !svgShapes.length">
            <p class="hint grid-span">⚠ {{ shapesError }}</p>
            <button class="btn sm" @click="loadShapes()">Retry</button>
          </template>
          <p v-else-if="!svgShapes.length" class="hint grid-span">
            No shapes match “{{ shapeQuery }}”
          </p>
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
        <div ref="shapeSentinel" class="canvas-sentinel" aria-hidden="true" />
        <p v-if="shapesMorePending" class="hint canvas-status">Loading more…</p>
        <p v-else-if="shapesError && svgShapes.length" class="hint canvas-status">
          ⚠ {{ shapesError }}
        </p>
        <p v-else-if="!shapesHasMore && svgShapes.length" class="hint canvas-status">
          All {{ shapesTotal }} shapes loaded
        </p>
      </div>

      <div v-if="showCanvases" class="canvas-list">
        <p class="hint">
          Animated full-frame &lt;canvas&gt; overlays. Hover a tile to preview
          it in motion; the JS lives in the element's Custom code section —
          edit it freely after adding.
        </p>
        <p v-if="canvasesPending" class="hint">Loading presets…</p>
        <template v-else-if="canvasesError && !canvasPresets.length">
          <p class="hint">⚠ {{ canvasesError }}</p>
          <button class="btn sm" @click="loadCanvasPresets()">Retry</button>
        </template>
        <template v-else>
          <div class="canvas-grid">
            <button
              v-for="c in canvasPresets"
              :key="c.slug"
              class="canvas-tile"
              :class="{ busy: addingCanvasSlug === c.slug }"
              :title="c.description ?? ''"
              @click="addCanvasPreset(c)"
              @mouseenter="onCanvasEnter(c.slug)"
              @mouseleave="onCanvasLeave(c.slug)"
              @focus="onCanvasEnter(c.slug)"
              @blur="onCanvasLeave(c.slug)"
            >
              <img
                v-if="c.meta?.thumbnail"
                class="canvas-thumb"
                :src="c.meta.thumbnail"
                :alt="c.title"
              />
              <span v-else class="canvas-thumb canvas-thumb-fallback">
                <UiIcon name="code" :size="16" />
              </span>
              <video
                v-if="hoverCanvasSlug === c.slug && c.meta?.preview"
                class="canvas-video"
                :src="c.meta.preview"
                autoplay
                muted
                loop
                playsinline
              />
              <span class="canvas-title">{{ c.title }}</span>
            </button>
          </div>
          <div ref="canvasSentinel" class="canvas-sentinel" aria-hidden="true" />
          <p v-if="canvasMorePending" class="hint canvas-status">Loading more…</p>
          <p v-else-if="canvasesError" class="hint canvas-status">⚠ {{ canvasesError }}</p>
          <p v-else-if="!canvasHasMore && canvasPresets.length" class="hint canvas-status">
            All {{ canvasTotal }} presets loaded
          </p>
        </template>
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
.url-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.url-row .ctl {
  flex: 1;
  min-width: 0;
}
.row {
  display: flex;
  gap: 6px;
}
.shape-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.shape-search {
  width: 100%;
}
.shape-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.shape-cat {
  padding: 3px 8px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10px;
  font-weight: 600;
}
.shape-cat:hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.shape-cat.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.shape-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
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
.canvas-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.canvas-tile {
  position: relative;
  aspect-ratio: 16 / 9;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-1);
  cursor: pointer;
}
.canvas-tile:hover {
  border-color: var(--accent);
}
.canvas-tile.busy {
  opacity: 0.6;
  pointer-events: none;
}
.canvas-thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.canvas-thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.canvas-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.canvas-title {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 6px 4px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.canvas-sentinel {
  height: 1px;
}
.canvas-status {
  margin-top: 4px;
  text-align: center;
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
