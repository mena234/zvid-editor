<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed } from 'vue'
import { useProjectStore } from '~/stores/project'
import { useEditorStore } from '~/stores/editor'
import { canonicalVisualType } from '~/shared/schema/types'

const props = withDefaults(
  defineProps<{ x: number; y: number; itemId: string; kind?: 'visual' | 'audio' }>(),
  { kind: 'visual' }
)
const emit = defineEmits<{ close: [] }>()

const project = useProjectStore()
const editor = useEditorStore()

const isAudio = computed(() => props.kind === 'audio')
const item = computed(() =>
  isAudio.value ? project.audioById(props.itemId) : project.visualById(props.itemId)
)
const type = computed(() =>
  !item.value || isAudio.value ? null : canonicalVisualType((item.value as any).type)
)

function onDocDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.ctx-menu')) emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocDown, true)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onEsc)
})
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function run(action: () => void) {
  action()
  emit('close')
}

function duplicate() {
  if (isAudio.value) {
    const copy = project.duplicateAudio(props.itemId)
    if (copy) editor.selectAudio(copy._id)
  } else {
    const copy = project.duplicateVisual(props.itemId)
    if (copy) editor.selectVisual(copy._id)
  }
}
function remove() {
  if (isAudio.value) project.removeAudio(props.itemId)
  else project.removeVisual(props.itemId)
  editor.clearSelection()
}
async function copyJson() {
  if (!item.value) return
  const { _id, ...raw } = item.value
  await navigator.clipboard.writeText(JSON.stringify(raw, null, 2))
  editor.notify('Element JSON copied', 'success')
}
async function pasteJson() {
  try {
    const text = await navigator.clipboard.readText()
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') throw new Error('not an element')
    if (raw.type) {
      const added = project.addVisual(editor.context, raw)
      editor.selectVisual(added._id)
    } else if (raw.src) {
      // audio items have no type field — a bare { src, … } is an audio
      const added = project.addAudio(editor.context, raw)
      editor.selectAudio(added._id)
    } else {
      throw new Error('not an element')
    }
    editor.notify('Element pasted', 'success')
  } catch {
    editor.notify('Clipboard does not contain a valid element JSON', 'error')
  }
}
function fit(mode: 'cover' | 'contain') {
  project.patchVisual(props.itemId, {
    resize: mode,
    width: undefined,
    height: undefined,
    position: 'center-center',
    anchor: 'center-center',
  })
}
function resetSize() {
  project.patchVisual(props.itemId, { width: undefined, height: undefined, resize: undefined })
}

const style = computed(() => ({
  left: `${Math.min(props.x, window.innerWidth - 220)}px`,
  top: `${Math.min(props.y, window.innerHeight - 320)}px`,
}))
</script>

<template>
  <Teleport to="body">
    <div class="ctx-menu" :style="style">
      <button @click="run(duplicate)">
        <UiIcon name="copy" :size="13" /> Duplicate <kbd>Ctrl+D</kbd>
      </button>
      <template v-if="!isAudio">
        <button @click="run(() => project.bumpTrack(itemId, 1))">
          <UiIcon name="chevron_up" :size="13" /> Bring forward (track +1)
        </button>
        <button @click="run(() => project.bumpTrack(itemId, -1))">
          <UiIcon name="chevron_down" :size="13" /> Send backward (track −1)
        </button>
      </template>
      <div class="sep" />
      <template v-if="type === 'VIDEO' || type === 'IMAGE' || type === 'GIF'">
        <button @click="run(() => fit('cover'))">Fill frame (cover)</button>
        <button @click="run(() => fit('contain'))">Fit frame (contain)</button>
        <button @click="run(resetSize)">Reset to intrinsic size</button>
        <div class="sep" />
      </template>
      <button @click="run(copyJson)"><UiIcon name="json" :size="13" /> Copy JSON</button>
      <button @click="run(pasteJson)">
        <UiIcon name="upload" :size="13" /> Paste element JSON
      </button>
      <div class="sep" />
      <button class="danger" @click="run(remove)">
        <UiIcon name="trash" :size="13" /> Delete <kbd>Del</kbd>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 300;
  min-width: 210px;
  padding: 5px;
  background: var(--bg-3);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
}
.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: none;
  background: none;
  color: var(--text-0);
  font-size: 12px;
  border-radius: var(--radius-s);
  text-align: left;
}
.ctx-menu button:hover {
  background: var(--bg-4);
}
.ctx-menu button.danger:hover {
  background: rgba(244, 98, 110, 0.15);
  color: var(--red);
}
.ctx-menu kbd {
  margin-left: auto;
}
.sep {
  height: 1px;
  background: var(--border-0);
  margin: 4px 6px;
}
</style>
