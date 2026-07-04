<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useCloud } from '~/composables/useCloud'

const project = useProjectStore()
const editor = useEditorStore()
const cloud = useCloud()

const name = ref(project.doc.name || editor.cloudProject?.name || '')
const error = ref('')
const busy = ref(false)

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await $fetch<any>('/api/projects', {
      method: 'POST',
      body: { name: trimmed, payload: cloud.currentPayload() },
    })
    if (r.success) {
      // Cloud name mirrors the project's output name — keep them in sync.
      if (project.doc.name !== trimmed) project.patchProject({ name: trimmed })
      editor.setCloudProject({ id: r.project.id, name: r.project.name })
      editor.notify('Project saved to your account', 'success')
      editor.closeModal()
    } else if (!cloud.handleExpired(r, 'saveProject')) {
      error.value = r.error || 'Save failed'
    }
  } catch {
    error.value = 'Could not reach the server — try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiModal title="Save project to your account" width="420px" @close="editor.closeModal()">
    <p class="hint">
      Saves this document to your Zvid account so you can reopen it from any
      browser. It stays a draft — nothing is rendered or charged.
    </p>

    <form class="form" @submit.prevent="save">
      <label class="field">
        <span class="label">Project name</span>
        <input
          v-model="name"
          class="ctl"
          type="text"
          maxlength="255"
          placeholder="my-video"
          autofocus
        />
      </label>
      <p v-if="error" class="err">{{ error }}</p>
    </form>

    <template #footer>
      <button class="btn ghost" @click="editor.closeModal()">Cancel</button>
      <button class="btn primary" :disabled="busy || !name.trim()" @click="save">
        <UiIcon name="save" :size="13" />
        {{ busy ? 'Saving…' : 'Save project' }}
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.form {
  margin-top: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}
.ctl {
  width: 100%;
  height: 32px;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 10px 0 0;
  background: color-mix(in srgb, var(--red) 8%, transparent);
  padding: 7px 10px;
  border-radius: var(--radius-s);
}
</style>
