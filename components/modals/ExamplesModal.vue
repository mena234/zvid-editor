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

/** Premium templates need a paid plan; everyone can still hover-preview them. */
function isLocked(item: LibraryItem): boolean {
  return !!item.meta?.premium && !auth.isPaid
}
const hasLocked = computed(() => items.value.some(isLocked))

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
  <UiModal title="Example projects" width="860px" @close="editor.closeModal()">
    <p class="hint">
      Curated example projects — hover a card to preview, click to load it into
      the editor. Loading replaces the current project.
      <template v-if="hasLocked">
        <span class="pro-chip">PRO</span> templates need a paid plan —
        <a class="upgrade-link" :href="`${dashUrl}/subscription`" target="_blank"
          >upgrade</a
        >.
      </template>
    </p>
    <p v-if="pending" class="hint">Loading examples…</p>
    <div v-else-if="error" class="error-box">
      <p class="hint">⚠ {{ error }}</p>
      <button class="btn sm" @click="loadList()">Retry</button>
    </div>
    <div v-else class="grid">
      <button
        v-for="ex in items"
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
              :name="ex.meta?.hasScenes ? 'scene' : ex.meta?.hasSubtitle ? 'subtitles' : 'film'"
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
        </span>
        <span class="card-head">
          <b>{{ ex.title }}</b>
        </span>
        <span class="card-desc">{{ ex.description }}</span>
        <span class="card-meta mono">
          {{ ex.meta?.resolution }}
          <template v-if="ex.meta?.scenes"> · {{ ex.meta.scenes }} scenes</template>
        </span>
      </button>
    </div>
  </UiModal>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 2px;
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
.error-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
