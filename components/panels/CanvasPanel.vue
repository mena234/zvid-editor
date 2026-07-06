<script setup lang="ts">
/* Animated full-frame <canvas> presets (moved out of the old Add panel).
   Served by the orch content library ("canvas-presets" kind) with scroll
   pagination; each tile shows the CDN thumbnail (meta.thumbnail) and plays
   the CDN preview video (meta.preview) while hovered. */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import {
  fetchLibraryContent,
  fetchLibraryPage,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'
import { round3 } from '~/utils/time'

const { project, editor, contextDuration } = useEditorContext()

function defaultTiming() {
  const t0 = round3(Math.min(editor.playhead, Math.max(0, contextDuration.value - 1)))
  return {
    enterBegin: t0 || undefined,
    exitEnd: round3(Math.min(contextDuration.value, t0 + 5)),
  }
}

const CANVAS_PAGE_SIZE = 12
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

// Infinite scroll: fetch the next page whenever the sentinel nears the viewport.
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

if (!canvasPresets.value.length) loadCanvasPresets()

onBeforeUnmount(() => canvasObserver?.disconnect())

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
</script>

<template>
  <div class="canvas-panel">
    <h3 class="title">Canvas presets</h3>
    <p class="hint">
      Animated full-frame &lt;canvas&gt; overlays. Hover a tile to preview it in
      motion; the JS lives in the element's Custom code section — edit it freely
      after adding.
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
      <div ref="canvasSentinel" class="sentinel" aria-hidden="true" />
      <p v-if="canvasMorePending" class="hint status">Loading more…</p>
      <p v-else-if="canvasesError" class="hint status">⚠ {{ canvasesError }}</p>
      <p v-else-if="!canvasHasMore && canvasPresets.length" class="hint status">
        All {{ canvasTotal }} presets loaded
      </p>
    </template>
  </div>
</template>

<style scoped>
.canvas-panel {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
}
.title {
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-1);
  text-transform: uppercase;
  letter-spacing: 0.4px;
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
.sentinel {
  height: 1px;
}
.status {
  margin-top: 4px;
  text-align: center;
}
</style>
