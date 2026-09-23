<script setup lang="ts">
import { ref, nextTick, watch, onBeforeUnmount, useId } from 'vue'
import { useEditorStore } from '~/stores/editor'

/**
 * Compact "{{ }}" picker: lists available placeholders and emits the chosen
 * one for the parent to insert into its field.
 */
const props = defineProps<{
  options: string[]
  title?: string
  /** shown when `options` is empty (e.g. no variables of the right type yet) */
  emptyText?: string
}>()
const emit = defineEmits<{ insert: [placeholder: string] }>()

const editor = useEditorStore()
const open = ref(false)
const root = ref<HTMLElement>()
const menu = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const menuId = useId()
const position = ref({ top: '8px', left: '8px', width: '220px' })

function positionMenu() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.min(260, window.innerWidth - 16)
  const height = menu.value?.offsetHeight ?? 240
  const below = rect.bottom + 4
  position.value = {
    top: `${Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : rect.top - height - 4, window.innerHeight - height - 8))}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
  }
}
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function onDocDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node) && !menu.value?.contains(e.target as Node)) close()
}
function onFocusIn(e: FocusEvent) {
  if (!root.value?.contains(e.target as Node) && !menu.value?.contains(e.target as Node)) close()
}
function removeListeners() {
  document.removeEventListener('pointerdown', onDocDown)
  document.removeEventListener('focusin', onFocusIn)
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
}
watch(open, async value => {
  if (!value) return removeListeners()
  await nextTick()
  if (!open.value) return
  positionMenu()
  menu.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  document.addEventListener('pointerdown', onDocDown)
  document.addEventListener('focusin', onFocusIn)
  window.addEventListener('resize', positionMenu)
  window.addEventListener('scroll', positionMenu, true)
})
onBeforeUnmount(removeListeners)

function pick(name: string) {
  close(true)
  emit('insert', `{{${name}}}`)
}

function manageVariables() {
  open.value = false
  editor.openPanel('variables')
}
</script>

<template>
  <span ref="root" class="var-menu">
    <button
      ref="trigger"
      class="icon-btn vm-btn"
      type="button"
      :title="title ?? 'Insert a {{variable}} placeholder'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click="open = !open"
      @keydown.esc.stop.prevent="close(true)"
    >
      <UiIcon name="json" :size="12" />
    </button>
    <Teleport to="body">
    <div v-if="open" :id="menuId" ref="menu" class="vm-pop" :style="position" role="dialog" aria-label="Choose a variable" @keydown.esc.stop.prevent="close(true)" @keydown.stop>
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
      <p v-else class="vm-empty hint">{{ emptyText ?? 'No variables defined yet.' }}</p>
      <div class="vm-sep" />
      <button class="vm-item manage" type="button" @click="manageVariables">
        Manage variables…
      </button>
    </div>
    </Teleport>
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
  position: fixed;
  max-height: min(240px, calc(100dvh - 16px));
  overflow-y: auto;
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  padding: 4px;
  z-index: 1100;
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
@media (pointer: coarse) {
  .vm-btn { width: 32px; height: 32px; }
  .vm-item { min-height: 38px; font-size: 13px; }
}
</style>
