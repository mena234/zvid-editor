<script setup lang="ts">
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { EXAMPLES } from '~/data/examples'

const project = useProjectStore()
const editor = useEditorStore()

function load(config: Record<string, any>) {
  project.loadRaw(JSON.parse(JSON.stringify(config)))
  editor.setContext('root')
  editor.clearSelection()
  editor.closeModal()
  editor.notify('Example loaded', 'success')
}
</script>

<template>
  <UiModal title="Example projects" width="680px" @close="editor.closeModal()">
    <p class="hint">
      The zvid package's shipped examples — load one to explore how features map
    to JSON. Loading replaces the current project.
    </p>
    <div class="grid">
      <button v-for="ex in EXAMPLES" :key="ex.slug" class="card" @click="load(ex.config)">
        <span class="card-head">
          <UiIcon
            :name="ex.config.scenes ? 'scene' : ex.config.subtitle ? 'subtitles' : 'film'"
            :size="15"
          />
          <b>{{ ex.title }}</b>
        </span>
        <span class="card-desc">{{ ex.description }}</span>
        <span class="card-meta mono">
          {{ ex.config.resolution ?? `${ex.config.width}×${ex.config.height}` }}
          <template v-if="ex.config.duration"> · {{ ex.config.duration }}s</template>
          <template v-if="ex.config.scenes"> · {{ ex.config.scenes.length }} scenes</template>
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
</style>
