<script setup lang="ts">
/* SVG shapes browser (moved out of the old Add panel into its own rail tab).
   Served by the orch content library ("shapes" kind) with scroll pagination
   and search — the 1000-shape catalog is far too heavy to load eagerly.
   Grid previews come from meta.svg in the list response (fetchLibraryContent
   stays as a fallback), so a page render costs one metadata request. */
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

const SHAPE_PAGE_SIZE = 24
/* Categories map to slug/description prefixes baked into the catalog
   (orch scripts/lib/shapesCatalog.js) — the chip token ANDs with search. */
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

// Infinite scroll for the shape grid.
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

// first open loads the initial page
if (!svgShapes.value.length) loadShapes()

onBeforeUnmount(() => {
  shapeObserver?.disconnect()
  if (shapeQueryTimer) clearTimeout(shapeQueryTimer)
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
  editor.notify('Shape added', 'success')
}
</script>

<template>
  <div class="shape-panel">
    <h3 class="title">Shapes</h3>
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
        <span class="shape-name">{{ s.title }}</span>
      </button>
    </div>
    <div ref="shapeSentinel" class="sentinel" aria-hidden="true" />
    <p v-if="shapesMorePending" class="hint status">Loading more…</p>
    <p v-else-if="shapesError && svgShapes.length" class="hint status">⚠ {{ shapesError }}</p>
    <p v-else-if="!shapesHasMore && svgShapes.length" class="hint status">
      All {{ shapesTotal }} shapes loaded
    </p>
  </div>
</template>

<style scoped>
.shape-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
.shape-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sentinel {
  height: 1px;
}
.status {
  margin-top: 4px;
  text-align: center;
}
</style>
