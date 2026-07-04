<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { validateProjectDoc } from '~/shared/schema/validate'

const project = useProjectStore()
const editor = useEditorStore()

const issues = computed(() => validateProjectDoc(project.doc))
const errors = computed(() => issues.value.filter((i) => i.level === 'error'))
const warnings = computed(() => issues.value.filter((i) => i.level === 'warning'))

const stats = computed(() => {
  const doc = project.doc
  const sceneVisuals = (doc.scenes ?? []).reduce((s, sc) => s + sc.visuals.length, 0)
  const sceneAudios = (doc.scenes ?? []).reduce((s, sc) => s + sc.audios.length, 0)
  return {
    visuals: doc.visuals.length + sceneVisuals,
    audios: doc.audios.length + sceneAudios,
    scenes: doc.scenes?.length ?? 0,
    captions: doc.subtitle?.captions?.length ?? 0,
  }
})
</script>

<template>
  <div>
    <UiSection title="Overview">
      <div class="stats">
        <div class="stat">
          <b>{{ stats.visuals }}</b><span>visuals</span>
        </div>
        <div class="stat">
          <b>{{ stats.audios }}</b><span>audios</span>
        </div>
        <div class="stat">
          <b>{{ stats.scenes }}</b><span>scenes</span>
        </div>
        <div class="stat">
          <b>{{ stats.captions }}</b><span>captions</span>
        </div>
      </div>
      <p class="hint">
        Select an element on the canvas or timeline to edit its properties.
        Project settings live in the top bar.
      </p>
    </UiSection>

    <UiSection title="Thumbnail" collapsible :start-open="!!project.doc.thumbnail">
      <UiField label="Image URL" hint="Embedded as the video's cover/thumbnail stream">
        <input
          class="ctl mono"
          :value="project.doc.thumbnail ?? ''"
          placeholder="https://…/cover.png"
          spellcheck="false"
          @change="
            project.patchProject({
              thumbnail: ($event.target as HTMLInputElement).value || undefined,
            })
          "
        />
      </UiField>
    </UiSection>

    <UiSection title="Validation">
      <p v-if="!issues.length" class="hint ok">
        <UiIcon name="check" :size="12" /> No issues — the project renders as-is.
      </p>
      <div v-for="(issue, i) in issues.slice(0, 12)" :key="i" class="issue" :class="issue.level">
        <UiIcon :name="issue.level === 'error' ? 'warning' : 'info'" :size="12" />
        <div>
          <span class="issue-path mono">{{ issue.path }}</span>
          <span class="issue-msg">{{ issue.message }}</span>
        </div>
      </div>
      <p v-if="issues.length > 12" class="hint">
        +{{ issues.length - 12 }} more — see the Export dialog for the full report.
      </p>
    </UiSection>

    <UiSection title="Automate">
      <p class="hint">
        Done designing? Export the JSON and render it anywhere with
        <code>npx zvid render project.json</code> — same output, no editor
        needed.
      </p>
      <button class="btn primary" style="width: 100%" @click="editor.openModal('export')">
        <UiIcon name="export" :size="14" /> Export JSON
      </button>
    </UiSection>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 2px;
  background: var(--bg-2);
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
}
.stat b {
  font-size: 15px;
}
.stat span {
  font-size: 9.5px;
  color: var(--text-2);
}
.ok {
  color: var(--green);
}
.issue {
  display: flex;
  gap: 7px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
  font-size: 11px;
  margin-bottom: 4px;
  align-items: flex-start;
}
.issue.error {
  background: color-mix(in srgb, var(--red) 8%, transparent);
  color: var(--red);
}
.issue.warning {
  background: color-mix(in srgb, var(--yellow) 7%, transparent);
  color: var(--yellow);
}
.issue-path {
  display: block;
  font-size: 9.5px;
  opacity: 0.75;
}
.issue-msg {
  color: var(--text-1);
}
code {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--bg-3);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
