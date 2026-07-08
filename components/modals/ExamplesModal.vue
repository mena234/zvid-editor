<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useAuthStore } from '~/stores/auth'
import {
  fetchLibraryContent,
  fetchLibraryList,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'
import {
  EXAMPLE_CATEGORIES_WITH_OTHER,
  categoryKeyForPack,
  exampleCategory,
} from '~/data/exampleCategories'

const project = useProjectStore()
const editor = useEditorStore()
const auth = useAuthStore()
const dashUrl = useRuntimeConfig().public.dashUrl as string

const items = ref<LibraryItem[]>([])
const pending = ref(true)
const error = ref('')
const loadingSlug = ref('')
/** Card the pointer is over — that card swaps its thumbnail for the preview video. */
const hoverSlug = ref('')

/** Search box + selected category chip ('all' = every category). */
const query = ref('')
const activeCat = ref('all')

/**
 * Video vs Image examples live in one library, split by `meta.type` (legacy
 * video entries carry no type → treated as 'video'). The toggle opens on the
 * kind you're already editing so an image project sees image templates first.
 */
const mode = ref<'video' | 'image'>(project.isImage ? 'image' : 'video')
/** Items of the currently-selected kind — everything downstream works off this. */
const modeItems = computed(() =>
  items.value.filter((it) => (it.meta?.type ?? 'video') === mode.value)
)
const modeCounts = computed(() => {
  let image = 0
  for (const it of items.value) if (it.meta?.type === 'image') image++
  return { image, video: items.value.length - image }
})
function pickMode(m: 'video' | 'image') {
  if (mode.value === m) return
  mode.value = m
  activeCat.value = 'all'
}

/** Premium templates need a paid plan; everyone can still hover-preview them. */
function isLocked(item: LibraryItem): boolean {
  return !!item.meta?.premium && !auth.isPaid
}
const hasLocked = computed(() => modeItems.value.some(isLocked))

/** Which display category an item belongs to (by meta.pack, OTHER as fallback). */
function catKeyOf(item: LibraryItem): string {
  return categoryKeyForPack(item.meta?.pack)
}

/**
 * Lower-cased search haystack per item: its title, description and its
 * category's label + keyword synonyms, so an industry term (e.g. "crypto")
 * finds a whole category even when the word isn't in the template's own copy.
 */
const haystacks = computed(() => {
  const map = new Map<string, string>()
  for (const it of modeItems.value) {
    const cat = exampleCategory(catKeyOf(it))
    map.set(
      it.slug,
      [
        it.title,
        it.description ?? '',
        cat?.label ?? '',
        cat?.keywords.join(' ') ?? '',
      ]
        .join(' ')
        .toLowerCase()
    )
  }
  return map
})

/** Escape a raw user term so it stays literal inside the word-boundary regex. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const queryTerms = computed(() =>
  query.value.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
)
/** One \b-anchored regex per term, compiled once per query (not per item). */
const queryRes = computed(() =>
  queryTerms.value.map((t) => new RegExp('\\b' + escapeRegExp(t)))
)

/**
 * AND search: every term must match at a word boundary in the item's haystack.
 * Word-boundary (not bare substring) keeps "crypto"/"crypt" → Finance while a
 * short query like "art" matches "article"/"artificial" but NOT the middle of
 * "chart" — so it no longer drags in every Data-viz template. Punctuation is
 * handled naturally too: "wrapped" matches "(Wrapped)", "commerce" → e-commerce.
 */
function matchesQuery(item: LibraryItem): boolean {
  const res = queryRes.value
  if (!res.length) return true
  const hay = haystacks.value.get(item.slug) ?? ''
  return res.every((re) => re.test(hay))
}

/** Items matching the search box, ignoring the category chip (drives chip counts). */
const queryMatched = computed(() => modeItems.value.filter(matchesQuery))

/** Chip list: every category that has at least one item, with its match count. */
const visibleCats = computed(() => {
  const base = new Map<string, number>()
  for (const it of modeItems.value) {
    base.set(catKeyOf(it), (base.get(catKeyOf(it)) ?? 0) + 1)
  }
  const matched = new Map<string, number>()
  for (const it of queryMatched.value) {
    matched.set(catKeyOf(it), (matched.get(catKeyOf(it)) ?? 0) + 1)
  }
  return EXAMPLE_CATEGORIES_WITH_OTHER.filter((c) => base.has(c.key)).map(
    (c) => ({
      key: c.key,
      label: c.label,
      blurb: c.blurb,
      count: matched.get(c.key) ?? 0,
    })
  )
})

const totalMatches = computed(() => queryMatched.value.length)

const activeCatLabel = computed(() =>
  activeCat.value === 'all' ? '' : exampleCategory(activeCat.value)?.label ?? ''
)

/** Items shown, after both the search box and the category chip. */
const filtered = computed(() =>
  activeCat.value === 'all'
    ? queryMatched.value
    : queryMatched.value.filter((it) => catKeyOf(it) === activeCat.value)
)

/**
 * Cards grouped into sections. Browsing "All" shows every non-empty category in
 * order; a selected chip collapses to that single section. Items keep the API's
 * sort_order (premium/curated first within each pack).
 */
const groups = computed(() => {
  const byCat = new Map<string, LibraryItem[]>()
  for (const it of filtered.value) {
    const k = catKeyOf(it)
    const arr = byCat.get(k)
    if (arr) arr.push(it)
    else byCat.set(k, [it])
  }
  return EXAMPLE_CATEGORIES_WITH_OTHER.filter((c) => byCat.has(c.key)).map(
    (c) => ({ key: c.key, label: c.label, blurb: c.blurb, items: byCat.get(c.key)! })
  )
})

function pickCat(key: string) {
  activeCat.value = key
}
/** Keep the search term, drop the category filter (recovers an empty category). */
function showAllMatches() {
  activeCat.value = 'all'
}
function clearFilters() {
  query.value = ''
  activeCat.value = 'all'
}

async function loadList() {
  pending.value = true
  error.value = ''
  try {
    items.value = await fetchLibraryList('examples')
  } catch (e) {
    error.value = libraryErrorMessage(e)
  } finally {
    pending.value = false
  }
}
onMounted(loadList)

async function load(item: LibraryItem) {
  if (loadingSlug.value) return
  if (isLocked(item)) {
    if (!auth.user) {
      // Sign in first — the session may reveal a paid plan; reopen after.
      editor.postAuthModal = 'examples'
      editor.openModal('auth')
    } else {
      editor.notify(
        'This is a PRO template — upgrade to a paid plan to use it.',
        'error'
      )
    }
    return
  }
  loadingSlug.value = item.slug
  try {
    const config = await fetchLibraryContent('examples', item.slug)
    project.loadRaw(config)
    editor.setContext('root')
    editor.clearSelection()
    editor.closeModal()
    editor.notify('Example loaded', 'success')
  } catch (e) {
    editor.notify(libraryErrorMessage(e), 'error')
  } finally {
    loadingSlug.value = ''
  }
}

function onEnter(slug: string) {
  hoverSlug.value = slug
}
function onLeave(slug: string) {
  if (hoverSlug.value === slug) hoverSlug.value = ''
}
</script>

<template>
  <UiModal title="Example projects" width="900px" @close="editor.closeModal()">
    <p class="hint intro">
      Curated example projects — hover a card to preview, click to load it into
      the editor. Loading replaces the current project.
      <template v-if="hasLocked">
        <span class="pro-chip">PRO</span> templates need a paid plan —
        <a class="upgrade-link" :href="`${dashUrl}/subscription`" target="_blank"
          >upgrade</a
        >.
      </template>
    </p>

    <template v-if="!pending && !error">
      <div class="ex-tools">
        <div class="ex-mode" role="tablist" aria-label="Example kind">
          <button
            class="ex-mode-btn"
            :class="{ active: mode === 'video' }"
            role="tab"
            :aria-selected="mode === 'video'"
            @click="pickMode('video')"
          >
            🎬 Videos <span class="ex-mode-n">{{ modeCounts.video }}</span>
          </button>
          <button
            class="ex-mode-btn"
            :class="{ active: mode === 'image' }"
            role="tab"
            :aria-selected="mode === 'image'"
            @click="pickMode('image')"
          >
            🖼 Images <span class="ex-mode-n">{{ modeCounts.image }}</span>
          </button>
        </div>
        <div class="ex-search-row">
          <input
            v-model="query"
            class="ctl ex-search"
            type="search"
            :placeholder="
              mode === 'image'
                ? 'Search image templates… (thumbnail, product, quote, og)'
                : 'Search examples… (crypto, real estate, quiz, sale)'
            "
            spellcheck="false"
            aria-label="Search example projects"
          />
          <span class="ex-count mono">{{ filtered.length }} / {{ modeItems.length }}</span>
        </div>
        <div class="ex-cats">
          <button
            class="ex-cat"
            :class="{ active: activeCat === 'all' }"
            @click="pickCat('all')"
          >
            All <span class="ex-cat-n">{{ totalMatches }}</span>
          </button>
          <button
            v-for="c in visibleCats"
            :key="c.key"
            class="ex-cat"
            :class="{ active: activeCat === c.key, 'is-empty': c.count === 0 }"
            :disabled="c.count === 0 && activeCat !== c.key"
            :title="c.blurb"
            @click="pickCat(c.key)"
          >
            {{ c.label }} <span class="ex-cat-n">{{ c.count }}</span>
          </button>
        </div>
      </div>
    </template>

    <p v-if="pending" class="hint">Loading examples…</p>
    <div v-else-if="error" class="error-box">
      <p class="hint">⚠ {{ error }}</p>
      <button class="btn sm" @click="loadList()">Retry</button>
    </div>
    <template v-else>
      <template v-if="!groups.length">
        <p
          v-if="totalMatches > 0 && activeCat !== 'all'"
          class="hint empty-note"
        >
          No {{ activeCatLabel }} examples match “{{ query }}”. Found
          {{ totalMatches }} in other categories —
          <button class="link-btn" @click="showAllMatches()">show all matches</button>.
        </p>
        <p v-else class="hint empty-note">
          No examples match your search. Try another term or
          <button class="link-btn" @click="clearFilters()">clear filters</button>.
        </p>
      </template>
      <section v-for="g in groups" :key="g.key" class="cat-section">
        <header class="cat-head">
          <h3 class="cat-title">
            {{ g.label }} <span class="cat-n">{{ g.items.length }}</span>
          </h3>
          <p class="cat-blurb">{{ g.blurb }}</p>
        </header>
        <div class="grid">
          <button
            v-for="ex in g.items"
            :key="ex.slug"
            class="card"
            :class="{ busy: loadingSlug === ex.slug, locked: isLocked(ex) }"
            @click="load(ex)"
            @mouseenter="onEnter(ex.slug)"
            @mouseleave="onLeave(ex.slug)"
            @focus="onEnter(ex.slug)"
            @blur="onLeave(ex.slug)"
          >
            <span class="shot">
              <img
                v-if="ex.meta?.thumbnail"
                class="thumb"
                :src="ex.meta.thumbnail"
                :alt="ex.title"
                loading="lazy"
              />
              <span v-else class="thumb thumb-fallback">
                <UiIcon
                  :name="ex.meta?.type === 'image' ? 'image' : ex.meta?.hasScenes ? 'scene' : ex.meta?.hasSubtitle ? 'subtitles' : 'film'"
                  :size="22"
                />
              </span>
              <video
                v-if="hoverSlug === ex.slug && ex.meta?.preview"
                class="shot-video"
                :src="ex.meta.preview"
                autoplay
                muted
                loop
                playsinline
              />
              <span v-if="ex.meta?.premium" class="pro-badge">
                <template v-if="isLocked(ex)">🔒 </template>PRO
              </span>
              <span v-if="ex.meta?.duration" class="shot-badge mono">
                {{ ex.meta.duration }}s
              </span>
              <span
                v-else-if="ex.meta?.type === 'image'"
                class="shot-badge mono"
              >
                {{ (ex.meta?.format || 'png').toUpperCase() }}
              </span>
            </span>
            <span class="card-head">
              <b>{{ ex.title }}</b>
            </span>
            <span class="card-desc">{{ ex.description }}</span>
            <span class="card-meta mono">
              {{ ex.meta?.type === 'image' && ex.meta?.size ? ex.meta.size : ex.meta?.resolution }}
              <template v-if="ex.meta?.scenes"> · {{ ex.meta.scenes }} scenes</template>
            </span>
          </button>
        </div>
      </section>
    </template>
  </UiModal>
</template>

<style scoped>
.intro {
  margin-bottom: 8px;
}
/* Search + category chips stay pinned while the card sections scroll. */
.ex-tools {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
  margin-bottom: 4px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-1);
}
.ex-mode {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  background: var(--bg-2);
}
.ex-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.ex-mode-btn:hover {
  color: var(--text-0);
}
.ex-mode-btn.active {
  background: var(--accent);
  color: #fff;
}
.ex-mode-n {
  font-size: 9.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.ex-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ex-search {
  flex: 1;
}
.ex-count {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
}
.ex-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ex-cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 10.5px;
  font-weight: 600;
}
.ex-cat:not(:disabled):hover {
  border-color: var(--accent);
  color: var(--text-0);
}
.ex-cat:disabled {
  cursor: default;
}
.ex-cat.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.ex-cat.is-empty {
  opacity: 0.4;
}
.ex-cat-n {
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}
.ex-cat.active .ex-cat-n {
  color: var(--accent-strong);
}
.cat-section {
  margin-bottom: 16px;
}
.cat-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 8px;
  flex-wrap: wrap;
}
.cat-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-0);
}
.cat-n {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.cat-blurb {
  margin: 0;
  font-size: 10px;
  color: var(--text-3);
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  background: var(--bg-1);
  color: var(--text-0);
  text-align: left;
}
.card:hover {
  border-color: var(--accent);
  background: var(--bg-3);
}
.card.busy {
  opacity: 0.6;
  pointer-events: none;
}
.shot {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: calc(var(--radius-m) - 3px);
  overflow: hidden;
  background: var(--bg-3);
}
.thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.shot-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.shot-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(10, 10, 16, 0.72);
  color: #fff;
  font-size: 9.5px;
}
.pro-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: linear-gradient(120deg, #d4af37, #f0d98c);
  color: #241c04;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.pro-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: linear-gradient(120deg, #d4af37, #f0d98c);
  color: #241c04;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  vertical-align: 1px;
}
.upgrade-link {
  color: var(--accent);
  text-decoration: underline;
}
.card.locked .thumb,
.card.locked .shot-video {
  filter: saturate(0.85);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.card-desc {
  font-size: 10.5px;
  color: var(--text-2);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  font-size: 9px;
  color: var(--text-3);
}
.empty-note {
  padding: 20px 0;
  text-align: center;
}
.link-btn {
  color: var(--accent);
  text-decoration: underline;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
}
.error-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
