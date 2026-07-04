<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'

const project = useProjectStore()
const editor = useEditorStore()

const text = ref('')
const error = ref('')
const fileInput = ref<HTMLInputElement>()

function doImport(raw: string) {
  error.value = ''
  try {
    const parsed = JSON.parse(raw)
    project.loadRaw(parsed)
    editor.setContext('root')
    editor.clearSelection()
    editor.closeModal()
    const warnings = project.importWarnings
    editor.notify(
      warnings.length
        ? `Imported with ${warnings.length} warning(s): ${warnings[0]}`
        : 'Project imported',
      warnings.length ? 'info' : 'success'
    )
  } catch (e: any) {
    error.value = e.message
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  text.value = await file.text()
  doImport(text.value)
}

async function fromClipboard() {
  try {
    text.value = await navigator.clipboard.readText()
  } catch {
    error.value = 'Clipboard read failed — paste manually.'
  }
}
</script>

<template>
  <UiModal title="Import zvid project JSON" width="620px" @close="editor.closeModal()">
    <p class="hint">
      Paste (or open) any JSON accepted by <code>zvid render</code> — lowercase
      types, missing defaults and extra fields are all handled.
    </p>
    <div class="actions">
      <button class="btn" @click="fileInput?.click()">
        <UiIcon name="folder" :size="13" /> Open .json file
      </button>
      <button class="btn ghost" @click="fromClipboard">Paste from clipboard</button>
      <input ref="fileInput" type="file" accept=".json" hidden @change="onFile" />
    </div>
    <textarea
      v-model="text"
      class="ctl mono code"
      rows="14"
      spellcheck="false"
      placeholder='{ "name": "my-video", "visuals": [ … ] }'
    />
    <pre v-if="error" class="err">{{ error }}</pre>
    <p class="hint warn-note">
      Importing replaces the current project (autosaved separately — undo works
      after import).
    </p>
    <template #footer>
      <button class="btn ghost" @click="editor.closeModal()">Cancel</button>
      <button class="btn primary" :disabled="!text.trim()" @click="doImport(text)">
        <UiIcon name="upload" :size="13" /> Import project
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}
.code {
  width: 100%;
  font-size: 11px;
  line-height: 1.5;
}
.err {
  color: var(--red);
  font-size: 11px;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  background: color-mix(in srgb, var(--red) 7%, transparent);
  padding: 8px 10px;
  border-radius: var(--radius-s);
  max-height: 140px;
  overflow: auto;
}
.warn-note {
  margin-top: 6px;
}
code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--bg-3);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
