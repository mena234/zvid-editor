<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '~/stores/editor'

/**
 * Compact "{{ }}" picker: lists available placeholders and emits the chosen
 * one for the parent to insert into its field.
 */
const props = defineProps<{
  options: string[]
  title?: string
}>()
const emit = defineEmits<{ insert: [placeholder: string] }>()

const editor = useEditorStore()
const open = ref(false)
const root = ref<HTMLElement>()

function onDocDown(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

function pick(name: string) {
  open.value = false
  emit('insert', `{{${name}}}`)
}

function manageVariables() {
  open.value = false
  editor.leftPanel = 'variables'
}
</script>

<template>
  <span ref="root" class="var-menu">
    <button
      class="icon-btn vm-btn"
      type="button"
      :title="title ?? 'Insert a {{variable}} placeholder'"
      @click="open = !open"
    >
      <UiIcon name="json" :size="12" />
    </button>
    <div v-if="open" class="vm-pop">
      <template v-if="options.length">
        <button
          v-for="name in options"
          :key="name"
          class="vm-item mono"
          type="button"
          @click="pick(name)"
        >
          {{ '\{\{' }}{{ name }}{{ '\}\}' }}
        </button>
      </template>
      <p v-else class="vm-empty hint">No variables defined yet.</p>
      <div class="vm-sep" />
      <button class="vm-item manage" type="button" @click="manageVariables">
        Manage variables…
      </button>
    </div>
  </span>
</template>

<style scoped>
.var-menu {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
.vm-btn {
  width: 24px;
  height: 24px;
  color: var(--accent-strong);
}
.vm-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 170px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  padding: 4px;
  z-index: 80;
}
.vm-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 5px 8px;
  border-radius: var(--radius-s);
  font-size: 11px;
  color: var(--accent-strong);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vm-item:hover {
  background: var(--bg-2);
}
.vm-item.manage {
  color: var(--text-2);
  font-size: 11px;
  font-family: var(--font-sans);
}
.vm-empty {
  padding: 5px 8px;
  margin: 0;
}
.vm-sep {
  height: 1px;
  background: var(--border-0);
  margin: 4px 0;
}
.mono {
  font-family: var(--font-mono);
}
</style>
