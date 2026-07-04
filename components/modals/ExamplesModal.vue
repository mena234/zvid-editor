<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import {
  fetchLibraryContent,
  fetchLibraryList,
  libraryErrorMessage,
  type LibraryItem,
} from '~/composables/useLibrary'

const project = useProjectStore()
const editor = useEditorStore()

const items = ref<LibraryItem[]>([])
const pending = ref(true)
const error = ref('')
const loadingSlug = ref('')

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
</script>

<template>
  <UiModal title="Example projects" width="680px" @close="editor.closeModal()">
    <p class="hint">
      The zvid package's shipped examples — load one to explore how features map
    to JSON. Loading replaces the current project.
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
        :class="{ busy: loadingSlug === ex.slug }"
        @click="load(ex)"
      >
        <span class="card-head">
          <UiIcon
            :name="ex.meta?.hasScenes ? 'scene' : ex.meta?.hasSubtitle ? 'subtitles' : 'film'"
            :size="15"
          />
          <b>{{ ex.title }}</b>
        </span>
        <span class="card-desc">{{ ex.description }}</span>
        <span class="card-meta mono">
          {{ ex.meta?.resolution }}
          <template v-if="ex.meta?.duration"> · {{ ex.meta.duration }}s</template>
          <template v-if="ex.meta?.scenes"> · {{ ex.meta.scenes }} scenes</template>
        </span>
      </button>
    </div>
  </UiModal>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
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
.card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}
.card-head :deep(svg) {
  color: var(--accent-strong);
}
.card-desc {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.4;
}
.card-meta {
  font-size: 9.5px;
  color: var(--text-3);
}
.error-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
