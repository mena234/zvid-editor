<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { useCloud, type CloudProjectRow } from '~/composables/useCloud'

const project = useProjectStore()
const editor = useEditorStore()
const cloud = useCloud()

const rows = ref<CloudProjectRow[]>([])
const loading = ref(true)
const error = ref('')
const busyId = ref('')
const confirmDeleteId = ref('')
const renamingId = ref('')
const renameValue = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch<any>('/api/projects', { query: { limit: 50 } })
    if (r.success) rows.value = r.projects
    else if (!cloud.handleExpired(r, 'projects')) error.value = r.error
  } catch {
    error.value = 'Could not load projects — try again.'
  }
  loading.value = false
}
onMounted(load)

async function openProject(row: CloudProjectRow) {
  if (busyId.value) return
  busyId.value = row.id
  try {
    const r = await $fetch<any>(`/api/projects/${row.id}`)
    if (r.success) {
      project.loadRaw(r.project.payload)
      editor.setCloudProject({ id: r.project.id, name: r.project.name })
      editor.setContext('root')
      editor.clearSelection()
      editor.closeModal()
      editor.notify(`Opened “${r.project.name}”`, 'success')
    } else if (!cloud.handleExpired(r, 'projects')) {
      error.value = r.error
    }
  } catch {
    error.value = 'Could not open the project — try again.'
  }
  busyId.value = ''
}

function startRename(row: CloudProjectRow) {
  renamingId.value = row.id
  renameValue.value = row.name
  confirmDeleteId.value = ''
}

async function commitRename(row: CloudProjectRow) {
  const name = renameValue.value.trim()
  renamingId.value = ''
  if (!name || name === row.name) return
  try {
    const r = await $fetch<any>(`/api/projects/${row.id}`, {
      method: 'PUT',
      body: { name },
    })
    if (r.success) {
      row.name = r.project.name
      if (editor.cloudProject?.id === row.id) {
        editor.setCloudProject({ id: row.id, name: r.project.name })
      }
    } else if (!cloud.handleExpired(r, 'projects')) {
      editor.notify(r.error || 'Rename failed', 'error')
    }
  } catch {
    editor.notify('Rename failed — try again.', 'error')
  }
}

async function removeProject(row: CloudProjectRow) {
  if (confirmDeleteId.value !== row.id) {
    confirmDeleteId.value = row.id
    return
  }
  confirmDeleteId.value = ''
  busyId.value = row.id
  try {
    const r = await $fetch<any>(`/api/projects/${row.id}`, { method: 'DELETE' })
    if (r.success) {
      rows.value = rows.value.filter((p) => p.id !== row.id)
      if (editor.cloudProject?.id === row.id) editor.setCloudProject(null)
      editor.notify('Project deleted', 'info')
    } else if (!cloud.handleExpired(r, 'projects')) {
      editor.notify(r.error || 'Delete failed', 'error')
    }
  } catch {
    editor.notify('Delete failed — try again.', 'error')
  }
  busyId.value = ''
}

function saveCurrentAsNew() {
  editor.openModal('saveProject')
}

function fmtDate(value: string) {
  const d = new Date(value)
  return isNaN(d.getTime()) ? '' : d.toLocaleString()
}
</script>

<template>
  <UiModal title="My projects" width="640px" @close="editor.closeModal()">
    <p v-if="loading" class="hint">Loading your projects…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!rows.length" class="hint">
      No saved projects yet — use <b>Save project</b> below to keep the
      current document in your account.
    </p>

    <ul v-else class="list">
      <li v-for="row in rows" :key="row.id" class="row" :class="{ linked: editor.cloudProject?.id === row.id }">
        <div class="row-main">
          <input
            v-if="renamingId === row.id"
            v-model="renameValue"
            class="ctl rename"
            @keydown.enter.prevent="commitRename(row)"
            @keydown.esc="renamingId = ''"
            @blur="commitRename(row)"
          />
          <button v-else class="name" :title="`Open “${row.name}”`" @click="openProject(row)">
            {{ row.name }}
            <span v-if="editor.cloudProject?.id === row.id" class="badge">open</span>
          </button>
          <span class="meta">Updated {{ fmtDate(row.updatedAt) }}</span>
        </div>
        <div class="row-actions">
          <button class="btn ghost sm" :disabled="busyId === row.id" @click="openProject(row)">
            Open
          </button>
          <button class="icon-btn" title="Rename" @click="startRename(row)">
            <UiIcon name="text" :size="13" />
          </button>
          <button
            class="icon-btn"
            :class="{ danger: confirmDeleteId === row.id }"
            :title="confirmDeleteId === row.id ? 'Click again to delete' : 'Delete'"
            @click="removeProject(row)"
          >
            <UiIcon name="trash" :size="13" />
          </button>
        </div>
      </li>
    </ul>

    <template #footer>
      <p class="foot-hint hint">Opening a project replaces the current document (undo works).</p>
      <button class="btn primary" @click="saveCurrentAsNew">
        <UiIcon name="save" :size="13" /> Save current as new
      </button>
    </template>
  </UiModal>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 52vh;
  overflow: auto;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-0);
  border-radius: var(--radius-m);
  background: var(--bg-2);
}
.row.linked {
  border-color: var(--accent);
}
.row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name:hover {
  color: var(--accent-strong);
}
.badge {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;
  padding: 2px 7px;
  margin-left: 6px;
}
.meta {
  font-size: 11px;
  color: var(--text-3);
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.btn.sm {
  padding: 4px 10px;
  font-size: 11.5px;
}
.icon-btn.danger {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}
.rename {
  height: 28px;
  font-size: 12.5px;
  width: 260px;
}
.err {
  color: var(--red);
  font-size: 12px;
  background: color-mix(in srgb, var(--red) 8%, transparent);
  padding: 7px 10px;
  border-radius: var(--radius-s);
}
.foot-hint {
  margin-right: auto;
}
</style>
