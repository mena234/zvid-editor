<script setup lang="ts">
import { ref } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useCloud } from '~/composables/useCloud'

const project = useProjectStore()
const editor = useEditorStore()
const cloud = useCloud()
const dashUrl = useRuntimeConfig().public.dashUrl as string

const name = ref(project.doc.name || '')
const description = ref('')
const error = ref('')
const details = ref<{ field: string; message: string }[]>([])
const busy = ref(false)
const saved = ref<null | { id: string; name: string }>(null)

async function save() {
  const trimmed = name.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  error.value = ''
  details.value = []
  try {
    const r = await $fetch<any>('/api/templates', {
      method: 'POST',
      body: {
        name: trimmed,
        description: description.value.trim(),
        payload: cloud.currentPayload(),
      },
    })
    if (r.success) {
      saved.value = { id: r.template.id, name: r.template.name }
      editor.notify('Template saved to your account', 'success')
    } else if (!cloud.handleExpired(r, 'saveTemplate')) {
      error.value = r.error || 'Save failed'
      details.value = Array.isArray(r.details) ? r.details : []
    }
  } catch {
    error.value = 'Could not reach the server — try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiModal title="Save as render template" width="480px" @close="editor.closeModal()">
    <template v-if="!saved">
      <p class="hint">
        Templates are render-ready projects stored in your account: call the
        API with the template id (plus <code>variables</code>) instead of
        sending the full JSON. Unlike drafts, templates are validated against
        your plan limits when saved.
      </p>

      <form class="form" @submit.prevent="save">
        <label class="field">
          <span class="label">Template name</span>
          <input
            v-model="name"
            class="ctl"
            type="text"
            maxlength="255"
            placeholder="my-template"
            autofocus
          />
        </label>
        <label class="field">
          <span class="label">Description <em>(optional)</em></span>
          <textarea
            v-model="description"
            class="ctl area"
            rows="2"
            maxlength="2000"
            placeholder="What this template is for…"
          />
        </label>
      </form>

      <div v-if="error" class="err-block">
        <p class="err-title">{{ error }}</p>
        <ul v-if="details.length" class="err-list">
          <li v-for="(d, i) in details" :key="i">
            <span class="mono field-path">{{ d.field }}</span> {{ d.message }}
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <div class="done">
        <p class="done-title">
          <UiIcon name="check" :size="14" /> “{{ saved.name }}” saved
        </p>
        <p class="hint">
          Template id: <code class="mono">{{ saved.id }}</code>
        </p>
        <p class="hint">
          Render it via the API with
          <code>POST /api/render</code> and
          <code>{ "template": "{{ saved.id }}" }</code> — manage it in
          <a :href="`${dashUrl}/templates/${saved.id}`" target="_blank" rel="noopener">your dashboard</a>.
        </p>
      </div>
    </template>

    <template #footer>
      <template v-if="!saved">
        <button class="btn ghost" @click="editor.closeModal()">Cancel</button>
        <button class="btn primary" :disabled="busy || !name.trim()" @click="save">
          <UiIcon name="magic" :size="13" />
          {{ busy ? 'Saving…' : 'Save template' }}
        </button>
      </template>
      <button v-else class="btn primary" @click="editor.closeModal()">Done</button>
    </template>
  </UiModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.label em {
  font-weight: 400;
  color: var(--text-3);
  font-style: normal;
}
.ctl {
  width: 100%;
  height: 32px;
}
.area {
  height: auto;
  padding: 8px 9px;
  resize: vertical;
}
.err-block {
  margin-top: 12px;
  background: color-mix(in srgb, var(--red) 7%, transparent);
  border-radius: var(--radius-s);
  padding: 9px 11px;
}
.err-title {
  color: var(--red);
  font-size: 12px;
  font-weight: 600;
  margin: 0;
}
.err-list {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  color: var(--text-1);
  max-height: 160px;
  overflow: auto;
}
.field-path {
  color: var(--text-2);
  font-size: 10.5px;
}
.done {
  padding: 6px 0;
}
.done-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--green);
  font-size: 13.5px;
  font-weight: 600;
  margin: 0 0 8px;
}
.done a {
  color: var(--accent-strong);
}
code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--bg-3);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
