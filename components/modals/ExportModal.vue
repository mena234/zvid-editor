<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { validateProjectDoc } from '~/shared/schema/validate'
import { nodeSnippet, cliSnippet, fetchSnippet } from '~/utils/snippets'

const project = useProjectStore()
const editor = useEditorStore()

const json = computed(() => project.exportString())
const issues = computed(() => validateProjectDoc(project.doc))
const errors = computed(() => issues.value.filter((i) => i.level === 'error'))
const warnings = computed(() => issues.value.filter((i) => i.level === 'warning'))

const tab = ref<'json' | 'node' | 'cli' | 'api' | 'issues'>('json')

const name = computed(() => project.doc.name ?? 'project')

const activeContent = computed(() => {
  switch (tab.value) {
    case 'node':
      return nodeSnippet(json.value, name.value)
    case 'cli':
      return cliSnippet(name.value)
    case 'api':
      return fetchSnippet(json.value)
    default:
      return json.value
  }
})

async function copy() {
  await navigator.clipboard.writeText(activeContent.value)
  editor.notify('Copied to clipboard', 'success')
}

function download() {
  const blob = new Blob([json.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.value}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const sizeKb = computed(() => Math.round((json.value.length / 1024) * 10) / 10)
</script>

<template>
  <UiModal title="Export — automation-ready JSON" width="760px" @close="editor.closeModal()">
    <div class="status-row">
      <span v-if="errors.length" class="pill err" role="button" @click="tab = 'issues'">
        <UiIcon name="warning" :size="12" /> {{ errors.length }} error{{ errors.length > 1 ? 's' : '' }}
      </span>
      <span v-else class="pill ok"><UiIcon name="check" :size="12" /> valid for rendering</span>
      <span v-if="warnings.length" class="pill warn" role="button" @click="tab = 'issues'">
        {{ warnings.length }} warning{{ warnings.length > 1 ? 's' : '' }}
      </span>
      <span class="pill dim">{{ sizeKb }} KB</span>
    </div>

    <nav class="tabs">
      <button :class="{ on: tab === 'json' }" @click="tab = 'json'">project.json</button>
      <button :class="{ on: tab === 'node' }" @click="tab = 'node'">Node.js</button>
      <button :class="{ on: tab === 'cli' }" @click="tab = 'cli'">CLI</button>
      <button :class="{ on: tab === 'api' }" @click="tab = 'api'">HTTP API</button>
      <button :class="{ on: tab === 'issues' }" @click="tab = 'issues'">
        Validation ({{ issues.length }})
      </button>
    </nav>

    <div v-if="tab !== 'issues'" class="code-wrap">
      <pre class="code mono">{{ activeContent }}</pre>
    </div>
    <div v-else class="issues">
      <p v-if="!issues.length" class="hint ok-text">
        <UiIcon name="check" :size="13" /> No issues found — this JSON renders
        exactly as configured.
      </p>
      <div v-for="(issue, i) in issues" :key="i" class="issue" :class="issue.level">
        <span class="issue-level">{{ issue.level }}</span>
        <span class="issue-path mono">{{ issue.path }}</span>
        <span class="issue-msg">{{ issue.message }}</span>
      </div>
    </div>

    <template #footer>
      <p class="foot-hint hint">
        Render it anywhere: <code>npx zvid render {{ name }}.json --out ./dist</code>
      </p>
      <button class="btn" @click="copy"><UiIcon name="copy" :size="13" /> Copy</button>
      <button class="btn primary" @click="download">
        <UiIcon name="download" :size="13" /> Download {{ name }}.json
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.status-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  cursor: default;
}
.pill.ok {
  background: color-mix(in srgb, var(--green) 12%, transparent);
  color: var(--green);
}
.pill.err {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
  cursor: pointer;
}
.pill.warn {
  background: color-mix(in srgb, var(--yellow) 12%, transparent);
  color: var(--yellow);
  cursor: pointer;
}
.pill.dim {
  background: var(--bg-3);
  color: var(--text-2);
}
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border-0);
  margin-bottom: 10px;
}
.tabs button {
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  border-bottom: 2px solid transparent;
}
.tabs button.on {
  color: var(--accent-strong);
  border-bottom-color: var(--accent);
}
.code-wrap {
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
  background: var(--bg-0);
  max-height: 46vh;
  overflow: auto;
}
.code {
  margin: 0;
  padding: 12px 14px;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-1);
}
.issues {
  max-height: 46vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ok-text {
  color: var(--green);
  display: flex;
  align-items: center;
  gap: 6px;
}
.issue {
  display: grid;
  grid-template-columns: 58px 170px 1fr;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-s);
  font-size: 11.5px;
  align-items: baseline;
}
.issue.error {
  background: color-mix(in srgb, var(--red) 8%, transparent);
}
.issue.warning {
  background: color-mix(in srgb, var(--yellow) 7%, transparent);
}
.issue-level {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
}
.issue.error .issue-level {
  color: var(--red);
}
.issue.warning .issue-level {
  color: var(--yellow);
}
.issue-path {
  font-size: 10px;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.issue-msg {
  color: var(--text-1);
}
.foot-hint {
  margin-right: auto;
}
code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--bg-3);
  padding: 2px 5px;
  border-radius: 3px;
}
</style>
