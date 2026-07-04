<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorContext } from '~/composables/useEditorContext'
import { useStockStore, type StockKind, type StockItem } from '~/stores/stock'
import {
  setStockDragData,
  buildStockVisual,
  type StockDragPayload,
} from '~/utils/stockDrag'

const { project, editor, contextDuration } = useEditorContext()
const stock = useStockStore()

const KINDS: { id: StockKind; label: string; icon: string }[] = [
  { id: 'image', label: 'Images', icon: 'image' },
  { id: 'video', label: 'Videos', icon: 'video' },
  { id: 'gif', label: 'GIFs', icon: 'gif' },
]

const PROVIDER_LABELS: Record<string, string> = {
  pexels: 'Pexels',
  pixabay: 'Pixabay',
  unsplash: 'Unsplash',
  giphy: 'Giphy',
}

/* ---------------- search ---------------- */
const searchText = ref(stock.current.query)
let debounceTimer: ReturnType<typeof setTimeout> | undefined

watch(searchText, (q) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => stock.search(q.trim()), 450)
})

function searchNow() {
  clearTimeout(debounceTimer)
  stock.search(searchText.value.trim())
}

function setKind(kind: StockKind) {
  clearTimeout(debounceTimer)
  stock.setKind(kind)
  searchText.value = stock.byKind[kind].query
}

/* ---------------- infinite scroll ----------------
   Listens on the nearest scrollable ancestor (LeftRail's .rail-panel) and
   loads the next page when the grid bottom comes within LOAD_AHEAD_PX. */
const LOAD_AHEAD_PX = 420
const panelEl = ref<HTMLElement>()
let scrollRoot: HTMLElement | null = null

function findScrollRoot(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from.parentElement
  while (el) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') return el
    el = el.parentElement
  }
  return null
}

function nearBottom(): boolean {
  if (!scrollRoot) return false
  return (
    scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight <
    LOAD_AHEAD_PX
  )
}

function onRootScroll() {
  if (nearBottom()) void stock.loadMore()
}

onMounted(() => {
  void stock.loadProviders()
  if (!stock.current.initialized) void stock.refresh()
  if (panelEl.value) {
    scrollRoot = findScrollRoot(panelEl.value)
    scrollRoot?.addEventListener('scroll', onRootScroll, { passive: true })
  }
})
onBeforeUnmount(() => {
  scrollRoot?.removeEventListener('scroll', onRootScroll)
  clearTimeout(debounceTimer)
})

// After each batch renders (or the kind switches), keep loading while the
// list is too short to scroll — otherwise a sparse first page dead-ends.
watch(
  () => [stock.kind, stock.current.items.length, stock.current.loading],
  async () => {
    await nextTick()
    if (!stock.current.loading && nearBottom()) void stock.loadMore()
  }
)

/* ---------------- add / drag ---------------- */
function payloadOf(item: StockItem): StockDragPayload {
  return {
    kind: item.kind === 'video' ? 'VIDEO' : item.kind === 'gif' ? 'GIF' : 'IMAGE',
    src: item.src,
    width: item.width,
    height: item.height,
    duration: item.duration,
  }
}

function onDragStart(e: DragEvent, item: StockItem) {
  setStockDragData(e, payloadOf(item))
}

function addItem(item: StockItem) {
  const visual = buildStockVisual(payloadOf(item), {
    playhead: editor.playhead,
    contextDuration: contextDuration.value,
    projectWidth: project.defaults.width,
    projectHeight: project.defaults.height,
  })
  const added = project.addVisual(editor.context, visual)
  editor.selectVisual(added._id)
  editor.notify(
    `${PROVIDER_LABELS[item.provider] ?? item.provider} ${item.kind} added — drop on the canvas to place precisely`,
    'success'
  )
}

function cellTitle(item: StockItem) {
  const credit = item.credit?.name ? ` — ${item.credit.name}` : ''
  return `${item.description || item.kind}${credit} (${PROVIDER_LABELS[item.provider] ?? item.provider}). Click to add, or drag onto the canvas.`
}

function fmtDuration(s?: number) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const ss = Math.round(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

const attribution = computed(() =>
  stock.kind === 'gif'
    ? 'Powered by GIPHY'
    : stock.kind === 'video'
      ? 'Free videos from Pexels & Pixabay'
      : 'Free photos from Pexels, Pixabay & Unsplash'
)

const showProviderChips = computed(() => stock.kindProviders.length > 1)
const skeletons = 8
</script>

<template>
  <div ref="panelEl" class="stock-panel">
    <div class="kind-tabs">
      <button
        v-for="k in KINDS"
        :key="k.id"
        class="kind-tab"
        :class="{ active: stock.kind === k.id }"
        @click="setKind(k.id)"
      >
        <UiIcon :name="k.icon" :size="13" />
        {{ k.label }}
      </button>
    </div>

    <div class="searchbar">
      <UiIcon name="zoom" :size="14" />
      <input
        v-model="searchText"
        class="search-input"
        type="text"
        :placeholder="`Search ${stock.kind === 'gif' ? 'GIFs' : stock.kind + 's'}…`"
        spellcheck="false"
        @keydown.enter.prevent="searchNow"
      />
      <button
        v-if="searchText"
        class="clear-btn"
        title="Clear search"
        @click="((searchText = ''), searchNow())"
      >
        <UiIcon name="close" :size="12" />
      </button>
    </div>

    <div v-if="showProviderChips" class="chips">
      <button
        class="chip"
        :class="{ active: stock.current.provider === 'all' }"
        @click="stock.setProvider('all')"
      >
        All
      </button>
      <button
        v-for="p in stock.kindProviders"
        :key="p"
        class="chip"
        :class="{ active: stock.current.provider === p }"
        @click="stock.setProvider(p)"
      >
        {{ PROVIDER_LABELS[p] ?? p }}
      </button>
    </div>

    <div v-if="stock.current.providerErrors" class="provider-warn">
      <UiIcon name="warning" :size="12" />
      <span>
        <template v-for="(msg, p, i) in stock.current.providerErrors" :key="p"
          ><template v-if="i > 0">, </template
          >{{ PROVIDER_LABELS[p] ?? p }} unavailable{{ /429|rate limit/i.test(msg) ? ' (rate limit)' : '' }}</template
        >
        — showing the other providers.
      </span>
    </div>

    <div v-if="stock.current.error" class="state-box error">
      <p>{{ stock.current.error }}</p>
      <button class="btn ghost sm" @click="stock.retry()">Retry</button>
    </div>

    <p
      v-else-if="!stock.current.loading && stock.current.initialized && !stock.current.items.length"
      class="state-box hint"
    >
      No {{ stock.kind }}s found<span v-if="stock.current.query"> for “{{ stock.current.query }}”</span> —
      try another search term or provider.
    </p>

    <div class="grid" :class="{ gifs: stock.kind === 'gif' }">
      <button
        v-for="item in stock.current.items"
        :key="item.id"
        class="cell"
        draggable="true"
        :title="cellTitle(item)"
        @dragstart="onDragStart($event, item)"
        @click="addItem(item)"
      >
        <img :src="item.preview" loading="lazy" draggable="false" alt="" />
        <span class="badge provider">{{ PROVIDER_LABELS[item.provider] ?? item.provider }}</span>
        <span v-if="item.duration" class="badge duration">{{ fmtDuration(item.duration) }}</span>
        <span v-if="item.kind === 'video'" class="play-hint"><UiIcon name="play" :size="14" /></span>
      </button>

      <template v-if="stock.current.loading">
        <div v-for="i in skeletons" :key="`sk-${i}`" class="cell skeleton" />
      </template>
    </div>

    <p v-if="!stock.current.hasMore && stock.current.items.length" class="end-note">
      That's everything for this search.
    </p>

    <p class="attribution">{{ attribution }} · click or drag onto the canvas</p>
  </div>
</template>

<style scoped>
.stock-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.kind-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.kind-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 4px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 600;
}
.kind-tab:hover {
  color: var(--text-0);
  border-color: var(--accent);
}
.kind-tab.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-strong);
}
.searchbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-3);
}
.searchbar:focus-within {
  border-color: var(--accent);
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 11.5px;
  outline: none;
}
.clear-btn {
  display: flex;
  padding: 2px;
  border: none;
  background: none;
  color: var(--text-3);
}
.clear-btn:hover {
  color: var(--text-0);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  padding: 3px 9px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10px;
  font-weight: 600;
}
.chip:hover {
  color: var(--text-0);
  border-color: var(--accent);
}
.chip.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-strong);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.cell {
  position: relative;
  height: 76px;
  padding: 0;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  overflow: hidden;
  cursor: grab;
}
.grid.gifs .cell {
  height: 90px;
}
.cell:hover {
  border-color: var(--accent);
}
.cell:active {
  cursor: grabbing;
}
.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.badge {
  position: absolute;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  pointer-events: none;
}
.badge.provider {
  left: 4px;
  bottom: 4px;
  opacity: 0;
  transition: opacity 0.12s;
}
.cell:hover .badge.provider {
  opacity: 1;
}
.badge.duration {
  right: 4px;
  bottom: 4px;
  font-variant-numeric: tabular-nums;
}
.play-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.25);
}
.cell:hover .play-hint {
  opacity: 1;
}
.cell.skeleton {
  border-color: var(--border-0);
  background: linear-gradient(100deg, var(--bg-2) 40%, var(--bg-3) 50%, var(--bg-2) 60%);
  background-size: 200% 100%;
  animation: stock-shimmer 1.2s infinite linear;
  cursor: default;
}
@keyframes stock-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -80% 0;
  }
}
.provider-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid rgba(245, 201, 68, 0.4);
  border-radius: var(--radius-m);
  background: rgba(245, 201, 68, 0.08);
  color: #e8c25a;
  font-size: 10.5px;
  line-height: 1.45;
}
.provider-warn :deep(svg) {
  flex: 0 0 auto;
  margin-top: 1px;
}
.state-box {
  padding: 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  font-size: 11px;
  color: var(--text-2);
}
.state-box.error {
  display: flex;
  flex-direction: column;
  gap: 7px;
  border-color: rgba(244, 98, 110, 0.5);
  color: #f4a2aa;
}
.state-box.error p {
  margin: 0;
  word-break: break-word;
}
.end-note,
.attribution {
  margin: 0;
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
}
.attribution {
  padding-bottom: 4px;
}
</style>
